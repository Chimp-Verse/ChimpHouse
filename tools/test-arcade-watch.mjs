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
// the art up, plainly: no "In use by" on any screen. E at Ann's cabinet doesn't play
// it for Bo. Once her game shows, it stays: a minute in view, the spectator's own
// messages (ended, nobody playing, follow), her game going quiet for 8 s and the frame changing
// size never show the art, a dropped frame staying up while a fresh one loads behind it.
// Anywhere in the room: a far cabinet (14 m) is live too; the number of live
// screens is capped per quality (made-up visitors from arcade.testSeats fill the
// other cabinets); the nearest get the full picture, the rest a smaller one, held
// 2.5 s before a size changes (no flicker when swaying or walking); a struggling
// computer keeps the tighter limits (2 live, none beyond 14 m) and recovers.
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
check(before.mat !== "screenHole" && !!before.tex?.art && !before.tex?.user && !("inUse" in (before.tex ?? {})), "Bo sees the cabinet's art", `${before.mat}, art ${before.tex?.art?.split("/").pop()}`);
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

// ------------------------------------------------ constantly live: once Ann's game shows, Bo never sees the cabinet's art again while it is in view
// Every frame Bo's page draws, whether slot SLOT's screen is the hole (the game) or the art: a regression for screens that kept
// flipping between the game and the art.
await bo.ev((n) => {
  const c = window.__chimp;
  window.__flips = { frames: 0, art: 0, artRuns: 0, log: [] };
  let was = null;
  window.__flipObs = c.scene.onAfterRenderObservable.add(() => {
    const screen = c.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n);
    const hole = screen?.material?.name === "screenHole";
    const f = window.__flips;
    // only frames with the screen on the page count: the art can't be seen otherwise
    const q = c.arcade.screenQuad(n);
    const r = c.scene.getEngine().getRenderingCanvas().getBoundingClientRect();
    const inView = !!screen && c.scene.activeCamera.isInFrustum(screen) && !!q?.some((p) => p.x >= 0 && p.y >= 0 && p.x <= r.width && p.y <= r.height);
    if (!inView) return;
    f.frames++;
    if (!hole) f.art++;
    if (was === true && !hole) {
      f.artRuns++;
      const w = c.arcade.watched().find((w) => w.slot === n);
      if (f.log.length < 20) f.log.push(`${Math.round(performance.now())} ms: ${JSON.stringify(w ?? "not watched")}`);
    }
    was = hole;
  });
}, SLOT);
const flips = () => bo.ev(() => ({ ...window.__flips, log: window.__flips.log.slice() }));
const resetFlips = () => bo.ev(() => Object.assign(window.__flips, { frames: 0, art: 0, artRuns: 0, log: [] }));
await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "live" && w.view === "over"), SLOT, 15000);
await bo.settle(5);
await resetFlips();
// a minute in view (from three places, swaying a little as a chimp does), at the page's quality, with the computer judged as it is
const keyBefore = (await watched(bo)).find((w) => w.slot === SLOT)?.key;
const spots = [
  [3.0, 2.0],
  [6.0, -1.0],
  [1.6, 0.9],
];
const steadyFrom = Date.now();
for (let i = 0; Date.now() - steadyFrom < 60000; i++) {
  if (i % 10 === 0) await standBy(bo, SLOT, ...spots[(i / 10) % spots.length]);
  else await aim(bo, SLOT, (i % 2 ? 1 : -1) * 0.04);
  await bo.page.waitForTimeout(1200);
}
let fl = await flips();
const steadyW = (await watched(bo)).find((w) => w.slot === SLOT);
check(fl.frames > 300 && fl.artRuns === 0 && fl.art === 0, "a minute in view, from near and far: the game shows on every frame, never the art", `${fl.frames} frames, ${fl.art} with the art, ${fl.artRuns} flips; ${fl.log.join(" | ")}`);
check(steadyW?.key === keyBefore && steadyW?.swaps === 0, "and its frame is the same one throughout: never reloaded", `${keyBefore} then ${steadyW?.key}, ${steadyW?.swaps} swaps`);

