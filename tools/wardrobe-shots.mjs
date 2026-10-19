// Photographs clothes on every kind of chimp in the chimp lab (chimp.html), into one
// contact sheet: a row per body (the wardrobe's presets, then the slimmest and the
// biggest chimp the settings make), a column per view. For checking that an item fits
// every body. With the dev server running:
//   node tools/wardrobe-shots.mjs <items> [views] [bodies] [out.png]
//   node tools/wardrobe-shots.mjs cap head3,headSide,headBack
//   node tools/wardrobe-shots.mjs tee,backpack torso3,torsoSide,torsoBack Classic,Big
// Items are worn together (comma-separated ids from avatar/wardrobe.ts). Views are the
// lab's (headFront, head3, headSide, headBack, neckFront, neck3, neckBack, torsoFront,
// torso3, torsoSide, torsoBack, hem, legsFront, legs3, legsBack, wristOut, wristTop, front,
// three, side, back…); a view
// can carry a pose, "torso3@walk:0.4" (0.4 s into a walk). The chimp stands in its
// idle pose otherwise. SIZE sets each tile's pixels (default 360); TINT the items' colours
// (TINT="tee:efe4cc|78d8aa,shorts:d8a133"), else each wears its own.
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const URL = process.env.URL ?? "http://localhost:5173";
const [, , items = "cap", viewsArg = "head3,headSide,headBack", bodiesArg = "", outArg = ""] = process.argv;
const views = viewsArg.split(",");
const out = outArg || `captures/wardrobe-${items.replaceAll(",", "+")}.png`;
const SIZE = Number(process.env.SIZE ?? 360);
await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const close = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void close().then(() => process.exit(143)));
try {
  const page = await browser.newPage({ viewport: { width: SIZE * 2, height: SIZE * 2 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => (m.type() === "error" || (m.type() === "log" && m.text().startsWith("[lab]"))) && console.log(m.text().slice(0, 300)));
  await page.goto(`${URL}/chimp.html?wear=${items}&t=2${process.env.TINT ? `&tint=${encodeURIComponent(process.env.TINT)}` : ""}`);
  await page.waitForFunction(() => window.__lab?.ready === true, null, { timeout: 180000 });
  const bodies = bodiesArg ? bodiesArg.split(",") : await page.evaluate(() => window.__lab.bodies());
  const tiles = [];
  for (const [row, body] of bodies.entries()) {
    await page.evaluate((b) => window.__lab.setBody(b), body);
    await page.evaluate(() => window.__lab.simulate("idle", 2));
    await page.evaluate(() => window.__lab.whenReady());
    for (const [col, spec] of views.entries()) {
      const [v, pose] = spec.split("@");
      if (pose) {
        const [anim, t] = pose.split(":");
        await page.evaluate(([a, t]) => window.__lab.simulate(a, Number(t)), [anim, t ?? "2"]);
      } else await page.evaluate(() => window.__lab.simulate("idle", 2));
      await page.evaluate((v) => window.__lab.setView(v), v);
      await page.evaluate(() => window.__lab.settle(6));
      const img = await page.screenshot();
      const label = Buffer.from(`<svg width="${SIZE}" height="24"><rect width="100%" height="100%" fill="rgba(0,0,0,0.55)"/><text x="8" y="17" font-family="monospace" font-size="13" fill="#f2e6d2">${body} · ${spec}</text></svg>`);
      tiles.push({ input: await sharp(img).resize(SIZE, SIZE).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer(), left: col * SIZE, top: row * SIZE });
    }
    console.log(`${body}: done`);
  }
  await sharp({ create: { width: views.length * SIZE, height: bodies.length * SIZE, channels: 3, background: "#14110e" } })
    .composite(tiles)
    .png()
    .toFile(out);
  console.log("wrote", out);
} finally {
  await close();
}
