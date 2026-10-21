// What watching costs: one visitor (Bo) stands in the Game Room's middle with six cabinets in view, and 0, 1, 3, 4 or 6 of them in use (six is as many as one view can hold: the rows face each other, so the others are edge-on)
// by visitors whose games he watches live (one real player, Ann, plays slot 3; the other seats are made-up visitors following her, so
// every spectator frame shows her one game, as arcade.testSeats does for tests/test-arcade-watch.mjs). For each count it reports his page's
// frame rate and frame times over a few seconds, and the browser's memory (all its processes: the page, the graphics process, and
// one process per cross-origin game frame).
//   node tools/measure-arcade-watch.mjs [counts]     (default "0,1,3,4,6"; QUALITY=high|medium|low, URL=http://localhost:5173, SECONDS=6)
// The stand-in game is a light page; a real game costs the same in the house and more in its own frame. Adaptive sharpness is turned off
// (?adaptive=0) so that the number of live screens is the quality's own.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = process.env.URL ?? "http://localhost:5173";
const QUALITY = process.env.QUALITY ?? "high";
const SECONDS = Number(process.env.SECONDS ?? 6);
const COUNTS = (process.argv[2] ?? "0,1,3,4,6").split(",").map(Number);
const ORDER = [3, 7, 6, 2, 5, 4];
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const rssMb = () => {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" }).trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid, rss] of rows) kids.set(pid, { ppid, rss });
  const root = process.pid; // (the browser is this script's child)
  let sum = 0;
  let n = 0;
  for (const [pid, k] of kids) {
    let p = pid;
    while (p && p !== root && kids.has(p)) p = kids.get(p).ppid;
    if (p === root && pid !== root) (sum += k.rss), n++;
  }
  return { mb: Math.round(sum / 1024), processes: n };
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  async function visitor(name) {
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
    await page.addInitScript(() => {
      Element.prototype.requestPointerLock = function () {};
      Element.prototype.requestFullscreen = async function () {};
    });
    await page.goto(`${BASE}/?pov=first&view=game&arcade=standin&name=${name}&quality=${QUALITY}&adaptive=0`);
    await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 200 });
    await page.evaluate(() => window.__chimp.arcade.ready());
    await page.evaluate(() => window.__chimp.settle(20));
    return page;
  }
  const ann = await visitor("Ann");
  const bo = await visitor("Bo");
  // Ann plays slot 3
  await ann.evaluate(async () => {
    const c = window.__chimp;
    const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === 3);
    const V = node.position.constructor;
    const at = V.TransformCoordinates(new V(0, 1.6, -1.0), node.computeWorldMatrix(true));
    c.setWalking(false);
    c.setPose({ x: at.x, y: at.y, z: at.z, yaw: 0, pitch: 0, fov: 1.1 });
    c.setWalking(true);
    await c.settle(10);
  });
  await ann.waitForFunction(() => window.__chimp.state().arcadePrompt?.slot === 3, null, { timeout: 8000 });
  await ann.keyboard.press("KeyE");
  await ann.waitForFunction(() => window.__chimp.arcade.seats().some((s) => s.slot === 3 && s.ready), null, { timeout: 30000 });
  for (let round = 0; round < 5; round++) {
    for (const k of ["KeyW", "KeyA", "KeyD"]) await ann.keyboard.press(k);
    await ann.waitForTimeout(150);
  }
  // the stand-in keeps one session per game: every cabinet's spectators are given Ann's game, to find her in
  await bo.evaluate(() => {
    const a = window.__chimp.arcade;
    const mine = a.entries().find((g) => g.gameId === a.seats().find((s) => s.slot === 3).gameId);
    const game = new URL(mine.playUrl).searchParams.get("game");
    a.setGames(a.entries().map((g) => ({ ...g, playUrl: Object.assign(new URL(g.playUrl), { search: new URLSearchParams([...new URL(g.playUrl).searchParams].map(([k, v]) => [k, k === "game" ? game : v])).toString() }).href })));
  });
  console.log(`quality ${QUALITY}, ${await bo.evaluate(() => `${innerWidth}x${innerHeight}`)} page, adaptive sharpness off`);
  console.log("live  fps   mean ms  p95 ms  max ms   browser MB (processes)   widths");
  for (const count of COUNTS) {
    const seats = ORDER.slice(0, count);
    // the made-up visitors (never slot 3: Ann is really there), and the view: all eight in sight, or turned away from all for 0
    await bo.evaluate(
      async ([seats, count]) => {
        const c = window.__chimp;
        c.arcade.testSeats([1, 2, 4, 5, 6, 7, 8].map((slot) => ({ slot, name: seats.includes(slot) ? "Ann" : null })));
        c.setWalking(false);
        c.setPose({ x: 9, y: 1.6, z: 6.6, yaw: count === 0 ? -Math.PI / 2 : Math.PI / 2, pitch: 0, fov: 1.9 });
        c.setWalking(true);
        await c.settle(10);
      },
      [seats, count],
    );
    if (count) await bo.waitForFunction((n) => window.__chimp.arcade.watched().filter((w) => w.state === "live" && w.view === "over").length === n, count, { timeout: 90000, polling: 100 });
    else await bo.waitForFunction(() => window.__chimp.arcade.watched().length === 0, null, { timeout: 15000, polling: 100 });
    await bo.evaluate(() => window.__chimp.settle(60));
    const m = await bo.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const dts = [];
          let last = performance.now();
          const start = last;
          const tick = (t) => {
            dts.push(t - last);
            last = t;
            if (t - start < ms) requestAnimationFrame(tick);
            else {
              dts.shift();
              const sorted = [...dts].sort((a, b) => a - b);
              resolve({ fps: dts.length / ((t - start) / 1000), mean: dts.reduce((a, b) => a + b, 0) / dts.length, p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1] });
            }
          };
          requestAnimationFrame(tick);
        }),
      SECONDS * 1000,
    );
    const mem = rssMb();
    const widths = await bo.evaluate(() => [...document.querySelectorAll("iframe.play-frame.watched")].filter((f) => f.style.visibility === "visible").map((f) => parseFloat(f.style.width)).sort((a, b) => b - a).join(","));
    console.log(`${String(count).padStart(4)}  ${m.fps.toFixed(1).padStart(4)}  ${m.mean.toFixed(1).padStart(7)}  ${m.p95.toFixed(1).padStart(6)}  ${m.max.toFixed(1).padStart(6)}   ${String(mem.mb).padStart(9)} (${mem.processes})   ${widths}`);
  }
} finally {
  await browser.close();
}