// the spectator's own messages: the game ended for it and it is playing again, nobody playing for a moment, and who it follows
// coming and going. Each is sent from Bo's spectator frame itself, as ChimpVibe's would be.
const liveSpectator = async (v) => {
  for (const f of v.page.frames().filter((f) => f.url().includes("role=spectator"))) if ((await (await f.frameElement()).evaluate((el) => el.style.visibility)) === "visible") return f;
  return null;
};
const say = async (msg) => (await liveSpectator(bo))?.evaluate((m) => parent.postMessage({ protocol: "chimpvibe-embed", version: 1, ...m }, "*"), msg);
await standBy(bo, SLOT, 3.0, 2.0);
await resetFlips();
const sequences = [
  ["ended, then a fresh frame takes over", [{ type: "ended", reason: "test" }]],
  ["nobody playing for a moment", [{ type: "error", code: "no-players", reason: "Nobody is playing" }]],
  ["the followed player gone and back", [{ type: "follow", name: "Ann", state: "gone" }, { type: "follow", name: "Ann", state: "following" }]],
  ["any other error from the frame showing", [{ type: "error", code: "unavailable", reason: "test" }]],
];
for (const [what, msgs] of sequences) {
  const swaps0 = (await watched(bo)).find((w) => w.slot === SLOT)?.swaps ?? 0;
  for (const m of msgs) await say(m);
  const dropped = msgs.some((m) => m.type !== "follow");
  const replaced = dropped ? await bo.waitFor(([n, s]) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "live" && !w.stale && w.swaps > s), [SLOT, swaps0], 15000) : true;
  await bo.page.waitForTimeout(1500);
  fl = await flips();
  const w = (await watched(bo)).find((w) => w.slot === SLOT);
  check(replaced && fl.art === 0 && w?.view === "over" && (await bo.ev(() => document.querySelectorAll("iframe.play-frame.watched").length)) === 1, `${what}: the game stays on the screen${dropped ? ", a fresh frame loading behind it and taking over" : ""}, never the art`, `${fl.art} frames of art; ${JSON.stringify(w)}`);
}
// Ann's page goes quiet (a busy computer, a tab in the background, whose timers Chrome holds to once a minute): her
// spectators keep her (the stand-in until 75 s without a word, as a game's session would), so the same frame stays up.
// Her stand-in play page says nothing for 8 s (freezing the page instead, through CDP, left its channel deaf afterwards).
const annPlayer = ann.page.frames().find((f) => f.url().includes("arcade/standin.html") && !f.url().includes("role=spectator"));
const hush = (on) => annPlayer?.evaluate((on) => {
  // the stand-in's session channel (a top-level const of its script)
  if (!window.__said) {
    window.__said = session.postMessage.bind(session);
    session.postMessage = (m) => window.__hushed || window.__said(m);
  }
  window.__hushed = on;
}, on);
await resetFlips();
const preStall = (await watched(bo)).find((w) => w.slot === SLOT);
await hush(true);
await bo.page.waitForTimeout(8000);
const duringStall = (await watched(bo)).find((w) => w.slot === SLOT);
await hush(false);
await bo.page.waitForTimeout(2000);
const afterStall = (await watched(bo)).find((w) => w.slot === SLOT);
fl = await flips();
const same = (w) => w?.state === "live" && !w.stale && w.view === "over" && w.key === preStall?.key && w.swaps === preStall?.swaps;
check(!!annPlayer && same(duringStall) && same(afterStall) && fl.art === 0, "Ann's page goes quiet 8 s: her game stays on the screen, the same frame throughout, never the art", `before: ${JSON.stringify(preStall)}; during: ${JSON.stringify(duringStall)}; after: ${JSON.stringify(afterStall)}; ${fl.art} frames of art`);
// a size change (here the quality's frame width) resizes the frame: no reload, no art
await resetFlips();
const keySize = (await watched(bo)).find((w) => w.slot === SLOT)?.key;
const widthWas = (await watched(bo)).find((w) => w.slot === SLOT)?.width;
await bo.ev((q) => [...document.querySelectorAll(".quality button")].find((b) => b.textContent === q)?.click(), QUALITY === "low" ? "high" : "low");
await bo.settle(30);
const resized = (await watched(bo)).find((w) => w.slot === SLOT);
await bo.ev((q) => [...document.querySelectorAll(".quality button")].find((b) => b.textContent === q)?.click(), QUALITY);
await bo.settle(30);
fl = await flips();
check(resized?.width !== widthWas && resized?.key === keySize && (await watched(bo)).find((w) => w.slot === SLOT)?.key === keySize && fl.art === 0, "its frame changing size doesn't reload it or show the art", `${widthWas} px, then ${resized?.width} px; ${fl.art} frames of art`);
await bo.ev(() => window.__chimp.scene.onAfterRenderObservable.remove(window.__flipObs));

