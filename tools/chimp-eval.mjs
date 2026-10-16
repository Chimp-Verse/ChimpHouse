// Runs a snippet in the chimp lab (chimp.html) and prints what it returns, for
// checking the avatar's numbers (bone turns, sizes) without a screenshot. With the
// dev server running:
//   node tools/chimp-eval.mjs "<js using lab (window.__lab) and BABYLON-free values>" [query]
//   node tools/chimp-eval.mjs "lab.simulate('walk', 1); return lab.chimp().nodes.head.absoluteRotationQuaternion.asArray()"
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:5173";
const [, , code = "return lab.stats()", query = "anim=rest"] = process.argv;
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => (m.type() === "error" || m.type() === "log") && console.log(`[${m.type()}]`, m.text().slice(0, 600)));
  await page.goto(`${URL}/chimp.html?${query}`);
  await page.waitForFunction(() => window.__lab?.ready === true, null, { timeout: 180000 });
  const out = await page.evaluate((code) => new Function("lab", code)(window.__lab), code);
  console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
