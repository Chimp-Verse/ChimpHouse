// Adaptive render sharpness (src/engine/adaptiveScale.ts): at "high" quality the picture drops from
// 1.25 to 1.0 pixels per CSS pixel only while the computer is struggling, and goes back when it has
// headroom. Two parts:
//   1. the controller on a simulated clock (no browser, a few seconds): drops, recovers, never flaps,
//      is not fooled by a display capped at 30, hitches, a hidden tab or a loading page, backs off
//   2. the real page (a dev server, default http://localhost:5173, URL=... picks another): slow frames
//      forced through the page's test hook make it drop and then recover; a quality chosen by hand
//      resets it; ?adaptive=0 turns it off; the overlay on a screen (the theatre's) stays on its
//      screen across a scale change; the builder's readout (only with VITE_ENABLE_FLY_IN=true) says so.
//   node tools/test-adaptive.mjs            both parts
//   SIM_ONLY=1 node tools/test-adaptive.mjs the simulated clock only
// Exits non-zero when a check fails.
import { ADAPTIVE, AdaptiveScale } from "../src/engine/adaptiveScale.ts";

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};

// ------------------------------------------------ 1. the controller on a simulated clock
/**
 * Runs frames for `seconds`. `plan(t, soft)` gives {dt, gpu} for the frame that ends at t seconds into
 * the scenario; `events` lists {at (seconds), run()} things to do on the way. Returns the switch log.
 */
function simulate(ctl, clock, seconds, plan, opts = {}) {
  const log = [];
  const t0 = clock.t;
  let applied = ctl.soft;
  while (clock.t - t0 < seconds * 1000) {
    const rel = (clock.t - t0) / 1000;
    const f = plan(rel, ctl.soft);
    clock.t += f.dt;
    ctl.frame(clock.t, !!f.ignore, f.gpu ?? null);
    if (ctl.soft !== applied) {
      applied = ctl.soft;
      log.push({ at: (clock.t - t0) / 1000, soft: applied, why: ctl.lastReason });
    }
  }
  if (opts.verbose) console.log(log);
  return log;
}
function make({ gpu = true, quality = true } = {}) {
  const clock = { t: 1000 };
  const applied = [];
  let capture = false;
  const ctl = new AdaptiveScale({ apply: (s) => applied.push(s), gpuCapture: (on) => (capture = on), now: () => clock.t });
  ctl.setGpuSupported(gpu);
  if (quality) ctl.setQuality(true, { full: 1.25, soft: 1.0 });
  return { ctl, clock, applied, capture: () => capture };
}
// a 60 Hz display: frames land on a multiple of 16.7 ms (vsync), whatever the work takes
const vsync = (work, hz = 60) => {
  const p = 1000 / hz;
  return Math.max(p, Math.ceil(work / p) * p);
};