// ------------------------------------------------ the whole room: far cabinets, how many are live, the nearer ones sharper, no flicker
// More cabinets are in use than a test can seat real visitors at: made-up visitors (arcade.testSeats) take the other slots, each
// following Ann, so every spectator frame shows Ann's one game. The Game Room's cabinets stand in two rows 11.7 m apart; the farthest
// sight line in the room, from its south-west corner to slot 4, is about 15 m.
const OTHERS = [1, 2, 4, 5, 6, 7, 8];
const CAP = { high: 6, medium: 4, low: 2 };
const FULL = { high: 640, medium: 560, low: 480 };
const FAR_W = 480;
const setQuality = async (v, q) => {
  await v.ev((q) => [...document.querySelectorAll(".quality button")].find((b) => b.textContent === q)?.click(), q);
  await v.settle(20);
};
/** Stand at (x, z), eyes level, looking along `yaw` (0: towards +z, π/2: towards +x). */
async function standAt(v, x, z, yaw, fov = 1.1) {
  await v.ev(
    async ([x, z, yaw, fov]) => {
      const c = window.__chimp;
      c.setWalking(false);
      c.setPose({ x, y: 1.6, z, yaw, pitch: 0, fov });
      c.setWalking(true);
      await c.settle(8);
    },
    [x, z, yaw, fov],
  );
}
/** Distance from Bo's eyes to slot n's screen. */
const screenDist = (v, n) =>
  v.ev((n) => {
    const c = window.__chimp;
    const p = c.scene.meshes.find((m) => m.metadata?.role === "cabinet-screen" && m.metadata.slot === n).getAbsolutePosition();
    const [x, y, z] = c.chimps.eye().at;
    return Math.hypot(p.x - x, p.y - y, p.z - z);
  }, n);
/** The slots whose game shows on their screen now, and the widths of the frames that show (CSS px). */
const shown = (v) =>
  v.ev(() => ({
    slots: window.__chimp.arcade.watched().filter((w) => w.view === "over").map((w) => w.slot).sort((a, b) => a - b),
    widths: [...document.querySelectorAll("iframe.play-frame.watched")].filter((f) => f.style.visibility === "visible").map((f) => parseFloat(f.style.width)).sort((a, b) => b - a),
  }));
const allShown = (v, count) => v.waitFor((count) => window.__chimp.arcade.watched().filter((w) => w.state === "live" && w.view === "over").length === count, count, 40000);
/**
 * How much the foot of slot n's screen changes colour on Bo's page over about a second (the largest distance between the average
 * colours of 8 screenshots): a live stand-in game's bar changes ten times a second, the cabinet's art doesn't change at all.
 */
