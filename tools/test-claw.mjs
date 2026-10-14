// Browser test of the Chimp Claw (engine/clawMachine.ts, clawRules.ts, clawPhysics.ts):
// the machine found by role and its pile settled, the odds of its rules over many simulated
// plays, walking up and pressing E, steering with the keys, dropping, a won prize carried to the
// chute and dropped in (never through the glass, never flung) and coming out of the pickup door,
// the timer dropping by itself, leaving with Esc, restocking, and prizes dropped in deep in one
// another coming apart gently and settling.
//   URL=http://localhost:5183 node tools/test-claw.mjs
// Screenshots go to captures/claw-play-*.png.
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:5173";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
// never leave a browser behind: closed on a signal (the lock's timeout) or an error
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => void browser.close().finally(() => process.exit(1)));
process.on("uncaughtException", (e) => {
  console.log("[error]", e.message);
  void browser.close().finally(() => process.exit(1));
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("crash", () => console.log("[crash] the page crashed"));
await page.goto(`${URL}/?capture=1`);
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
// from the machine as it opens: the room keeps the last pile, so a fresh one for everyone
await page.evaluate(() => window.__chimp.claw.reset());

let failed = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const waitFor = async (fn, arg, ms) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
    return true;
  } catch {
    return false;
  }
};
// a watch on the prizes frame by frame, in the page: the fastest any prize's centre goes (and
// leaving out a fall), and the furthest any pokes out through the glass. A prize the attendant
// puts back in jumps there, so a jump of more than 25 cm in a frame isn't counted as speed.
const startProbe = () =>
  ev(() => {
    const c = window.__chimp.claw;
    const probe = { any: 0, across: 0, out: 0, on: true };
    let last = null;
    let lastT = 0;
    const tick = (t) => {
      if (!probe.on) return;
      const now = c.prizes();
      const dt = (t - lastT) / 1000;
      if (last && dt > 0)
        now.forEach((q, i) => {
          if (q.gone || last[i].gone) return;
          const [dx, dy, dz] = [0, 1, 2].map((j) => q.at[j] - last[i].at[j]);
          if (Math.hypot(dx, dy, dz) > 0.25) return;
          probe.any = Math.max(probe.any, Math.hypot(dx, dy, dz) / dt);
          probe.across = Math.max(probe.across, Math.hypot(dx, dz, Math.max(0, dy)) / dt);
        });
      probe.out = Math.max(probe.out, c.glassOut());
      last = now;
      lastT = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__clawProbe = probe;
  });
const stopProbe = () =>
  ev(() => {
    window.__clawProbe.on = false;
    return window.__clawProbe;
  });

// ---- the machine and its pile
const prizes = await ev(() => window.__chimp.claw.prizes());
const spec = await ev(() => window.__chimp.claw.spec());
check(prizes.length >= 27, "the machine is stocked", `${prizes.length} prizes`);
check(
  prizes.every((p) => p.at[1] > spec.bedY),
  "every prize is in the bed, none in the chute",
);
check(
  prizes.every((p) => p.asleep),
  "the pile has settled",
);
const roles = await ev(() =>
  ["claw-machine", "claw-gantry", "claw-trolley", "claw-cable", "claw-head", "claw-prong", "claw-joystick", "claw-button", "claw-display", "claw-door"].filter(
    (r) => ![...window.__chimp.scene.meshes, ...window.__chimp.scene.transformNodes].some((n) => n.metadata?.role === r),
  ),
);
check(roles.length === 0, "every moving part carries its role", roles.join(", "));

// ---- the rules: many plays simulated on a copy of the pile, no rendering
const sim = await ev(() => ({
  strongAim: window.__chimp.claw.simulate(16, "aim", 1),
  weakRandom: window.__chimp.claw.simulate(16, "random", 0.45),
  aim: window.__chimp.claw.simulate(24, "aim", null),
}));
console.log("     simulated:", JSON.stringify(sim));
check(sim.strongAim.wins >= 4, "a strong grip on a well-aimed chimp often wins", `${sim.strongAim.wins}/16`);
check(sim.weakRandom.wins <= 2, "a weak grip dropped anywhere rarely wins", `${sim.weakRandom.wins}/16`);
check(sim.aim.wins >= 1 && sim.aim.wins <= 12, "a well-aimed play wins now and then, not every time", `${sim.aim.wins}/24`);
check(sim.aim.slips > 0, "prizes slip out of a weak claw", `${sim.aim.slips} slips`);

// ---- walking up and pressing E
await ev(async () => {
  const c = window.__chimp;
  c.setWalking(true);
  const { stand, look } = c.claw.standPoint();
  const dx = look[0] - stand[0];
  const dz = look[2] - stand[2];
  c.setPose({ x: stand[0], y: stand[1] + 1.6, z: stand[2], yaw: Math.atan2(dx, dz), pitch: 0.25, fov: 1 });
  c.setWalking(false);
  c.setWalking(true);
  await c.settle(10);
});
check(await waitFor(() => window.__chimp.state().clawPrompt === true, null, 5000), "standing at the deck offers the machine");
check((await ev(() => window.__chimp.state().snackPrompt?.action)) !== "use", "and not the snack machine beside it");

// at the snack machine's stand point, looking at it, the claw isn't offered
await ev(async () => {
  const c = window.__chimp;
  const m = c.snacks.machine();
  c.setWalking(false);
  const look = [m.base[0], m.base[1] + 1.1, m.base[2]];
  const eye = [m.stand[0], m.stand[1] + 1.6, m.stand[2]];
  c.setPose({ x: eye[0], y: eye[1], z: eye[2], yaw: Math.atan2(look[0] - eye[0], look[2] - eye[2]), pitch: -Math.atan2(look[1] - eye[1], Math.hypot(look[0] - eye[0], look[2] - eye[2])), fov: 1 });
  c.setWalking(true);
  await c.settle(10);
});
check((await ev(() => window.__chimp.state().snackPrompt?.action)) === "use", "at the snack machine, it is the snack machine that's offered");
check((await ev(() => window.__chimp.state().clawPrompt)) === false, "and not the claw beside it");

// back to the claw's deck
await ev(async () => {
  const c = window.__chimp;
  c.setWalking(false);
  const { stand, look } = c.claw.standPoint();
  c.setPose({ x: stand[0], y: stand[1] + 1.6, z: stand[2], yaw: Math.atan2(look[0] - stand[0], look[2] - stand[2]), pitch: 0.25, fov: 1 });
  c.setWalking(true);
  await c.settle(10);
});
check(await waitFor(() => window.__chimp.state().clawPrompt === true, null, 5000), "back at the claw's deck, the claw is offered again");
await page.screenshot({ path: "captures/claw-play-prompt.png" });
await page.keyboard.press("KeyE");
check(await waitFor(() => window.__chimp.state().focus?.kind === "claw" && window.__chimp.state().focus?.phase === "on", null, 6000), "E steps up to play");
let st = await ev(() => window.__chimp.claw.state());
check(st.phase === "aim" && st.timer > 15, "a play starts with the credit timer running", `${st.phase} ${st.timer.toFixed(1)}s`);

// ---- steering with the keys
const p0 = await ev(() => window.__chimp.claw.pose());
await page.keyboard.down("KeyD");
await page.keyboard.down("KeyW");
await page.waitForTimeout(900);
const lean = await ev(() => window.__chimp.claw.pose());
await page.screenshot({ path: "captures/claw-play-steer.png" });
await page.keyboard.up("KeyD");
await page.keyboard.up("KeyW");
// the swing after the stop: its largest angle off the plumb line, and when it last stood over 1°
const swing = await ev(async () => {
  let peak = 0, last = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    const p = window.__chimp.claw.pose();
    const a = (Math.atan2(Math.hypot(p.swingX, p.swingZ), p.cable) * 180) / Math.PI;
    peak = Math.max(peak, a);
    if (a > 1) last = (performance.now() - t0) / 1000;
    await new Promise((r) => setTimeout(r, 30));
  }
  return { peak, last };
});
console.log(`     swing after the stop: ${swing.peak.toFixed(1)}° at most, under 1° after ${swing.last.toFixed(2)} s`);
check(swing.peak > 0.5 && swing.peak < 9, "the claw swings a little when the trolley stops", `${swing.peak.toFixed(1)}°`);
check(swing.last < 1.6, "and the swing dies out within a second or two", `${swing.last.toFixed(2)} s`);
const p1 = await ev(() => window.__chimp.claw.pose());
check(p1.x > p0.x + 0.05 && p1.z > p0.z + 0.05, "D and W move the claw right and away", `dx ${(p1.x - p0.x).toFixed(3)} dz ${(p1.z - p0.z).toFixed(3)}`);
check(lean.joyX > 0.5 && lean.joyZ > 0.5, "the joystick leans as it is pushed");