{
  // A: struggling at full (28 ms of work: 33 ms frames, the graphics chip 20 ms; at 1.0 about 13 ms of it), then the load goes
  const { ctl, clock } = make();
  let loaded = true;
  const plan = (t, soft) => {
    const full = loaded ? 20 : 6;
    const gpu = soft ? full / 1.5625 : full;
    return { dt: vsync(gpu + 3), gpu };
  };
  const log1 = simulate(ctl, clock, 40, plan);
  check(log1.length === 1 && log1[0].soft && log1[0].at > 5 && log1[0].at < 12, "slow frames: drops to the soft scale once, after the grace and the hold", JSON.stringify(log1));
  loaded = false;
  const log2 = simulate(ctl, clock, 60, plan);
  check(log2.length === 1 && !log2[0].soft && log2[0].at >= ADAPTIVE.RAISE_HOLD_MS / 1000 && log2[0].at < 9, "load gone: back to full sharpness after the 5 s hold", JSON.stringify(log2));
  const log3 = simulate(ctl, clock, 300, plan);
  check(log3.length === 0, "then it stays there (no flapping over 5 minutes)", JSON.stringify(log3));
}
{
  // A2: the load goes right after the drop: the raise still waits out the cooldown since the switch
  const { ctl, clock } = make();
  let loaded = true;
  const plan = (t, soft) => {
    const gpu = (loaded ? 20 : 6) / (soft ? 1.5625 : 1);
    return { dt: vsync(gpu + 3), gpu };
  };
  const log = simulate(ctl, clock, 6.7, plan);
  loaded = false;
  log.push(...simulate(ctl, clock, 40, plan).map((l) => ({ ...l, at: l.at + 6.7 })));
  const up = log.find((l) => !l.soft);
  check(log[0]?.soft && up && ctl.state().switches === 2, "a short load: dropped, then back up", JSON.stringify(log));
  check(up && up.at - log[0].at >= ADAPTIVE.COOLDOWN_MS / 1000, "and never sooner than the cooldown after the drop", `${up ? (up.at - log[0].at).toFixed(1) : "-"} s`);
}
{
  // B: a display capped at 30 Hz with the graphics chip idle: slow frames that pixels don't explain
  const { ctl, clock } = make();
  const log = simulate(ctl, clock, 120, () => ({ dt: 33.3, gpu: 3 }));
  check(log.length === 0, "a 30 Hz cap with an idle graphics chip is not struggling", JSON.stringify(log));
}
{
  // B2: the same cap and no graphics timer to say so: it drops once, sees it did not help, and undoes it
  const { ctl, clock } = make({ gpu: false });
  const log = simulate(ctl, clock, 100, () => ({ dt: 33.3 }));
  const drops = log.filter((l) => l.soft).length;
  check(drops >= 1 && drops <= 2 && !ctl.soft && /did not help/.test(log.find((l) => !l.soft)?.why ?? ""), "no timer, 30 Hz cap: a drop that does not help is undone, and not repeated soon", JSON.stringify(log));
}
{
  // C: slow frames that fewer pixels do not fix (the processor): drops are undone and their retries back off
  const { ctl, clock } = make();
  const log = simulate(ctl, clock, 900, () => ({ dt: 33.3, gpu: 14 }));
  const softTime = log.reduce((acc, l, i) => acc + (l.soft ? ((log[i + 1]?.at ?? 900) - l.at) : 0), 0);
  check(log.length <= 14 && softTime < 0.2 * 900, "a drop that does not help is undone and retried less and less often", `${log.length} switches, ${softTime.toFixed(0)} s soft of 900`);
  check(ctl.state().dropWaitMs >= 120000, "the wait before the next try grows", `${ctl.state().dropWaitMs} ms`);
}
{
  // D: the timer says there is room at the soft scale but the sharp one cannot hold: raise, drop, raise... with growing waits
  const { ctl, clock } = make();
  const plan = (t, soft) => (soft ? { dt: 16.7, gpu: 3 } : { dt: 33.3, gpu: 20 });
  const log = simulate(ctl, clock, 900, plan);
  const raises = log.filter((l) => !l.soft).length;
  check(raises <= 6 && ctl.state().upWaitMs >= 80000, "a raise that has to come down again: the wait doubles, so it does not flap", `${raises} raises in 900 s, wait now ${ctl.state().upWaitMs} ms`);
  const gaps = log.filter((l) => !l.soft).map((l, i, a) => (i ? l.at - a[i - 1].at : 0)).slice(1);
  check(gaps.every((g, i) => i === 0 || g >= gaps[i - 1] * 0.9), "each try comes later than the last", gaps.map((g) => g.toFixed(0)).join(" "));
}
{
  // E: hitches, a hidden tab and a loading page are not load
  const { ctl, clock } = make();
  const log = simulate(ctl, clock, 120, (t) => ({ dt: Math.abs(t % 3) < 0.02 ? 400 : 16.7, gpu: 5 }));
  check(log.length === 0, "a 400 ms hitch every 3 s does not count", JSON.stringify(log));
  const log2 = simulate(ctl, clock, 60, (t) => (t < 30 ? { dt: 2000, ignore: true } : { dt: 16.7, gpu: 5 }));
  check(log2.length === 0, "a hidden tab (its frames ignored, then a huge first frame) does not count", JSON.stringify(log2));
  ctl.grace(ADAPTIVE.LOAD_GRACE_MS);
  const t0 = clock.t;
  const log3 = simulate(ctl, clock, 30, (t, soft) => ({ dt: soft ? 16.7 : 33.3, gpu: soft ? 12 : 20 }));
  check(log3.length === 1 && log3[0].soft && log3[0].at * 1000 > ADAPTIVE.LOAD_GRACE_MS + ADAPTIVE.DROP_HOLD_MS, "after loading, slow frames are ignored for the first seconds", `first drop at ${log3[0]?.at.toFixed(1)} s (start ${t0})`);
}
{
  // F: no graphics timer: frames well under 16 ms prove room; frames holding 60 only earn a late, backed-off trial
  const { ctl, clock } = make({ gpu: false });
  let mode = "slow";
  const plan = (t, soft) => {
    if (mode === "slow") return { dt: soft ? 16.7 : 33.3 };
    if (mode === "fast") return { dt: soft ? 9 : 12 }; // an uncapped or 120 Hz display
    return { dt: 16.7 }; // locked at 60, which says nothing about headroom
  };
  let log = simulate(ctl, clock, 20, plan);
  check(log.length === 1 && log[0].soft, "no timer: slow frames drop it", JSON.stringify(log));
  mode = "fast";
  log = simulate(ctl, clock, 30, plan);
  check(log.length === 1 && !log[0].soft && log[0].at < 25, "no timer: frames under 12 ms prove headroom: back up", JSON.stringify(log));
  // now locked at 60 while soft
  const g = make({ gpu: false });
  mode = "slow";
  simulate(g.ctl, g.clock, 20, plan);
  mode = "locked";
  log = simulate(g.ctl, g.clock, 120, plan);
  check(log.length === 1 && !log[0].soft && log[0].at >= 30 && log[0].at <= 60, "no timer, locked at 60: only a late trial of the sharper picture", JSON.stringify(log));
}
{
  // G: displays and computers of other kinds
  const fast = make();
  check(simulate(fast.ctl, fast.clock, 60, () => ({ dt: 8.3, gpu: 4 })).length === 0, "a 120 Hz display at full speed: nothing happens");
  const slow = make();
  const log = simulate(slow.ctl, slow.clock, 60, (t, soft) => (soft ? { dt: 120, gpu: 96 } : { dt: 200, gpu: 150 }));
  check(log.length === 1 && log[0].soft, "a computer at 5 fps (every frame a long one) does drop", JSON.stringify(log));
}
{
  // H: quality chosen by hand; medium and low are never touched; the adaptive switch off
  const { ctl, clock, applied } = make();
  simulate(ctl, clock, 20, (t, soft) => ({ dt: soft ? 16.7 : 33.3, gpu: soft ? 12 : 20 }));
  check(ctl.soft, "setup: dropped");
  ctl.setQuality(false, { full: 1.25, soft: 1.0 });
  check(!ctl.soft && !ctl.state().active, "a manual change to medium resets it to the full state and turns it off");
  const n = applied.length;
  simulate(ctl, clock, 30, () => ({ dt: 40, gpu: 30 }));
  check(applied.length === n, "at medium or low it never switches");
  ctl.setQuality(true, { full: 1.25, soft: 1.0 });
  check(ctl.state().upWaitMs === ADAPTIVE.COOLDOWN_MS && !ctl.soft, "back to high starts clean");
  const off = make();
  off.ctl.enabled = false;
  check(simulate(off.ctl, off.clock, 30, () => ({ dt: 40, gpu: 30 })).length === 0, "switched off (?adaptive=0): never switches");
  const dpr1 = make({ quality: false });
  dpr1.ctl.setQuality(true, { full: 1.0, soft: 1.0 });
  check(simulate(dpr1.ctl, dpr1.clock, 30, () => ({ dt: 40, gpu: 30 })).length === 0, "a screen already at 1.0 has nothing to drop");
  const forced = make();
  forced.ctl.force(true);
  check(forced.ctl.soft && forced.ctl.state().scale === 1.0, "force(true) holds the soft scale");
  simulate(forced.ctl, forced.clock, 60, () => ({ dt: 8, gpu: 1 }));
  check(forced.ctl.soft, "and the automatic choice leaves it alone");
  forced.ctl.force(null);
  check(forced.ctl.state().active, "force(null) gives it back");
}
{
  // I: the graphics timer is only on while it is needed
  const { ctl, clock, capture } = make();
  simulate(ctl, clock, 10, () => ({ dt: 16.7, gpu: 4 }));
  check(!capture(), "no timer running at a steady 60 fps (it costs a little per frame)");
  simulate(ctl, clock, 10, () => ({ dt: 33.3, gpu: 20 }));
  check(capture(), "timer on once frames run slow");
}

