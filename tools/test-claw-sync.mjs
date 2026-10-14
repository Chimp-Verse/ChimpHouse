// The Chimp Claw shared between two visitors (two browser contexts, both at low quality):
// one plays at a time and the other sees it in use; the watcher's claw follows the player's;
// the pile the play leaves is the watcher's pile too; a prize one wins waits behind the pickup
// door for both, the other picks it up and is seen carrying it, puts it down and it lies in the
// same place for both, and is picked up again; leaving, or closing the page, frees the machine.
// Opt-in, as it opens two copies of the house:
//   SHARED=1 URL=http://localhost:5183 node tools/test-claw-sync.mjs
import { chromium } from "playwright";

if (process.env.SHARED !== "1") {
  console.log("Two-visitor check skipped: set SHARED=1 to run it");
  process.exit(0);
}
const URL = process.env.URL ?? "http://localhost:5173";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
// never leave a browser behind: closed on a signal (the lock's timeout) or an error
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => void browser.close().finally(() => process.exit(1)));
process.on("uncaughtException", (e) => {
  console.log("[error]", e.message);
  void browser.close().finally(() => process.exit(1));
});
const open = async (name, w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  await page.goto(`${URL}/?capture=1&quality=low&name=${name}`);
  await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
  return { ctx, page };
};
let failed = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const waitFor = async (page, fn, arg, ms) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
    return true;
  } catch {
    return false;
  }
};
const stepUp = (page) =>
  page.evaluate(async () => {
    const c = window.__chimp;
    c.setWalking(true);
    const { stand, look } = c.claw.standPoint();
    c.setPose({ x: stand[0], y: stand[1] + 1.6, z: stand[2], yaw: Math.atan2(look[0] - stand[0], look[2] - stand[2]), pitch: 0.25, fov: 1 });
    c.setWalking(false);
    c.setWalking(true);
    await c.settle(5);
    return c.claw.use();
  });

const A = await open("Alice", 1000, 640);
await A.page.evaluate(() => {
  window.__chimp.claw.reset();
  window.__chimp.claw.plush.clear();
});
const B = await open("Bruno", 800, 500);
check(await stepUp(A.page), "Alice steps up to play");
check(await waitFor(B.page, () => window.__chimp.claw.playerName() === "Alice", null, 8000), "Bruno sees the machine in use by Alice");
check(!(await stepUp(B.page)), "Bruno can't play while Alice does");

// Alice plays; Bruno's claw follows hers
await A.page.evaluate(() => window.__chimp.claw.aimAtBest());
await waitFor(A.page, () => window.__chimp.claw.state().aimed, null, 20000);
let worst = 0;
for (let i = 0; i < 6; i++) {
  const [a, b] = await Promise.all([A.page.evaluate(() => window.__chimp.claw.pose()), B.page.evaluate(() => window.__chimp.claw.pose())]);
  worst = Math.max(worst, Math.hypot(a.x - b.x, a.z - b.z));
  await A.page.waitForTimeout(250);
}
check(worst < 0.04, "Bruno's claw is where Alice's is", `${(worst * 100).toFixed(1)} cm apart at most`);
await A.page.keyboard.press("Space");
await waitFor(A.page, () => window.__chimp.claw.state().phase === "lift", null, 15000);
const [ca, cb] = await Promise.all([A.page.evaluate(() => window.__chimp.claw.pose()), B.page.evaluate(() => window.__chimp.claw.pose())]);
check(Math.abs(ca.cable - cb.cable) < 0.08, "Bruno sees the claw drop and wind up", `cable ${ca.cable.toFixed(2)} vs ${cb.cable.toFixed(2)}`);
await B.page.screenshot({ path: "captures/claw-sync-watcher.png" });
check(await waitFor(A.page, () => window.__chimp.claw.state().phase === "over", null, 45000), "Alice's play ends");

// the pile Alice's play left is Bruno's too
await A.page.waitForTimeout(2500);
const [pa, pb] = await Promise.all([A.page.evaluate(() => window.__chimp.claw.prizes()), B.page.evaluate(() => window.__chimp.claw.prizes())]);
let off = 0;
pa.forEach((p, i) => {
  if (!p.gone && !pb[i].gone) off = Math.max(off, Math.hypot(p.at[0] - pb[i].at[0], p.at[1] - pb[i].at[1], p.at[2] - pb[i].at[2]));
});
check(off < 0.01, "Bruno's pile is Alice's", `${(off * 100).toFixed(2)} cm at most`);
check(pa.filter((p) => p.gone).length === pb.filter((p) => p.gone).length, "the same prizes are out of play for both");

// leaving frees the machine; closing the page does too
await A.page.evaluate(() => window.__chimp.claw.leave());
check(await waitFor(B.page, () => window.__chimp.claw.playerName() === null, null, 8000), "Alice leaving frees the machine for Bruno");

