// Render several candidate camera poses into one contact sheet.
//   node tools/try-poses.mjs out.png '[{"x":..,"y":..,"z":..,"yaw":deg,"pitch":deg,"fov":..}, ...]' [night]
// yaw/pitch are in degrees. Needs `npm run dev` running.
import { chromium } from "playwright";
import sharp from "sharp";
const [, , out, json, night] = process.argv;
const poses = JSON.parse(json);
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
await page.goto(`http://localhost:5173/house.html?capture=1${night ? "&night=1" : ""}`);
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
const tiles = [];
for (let i = 0; i < poses.length; i++) {
  const p = poses[i];
  await page.evaluate(async (p) => {
    const d = Math.PI / 180;
    window.__chimp.setPose({ x: p.x, y: p.y, z: p.z, yaw: p.yaw * d, pitch: -p.pitch * d, fov: p.fov ?? 1.15 });
    await window.__chimp.settle(4);
    await window.__chimp.whenReady();
    await window.__chimp.settle(8);
  }, p);
  const buf = await page.screenshot();
  tiles.push({ input: await sharp(buf).resize(836, 470).toBuffer(), left: (i % 2) * 840, top: Math.floor(i / 2) * 474 });
}
const rows = Math.ceil(poses.length / 2);
await sharp({ create: { width: 1676, height: rows * 474, channels: 3, background: "#000" } }).composite(tiles).png().toFile(out);
await browser.close();
