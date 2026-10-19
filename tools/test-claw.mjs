// Browser test of the Chimp Claw (engine/clawMachine.ts, clawRules.ts, clawPhysics.ts):
// the machine found by role and its pile settled, the odds of its rules over many simulated
// plays, walking up and pressing E, steering with the keys, dropping, a won prize carried to the
// chute and dropped in (never through the glass, never flung) and coming out of the pickup door,
// the views while playing (V and 1–4: gliding there, the machine in frame, the keys steering the way
// each looks), the timer dropping by itself, leaving with Esc, the prize picked up at the pickup
// door with E, held and turned (T), carried, put down (Q) on the floor and picked up again, never
// inside the machine, the attendant restocking, the floor's limit, and prizes dropped in deep in
// one another coming apart gently and settling.
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
await page.goto(`${URL}/?pov=first&capture=1`);
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
// from the machine as it opens: the room keeps the last pile, so a fresh one for everyone
await page.evaluate(() => {
  window.__chimp.claw.reset();
  window.__chimp.claw.plush.clear();
});

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
// a strong aimed grab wins about one play in three (the simulated odds above), so up to ten tries: all ten miss about 2% of the time
for (let attempt = 0; attempt < 10 && !won; attempt++) {
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

// ---- the next play: the prize waits behind the pickup door for whoever picks it up
await ev(() => window.__chimp.claw.force(null));
const waitingBefore = await ev(() => window.__chimp.claw.waiting());
await ev(() => window.__chimp.claw.play());
if (won) check((await ev(() => window.__chimp.claw.waiting())).length === waitingBefore.length && waitingBefore.length > 0, "the won prize waits behind the pickup door through the next play", `${waitingBefore.length} waiting`);

// ---- the views while playing: V steps through them, 1–4 pick one; each glides there, holds the machine, and the keys steer the way it looks
const glideTo = async (key) => {
  const r = await ev(async (key) => {
    const c = window.__chimp;
    const cam = c.scene.activeCamera;
    const track = [];
    let on = true;
    // the page's longest frame and longest task (main thread busy over 50 ms) while it changes view
    let frame = 0;
    const tasks = [];
    const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => tasks.push(e.duration)));
    obs.observe({ entryTypes: ["longtask"] });
    const tick = (t) => {
      if (!on) return;
      if (track.length) frame = Math.max(frame, t - track[track.length - 1][4]);
      track.push([...cam.position.asArray(), performance.now(), t]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const k0 = performance.now();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: key, key: key.replace("Key", "").replace("Digit", "").toLowerCase() }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: key }));
    const press = performance.now() - k0;
    await new Promise((res) => setTimeout(res, 1100));
    on = false;
    obs.disconnect();
    let step = 0;
    let moving = 0;
    let t0 = Infinity;
    let t1 = 0;
    for (let i = 1; i < track.length; i++) {
      const d = Math.hypot(track[i][0] - track[i - 1][0], track[i][1] - track[i - 1][1], track[i][2] - track[i - 1][2]);
      step = Math.max(step, d);
      if (d > 1e-4) {
        moving++;
        t0 = Math.min(t0, track[i - 1][3]);
        t1 = Math.max(t1, track[i][3]);
      }
    }
    const a = track[0];
    const b = track[track.length - 1];
    return { view: c.claw.view(), press, frame, task: Math.max(0, ...tasks), step, moving, secs: (t1 - t0) / 1000, frames: track.length, dist: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), inView: c.claw.inView() };
  }, key);
  return r;
};
const steer = async (key) => {
  const p0 = await ev(() => window.__chimp.claw.pose());
  await page.keyboard.down(key);
  await page.waitForTimeout(450);
  await page.keyboard.up(key);
  await page.waitForTimeout(350);
  const p1 = await ev(() => window.__chimp.claw.pose());
  return [p1.x - p0.x, p1.z - p0.z];
};
// the claw to the middle first, so steering every way has room (and no longer steering itself onto the chimp aimed at above)
await ev(() => window.__chimp.claw.unaim());
await ev(() => window.__chimp.claw.drive({ x: 1, z: 1, drop: false }));
await waitFor(() => window.__chimp.claw.pose().x > -0.02 && window.__chimp.claw.pose().z > -0.02, null, 4000);
await ev(() => window.__chimp.claw.drive(null));
await page.waitForTimeout(600);
const views = [];
for (const key of ["KeyV", "KeyV", "KeyV", "Digit1"]) {
  const r = await glideTo(key);
  views.push(r);
  await page.screenshot({ path: `captures/claw-view-${r.view}.png` });
  r.w = await steer("KeyW");
  r.d = await steer("KeyD");
  console.log(`     ${key} → ${r.view}: moved ${r.dist.toFixed(2)} m in ${r.secs.toFixed(2)} s over ${r.moving} frames (${(r.step * 100).toFixed(1)} cm at most in one), machine in frame ${(r.inView * 100).toFixed(0)}%; W moves (${r.w.map((v) => v.toFixed(2)).join(", ")}), D (${r.d.map((v) => v.toFixed(2)).join(", ")})`);
}
check(views.map((r) => r.view).join(" ") === "close left right panel", "V steps through the views, 1 picks the panel view", views.map((r) => r.view).join(" → "));
check(views.every((r) => r.press < 100 && r.task < 150), "no change of view stalls the page, the first of the page's either (the key's work under 100 ms, no task over 150 ms)", views.map((r) => `${r.view}: key ${r.press.toFixed(0)} ms, task ${r.task.toFixed(0)} ms, frame ${r.frame.toFixed(0)} ms`).join("; "));
check(views.every((r) => r.dist > 0.1 && r.secs > 0.35 && r.moving >= 4 && r.step < r.dist * 0.4), "each change of view glides there, no jump", views.map((r) => `${r.secs.toFixed(2)} s, ${r.moving} frames, ${Math.round((r.step / r.dist) * 100)}% in one at most`).join("; "));
check(views.every((r) => r.inView === 1), "the machine's bed and the claw's travel are in frame in every view");
const [vClose, vLeft, vRight, vPanel] = views;
const away = (r, ax, sign) => r.w[ax] * sign > 0.03 && Math.abs(r.w[1 - ax]) < 0.01;
check(away(vPanel, 1, 1) && away(vClose, 1, 1), "from the front, W steers the claw away (to the back)");
check(away(vLeft, 0, 1) && away(vRight, 0, -1), "from either side, W steers the claw away from the eye too (across the machine)", `left (${vLeft.w.map((v) => v.toFixed(2))}), right (${vRight.w.map((v) => v.toFixed(2))})`);
check(vLeft.d[1] < -0.03 && vRight.d[1] > 0.03, "and D steers it to the screen's right", `left (${vLeft.d.map((v) => v.toFixed(2))}), right (${vRight.d.map((v) => v.toFixed(2))})`);

