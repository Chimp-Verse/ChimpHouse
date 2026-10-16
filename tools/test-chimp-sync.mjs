// Another visitor's chimp in the house, in a real browser against the running preview
// (npm run dev): the house in one page, and a light visitor in another
// (tools/chimp-visitor.html: the room server and a chimp walking a circle, no house), so
// only one copy of the house is open.
//   1. the house hears the visitor's chimp, builds it (dressed as its DNA says) and shows it
//      where the visitor says it is, with their name over it
//   2. it walks: drawn a moment behind what the visitor says, smoothly
//   3. when the visitor's page closes, its chimp goes
// Screenshots: captures/chimp-sync-*.png. Exits non-zero when a check fails.
//   node tools/test-chimp-sync.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
await mkdir("captures", { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const stop = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
try {
  const house = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  house.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const ev = (fn, arg) => house.evaluate(fn, arg);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = (fn, arg, timeout = 30000) => house.waitForFunction(fn, arg, { timeout, polling: 100 });
  await house.goto(`${URL}/?view=entry&name=Ann`);
  await waitFor(() => window.__chimp?.ready === true, null, 300000);
  await ev(() => window.__chimp.setWalking(true));
  await waitFor(() => !!window.__chimp.chimps.describe().mine, null, 60000);
  const me = await ev(() => window.__chimp.chimps.describe().mine.at);

  // ------------------------------------------------ 1. the visitor arrives
  const visitor = await browser.newPage({ viewport: { width: 400, height: 200 } });
  visitor.on("pageerror", (e) => console.log("[visitor pageerror]", e.message));
  await visitor.goto(`${URL}/tools/chimp-visitor.html?name=Bo&x=${me[0]}&y=${me[1]}&z=${me[2] + 2.6}&r=1.1&wear=cap,tee`);
  await visitor.waitForFunction(() => !!window.visitor, null, { timeout: 30000 });
  const bo = await visitor.evaluate(() => window.visitor.id);
  await waitFor((id) => window.__chimp.chimps.describe().others.find((o) => o.id === id)?.built, bo, 60000);
  await ev(() => window.__chimp.settle(20));
  const seen = await ev((id) => window.__chimp.chimps.describe().others.find((o) => o.id === id), bo);
  check(seen?.name === "Bo", "the house hears the visitor's chimp, under their name", JSON.stringify(seen));
  check(seen?.built && seen?.shown, "builds it and shows it");
  const label = await house.evaluate(() => [...document.querySelectorAll(".chimp-label")].map((l) => ({ text: l.textContent, shown: getComputedStyle(l).display !== "none" })));
  check(label.some((l) => l.text === "Bo" && l.shown), "with its name over its head", JSON.stringify(label));
  // its clothes, as its DNA says
  await waitFor(() => {
    const s = window.__chimp.scene;
    return s.meshes.some((m) => m.name.startsWith("Chimp of Bo cap") && m.isEnabled());
  }, null, 60000).then(
    () => check(true, "dressed as its DNA says (a cap and a tee)"),
    () => check(false, "dressed as its DNA says (a cap and a tee)"),
  );
  await house.screenshot({ path: "captures/chimp-sync-visitor.png" });

  // ------------------------------------------------ 2. it walks, smoothly
  const where = () => ev((n) => window.__chimp.scene.transformNodes.find((t) => t.name === n)?.position.asArray(), "Chimp of Bo");
  const path = [];
  for (let i = 0; i < 8; i++) {
    path.push(await where());
    await sleep(150);
  }
  const steps = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[2] - path[i][2]));
  const moved = steps.reduce((a, b) => a + b, 0);
  check(moved > 0.6, "it walks round its circle", `${moved.toFixed(2)} m in about a second`);
  const jumpy = Math.max(...steps) > 4 * (moved / steps.length) + 0.05;
  check(!jumpy, "smoothly, without jumps", steps.map((s) => s.toFixed(3)).join(" "));

  // ------------------------------------------------ 3. the visitor leaves
  await visitor.close();
  await waitFor((id) => !window.__chimp.chimps.describe().others.some((o) => o.id === id), bo, 30000).then(
    () => check(true, "when the visitor's page closes, its chimp goes"),
    () => check(false, "when the visitor's page closes, its chimp goes"),
  );
  const labelsLeft = await house.evaluate(() => [...document.querySelectorAll(".chimp-label")].length);
  check(labelsLeft === 0, "and so does its name");
} finally {
  await stop();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
