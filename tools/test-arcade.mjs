// Round trip at an arcade cabinet, in a real browser against the running preview
// (npm run dev): the slots and cabinets, walking up to a cabinet, playing its
// game (the same-origin stand-in, public/arcade/standin.html, until ChimpVibe
// lets ChimpHouse frame its games), leaving and walking on.
//   node tools/test-arcade.mjs [slot]          (default slot 3)
//   GAME=real node tools/test-arcade.mjs       the real games from the list, not the stand-in
// Screenshots: captures/arcade-*.png. Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
const SLOT = Number(process.argv[2] ?? 3);
const STANDIN = process.env.GAME !== "real";
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
const shot = (name) => page.screenshot({ path: `captures/arcade-${name}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (n = 10) => ev((n) => window.__chimp.settle(n), n);
const waitFor = (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });

await page.goto(`${URL}/?pov=first&view=game${STANDIN ? "&arcade=standin" : ""}`);
await waitFor(() => window.__chimp?.ready === true, null, 300000);
await ev(() => window.__chimp.arcade.ready());
await settle(20);

// ------------------------------------------------ 1. slots, found by metadata alone
const slots = await ev(() =>
  window.__chimp.scene.transformNodes
    .filter((n) => n.metadata?.role === "cabinet-slot")
    .map((n) => ({ slot: n.metadata.slot, room: n.metadata.room, stand: n.metadata.stand, name: n.name })),
);
check(slots.length === 8, "the Game Room has 8 cabinet slots", slots.map((s) => s.slot).join(","));
const slot3 = await ev(() => {
  const n = window.__chimp.scene.transformNodes.find((n) => n.metadata?.role === "cabinet-slot" && n.metadata?.slot === 3);
  return n && { name: n.name, pos: n.position.asArray().map((v) => +v.toFixed(2)), stand: n.metadata.stand };
});
check(!!slot3, 'code finds "cabinet slot 3" by its metadata', JSON.stringify(slot3));

// ------------------------------------------------ 2-3. cabinets from the game list
const games = await ev(() => window.__chimp.arcade.games());
const source = await ev(() => window.__chimp.arcade.source());
check(games.length === 8, `8 cabinets from the game list (source: ${source})`, games.map((g) => `${g.slot}:${g.name}`).join(", "));
const screens = await ev(() => window.__chimp.scene.meshes.filter((m) => m.metadata?.role === "cabinet-screen").map((m) => m.metadata.slot));
check(screens.length === 8, "each cabinet has a screen with the cabinet-screen role", screens.join(","));
const crops = await ev(() => window.__chimp.scene.textures.filter((t) => /textures\/screens\/(marquee|screen)-/.test(t.name ?? t.url ?? "")).length);
check(crops === 0, "no concept-art crops used for cabinets");
// the art replaces each screen's placeholder once it loads (cabinet.ts marks the texture)
await waitFor(() => window.__chimp.scene.meshes.filter((m) => m.metadata?.role === "cabinet-screen" && m.material?.emissiveTexture?.metadata?.art).length === 8, null, 15000).catch(() => {});
const art = await ev(() => window.__chimp.scene.meshes.filter((m) => m.metadata?.role === "cabinet-screen").map((m) => m.material?.emissiveTexture?.metadata?.art ?? null));
check(art.length === 8 && art.every(Boolean), "every screen shows its game's art", art.map((a) => (a ? a.split("/").pop() : "none")).join(", "));

const roomMeshes = () => ev(() => window.__chimp.scene.meshes.filter((m) => m.metadata && m.metadata.kind !== "dynamic").length);
const before = await roomMeshes();
const all = await ev(() => fetch("/arcade/chimphouse.json").then((r) => r.json()));
await ev((g) => window.__chimp.arcade.setGames(g.games.slice(0, 7).map((x) => ({ ...x, art: null }))), all);
const after7 = await ev(() => ({ games: window.__chimp.arcade.games().map((g) => g.slot), screens: window.__chimp.scene.meshes.filter((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === 8).length }));
check(after7.games.length === 7 && after7.screens === 0, "removing a game from the list empties its slot", `filled: ${after7.games.join(",")}`);
await ev(() => window.__chimp.arcade.refresh());
const back = await ev(() => window.__chimp.arcade.games().length);
check(back === 8 && (await roomMeshes()) === before, "adding it back fills the slot, without rebuilding the room", `${before} room meshes before and after`);
await settle(20);

// ------------------------------------------------ 4. walk up to the cabinet
// start 3.5 m in front of the cabinet, facing it, in walk mode; walk forward until it's offered
await ev((n) => {
  const c = window.__chimp;
  const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
  const wm = node.computeWorldMatrix(true);
  const BABYLON = node.position.constructor;
  const start = BABYLON.TransformCoordinates(new BABYLON(0.25, 1.6, -3.6), wm);
  const at = BABYLON.TransformCoordinates(new BABYLON(0, 1.2, 0), wm);
  const yaw = Math.atan2(at.x - start.x, at.z - start.z);
  c.setPose({ x: start.x, y: start.y, z: start.z, yaw, pitch: 0.12, fov: 1.2 });
  c.setWalking(true);
}, SLOT);
await settle(10);
check(await ev(() => window.__chimp.state().walking), "walking in the Game Room", await ev(() => window.__chimp.state().area));
await shot("1-approach");
await page.keyboard.down("KeyW");
let offered = true;
try {
  await waitFor((n) => window.__chimp.state().arcadePrompt?.slot === n, SLOT, 6000);
} catch {
  offered = false;
}
await page.keyboard.up("KeyW");
await settle(15);
const prompt = await ev(() => window.__chimp.state().arcadePrompt);
check(offered && prompt?.slot === SLOT, "walking up to it offers its game", prompt ? `E · Play ${prompt.name}` : "nothing offered");
await shot("2-walked-up");

// ------------------------------------------------ play
const pressed = await page.keyboard.press("KeyE").then(() => Date.now());
await waitFor(() => window.__chimp.state().focus?.phase === "on" && !!window.__chimp.state().focusRect, null, 5000);
await settle(10);
const playing = await ev(() => window.__chimp.state().focus);
check(!!playing, `E plays it (${((Date.now() - pressed) / 1000).toFixed(1)} s to arrive)`, playing && `${playing.name} · ${playing.url}`);
check(!(await ev(() => !!document.pointerLockElement)), "the mouse is free");
const square = await ev((n) => {
  const c = window.__chimp;
  const screen = c.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n);
  const V = screen.position.constructor;
  const out = V.TransformNormal(new V(0, 0, -1), screen.computeWorldMatrix(true)).normalize();
  const fwd = c.scene.activeCamera.getDirection(new V(0, 0, 1));
  return -V.Dot(out, fwd);
}, SLOT);
check(square > 0.9999, "the camera is square onto the tilted screen", `cos = ${square.toFixed(6)}`);

const align = async () => {
  const want = await ev((n) => window.__chimp.arcade.screenRect(n), SLOT);
  const got = await ev(() => {
    const r = document.querySelector("iframe.play-frame").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const err = Math.max(Math.abs(want.x - got.x), Math.abs(want.y - got.y), Math.abs(want.w - got.w), Math.abs(want.h - got.h));
  return { want, got, err };
};
const a1 = await align();
const vw = page.viewportSize();
check(a1.err < 1, "the game's frame lies exactly over the screen", `off by ${a1.err.toFixed(2)} px; ${Math.round(a1.got.w)} x ${Math.round(a1.got.h)} px = ${((a1.got.h / vw.height) * 100).toFixed(0)}% of the height`);
await shot("3-playing");

const frame = page.frames().find((f) => f.url().includes(STANDIN ? "arcade/standin.html" : playing.url));
const keysIn = async () => (frame ? frame.evaluate(() => window.received?.length ?? -1) : -1);
const houseState = () =>
  ev(() => {
    const s = window.__chimp.state();
    return JSON.stringify({ pose: window.__chimp.pose(), walking: s.walking, night: s.night, view: s.viewId, roof: s.roofHidden, upper: s.upperHidden, help: s.help, inspect: s.inspectMode, focus: s.focus?.phase });
  });
const h0 = await houseState();
if (STANDIN) {
  check(await frame.evaluate(() => document.hasFocus()), "the game has the keyboard without a click");
  for (const k of ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyF", "KeyN", "KeyE", "Digit1", "KeyH", "KeyR", "ArrowUp"]) await page.keyboard.press(k);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyW");
  const got = await frame.evaluate(() => window.received.join(" "));
  check(got.startsWith("KeyW KeyA KeyS KeyD Space KeyF KeyN KeyE Digit1 KeyH KeyR ArrowUp KeyW"), "keys reach the game's frame", got.length > 120 ? got.slice(0, 120) + "…" : got);
}
await settle(10);
check((await houseState()) === h0, "ChimpHouse ignores keys sent to the game (camera, walk, night, views, help…)");

// focus back on ChimpHouse's page (a click on the frame's title): its keys still do nothing
await page.click(".focus-bar.top .name");
const n0 = await keysIn();
for (const k of ["KeyF", "KeyN", "Digit2", "KeyU", "KeyE"]) await page.keyboard.press(k);
await page.keyboard.down("KeyD");
await page.waitForTimeout(400);
await page.keyboard.up("KeyD");
await settle(10);
check((await houseState()) === h0, "ChimpHouse's own keys do nothing while playing, even with the page focused", `the game got ${(await keysIn()) - n0} of them`);

// a click on the scene round the game doesn't capture the mouse
await ev(() => {
  const c = document.querySelector("canvas.scene");
  window.__lockCalls = 0;
  const orig = c.requestPointerLock.bind(c);
  c.requestPointerLock = (...a) => (window.__lockCalls++, orig(...a));
});
await page.mouse.click(vw.width - 40, vw.height / 2);
await settle(5);
check((await ev(() => window.__lockCalls)) === 0 && !(await ev(() => !!document.pointerLockElement)), "a click on the scene doesn't capture the mouse");
if (STANDIN) {
  await page.mouse.click(a1.got.x + a1.got.w / 2, a1.got.y + a1.got.h / 2);
  await page.keyboard.press("KeyQ");
  check((await frame.evaluate(() => window.received.at(-1))) === "KeyQ", "clicking the game gives it the keyboard back");
}

// resize: the frame follows the screen
await page.setViewportSize({ width: 1180, height: 820 });
await settle(20);
const a2 = await align();
check(a2.err < 1, "after a window resize the frame still lies over the screen", `off by ${a2.err.toFixed(2)} px at 1180 x 820; ${Math.round(a2.got.w)} x ${Math.round(a2.got.h)} px`);
await shot("4-resized");
await page.setViewportSize(vw);
await settle(20);
const a3 = await align();
check(a3.err < 1, "and back", `off by ${a3.err.toFixed(2)} px`);

// ------------------------------------------------ leave
await page.click(".focus-bar .leave");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await settle(10);
const left = await ev(() => ({ frames: document.querySelectorAll("iframe.play-frame").length, walking: window.__chimp.state().walking, pose: window.__chimp.pose() }));
check(left.frames === 0, "Leave removes the game's frame");
check(!page.frames().some((f) => f.url().includes("arcade/standin.html") || f.url().includes("play.chimpvibe.dev")), "the game's page is gone (its connection ends)");
const stand = await ev((n) => {
  const node = window.__chimp.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
  const V = node.position.constructor;
  return V.TransformCoordinates(V.FromArray(node.metadata.stand), node.computeWorldMatrix(true)).asArray();
}, SLOT);
const off = Math.hypot(left.pose.x - stand[0], left.pose.z - stand[2]);
check(left.walking && off < 0.4, "back at the stand point, walking", `${off.toFixed(2)} m from it`);
await shot("5-left");

// ------------------------------------------------ walk on
const p0 = await ev(() => window.__chimp.pose());
await page.keyboard.down("KeyA");
await page.waitForTimeout(800);
await page.keyboard.up("KeyA");
await page.keyboard.down("KeyS");
await page.waitForTimeout(800);
await page.keyboard.up("KeyS");
await settle(5);
const p1 = await ev(() => window.__chimp.pose());
const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
check(moved > 1, "walks on afterwards", `moved ${moved.toFixed(2)} m`);
await shot("6-walked-on");

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
await browser.close();
process.exit(failed ? 1 : 0);
