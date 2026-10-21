// Watching someone play at an arcade cabinet, as in a real arcade, in a real
// browser against the running preview (npm run dev): two tabs, two visitors in
// the room server. Ann plays the stand-in game (public/arcade/standin.html) at a
// cabinet; Bo stands elsewhere in the Game Room with the cabinet in view, presses
// nothing and focuses nothing, and sees Ann's game live on its screen: the
// stand-in's frame count and its bar, whose colour changes ten times a second,
// read back from Bo's own screenshots at the screen's place. Bo's watching stops
// when the cabinet leaves his view and starts again when it comes back; the
// cabinet shows its art again when Ann quits, and when her page closes. A game
// whose spectators never say they are showing, or that refuses spectators, leaves
// the art up with "In use by Ann". E at Ann's cabinet doesn't play it for Bo.
//   node tools/test-arcade-watch.mjs [slot]     (default slot 3; QUALITY=high runs both at high quality)
// Screenshots: $SHOTS/watch-*.png (SHOTS defaults to captures). Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const BASE = process.env.URL ?? "http://localhost:5173";
const QUALITY = process.env.QUALITY ?? "low";
const SHOTS = process.env.SHOTS ?? "captures";
const SLOT = Number(process.argv[2] ?? 3);
/** the stand-in's bar colours, one per tick (standin-game.html) */
const TICK_COLOURS = ["#ff2020", "#20e020", "#2040ff", "#ffe020", "#ff20ff", "#20e0ff"].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
await mkdir(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
// one context, two tabs: each its own visitor in the room server (and the stand-in's players and spectators share its session)
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

async function visitor(name) {
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  await page.addInitScript(() => {
    // headless Chrome can still trap the real cursor: never lock it
    Element.prototype.requestPointerLock = function () {};
    Element.prototype.requestFullscreen = async function () {};
  });
  await page.goto(`${BASE}/?pov=first&view=game&arcade=standin&name=${name}&quality=${QUALITY}`);
  await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 200 });
  await page.evaluate(() => window.__chimp.arcade.ready());
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const v = {
    name,
    page,
    ev,
    settle: (n = 10) => ev((n) => window.__chimp.settle(n), n),
    waitFor: (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true, () => false),
    shot: (what) => page.screenshot({ path: `${SHOTS}/watch-${what}.png` }),
  };
  await v.settle(20);
  return v;
}

/** Stand `ahead` m out from slot n's cabinet and `aside` m to its side, walking, looking at its screen (turned by `turn` radians). */
async function standBy(v, n, ahead, aside, turn = 0) {
  await v.ev(
    async ([n, ahead, aside]) => {
      const c = window.__chimp;
      const node = c.scene.transformNodes.find((t) => t.metadata?.role === "cabinet-slot" && t.metadata.slot === n);
      const V = node.position.constructor;
      const at = V.TransformCoordinates(new V(aside, 1.6, -ahead), node.computeWorldMatrix(true));
      c.setWalking(false);
      c.setPose({ x: at.x, y: at.y, z: at.z, yaw: 0, pitch: 0, fov: 1.1 });
      c.setWalking(true);
      await c.settle(6);
    },
    [n, ahead, aside],
  );
  await aim(v, n, turn);
}

/** Look at slot n's screen from where the chimp's eyes are (turned by `turn` radians). */
async function aim(v, n, turn = 0) {
  await v.ev(
    ([n, turn]) => {
      const c = window.__chimp;
      const screen = c.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n);
      const p = screen.getAbsolutePosition();
      const [x, y, z] = c.chimps.eye().at;
      const dx = p.x - x;
      const dz = p.z - z;
      c.setPose({ x, y, z, yaw: Math.atan2(dx, dz) + turn, pitch: -Math.atan2(p.y - y, Math.hypot(dx, dz)), fov: 1.1 });
    },
    [n, turn],
  );
  await v.settle(8);
}

/** Where (u, v) of slot n's screen (0–1 from its top-left) is on the page, in perspective. */
async function screenPoint(v, n, u, w) {
  const q = await v.ev((n) => window.__chimp.arcade.screenQuad(n), n);
  if (!q) return null;
  // the square-to-quad projective map (Heckbert): tl, tr, br, bl
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y;
  const z = g * u + h * w + 1;
  return { x: Math.round((a * u + b * w + p0.x) / z), y: Math.round((d * u + e * w + p0.y) / z) };
}

