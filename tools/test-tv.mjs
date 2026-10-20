// The Game Room TV, in a real browser against the running preview (npm run dev),
// with three tabs as three visitors on one couch (each tab joins the room
// server as a visitor of its own, as on separate computers): Ann takes the remote and
// chooses a game, Ann and Bo pick up controllers and play it, Cy watches from
// the room. Games are the arcade's stand-in play page (?tv=standin), cross-origin
// as a real one is.
// It also checks a game that fails to connect (its page reports an error, or its
// server doesn't answer): only the player who saw it fail gets static, until the
// TV is turned off; the other players and the room are unaffected.
//   node tools/test-tv.mjs              (QUALITY=high runs the three visitors at high quality)
// Screenshots: captures/tv-*.png. Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.URL ?? "http://localhost:5173";
const QUALITY = process.env.QUALITY ?? "low";
await mkdir("captures", { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
// one context, three tabs: each is its own visitor in the room server
const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });

async function visitor(name) {
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  // three copies of the house in one browser: at low quality, or the third may not fit in an 8 GB Mac's memory
  await page.goto(`${BASE}/?pov=first&view=game&tv=standin&name=${name}&quality=${QUALITY}`);
  await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 200 });
  await page.waitForFunction(() => window.__chimp.tv.catalog()?.games.length > 0, null, { timeout: 15000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  return {
    name,
    page,
    ev,
    settle: (n = 10) => ev((n) => window.__chimp.settle(n), n),
    waitFor: (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }),
    shot: (what) => page.screenshot({ path: `captures/tv-${what}.png` }),
    state: () => ev(() => window.__chimp.tv.state()),
  };
}

/** Walk to (x, z) and look at a world point. */
async function standAndLook(v, x, z, at) {
  await v.ev(
    ({ x, z }) => {
      const c = window.__chimp;
      c.setPose({ x, y: 1.6, z, yaw: 0, pitch: 0, fov: 1.0 });
      c.setWalking(true);
      c.walker().place(x, 1.6, z, 3.5);
    },
    { x, z },
  );
  // aim from the chimp's own eyes once it has settled: they sit lower than the walker's eye height
  // at placing, and from the couch the remote and controller 1 lie nearly in line
  await v.ev(() => window.__chimp.settle(6));
  await v.ev((at) => {
    const c = window.__chimp;
    const [x, y, z] = c.chimps.eye().at;
    const dx = at[0] - x;
    const dz = at[2] - z;
    c.setPose({ x, y, z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(at[1] - y, Math.hypot(dx, dz)), fov: 1.0 });
  }, at);
  await v.settle(6);
}

const ann = await visitor("Ann");
const bo = await visitor("Bo");
const cy = await visitor("Cy");

// ------------------------------------------------ 1. the TV, controllers and remote, found by role
const spots = await ann.ev(() => window.__chimp.tv.spots());
check(spots.controllers.length === 4 && spots.remote.length === 1, "4 controller spots and a remote spot on the coffee table, found by role", `${spots.controllers.map((c) => c.n).join(",")} / ${spots.remote.length}`);
const tvScreens = await ann.ev(() => window.__chimp.scene.meshes.filter((m) => m.metadata?.role === "game-tv-screen").length);
check(tvScreens === 1, "the TV's screen is a mesh with the game-tv-screen role");
check((await ann.ev(() => window.__chimp.tv.onTable())).every((t) => t.shown), "every controller and the remote lie on the table");
check((await ann.ev(() => window.__chimp.tv.card()))?.card === "idle", "the TV shows its idle card");
const me = { ann: await ann.ev(() => window.__chimp.tv.me()), bo: await bo.ev(() => window.__chimp.tv.me()) };
check(me.ann.id !== me.bo.id && me.ann.name === "Ann", "each tab is a visitor of its own", `${me.ann.id} ${me.bo.id}`);

