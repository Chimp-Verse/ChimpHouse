// The Chimp Claw shared between two visitors (two browser contexts, both at low quality):
// one plays at a time and the other sees it in use; the watcher's claw follows the player's;
// the pile the play leaves is the watcher's pile too; leaving, or closing the page, frees it.
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
check(await stepUp(B.page), "Bruno steps up to play");
check(await waitFor(A.page, () => window.__chimp.claw.playerName() === "Bruno", null, 8000), "Alice sees Bruno playing");
await B.ctx.close();
check(await waitFor(A.page, () => window.__chimp.claw.playerName() === null, null, 15000), "Bruno's page closing frees the machine");
await A.ctx.close();
await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
