// The theatre in a real browser against the running preview (npm run dev), with
// a same-origin stand-in for YouTube's player (public/theatre/standin.html) that
// draws a test card with a solid colour in each corner:
//   1. the screen and the lightbox, found by role alone, and their corners
//   2. watch mode: walk up, E, the camera square onto the screen at seat height;
//      without a remote nothing can be chosen; the remotes on the stand (taking one,
//      putting it down); with a remote, a pasted link plays, the player exactly over
//      the screen (checked in a screenshot too), nothing over it, keys going to it
//      and not to ChimpHouse, through a window resize
//   3. Leave: back where you stood, walking, with the video still playing over the
//      screen in perspective (checked in screenshots, from several places and in
//      mid-stride); hidden, and paused first, when it can't be seen properly
//      (looking away, something in the way, too steep, too small, out of the room);
//      catching up when it is back in view; volume falling off with distance
//      (and leaving the theatre sends a held remote back to the stand)
//   4. choosing: the link forms, a video and a live stream playing, an
//      embed-blocked video's message, the poster (YouTube's real title and
//      thumbnail) on the screen and lightbox; the remote's buttons for everyone;
//      without a remote, pausing the player pauses only your own
// Real YouTube playback is checked by hand (README, "Watching in the theatre").
//   node tools/test-theatre.mjs
// Screenshots: captures/theatre-*.png. Exits non-zero when a check fails.
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30"; // Big Buck Bunny, from the Blender Foundation
await mkdir("captures", { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
// expected: YouTube's 400s and 404s for the stand-in's made-up videos' titles and thumbnails, and
// ChimpVibe's arcade list, which it doesn't serve yet (the arcade falls back to its fixture)
page.on("console", (m) => m.type() === "error" && !/youtube\.com|ytimg\.com|\/chimpvibe\/shared\//.test(m.location()?.url ?? "") && console.log("[browser error]", m.text().slice(0, 300)));
const shot = (name) => page.screenshot({ path: `captures/theatre-${name}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (n = 10) => ev((n) => window.__chimp.settle(n), n);
const waitFor = (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });
const state = () => ev(() => window.__chimp.state());
const standin = () => page.frames().find((f) => f.url().includes("/theatre/standin.html"));
const playerState = async () => (await standin()?.evaluate(() => window.standinState())) ?? null;
const PLAYING = 1;
const PAUSED = 2;

await page.goto(`${URL}/?pov=first&view=theatre&theatre=standin`);
await waitFor(() => window.__chimp?.ready === true, null, 300000);
// the room server keeps the theatre as the last visitors left it: start from the beginning
await ev(() => window.__chimp.theatre.reset());
await settle(20);

// ------------------------------------------------ 1. the screen and lightbox, by role
const byRole = await ev(() => window.__chimp.scene.meshes.filter((m) => ["theatre-screen", "theatre-lightbox"].includes(m.metadata?.role)).map((m) => `${m.metadata.role}: ${m.name}`));
check(byRole.length === 2, "one theatre screen and one lightbox carry their roles", byRole.join(", "));
// the corners the code reads (focus.ts) against the mesh's own vertices
const geo = await ev(() => {
  const out = {};
  for (const role of ["theatre-screen", "theatre-lightbox"]) {
    const m = window.__chimp.scene.meshes.find((x) => x.metadata?.role === role);
    const V = m.position.constructor;
    const wm = m.computeWorldMatrix(true);
    const P = m.getVerticesData("position");
    const verts = [];
    for (let i = 0; i < P.length; i += 3) verts.push(V.TransformCoordinates(new V(P[i], P[i + 1], P[i + 2]), wm).asArray());
    out[role] = verts;
  }
  return { verts: out, screens: window.__chimp.theatre.screens() };
});
const [screen, lightbox] = geo.screens;
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) < tol);
const matches = (s) => s.corners.every((c) => geo.verts[s.role].some((v) => near(v, c, 0.001)));
check(matches(screen) && near(screen.size, [5.0, 2.81], 0.001) && near(screen.normal, [-1, 0, 0], 1e-6), "code finds the theatre screen's corners: 5.00 x 2.81 m, facing west", screen.corners.map((c) => `(${c.map((v) => v.toFixed(2)).join(", ")})`).join(" "));
check(matches(lightbox) && near(lightbox.size, [1.1, 1.1 * (9 / 16)], 0.001) && near(lightbox.normal, [0, 0, -1], 1e-6), "and the lightbox's: 1.10 x 0.62 m, facing the corridor");
const sc = screen.corners.reduce((a, c) => a.map((v, i) => v + c[i] / 4), [0, 0, 0]);
const n = screen.normal;
check((await state()).theatre.videoId === null, "nothing showing at first: the screen shows the placeholder");
const spots = await ev(() => window.__chimp.remotes.spots());
const onStand = () => ev(() => JSON.stringify(window.__chimp.remotes.onStand()));
check(spots.length === 2 && (await onStand()) === "[true,true]", "two remotes lie on their spots on the stand under the screen, found by role", spots.map((sp) => `remote ${sp.remote} at (${sp.at.map((v) => v.toFixed(2)).join(", ")})`).join(", "));

// ------------------------------------------------ 2. walk up and watch
// stand in the aisle between the rows, off to one side, facing the screen
const start = { x: sc[0] + n[0] * 5.45, y: sc[1] - 1.1, z: sc[2] - 1.2 };
await ev(({ start, sc }) => {
  const c = window.__chimp;
  c.setPose({ ...start, yaw: Math.atan2(sc[0] - start.x, sc[2] - start.z), pitch: -0.15, fov: 1.2 });
  c.setWalking(true);
}, { start, sc });
await settle(15);
let offered = true;
await waitFor(() => window.__chimp.state().theatrePrompt, null, 4000).catch(() => (offered = false));
check(offered && (await state()).walking, "walking in the theatre and looking at the screen offers it", (await state()).area);
await shot("1-walked-up");
const feetY = await ev(() => window.__chimp.walker().feet.y);

const pressed = await page.keyboard.press("KeyE").then(() => Date.now());
await waitFor(() => window.__chimp.state().focus?.phase === "on" && !!window.__chimp.state().focusRect, null, 5000);
await settle(10);
check((await state()).focus?.kind === "theatre", `E watches it (${((Date.now() - pressed) / 1000).toFixed(1)} s to arrive)`);
check(!(await ev(() => !!document.pointerLockElement)), "the mouse is free");
const cam = await ev(() => {
  const c = window.__chimp.scene.activeCamera;
  const V = c.position.constructor;
  return { pos: c.position.asArray(), fwd: c.getDirection(new V(0, 0, 1)).asArray() };
});
const square = -(cam.fwd[0] * n[0] + cam.fwd[1] * n[1] + cam.fwd[2] * n[2]);
check(square > 0.99999, "the camera is square onto the screen", `cos = ${square.toFixed(6)}`);
check(Math.abs(cam.pos[1] - (feetY + 1.15)) < 0.01, "at seat height", `eye ${(cam.pos[1] - feetY).toFixed(2)} m above the floor`);

// without a remote nobody can choose a video: the frame says where the remotes are
const noRemote = await ev(() => ({ input: !!document.querySelector(".focus-bar .video-picker input"), hint: document.querySelector(".focus-bar .focus-hint")?.textContent ?? "", refused: window.__chimp.theatre.choose("aqz-KE-bpKQ") }));
check(!noRemote.input && /remote/.test(noRemote.hint) && /remote/.test(noRemote.refused ?? ""), "without a remote nothing can be chosen: the frame says to pick one up from the stand", noRemote.hint);
await page.click(".focus-bar .leave");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);

// the remotes: walk up to the stand, take one, put it down, take it again
const walkTo = async (pose) => {
  await ev((p) => {
    window.__chimp.setWalking(false);
    window.__chimp.setPose(p);
    window.__chimp.setWalking(true);
  }, pose);
  await settle(10);
};
const atStand = (sp) => ({ x: sp[0] - 1.1, y: sp[1] + 1.1, z: sp[2], yaw: Math.PI / 2, pitch: 0.75, fov: 1.2 });
const startPose = { ...start, yaw: Math.atan2(sc[0] - start.x, sc[2] - start.z), pitch: -0.15, fov: 1.2 };
const held = () => ev(() => window.__chimp.remotes.held());
await walkTo(atStand(spots[0].at));
const offer = await state();
check(offer.remotePrompt?.action === "take" && offer.remotePrompt.remote === 1 && !offer.theatrePrompt, "at the stand, looking at a remote, E offers to pick it up (not to watch)", JSON.stringify(offer.remotePrompt));
await shot("2-remote-offered");
await page.keyboard.press("KeyE");
await settle(5);
const took = await ev(() => ({ panel: document.querySelector(".panel.remote .section")?.textContent ?? "", prompt: window.__chimp.state().remotePrompt }));
check((await held()) === 1 && (await onStand()) === "[false,true]" && /Remote 1/.test(took.panel), "E picks it up: it leaves the stand, and the remote's panel shows", took.panel);
check(took.prompt?.action === "put", "with it in hand at the stand, E offers to put it down");
await shot("3-remote-in-hand");
await page.keyboard.press("KeyE");
await settle(5);
check((await held()) === null && (await onStand()) === "[true,true]" && !(await ev(() => !!document.querySelector(".panel.remote"))), "E puts it down on the stand again");
await page.keyboard.press("KeyE");
await settle(5);
check((await held()) === 1, "and picks it up again");

// back to the aisle with the remote, and watch
await walkTo(startPose);
await waitFor(() => window.__chimp.state().theatrePrompt, null, 4000);
const before = await ev(() => window.__chimp.pose());
await page.keyboard.press("KeyE");
await waitFor(() => window.__chimp.state().focus?.phase === "on" && !!window.__chimp.state().focusRect, null, 5000);
await settle(10);
check(await ev(() => document.activeElement?.matches(".focus-bar .video-picker input")), "with a remote and nothing showing, the frame's link box has the keyboard");
await page.keyboard.type(VIDEO);
await page.keyboard.press("Enter");
let played = true;
await waitFor(() => document.querySelector("iframe.theatre-player")?.style.visibility === "visible", null, 5000);
const playing = async (timeout = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await playerState())?.state === PLAYING) return true;
    await page.waitForTimeout(100);
  }
  return false;
};
played = await playing();
await settle(10);
const s1 = await state();
check(played && s1.theatre.videoId === "aqz-KE-bpKQ" && s1.theatre.playing, "a pasted link plays at once (the click that chose it allows sound)", JSON.stringify(s1.theatre));
const ps1 = await playerState();
check(Math.abs(ps1.time - 30) < 3, "from the link's start time (t=30)", `${ps1.time.toFixed(1)} s`);
await waitFor(() => !!window.__chimp.state().theatreVideo, null, 8000).catch(() => {});
check(/Big Buck Bunny/.test((await state()).theatreVideo?.title ?? ""), "the title comes from YouTube", (await state()).theatreVideo?.title ?? "no title (no network?)");

/** The screen's corners on the page, worked out here from the camera, not by the code under test. */
const projected = () =>
  ev((corners) => {
    const c = window.__chimp.scene.activeCamera;
    const V = c.position.constructor;
    const vp = c.getViewMatrix(true).multiply(c.getProjectionMatrix(true));
    const box = document.querySelector("canvas.scene").getBoundingClientRect();
    return corners.map((p) => {
      const q = V.TransformCoordinates(V.FromArray(p), vp);
      return { x: box.left + ((q.x + 1) / 2) * box.width, y: box.top + ((1 - q.y) / 2) * box.height };
    });
  }, screen.corners);
const align = async () => {
  const [bl, br, tr, tl] = await projected();
  const got = await ev(() => {
    const r = document.querySelector("iframe.theatre-player").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const upright = Math.max(Math.abs(bl.x - tl.x), Math.abs(br.x - tr.x), Math.abs(bl.y - br.y), Math.abs(tl.y - tr.y));
  const want = { x: tl.x, y: tl.y, w: tr.x - tl.x, h: bl.y - tl.y };
  const err = Math.max(Math.abs(want.x - got.x), Math.abs(want.y - got.y), Math.abs(want.w - got.w), Math.abs(want.h - got.h));
  return { want, got, err, upright };
};
/** A screenshot's pixels: px(x, y) is [r, g, b], or null off the page. */
const snap = async () => {
  const { data, info } = await sharp(await page.screenshot()).raw().toBuffer({ resolveWithObject: true });
  return (x, y) => {
    const [i, j] = [Math.round(x), Math.round(y)];
    if (i < 0 || j < 0 || i >= info.width || j >= info.height) return null;
    const k = (j * info.width + i) * info.channels;
    return [data[k], data[k + 1], data[k + 2]];
  };
};
const CORNERS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]; // the test card's top-left, top-right, bottom-right, bottom-left
const close = (a, b) => !!a && a.every((v, i) => Math.abs(v - b[i]) < 40);
/** The test card's corner colours in a screenshot, just inside the player's corners, and just outside. */
const corners = async (r) => {
  const px = await snap();
  const at = (dx, dy) => [px(r.x + dx, r.y + dy), px(r.x + r.w - 1 - dx, r.y + dy), px(r.x + r.w - 1 - dx, r.y + r.h - 1 - dy), px(r.x + dx, r.y + r.h - 1 - dy)];
  return { inside: at(2, 2).every((c, i) => close(c, CORNERS[i])), outside: at(-3, -3).every((c, i) => !close(c, CORNERS[i])), sample: at(2, 2) };
};
/** Whether, in a screenshot, the test card's corners sit on the screen's corners as projected here: just inside each, and not just outside. */
const onScreen = async () => {
  const [bl, br, tr, tl] = await projected();
  const quad = [tl, tr, br, bl];
  const cx = quad.reduce((a, p) => a + p.x / 4, 0);
  const cy = quad.reduce((a, p) => a + p.y / 4, 0);
  const toward = (p, d) => {
    const l = Math.hypot(cx - p.x, cy - p.y);
    return [p.x + ((cx - p.x) / l) * d, p.y + ((cy - p.y) / l) * d];
  };
  const px = await snap();
  const sample = quad.map((p) => px(...toward(p, 7)));
  return { inside: sample.every((c, i) => close(c, CORNERS[i])), outside: quad.every((p, i) => !close(px(...toward(p, -4)), CORNERS[i])), sample };
};
const vw = page.viewportSize();
const a1 = await align();
check(a1.upright < 0.5 && a1.err < 1, "the player lies exactly over the screen, a plain rectangle", `off by ${a1.err.toFixed(2)} px; ${Math.round(a1.got.w)} x ${Math.round(a1.got.h)} px`);
const c1 = await corners(a1.got);
check(c1.inside && c1.outside, "in a screenshot the test card's corners sit on the screen's corners", c1.inside ? "" : JSON.stringify(c1.sample));
check(a1.got.w >= 480 && a1.got.h >= 270, "bigger than YouTube's minimum (200 x 200) and recommended 16:9 size (480 x 270)");
const over = await ev((r) => {
  const hits = new Set();
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) hits.add(document.elementFromPoint(r.x + 1 + ((r.w - 2) * i) / 10, r.y + 1 + ((r.h - 2) * j) / 10)?.className ?? "none");
  const bars = [...document.querySelectorAll(".focus-bar")].map((b) => b.getBoundingClientRect());
  const overlap = bars.some((b) => b.right > r.x && b.left < r.x + r.w && b.bottom > r.y && b.top < r.y + r.h);
  return { hits: [...hits], overlap, top: document.querySelector(".focus-bar.top")?.textContent, bottom: !!document.querySelector(".focus-bar.bottom .leave") };
}, a1.got);
check(over.hits.length === 1 && over.hits[0].startsWith("theatre-player") && !over.overlap, "nothing lies over the player: the frame of UI is outside it", over.hits.join(", "));
check(/Big Buck Bunny/.test(over.top ?? "") && over.bottom, "the frame shows the title, and a Leave button", over.top);
await shot("4-watching");

// keys: into the player while it has the keyboard, never to ChimpHouse
const houseState = () =>
  ev(() => {
    const s = window.__chimp.state();
    return JSON.stringify({ pose: window.__chimp.pose(), walking: s.walking, night: s.night, view: s.viewId, roof: s.roofHidden, upper: s.upperHidden, help: s.help, inspect: s.inspectMode });
  });
const h0 = await houseState();
check(await standin().evaluate(() => document.hasFocus()), "the player has the keyboard once it shows");
for (const k of ["KeyW", "KeyA", "KeyF", "KeyN", "Digit1", "KeyH", "KeyE"]) await page.keyboard.press(k);
check((await playerState()).keys.join(" ") === "KeyW KeyA KeyF KeyN Digit1 KeyH KeyE", "keys typed into the player go to it", (await playerState()).keys.join(" "));
await page.keyboard.press("Space");
await page.waitForTimeout(300);
const paused = await playerState();
const s2 = await state();
check(paused.state === PAUSED && !s2.theatre.playing && Math.abs(s2.theatre.at - paused.time) < 0.5, "pausing in the player pauses the theatre, at its time", `${s2.theatre.at.toFixed(1)} s`);
await page.keyboard.press("Space");
check(await playing(), "and playing it plays the theatre");
await page.click(".focus-bar.top .name");
for (const k of ["KeyF", "KeyN", "Digit2", "KeyU", "KeyE"]) await page.keyboard.press(k);
await page.keyboard.down("KeyD");
await page.waitForTimeout(400);
await page.keyboard.up("KeyD");
await settle(10);
check((await houseState()) === h0, "ChimpHouse's own keys do nothing while watching, even with its page focused");
await ev(() => {
  const c = document.querySelector("canvas.scene");
  window.__lockCalls = 0;
  const orig = c.requestPointerLock.bind(c);
  c.requestPointerLock = (...a) => (window.__lockCalls++, orig(...a));
});
await page.mouse.click(30, vw.height - 30);
await settle(5);
check((await ev(() => window.__lockCalls)) === 0, "a click on the scene round the player doesn't capture the mouse");

// resize: the player follows the screen
await page.setViewportSize({ width: 1180, height: 820 });
await settle(20);
const a2 = await align();
const c2 = await corners(a2.got);
check(a2.upright < 0.5 && a2.err < 1 && c2.inside, "after a window resize the player still lies over the screen", `off by ${a2.err.toFixed(2)} px at 1180 x 820; ${Math.round(a2.got.w)} x ${Math.round(a2.got.h)} px`);
await shot("5-resized");
await page.setViewportSize(vw);
await settle(20);
const a3 = await align();
check(a3.err < 1, "and back", `off by ${a3.err.toFixed(2)} px`);

// ------------------------------------------------ 3. leave, and the video over the screen as you move about
const placed = () => ev(() => window.__chimp.theatre.placement());
await page.click(".focus-bar .leave");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
await settle(10);
const left = await ev(() => ({ pose: window.__chimp.pose(), walking: window.__chimp.state().walking, frame: !!document.querySelector(".focus-bar") }));
const off = Math.hypot(left.pose.x - before.x, left.pose.z - before.z);
check(!left.frame && left.walking && off < 0.05 && Math.abs(left.pose.yaw - before.yaw) < 0.01, "Leave takes the frame away and puts you back where you stood, walking", `${off.toFixed(3)} m from it`);
const pl1 = await placed();
check(pl1.view === "over" && (await playerState()).state === PLAYING && (await state()).theatre.playing, "the video keeps playing, laid over the screen in perspective", pl1.why);
const o1 = await onScreen();
check(o1.inside && o1.outside, "in a screenshot the test card's corners sit on the screen's corners", o1.inside ? "" : JSON.stringify(o1.sample));
await shot("6-left");
// walk on sideways: in every frame drawn meanwhile, the player's corners (through its
// transform) lie on the screen's corners as projected from that frame's camera
await ev((corners) => {
  const c = window.__chimp;
  const V = c.scene.activeCamera.position.constructor;
  const f = document.querySelector("iframe.theatre-player");
  window.__drift = { frames: 0, over: 0, worst: 0 };
  window.__driftObs = c.scene.onAfterRenderObservable.add(() => {
    const cam = c.scene.activeCamera;
    const vp = cam.getViewMatrix().multiply(cam.getProjectionMatrix());
    const box = document.querySelector("canvas.scene").getBoundingClientRect();
    const want = [3, 2, 1, 0].map((i) => {
      const q = V.TransformCoordinates(V.FromArray(corners[i]), vp); // top-left, top-right, bottom-right, bottom-left
      return [box.left + ((q.x + 1) / 2) * box.width, box.top + ((1 - q.y) / 2) * box.height];
    });
    window.__drift.frames++;
    if (f.style.visibility !== "visible" || f.style.transform === "none") return;
    window.__drift.over++;
    const m = new DOMMatrix(f.style.transform);
    const [w, h] = [f.offsetWidth, f.offsetHeight];
    [[0, 0], [w, 0], [w, h], [0, h]].forEach(([x, y], i) => {
      const p = m.transformPoint(new DOMPoint(x, y, 0, 1));
      window.__drift.worst = Math.max(window.__drift.worst, Math.hypot(p.x / p.w - want[i][0], p.y / p.w - want[i][1]));
    });
  });
}, screen.corners);
const p0 = await ev(() => window.__chimp.pose());
await page.keyboard.down("KeyA");
await page.waitForTimeout(700);
await page.keyboard.up("KeyA");
await settle(5);
const drift = await ev(() => (window.__chimp.scene.onAfterRenderObservable.remove(window.__driftObs), window.__drift));
const p1 = await ev(() => window.__chimp.pose());
check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.8 && drift.over > 10 && drift.worst < 0.5, "walking on, the picture stays on the screen in every frame drawn", `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m; ${drift.over} of ${drift.frames} frames over the screen, corners off by at most ${drift.worst.toFixed(2)} px`);

// about the room, flying: the camera wherever it's put, looking at the screen
await ev(() => window.__chimp.setWalking(false));
const facing = (at, fov = 1.2) => ({ ...at, yaw: Math.atan2(sc[0] - at.x, sc[2] - at.z), pitch: -Math.atan2(sc[1] - at.y, Math.hypot(sc[0] - at.x, sc[2] - at.z)), fov });
const go = async (pose) => {
  await ev((p) => window.__chimp.setPose(p), pose);
  await settle(10);
};
const middle = facing({ x: sc[0] - 5.0, y: sc[1] - 1.1, z: sc[2] + 0.4 });
for (const [where, at] of [
  ["the front left, by a speaker", { x: sc[0] - 3.0, y: sc[1] - 1.2, z: sc[2] + 2.3 }],
  ["the rear row's right end", { x: sc[0] - 7.0, y: sc[1] - 0.8, z: sc[2] - 2.6 }],
  ["the middle of the room", { x: sc[0] - 5.0, y: sc[1] - 1.1, z: sc[2] + 0.4 }],
]) {
  await go(facing(at));
  const pl = await placed();
  const o = await onScreen();
  check(pl.view === "over" && o.inside && o.outside, `from ${where}, the picture lies on the screen`, pl.why || (o.inside ? "" : JSON.stringify(o.sample)));
  if (where.includes("front left")) await shot("7-over-from-the-side");
}

// when it can't be seen properly it hides, paused first, and the theatre keeps going
const lb = lightbox.corners.reduce((a, c) => a.map((v, i) => v + c[i] / 4), [0, 0, 0]);
const hides = [
  ["looking away", { ...middle, yaw: middle.yaw + 1.0 }, "mostly off the page"],
  ["something in the way", middle, "something is in the way"],
  ["seen from the side wall", facing({ x: sc[0] - 1.2, y: sc[1] - 1.1, z: sc[2] - 3.3 }), "seen too steeply"],
  ["from the back with a wide view", facing({ x: sc[0] - 10.8, y: sc[1] - 0.9, z: sc[2] }, 1.5), "too small"],
  ["right by the screen, looking along it", { x: sc[0] - 1.0, y: sc[1], z: sc[2], yaw: 0, pitch: 0, fov: 1.2 }, "behind the camera"],
  ["out in the corridor", { x: lb[0] + 0.3, y: lb[1] - 0.1, z: lb[2] - 2.6, yaw: 0, pitch: 0.02, fov: 1.0 }, "out of the theatre"],
];
for (const [i, [what, pose, why]] of hides.entries()) {
  await go(middle);
  await page.waitForTimeout(500);
  if (i === 0) {
    check((await placed()).view === "over" && (await playerState()).state === PLAYING, "in view again, it plays again");
  }
  const n0 = (await playerState()).pauses.length;
  if (why === "something is in the way") await ev((at) => window.__chimp.theatre.blocker(at), [sc[0] - 2.5, sc[1] - 0.5, sc[2] + 0.2]);
  await go(pose);
  const pl = await placed();
  const ps = await playerState();
  const pauses = ps.pauses.slice(n0);
  check(pl.view === "hidden" && pl.why === why && ps.state === PAUSED && pauses.length > 0 && pauses.every(Boolean), `${what}: it hides (${why}), paused before it hid`, pl.why);
  if (i === 1) await shot("8-blocked");
  if (why === "out of the theatre") {
    const toast = (await state()).toast ?? "";
    check((await held()) === null && (await onStand()) === "[true,true]" && /remote went back/.test(toast), "leaving the theatre with the remote sends it back to the stand", toast);
  }
  await ev(() => window.__chimp.theatre.blocker(null));
}
check((await state()).theatre.playing, "the theatre itself kept playing throughout, like a cinema while someone looks away");
await go(middle);
await page.waitForTimeout(600);
const caught = await playerState();
const pos = await ev(() => window.__chimp.theatre.position());
check(caught.state === PLAYING && Math.abs(caught.time - pos) < 2, "back in view, the player has caught up with the theatre", `player ${caught.time.toFixed(1)} s, theatre ${pos.toFixed(1)} s`);

// volume by distance, scaling the viewer's own volume on the player's slider
const volumeAt = async (d) => {
  await go(facing({ x: sc[0] - d, y: sc[1] - 1.1, z: sc[2] }, 1.0));
  await page.waitForTimeout(400);
  return (await playerState()).volume;
};
const v45 = await volumeAt(4.5);
const v9 = await volumeAt(9);
check(v45 === 100 && Math.abs(v9 - (100 * 5.5) / 9) <= 2, "the volume falls off with distance from the screen", `${v45} at 4.5 m, ${v9} at 9 m`);
await standin().evaluate(() => window.standinSlider(30));
await page.waitForTimeout(1500);
const vOwn = await volumeAt(4.5);
check(Math.abs(vOwn - 30 / (5.5 / 9)) <= 3, "the player's own volume slider still counts: distance scales what the viewer set", `slider at 30 at 9 m, ${vOwn} at 4.5 m`);

// back to watching with the remote, for choosing videos
await walkTo(atStand(spots[1].at));
await page.keyboard.press("KeyE");
await settle(5);
check((await held()) === 2, "remote 2 can be picked up too");
await walkTo(startPose);
await ev(() => window.__chimp.theatre.use());
await settle(5);
check((await state()).focus?.phase === "on", "and E watches again");

// ------------------------------------------------ 4. choosing
const forms = await ev(() =>
  [
    "aqz-KE-bpKQ",
    "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=1m30s",
    "youtube.com/watch?feature=share&v=aqz-KE-bpKQ",
    "https://youtu.be/aqz-KE-bpKQ?t=45",
    "https://www.youtube.com/live/jfKfPfyJRdk?si=abc",
    "https://youtube.com/shorts/aqz-KE-bpKQ",
    "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?start=12",
    "https://m.youtube.com/watch?v=aqz-KE-bpKQ",
    "https://vimeo.com/123456",
    "not a link",
    "https://www.youtube.com/watch?v=short",
  ].map((t) => window.__chimp.theatre.parse(t)),
);
const wantForms = [["aqz-KE-bpKQ", 0, false], ["aqz-KE-bpKQ", 90, false], ["aqz-KE-bpKQ", 0, false], ["aqz-KE-bpKQ", 45, false], ["jfKfPfyJRdk", 0, true], ["aqz-KE-bpKQ", 0, false], ["aqz-KE-bpKQ", 12, false], ["aqz-KE-bpKQ", 0, false], null, null, null];
check(JSON.stringify(forms) === JSON.stringify(wantForms.map((w) => w && { id: w[0], start: w[1], live: w[2] })), "links read: watch?v=, youtu.be/, /live/, /shorts/, /embed/, a bare ID, start times; others refused");

// a live stream, pasted in the frame while watching
await page.fill(".focus-bar .video-picker input", "https://www.youtube.com/live/liveStream1");
await page.click(".focus-bar .video-picker button");
await waitFor(() => window.__chimp.state().theatre.videoId === "liveStream1", null, 3000);
await page.waitForTimeout(300);
const livePlays = await playing();
const lp = await playerState();
check(livePlays && lp.live && (await state()).theatre.live, "a pasted live stream plays, live", `at ${lp.time.toFixed(0)} s of the stream`);
await settle(5);
check(/LIVE/.test(await ev(() => document.querySelector(".focus-bar.top")?.textContent ?? "")), "the frame marks it LIVE");
// a live stream's ordinary watch link: known to be live once it starts at its live edge
await page.fill(".focus-bar .video-picker input", "https://www.youtube.com/watch?v=liveStream2");
await page.click(".focus-bar .video-picker button");
await waitFor(() => window.__chimp.state().theatre.videoId === "liveStream2", null, 3000);
await page.waitForTimeout(300);
const watchLive = (await playing()) && (await waitFor(() => window.__chimp.state().theatre.live, null, 3000).then(() => true, () => false));
check(watchLive, "a live stream from a plain watch link plays, and is known to be live once it starts");

// a video whose owner doesn't allow embedding
await page.fill(".focus-bar .video-picker input", "https://youtu.be/err150abcde");
await page.click(".focus-bar .video-picker button");
await waitFor(() => !!window.__chimp.state().theatreError, null, 4000).catch(() => {});
const blocked = await ev(() => ({ error: window.__chimp.state().theatreError, shown: document.querySelector(".focus-error")?.textContent ?? "", link: document.querySelector(".focus-error a")?.href ?? "" }));
check(/won't play this video outside YouTube: its owner doesn't allow it/.test(blocked.shown) && /watch\?v=err150abcde/.test(blocked.link), "an embed-blocked video says so in plain words, with a link to watch it on YouTube", blocked.error);
await shot("9-embed-blocked");
await page.fill(".focus-bar .video-picker input", "https://vimeo.com/123456");
await page.click(".focus-bar .video-picker button");
check((await ev(() => document.querySelector(".picker-problem")?.textContent)) === "That isn't a YouTube link or video ID.", "something that isn't a YouTube link is refused");
await page.click(".focus-bar .leave");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);

// chosen with the remote's panel while walking about: it starts at once, over the screen
await walkTo(startPose);
await page.fill(".panel.remote .video-picker input", VIDEO);
await page.click(".panel.remote .video-picker button");
await waitFor(() => !!window.__chimp.theatre.thumbnail() && !!window.__chimp.state().theatreVideo, null, 10000).catch(() => {});
const startsNow = await playing();
const s4 = await state();
check(startsNow && s4.theatre.videoId === "aqz-KE-bpKQ" && s4.theatre.playing && (await placed()).view === "over", "chosen with the remote's panel, it starts at once, over the screen", JSON.stringify(s4.theatre));
const thumb = await ev(() => window.__chimp.theatre.thumbnail());
check(/i\.ytimg\.com\/vi\/aqz-KE-bpKQ\//.test(thumb ?? ""), "the screen and lightbox posters have its YouTube thumbnail (allowed as a texture: i.ytimg.com sends CORS)", thumb ?? "no thumbnail");
const panelNow = await ev(() => [...document.querySelectorAll(".theatre-now")].map((e) => e.textContent));
check(panelNow.length === 2 && panelNow.every((t) => /Big Buck Bunny/.test(t ?? "")), "the Theatre panel and the remote's panel show what's on");
await shot("10-remote-panel");

// the remote's buttons, for everyone: K plays or pauses, J and L skip 10 s
await page.keyboard.press("KeyK");
await page.waitForTimeout(300);
check(!(await state()).theatre.playing && (await playerState()).state === PAUSED, "K pauses the theatre");
await page.keyboard.press("KeyK");
check((await playing()) && (await state()).theatre.playing, "and K plays it again");
const t0 = await ev(() => window.__chimp.theatre.position());
await page.keyboard.press("KeyL");
await page.waitForTimeout(700);
const t1 = await ev(() => window.__chimp.theatre.position());
const pl1t = (await playerState()).time;
check(Math.abs(t1 - t0 - 10.7) < 1 && Math.abs(pl1t - t1) < 1.5, "L skips the theatre forward 10 s, and the player follows", `${t0.toFixed(1)} s to ${t1.toFixed(1)} s; player at ${pl1t.toFixed(1)} s`);
await page.keyboard.press("KeyJ");
await page.waitForTimeout(700);
const t2 = await ev(() => window.__chimp.theatre.position());
check(Math.abs(t2 - (t1 - 10 + 0.7)) < 1 && Math.abs((await playerState()).time - t2) < 1.5, "J skips it back 10 s", `${t2.toFixed(1)} s`);
await page.keyboard.press("KeyB");
await settle(5);
check((await held()) === null && (await onStand()) === "[true,true]", "B puts the remote back on the stand from where you stand");

// without a remote, the player is still yours to use, but only for yourself
const refused2 = await ev(() => [window.__chimp.theatre.choose("liveStream1"), window.__chimp.theatre.command("toggle")]);
check(refused2.every((r) => /remote/.test(r ?? "")), "without a remote, nothing can be chosen or paused for the theatre");
await waitFor(() => window.__chimp.state().theatrePrompt, null, 4000);
await page.keyboard.press("KeyE");
await waitFor(() => window.__chimp.state().focus?.phase === "on", null, 5000);
await settle(10);
await page.keyboard.press("Space");
await page.waitForTimeout(1500);
const own = await playerState();
check(own.state === PAUSED && (await state()).theatre.playing, "pausing your own player pauses only yours: the theatre keeps playing");
await page.keyboard.press("Space");
await page.waitForTimeout(800);
const rejoined = await playerState();
const tNow = await ev(() => window.__chimp.theatre.position());
check(rejoined.state === PLAYING && Math.abs(rejoined.time - tNow) < 1.5, "and playing it again rejoins the theatre where it has got to", `player ${rejoined.time.toFixed(1)} s, theatre ${tNow.toFixed(1)} s`);
await page.click(".focus-bar .leave");
await waitFor(() => window.__chimp.state().focus === null, null, 5000);

// the lightbox from the corridor: the poster; out there the player stays hidden
await ev(() => window.__chimp.setWalking(false));
await ev((lb) => window.__chimp.setPose({ x: lb[0] + 0.3, y: lb[1] - 0.1, z: lb[2] - 2.6, yaw: 0, pitch: 0.02, fov: 1.0 }), lb);
await settle(30);
await shot("11-lightbox-poster");
check((await placed()).view === "hidden", "out in the corridor the player stays hidden");

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
await browser.close();
process.exit(failed ? 1 : 0);