// ------------------------------------------------ 2. Ann picks up the remote with E
const table = spots.controllers.map((c) => c.at);
const seatX = table[0][0] - 1.0;
const midZ = (table[0][2] + table[3][2]) / 2;
await standAndLook(ann, seatX, midZ + 0.4, spots.remote[0].at);
let prompt = await ann.ev(() => window.__chimp.state().tvPrompt);
check(prompt?.item === "remote" && prompt.action === "take", "looking at the remote offers to pick it up", `${JSON.stringify(prompt)}; eyes ${JSON.stringify(await ann.ev(() => window.__chimp.chimps.eye()))}`);
await ann.page.keyboard.press("e");
await ann.settle(4);
check((await ann.state()).remote?.id === me.ann.id, "E picks up the remote");
await bo.waitFor((id) => window.__chimp.tv.state().remote?.id === id, me.ann.id).catch(() => {});
check((await bo.state()).remote?.name === "Ann", "Bo's tab sees Ann holding the remote");
await bo.settle(4);
check((await bo.ev(() => window.__chimp.tv.onTable())).find((t) => t.name === "TV remote")?.shown === false, "the remote is gone from the table in Bo's tab too");
check(await ann.page.locator(".panel.remote .tv-remote select").isVisible(), "Ann's HUD shows the TV remote's game list");

// ------------------------------------------------ 3. Ann chooses a game
const games = await ann.ev(() => window.__chimp.tv.catalog().games);
check(games.length >= 2, `the remote offers the catalogue (${games.length} games)`);
check((await bo.ev((id) => window.__chimp.tv.choose(id), games[0].gameId)) !== null, "Bo, without the remote, can't choose a game");
check((await ann.ev((id) => window.__chimp.tv.choose(id), games[0].gameId)) === null, `Ann chooses ${games[0].name}`);
await cy.waitFor((id) => window.__chimp.tv.state().game?.gameId === id, games[0].gameId).catch(() => {});
check((await cy.state()).game?.name === games[0].name, "Cy's tab sees the game on the TV");
await cy.settle(4);
const cyCard = await cy.ev(() => window.__chimp.tv.card());
check(cyCard?.card === "game" && cyCard.players === 0, "the TV shows the game's card, nobody playing yet", JSON.stringify(cyCard));
check((await ann.ev(() => window.__chimp.state().tvFrame)) === null, "no game is loaded for a visitor without a controller");

// ------------------------------------------------ 4. Ann picks up controller 1 with E and sits down
await standAndLook(ann, seatX, table[0][2] + 0.1, table[0]);
prompt = await ann.ev(() => window.__chimp.state().tvPrompt);
check(prompt?.item === "controller" && prompt.n === 1, "looking at controller 1 offers to pick it up", JSON.stringify(prompt));
await ann.page.keyboard.press("e");
await ann.waitFor(() => window.__chimp.state().focus?.kind === "tv" && window.__chimp.state().focus.phase === "on", null, 5000).catch(() => {});
check((await ann.state()).controllers[0]?.id === me.ann.id, "Ann holds controller 1");
check((await ann.ev(() => window.__chimp.state().focus))?.phase === "on", "the camera has glided onto the TV");
await ann.waitFor(() => window.__chimp.tv.placement()?.on === true, null, 5000).catch(() => {});
const place = await ann.ev(() => ({ p: window.__chimp.tv.placement(), r: window.__chimp.state().focusRect, f: window.__chimp.state().tvFrame, vw: innerWidth, vh: innerHeight }));
check(!!place.p?.on, "Ann's game shows over the TV");
const off = place.p && place.r ? Math.max(Math.abs(parseFloat(place.p.left) - place.r.x), Math.abs(parseFloat(place.p.top) - place.r.y), Math.abs(parseFloat(place.p.width) - place.r.w), Math.abs(parseFloat(place.p.height) - place.r.h)) : Infinity;
check(off < 1, "the game lines up with the TV's screen", `off by ${off.toFixed(2)} px`);
check(place.r && Math.max(place.r.w / place.vw, place.r.h / place.vh) > 0.8, "the TV fills the view (zoomed in)", place.r && `${Math.round((100 * place.r.w) / place.vw)}% of the width, ${Math.round((100 * place.r.h) / place.vh)}% of the height`);
const src = new URL(place.f.src);
check(src.searchParams.get("embed") === "1" && src.searchParams.get("name") === "Ann", "the game joins in embed mode as Ann", src.search);
await ann.waitFor(() => !!document.querySelector(".focus-start"), null, 8000).catch(() => {});
check(await ann.page.locator(".focus-start").isVisible(), "a ready game asks for any key to start");
check((await ann.page.locator(".focus-bar.top .tv-player").allTextContents()).join(",") === "P1 Ann (you)", "the frame names who is playing");