// ---- the timer drops the claw by itself
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
    // won: behind the pickup door, or set out on the floor in front of it (more than three waiting)
    await wait(() => c.waiting().includes(b) || c.plush.describe().list.some((p) => p.from?.b === b), 4000);
    const won = c.waiting().includes(b) || c.plush.describe().list.some((p) => p.from?.b === b);
    return { b, over, down, out, message: st.message, won, mouth: st.inMouth };
  }, [kind, dx, dz, q]);
  chuteRes.push(r);
  console.log(`     let go over the chute, ${label}: ${r.err ?? `${r.down >= 0 ? `down the chute in ${r.down.toFixed(2)} s` : "NOT down the chute"}; "${r.message}"`}`);
  if (kind === "pinkChimp" && !r.err) await page.screenshot({ path: "captures/claw-chute-drop.png" });
}
check(chuteRes.every((r) => !r.err && r.down >= 0 && r.down < 4), "every prize let go over the chute falls through it within a few seconds, none wedged", chuteRes.map((r) => (r.down >= 0 ? r.down.toFixed(1) + " s" : "stuck")).join(", "));
check(chuteRes.every((r) => r.over && r.won && /You won/.test(r.message)), "and every one of those plays ends as a win, the prize behind the pickup door");
check(chuteRes.every((r) => r.over && !r.mouth), "no play is called while a prize is still in the chute's mouth");
check(chuteRes.every((r) => (r.out ?? 1) < 0.01), "and none of them passes through the glass on the way", `${(Math.max(...chuteRes.map((r) => r.out ?? 1)) * 100).toFixed(1)} cm out at most`);
const setOut = await ev(() => ({ waiting: window.__chimp.claw.waiting().length, out: window.__chimp.claw.plush.describe().list.filter((p) => p.by === null && p.from).length }));
check(setOut.waiting <= 3 && setOut.waiting + setOut.out >= chuteRes.length, "the pickup door keeps three waiting: the oldest of more are set out on the floor in front of it", `${setOut.waiting} waiting, ${setOut.out} set out`);

