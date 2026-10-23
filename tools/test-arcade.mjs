// Round trip at an arcade cabinet, in a real browser against the running preview
// (npm run dev): the slots and cabinets, walking up to a cabinet, playing its
// game (the stand-in play page, public/arcade/standin.html, until ChimpVibe
// lets ChimpHouse frame its games: cross-origin, with the game in a frame inside
// it, and losing the first key as ChimpVibe's page can), leaving and walking on.
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
const consoleLines = [];
page.on("console", (m) => consoleLines.push(m.text()));
const shot = (name) => page.screenshot({ path: `captures/arcade-${name}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (n = 10) => ev((n) => window.__chimp.settle(n), n);
const waitFor = (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });

await page.goto(`${URL}/house.html?pov=first&view=game${STANDIN ? "&arcade=standin" : ""}`);
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
check(
  (await ev(() => window.__chimp.arcade.games().every((g) => new URL(g.playUrl).searchParams.get("embed") === "1"))),
  "games open in ChimpVibe's embed mode (embed=1)",
);
const screens = await ev(() => window.__chimp.scene.meshes.filter((m) => m.metadata?.role === "cabinet-screen").map((m) => m.metadata.slot));
check(screens.length === 8, "each cabinet has a screen with the cabinet-screen role", screens.join(","));
const crops = await ev(() => window.__chimp.scene.textures.filter((t) => /textures\/screens\/(marquee|screen)-/.test(t.name ?? t.url ?? "")).length);
check(crops === 0, "no concept-art crops used for cabinets");
// the art replaces each screen's placeholder once it loads (cabinet.ts marks the texture)
await waitFor(() => window.__chimp.scene.meshes.filter((m) => m.metadata?.role === "cabinet-screen" && m.material?.emissiveTexture?.metadata?.art).length === 8, null, 15000).catch(() => {});
const art = await ev(() => window.__chimp.scene.meshes.filter((m) => m.metadata?.role === "cabinet-screen").map((m) => m.material?.emissiveTexture?.metadata?.art ?? null));
check(art.length === 8 && art.every(Boolean), "every screen shows its game's art", art.map((a) => (a ? a.split("/").pop() : "none")).join(", "));

const stools = await ev(() =>
  window.__chimp.scene.meshes.filter((m) => m.metadata?.room === "gameRoom" && m.metadata.labels?.some((l) => /stool/i.test(l.label))).length,
);
check(stools === 0, "no stools in front of the cabinets");

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
// how far out from the screen the walker stands
const aheadOf = (n) =>
  ev((n) => {
    const c = window.__chimp;
    const screen = c.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n);
    const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
    const V = node.position.constructor;
    const f = c.walker().feet;
    const p = screen.getAbsolutePosition();
    const front = node.getDirection(new V(0, 0, -1));
    return (f.x - p.x) * front.x + (f.z - p.z) * front.z;
  }, n);
const offeredAt = await aheadOf(SLOT);
check(offered && prompt?.slot === SLOT && offeredAt <= 1.16, "walking up to it offers its game, only within about a metre", prompt ? `E · Play ${prompt.name}, ${offeredAt.toFixed(2)} m out from its screen` : "nothing offered");
// stand at a spot near the cabinet, facing it: is it offered?
const offeredFrom = (ahead, aside) =>
  ev(
    async ([n, ahead, aside]) => {
      const c = window.__chimp;
      const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
      const V = node.position.constructor;
      const wm = node.computeWorldMatrix(true);
      const at = V.TransformCoordinates(new V(aside, 1.6, -ahead), wm);
      const to = V.TransformCoordinates(new V(0, 1.2, 0), wm);
      c.setWalking(false);
      c.setPose({ x: at.x, y: at.y, z: at.z, yaw: Math.atan2(to.x - at.x, to.z - at.z), pitch: 0.1, fov: 1.2 });
      c.setWalking(true);
      await c.settle(5);
      return c.state().arcadePrompt?.slot === n;
    },
    [SLOT, ahead, aside],
  );
const tooFar = await offeredFrom(1.6, 0);
const aside = await offeredFrom(0.9, 0.6);
const near = await offeredFrom(0.9, 0);
check(!tooFar && !aside && near, "not offered from 1.6 m out or half a cabinet aside; offered at 0.9 m in front");
await offeredFrom(1.0, 0);
await settle(10);
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

// the stand-in is two frames, like a real game: the play page, and the game in a locked-down frame inside it
const shell = page.frames().find((f) => f.url().includes(STANDIN ? "arcade/standin.html" : playing.url));
const frame = STANDIN ? page.frames().find((f) => f.url().includes("arcade/standin-game.html")) : shell;
check(!STANDIN || (!!shell && !!frame && new globalThis.URL(shell.url()).origin !== new globalThis.URL(page.url()).origin), "the stand-in play page is cross-origin, with the game in a frame inside it", shell && new globalThis.URL(shell.url()).origin);
const keysIn = async () => (frame ? frame.evaluate(() => window.received?.length ?? -1) : -1);
const houseState = () =>
  ev(() => {
    const s = window.__chimp.state();
    return JSON.stringify({ pose: window.__chimp.pose(), walking: s.walking, night: s.night, view: s.viewId, roof: s.roofHidden, upper: s.upperHidden, help: s.help, inspect: s.inspectMode, focus: s.focus?.phase });
  });
const h0 = await houseState();
const prompting = () => ev(() => !!document.querySelector(".focus-bar .focus-start"));
if (!STANDIN) {
  await page.waitForTimeout(1500);
  check(!(await prompting()), "a play page that sends no messages gets the usual hint, not the start prompt");
}
if (STANDIN) {
  await waitFor(() => !!document.querySelector(".focus-bar .focus-start"), null, 4000).catch(() => {});
  check(await prompting(), "the frame asks for any key to start");
  // the first key on its own: ChimpVibe found it lands on the play page instead of the game
  // (the prompt gives up after 12 s, which a slow run can reach before here)
  const upBefore = await prompting();
  await page.keyboard.press("KeyW");
  await page.waitForTimeout(150);
  const first = { game: await frame.evaluate(() => window.received.join(" ")), page: await shell.evaluate(() => window.missed.join(" ")) };
  const lost = first.game === "";
  check(lost && upBefore ? await prompting() : true, "a lost first key leaves the prompt up", `game got [${first.game}], play page got [${first.page}]${upBefore ? "" : "; the prompt had already timed out"}`);
  if (lost) {
    await page.keyboard.press("KeyW");
    await waitFor(() => !document.querySelector(".focus-bar .focus-start") && !!document.querySelector(".focus-bar .focus-hint"), null, 3000).catch(() => {});
  }
  check((await frame.evaluate(() => window.received[0])) === "KeyW" && !(await prompting()), "the next key starts the game, and the prompt gives way to the usual hint");
  await shot("3b-started");
  for (const k of ["KeyA", "KeyS", "KeyD", "Space", "KeyF", "KeyN", "KeyE", "Digit1", "KeyH", "KeyR", "ArrowUp"]) await page.keyboard.press(k);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyW");
  const got = await frame.evaluate(() => window.received.join(" "));
  check(got === "KeyW KeyA KeyS KeyD Space KeyF KeyN KeyE Digit1 KeyH KeyR ArrowUp KeyW", "every key after that reaches the game", got.length > 120 ? got.slice(0, 120) + "…" : got);
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

// ------------------------------------------------ step back: the game keeps running
// a mark in the game's page shows it is the same page afterwards, not reloaded
const gameFrame = () => page.frames().find((f) => f.url().includes(STANDIN ? "arcade/standin-game.html" : playing.url));
await gameFrame()?.evaluate(() => (window.__mark = "still here"));
const marked = async () => (await gameFrame()?.evaluate(() => window.__mark).catch(() => null)) === "still here";
await page.click(".focus-bar .leave.secondary");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await settle(10);
const left = await ev(() => ({ frames: document.querySelectorAll("iframe.play-frame").length, walking: window.__chimp.state().walking, pose: window.__chimp.pose(), running: window.__chimp.arcade.running() }));
check(left.frames === 1 && left.running.length === 1 && (await marked()), "Step back leaves the game running in its frame (not reloaded)", left.running.map((g) => `${g.slot}:${g.name} ${g.view}`).join(", "));
const stand = await ev((n) => {
  const node = window.__chimp.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
  const V = node.position.constructor;
  return V.TransformCoordinates(V.FromArray(node.metadata.stand), node.computeWorldMatrix(true)).asArray();
}, SLOT);
const off = Math.hypot(left.pose.x - stand[0], left.pose.z - stand[2]);
check(left.walking && off < 0.4, "back at the stand point, walking", `${off.toFixed(2)} m from it`);
// the frame over the screen in perspective: its box on the page matches the screen's corners'
const skew = () =>
  ev((n) => {
    const c = window.__chimp;
    const f = document.querySelector("iframe.play-frame");
    const q = c.arcade.screenQuad(n);
    const b = f.getBoundingClientRect();
    const xs = q.map((p) => p.x);
    const ys = q.map((p) => p.y);
    const err = Math.max(Math.abs(b.left - Math.min(...xs)), Math.abs(b.right - Math.max(...xs)), Math.abs(b.top - Math.min(...ys)), Math.abs(b.bottom - Math.max(...ys)));
    return { view: c.arcade.running().find((g) => g.slot === n)?.view, visible: getComputedStyle(f).visibility, transform: f.style.transform.slice(0, 8), pointer: getComputedStyle(f).pointerEvents, err };
  }, SLOT);
const k = await skew();
check(k.view === "over" && k.visible === "visible" && k.transform === "matrix3d" && k.err < 1.5, "the game shows on the cabinet's screen in perspective", `${k.view}, ${k.transform}, off by ${k.err.toFixed(2)} px`);
check(k.pointer === "none", "it doesn't take clicks or the mouse while you walk about");
const hole = await ev((n) => ({
  z: document.querySelector("iframe.play-frame").style.zIndex,
  mat: window.__chimp.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n)?.material?.name,
}), SLOT);
check(hole.z === "0" && hole.mat === "screenHole", "it is seen through the scene: under the canvas, through a hole drawn where the screen is", `z-index ${hole.z}, screen drawn with ${hole.mat}`);

// from the side, with the next cabinet covering part of the screen: still shown, the cabinet in front of it
await ev((n) => {
  const c = window.__chimp;
  const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
  const V = node.position.constructor;
  const wm = node.computeWorldMatrix(true);
  const at = V.TransformCoordinates(new V(1.9, 1.6, -1.0), wm);
  const to = V.TransformCoordinates(new V(0, 1.3, 0), wm);
  c.setPose({ x: at.x, y: at.y, z: at.z, yaw: Math.atan2(to.x - at.x, to.z - at.z), pitch: 0.1, fov: 1.2 });
}, SLOT);
await settle(10);
const side = await skew();
check(side.view === "over" && side.visible === "visible", "partly hidden behind the next cabinet, it still shows", side.view);
await shot("5b-partly-hidden");
await ev((n) => {
  const c = window.__chimp;
  const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
  const V = node.position.constructor;
  const wm = node.computeWorldMatrix(true);
  const at = V.TransformCoordinates(V.FromArray(node.metadata.stand), wm);
  const to = V.TransformCoordinates(new V(0, 1.3, 0), wm);
  c.setPose({ x: at.x, y: 1.55 + at.y, z: at.z, yaw: Math.atan2(to.x - at.x, to.z - at.z), pitch: 0.1, fov: 1.2 });
}, SLOT);
await settle(10);
await shot("5-stepped-back");

// keys walk the visitor again (backwards, keeping the screen in view), and don't reach the game
const n1 = await keysIn();
const p0 = await ev(() => window.__chimp.pose());
await page.keyboard.down("KeyS");
await page.waitForTimeout(700);
await page.keyboard.up("KeyS");
await settle(5);
const p1 = await ev(() => window.__chimp.pose());
const sidestep = Math.hypot(p1.x - p0.x, p1.z - p0.z);
check(sidestep > 0.8 && (await keysIn()) === n1, "your keys walk you again, not the game", `moved ${sidestep.toFixed(2)} m; the game got ${(await keysIn()) - n1} keys`);
const k2 = await skew();
check(k2.view === "over" && k2.err < 1.5, "the game stays on the screen as you move", `${k2.view}, off by ${k2.err.toFixed(2)} px`);
await shot("6-walking-by");

// turned away: hidden, still running
await ev(() => {
  const p = window.__chimp.pose();
  window.__chimp.setPose({ ...p, yaw: p.yaw + Math.PI });
});
await settle(10);
const k3 = await skew();
check(k3.view === "hidden" && k3.visible === "hidden" && (await marked()), "turned away, the game hides but keeps running", k3.view);
await ev(() => {
  const p = window.__chimp.pose();
  window.__chimp.setPose({ ...p, yaw: p.yaw - Math.PI });
});
await settle(10);

// back to it: the same game, picked up where it is
await ev((n) => window.__chimp.arcade.use(n), SLOT);
await waitFor(() => window.__chimp.state().focus?.phase === "on" && !!window.__chimp.state().focusRect, null, 5000);
await settle(10);
// the stand-in loses the first key after each hand-off, as ChimpVibe's page can
await page.keyboard.press("KeyZ");
await page.keyboard.press("KeyX");
await page.waitForTimeout(150);
const lastKey = STANDIN ? await frame.evaluate(() => window.received.at(-1)) : null;
check((await marked()) && (!STANDIN || lastKey === "KeyX"), "playing it again picks up the same game, keys and all", STANDIN ? `last key ${lastKey}` : "");
check((await align()).err < 1, "square on again, over the screen");

// ------------------------------------------------ quit
await page.click(".focus-bar .quit");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await settle(10);
check((await ev(() => document.querySelectorAll("iframe.play-frame").length)) === 0 && (await ev(() => window.__chimp.arcade.running().length)) === 0, "Quit removes the game's frame");
check((await ev((n) => window.__chimp.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n)?.material?.name, SLOT)) !== "screenHole", "and its screen shows the game's art again");
check(!page.frames().some((f) => f.url().includes("arcade/standin.html") || f.url().includes("play.chimpvibe.dev")), "the game's page is gone (its connection ends)");
check(await ev(() => window.__chimp.state().walking), "and you walk on");

// quit from the side panel, after stepping back
await ev((n) => window.__chimp.arcade.use(n), SLOT);
await waitFor(() => window.__chimp.state().focus?.phase === "on", null, 5000);
await page.click(".focus-bar .leave.secondary");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await settle(5);
await page.click(".arcade-running button");
await settle(5);
check((await ev(() => document.querySelectorAll("iframe.play-frame").length)) === 0, "a running game can be quit from the side panel too");

// ------------------------------------------------ walk on
const q0 = await ev(() => window.__chimp.pose());
await page.keyboard.down("KeyS");
await page.waitForTimeout(800);
await page.keyboard.up("KeyS");
await settle(5);
const q1 = await ev(() => window.__chimp.pose());
const moved = Math.hypot(q1.x - q0.x, q1.z - q0.z);
check(moved > 1, "walks on afterwards", `moved ${moved.toFixed(2)} m`);
await shot("7-walked-on");

// ------------------------------------------------ a game left alone quits by itself
// (3 minutes; here ?arcadeAway=8 makes it 8 s)
await page.goto(`${URL}/house.html?view=game&arcadeAway=8${STANDIN ? "&arcade=standin" : ""}`);
await waitFor(() => window.__chimp?.ready === true, null, 300000);
await ev(() => window.__chimp.arcade.ready());
await settle(10);
const goTo = (n, back) =>
  ev(
    ([n, back]) => {
      const c = window.__chimp;
      const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
      const V = node.position.constructor;
      const wm = node.computeWorldMatrix(true);
      const at = V.TransformCoordinates(new V(0, 1.6, -back), wm);
      const look = V.TransformCoordinates(new V(0, 1.2, 0), wm);
      c.setWalking(false);
      c.setPose({ x: at.x, y: at.y, z: at.z, yaw: Math.atan2(look.x - at.x, look.z - at.z), pitch: 0.1, fov: 1.2 });
      c.setWalking(true);
    },
    [n, back],
  );
await goTo(SLOT, 1.2);
await settle(5);
await ev((n) => window.__chimp.arcade.use(n), SLOT);
await waitFor(() => window.__chimp.state().focus?.phase === "on", null, 5000);
await page.click(".focus-bar .leave.secondary");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await page.waitForTimeout(1000);
const quitsAt = () => ev(() => (window.__chimp.state().arcadeRunning.length ? window.__chimp.state().arcadeRunning[0].quitsAt : "gone"));
const clock1 = await quitsAt();
const panel = await ev(() => document.querySelector(".arcade-running em")?.textContent);
check(typeof clock1 === "number" && /quits in 0:0\d/.test(panel ?? ""), "stepping back starts its clock, shown in the side panel, even standing at the cabinet", panel);
await goTo(SLOT, 0.9);
await settle(5);
check((await quitsAt()) === clock1, "standing right at the cabinet doesn't reset it");
await ev((n) => window.__chimp.arcade.use(n), SLOT);
await waitFor(() => window.__chimp.state().focus?.phase === "on", null, 5000);
check((await quitsAt()) === null, "playing it again stops the clock");
await page.click(".focus-bar .leave.secondary");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await settle(5);
const clock2 = await quitsAt();
check(typeof clock2 === "number" && clock2 > clock1, "and stepping back starts it afresh");
await waitFor(() => window.__chimp.arcade.running().length === 0, null, 15000).catch(() => {});
const toast = await ev(() => window.__chimp.state().toast);
check((await ev(() => document.querySelectorAll("iframe.play-frame").length)) === 0 && /quit/.test(toast ?? ""), "left alone, even beside its cabinet, it quits by itself", toast);

// ------------------------------------------------ out of order
// the game's page reports an error, ChimpVibe can't be reached, then it works again
const withUrl = (n, make) =>
  ev(
    ([n, make]) => {
      const c = window.__chimp;
      const slotGame = c.arcade.games().find((g) => g.slot === n);
      // the games as loaded, one play address changed: the cabinets stay as they are
      c.arcade.setGames(c.arcade.entries().map((g) => (g.gameId === slotGame.gameId ? { ...g, playUrl: new Function("url", `return ${make}`)(g.playUrl) } : g)));
    },
    [n, make],
  );
const cabinetScreen = (n) => ev((n) => window.__chimp.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n)?.material?.emissiveTexture?.metadata ?? null, n);
await goTo(SLOT, 1.2);
await settle(5);
await withUrl(SLOT, "url + '&fail=' + encodeURIComponent('Game unavailable')");
await ev((n) => window.__chimp.arcade.use(n), SLOT);
await waitFor((n) => window.__chimp.arcade.outOfOrder().some((o) => o.slot === n), SLOT, 10000).catch(() => {});
await waitFor(() => window.__chimp.state().focus === null, null, 5000).catch(() => {});
await settle(10);
const oo1 = { list: await ev(() => window.__chimp.arcade.outOfOrder()), running: await ev(() => window.__chimp.arcade.running().length), toast: await ev(() => window.__chimp.state().toast), screen: await cabinetScreen(SLOT) };
check(oo1.list[0]?.reason === "Game unavailable" && oo1.running === 0 && oo1.screen?.outOfOrder === "Game unavailable", "an error on ChimpVibe's page puts the cabinet out of order: the game closes", oo1.toast);
check((await ev(() => window.__chimp.state().focus)) === null && (await ev(() => window.__chimp.state().walking)), "and you're back in front of it, walking");
await page.keyboard.down("KeyW");
await page.waitForTimeout(150);
await page.keyboard.up("KeyW");
await settle(10);
const tryAgain = await ev(() => window.__chimp.state().arcadePrompt);
check(!!tryAgain?.outOfOrder, "its screen says OUT OF ORDER, and E offers to try it again", tryAgain && `E · Try ${tryAgain.name} again`);
await shot("8-out-of-order");

await withUrl(SLOT, "'http://127.0.0.1:9/nothing'");
await ev((n) => window.__chimp.arcade.use(n), SLOT);
await waitFor((n) => window.__chimp.arcade.outOfOrder().some((o) => o.slot === n), SLOT, 10000).catch(() => {});
await waitFor(() => window.__chimp.state().focus === null, null, 5000).catch(() => {});
const oo2 = await ev(() => window.__chimp.arcade.outOfOrder());
check(oo2[0]?.reason === "ChimpVibe can't be reached" && (await cabinetScreen(SLOT))?.outOfOrder === oo2[0]?.reason, "ChimpVibe not answering puts it out of order too", oo2[0]?.reason);

await withUrl(SLOT, "location.origin.replace('localhost', '127.0.0.1') + '/arcade/standin.html?game=Retry'");
await settle(5);
await ev((n) => window.__chimp.arcade.use(n), SLOT);
await waitFor(() => window.__chimp.state().focus?.phase === "on", null, 8000).catch(() => {});
await page.waitForTimeout(1500);
const again = { list: await ev(() => window.__chimp.arcade.outOfOrder()), running: await ev(() => window.__chimp.arcade.running().length), screen: await cabinetScreen(SLOT) };
check(again.list.length === 0 && again.running === 1 && !again.screen?.outOfOrder, "once ChimpVibe works again, trying it again plays it");
await page.click(".focus-bar .quit");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);

// ------------------------------------------------ ChimpVibe's embed-mode messages
const standinAt = (q) => `location.origin.replace('localhost', '127.0.0.1') + '/arcade/standin.html?game=Embed&embed=1${q}'`;
const shellFrame = () => page.frames().find((f) => f.url().includes("arcade/standin.html"));
const envelope = (fields) => ({ protocol: "chimpvibe-embed", version: 1, ...fields });
const playIt = async () => {
  await ev((n) => window.__chimp.arcade.use(n), SLOT);
  await waitFor(() => window.__chimp.state().focus?.phase === "on" && !!window.__chimp.state().focusRect, null, 8000).catch(() => {});
  await page.waitForTimeout(800);
};
await withUrl(SLOT, standinAt(""));
await goTo(SLOT, 1.0);
await settle(5);
await playIt();
await shellFrame().evaluate(() => parent.postMessage({ type: "error", reason: "bare" }, "*"));
await ev((m) => window.postMessage(m, "*"), envelope({ type: "error", code: "other", reason: "forged" }));
await page.waitForTimeout(400);
check((await ev(() => window.__chimp.arcade.outOfOrder().length)) === 0 && (await ev(() => window.__chimp.arcade.running().length)) === 1, "messages without the envelope, or not from the game's page, are ignored");
await shellFrame().evaluate((m) => parent.postMessage(m, "*"), envelope({ type: "ended", reason: "disconnected" }));
await waitFor(() => /Disconnected/.test(document.querySelector(".focus-bar.top .status")?.textContent ?? ""), null, 3000).catch(() => {});
const ended = await ev(() => document.querySelector(".focus-bar.top .status")?.textContent);
check(ended === "Disconnected: press Play to reconnect" && (await ev(() => window.__chimp.state().focus?.phase)) === "on" && (await ev(() => window.__chimp.arcade.running().length)) === 1, '"ended" shows above the game, which stays open', ended);
await shot("9-ended");
await shellFrame().evaluate((m) => parent.postMessage(m, "*"), envelope({ type: "error", code: "full", reason: "Game is full" }));
await waitFor((n) => window.__chimp.arcade.outOfOrder().some((o) => o.slot === n), SLOT, 5000).catch(() => {});
await waitFor(() => window.__chimp.state().focus === null, null, 5000).catch(() => {});
await settle(10);
const full = { list: await ev(() => window.__chimp.arcade.outOfOrder()), screen: await cabinetScreen(SLOT), prompt: await ev(() => window.__chimp.state().arcadePrompt), toast: await ev(() => window.__chimp.state().toast) };
check(full.list[0]?.code === "full" && full.screen?.sign === "GAME FULL" && full.prompt?.full === true && (await ev(() => window.__chimp.arcade.running().length)) === 0, 'an "error" with code "full" shows GAME FULL, and E offers to try again', full.toast);
await shot("10-full");

// a page that sends no messages (no embed mode): checked as it starts, and shown once it has loaded
await withUrl(SLOT, standinAt("&silent=1"));
await playIt();
await waitFor(() => window.__chimp.arcade.running()[0]?.view === "on", null, 8000).catch(() => {});
const silent = { view: await ev(() => window.__chimp.arcade.running()[0]?.view), oo: await ev(() => window.__chimp.arcade.outOfOrder().length), checked: consoleLines.find((l) => /Embed: checked in/.test(l)) };
check(silent.view === "on" && silent.oo === 0, "a page that sends no messages is checked as it starts, and shown once it loads", silent.checked);
await page.click(".focus-bar .quit");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
await browser.close();
process.exit(failed ? 1 : 0);
