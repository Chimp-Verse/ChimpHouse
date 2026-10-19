// Photographs this visitor's chimp in the house, from behind and in front, in several
// places (daylight at the door, the rooms' lamplight), into one contact sheet: for judging
// the chimp under the house's own light rather than the lab's. With the dev server running:
//   node tools/chimp-house-shots.mjs [out.png] [views] [dna JSON]
//   node tools/chimp-house-shots.mjs captures/chimp-house.png entry,game,lounge
import { chromium } from "playwright";
import sharp from "sharp";

const URL = process.env.URL ?? "http://localhost:5173";
const [, , out = "captures/chimp-house.png", viewsArg = "entry,game,lounge", dnaArg] = process.argv;
const views = viewsArg.split(",");
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const stop = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`${URL}/?capture=1&view=${views[0]}&quality=high`);
  await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
  // the HUD out of the way: only the scene
  await page.addStyleTag({ content: ".app > :not(.scene):not(.chimp-labels) { display: none !important; }" });
  if (dnaArg) await page.evaluate((d) => window.__chimp.chimps.setDna(JSON.parse(d)), dnaArg);
  const shots = [];
  for (const v of views) {
    await page.evaluate((v) => {
      window.__chimp.setWalking(false);
      window.__chimp.goTo(v);
      window.__chimp.setWalking(true);
    }, v);
    await page.waitForFunction(() => !!window.__chimp.chimps.describe().mine && !window.__chimp.state().chimpBuilding, null, { timeout: 120000 });
    for (const [label, turn, boom] of [
      ["behind", 0, 2.7],
      ["front", Math.PI + 0.35, 1.9],
    ]) {
      await page.evaluate(
        ([turn, boom]) => {
          const c = window.__chimp;
          const facing = c.chimps.describe().mine.facing;
          c.chimps.setBoom(boom);
          c.setPose({ ...c.pose(), yaw: facing + turn, pitch: 0.1 });
        },
        [turn, boom],
      );
      await page.evaluate(() => window.__chimp.settle(40));
      shots.push({ label: `${v} ${label}`, img: await page.screenshot() });
    }
  }
  const W = 480;
  const H = 360;
  const tiles = await Promise.all(
    shots.map(async ({ label, img }, i) => {
      const tag = Buffer.from(`<svg width="${W}" height="24"><rect width="100%" height="100%" fill="rgba(0,0,0,0.55)"/><text x="8" y="17" font-family="monospace" font-size="14" fill="#f2e6d2">${label}</text></svg>`);
      const t = await sharp(img).resize(W, H).composite([{ input: tag, top: 0, left: 0 }]).png().toBuffer();
      return { input: t, left: (i % 2) * W, top: Math.floor(i / 2) * H };
    }),
  );
  await sharp({ create: { width: 2 * W, height: Math.ceil(shots.length / 2) * H, channels: 3, background: "#14110e" } }).composite(tiles).png().toFile(out);
  console.log("wrote", out);
} finally {
  await stop();
}
