// Round trip at an arcade cabinet with a real ChimpVibe game, from a local
// ChimpVibe server that allows ChimpHouse, in a real browser against the running
// preview (npm run dev): the server's showcase
// and art, walking up to the first cabinet, joining its game on ChimpVibe's play
// page (name box, Play), the keys reaching the game itself, leaving and walking on.
//   node tools/test-arcade-real.mjs
// tools/test-arcade.mjs covers the rest against a stand-in. Screenshots:
// captures/arcade-real-*.png. Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

// ChimpVibe's demo lets exactly this origin frame its games and read its list
const URL = "http://localhost:5173";
const SLOT = 1;
await mkdir("captures", { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && console.log("[browser error]", m.text().slice(0, 300)));
const shot = (name) => page.screenshot({ path: `captures/arcade-real-${name}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (n = 10) => ev((n) => window.__chimp.settle(n), n);
const waitFor = (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });

await page.goto(`${URL}/?view=game&arcade=local`);
await waitFor(() => window.__chimp?.ready === true, null, 300000);
await ev(() => window.__chimp.arcade.ready());
await settle(20);

// ------------------------------------------------ the demo's list and art
const source = await ev(() => window.__chimp.arcade.source());
const games = await ev(() => window.__chimp.arcade.games());
check(source === "chimpvibe-local" && games.length > 0, "the game list comes from ChimpVibe's demo", `${source}: ${games.map((g) => `${g.slot}:${g.name}`).join(", ")}`);
const game = games.find((g) => g.slot === SLOT);
await waitFor((n) => !!window.__chimp.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n)?.material?.emissiveTexture?.metadata?.art, SLOT, 15000).catch(() => {});
const art = await ev((n) => window.__chimp.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n)?.material?.emissiveTexture?.metadata?.art ?? null, SLOT);
check(!!art && !art.startsWith("/chimpvibe/"), "its art loads straight from ChimpVibe as a texture (CORS, no proxy)", art ?? "no art");

// ------------------------------------------------ walk up and play
await ev((n) => {
  const c = window.__chimp;
  const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
  const V = node.position.constructor;
  const wm = node.computeWorldMatrix(true);
  const start = V.TransformCoordinates(new V(0.25, 1.6, -3.6), wm);
  const at = V.TransformCoordinates(new V(0, 1.2, 0), wm);
  c.setPose({ x: start.x, y: start.y, z: start.z, yaw: Math.atan2(at.x - start.x, at.z - start.z), pitch: 0.12, fov: 1.2 });
  c.setWalking(true);
}, SLOT);
await settle(10);
await page.keyboard.down("KeyW");
await waitFor((n) => window.__chimp.state().arcadePrompt?.slot === n, SLOT, 6000).catch(() => {});
await page.keyboard.up("KeyW");
await settle(10);
check((await ev(() => window.__chimp.state().arcadePrompt?.slot)) === SLOT, "walking up to it offers its game", game?.name);
await shot("1-walked-up");
await page.keyboard.press("KeyE");
await waitFor(() => window.__chimp.state().focus?.phase === "on" && !!window.__chimp.state().focusRect, null, 5000);
await settle(10);
const want = await ev((n) => window.__chimp.arcade.screenRect(n), SLOT);
const got = await ev(() => {
  const r = document.querySelector("iframe.play-frame").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const err = Math.max(Math.abs(want.x - got.x), Math.abs(want.y - got.y), Math.abs(want.w - got.w), Math.abs(want.h - got.h));
check(err < 1, "E plays it: ChimpVibe's play page lies over the screen", `off by ${err.toFixed(2)} px`);

// ChimpVibe's play page: a name box and Play, then the game in a locked-down frame inside it
const playOrigin = new globalThis.URL(game.playUrl).origin;
let shell = null;
for (let i = 0; i < 100 && !shell; i++) {
  shell = page.frames().find((f) => f.url().startsWith(`${playOrigin}/`) && !f.url().includes("/renderer-frame")) ?? null;
  if (!shell) await page.waitForTimeout(100);
}
await shell?.waitForSelector("#name", { timeout: 15000 }).catch(() => {});
check(!!shell && !!(await shell.$("#name")), "the play page loads in the cabinet (ChimpHouse may frame it)", shell?.url());
check(!(await ev(() => !!document.querySelector(".focus-bar .focus-start"))), "it sends no messages, so the frame shows the usual hint, not the start prompt");
await shot("2-lobby");

// as a visitor would: click the name box, type a name, press Enter
await shell.click("#name");
await page.keyboard.type("Cabinet visitor");
const typed = await shell.evaluate(() => document.getElementById("name").value);
check(typed === "Cabinet visitor", "typing a name reaches the play page", `"${typed}"`);
await page.keyboard.press("Enter");
let renderer = null;
for (let i = 0; i < 200 && !renderer; i++) {
  renderer = page.frames().find((f) => f.url().includes("/renderer-frame")) ?? null;
  if (!renderer) await page.waitForTimeout(100);
}
await shell.waitForFunction(() => document.body.classList.contains("playing"), null, { timeout: 30000 }).catch(() => {});
check(!!renderer && (await shell.evaluate(() => document.body.classList.contains("playing"))), "Enter joins the game", renderer ? "the game's frame is mounted" : "no game frame");
await page.waitForTimeout(1500);
await shot("3-joined");

// the keys the game itself hears, and those that land on the play page instead
const listen = (f, name) => f.evaluate((name) => { window[name] = []; addEventListener("keydown", (e) => window[name].push(e.code), true); }, name);
await listen(renderer, "__heard");
await listen(shell, "__missed");
const keysOf = async () => ({ game: await renderer.evaluate(() => window.__heard.join(" ")), page: await shell.evaluate(() => window.__missed.join(" ")) });
const houseState = () =>
  ev(() => {
    const s = window.__chimp.state();
    return JSON.stringify({ pose: window.__chimp.pose(), walking: s.walking, night: s.night, view: s.viewId, help: s.help, focus: s.focus?.phase });
  });
const h0 = await houseState();
const KEYS = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyF", "KeyN", "KeyE"];
for (const k of KEYS) {
  await page.keyboard.press(k);
  await page.waitForTimeout(40);
}
const k1 = await keysOf();
check(k1.game === KEYS.join(" "), "after joining, every key reaches the game, the first one too", `game heard [${k1.game}], play page got [${k1.page}]`);
check((await houseState()) === h0, "ChimpHouse ignores them (camera, walk, night, help…)");
await shot("4-playing");

// keyboard lost to ChimpHouse's page (a click on the frame's title), then given back by clicking the game
await page.click(".focus-bar.top .name");
await page.keyboard.press("KeyN");
await renderer.evaluate(() => (window.__heard.length = 0));
await shell.evaluate(() => (window.__missed.length = 0));
await page.mouse.click(got.x + got.w / 2, got.y + got.h / 2);
for (const k of ["ArrowLeft", "ArrowUp"]) {
  await page.keyboard.press(k);
  await page.waitForTimeout(40);
}
const k2 = await keysOf();
check(k2.game === "ArrowLeft ArrowUp" && (await houseState()) === h0, "clicking the game gives it the keyboard back", `game heard [${k2.game}], play page got [${k2.page}]`);

// ------------------------------------------------ step back: the game keeps running
await renderer.evaluate(() => (window.__mark = "still here"));
const marked = async () => (await renderer.evaluate(() => window.__mark).catch(() => null)) === "still here";
await page.click(".focus-bar .leave.secondary");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await settle(10);
const after = await ev((n) => ({ running: window.__chimp.arcade.running(), walking: window.__chimp.state().walking, quad: window.__chimp.arcade.screenQuad(n), frame: document.querySelector("iframe.play-frame")?.style.transform.slice(0, 8) }), SLOT);
const stillIn = await shell.evaluate(() => document.body.classList.contains("playing")).catch(() => false);
check(after.running.length === 1 && after.walking && (await marked()) && stillIn, "Step back: you walk again, and the game keeps running, still joined", after.running.map((g) => `${g.name} ${g.view}`).join(", "));
check(after.running[0]?.view === "over" && after.frame === "matrix3d", "it shows on the cabinet's screen in perspective");
await shot("5-stepped-back");
await renderer.evaluate(() => (window.__heard.length = 0));
await page.keyboard.down("KeyS");
await page.waitForTimeout(700);
await page.keyboard.up("KeyS");
await settle(5);
check((await renderer.evaluate(() => window.__heard.length)) === 0 && (await ev(() => window.__chimp.arcade.running()[0]?.view)) === "over", "walking keys don't reach the game, which stays on the screen as you move");
await shot("6-walking-by");

// back to it: the same game, still joined
await ev((n) => window.__chimp.arcade.use(n), SLOT);
await waitFor(() => window.__chimp.state().focus?.phase === "on" && !!window.__chimp.state().focusRect, null, 5000);
await page.waitForTimeout(300);
for (const k of ["ArrowRight", "ArrowDown"]) {
  await page.keyboard.press(k);
  await page.waitForTimeout(40);
}
const k3 = await keysOf();
check((await marked()) && k3.game.endsWith("ArrowRight ArrowDown"), "playing it again picks up the same game, keys and all", `game heard [${k3.game}], play page got [${k3.page}]`);

// ------------------------------------------------ quit and walk on
await page.click(".focus-bar .quit");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await settle(10);
check(!page.frames().some((f) => f.url().startsWith(`${playOrigin}/`)) && (await ev(() => window.__chimp.arcade.running().length)) === 0, "Quit removes the play page and the game (their connection ends)");
const p0 = await ev(() => window.__chimp.pose());
check(await ev(() => window.__chimp.state().walking), "back at the cabinet, walking");
await page.keyboard.down("KeyS");
await page.waitForTimeout(900);
await page.keyboard.up("KeyS");
await settle(5);
const p1 = await ev(() => window.__chimp.pose());
const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
check(moved > 1, "walks on afterwards", `moved ${moved.toFixed(2)} m`);
await shot("7-walked-on");

// ------------------------------------------------ out of order: pages that don't load properly
const withUrl = (n, url) =>
  ev(
    ([n, url]) => {
      const c = window.__chimp;
      const id = c.arcade.games().find((g) => g.slot === n).gameId;
      c.arcade.setGames(c.arcade.entries().map((g) => (g.gameId === id ? { ...g, playUrl: url } : g)));
    },
    [n, url],
  );
for (const [what, url, reason] of [
  ["a 404", `${playOrigin}/no-such-game`, "ChimpVibe answered with an error"],
  ["a page that won't be framed here (the live site)", "https://play.chimpvibe.dev/ssnake", "ChimpVibe won't let it show here"],
]) {
  await withUrl(SLOT, url);
  // watch the game's frame all the while: the broken page must never show
  await ev(() => {
    window.__seen = false;
    window.__watch = setInterval(() => {
      const f = document.querySelector("iframe.play-frame");
      if (f && getComputedStyle(f).visibility === "visible") window.__seen = true;
    }, 30);
  });
  const t0 = Date.now();
  await ev((n) => window.__chimp.arcade.use(n), SLOT);
  await waitFor((n) => window.__chimp.arcade.outOfOrder().some((o) => o.slot === n), SLOT, 15000).catch(() => {});
  const took = (Date.now() - t0) / 1000;
  const seen = await ev(() => (clearInterval(window.__watch), window.__seen));
  check(took < 3 && !seen, `${what}: out of order ${took.toFixed(1)} s after E, the broken page never shown`);
  await waitFor(() => window.__chimp.state().focus === null, null, 5000).catch(() => {});
  await settle(5);
  const oo = await ev(() => window.__chimp.arcade.outOfOrder());
  const screen = await ev((n) => window.__chimp.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n)?.material?.emissiveTexture?.metadata, SLOT);
  check(oo[0]?.reason === reason && screen?.outOfOrder === reason && (await ev(() => window.__chimp.arcade.running().length)) === 0, `${what} puts the cabinet out of order`, oo[0]?.reason);
}
await shot("8-out-of-order");
await withUrl(SLOT, game.playUrl);
await ev((n) => window.__chimp.arcade.use(n), SLOT);
await waitFor(() => window.__chimp.state().focus?.phase === "on", null, 8000).catch(() => {});
await page.waitForTimeout(2500);
check((await ev(() => window.__chimp.arcade.outOfOrder().length)) === 0 && (await ev(() => window.__chimp.arcade.running().length)) === 1, "with the working page back, trying again plays it");
await page.click(".focus-bar .quit");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
await browser.close();
process.exit(failed ? 1 : 0);
