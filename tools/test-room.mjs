// The room server (server/house.ts) with light visitors (tools/room-visitor.html: the room and
// nothing else, no house, so it is quick and light), against the running dev server (npm run dev):
//   1. a visitor arriving later is told how things stand: a shared topic, another visitor's own
//      topic, the lift
//   2. the lift is the server's: two presses at the same moment are both kept
//   3. the server's checks: commands it doesn't know, a state sent for the lift, writing another
//      visitor's own topic, a state too large, and a page sending too fast
//   4. a dropped connection: the page reconnects by itself, keeps its place (nobody is told it
//      left), and hears what changed while it was away
//   5. a page that closes: everyone is told it left, and its own topics go
//   6. (RESTART=1, with `npm run dev`, whose room server restarts when its code changes) the room
//      server restarts: the pages join again, put back the shared topics, and the lift starts afresh
// Exits non-zero when a check fails.
//   node tools/test-room.mjs            URL=http://localhost:5173 by default
import { chromium } from "playwright";
import { utimesSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER_MAIN = fileURLToPath(new globalThis.URL("../server/main.ts", import.meta.url));

const URL = process.env.URL ?? "http://localhost:5173";
let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: true });

/** A light visitor: a page of its own that has joined the room, hearing a test topic, the probe family, the lift, and who leaves. */
async function visitor(name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  const refused = [];
  page.on("console", (m) => m.text().includes("refused") && refused.push(m.text()));
  await page.goto(`${URL}/tools/room-visitor.html?name=${name}`);
  await page.waitForFunction(() => window.__room?.status === "connected", null, { timeout: 30000 });
  await page.evaluate(() => {
    const r = window.__room;
    window.t = { board: null, probes: {}, lift: null, liftUpdates: 0, gone: [] };
    window.setBoard = r.share("test/board", null, (s) => (window.t.board = s));
    window.setProbe = r.family("probe:", (topic, s) => (window.t.probes[topic] = s));
    r.watch("lift", (s) => {
      window.t.lift = s;
      window.t.liftUpdates++;
    });
    r.onGone((id) => window.t.gone.push(id));
  });
  const ev = (fn, a) => page.evaluate(fn, a);
  return {
    page,
    ev,
    refused,
    id: await ev(() => window.visitor.id),
    t: () => ev(() => window.t),
    wait: (fn, a, timeout = 10000) => page.waitForFunction(fn, a, { timeout }).then(() => true, () => false),
  };
}

// ------------------------------------------------ 1. a latecomer
const a = await visitor("Ann");
await a.ev(() => window.__room.command("lift", "reset"));
await a.ev(() => window.setBoard({ score: 7, by: "Ann" }));
await a.ev(() => window.setProbe({ hat: "red" }));
await a.ev(() => window.__room.command("lift", "press", { button: "call1" }));
await a.wait(() => window.t.lift?.phase === "open");
const b = await visitor("Bo");
const told = await b.wait((id) => window.t.board?.score === 7 && !!window.t.probes[`probe:${id}`] && window.t.lift?.phase === "open", a.id);
const tb = await b.t();
check(told, "a visitor arriving later is told the shared topic, the other visitor's own topic and the lift", JSON.stringify({ board: tb.board, probes: tb.probes, lift: tb.lift?.phase }));
check(tb.probes[`probe:${a.id}`]?.hat === "red", "the other visitor's own topic is theirs", JSON.stringify(tb.probes[`probe:${a.id}`]));

// ------------------------------------------------ 2. the lift is the server's
await a.ev(() => window.__room.command("lift", "reset"));
await b.wait(() => window.t.lift?.phase === "parked" && window.t.lift.pending.length === 0);
// at the same moment: Ann calls the car up to 2, Bo calls it at 1 (where it is, but leaving)
await Promise.all([a.ev(() => window.__room.command("lift", "press", { button: "call2" })), b.ev(() => window.__room.command("lift", "press", { button: "car1" }))]);
await a.wait(() => window.t.lift && window.t.lift.nearby.length === 2);
const [la, lb] = [(await a.t()).lift, (await b.t()).lift];
const calls = new Set([...(la.pending ?? []), la.dest].filter(Boolean));
check(JSON.stringify(la) === JSON.stringify(lb), "both visitors have the same lift state from the server");
check(calls.has(2) && (calls.has(1) || la.phase === "open"), "two presses at the same moment are both kept", JSON.stringify({ phase: la.phase, dest: la.dest, pending: la.pending }));
check(la.nearby.includes(a.id) && la.nearby.includes(b.id), "the server names who pressed, as it knows them", JSON.stringify(la.nearby));

