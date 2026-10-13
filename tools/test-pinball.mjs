// The pinball machines in a real browser against the running preview (npm run dev).
//   node tools/test-pinball.mjs [look]
// "look" only takes the screenshots of the machines (from a walker's eye, close up,
// the backboxes, at night). Screenshots: captures/pinball-*.png. Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
const mode = process.argv[2] ?? "all";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const shot = (name) => page.screenshot({ path: `captures/pinball-${name}.png` });
const frames = (n) => ev((n) => window.__chimp.settle(n), n);

await page.goto(`${URL}/?capture=1&view=entry`);
await waitFor(() => window.__chimp?.ready === true, null, 300000);
await sleep(500);

/**
 * A machine's frame from its playfield node (role pinball-machine): its centre on the floor,
 * which way its front faces (toward the player), and the floor's height.
 */
const machine = (n) =>
  ev((n) => {
    const s = window.__chimp.scene;
    const node = s.transformNodes.find((t) => t.metadata?.role === "pinball-machine" && t.metadata.slot === n);
    const m = node.computeWorldMatrix(true).m;
    const up = [m[8], m[9], m[10]];
    const fl = Math.hypot(up[0], up[2]);
    const front = [-up[0] / fl, -up[2] / fl];
    const st = node.metadata.stand;
    const tr = (x, y, z) => [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]];
    const stand = tr(...st);
    const mid = tr(0, 0, 0.55);
    return { front, stand, floor: stand[1], mid, origin: [m[12], m[13], m[14]] };
  }, n);
/** The camera at eye, looking at target. */
const look = (eye, target, fov = 0.9) =>
  ev(
    ([e, t, fov]) => {
      const dx = t[0] - e[0], dy = t[1] - e[1], dz = t[2] - e[2];
      window.__chimp.setPose({ x: e[0], y: e[1], z: e[2], yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)), fov });
    },
    [eye, target, fov],
  );

// ------------------------------------------------ 1. the machines, found by role
const found = await ev(() => {
  const s = window.__chimp.scene;
  const all = s.meshes.concat(s.transformNodes);
  const n = (role, slot) => all.filter((m) => m.metadata?.role === role && (slot === undefined || m.metadata.slot === slot)).length;
  return { machines: [n("pinball-machine", 1), n("pinball-machine", 2)], dmd: [n("pinball-dmd", 1), n("pinball-dmd", 2)], flippers: [n("pinball-flipper", 1), n("pinball-flipper", 2)], balls: [n("pinball-ball", 1), n("pinball-ball", 2)] };
});
check(found.machines.every((c) => c === 1) && found.dmd.every((c) => c === 1), "each machine's playfield and display carry their roles", JSON.stringify(found));
check(found.flippers[0] === 2 && found.flippers[1] === 3, "Jungle Quest has two flippers, Banana Blitz three", JSON.stringify(found.flippers));

// ------------------------------------------------ 2. how they look
const A = await machine(1);
const B = await machine(2);
const mid = [(A.mid[0] + B.mid[0]) / 2, A.floor + 1.0, (A.mid[2] + B.mid[2]) / 2];
const front = [(A.front[0] + B.front[0]) / 2, (A.front[1] + B.front[1]) / 2];
const away = (p, d, h) => [p[0] + front[0] * d, A.floor + h, p[2] + front[1] * d];
await look(away(mid, 2.5, 1.55), mid, 1.0);
await frames(30);
await shot("room");
const perf = await ev(() => window.__chimp.info());
console.log(`at the machines: ${perf.fps} fps, ${perf.drawCalls} draw calls, ${perf.activeMeshes} active meshes`);
// each playfield as its player sees it, and the backboxes
for (const [name, M] of [
  ["jq", A],
  ["bb", B],
]) {
  const eye = [M.stand[0] + M.front[0] * 0.05, M.floor + 1.62, M.stand[2] + M.front[1] * 0.05];
  await look(eye, [M.mid[0] - M.front[0] * 0.05, M.floor + 0.92, M.mid[2] - M.front[1] * 0.05], 0.85);
  await frames(20);
  await shot(`${name}-player`);
  const top = [M.mid[0] + M.front[0] * 0.15, M.floor + 1.75, M.mid[2] + M.front[1] * 0.15];
  await look(top, [M.mid[0] - M.front[0] * 0.08, M.floor + 0.9, M.mid[2] - M.front[1] * 0.08], 0.75);
  await frames(20);
  await shot(`${name}-above`);
}
await look(away(mid, 1.6, 1.4), [mid[0], A.floor + 1.45, mid[2]], 0.8);
await frames(20);
await shot("backboxes");
// from the side: legs, cabinet art
const side = [-front[1], front[0]];
await look([A.mid[0] + side[0] * 1.6 + front[0] * 0.6, A.floor + 1.2, A.mid[2] + side[1] * 1.6 + front[1] * 0.6], [A.mid[0], A.floor + 0.8, A.mid[2]], 0.9);
await frames(20);
await shot("side");
await ev(() => window.__chimp.setNight(true));
await look(away(mid, 2.5, 1.55), mid, 1.0);
await frames(40);
await shot("night");
await ev(() => window.__chimp.setNight(false));

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
