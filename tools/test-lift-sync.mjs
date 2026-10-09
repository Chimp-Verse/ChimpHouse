// The lift shared between visitors, through the room server (server/roomServer.ts), against the
// running preview (npm run dev): separate browser contexts are separate visitors.
//   1. one visitor calls the car: another, standing elsewhere, sees the same call, the same
//      car at the same height, and the same music, playing as far into the tune
//   2. a visitor whose computer's clock is 5 s out, arriving later, is told how things stand
//      and sees the car where the others do (the room's clock, not its own)
//   3. the visitor at the lift closes their page: the others let go of them, and the music
//      stops once nobody is at the lift
// Exits non-zero when a check fails.
//   node tools/test-lift-sync.mjs
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:5173";
let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });

/** A visitor: a page of its own, its clock `skew` ms out. */
async function visitor(name, skew = 0) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  if (skew) await page.addInitScript((skew) => { const now = Date.now; Date.now = () => now() + skew; }, skew);
  await page.goto(URL);
  await page.waitForFunction(() => window.__chimp?.lift, null, { timeout: 60000 });
  const ev = (fn, a) => page.evaluate(fn, a);
  return {
    page,
    ev,
    lift: () => ev(() => ({ ...window.__chimp.lift.describe(), nearby: window.__chimp.lift.state().nearby, musicAt: window.__chimp.lift.state().musicAt })),
    /** the car's height on this page and the room's time, at the same moment */
    at: () => ev(() => window.__chimp.lift.describe().height),
    stand: (pose) => ev((p) => window.__chimp.setPose(p), pose),
  };
}

const a = await visitor("A");
// the room keeps the lift as the last visitor left it: start from the beginning
await a.ev(() => window.__chimp.lift.reset());
const b = await visitor("B");
const g = await a.ev(() => {
  const f = window.__chimp.scene.meshes.find((m) => m.name === "Lift car floor").getBoundingInfo().boundingBox.centerWorld;
  return { x: f.x, z: f.z };
});
// A is in the car; B is across the house
await a.stand({ x: g.x, y: 1.6, z: g.z + 0.3, yaw: Math.PI, pitch: 0, fov: 0.9 });
await b.stand({ x: g.x + 12, y: 1.6, z: g.z - 12, yaw: 0, pitch: 0, fov: 0.9 });
await sleep(800);
const start = await b.lift();
check(start.phase === "parked" || start.phase === "open", "both visitors start with the car at rest", JSON.stringify(start.phase));

// 1. A sends the car up from inside: B sees it
await a.ev(() => window.__chimp.lift.ride(2));
await sleep(600);
const [la, lb] = await Promise.all([a.lift(), b.lift()]);
check(lb.pending.includes(2) || lb.dest === 2, "a visitor's press reaches the other visitor", JSON.stringify({ phase: lb.phase, pending: lb.pending, dest: lb.dest }));
check(la.nearby.length === 1 && lb.nearby.length === 1 && la.nearby[0] === lb.nearby[0], "both agree who is at the lift: the visitor in the car, not the one across the house", JSON.stringify({ a: la.nearby, b: lb.nearby }));
await sleep(1000);
const [ma, mb] = await Promise.all([a.lift(), b.lift()]);
check(ma.music && mb.music && ma.musicAt === mb.musicAt, "the music plays for both, from the same moment", JSON.stringify({ a: ma.music, b: mb.music }));

await b.page.waitForFunction(() => window.__chimp.lift.describe().phase === "moving", null, { timeout: 20000 });
await sleep(2000);
const [ha, hb] = await Promise.all([a.at(), b.at()]);
check(Math.abs(ha - hb) < 0.1, "the moving car is at the same height for both", `${ha.toFixed(2)} m and ${hb.toFixed(2)} m`);

// 2. a latecomer whose clock is 5 s fast
const c = await visitor("C", 5000);
await c.stand({ x: g.x - 12, y: 1.6, z: g.z - 12, yaw: 0, pitch: 0, fov: 0.9 });
await sleep(800);
const [hc, ha2, lc] = await Promise.all([c.at(), a.at(), c.lift()]);
check(lc.dest === 2 || lc.floor === 2, "a visitor arriving later is told how things stand", JSON.stringify({ phase: lc.phase, floor: lc.floor, dest: lc.dest }));
check(Math.abs(hc - ha2) < 0.1, "with its clock 5 s out, the latecomer still sees the car where the others do", `${hc.toFixed(2)} m and ${ha2.toFixed(2)} m`);
check(lc.music, "the latecomer hears the music too");

// 3. A closes their page: the others let go of them
await a.page.context().close();
await b.page.waitForFunction(() => window.__chimp.lift.state().nearby.length === 0, null, { timeout: 15000 }).catch(() => {});
const [gb, gc] = await Promise.all([b.lift(), c.lift()]);
check(gb.nearby.length === 0 && gc.nearby.length === 0, "a visitor who leaves is let go of by everyone", JSON.stringify({ b: gb.nearby, c: gc.nearby }));
check(!gb.music && !gc.music, "with nobody left at the lift, its music stops for everyone");

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
