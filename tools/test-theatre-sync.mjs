// The theatre shared between visitors, through the room server (server/house.ts), which owns it:
// the pages send commands (engine/theatreCommands.ts) and show the state it sends back. Against
// the running preview (npm run dev, which starts the room server too), with the same-origin
// stand-in for YouTube's player (?theatre=standin). Separate browser contexts are separate
// visitors; two pages at most at a time.
//   1. A picks up remote 1: for B it is gone from the stand, and A's chimp holds it; B can't
//      take it, and the server refuses B's choosing or pausing (B has no remote)
//   2. A chooses a video: B's screen plays it too, at the same point; A's pause, play and
//      skip reach B
//   3. B reloads (a latecomer): told how things stand, its player joins the video where it has
//      got to
//   4. B's page is hidden: its player pauses while the theatre plays on; back, it catches up
//   5. A closes their page: the remote goes back to the stand for B, and the video plays on
//   6. with no room server, a page has a theatre of its own, as before: it takes a remote and
//      plays a video
// Exits non-zero when a check fails.
//   node tools/test-theatre-sync.mjs
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:5173";
const ROOM_PORT = process.env.ROOM_PORT ?? "2567";
const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30";
let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAYING = 1;
const PAUSED = 2;
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });

/** A visitor: a page of its own in the theatre, walking, facing the screen. `offline` blocks the room server. */
async function visitor(name, { offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  if (offline) {
    const room = new RegExp(`:${ROOM_PORT}(/|$)`);
    await ctx.route(room, (r) => r.abort());
    await ctx.routeWebSocket(room, (ws) => ws.close());
  }
  const page = await ctx.newPage();
  const refusals = [];
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  page.on("console", (m) => {
    if (/the server refused/.test(m.text())) refusals.push(m.text());
  });
  await page.addInitScript(() => {
    // headless: never trap a real pointer or keyboard
    Element.prototype.requestPointerLock = function () {};
    Element.prototype.requestFullscreen = function () {
      return Promise.resolve();
    };
    if (navigator.keyboard) navigator.keyboard.lock = () => Promise.resolve();
  });
  await page.goto(`${URL}/?pov=first&quality=low&view=theatre&theatre=standin`);
  await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
  const ev = (fn, a) => page.evaluate(fn, a);
  const v = {
    name,
    page,
    ev,
    refusals,
    theatre: () => ev(() => window.__chimp.state().theatre),
    position: () => ev(() => window.__chimp.theatre.position()),
    onStand: () => ev(() => JSON.stringify(window.__chimp.remotes.onStand())),
    placement: () => ev(() => window.__chimp.theatre.placement()),
    player: async () => (await page.frames().find((f) => f.url().includes("/theatre/standin.html"))?.evaluate(() => window.standinState())) ?? null,
    connected: () => ev(() => window.__room.connected),
    /** stand in the aisle facing the screen, `dz` m along it (or at the stand under it) */
    async standIn(where = "aisle", dz = 0) {
      await ev(([where, dz]) => {
        const c = window.__chimp;
        const s = c.theatre.screens()[0];
        const sc = s.corners.reduce((a, p) => a.map((x, i) => x + p[i] / 4), [0, 0, 0]);
        const n = s.normal;
        let p;
        if (where === "stand") {
          const sp = c.remotes.spots()[0].at;
          p = { x: sp[0] - 1.1, y: sp[1] + 1.1, z: sp[2], yaw: Math.PI / 2, pitch: 0.75, fov: 1.2 };
        } else {
          const at = { x: sc[0] + n[0] * 5.45, y: sc[1] - 1.1, z: sc[2] - 0.4 + dz };
          p = { ...at, yaw: Math.atan2(sc[0] - at.x, sc[2] - at.z), pitch: -0.12, fov: 1.2 };
        }
        c.setWalking(false);
        c.setPose(p);
        c.setWalking(true);
      }, [where, dz]);
      await ev(() => window.__chimp.settle(10));
    },
  };
  return v;
}

/** Wait for `fn` on a visitor's page to come true. */
const until = (v, fn, arg, timeout = 8000) => v.page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true, () => false);
/** Wait for a visitor's stand-in player to be in `state`. */
async function playerIs(v, state, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await v.player())?.state === state) return true;
    await sleep(100);
  }
  return false;
}