// keys go to the game, not to ChimpHouse
const poseBefore = await ann.ev(() => window.__chimp.pose());
for (const k of ["Space", "KeyW", "KeyA", "KeyD", "ArrowLeft", "KeyE"]) await ann.page.keyboard.press(k);
await ann.settle(6);
const frame = ann.page.frames().find((f) => f.url().includes("standin-game.html"));
const received = frame ? await frame.evaluate(() => window.received) : [];
check(received.length >= 5, "keys reach Ann's game", received.join(" "));
const poseAfter = await ann.ev(() => window.__chimp.pose());
check(JSON.stringify(poseBefore) === JSON.stringify(poseAfter), "ChimpHouse ignores the keys while Ann plays");
check((await ann.state()).remote?.id === me.ann.id, "E typed into the game doesn't put the remote down");
await ann.waitFor(() => !document.querySelector(".focus-start"), null, 3000).catch(() => {});
await ann.shot("ann-playing");

// ------------------------------------------------ 5. Bo picks up controller 2
await standAndLook(bo, seatX, table[1][2] + 0.1, table[1]);
check((await bo.ev(() => window.__chimp.tv.take("controller", 1))) !== null, "Bo can't take Ann's controller");
check((await bo.ev(() => window.__chimp.tv.take("controller", 2))) === null, "Bo picks up controller 2");
await bo.waitFor(() => window.__chimp.tv.placement()?.on === true, null, 6000).catch(() => {});
const boFrame = await bo.ev(() => window.__chimp.state().tvFrame);
check(new URL(boFrame.src).searchParams.get("name") === "Bo", "Bo's game joins as Bo");
await ann.waitFor(() => document.querySelectorAll(".focus-bar.top .tv-player").length === 2, null, 4000).catch(() => {});
check((await ann.page.locator(".focus-bar.top .tv-player").allTextContents()).join(",") === "P1 Ann (you),P2 Bo", "Ann's frame shows both players");

// ------------------------------------------------ 6. Cy watches from the room
await standAndLook(cy, seatX - 1.2, midZ, [table[0][0] + 3.4, 1.3, midZ]);
await cy.settle(8);
const cyNow = await cy.ev(() => ({ card: window.__chimp.tv.card(), frame: window.__chimp.state().tvFrame, onPage: window.__chimp.tv.screenOnPage() }));
check(cyNow.card?.card === "game" && cyNow.card.players === 2, "Cy sees the TV's 'playing now' card naming both players", JSON.stringify(cyNow.card));
check(cyNow.frame === null, "Cy, watching, loads no game");
await cy.shot("cy-watching");
check(!(await cy.ev(() => window.__chimp.tv.onTable())).find((t) => t.name === "Game controller 1").shown, "controller 1 is gone from the table in Cy's tab");

// ------------------------------------------------ 7. Ann changes the game: every player's game reloads
const before = { ann: (await ann.ev(() => window.__chimp.state().tvFrame)).key, bo: boFrame.key };
await ann.page.locator(".focus-bar.bottom .tv-remote select").selectOption(games[1].gameId);
await ann.page.locator(".focus-bar.bottom .tv-remote button.main").click();
await bo.waitFor((k) => window.__chimp.state().tvFrame?.key !== k, before.bo, 4000).catch(() => {});
const after = { ann: await ann.ev(() => window.__chimp.state().tvFrame), bo: await bo.ev(() => window.__chimp.state().tvFrame) };
check(after.ann?.title === games[1].name && after.bo?.title === games[1].name, `choosing ${games[1].name} from the couch loads it for both players`);
check(after.ann.key !== before.ann && after.bo.key !== before.bo, "each player's game reloaded");
await ann.waitFor(() => window.__chimp.tv.placement()?.on === true, null, 6000).catch(() => {});
check(!!(await ann.ev(() => window.__chimp.tv.placement()))?.on, "Ann's new game shows over the TV");