async function barChange(v, n, name) {
  const avgs = [];
  for (let k = 0; k < 8; k++) {
    const buf = await v.page.screenshot(name && k === 0 ? { path: `${SHOTS}/watch-${name}.png` } : {});
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const sum = [0, 0, 0];
    let all = 0;
    for (const u of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
      for (const w of [0.86, 0.9, 0.94]) {
        const pt = await screenPoint(v, n, u, w);
        if (!pt || pt.x < 0 || pt.y < 0 || pt.x >= info.width || pt.y >= info.height) continue;
        const i = (pt.y * info.width + pt.x) * info.channels;
        for (let c = 0; c < 3; c++) sum[c] += data[i + c];
        all++;
      }
    if (all) avgs.push(sum.map((x) => x / all));
    await v.page.waitForTimeout(130);
  }
  let max = 0;
  for (const a of avgs) for (const b of avgs) max = Math.max(max, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  return Math.round(max);
}
/** Record, every 50 ms, which slots show and the widths of their frames, until stopTrace. */
const startTrace = (v) =>
  v.ev(() => {
    window.__trace = [];
    window.__traceTimer = setInterval(() => {
      const ws = window.__chimp.arcade.watched();
      window.__trace.push({ t: Math.round(performance.now()), over: ws.filter((w) => w.view === "over").map((w) => w.slot).sort((a, b) => a - b).join(","), widths: Object.fromEntries(ws.filter((w) => w.view === "over").map((w) => [w.slot, w.width])) });
    }, 50);
  });
const stopTrace = (v) =>
  v.ev(() => {
    clearInterval(window.__traceTimer);
    return window.__trace;
  });
/** How often each slot's frame went from showing to not showing, and changed width, in a trace. */
function churn(trace) {
  const lost = new Map();
  const resized = new Map();
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1];
    const b = trace[i];
    for (const s of Object.keys(a.widths)) {
      if (!(s in b.widths)) lost.set(s, (lost.get(s) ?? 0) + 1);
      else if (a.widths[s] !== b.widths[s]) resized.set(s, (resized.get(s) ?? 0) + 1);
    }
  }
  return { lost: Object.fromEntries(lost), resized: Object.fromEntries(resized) };
}

/**
 * Bo's cabinets play these games (entries as arcade.entries gives them), and keep them: the page reloads its game list every
 * 2 minutes, which would put back the games as listed (the other cabinets' spectators back in their own games, where nobody plays).
 */
const useGames = (g) =>
  bo.ev((g) => {
    clearInterval(window.__keepGames);
    window.__chimp.arcade.setGames(g);
    window.__keepGames = setInterval(() => window.__chimp.arcade.setGames(g), 250);
  }, g);
// (the stand-in keeps one session per game, so the other cabinets' spectators are given Ann's game to find her in)
const entries0 = await bo.ev(() => window.__chimp.arcade.entries());
const annSeat = (await seats(bo)).find((x) => x.slot === SLOT);
const annGameParam = new URL(entries0.find((g) => g.gameId === annSeat.gameId).playUrl).searchParams.get("game");
await useGames(

  entries0.map((g) => ({ ...g, playUrl: Object.assign(new URL(g.playUrl), { search: new URLSearchParams([...new URL(g.playUrl).searchParams].map(([k, v]) => [k, k === "game" ? annGameParam : v])).toString() }).href })),
);
await bo.settle(10);
const SW = [4.6, 0.9];
await standAt(bo, SW[0], SW[1], 0, 1.1);
await aim(bo, 4);
const farD = await screenDist(bo, 4);
const artChange = await barChange(bo, 4);
await bo.ev((o) => window.__chimp.arcade.testSeats(o.map((slot) => ({ slot, name: "Ann" }))), [4]);
const farLive = await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "live" && w.view === "over"), 4, 20000);
check(farD >= 14.2, "the far cabinet is in the same room but over 14 m off (the old limit; the room's longest sight line is about 14.5 m)", `${farD.toFixed(1)} m`);
check(farLive, "Bo sees the far cabinet's game live on its screen, as the near ones", JSON.stringify(await watched(bo)));
await bo.settle(10);
const farChange = await barChange(bo, 4, "9-far-cabinet");
check(farChange >= 60 && artChange < 25, "the far screen's picture changes as the stand-in game runs (and didn't before, when it showed the art)", `foot of the screen changes by ${farChange}, before: ${artChange}`);
const farSize = await bo.ev(() => window.__chimp.arcade.screenQuad(4).map((p) => p.y)).then((ys) => Math.max(...ys) - Math.min(...ys));
console.log(`      (far screen ${Math.round(farSize)} px high at ${farD.toFixed(1)} m)`);
// a screen too small to read stays art: a cabinet seen from far outside the room is not watched, nor one the eye can't see
await standAt(bo, SW[0], SW[1], Math.PI, 1.1);
await bo.settle(10);
check((await shown(bo)).slots.length === 0, "turned away, the far cabinet no longer shows");