if (process.env.SIM_ONLY) {
  console.log(failed ? `${failed} CHECK(S) FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}

// ------------------------------------------------ 2. the real page
const { chromium } = await import("playwright");
const { mkdir } = await import("node:fs/promises");
const URL = process.env.URL ?? "http://localhost:5173";
const SHOTS = process.env.SHOTS ?? "captures";
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const stop = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await context.addInitScript(() => {
    Element.prototype.requestPointerLock = () => Promise.resolve();
    Element.prototype.requestFullscreen = () => Promise.resolve();
    if (navigator.keyboard) navigator.keyboard.lock = () => Promise.resolve();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => m.type() === "error" && !/\/chimpvibe\/|403|404/.test(m.text()) && console.log("[browser error]", m.text().slice(0, 300)));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
  const st = () => ev(() => window.__chimp.adaptive.state());
  const open = async (query) => {
    await page.goto(`${URL}/?arcade=standin&theatre=standin${query}`);
    await waitFor(() => window.__chimp?.ready === true, null, 300000);
    await ev(() => window.__chimp.settle(20));
  };

  // ---- the drop and the recovery, with forced slow frames. The page runs the controller on a clock that
  // advances one forced frame time per drawn frame, so a busy computer only makes this test take longer.
  // (the forced frames are 33 ms and 17 ms; real ones are set aside.)
  //  At 2x, high is 1.25 and soft 1.0.
  await open("&quality=high");
  let s = await st();
  check(s.enabled && s.active && !s.soft && s.renderScale === 1.25, "high quality starts at 1.25", JSON.stringify(s));
  const canvas0 = await ev(() => ({ w: document.querySelector("canvas").width, h: document.querySelector("canvas").height }));
  // the page's own frame times are set aside: frames of 33 ms at 1.25 (graphics chip 20 ms) and 17 ms at 1.0 (13 ms)
  await ev(() => window.__chimp.adaptive.simulate({ frameMs: { full: 33.3, soft: 16.7 }, gpuMs: { full: 20, soft: 12.8 } }));
  await waitFor(() => window.__chimp.adaptive.state().soft, null, 240000).catch(() => undefined);
  s = await st();
  check(s.soft && s.renderScale === 1.0 && s.switches === 1, "slow frames: the picture drops to 1.0", JSON.stringify(s));
  const canvas1 = await ev(() => ({ w: document.querySelector("canvas").width, h: document.querySelector("canvas").height }));
  check(canvas1.w < canvas0.w && Math.abs(canvas1.w / canvas0.w - 0.8) < 0.02, "the canvas really is smaller", `${canvas0.w}x${canvas0.h} to ${canvas1.w}x${canvas1.h}`);
  // the load goes: the graphics chip takes 5 ms (3 ms at 1.0)
  await ev(() => window.__chimp.adaptive.simulate({ frameMs: { full: 16.7, soft: 16.7 }, gpuMs: { full: 5, soft: 3.2 } }));
  await waitFor(() => !window.__chimp.adaptive.state().soft, null, 240000).catch(() => undefined);
  s = await st();
  check(!s.soft && s.renderScale === 1.25 && s.switches === 2, "load gone: back to 1.25", JSON.stringify(s));
  await ev(() => window.__chimp.settle(600));
  s = await st();
  check(s.switches === 2, "and it stays (no flapping)", `switches ${s.switches}`);
  await ev(() => window.__chimp.adaptive.simulate(null));

  // ---- a quality chosen by hand
  await ev(() => window.__chimp.adaptive.simulate({ frameMs: { full: 33.3, soft: 16.7 }, gpuMs: { full: 20, soft: 12.8 } }));
  await waitFor(() => window.__chimp.adaptive.state().soft, null, 240000).catch(() => undefined);
  await ev(() => window.__chimp.adaptive.simulate(null));
  check((await st()).soft, "setup: dropped again");
  await page.evaluate(() => document.querySelectorAll(".quality button, [class*=quality] button").length); // the panel may be hidden; use the store through the page's controller below
  const medium = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "medium");
    if (btn) btn.click();
    await window.__chimp.settle(5);
    return window.__chimp.adaptive.state();
  });
  check(!medium.soft && !medium.active && medium.renderScale === 1.0, "choosing medium by hand resets it, and it stays off", JSON.stringify(medium));
  const high = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "high");
    if (btn) btn.click();
    await window.__chimp.settle(5);
    return window.__chimp.adaptive.state();
  });
  check(high.active && !high.soft && high.renderScale === 1.25 && high.upWaitMs === ADAPTIVE.COOLDOWN_MS, "choosing high again starts clean at 1.25", JSON.stringify(high));

  // ---- the overlay on a screen stays on it across a scale change (the theatre's, in watch mode)
  const sync = await alignment(ev, waitFor);
  check(sync.ok, "a screen in use: its frame stays on the screen when the render scale changes", JSON.stringify(sync));
  await ev(() => window.__chimp.theatre.leave());
  await waitFor(() => window.__chimp.state().focus === null, null, 8000).catch(() => undefined);

  // ---- the builder's readout (only with the builder's tools on)
  const hasTools = await ev(() => window.__chimp.flyIn);
  if (hasTools) {
    await ev(() => window.__chimp.adaptive.force(true));
    await ev(() => window.__chimp.settle(40));
    const perf = await ev(() => document.querySelector(".perf")?.textContent ?? "");
    check(/scale 1\.0 \(auto\)/.test(perf), "builder's readout says scale 1.0 (auto)", perf);
    await ev(() => window.__chimp.adaptive.force(false));
    await ev(() => window.__chimp.settle(40));
    const perf2 = await ev(() => document.querySelector(".perf")?.textContent ?? "");
    check(/scale 1\.25/.test(perf2) && !/auto/.test(perf2), "and scale 1.25 otherwise", perf2);
    await ev(() => window.__chimp.adaptive.force(null));
  } else {
    const perf = await ev(() => document.querySelector(".perf")?.textContent ?? "");
    check(perf === "", "without the builder's tools nothing about the scale is shown to visitors");
  }

  // ---- ?adaptive=0
  await open("&quality=high&adaptive=0");
  s = await st();
  check(!s.enabled && !s.active, "?adaptive=0 turns it off", JSON.stringify(s));
  await ev(() => window.__chimp.adaptive.simulate({ frameMs: { full: 33.3, soft: 16.7 }, gpuMs: { full: 20, soft: 12.8 } }));
  await ev(() => window.__chimp.settle(420));
  s = await st();
  check(!s.soft && s.switches === 0 && s.renderScale === 1.25, "and slow frames leave the picture at 1.25", JSON.stringify(s));
} finally {
  await stop();
}
console.log(failed ? `${failed} CHECK(S) FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);

/**
 * Put the theatre screen in use (as walking up to it and E does), then change the render scale by
 * hand and compare the page's frame round the screen (.focus-ring, CSS pixels) with where the screen's
 * corners project on the page now, before, at 1.0 and back at 1.25.
 */
async function alignment(ev, waitFor) {
  const res = { ok: false };
  await ev(() => {
    const c = window.__chimp;
    const [m] = c.theatre.screens();
    const sc = m.corners.reduce((a, p) => a.map((v, i) => v + p[i] / 4), [0, 0, 0]);
    const n = m.normal;
    const start = { x: sc[0] + n[0] * 5.45, y: sc[1] - 1.1, z: sc[2] - 1.2 };
    c.setPose({ ...start, yaw: Math.atan2(sc[0] - start.x, sc[2] - start.z), pitch: -0.15, fov: 1.2 });
    c.setWalking(true);
  });
  await ev(() => window.__chimp.settle(15));
  await waitFor(() => window.__chimp.state().theatrePrompt, null, 6000).catch(() => undefined);
  await ev(() => window.__chimp.theatre.use());
  await waitFor(() => window.__chimp.state().focus?.phase === "on" && !!window.__chimp.state().focusRect && !!document.querySelector(".focus-ring"), null, 8000);
  await ev(() => window.__chimp.settle(10));
  const measure = () =>
    ev(() => {
      const ring = document.querySelector(".focus-ring").getBoundingClientRect();
      const p = window.__chimp.theatre.screenOnPage();
      const xs = p.map((q) => q.x);
      const ys = p.map((q) => q.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const canvas = document.querySelector("canvas");
      return { dx: ring.left + 6 - x, dy: ring.top + 6 - y, dw: ring.width - 12 - (Math.max(...xs) - x), dh: ring.height - 12 - (Math.max(...ys) - y), w: Math.round(Math.max(...xs) - x), canvasW: canvas.width, pose: window.__chimp.pose() };
    });
  const steps = [];
  for (const soft of [false, true, false]) {
    await ev((soft) => window.__chimp.adaptive.force(soft), soft);
    await ev(() => window.__chimp.settle(30));
    steps.push(await measure());
  }
  await ev(() => window.__chimp.adaptive.force(null));
  res.steps = steps.map((m) => ({ ...m, pose: undefined }));
  const near = (m) => Math.abs(m.dx) < 1.5 && Math.abs(m.dy) < 1.5 && Math.abs(m.dw) < 1.5 && Math.abs(m.dh) < 1.5;
  const sameCamera = steps.every((m) => JSON.stringify(m.pose) === JSON.stringify(steps[0].pose));
  res.ok = steps.every(near) && steps[1].canvasW < steps[0].canvasW && steps[2].canvasW === steps[0].canvasW && steps.every((m) => m.w === steps[0].w) && sameCamera;
  return res;
}