// ------------------------------------------------ 7b. a game that fails to connect fails only for the player who saw it
const standin = new URL(games[0].playUrl);
const failing = [
  { ...games[0], gameId: "test:fails-for-bo", name: "Broken Game", playUrl: `${standin.origin}${standin.pathname}?game=Broken&fail=Game+unavailable&failFor=Bo` },
  { ...games[0], gameId: "test:unreachable", name: "Faraway Game", playUrl: "http://127.0.0.1:9/faraway" },
];
await ann.ev((g) => window.__chimp.tv.setCatalog([...window.__chimp.tv.catalog().games, ...g]), failing);
const failedFor = (v) => v.ev(() => window.__chimp.state().tvFailed);
const staticMoves = async (v) => {
  const c1 = await v.ev(() => window.__chimp.tv.card());
  await v.settle(12);
  const c2 = await v.ev(() => window.__chimp.tv.card());
  return { ok: c1?.card === "failed" && c2?.drawn > c1.drawn, detail: `${c1?.card}, redrawn ${c2?.drawn - c1?.drawn} times in 12 frames` };
};

// only Bo's game fails
check((await ann.ev((id) => window.__chimp.tv.choose(id), failing[0].gameId)) === null, "Ann chooses Broken Game, whose page reports an error for Bo only");
await bo.waitFor(() => !!window.__chimp.state().tvFailed, null, 25000).catch(() => {});
check((await failedFor(bo))?.reason === "Game unavailable", "Bo's game fails to connect", JSON.stringify(await failedFor(bo)));
check((await bo.ev(() => window.__chimp.state().tvFrame)) === null && (await bo.ev(() => window.__chimp.state().focus))?.phase === "on", "Bo's game closes; Bo stays seated");
const boStatic = await staticMoves(bo);
check(boStatic.ok, "Bo's TV shows moving static", boStatic.detail);
await bo.waitFor(() => document.querySelector(".focus-bar.top .status")?.textContent === "Failed to connect", null, 3000).catch(() => {});
check((await bo.page.locator(".focus-bar.top .status").textContent()) === "Failed to connect", "the bar above Bo's TV says Failed to connect");
await ann.waitFor(() => window.__chimp.tv.placement()?.on === true, null, 8000).catch(() => {});
check((await failedFor(ann)) === null && !!(await ann.ev(() => window.__chimp.tv.placement()))?.on, "Ann is unaffected: her game shows over the TV");
check((await ann.ev(() => window.__chimp.tv.card()))?.card === "game", "Ann's TV shows no static");
await cy.settle(4);
const cyCard2 = await cy.ev(() => window.__chimp.tv.card());
check((await failedFor(cy)) === null && cyCard2?.card === "game" && cyCard2.players === 2, "Cy is unaffected: the TV's card still names both players", JSON.stringify(cyCard2));
check(!("failed" in (await cy.state())), "nothing about the failure is shared");
await bo.page.screenshot({ path: "captures/tv-failed-bo.png" });
await ann.shot("failed-ann-unaffected");
await bo.page.waitForTimeout(3000);
check((await failedFor(bo))?.reason === "Game unavailable", "Bo's static stays (3 s later)");
// another game: Ann plays it, Bo's static stays until the TV is turned off
check((await ann.ev((id) => window.__chimp.tv.choose(id), games[1].gameId)) === null, `Ann chooses ${games[1].name}`);
await ann.waitFor((n) => window.__chimp.state().tvFrame?.title === n && window.__chimp.tv.placement()?.on === true, games[1].name, 8000).catch(() => {});
check(!!(await ann.ev(() => window.__chimp.tv.placement()))?.on, "Ann plays it");
await bo.settle(6);
check((await failedFor(bo)) !== null && (await bo.ev(() => window.__chimp.state().tvFrame)) === null, "Bo still sees static: only turning the TV off clears it");
check((await bo.ev((id) => window.__chimp.tv.choose(id), games[0].gameId)) !== null, "Bo, failed and without the remote, can't choose a game");
check((await ann.ev(() => window.__chimp.tv.turnOff())) === null, "Ann turns the TV off");
await bo.waitFor(() => window.__chimp.state().tvFailed === null, null, 3000).catch(() => {});
await bo.settle(4);
const boOff = { failed: await failedFor(bo), card: await bo.ev(() => window.__chimp.tv.card()) };
check(boOff.failed === null && boOff.card?.card === "idle", "Bo's static clears: the TV is off for everyone", JSON.stringify(boOff));