/** Bo's screenshot, and the colour at a point of it (the average of 3 x 3 pixels). */
async function colourAt(v, pt, name) {
  const buf = await v.page.screenshot(name ? { path: `${SHOTS}/watch-${name}.png` } : {});
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const i = ((pt.y + dy) * info.width + (pt.x + dx)) * info.channels;
      for (let k = 0; k < 3; k++) sum[k] += data[i + k];
    }
  return sum.map((s) => Math.round(s / 9));
}

/** Which of the stand-in's tick colours `c` is, or -1. */
const tickColour = (c) => {
  let best = -1;
  let bestD = 110;
  TICK_COLOURS.forEach((t, i) => {
    const d = Math.hypot(t[0] - c[0], t[1] - c[1], t[2] - c[2]);
    if (d < bestD) (best = i), (bestD = d);
  });
  return best;
};

const screenMat = (v, n) => v.ev((n) => window.__chimp.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n)?.material?.name, n);
const screenTex = (v, n) => v.ev((n) => window.__chimp.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n)?.material?.emissiveTexture?.metadata ?? null, n);
const watched = (v) => v.ev(() => window.__chimp.arcade.watched());
const seats = (v) => v.ev(() => window.__chimp.arcade.seats());
/** Bo's spectator frame of the stand-in, in his page (cross-origin: Playwright reaches into it). */
const spectatorFrame = (v) => v.page.frames().find((f) => f.url().includes("arcade/standin.html") && f.url().includes("role=spectator"));
const annGame = (v) => v.page.frames().find((f) => f.url().includes("arcade/standin-game.html"));

/** Ann plays slot n: she stands at it and E plays it, until her game says it is ready and her seat says so. */
async function annPlays(ann, n) {
  await ann.waitFor(() => window.__chimp.state().focus === null, null, 5000);
  await standBy(ann, n, 1.0, 0);
  await ann.waitFor((n) => window.__chimp.state().arcadePrompt?.slot === n, n, 4000);
  await ann.page.keyboard.press("KeyE");
  await ann.waitFor(() => window.__chimp.state().focus?.phase === "on", null, 6000);
  return ann.waitFor((n) => window.__chimp.arcade.seats().some((s) => s.slot === n && s.ready), n, 15000);
}

const ann = await visitor("Ann");
const bo = await visitor("Bo");
const annId = await ann.ev(() => window.__chimp.tv.me().id);

// ------------------------------------------------ before: nobody plays, Bo sees the art
await standBy(bo, SLOT, 3.0, 2.0);
await bo.settle(10);
const before = { mat: await screenMat(bo, SLOT), tex: await screenTex(bo, SLOT), seats: await seats(bo), watched: await watched(bo) };
check(before.seats.length === 0 && before.watched.length === 0, "nobody is at any cabinet, and Bo watches nothing", JSON.stringify(before.seats));
check(before.mat !== "screenHole" && !!before.tex?.art && !before.tex?.inUse, "Bo sees the cabinet's art", `${before.mat}, art ${before.tex?.art?.split("/").pop()}`);
await bo.shot("1-before");

