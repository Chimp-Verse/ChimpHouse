// Render viewpoints of the running preview (npm run dev) to PNGs and build
// side-by-side comparison sheets against the reference images.
//
//   node tools/capture-views.mjs                # all viewpoints
//   node tools/capture-views.mjs front lounge   # selected viewpoints
//   URL=http://localhost:5173 node tools/capture-views.mjs
//
// Output: captures/<id>.png and captures/compare-<id>.png

import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const URL = process.env.URL ?? "http://localhost:5173";
const W = 1672;
const H = 941;
const out = path.resolve("captures");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.HEADED ? false : true,
  channel: process.env.CHANNEL ?? "chromium",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--disable-gpu-sandbox"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[browser ${m.type()}]`, m.text().slice(0, 300));
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

const t0 = Date.now();
await page.goto(`${URL}/house.html?capture=1&quality=${process.env.QUALITY ?? "high"}`);
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 500 });
console.log(`scene ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const info = await page.evaluate(() => window.__chimp.info());
console.log(info);

const all = await page.evaluate(() => window.__chimp.views());
const wanted = process.argv.slice(2);
const views = wanted.length ? all.filter((v) => wanted.includes(v.id)) : all;

for (const v of views) {
  await page.evaluate(async (id) => {
    window.__chimp.goTo(id);
    await window.__chimp.settle(5);
    await window.__chimp.whenReady();
    await window.__chimp.settle(30);
    await window.__chimp.whenReady();
    await window.__chimp.settle(10);
  }, v.id);
  const file = path.join(out, `${v.id}.png`);
  await page.screenshot({ path: file });
  if (v.ref) {
    const refPath = path.resolve("Reference Images", v.ref);
    const half = { width: 836, height: 470 };
    const refBuf = await sharp(refPath).resize(half.width, half.height, { fit: "cover" }).toBuffer();
    const renBuf = await sharp(file).resize(half.width, half.height).toBuffer();
    await sharp({ create: { width: half.width * 2 + 8, height: half.height, channels: 3, background: "#111" } })
      .composite([
        { input: refBuf, left: 0, top: 0 },
        { input: renBuf, left: half.width + 8, top: 0 },
      ])
      .png()
      .toFile(path.join(out, `compare-${v.id}.png`));
  }
  const stats = await page.evaluate(() => window.__chimp.info());
  console.log(`captured ${v.id}  (${stats.fps} fps, ${stats.drawCalls} draws)`);
}
await browser.close();
