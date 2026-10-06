// Export a room from the running preview as a .glb for Blender.
//   node tools/export-room.mjs <room id> [out.glb]      e.g. node tools/export-room.mjs theatre
// Needs `npm run dev` running. Room ids are in ROOMS in src/world/layout.ts.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

const [, , room = "theatre", out = `art/test/${room}.glb`] = process.argv;
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => (m.type() === "error" || m.text().startsWith("[export]")) && console.log(m.type() === "error" ? `[error] ${m.text()}` : m.text()));
await page.goto("http://localhost:5173/?capture=1");
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
const t0 = Date.now();
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 300000 }), page.evaluate((id) => window.__chimp.downloadRoom(id), room)]);
mkdirSync(dirname(out), { recursive: true });
await download.saveAs(out);
console.log(`${out} written in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await browser.close();
