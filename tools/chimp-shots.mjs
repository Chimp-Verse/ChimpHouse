// Photographs the chimp lab (chimp.html) from several views into one contact sheet,
// for working on the avatar's look. With the dev server running:
//   node tools/chimp-shots.mjs [out.png] [views] [query]
//   node tools/chimp-shots.mjs captures/chimp.png front,three,side,face,hands,back "anim=walk&t=0.4"
// Views: front, three, side, back, face, faceFront, faceSide, hands, feet.
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const URL = process.env.URL ?? "http://localhost:5173";
const [, , out = "captures/chimp.png", viewsArg = "front,three,side,back,face,hands", query = ""] = process.argv;
const views = viewsArg.split(",");
const SIZE = Number(process.env.SIZE ?? 760);
await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const close = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void close().then(() => process.exit(143)));
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log(`[${m.type()}]`, m.text().slice(0, 600)));
  await page.goto(`${URL}/chimp.html?${query}`);
  await page.waitForFunction(() => window.__lab?.ready === true, null, { timeout: 180000 });
  await page.evaluate(() => window.__lab.whenReady());
  console.log(await page.evaluate(() => window.__lab.stats()));
  const shots = [];
  for (const spec of views) {
    // a view can carry a pose: "three@walk:0.35" is the three-quarter view, 0.35 s into a walk
    const [v, pose] = spec.split("@");
    if (pose) {
      const [anim, t] = pose.split(":");
      await page.evaluate(([a, t]) => window.__lab.simulate(a, Number(t)), [anim, t ?? "2"]);
    }
    await page.evaluate((v) => window.__lab.setView(v), v);
    await page.evaluate(() => window.__lab.settle(8));
    shots.push({ v: spec, img: await page.screenshot() });
  }
  const cols = Math.min(3, shots.length);
  const rows = Math.ceil(shots.length / cols);
  const cell = Math.round(SIZE * 0.66);
  const tiles = await Promise.all(
    shots.map(async ({ v, img }, i) => {
      const label = Buffer.from(`<svg width="${cell}" height="28"><rect width="100%" height="100%" fill="rgba(0,0,0,0.55)"/><text x="10" y="19" font-family="monospace" font-size="15" fill="#f2e6d2">${v}</text></svg>`);
      const t = await sharp(img).resize(cell, cell).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer();
      return { input: t, left: (i % cols) * cell, top: Math.floor(i / cols) * cell };
    }),
  );
  await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: "#14110e" } })
    .composite(tiles)
    .png()
    .toFile(out);
  console.log("wrote", out);
} finally {
  await close();
}