// ---- a full play by the keys' hook, aimed at the highest chimp with a strong grip: it should win
// (the steering check's play is ended first: its timer runs out and the claw drops by itself)
await ev(() => window.__chimp.claw.fastTimer(0));
await waitFor(() => window.__chimp.claw.state().phase === "over", null, 40000);
await ev(() => window.__chimp.claw.force(1));
let won = false;
let aimedOnce = false;
let droppedOnce = false;
// the prizes over every attempt: fastest (leaving out falls) and furthest through the glass
const carried = { across: 0, out: 0 };
for (let attempt = 0; attempt < 6 && !won; attempt++) {
  await ev(() => window.__chimp.claw.play());
  await ev(() => window.__chimp.claw.aimAtBest());
  const aimed = await waitFor(() => window.__chimp.claw.state().aimed, null, 18000);
  aimedOnce ||= aimed;
  if (!aimed) {
    console.log(`     attempt ${attempt + 1}: not over the chimp in time`);
    await ev(() => window.__chimp.claw.fastTimer(0));
    await waitFor(() => window.__chimp.claw.state().phase === "over", null, 40000);
    continue;
  }
  await startProbe();
  await page.keyboard.down("Space");
  if (attempt === 0) {
    await page.waitForTimeout(150);
    check((await ev(() => window.__chimp.claw.pose().button)) > 0.9, "the drop button presses down while held");
    await page.screenshot({ path: "captures/claw-play-button.png" });
  }
  await page.keyboard.up("Space");
  const dropped = await waitFor(() => ["drop", "grab", "lift"].includes(window.__chimp.claw.state().phase), null, 3000);
  droppedOnce ||= dropped;
  await waitFor(() => window.__chimp.claw.state().phase === "grab", null, 8000);
  await page.screenshot({ path: "captures/claw-play-grab.png" });
  await waitFor(() => window.__chimp.claw.state().phase === "carry", null, 12000);
  await page.screenshot({ path: "captures/claw-play-carry.png" });
  if (!(await waitFor(() => window.__chimp.claw.state().phase === "over", null, 40000))) console.log("     the play didn't end in time");
  const pr = await stopProbe();
  carried.across = Math.max(carried.across, pr.across);
  carried.out = Math.max(carried.out, pr.out);
  st = await ev(() => window.__chimp.claw.state());
  won = st.inBin.length > 0;
  console.log(`     attempt ${attempt + 1}: ${st.message}`);
}
check(aimedOnce, "the claw can be steered over a chosen prize and held still there");
check(droppedOnce, "Space drops the claw");
check(won, "a strong, well-aimed grab wins a prize: carried to the chute and dropped in, it lands in the chute");
check(carried.out < 0.01, "no prize passes through the glass, carried or let go", `${(carried.out * 100).toFixed(1)} cm out at most`);
check(carried.across < 1.5, "and none is flung: grabbed, carried, dropped and landing", `${carried.across.toFixed(2)} m/s at most, leaving out falls`);
if (won) {
  check(await waitFor(() => window.__chimp.claw.pose().door > 0.9, null, 6000), "the pickup door swings open on the prize");
  await ev(async () => {
    // a look at the pickup door from the player's side
    const c = window.__chimp;
    const { stand, look } = c.claw.standPoint();
    const fx = (stand[0] - look[0]) / Math.hypot(stand[0] - look[0], stand[2] - look[2]);
    const fz = (stand[2] - look[2]) / Math.hypot(stand[0] - look[0], stand[2] - look[2]);
    const door = c.claw.doorAt();
    const eye = [door[0] + fx * 0.62 - fz * 0.12, door[1] + 0.16, door[2] + fz * 0.62 + fx * 0.12];
    const dx = door[0] - eye[0], dy = door[1] - 0.03 - eye[1], dz = door[2] - eye[2];
    c.setPose({ x: eye[0], y: eye[1], z: eye[2], yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)), fov: 0.9 });
    await c.settle(20);
  });
  await page.screenshot({ path: "captures/claw-play-won.png" });
  check((await ev(() => window.__chimp.claw.display())) === "WIN!", "the display says WIN!");
}