// ------------------------------------------------ Ann plays: Bo sees her game live, without a key or a click
const ready = await annPlays(ann, SLOT);
const annFocus = await ann.ev(() => window.__chimp.state().focus);
check(ready && annFocus?.kind === "cabinet" && annFocus.slot === SLOT, "Ann plays the cabinet, her game joined under her name", annFocus && new URL(annFocus.url).searchParams.get("name"));
check(new URL(annFocus.url).searchParams.get("name") === "Ann", "the name her game is given is the one spectators follow");
// her first keys start the game (the first may be lost, as with ChimpVibe's page)
// (on a busy computer several can be: she presses on until her game has three)
for (let round = 0; round < 5 && ((await annGame(ann)?.evaluate(() => window.received?.length ?? 0).catch(() => 0)) ?? 0) < 3; round++) {
  for (const k of ["KeyW", "KeyA", "KeyD"]) await ann.page.keyboard.press(k);
  await ann.page.waitForTimeout(150);
}
const seatAtBo = await bo.waitFor(([n, id]) => window.__chimp.arcade.seats().some((s) => s.slot === n && s.id === id && s.name === "Ann" && s.ready), [SLOT, annId], 8000);
check(seatAtBo, "the room tells Bo that Ann is at the cabinet, her game in", JSON.stringify(await seats(bo)));
// every change in what Bo watches, and in the seats, from here on: printed when a check below fails, to tell why
await bo.ev(() => {
  window.__wlog = [];
  const t0 = performance.now();
  let last = "";
  setInterval(() => {
    const now = JSON.stringify({ w: window.__chimp.arcade.watched().map((w) => [w.key.split(":").pop(), w.state, w.view, w.note, w.framed]), s: window.__chimp.arcade.seats().map((s) => [s.slot, s.name, s.ready, s.away]) });
    if (now !== last) window.__wlog.push(`${Math.round(performance.now() - t0)} ms ${(last = now)}`);
  }, 50);
});
const live = await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "live" && w.view === "over"), SLOT, 15000);
const w1 = await watched(bo);
check(live, "Bo watches Ann's game on the cabinet's screen, live", JSON.stringify(w1));
const boState = await bo.ev(() => ({ focus: window.__chimp.state().focus, walking: window.__chimp.state().walking }));
check(!boState.focus && boState.walking, "Bo is just walking about: nothing focused, no key pressed");
const frameInfo = await bo.ev(() => {
  const f = document.querySelector("iframe.play-frame.watched");
  return f && { src: f.src, z: f.style.zIndex, transform: f.style.transform.slice(0, 8), visible: getComputedStyle(f).visibility, pointer: getComputedStyle(f).pointerEvents, tab: f.tabIndex, frames: document.querySelectorAll("iframe.play-frame").length };
});
const fu = frameInfo && new URL(frameInfo.src).searchParams;
check(!!fu && fu.get("role") === "spectator" && fu.get("follow") === "Ann" && fu.get("mute") === "1" && fu.get("embed") === "1", "it is ChimpVibe's spectator mode, following Ann, muted", frameInfo?.src.split("?")[1]);
check(frameInfo?.z === "0" && frameInfo.transform === "matrix3d" && frameInfo.visible === "visible" && (await screenMat(bo, SLOT)) === "screenHole", "seen through the scene: in perspective under the canvas, through the screen's hole");
check(frameInfo?.pointer === "none" && frameInfo.tab === -1 && frameInfo.frames === 1, "it takes no clicks or keys, and Bo runs no game of his own");

// the picture changes, and it is Ann's game: the stand-in's bar, read from Bo's screenshots where the screen is
const pt = await screenPoint(bo, SLOT, 0.15, 0.89);
const spec = spectatorFrame(bo);
// "live" comes with the spectator's ready message: its first mirrored frame of Ann's game can follow a moment later
await spec?.waitForFunction(() => typeof window.watching?.tick === "number", null, { timeout: 5000, polling: 50 }).catch(() => {});
await bo.settle(3);
const seen = [];
for (let i = 0; i < 5; i++) {
  const t0 = await spec?.evaluate(() => window.watching?.tick ?? null).catch(() => null);
  const c = await colourAt(bo, pt, i === 0 ? "2-during" : null);
  const t1 = await spec?.evaluate(() => window.watching?.tick ?? null).catch(() => null);
  seen.push({ c, i: tickColour(c), t0, t1 });
  await bo.page.waitForTimeout(260);
}
const distinct = new Set(seen.map((s) => s.i).filter((i) => i >= 0));
check(seen.every((s) => s.i >= 0), "the screen shows the stand-in game's bar, in its colours", seen.map((s) => `rgb(${s.c.join(",")})`).join(" "));
check(distinct.size >= 3, "the picture changes as the game runs", `${distinct.size} different colours in 5 screenshots`);
const matches = seen.filter((s) => s.i >= 0 && s.t0 !== null && s.t1 !== null && [...Array(s.t1 - s.t0 + 3).keys()].some((k) => (s.t0 - 1 + k) % 6 === s.i)).length;
check(matches >= 4, "and it is the frame Ann's game is on", `${matches} of 5 match the followed game's frame count`);
const ticks = { ann: await annGame(ann)?.evaluate(() => window.tick).catch(() => null), bo: await spec?.evaluate(() => window.watching?.tick).catch(() => null) };
check(typeof ticks.ann === "number" && typeof ticks.bo === "number" && Math.abs(ticks.ann - ticks.bo) <= 10, "Bo's picture keeps up with Ann's game", `Ann's game at frame ${ticks.ann}, Bo sees frame ${ticks.bo}`);
const keysSeen = await spec?.evaluate(() => window.watching?.players?.[0]?.count ?? 0).catch(() => 0);
check(keysSeen >= 3, "Ann's keys show in what Bo sees", `${keysSeen} keys`);
if (failed) console.log("what Bo watched, as it changed:\n  " + (await bo.ev(() => window.__wlog)).join("\n  "));