// a server that doesn't answer fails for each player who tries it, and the watcher is unaffected
check((await ann.ev((id) => window.__chimp.tv.choose(id), failing[1].gameId)) === null, "Ann chooses Faraway Game, whose server doesn't answer");
await ann.waitFor(() => !!window.__chimp.state().tvFailed, null, 25000).catch(() => {});
await bo.waitFor(() => !!window.__chimp.state().tvFailed, null, 25000).catch(() => {});
const farFailed = { ann: await failedFor(ann), bo: await failedFor(bo) };
check(farFailed.ann?.reason === "ChimpVibe can't be reached" && farFailed.bo?.reason === "ChimpVibe can't be reached", "it fails for Ann and for Bo, each on their own TV", JSON.stringify(farFailed));
check((await failedFor(cy)) === null && (await cy.ev(() => window.__chimp.tv.card()))?.card === "game", "Cy, watching, sees no static");
check(await ann.page.locator(".focus-bar.bottom .tv-remote button.main", { hasText: /Play|Restart/ }).isDisabled(), "Ann's remote can't start another game until she turns the TV off");
await ann.page.locator(".focus-bar.bottom .tv-remote button", { hasText: "Turn off" }).click();
await bo.waitFor(() => window.__chimp.state().tvFailed === null, null, 3000).catch(() => {});
check((await failedFor(ann)) === null && (await failedFor(bo)) === null, "Turn off clears both");

check((await ann.ev((id) => window.__chimp.tv.choose(id), games[1].gameId)) === null, `then ${games[1].name} plays again`);
await bo.waitFor(() => window.__chimp.tv.placement()?.on === true, null, 8000).catch(() => {});
check(!!(await bo.ev(() => window.__chimp.tv.placement()))?.on, "and shows over the TV for Bo");

// ------------------------------------------------ 8. Ann quits the game (putting the controller down would leave it playing: tools/test-tv-real.mjs)
await ann.page.locator(".focus-bar.bottom button.leave", { hasText: "Quit game" }).click();
await ann.waitFor(() => window.__chimp.state().focus === null, null, 5000).catch(() => {});
const annAfter = await ann.ev(() => ({ focus: window.__chimp.state().focus, walking: window.__chimp.state().walking, frame: window.__chimp.state().tvFrame, placed: window.__chimp.tv.placement() }));
check(annAfter.focus === null && annAfter.walking, "Ann stands up and walks again");
check(annAfter.frame === null && annAfter.placed === null, "Ann's game left the page (ending her connection)");
await bo.waitFor(() => window.__chimp.tv.state().controllers[0] === null, null, 3000).catch(() => {});
check((await bo.state()).controllers[0] === null && (await bo.ev(() => window.__chimp.tv.placement()))?.on, "Bo keeps playing; controller 1 is free again");
await ann.settle(4);
check((await ann.ev(() => window.__chimp.tv.onTable())).find((t) => t.name === "Game controller 1").shown, "controller 1 is back on the table");

// ------------------------------------------------ 9. Bo's tab closes: Bo lets go of controller 2
await bo.page.close({ runBeforeUnload: true });
await ann.waitFor(() => window.__chimp.tv.state().controllers[1] === null, null, 5000).catch(() => {});
check((await ann.state()).controllers[1] === null, "a visitor who leaves lets go of their controller");

// ------------------------------------------------ 10. Ann turns the TV off and leaves the room with the remote
check((await ann.ev(() => window.__chimp.tv.turnOff())) === null && (await ann.state()).game === null, "the remote turns the TV off");
await ann.ev(() => window.__chimp.goTo("theatre"));
await ann.settle(10);
await cy.waitFor(() => window.__chimp.tv.state().remote === null, null, 4000).catch(() => {});
check((await cy.state()).remote === null, "leaving the Game Room puts the remote back on the table");

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
