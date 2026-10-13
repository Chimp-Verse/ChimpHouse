// The air hockey table in the Game Room, against the running preview (npm run dev).
//   node tools/test-air-hockey.mjs look   screenshots of the table: from a walker's eye at about
//                                         2.5 m, close-ups of its details, and at night
// Screenshots go to captures/air-hockey-*.png. Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:5173";
const mode = process.argv[2] ?? "look";
let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
mkdirSync("captures", { recursive: true });
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });

async function open(viewport = { width: 1400, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`${URL}/?capture=1&view=game`);
  await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
  return page;
}

/** A pose at table-local (x, y, z) looking at table-local (tx, ty, tz). */
function poseFor(t, [x, y, z], [tx, ty, tz], fov = 0.9) {
  const c = Math.cos(t.yaw);
  const s = Math.sin(t.yaw);
  // the table's X axis is (cos, 0, -sin) in the world, its Z axis (sin, 0, cos)
  const w = (lx, lz) => [t.at[0] + lx * c + lz * s, t.at[2] - lx * s + lz * c];
  const [ex, ez] = w(x, z);
  const [gx, gz] = w(tx, tz);
  const dx = gx - ex;
  const dz = gz - ez;
  return { x: ex, y: t.at[1] + y, z: ez, yaw: Math.atan2(dx, dz), pitch: Math.atan2(y - ty, Math.hypot(dx, dz)), fov };
}

async function shot(page, pose, name, night = false) {
  await page.evaluate(async ({ pose, night }) => {
    window.__chimp.setNight(night);
    window.__chimp.setPose(pose);
    await window.__chimp.settle(5);
    await window.__chimp.whenReady();
    await window.__chimp.settle(30);
  }, { pose, night });
  await page.screenshot({ path: `captures/air-hockey-${name}.png` });
  const info = await page.evaluate(() => window.__chimp.info());
  console.log(`shot ${name}: ${info.fps} fps, ${info.drawCalls} draw calls`);
}

if (mode === "look") {
  const page = await open();
  const t = await page.evaluate(() => window.__chimp.airHockey.where());
  check(!!t, "the table is found by its role", JSON.stringify(t));
  const field = await page.evaluate(() => window.__chimp.airHockey.field());
  check(field && Math.abs(field.hx * 2 - 2.08) < 0.01 && Math.abs(field.hz * 2 - 1.04) < 0.01, "the playfield is read from its mesh", JSON.stringify(field));
  if (t) {
    await shot(page, poseFor(t, [-2.0, 1.6, -1.5], [0, 0.75, 0]), "walker");
    await shot(page, poseFor(t, [1.9, 1.6, 1.6], [0, 0.8, 0]), "walker-2");
    await shot(page, poseFor(t, [-0.35, 1.2, -0.7], [-1.1, 0.78, 0], 0.75), "closeup-goal");
    await shot(page, poseFor(t, [-2.0, 0.95, -0.6], [-1.17, 0.55, 0], 0.75), "closeup-return");
    await shot(page, poseFor(t, [0.75, 1.25, -1.0], [0, 1.1, 0], 0.8), "closeup-board");
    await shot(page, poseFor(t, [-0.9, 0.55, -1.3], [-0.6, 0.4, -0.55], 0.85), "closeup-cabinet");
    await shot(page, poseFor(t, [-2.0, 1.6, -1.5], [0, 0.75, 0]), "night", true);
    // the table's own draw calls: the frame with its meshes of its own hidden, against the frame with them
    const cost = await page.evaluate(async () => {
      const c = window.__chimp;
      const own = c.scene.meshes.filter((m) => m.name.startsWith("gameRoom:ah") || m.name.startsWith("Air hockey"));
      const calls = async () => {
        await c.settle(60);
        return c.info().drawCalls;
      };
      const on = await calls();
      own.forEach((m) => m.setEnabled(false));
      const off = await calls();
      own.forEach((m) => m.setEnabled(true));
      return { meshes: own.length, on, off };
    });
    console.log(`the table's own meshes: ${cost.meshes}, ${cost.on - cost.off} draw calls (${cost.on} with them, ${cost.off} without)`);
  }
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