// ------------------------------------------------ Bo at the cabinet: it's Ann's, so E doesn't play it
await standBy(bo, SLOT, 0.9, -0.35);
const offered = await bo.waitFor((n) => window.__chimp.state().arcadePrompt?.slot === n, SLOT, 4000);
const prompt = await bo.ev(() => window.__chimp.state().arcadePrompt);
check(offered && prompt?.taken?.by === "Ann", "walking up to it says Ann is playing it", JSON.stringify(prompt));
check(await bo.ev(() => /Ann is playing/.test(document.querySelector(".play-prompt")?.textContent ?? "")), "the prompt says so on the page", await bo.ev(() => document.querySelector(".play-prompt")?.textContent));
const clear = await bo.ev((n) => {
  const r = document.querySelector(".play-prompt")?.getBoundingClientRect();
  const q = window.__chimp.arcade.screenQuad(n);
  if (!r || !q) return null;
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const over = r.right > Math.min(...xs) && r.left < Math.max(...xs) && r.bottom > Math.min(...ys) && r.top < Math.max(...ys);
  return { over, prompt: [r.top, r.bottom].map(Math.round), screen: [Math.min(...ys), Math.max(...ys)].map(Math.round) };
}, SLOT);
check(clear && !clear.over, "the prompt leaves the screen clear, to watch the game", JSON.stringify(clear));
// (with the builder's tools on, the page's own walking/flying toast may already be up: E must add nothing to it)
const toastBefore = await bo.ev(() => window.__chimp.state().toast ?? null);
await bo.page.keyboard.press("KeyE");
await bo.settle(20);
const toastAfter = await bo.ev(() => window.__chimp.state().toast ?? null);
check(toastAfter === null || toastAfter === toastBefore, "E says nothing more than the prompt already does", toastAfter ?? "");
check(!(await bo.ev(() => window.__chimp.state().focus)) && (await bo.ev(() => window.__chimp.arcade.running().length)) === 0, "E doesn't play Ann's cabinet for Bo");
check((await watched(bo)).some((w) => w.slot === SLOT && w.view === "over"), "close up, he still watches it live");
await bo.shot("3-close-up");

// ------------------------------------------------ out of view: Bo stops watching; back in view, he watches again
await standBy(bo, SLOT, 3.0, 2.0, Math.PI);
const hidden = await watched(bo);
check(hidden.every((w) => w.view === "hidden") && (await screenMat(bo, SLOT)) !== "screenHole", "turned away, the game no longer shows (its frame hidden)", JSON.stringify(hidden));
await bo.shot("4-turned-away");
const gone = await bo.waitFor(() => window.__chimp.arcade.watched().length === 0 && !document.querySelector("iframe.play-frame.watched"), null, 9000);
check(gone, "a few seconds out of view, Bo stops watching it: its frame leaves the page");
await aim(bo, SLOT);
const back = await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "live" && w.view === "over"), SLOT, 15000);
check(back, "looking at it again, he watches it again");

// Ann steps back, leaving it running: still hers, still live
await ann.ev(() => window.__chimp.arcade.stepBack());
await ann.waitFor(() => window.__chimp.state().focus === null, null, 5000);
await ann.settle(10);
const away = await bo.waitFor((n) => window.__chimp.arcade.seats().some((s) => s.slot === n && s.away), SLOT, 4000);
check(away && (await watched(bo)).some((w) => w.slot === SLOT && w.view === "over"), "Ann steps back, leaving it running: still hers, still live for Bo");

