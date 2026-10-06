// Export the whole house for the Blender build: one .glb per room or zone, plus scene.json
// with the house's lights, sun and viewpoint cameras.
//   node tools/export-house.mjs [out dir]        (default art/test/house; needs `npm run dev`)
// Then: blender --background --factory-startup --python tools/blender/build_blend.py -- art/ChimpHouse.blend art/test/house
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const out = process.argv[2] ?? "art/test/house";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && console.log("[error]", m.text()));
await page.goto("http://localhost:5173/?capture=1");
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
// nothing needs drawing: the exporter reads textures back far faster with the scene still
await page.evaluate(() => window.__chimp.scene.getEngine().stopRenderLoop());

const rooms = await page.evaluate(async () => (await import("/src/world/layout.ts")).ROOMS.map((r) => ({ id: r.id, level: r.level })));
const roomIds = new Set(rooms.map((r) => r.id));
const others = (await page.evaluate(() => window.__chimp.zones())).filter((z) => !roomIds.has(z) && z !== "jungle" && z !== "sky");
const zones = [...rooms, ...others.sort().map((id) => ({ id }))];

let total = 0;
for (const [i, z] of zones.entries()) {
  const t0 = Date.now();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 600000 }), page.evaluate(([id, level]) => window.__chimp.downloadZone(id, level), [z.id, z.level])]);
  const file = join(out, `${String(i + 1).padStart(2, "0")}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const mb = statSync(file).size / 1e6;
  total += mb;
  console.log(`${file}  ${mb.toFixed(1)} MB  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
writeFileSync(join(out, "scene.json"), JSON.stringify(await page.evaluate(() => window.__chimp.houseScene()), null, 1));
console.log(`${zones.length} zones, ${total.toFixed(1)} MB, and ${join(out, "scene.json")}`);
await browser.close();
