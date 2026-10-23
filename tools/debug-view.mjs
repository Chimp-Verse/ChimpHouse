// Debug helper: load a view, run JS against window.__chimp, screenshot.
//   node tools/debug-view.mjs <view> <out.png> "<js using s (scene) and chimp (automation hook)>"
import { chromium } from "playwright";
const [, , view, out, code] = process.argv;
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "log" && console.log("[log]", m.text()));
await page.goto(`http://localhost:5173/house.html?capture=1&view=${view}`);
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
const res = await page.evaluate(async (code) => {
  const s = window.__chimp.scene;
  const r = new Function("s", "chimp", code)(s, window.__chimp);
  await window.__chimp.settle(5);
  await window.__chimp.whenReady();
  await window.__chimp.settle(20);
  return r;
}, code ?? "");
if (res !== undefined) console.log(JSON.stringify(res, null, 1));
await page.screenshot({ path: out });
await browser.close();