// the cap: at low quality 2 are live, however many are in view; the rest keep their art, saying who is in use
await setQuality(bo, "low");
await bo.ev((o) => window.__chimp.arcade.testSeats(o.map((slot) => ({ slot, name: "Ann" }))), OTHERS);
await standAt(bo, 9, 6.6, Math.PI / 2, 1.9);
const lowLive = await allShown(bo, CAP.low);
check(lowLive, "low quality: of 8 cabinets in use and in view, 2 are live", JSON.stringify((await watched(bo)).map((w) => [w.slot, w.state, w.view])));
if (!lowLive) {
  // to tell why: whether Ann's stand-in still says she is here (heard in her page and in Bo's), and what Bo's spectators show
  const hears = (f) =>
    f?.evaluate(async () => {
      const ch = new BroadcastChannel(`standin-session:${new URLSearchParams(location.search).get("game") ?? ""}`);
      let n = 0;
      ch.onmessage = (e) => e.data?.kind === "here" && n++;
      await new Promise((r) => setTimeout(r, 1500));
      ch.close();
      return n;
    }).catch((e) => String(e).slice(0, 80));
  const annP = ann.page.frames().find((f) => f.url().includes("arcade/standin.html") && !f.url().includes("role=spectator"));
  const specs = bo.page.frames().filter((f) => f.url().includes("role=spectator"));
  console.log(`      ("here" messages in 1.5 s: in Ann's page ${await hears(annP)}, in Bo's ${await hears(specs[0])})`);
  for (const f of specs) console.log(`      (spectator: ${await f.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 60)).catch((e) => String(e).slice(0, 60))})`);
}
await bo.settle(15);
let sh = await shown(bo);
check(sh.slots.length === CAP.low, "and only 2 show", `slots ${sh.slots}`);
let rest = [];
for (let n = 1; n <= 8; n++) if (!sh.slots.includes(n)) rest.push({ n, mat: await screenMat(bo, n), tex: await screenTex(bo, n) });
check(rest.length === 6 && rest.every((r) => r.mat !== "screenHole" && r.tex?.user === "Ann" && !("inUse" in r.tex)), "the other 6 keep the cabinet's art, plainly (no \"In use by\")", JSON.stringify(rest));
await bo.shot("10-low-two-live");

// medium and high: more are live, the nearer ones at the game's full frame size and the rest smaller
for (const q of ["medium", "high"]) {
  await setQuality(bo, q);
  const slow = await bo.ev(() => window.__chimp.state().renderScaleAuto);
  const cap = slow ? 2 : CAP[q];
  check(await allShown(bo, cap), `${q} quality${slow ? " (the computer struggling)" : ""}: ${cap} are live`, JSON.stringify((await watched(bo)).map((w) => [w.slot, w.state, w.view, w.tier])));
  await bo.settle(15);
  sh = await shown(bo);
  const want = Array.from({ length: cap }, (_, i) => (i < (slow ? cap : Math.ceil(cap / 2)) ? FULL[q] : FAR_W));
  check(sh.slots.length === cap && JSON.stringify(sh.widths) === JSON.stringify(want), `${q}: the nearer half at ${FULL[q]} px, the rest at ${FAR_W} px`, `${sh.widths}`);
  await bo.shot(`11-${q}-tiers`);
}