// ---- the timer drops the claw by itself (the next play takes the prize from the pickup door first)
await ev(() => window.__chimp.claw.force(null));
const before = (await ev(() => window.__chimp.claw.prizes())).filter((p) => !p.gone).length;
await ev(() => window.__chimp.claw.play());
const after = (await ev(() => window.__chimp.claw.prizes())).filter((p) => !p.gone).length;
if (won) check(after < before, "the won prize is taken from the pickup door when the next play starts", `${before} → ${after}`);
await ev(() => window.__chimp.claw.fastTimer(1.5));
check(await waitFor(() => window.__chimp.claw.state().phase === "drop", null, 5000), "when the timer runs out the claw drops by itself");
check(await waitFor(() => window.__chimp.claw.state().phase === "over", null, 30000), "and the play finishes");

// ---- prizes let go over the chute from all over its mouth, turned every way: each falls through and wins
// (the first is the case seen in play: a pink chimp upside down, off the middle by the front-left glass)
const chuteCases = [
  ["pinkChimp", -0.101, -0.085, [-0.4873, -0.2608, -0.787, 0.2742], "pink chimp upside down by the front-left glass"],
  ["chimp", 0, 0, [0, 0, 0, 1], "chimp upright in the middle"],
  ["chimp", 0.075, 0.01, [0, 0, 0.7071, 0.7071], "chimp lying along the guard"],
  ["king", 0, 0, [0.7071, 0, 0, 0.7071], "King lying across the hole"],
  ["star", 0.07, 0.07, [0.5, 0.5, 0.5, 0.5], "star on edge in the guard's corner"],
  ["banana", -0.06, 0.07, [0.3, 0.2, 0.6, 0.7], "banana tipped over the back of the guard"],
];
const chuteRes = [];
for (const [kind, dx, dz, q, label] of chuteCases) {
  const r = await ev(async ([kind, dx, dz, q]) => {
    const c = window.__chimp.claw;
    const wait = async (f, ms) => {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        if (f()) return true;
        await new Promise((res) => setTimeout(res, 30));
      }
      return false;
    };
    // a play whose claw comes up empty over the chute (the timer drops it there at once); as it opens, the prize is let go
    c.play();
    c.fastTimer(0);
    if (!(await wait(() => c.state().phase === "release", 25000))) return { err: "the play never reached letting go" };
    const b = c.chuteDrop(kind, dx, dz, q);
    if (b < 0) return { err: `no ${kind} in the bed` };
    const bedY = c.spec().bedY;
    const t0 = performance.now();
    let down = -1;
    let out = 0;
    const over = await wait(() => {
      if (down < 0 && c.prizes()[b].at[1] < bedY - 0.08) down = (performance.now() - t0) / 1000;
      out = Math.max(out, c.glassOut());
      return c.state().phase === "over";
    }, 25000);
    const st = c.state();
    return { b, over, down, out, message: st.message, won: st.inBin.includes(b), mouth: st.inMouth };
  }, [kind, dx, dz, q]);
  chuteRes.push(r);
  console.log(`     let go over the chute, ${label}: ${r.err ?? `${r.down >= 0 ? `down the chute in ${r.down.toFixed(2)} s` : "NOT down the chute"}; "${r.message}"`}`);
  if (kind === "pinkChimp" && !r.err) await page.screenshot({ path: "captures/claw-chute-drop.png" });
}
check(chuteRes.every((r) => !r.err && r.down >= 0 && r.down < 4), "every prize let go over the chute falls through it within a few seconds, none wedged", chuteRes.map((r) => (r.down >= 0 ? r.down.toFixed(1) + " s" : "stuck")).join(", "));
check(chuteRes.every((r) => r.over && r.won && /You won/.test(r.message)), "and every one of those plays ends as a win, the prize behind the pickup door");
check(chuteRes.every((r) => r.over && !r.mouth), "no play is called while a prize is still in the chute's mouth");
check(chuteRes.every((r) => (r.out ?? 1) < 0.01), "and none of them passes through the glass on the way", `${(Math.max(...chuteRes.map((r) => r.out ?? 1)) * 100).toFixed(1)} cm out at most`);