// ------------------------------------------------ 3. the server's checks
await a.ev(() => window.__room.command("lift", "fly", { to: 3 }));
await a.ev(() => window.__room.command("lift", "press", { button: "call9" }));
await a.ev(() => {
  // a page sending the lift's state as its own, and writing another visitor's topic
  const conn = window.__room.conn;
  conn.send("state", { topic: "lift", state: { phase: "parked", floor: 2, dest: null, pending: [], inDoorway: [], nearby: ["v-hacker"] }, v: { n: 9999, by: "x" } });
});
await a.ev((id) => window.__room.conn.send("state", { topic: `probe:${id}`, state: { hat: "stolen" }, v: { n: 9999, by: id } }), b.id);
await a.ev(() => window.__room.conn.send("state", { topic: "test/big", state: { blob: "x".repeat(40 * 1024) }, v: { n: 1, by: "" } }));
await a.wait(() => false, null, 1000);
const after = (await b.t()).lift;
const bProbe = (await a.t()).probes[`probe:${b.id}`];
check(a.refused.length >= 5, "the server refuses unknown commands, the lift's state from a page, another visitor's topic and a state too large", `${a.refused.length} refused: ${a.refused.map((r) => r.replace(/^\[room\] the server refused /, "")).join(" | ")}`);
check(!after.nearby.includes("v-hacker"), "a page can't set the lift's state", JSON.stringify(after.nearby));
check(bProbe?.hat !== "stolen", "a page can't write another visitor's own topic");
// too fast: 600 changes at once; the server passes on about its burst (400) and keeps the page
await b.ev(() => (window.t.count = 0));
await b.ev(() => window.__room.share("test/fast", 0, () => window.t.count++));
// (shared first, so the page has the room's version of the topic from an earlier run before it changes it)
await a.ev(() => (window.setFast = window.__room.share("test/fast", 0, () => undefined)));
await a.wait(() => false, null, 300);
const setFast = await a.ev(() => {
  for (let i = 0; i < 600; i++) window.setFast(i);
  return true;
});
await b.wait(() => false, null, 1500);
const got = await b.ev(() => window.t.count);
check(setFast && got < 600 && got >= 200, "a page sending too fast has the excess dropped", `${got} of 600 passed on`);
check(await a.ev(() => window.__room.status === "connected"), "and stays connected");
// the lift's own allowance: 60 presses at once, about 20 run
await b.ev(() => (window.t.liftUpdates = 0));
await a.ev(() => {
  for (let i = 0; i < 60; i++) window.__room.command("lift", "press", { button: "open" });
});
await b.wait(() => false, null, 1500);
const presses = await b.ev(() => window.t.liftUpdates);
check(presses <= 30, "lift commands beyond the allowance are dropped", `${presses} lift updates from 60 presses`);

// ------------------------------------------------ 4. a dropped connection
await b.ev(() => window.setProbe({ hat: "blue" }));
await a.wait((id) => window.t.probes[`probe:${id}`]?.hat === "blue", b.id);
await b.ev(() => window.__room.dropForTest());
await b.wait(() => window.__room.status !== "connected", null, 3000);
await a.ev(() => window.setBoard({ score: 8, by: "Ann" }));
const back = await b.wait(() => window.__room.status === "connected", null, 15000);
const bt = await b.t();
const at = await a.t();
check(back && (await b.ev(() => window.__room.joins)) === 1, "a dropped page reconnects by itself, to the same place", `status ${await b.ev(() => window.__room.status)}, joins ${await b.ev(() => window.__room.joins)}`);
check(!at.gone.includes(b.id), "nobody is told a dropped visitor left while they reconnect");
check(await b.wait(() => window.t.board?.score === 8), "the page hears what changed while it was away", JSON.stringify(bt.board));
await b.ev(() => window.setProbe({ hat: "green" }));
check(await a.wait((id) => window.t.probes[`probe:${id}`]?.hat === "green", b.id), "and its changes reach the others again");

// ------------------------------------------------ 5. a page that closes
await b.page.context().close();
check(await a.wait((id) => window.t.gone.includes(id), b.id, 25000), "a visitor who closes their page is let go of by everyone");
const c = await visitor("Cy");
await c.wait(() => window.t.board?.score === 8);
const ct = await c.t();
check(!ct.probes[`probe:${b.id}`] && !!ct.probes[`probe:${a.id}`], "a visitor's own topics go when they leave", JSON.stringify(Object.keys(ct.probes)));

// ------------------------------------------------ 6. the room server restarts
if (process.env.RESTART === "1") {
  const joins = await a.ev(() => window.__room.joins);
  await a.ev(() => window.__room.command("lift", "press", { button: "call2" }));
  await a.wait(() => window.t.lift?.phase === "moving");
  // `npm run dev` runs the room server with tsx watch: touching its code restarts it
  const now = new Date();
  utimesSync(SERVER_MAIN, now, now);
  const rejoined = await a.wait((j) => window.__room.joins > j && window.__room.status === "connected", joins, 30000);
  check(rejoined, "after the room server restarts, the pages join again without reloading");
  check(await c.wait(() => window.__room.joins > 1 && window.__room.status === "connected", null, 30000), "every page");
  check(await a.wait(() => window.t.lift?.phase === "parked" && window.t.lift.floor === 1), "the lift starts afresh", JSON.stringify((await a.t()).lift?.phase));
  const d = await visitor("Di");
  check(await d.wait(() => window.t.board?.score === 8, null, 10000), "the pages put back the shared topics they know: a newcomer is told them", JSON.stringify((await d.t()).board));
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