// a struggling computer keeps today's limits: 2 live and none beyond 14 m, even in the room
await bo.ev(() => window.__chimp.adaptive.force(true));
await standAt(bo, SW[0], SW[1], 0, 1.1);
await aim(bo, 4);
const slowOk = await bo.waitFor(() => window.__chimp.state().renderScaleAuto, null, 5000);
await bo.settle(30);
const slowShown = (await shown(bo)).slots;
const slowDists = [];
for (const n of slowShown) slowDists.push(+(await screenDist(bo, n)).toFixed(1));
check(slowOk && slowShown.length >= 1 && slowShown.length <= 2 && slowDists.every((d) => d <= 14.2) && !slowShown.includes(4), "while the computer struggles: at most 2 live, none beyond 14 m, not the 15 m one", `slots ${slowShown}, ${slowDists} m`);
await bo.ev(() => window.__chimp.adaptive.force(false));
await bo.waitFor(() => !window.__chimp.state().renderScaleAuto, null, 5000);
const backFar = await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "live" && w.view === "over"), 4, 25000);
check(backFar, "and when it recovers, the far cabinet is watched again");

// no flicker. Four cabinets of the north row seen from midway between slots 2 and 3 are all about the same size, so which two
// of them are the nearest is a toss-up: swaying about must not swap them (low quality, 2 live)
await setQuality(bo, "low");
await standAt(bo, 11.97, 6.5, 0, 1.1);
await allShown(bo, CAP.low);
await bo.settle(20);
await startTrace(bo);
for (let i = 0; i < 14; i++) {
  await standAt(bo, 11.97 + (i % 2 ? 0.3 : -0.3), 6.5, 0, 1.1);
  await bo.page.waitForTimeout(200);
}
let trace = await stopTrace(bo);
let c = churn(trace);
check(trace.length > 20 && Object.keys(c.lost).length === 0 && Object.keys(c.resized).length === 0, "four cabinets of equal size, swaying about: the same two stay live", `${trace.length} samples, lost ${JSON.stringify(c.lost)}, resized ${JSON.stringify(c.resized)}, slots ${[...new Set(trace.map((t) => t.over))].join(" | ")}`);
// walking across the room changes which are nearest, at medium (4 live, the nearer two full size): each screen changes at most once,
// and a frame only changes size after its cabinet has stayed in the other class a while
await setQuality(bo, "medium");
await standAt(bo, 9, 2.0, Math.PI / 2, 1.9);
await allShown(bo, CAP.medium);
await bo.settle(20);
const widthsBefore = (await shown(bo)).widths;
await startTrace(bo);
for (let i = 0; i <= 9; i++) {
  await standAt(bo, 9, 2.0 + i, Math.PI / 2, 1.9);
  await bo.page.waitForTimeout(150);
}
await bo.page.waitForTimeout(4000);
trace = await stopTrace(bo);
c = churn(trace);
const lostMax = Math.max(0, ...Object.values(c.lost));
const resizedMax = Math.max(0, ...Object.values(c.resized));
check(lostMax <= 1 && resizedMax <= 1, "walking across the room: each screen changes at most once, no flicker", `lost ${JSON.stringify(c.lost)}, resized ${JSON.stringify(c.resized)}, widths ${widthsBefore} then ${(await shown(bo)).widths}`);
const firstResize = trace.findIndex((t, i) => i > 0 && Object.keys(t.widths).some((s) => s in trace[i - 1].widths && t.widths[s] !== trace[i - 1].widths[s]));
console.log(`      (first resize ${firstResize < 0 ? "none" : `${((trace[firstResize].t - trace[0].t) / 1000).toFixed(1)} s`} into the walk, which took ~2 s)`);