// ------------------------------------------------ Ann quits: the art again
await ann.ev((n) => window.__chimp.arcade.quit(n), SLOT);
const freed = await bo.waitFor(() => window.__chimp.arcade.seats().length === 0 && window.__chimp.arcade.watched().length === 0, null, 5000);
await bo.settle(10);
const after = { mat: await screenMat(bo, SLOT), tex: await screenTex(bo, SLOT) };
check(freed && after.mat !== "screenHole" && !!after.tex?.art && !after.tex?.inUse, "Ann quits: the cabinet is free, and Bo sees its art again", `${after.mat}, in use: ${after.tex?.inUse ?? "nobody"}`);
await bo.shot("5-after-quit");

// ------------------------------------------------ games that can't be watched: the art with "In use by Ann", never blank
const entries = await bo.ev(() => window.__chimp.arcade.entries());
const withParam = (p) => entries.map((g) => ({ ...g, playUrl: `${g.playUrl}&${p}` }));
// spectators that never say they are showing (a page without embed mode)
await bo.ev((g) => window.__chimp.arcade.setGames(g), withParam("silent=1"));
await annPlays(ann, SLOT);
await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "loading"), SLOT, 8000);
const loading = { mat: await screenMat(bo, SLOT), tex: await screenTex(bo, SLOT) };
check(loading.mat !== "screenHole" && loading.tex?.inUse === "Ann" && !!loading.tex.art, "while it loads, Bo sees the art with \"In use by Ann\"", `${loading.mat}, in use: ${loading.tex?.inUse}`);
await bo.shot("6-in-use");
const t0 = Date.now();
const gaveUp = await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "failed"), SLOT, 20000);
check(gaveUp && Date.now() - t0 < 17000, "a game that doesn't show within 15 s is given up on", `${((Date.now() - t0) / 1000).toFixed(1)} s; ${JSON.stringify(await watched(bo))}`);
check((await screenMat(bo, SLOT)) !== "screenHole" && (await screenTex(bo, SLOT))?.inUse === "Ann" && !(await bo.ev(() => document.querySelector("iframe.play-frame.watched"))), "and the art stays up, saying who is playing, with no frame left over");
await ann.ev((n) => window.__chimp.arcade.quit(n), SLOT);
await bo.waitFor(() => window.__chimp.arcade.seats().length === 0, null, 5000);
// a game that refuses spectators
await bo.ev((g) => window.__chimp.arcade.setGames(g), withParam("nowatch=1"));
await annPlays(ann, SLOT);
const refused = await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "failed" && /no-spectators/.test(w.note ?? "")), SLOT, 10000);
await bo.settle(10);
check(refused && (await screenMat(bo, SLOT)) !== "screenHole" && (await screenTex(bo, SLOT))?.inUse === "Ann", "a game that refuses spectators shows the art with \"In use by Ann\"", JSON.stringify(await watched(bo)));
await bo.shot("7-refused");
await bo.ev((g) => window.__chimp.arcade.setGames(g), entries);

// ------------------------------------------------ Ann's page closes: her cabinet is freed for everyone
await ann.page.close();
const left = await bo.waitFor(() => window.__chimp.arcade.seats().length === 0 && window.__chimp.arcade.watched().length === 0, null, 8000);
await bo.settle(10);
const closed = { mat: await screenMat(bo, SLOT), tex: await screenTex(bo, SLOT) };
check(left && closed.mat !== "screenHole" && !closed.tex?.inUse && !!closed.tex?.art, "Ann's page closes: her cabinet is free, and shows its art", JSON.stringify(await seats(bo)));
await bo.shot("8-after-close");

// ------------------------------------------------ the last visitor leaves mid-game: nobody is left to free the cabinet, so the next to come must
const boPlays = await annPlays(bo, SLOT);
const boId = await bo.ev(() => window.__chimp.tv.me().id);
check(boPlays, "Bo, alone in the house now, plays the cabinet");
await bo.page.close();
const cy = await visitor("Cy");
await standBy(cy, SLOT, 1.0, 0);
await cy.settle(10);
const ghost = await seats(cy);
check(!ghost.some((s) => s.id === boId), "Bo's page closes as he plays: the next visitor finds his cabinet free", JSON.stringify(ghost));
check((await screenTex(cy, SLOT))?.inUse == null && !(await cy.ev(() => window.__chimp.state().arcadePrompt?.taken)), "with its art and no \"In use by Bo\"");
check(await annPlays(cy, SLOT), "and can play it");

await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
