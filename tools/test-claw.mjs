// Browser test of the Chimp Claw (engine/clawMachine.ts, clawRules.ts, clawPhysics.ts):
// the machine found by role and its pile settled, the odds of its rules over many simulated
// plays, walking up and pressing E, steering with the keys, dropping, a won prize coming out
// of the pickup door, the timer dropping by itself, leaving with Esc, and restocking.
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

// ---- the machine and its pile
const prizes = await ev(() => window.__chimp.claw.prizes());
const spec = await ev(() => window.__chimp.claw.spec());
check(prizes.length >= 18, "the machine is stocked", `${prizes.length} prizes`);
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
check(sim.strongAim.wins >= 6, "a strong grip on a well-aimed chimp usually wins", `${sim.strongAim.wins}/16`);
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
await page.waitForTimeout(600);
const p1 = await ev(() => window.__chimp.claw.pose());
check(p1.x > p0.x + 0.05 && p1.z > p0.z + 0.05, "D and W move the claw right and away", `dx ${(p1.x - p0.x).toFixed(3)} dz ${(p1.z - p0.z).toFixed(3)}`);
check(lean.joyX > 0.5 && lean.joyZ > 0.5, "the joystick leans as it is pushed");
check(Math.hypot(p1.swingX, p1.swingZ) > 0.0005 || Math.hypot(lean.swingX, lean.swingZ) > 0.0005, "the claw swings on its cable as the trolley moves");

// ---- a full play by the keys' hook, aimed at the highest chimp with a strong grip: it should win
// (the steering check's play is ended first: its timer runs out and the claw drops by itself)
await ev(() => window.__chimp.claw.fastTimer(0));
await waitFor(() => window.__chimp.claw.state().phase === "over", null, 40000);
await ev(() => window.__chimp.claw.force(1));
let won = false;
let aimedOnce = false;
let droppedOnce = false;
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
  await page.keyboard.press("Space");
  const dropped = await waitFor(() => ["drop", "grab", "lift"].includes(window.__chimp.claw.state().phase), null, 3000);
  droppedOnce ||= dropped;
  await waitFor(() => window.__chimp.claw.state().phase === "grab", null, 8000);
  await page.screenshot({ path: "captures/claw-play-grab.png" });
  await waitFor(() => window.__chimp.claw.state().phase === "carry", null, 12000);
  await page.screenshot({ path: "captures/claw-play-carry.png" });
  if (!(await waitFor(() => window.__chimp.claw.state().phase === "over", null, 40000))) console.log("     the play didn't end in time");
  st = await ev(() => window.__chimp.claw.state());
  won = st.inBin.length > 0;
  console.log(`     attempt ${attempt + 1}: ${st.message}`);
}
check(aimedOnce, "the claw can be steered over a chosen prize and held still there");
check(droppedOnce, "Space drops the claw");
check(won, "a strong, well-aimed grab wins a prize");
if (won) {
  check(await waitFor(() => window.__chimp.claw.pose().door > 0.9, null, 6000), "the pickup door swings open on the prize");
  await ev(async () => {
    // a look at the pickup door from the player's side
    const c = window.__chimp;
    const { stand, look } = c.claw.standPoint();
    const fx = (stand[0] - look[0]) / Math.hypot(stand[0] - look[0], stand[2] - look[2]);
    const fz = (stand[2] - look[2]) / Math.hypot(stand[0] - look[0], stand[2] - look[2]);
    const door = c.claw.doorAt();
    const eye = [door[0] + fx * 0.75 - fz * 0.25, door[1] + 0.45, door[2] + fz * 0.75 + fx * 0.25];
    const dx = door[0] - eye[0], dy = door[1] + 0.1 - eye[1], dz = door[2] - eye[2];
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

// ---- leaving, and the prize taken and restocked
await page.keyboard.press("Escape");
check(await waitFor(() => window.__chimp.state().focus === null && window.__chimp.state().walking, null, 5000), "Esc leaves, walking");
check(await waitFor(() => window.__chimp.claw.prizes().every((p) => !p.gone && p.at[1] > window.__chimp.claw.spec().bedY), null, 15000), "the attendant restocks it into the bed");

// ---- cost at the machine
const info = await ev(async () => {
  await window.__chimp.settle(60);
  return window.__chimp.info();
});
console.log(`     at the machine: ${info.fps} fps, ${info.drawCalls} draw calls`);

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