// ---- leaving, and the prize taken and restocked
await page.keyboard.press("Escape");
check(await waitFor(() => window.__chimp.state().focus === null && window.__chimp.state().walking, null, 5000), "Esc leaves, walking");
check(await waitFor(() => window.__chimp.claw.prizes().every((p) => !p.gone && p.at[1] > window.__chimp.claw.spec().bedY), null, 15000), "the attendant restocks it into the bed");

// ---- the player's view on a phone-shaped window: the joystick and button still in view
await page.setViewportSize({ width: 390, height: 844 });
await ev(async () => {
  const c = window.__chimp;
  const { stand, look } = c.claw.standPoint();
  c.setPose({ x: stand[0], y: stand[1] + 1.6, z: stand[2], yaw: Math.atan2(look[0] - stand[0], look[2] - stand[2]), pitch: 0.25, fov: 1 });
  c.setWalking(false);
  c.setWalking(true);
  await c.settle(10);
});
await waitFor(() => window.__chimp.state().clawPrompt === true, null, 5000);
await page.keyboard.press("KeyE");
check(await waitFor(() => window.__chimp.state().focus?.kind === "claw" && window.__chimp.state().focus?.phase === "on", null, 6000), "on a phone-shaped window, E steps up to play too");
await page.keyboard.down("KeyA");
await page.waitForTimeout(500);
await page.screenshot({ path: "captures/claw-play-phone.png" });
await page.keyboard.up("KeyA");
await page.keyboard.press("Escape");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await page.setViewportSize({ width: 1600, height: 1000 });

// ---- prizes dropped in deep in one another come apart gently and settle
await ev(() => window.__chimp.claw.jumble(8));
await startProbe();
const t0 = Date.now();
const calm = await waitFor(() => window.__chimp.claw.prizes().every((p) => p.gone || p.asleep), null, 12000);
const calmIn = (Date.now() - t0) / 1000;
const jp = await stopProbe();
check(jp.any < 1.5, "prizes dropped in deep in one another come apart gently", `${jp.any.toFixed(2)} m/s at most`);
check(calm && calmIn < 8, "and settle into a resting pile within a few seconds", calm ? `${calmIn.toFixed(1)} s` : "still moving after 12 s");
check(jp.out < 0.01, "none of them pushed out through the glass", `${(jp.out * 100).toFixed(1)} cm out at most`);
await ev(() => window.__chimp.claw.reset());

// ---- cost at the machine
const info = await ev(async () => {
  await window.__chimp.settle(60);
  return window.__chimp.info();
});
console.log(`     at the machine: ${info.fps} fps, ${info.drawCalls} draw calls`);

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
