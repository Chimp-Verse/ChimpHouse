// The Game Room's snack machine, CHIMP CHOMP, in a real browser against the running preview
// (npm run dev). With SHOTS=1 it only takes the look's screenshots.
// Screenshots: captures/snack-*.png. Exits non-zero when a check fails.
//   URL=http://localhost:5185 node tools/test-snack.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
await mkdir("captures", { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && !/\/chimpvibe\/|403|404/.test(m.text()) && console.log("[browser error]", m.text().slice(0, 300)));
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (n = 30) => ev((k) => window.__chimp.settle(k), n);
const shot = (name) => page.screenshot({ path: `captures/snack-${name}.png` });

await page.goto(`${URL}/?capture=1&view=entry`);
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 200 });
await ev(() => window.__chimp.whenReady());

/** A camera `back` metres in front of the machine at height `y`, `side` metres to its right, looking at a point on it. */
const view = (back, y, side = 0, lookY = 1.0, lookSide = 0, fov = 0.9) =>
  ev(
    ([back, y, side, lookY, lookSide, fov]) => {
      const m = window.__chimp.snacks.machine();
      const [bx, by, bz] = m.base;
      const [fx, , fz] = m.front;
      // the machine's right, seen from in front of it
      const rx = -fz;
      const rz = fx;
      const x = bx + fx * back + rx * side;
      const z = bz + fz * back + rz * side;
      const tx = bx + rx * lookSide;
      const tz = bz + rz * lookSide;
      const dx = tx - x;
      const dz = tz - z;
      window.__chimp.setPose({ x, y: by + y, z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(by + lookY - (by + y), Math.hypot(dx, dz)), fov });
    },
    [back, y, side, lookY, lookSide, fov],
  );

const perf = async () => {
  await settle(90);
  return ev(() => window.__chimp.info());
};

await view(2.5, 1.62, 0.3, 1.15, 0, 0.95);
const p = await perf();
// and with the machine's own meshes hidden (the materials it brought, and what the engine builds), for the cost of it
const mine = (on) =>
  ev((on) => {
    for (const m of window.__chimp.scene.meshes) {
      const md = m.metadata;
      if (!md) continue;
      if (/^snack|^arcadeWhiteKey/.test(md.matKey ?? "") || /^snack-/.test(md.role ?? "") || /Snack machine/.test(m.name)) m.setEnabled(on);
    }
  }, on);
await mine(false);
const q = await perf();
await mine(true);
console.log(`at the machine: ${p.fps} fps, ${p.drawCalls} draw calls; with it hidden: ${q.fps} fps, ${q.drawCalls} draw calls`);
await shot("look");
await view(1.15, 1.35, 0.05, 1.15, -0.02, 0.75);
await settle();
await shot("closeup");
await view(0.75, 1.0, 0.25, 0.95, 0.15, 0.7);
await settle();
await shot("keypad");
await view(1.9, 1.75, -1.4, 1.2, 0.0, 0.85);
await settle();
await shot("side");
await view(1.0, 2.25, 0.4, 2.12, 0.27, 0.6);
await settle();
await shot("mascot");
await ev(() => window.__chimp.setNight(true));
await view(2.5, 1.62, 0.3, 1.15, 0, 0.95);
await settle(60);
await shot("night");
await ev(() => window.__chimp.setNight(false));

if (!process.env.SHOTS) {
  // the parts, found by role
  const parts = await ev(() => {
    const s = window.__chimp.scene;
    const n = (role) => s.meshes.concat(s.transformNodes).filter((m) => m.metadata?.role === role).length;
    return { machine: n("snack-machine"), coils: n("snack-coil"), keys: n("snack-key"), display: n("snack-display"), bin: n("snack-bin"), flap: n("snack-flap") };
  });
  check(parts.machine === 1 && parts.coils === 27 && parts.keys === 12 && parts.display === 1 && parts.bin === 1 && parts.flap === 1, "the machine, 27 coils, 12 keys, the display, bin and flap carry their roles", JSON.stringify(parts));
}

await browser.close();
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