// ---- leaving
await page.keyboard.press("Escape");
check(await waitFor(() => window.__chimp.state().focus === null && window.__chimp.state().walking, null, 5000), "Esc leaves, walking");

// ---- the prize picked up at the pickup door, held, turned, carried, put down and picked up again
const standAt = (feet, look) =>
  ev(
    async ([f, t]) => {
      const c = window.__chimp;
      c.setWalking(false);
      c.setPose({ x: f[0], y: f[1] + 1.6, z: f[2], yaw: 0, pitch: 0, fov: 1 });
      c.setWalking(true);
      await c.settle(5);
      const e = c.scene.activeCamera.position;
      const dx = t[0] - e.x, dy = t[1] - e.y, dz = t[2] - e.z;
      c.setPose({ x: e.x, y: e.y, z: e.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)), fov: 1 });
      await c.settle(8);
    },
    [feet, look],
  );
const lookAt = (t) =>
  ev(async (t) => {
    const c = window.__chimp;
    const e = c.scene.activeCamera.position;
    const dx = t[0] - e.x, dy = t[1] - e.y, dz = t[2] - e.z;
    c.setPose({ x: e.x, y: e.y, z: e.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)), fov: 1 });
    await c.settle(8);
  }, t);
const front = await ev(() => {
  const { stand, look } = window.__chimp.claw.standPoint();
  const L = Math.hypot(stand[0] - look[0], stand[2] - look[2]);
  return { stand, out: [(stand[0] - look[0]) / L, (stand[2] - look[2]) / L], door: window.__chimp.claw.doorAt() };
});
const { door } = front;
// standing in front of the pickup door (clear of the plushes set out there), looking at it
await standAt([door[0] + front.out[0] * 0.75 - front.out[1] * 0.25, front.stand[1], door[2] + front.out[1] * 0.75 + front.out[0] * 0.25], door);
const waitingNow = await ev(() => window.__chimp.claw.waiting());
const atDoor = await ev(() => ({ prompt: window.__chimp.state().plushPrompt, claw: window.__chimp.state().clawPrompt }));
check(waitingNow.length > 0 && /^Pick up the /.test(atDoor.prompt?.label ?? ""), "looking at the pickup door with a prize behind it offers it: E picks it up", atDoor.prompt ? `${atDoor.prompt.label}, ${atDoor.prompt.sub}` : "no prompt");
check(atDoor.claw === false, "and not the machine's play at the same time");
await page.keyboard.press("KeyE");
check(await waitFor(() => window.__chimp.claw.plush.describe().held?.phase === "held", null, 3000), "E takes it out into your hand");
const taken = waitingNow[0];
const inHand = await ev(() => ({ held: window.__chimp.claw.plush.describe().held, hud: window.__chimp.state().plushHeld, waiting: window.__chimp.claw.waiting(), gone: window.__chimp.claw.prizes().map((p) => p.gone) }));
check(inHand.gone[taken] && !inHand.waiting.includes(taken), "it is out of the machine");
check(!!inHand.held?.enabled && inHand.held.local[0] < -0.05 && inHand.held.local[1] < -0.05 && inHand.held.local[2] > 0.2, "it shows in front of you, low on the left, as a thing held does", inHand.held.local.map((v) => v.toFixed(2)).join(", "));
check(!!inHand.hud?.name, "and the HUD names it, with its keys", inHand.hud?.name);
// looking ahead, away from the machine
await ev(async (o) => {
  const c = window.__chimp;
  const e = c.scene.activeCamera.position;
  c.setPose({ x: e.x, y: e.y, z: e.z, yaw: Math.atan2(o[0], o[1]), pitch: 0.12, fov: 1 });
  await c.settle(10);
}, front.out);
await page.screenshot({ path: "captures/claw-plush-held.png" });
// held up to look at, turned with the mouse
await page.mouse.move(800, 500);
await page.keyboard.down("KeyT");
for (let i = 1; i <= 12; i++) await page.mouse.move(800 + i * 14, 500 + i * 3);
await page.waitForTimeout(600);
const turned = await ev(() => ({ held: window.__chimp.claw.plush.describe().held, hud: window.__chimp.state().plushHeld }));
await page.screenshot({ path: "captures/claw-plush-look.png" });
await page.keyboard.up("KeyT");
await page.waitForTimeout(500);
const after = await ev(() => window.__chimp.claw.plush.describe().held);
check(turned.hud?.turning && turned.held.look > 0.9 && Math.abs(turned.held.local[0]) < 0.05, "holding T brings it up in front of you", turned.held.local.map((v) => v.toFixed(2)).join(", "));
check(Math.abs(turned.held.turn[3]) < 0.99, "and moving the mouse turns it about", `turn w ${turned.held.turn[3].toFixed(2)}`);
check(after.look < 0.2 && Math.abs(after.turn[3] - turned.held.turn[3]) < 1e-6, "letting go of T, it goes back to your hand, still turned");
// carried about
const feet0 = await ev(() => window.__chimp.scene.activeCamera.position.asArray());
await page.keyboard.down("KeyW");
await page.waitForTimeout(900);
await page.keyboard.up("KeyW");
await page.waitForTimeout(300);
const feet1 = await ev(() => window.__chimp.scene.activeCamera.position.asArray());
const walked = Math.hypot(feet1[0] - feet0[0], feet1[2] - feet0[2]);
check(walked > 0.5 && (await ev(() => window.__chimp.claw.plush.describe().held?.enabled)), "you walk about with it", `${walked.toFixed(1)} m`);
// put down: on the floor in front of you
const before = await ev(() => {
  const c = window.__chimp;
  const cam = c.scene.activeCamera;
  const d = cam.getForwardRay(1).direction;
  const l = Math.hypot(d.x, d.z);
  // the floor under the walker (its eyes are the chimp's, not a person's 1.55 m up)
  return { eye: cam.position.asArray(), fwd: [d.x / l, d.z / l], floor: c.walker().feet.y };
});
await page.keyboard.press("KeyQ");
const down = await ev(() => window.__chimp.claw.plush.describe());
const dropped = down.list.find((p) => p.name !== "the attendant" && p.by === null);
const floorY = before.floor;
const off = dropped ? [dropped.at[0] - before.eye[0], dropped.at[2] - before.eye[2]] : [0, 0];
check(!down.held && !!dropped, "Q puts it down", dropped ? `${dropped.kind} at ${dropped.at.map((v) => v.toFixed(2)).join(", ")}` : "nothing on the floor");
if (dropped) {
  check(Math.abs(dropped.at[1] - floorY) < 0.2, "on the floor", `centre ${((dropped.at[1] - floorY) * 100).toFixed(0)} cm above it`);
  check(Math.hypot(...off) < 1 && off[0] * before.fwd[0] + off[1] * before.fwd[1] > 0.1, "in front of you", `${Math.hypot(...off).toFixed(2)} m off`);
  check(await waitFor((id) => window.__chimp.claw.plush.describe().list.find((p) => p.id === id)?.shown?.falling === false, dropped.id, 5000), "it falls there and comes to rest");
  await lookAt(dropped.at);
  await page.screenshot({ path: "captures/claw-plush-dropped.png" });
  // it isn't solid: standing where it lies, on the floor
  await standAt(dropped.at, [dropped.at[0] + 1, dropped.at[1] + 1.5, dropped.at[2]]);
  const onIt = await ev(() => window.__chimp.scene.activeCamera.position.asArray());
  check(Math.hypot(onIt[0] - dropped.at[0], onIt[2] - dropped.at[2]) < 0.15 && onIt[1] < floorY + 1.62, "it isn't solid: you can stand where it lies", `eye ${(onIt[1] - floorY).toFixed(2)} m over the floor, ${(Math.hypot(onIt[0] - dropped.at[0], onIt[2] - dropped.at[2]) * 100).toFixed(0)} cm off it`);
  await lookAt(dropped.at);
  const prompt = await ev(() => window.__chimp.state().plushPrompt);
  check(/^Pick up the /.test(prompt?.label ?? ""), "looking at it, E picks it up again", prompt?.label);
  await page.keyboard.press("KeyE");
  check(await waitFor(() => window.__chimp.claw.plush.describe().held?.phase === "held", null, 3000), "and it is in your hand again");
}
check(await waitFor((b) => { const p = window.__chimp.claw.prizes()[b]; return !p.gone && p.at[1] > window.__chimp.claw.spec().bedY; }, taken, 15000), "the attendant puts another in the machine");
// put down facing the machine at its deck: it lands in front of the machine, not inside it
await standAt(front.stand, await ev(() => window.__chimp.claw.standPoint().look));
await page.keyboard.press("KeyQ");
const atMachine = await ev(() => {
  const c = window.__chimp;
  const p = c.claw.plush.describe().list.filter((p) => p.by === null).sort((a, b) => b.t - a.t)[0];
  return { local: c.claw.toLocal(p.at), outer: c.claw.spec().outer };
});
check(atMachine.local[2] < atMachine.outer[4] - 0.05, "put down facing the machine, it lands on the floor in front of it, not inside", `${((atMachine.outer[4] - atMachine.local[2]) * 100).toFixed(0)} cm in front`);
// ---- the room keeps the newest 20 put down
await ev(() => window.__chimp.claw.plush.clear());
const ids = await ev((at) => window.__chimp.claw.plush.scatter(24, at[0] - 1.5, at[1], at[2] - 1.5), [before.eye[0], before.floor, before.eye[2]]);
const kept = await ev(() => window.__chimp.claw.plush.describe().list.filter((p) => p.by === null));
check(kept.length === 20 && ids.slice(-20).every((id) => kept.some((p) => p.id === id)), "the room keeps the 20 plushes put down last, the oldest go", `${kept.length} on the floor`);
await ev(() => window.__chimp.claw.plush.clear());

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
const phoneViews = [];
for (const key of ["Digit2", "Digit3", "Digit4", "Digit1"]) {
  const r = await glideTo(key);
  phoneViews.push(r);
  await page.screenshot({ path: `captures/claw-view-phone-${r.view}.png` });
}
// the other eight ways between two views (the four above went panel→close→left→right→panel), on the phone-shaped window,
// between plays (so the claw dropping by itself when the timer runs out isn't timed with them)
await ev(() => window.__chimp.claw.fastTimer(0));
await waitFor(() => window.__chimp.claw.state().phase === "over", null, 40000);
await page.waitForTimeout(1500);
const pairs = [];
for (const key of ["Digit3", "Digit2", "Digit4", "Digit3", "Digit1", "Digit4", "Digit2", "Digit1"]) {
  const from = await ev(() => window.__chimp.claw.view());
  const r = await glideTo(key);
  pairs.push(`${from}→${r.view} key ${r.press.toFixed(0)} ms, task ${r.task.toFixed(0)} ms`);
  r.ok = r.press < 100 && r.task < 150;
  pairs.ok = (pairs.ok ?? true) && r.ok;
}
check(pairs.ok, "nor any other change between two views, either way", pairs.join(", "));
check(phoneViews.every((r) => r.press < 100 && r.task < 150), "nor on a phone-shaped window, its views worked out afresh", phoneViews.map((r) => `${r.view}: key ${r.press.toFixed(0)} ms, task ${r.task.toFixed(0)} ms`).join("; "));
check(phoneViews.every((r) => r.inView === 1), "on a phone-shaped window every view still holds the machine's bed and the claw's travel", phoneViews.map((r) => `${r.view} ${(r.inView * 100).toFixed(0)}%`).join(", "));
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
