// Screenshots of the claw machine: from a walker's eye 2.5 m off, close on its details, at night.
//   URL=http://localhost:5183 node tools/shoot-claw.mjs [out-prefix] [shots...]
// Shots: front, close, deck, inside, night (default all). Each is saved as <out-prefix>-<shot>.png.
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:5173";
const [, , prefix = "captures/claw", ...want] = process.argv;
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("crash", () => console.log("[crash] the page crashed"));
const t0 = Date.now();
const stamp = (what) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${what}`);
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log(`[${m.type()}]`, m.text()));
await page.goto(`${URL}/?capture=1`);
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
stamp("ready");

/** A pose looking at a point of the machine (its own frame) from `back` metres in front of it, eye at `eye`, `side` metres to its right. */
const shots = {
  front: { back: 2.5, eye: 1.6, side: 0.0, look: [0, 1.25, 0], fov: 1.05 },
  close: { back: 1.1, eye: 1.55, side: 0.25, look: [0, 1.3, 0], fov: 0.9 },
  deck: { back: 0.55, eye: 1.3, side: -0.05, look: [0, 0.85, -0.4], fov: 0.95 },
  inside: { back: 0.75, eye: 1.62, side: 0, look: [0, 1.1, 0.05], fov: 0.95 },
  night: { back: 2.5, eye: 1.6, side: 0.4, look: [0, 1.25, 0], fov: 1.05, night: true },
};
for (const name of want.length ? want : Object.keys(shots)) {
  const s = shots[name];
  const info = await page.evaluate(async (s) => {
    const c = window.__chimp;
    c.setNight(!!s.night);
    const { at, yaw } = c.claw.root();
    // the machine's frame: its front is -Z turned by yaw
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const L = (p) => [at[0] + p[0] * rx - p[2] * fx, at[1] + p[1], at[2] + p[0] * rz - p[2] * fz];
    const eye = [at[0] + fx * s.back + rx * s.side, at[1] + s.eye, at[2] + fz * s.back + rz * s.side];
    const look = L(s.look);
    const dx = look[0] - eye[0], dy = look[1] - eye[1], dz = look[2] - eye[2];
    c.setPose({ x: eye[0], y: eye[1], z: eye[2], yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)), fov: s.fov });
    await c.settle(5);
    await c.whenReady();
    await c.settle(30);
    return c.info();
  }, s);
  await page.screenshot({ path: `${prefix}-${name}.png` });
  stamp(name);
  console.log(name, JSON.stringify({ fps: info.fps, drawCalls: info.drawCalls }));
}
await browser.close();