// free the made-up visitors; Bo goes back where he was, at the quality the run started at
await bo.ev(() => window.__chimp.adaptive.force(null));
await useGames(entries0);
await bo.ev((o) => window.__chimp.arcade.testSeats(o.map((slot) => ({ slot, name: null }))), [4, ...OTHERS.filter((n) => n !== 4)]);
await setQuality(bo, QUALITY);
await standBy(bo, SLOT, 3.0, 2.0);
check(await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "live" && w.view === "over") && window.__chimp.arcade.watched().length === 1, SLOT, 20000), "the made-up visitors gone, Bo watches just Ann's cabinet again", JSON.stringify(await watched(bo)));

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
check(freed && after.mat !== "screenHole" && !!after.tex?.art && !after.tex?.user, "Ann quits: the cabinet is free, and Bo sees its art again", `${after.mat}, in use: ${after.tex?.user ?? "nobody"}`);
await bo.shot("5-after-quit");

// ------------------------------------------------ games that can't be watched: the art, plainly, never blank
const entries = await bo.ev(() => window.__chimp.arcade.entries());
const withParam = (p) => entries.map((g) => ({ ...g, playUrl: `${g.playUrl}&${p}` }));
// spectators that never say they are showing (a page without embed mode)
await useGames(withParam("silent=1"));
await annPlays(ann, SLOT);
await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "loading"), SLOT, 8000);
const loading = { mat: await screenMat(bo, SLOT), tex: await screenTex(bo, SLOT) };
check(loading.mat !== "screenHole" && loading.tex?.user === "Ann" && !("inUse" in loading.tex) && !!loading.tex.art, "while it loads, Bo sees the art, plainly (no \"In use by\")", `${loading.mat}, in use: ${loading.tex?.user}`);
await bo.shot("6-in-use");
const t0 = Date.now();
const gaveUp = await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "failed"), SLOT, 20000);
check(gaveUp && Date.now() - t0 < 17000, "a game that doesn't show within 15 s is given up on", `${((Date.now() - t0) / 1000).toFixed(1)} s; ${JSON.stringify(await watched(bo))}`);
check((await screenMat(bo, SLOT)) !== "screenHole" && (await screenTex(bo, SLOT))?.user === "Ann" && !(await bo.ev(() => document.querySelector("iframe.play-frame.watched"))), "and the art stays up, with no frame left over");
await ann.ev((n) => window.__chimp.arcade.quit(n), SLOT);
await bo.waitFor(() => window.__chimp.arcade.seats().length === 0, null, 5000);
// a game that refuses spectators
await useGames(withParam("nowatch=1"));
await annPlays(ann, SLOT);
const refused = await bo.waitFor((n) => window.__chimp.arcade.watched().some((w) => w.slot === n && w.state === "failed" && /no-spectators/.test(w.note ?? "")), SLOT, 10000);
await bo.settle(10);
check(refused && (await screenMat(bo, SLOT)) !== "screenHole" && (await screenTex(bo, SLOT))?.user === "Ann", "a game that refuses spectators shows the art", JSON.stringify(await watched(bo)));
await bo.shot("7-refused");
await useGames(entries);

// ------------------------------------------------ Ann's page closes: her cabinet is freed for everyone
await ann.page.close();
const left = await bo.waitFor(() => window.__chimp.arcade.seats().length === 0 && window.__chimp.arcade.watched().length === 0, null, 8000);
await bo.settle(10);
const closed = { mat: await screenMat(bo, SLOT), tex: await screenTex(bo, SLOT) };
check(left && closed.mat !== "screenHole" && !closed.tex?.user && !!closed.tex?.art, "Ann's page closes: her cabinet is free, and shows its art", JSON.stringify(await seats(bo)));
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
check((await screenTex(cy, SLOT))?.user == null && !(await cy.ev(() => window.__chimp.state().arcadePrompt?.taken)), "with its art, nobody's");
check(await annPlays(cy, SLOT), "and can play it");

await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
