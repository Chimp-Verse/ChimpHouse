// The lobby (engine/lobby.ts, ui/Lobby.tsx): every visitor chooses a name and a look before going
// in. Against the running preview (npm run dev, which starts the room server too); separate browser
// contexts are separate visitors. Test browsers skip the lobby unless the address has ?lobby=1.
//   1. the lobby is up as the page opens: the chimp stands in the front courtyard, nobody else
//      hears of it, and the walking keys don't move it
//   2. an empty name and one over 16 letters are turned down, with a message saying why
//   3. the visitor changes their chimp (a preset, a cap) and goes in: others see the name and look
//   4. a second visitor asking for the same name (another case, extra spaces) is told it is taken
//      and offered a free one, which they can take with one click
//   5. back again: the name and the chimp are offered as they were
// Exits non-zero when a check fails.
//   node tools/test-lobby.mjs
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:5173";
let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });

try {
  /** A visitor in a context (a browser profile) of their own, arriving at the lobby. */
  async function visitor(label, ctx) {
    ctx ??= await browser.newContext({ viewport: { width: 1100, height: 700 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      // never take the real pointer or keyboard (headless, but even so)
      Element.prototype.requestPointerLock = () => Promise.resolve();
      Element.prototype.requestFullscreen = () => Promise.resolve();
    });
    page.on("pageerror", (e) => console.log(`[${label} pageerror]`, e.message));
    await page.goto(`${URL}/?lobby=1&quality=low`, { timeout: 120000, waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__chimp?.chimps?.describe().mine, null, { timeout: 90000 });
    const ev = (fn, a) => page.evaluate(fn, a);
    return { page, ctx, ev, chimps: () => ev(() => window.__chimp.chimps.describe()), lobby: () => ev(() => window.__chimp.chimps.lobby()) };
  }
  const inCourtyard = (at) => Math.hypot(at[0], at[2] + 17) < 9.6 && at[2] < -7.3;

  // 1. the lobby comes first
  const a = await visitor("A");
  await a.page.waitForSelector(".lobby", { timeout: 30000 });
  const a0 = await a.chimps();
  check(await a.lobby(), "the lobby is up as the page opens");
  check(!a0.present, "nobody else is told of the chimp while its visitor is in the lobby");
  check(inCourtyard(a0.mine.at), "the chimp stands in the front courtyard behind the lobby", a0.mine.at.map((v) => v.toFixed(1)).join(", "));
  check(await a.page.isHidden(".panel.views"), "the house's side panels wait until the visitor goes in");
  // the walking keys, with the canvas focused, do nothing
  await a.page.locator("canvas.scene").focus();
  await a.page.keyboard.down("KeyW");
  await sleep(900);
  await a.page.keyboard.up("KeyW");
  const a1 = await a.chimps();
  const moved = Math.hypot(a1.mine.at[0] - a0.mine.at[0], a1.mine.at[2] - a0.mine.at[2]);
  check(moved < 0.05, "W doesn't walk the chimp in the lobby", `${moved.toFixed(2)} m`);

  // 2. names turned down
  const name = a.page.locator("#lobby-name");
  await name.fill("");
  await a.page.click(".lobby-enter");
  await sleep(300);
  const empty = await a.page.locator(".lobby-problem").textContent().catch(() => "");
  check(/type a name/i.test(empty ?? "") && (await a.lobby()), "an empty name is turned down, saying so", empty);
  await name.fill("   ");
  await name.press("Enter");
  await sleep(300);
  check(await a.lobby(), "a name of only spaces is turned down");
  await name.fill("Annabelle the Great");
  await sleep(200);
  const long = await a.page.locator(".lobby-problem").textContent().catch(() => "");
  await a.page.click(".lobby-enter");
  await sleep(300);
  check(/up to 16/i.test(long ?? "") && (await a.lobby()), "a name over 16 letters is turned down, saying so", long);
  check(/19 \/ 16/.test((await a.page.locator(".lobby-name em").textContent()) ?? ""), "the counter shows the name is too long");

  // the second visitor arrives while the first is still in the lobby: they hear of nobody
  const b = await visitor("B");
  await sleep(1500);
  const b0 = await b.chimps();
  check(b0.others.length === 0, "a visitor still in the lobby isn't seen by others", JSON.stringify(b0.others));

  // 3. a look, a name, and in
  await a.page.click(".lobby .chips button:has-text('Golden')");
  await a.page.click(".wardrobe-tabs button:has-text('Clothes')");
  await a.page.click(".wardrobe-slot:has-text('Head') button:has-text('Cap')");
  await sleep(500);
  const dnaA = await a.ev(() => window.__chimp.chimps.dna());
  check(dnaA.colors.fur === "#7a5236" && dnaA.outfit.head?.id === "cap", "the lobby's controls change the chimp at once", JSON.stringify({ fur: dnaA.colors.fur, head: dnaA.outfit.head?.id }));
  await name.fill("  Ann  ");
  await name.press("Enter");
  await a.page.waitForFunction(() => !window.__chimp.chimps.lobby(), null, { timeout: 8000 }).catch(() => undefined);
  check(!(await a.lobby()), "Enter takes the visitor in");
  check(await a.page.isVisible(".panel.views"), "the house's side panels are there once in");
  const a2 = await a.chimps();
  check(a2.present && inCourtyard(a2.mine.at), "the chimp is in the front courtyard, for everyone", a2.mine.at.map((v) => v.toFixed(1)).join(", "));
  await b.page.waitForFunction(() => window.__chimp.chimps.describe().others.some((o) => o.name === "Ann" && o.built), null, { timeout: 20000 }).catch(() => undefined);
  const seen = (await b.chimps()).others.find((o) => o.name === "Ann");
  check(!!seen, "the other visitor sees the name chosen (trimmed)", JSON.stringify((await b.chimps()).others.map((o) => o.name)));
  check(seen?.fur === "#7a5236" && seen?.outfit.includes("head"), "the other visitor sees the look chosen in the lobby", JSON.stringify(seen));
  // and can walk now
  await a.page.locator("canvas.scene").focus();
  await a.page.keyboard.down("KeyW");
  await sleep(900);
  await a.page.keyboard.up("KeyW");
  const a3 = await a.chimps();
  const walked = Math.hypot(a3.mine.at[0] - a2.mine.at[0], a3.mine.at[2] - a2.mine.at[2]);
  check(walked > 0.3, "once in, W walks the chimp", `${walked.toFixed(2)} m`);

  // 4. the same name again
  const bName = b.page.locator("#lobby-name");
  await bName.fill("ann ");
  await bName.press("Enter");
  await b.page.waitForSelector(".lobby-problem button", { timeout: 8000 }).catch(() => undefined);
  const taken = (await b.page.locator(".lobby-problem").textContent().catch(() => "")) ?? "";
  check(/already in the house/i.test(taken) && (await b.lobby()), "a name already in the house is turned down", taken);
  check(/Ann 2|ann 2/.test(taken), "and a free one like it is offered", taken);
  await b.page.click(".lobby-problem button");
  await b.page.waitForFunction(() => !window.__chimp.chimps.lobby(), null, { timeout: 8000 }).catch(() => undefined);
  check(!(await b.lobby()), "the offered name takes the visitor in with one click");
  await a.page.waitForFunction(() => window.__chimp.chimps.describe().others.some((o) => /^ann 2$/i.test(o.name)), null, { timeout: 15000 }).catch(() => undefined);
  check((await a.chimps()).others.some((o) => /^ann 2$/i.test(o.name)), "the first visitor sees the second by their new name", JSON.stringify((await a.chimps()).others.map((o) => o.name)));

  // 5. back again: the name and the chimp as they were
  const ctxA = a.ctx;
  await a.page.close();
  const again = await visitor("A again", ctxA);
  await again.page.waitForSelector(".lobby", { timeout: 30000 });
  const offered = await again.page.locator("#lobby-name").inputValue();
  const dnaAgain = await again.ev(() => window.__chimp.chimps.dna());
  check(offered === "Ann", "back again, the name is offered as before", offered);
  check(dnaAgain.colors.fur === "#7a5236" && dnaAgain.outfit.head?.id === "cap", "back again, the chimp is as it was", JSON.stringify({ fur: dnaAgain.colors.fur, head: dnaAgain.outfit.head?.id }));
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