// OFFLINE_ONLY=1: just the last part
if (!process.env.OFFLINE_ONLY) {
const a = await visitor("A");
// the room keeps the theatre as the last visitors left it: start from the beginning
await a.ev(() => window.__chimp.theatre.reset());
const b = await visitor("B");
check((await a.connected()) && (await b.connected()), "both visitors are in the room");
await a.standIn("stand");
await b.standIn("aisle");
const s0 = await b.theatre();
check(s0.videoId === null && (await b.onStand()) === "[true,true]", "nothing showing, both remotes on the stand", JSON.stringify(s0));

// ------------------------------------------------ 1. the remote, held by one visitor
const took = await a.ev(() => window.__chimp.remotes.take(1));
const aId = (await a.theatre()).remotes[0];
const gone = await until(b, () => JSON.stringify(window.__chimp.remotes.onStand()) === "[false,true]");
const bSees = await b.theatre();
check(took && gone && bSees.remotes[0] === aId && aId, "A picks up remote 1: for B it is gone from the stand, held by A", JSON.stringify(bSees.remotes));
// B, in the aisle, looks toward the stand where A stands
const inHand = await until(b, (id) => window.__chimp.chimps.describe().others.find((o) => o.id === id)?.holding === "theatre-remote-1", aId, 5000);
check(inHand, "and B sees A's chimp holding it", JSON.stringify(await b.ev(() => window.__chimp.chimps.describe().others.map((o) => ({ id: o.id, shown: o.shown, holding: o.holding })))));
check(!(await b.ev(() => window.__chimp.remotes.take(1))), "B can't pick up the remote A holds");
// a page that skips its own checks: the server says no
await b.ev(() => window.__chimp.theatre.send("take", { remote: 1 }));
await b.ev(() => window.__chimp.theatre.send("choose", { videoId: "aqz-KE-bpKQ", start: 0, live: false }));
await sleep(600);
const [ra, rb] = await Promise.all([a.theatre(), b.theatre()]);
check(ra.remotes[0] === aId && rb.remotes[0] === aId && !ra.videoId && !rb.videoId, "the server refuses B taking A's remote, and B choosing a video without one", b.refusals.slice(-2).join(" | "));
check(/remote/.test((await b.ev(() => window.__chimp.theatre.choose("aqz-KE-bpKQ"))) ?? ""), "B's own page says a remote is needed to choose");

// ------------------------------------------------ 2. one video, the same for both
await a.standIn("aisle", 1.2);
check((await a.ev((v) => window.__chimp.theatre.choose(v), VIDEO)) === null, "A, holding a remote, chooses a video");
const bGot = await until(b, () => window.__chimp.state().theatre.videoId === "aqz-KE-bpKQ" && window.__chimp.state().theatre.playing);
const bPlays = await playerIs(b, PLAYING);
const aPlays = await playerIs(a, PLAYING);
check(bGot && bPlays && aPlays, "B's screen plays it too", JSON.stringify({ b: (await b.player())?.state, a: (await a.player())?.state }));
await sleep(1500);
const [pa, pb] = await Promise.all([a.player(), b.player()]);
const [ta, tb] = await Promise.all([a.position(), b.position()]);
check(Math.abs(ta - tb) < 0.3 && Math.abs(pa.time - pb.time) < 1.5 && Math.abs(pb.time - 31.5) < 3, "at the same point for both", `theatre ${ta.toFixed(2)} s and ${tb.toFixed(2)} s; players ${pa.time.toFixed(1)} s and ${pb.time.toFixed(1)} s`);

check((await a.ev(() => window.__chimp.theatre.command("toggle"))) === null, "A pauses with the remote");
const bPaused = (await until(b, () => !window.__chimp.state().theatre.playing)) && (await playerIs(b, PAUSED, 3000));
check(bPaused, "B's player pauses too", JSON.stringify((await b.player())?.state));
await a.ev(() => window.__chimp.theatre.command("toggle"));
check((await until(b, () => window.__chimp.state().theatre.playing)) && (await playerIs(b, PLAYING, 3000)), "A plays again: so does B");
const before = await b.position();
await a.ev(() => window.__chimp.theatre.command("forward"));
await sleep(800);
const [ta2, tb2, pb2] = await Promise.all([a.position(), b.position(), b.player()]);
check(tb2 - before > 9.5 && Math.abs(ta2 - tb2) < 0.3 && Math.abs(pb2.time - tb2) < 1.5, "A skips forward 10 s: B's theatre and player follow", `${before.toFixed(1)} s to ${tb2.toFixed(1)} s; B's player at ${pb2.time.toFixed(1)} s`);

// ------------------------------------------------ 3. a latecomer
await b.page.reload();
await b.page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
await b.standIn("aisle");
const late = await b.theatre();
check(late.videoId === "aqz-KE-bpKQ" && late.playing && late.remotes[0] === aId, "B, reloaded as a new visitor, is told how things stand", JSON.stringify(late));
const latePlays = await playerIs(b, PLAYING);
await sleep(800);
const [ta3, pb3] = await Promise.all([a.position(), b.player()]);
check(latePlays && Math.abs(pb3.time - ta3) < 1.5, "and its player joins the video where it has got to", `theatre ${ta3.toFixed(1)} s, B's player ${pb3?.time.toFixed(1)} s`);

// ------------------------------------------------ 4. B's page hidden
const hide = (v, hidden) =>
  v.ev((hidden) => {
    if (hidden) Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    else delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
await hide(b, true);
await sleep(1500);
const [hb, hpl, hA] = await Promise.all([b.player(), b.placement(), a.theatre()]);
check(hb.state === PAUSED && hpl.view === "hidden" && hA.playing, "B's page hidden: its player pauses, the theatre plays on", `${hpl.why}; B's player ${hb.state}`);
await hide(b, false);
const resumed = await playerIs(b, PLAYING, 4000);
await sleep(600);
const [ta4, pb4] = await Promise.all([a.position(), b.player()]);
check(resumed && Math.abs(pb4.time - ta4) < 1.5, "back, it plays again where the theatre has got to", `theatre ${ta4.toFixed(1)} s, B's player ${pb4.time.toFixed(1)} s`);

// ------------------------------------------------ 5. the holder leaves
await a.page.context().close();
const back = await until(b, () => JSON.stringify(window.__chimp.remotes.onStand()) === "[true,true]", null, 25000);
const after = await b.theatre();
check(back && after.remotes.every((h) => !h), "A closes their page: the remote goes back to the stand for B", JSON.stringify(after.remotes));
check(after.playing && after.videoId === "aqz-KE-bpKQ" && (await b.player())?.state === PLAYING, "and the video plays on");
await b.page.context().close();
}

// ------------------------------------------------ 6. no room server: a theatre of its own
const o = await visitor("Offline", { offline: true });
check(!(await o.connected()), "a page that can't reach the room server");
await o.standIn("stand");
const oTook = await o.ev(() => window.__chimp.remotes.take(1));
const oGone = await until(o, () => JSON.stringify(window.__chimp.remotes.onStand()) === "[false,true]", null, 3000);
check(oTook && oGone, "still picks up a remote", await o.onStand());
await o.standIn("aisle");
check((await o.ev((v) => window.__chimp.theatre.choose(v), VIDEO)) === null && (await playerIs(o, PLAYING)), "and plays a video on its own screen");
await o.ev(() => window.__chimp.theatre.command("toggle"));
check(!(await o.theatre()).playing && (await playerIs(o, PAUSED, 3000)), "and pauses it");
await o.page.context().close();

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