// ---- a prize Alice wins, picked up by Bruno, carried, put down, picked up again by Alice
const standAt = (page, feet, look) =>
  page.evaluate(
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
const plushes = (page) => page.evaluate(() => window.__chimp.claw.plush.describe());
// a look from a little way off at a point (flying, so walking doesn't move it), for a screenshot
const viewOf = (page, at) =>
  page.evaluate(async (at) => {
    const c = window.__chimp;
    c.setWalking(false);
    c.setPose({ x: at[0] - 1.1, y: at[1] + 0.35, z: at[2] - 1.1, yaw: Math.PI / 4, pitch: 0.22, fov: 1 });
    await c.settle(10);
  }, at);
check(await stepUp(A.page), "Alice plays again");
// a play whose claw comes up empty over the chute (the timer drops it there at once); as it opens, a prize is let go
const won = await A.page.evaluate(async () => {
  const c = window.__chimp.claw;
  const wait = async (f, ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (f()) return true;
      await new Promise((res) => setTimeout(res, 30));
    }
    return false;
  };
  c.fastTimer(0);
  if (!(await wait(() => c.state().phase === "release", 25000))) return -1;
  const b = c.chuteDrop("chimp", 0, 0, [0, 0, 0, 1]);
  await wait(() => c.state().phase === "over", 25000);
  return b;
});
await A.page.evaluate(() => window.__chimp.claw.leave());
check(won >= 0 && (await waitFor(B.page, (b) => window.__chimp.claw.waiting().includes(b), won, 12000)), "Bruno sees the prize Alice won waiting behind the pickup door");
const where = await B.page.evaluate(() => {
  const { stand, look } = window.__chimp.claw.standPoint();
  const L = Math.hypot(stand[0] - look[0], stand[2] - look[2]);
  return { stand, out: [(stand[0] - look[0]) / L, (stand[2] - look[2]) / L], door: window.__chimp.claw.doorAt() };
});
const { door } = where;
await standAt(B.page, [door[0] + where.out[0] * 0.75, where.stand[1], door[2] + where.out[1] * 0.75], door);
check(/^Pick up the /.test((await B.page.evaluate(() => window.__chimp.state().plushPrompt?.label)) ?? ""), "at the pickup door, Bruno is offered it");
await B.page.keyboard.press("KeyE");
check(await waitFor(B.page, () => window.__chimp.claw.plush.describe().held?.phase === "held", null, 3000), "Bruno picks it up");
check(await waitFor(A.page, () => window.__chimp.claw.plush.describe().list.some((p) => p.name === "Bruno" && p.by && p.shown?.tag), null, 5000), "Alice sees Bruno carrying it, his name over it");
check(await waitFor(A.page, (b) => !window.__chimp.claw.waiting().includes(b) && window.__chimp.claw.prizes()[b].gone, won, 5000), "and it's gone from behind the pickup door for her too");
// Bruno walks off with it; Alice sees it go with him
await B.page.evaluate(async (o) => {
  const c = window.__chimp;
  const e = c.scene.activeCamera.position;
  c.setPose({ x: e.x, y: e.y, z: e.z, yaw: Math.atan2(o[0], o[1]), pitch: 0.12, fov: 1 });
  await c.settle(5);
}, where.out);
await B.page.keyboard.down("KeyW");
await B.page.waitForTimeout(800);
await B.page.keyboard.up("KeyW");
await B.page.waitForTimeout(900);
const [heldB, seenA] = await Promise.all([plushes(B.page), plushes(A.page)]);
const carried = seenA.list.find((p) => p.by && p.name === "Bruno");
const lag = carried?.shown && heldB.held ? Math.hypot(...[0, 1, 2].map((i) => carried.shown.at[i] - heldB.held.world[i])) : Infinity;
check(lag < 0.25, "where Bruno carries it, Alice sees it", `${(lag * 100).toFixed(0)} cm from where his page has it`);
if (carried?.shown) {
  await viewOf(A.page, carried.shown.at);
  await A.page.screenshot({ path: "captures/claw-sync-carried.png" });
}
// put down: on the floor, in the same place for both
await B.page.keyboard.press("KeyQ");
const downB = (await plushes(B.page)).list.find((p) => p.by === null && p.name === "Bruno");
check(!!downB, "Bruno puts it down");
check(
  !!downB && (await waitFor(A.page, (at) => window.__chimp.claw.plush.describe().list.some((p) => p.by === null && p.shown && !p.shown.falling && Math.hypot(...[0, 1, 2].map((i) => p.shown.at[i] - at[i])) < 0.01), downB.at, 6000)),
  "Alice sees it on the floor where he put it down",
);
await viewOf(A.page, downB.at);
await A.page.screenshot({ path: "captures/claw-sync-dropped.png" });
// Alice picks it up; Bruno sees her carrying it
const nearA = [downB.at[0] + where.out[0] * 0.7, where.stand[1], downB.at[2] + where.out[1] * 0.7];
await standAt(A.page, nearA, downB.at);
check(/^Pick up the /.test((await A.page.evaluate(() => window.__chimp.state().plushPrompt?.label)) ?? ""), "Alice, looking at it on the floor, is offered it");
await A.page.keyboard.press("KeyE");
check(await waitFor(B.page, () => window.__chimp.claw.plush.describe().list.some((p) => p.name === "Alice" && p.by && p.shown?.tag), null, 5000), "she picks it up, and Bruno sees her carrying it");
await A.page.keyboard.press("KeyQ");
check(await waitFor(B.page, () => window.__chimp.claw.plush.describe().list.some((p) => p.by === null && p.name === "Alice"), null, 5000), "and put down again, it's on the floor for him");
// the attendant's replacement, put in on Bruno's page (he took it while nobody played), is in Alice's machine too
check(await waitFor(A.page, (b) => { const p = window.__chimp.claw.prizes()[b]; return !p.gone && p.at[1] > window.__chimp.claw.spec().bedY; }, won, 15000), "another goes in the machine, for both");
check(await stepUp(B.page), "Bruno steps up to play");
check(await waitFor(A.page, () => window.__chimp.claw.playerName() === "Bruno", null, 8000), "Alice sees Bruno playing");
await B.ctx.close();
check(await waitFor(A.page, () => window.__chimp.claw.playerName() === null, null, 15000), "Bruno's page closing frees the machine");
await A.ctx.close();
await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
