// The Game Room TV with a real ChimpVibe game from a local ChimpVibe server (localhost mode),
// in a real browser against the running
// preview (npm run dev): its spectator mode as a split screen
// (docs/handoffs/2026-10-13-chimpvibe-local-demo-ready.md).
//
// Ann is a visitor in the house, seated at the TV; Bo is a light visitor (tools/tv-visitor.html:
// the room and plain frames, no house, to spare memory) who holds controller 2 and plays in a frame
// of his own, and also watches as a spectator. It checks, and logs, ChimpVibe's embed messages:
// Ann's game ready and playing, her TV's part for Bo waiting for him, following him, saying when
// he has left and following him again when he's back, and a spectator ended when nobody plays.
//   node tools/test-tv-real.mjs
// Screenshots: captures/tv-real-*.png; every message: captures/tv-real-messages.json.
// Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

// ChimpVibe's demo lets exactly this origin frame its games and read its list
const BASE = "http://localhost:5173";
await mkdir("captures", { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
try {
  await run();
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

async function run() {
  // one context, as one browser: the room server reaches both pages either way
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });

  // ------------------------------------------------ Ann, in the house
  const ann = await context.newPage();
  ann.on("pageerror", (e) => console.log("[Ann pageerror]", e.message));
  await ann.goto(`${BASE}/?view=game&arcade=local&tv=local&name=Ann&quality=low`);
  await ann.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 200 });
  const ev = (fn, arg) => ann.evaluate(fn, arg);
  const waitFor = (fn, arg, timeout = 8000) => ann.waitForFunction(fn, arg, { timeout, polling: 100 }).then(() => true, () => false);
  const settle = (n = 10) => ev((n) => window.__chimp.settle(n), n);
  const shot = (what) => ann.screenshot({ path: `captures/tv-real-${what}.png` });
  // every embed message Ann's page receives, by frame: her game (tv-frame) or a watched part (tv-watch)
  await ev(() => {
    window.__msgs = [];
    addEventListener("message", (e) => {
      const f = [...document.querySelectorAll("iframe")].find((x) => x.contentWindow === e.source);
      if (f && e.data?.protocol === "chimpvibe-embed") window.__msgs.push({ frame: `${f.className}: ${f.title}`, t: Math.round(performance.now()), origin: e.origin, data: e.data });
    });
  });
  const annMsgs = () => ev(() => window.__msgs);
  const has = (frame, type, extra = {}) =>
    waitFor(
      ({ frame, type, extra }) => window.__msgs.some((m) => m.frame.startsWith(frame) && m.data.type === type && Object.entries(extra).every(([k, v]) => m.data[k] === v)),
      { frame, type, extra },
      20000,
    );

  await waitFor(() => window.__chimp.tv.catalog()?.games.length > 0, null, 15000);
  const catalog = await ev(() => window.__chimp.tv.catalog());
  const snake = catalog?.games.find((g) => g.name === "Snake");
  check(catalog?.source === "chimpvibe-local" && !!snake, "the TV's games come from ChimpVibe's demo list", `${catalog?.source}: ${catalog?.games.map((g) => g.name).join(", ")}`);
  check(snake && new URL(snake.playUrl).origin === "http://127.0.0.1:56892", "Snake's play page is the demo's, as the list gives it", snake?.playUrl);
  await ev(() => window.__chimp.arcade.ready());
  check((await ev(() => window.__chimp.arcade.source())) === "chimpvibe-local", "the arcade's list comes from the demo too");

  // ------------------------------------------------ Bo, a light visitor
  const bo = await context.newPage();
  bo.on("pageerror", (e) => console.log("[Bo pageerror]", e.message));
  await bo.goto(`${BASE}/tools/tv-visitor.html?name=Bo`);
  await bo.waitForFunction(() => !!window.visitor, null, { timeout: 30000 });
  const bev = (fn, arg) => bo.evaluate(fn, arg);
  const boHas = (frame, type, extra = {}) =>
    bo
      .waitForFunction(
        ({ frame, type, extra }) => window.visitor.log().some((m) => m.frame === frame && m.data?.type === type && Object.entries(extra).every(([k, v]) => m.data[k] === v)),
        { frame, type, extra },
        { timeout: 20000, polling: 100 },
      )
      .then(() => true, () => false);

  // ------------------------------------------------ Ann takes the remote, puts Snake on and sits down
  const spots = await ev(() => window.__chimp.tv.spots());
  const table = spots.controllers.map((c) => c.at);
  const seatX = table[0][0] - 1.0;
  await standAndLook(ann, seatX, table[0][2] + 0.1, table[0]);
  check((await ev(() => window.__chimp.tv.take("remote"))) === null, "Ann picks up the remote");
  check((await ev((id) => window.__chimp.tv.choose(id), snake.gameId)) === null, "Ann puts Snake on the TV");
  check((await ev(() => window.__chimp.tv.take("controller", 1))) === null, "Ann picks up controller 1 and sits down");
  await waitFor(() => window.__chimp.state().focus?.phase === "on", null, 6000);
  const src = new URL(await ev(() => window.__chimp.state().tvFrame?.src));
  check(src.origin === "http://127.0.0.1:56892" && src.searchParams.get("embed") === "1" && src.searchParams.get("name") === "Ann", "Ann's game is the play page in embed mode, as Ann", src.href);
  check(await has("tv-frame", "ready", { role: "player" }), "Ann's game sends ready, role player");
  check(await waitFor(() => window.__chimp.tv.placement()?.on === true, null, 8000), "Ann's game shows over the TV");
  check(await waitFor(() => !!document.querySelector(".focus-start"), null, 5000), "it asks for any key to start");
  check((await ev(() => window.__chimp.tv.panes())).length === 0, "nobody else plays: no watched parts");
  // Snake opens on its own colour menu, which takes no keys (Enter and Space don't press its
  // Play): a click does, and that is the first input
  const renderer = ann.frames().find((f) => f.url().startsWith("http://127.0.0.1:56892/renderer-frame"));
  await renderer?.getByRole("button", { name: "Play", exact: true }).click();
  check(await has("tv-frame", "playing"), "clicking Play on Snake's colour menu: playing");
  await ann.keyboard.press("ArrowUp");
  await shot("1-ann-alone");

  // ------------------------------------------------ Bo picks up controller 2: Ann's TV splits, waiting for him
  await bo.waitForFunction(() => window.visitor.tv().game?.name === "Snake", null, { timeout: 8000 });
  await bev(() => window.visitor.take(2));
  check(await waitFor(() => window.__chimp.tv.panes().length === 1, null, 5000), "Ann's TV gets a part for Bo as he picks up controller 2");
  const pane = (await ev(() => window.__chimp.tv.panes()))[0];
  const ps = pane && new URL(pane.src);
  check(ps?.searchParams.get("role") === "spectator" && ps.searchParams.get("follow") === "Bo" && ps.searchParams.get("mute") === "1", "it watches Snake as a spectator following Bo, muted", pane?.src);
  check(await has("tv-watch", "ready", { role: "spectator" }), "Bo's part sends ready, role spectator");
  check(await has("tv-watch", "follow", { state: "waiting", name: "Bo" }), "then follow waiting: Bo hasn't joined yet");
  await settle(4);
  const waiting = (await ev(() => window.__chimp.tv.panes()))[0];
  check(waiting?.state === "waiting" && waiting.shown, "Bo's part shows ChimpVibe's spectator view, waiting for him", JSON.stringify({ state: waiting?.state, shown: waiting?.shown }));
  await shot("2-waiting-for-bo");

  // ------------------------------------------------ Bo joins: following
  await bev(() => window.visitor.play());
  check(await boHas("player", "ready", { role: "player" }), "Bo's game sends ready, role player");
  check(await has("tv-watch", "follow", { state: "following", name: "Bo" }), "Ann's part for Bo: follow following, without a reload");
  await settle(6);
  const showing = (await ev(() => window.__chimp.tv.panes()))[0];
  check(showing?.state === "showing" && showing.shown, "Bo's part shows his game", JSON.stringify({ state: showing?.state, shown: showing?.shown }));
  const parts = await ev(() => ({ me: window.__chimp.tv.placement(), them: window.__chimp.tv.panes()[0], rect: window.__chimp.state().focusRect }));
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
  check(
    near(parseFloat(parts.me.left), parts.rect.x) && near(parseFloat(parts.me.width), parts.rect.w / 2, 4) && near(parseFloat(parts.me.height), parts.rect.h),
    "two players split the TV side by side, as a console does: Ann's game the left half, the TV's full height",
    `Ann ${Math.round(parseFloat(parts.me.width))}×${Math.round(parseFloat(parts.me.height))} px of ${Math.round(parts.rect.w)}×${Math.round(parts.rect.h)}`,
  );
  check(parseFloat(parts.them.left) > 50 && parseFloat(parts.them.left) < 50.5 && parseFloat(parts.them.height) === 100, "Bo's game the right half, full height, with a thin line between", `left ${parts.them.left}, height ${parts.them.height}`);
  // nothing opaque lies over Ann's game: the black round the parts is a backdrop under it
  const cover = await ev(() => {
    const st = (sel) => document.querySelector(sel) && getComputedStyle(document.querySelector(sel));
    return { surface: st(".tv-surface")?.backgroundColor, surfaceZ: st(".tv-surface")?.zIndex, frameZ: st("iframe.tv-frame")?.zIndex, backdropZ: st(".tv-backdrop")?.zIndex };
  });
  check(cover.surface === "rgba(0, 0, 0, 0)" && Number(cover.backdropZ) < Number(cover.frameZ), "Ann's own game shows in her part of the split screen, not covered", JSON.stringify(cover));
  await shot("3-split");

  // ------------------------------------------------ Cy makes three: quarters, and the fourth shows the game
  const cy = await context.newPage();
  await cy.goto(`${BASE}/tools/tv-visitor.html?name=Cy`);
  await cy.waitForFunction(() => window.visitor?.tv().game?.name === "Snake", null, { timeout: 15000 });
  await cy.evaluate(() => window.visitor.take(3));
  await cy.evaluate(() => window.visitor.play());
  check(await waitFor(() => window.__chimp.tv.panes().filter((p) => p.shown && p.state === "showing").length === 2, null, 20000), "Cy picks up controller 3: Ann's TV follows Bo and Cy");
  await settle(6);
  const quarters = await ev(() => ({ me: window.__chimp.tv.placement(), them: window.__chimp.tv.panes(), rect: window.__chimp.state().focusRect, spare: document.querySelector(".tv-part.spare")?.textContent ?? null }));
  check(near(parseFloat(quarters.me.width), quarters.rect.w / 2, 4) && near(parseFloat(quarters.me.height), quarters.rect.h / 2, 4), "three players: Ann's game is the top-left quarter", `${Math.round(parseFloat(quarters.me.width))}×${Math.round(parseFloat(quarters.me.height))} px`);
  check(quarters.them.map((p) => `${parseFloat(p.left) > 50 ? "R" : "L"}${parseFloat(p.top) > 50 ? "B" : "T"}`).join(",") === "RT,LB", "Bo's top right, Cy's bottom left", quarters.them.map((p) => `${p.name} ${p.left} ${p.top}`).join("; "));
  check(quarters.spare === "Snake", "the spare quarter shows the game's card", quarters.spare);
  await shot("3b-three");
  await cy.evaluate(() => window.visitor.quit());
  await cy.close();
  check(await waitFor(() => window.__chimp.tv.panes().length === 1 && !document.querySelector(".tv-part.spare"), null, 6000), "Cy quits: back to two halves");

  // Bo's page also watches: Ann followed, and the default spectator view
  await bev(() => window.visitor.watch("watch-ann", "Ann"));
  await bev(() => window.visitor.watch("overview"));
  check(await boHas("watch-ann", "ready", { role: "spectator" }), "a spectator following Ann sends ready, role spectator");
  check(await boHas("watch-ann", "follow", { state: "following", name: "Ann" }), "and follow following");
  check(await boHas("overview", "ready", { role: "spectator" }), "a spectator following nobody sends ready, role spectator");
  await bo.screenshot({ path: "captures/tv-real-bo.png" });

  // ------------------------------------------------ Bo's game drops (he keeps the controller): gone, then back
  await bev(() => window.visitor.close("player"));
  check(await has("tv-watch", "follow", { state: "gone", name: "Bo" }), "Bo's game drops: Ann's part for him says gone");
  await settle(4);
  const gone = (await ev(() => window.__chimp.tv.panes()))[0];
  check(gone?.state === "waiting" && gone.note === "Bo has left" && gone.shown, "Bo's part still shows, ChimpVibe's view saying he has left", JSON.stringify({ state: gone?.state, note: gone?.note, shown: gone?.shown }));
  await shot("4-bo-gone");
  await bev(() => window.visitor.play());
  const back = await waitFor(() => window.__msgs.filter((m) => m.frame.startsWith("tv-watch") && m.data.type === "follow" && m.data.state === "following").length >= 2, null, 20000);
  check(back, "Bo plays again: Ann's part follows him again, without a reload");
  const again = await bo
    .waitForFunction(() => window.visitor.log().filter((m) => m.frame === "player" && m.data?.type === "ready").length >= 2, null, { timeout: 20000, polling: 100 })
    .then(() => true, () => false);
  check(again, "Bo's new game sends ready again");

  // ------------------------------------------------ Ann puts her controller down: her game plays on, and she sees it
  const annId = (await ev(() => window.__chimp.tv.me())).id;
  const key = (await ev(() => window.__chimp.tv.placement())).key;
  check(await ann.locator(".focus-bar.bottom button", { hasText: "Quit game" }).isVisible(), "beside Put the controller down, a Quit game button");
  await ann.locator(".focus-bar.bottom button.leave", { hasText: "Put the controller down" }).click();
  check(await waitFor(() => window.__chimp.state().focus === null, null, 6000), "Put the controller down stands Ann up");
  const down = await ev(() => ({ tv: window.__chimp.tv.state(), p: window.__chimp.tv.placement() }));
  check(down.tv.controllers[0] === null && down.tv.seats[0]?.host === annId && down.tv.seats[0].name === "Ann", "controller 1 is on the table, Ann's player still in the game", JSON.stringify(down.tv.seats[0]));
  check(down.p?.key === key && !down.p.on, "her game plays on in its frame (no reload), without her keys");
  check(!(await annMsgs()).some((m) => m.frame.startsWith("tv-frame") && (m.data.type === "ended" || m.data.type === "error")), "it doesn't end");
  await standAndLook(ann, seatX - 1.2, (table[0][2] + table[3][2]) / 2, [table[0][0] + 3.4, 1.3, (table[0][2] + table[3][2]) / 2]);
  check(await waitFor(() => window.__chimp.tv.placement()?.visible && window.__chimp.tv.placement().transform.startsWith("matrix3d"), null, 6000), "walking about, Ann sees her game on the TV, in perspective", JSON.stringify(await ev(() => window.__chimp.tv.placement())));
  // her half of the TV, on the page: its left edge and top on the TV's, half its width
  const onTv = await ev(() => {
    const r = document.querySelector("iframe.tv-frame").getBoundingClientRect();
    const q = window.__chimp.tv.screenOnPage();
    const xs = q.map((c) => c.x);
    const ys = q.map((c) => c.y);
    return { frame: [r.left, r.top, r.width], tv: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs)] };
  });
  check(
    Math.abs(onTv.frame[0] - onTv.tv[0]) < 4 && Math.abs(onTv.frame[1] - onTv.tv[1]) < 4 && Math.abs(onTv.frame[2] - onTv.tv[2] / 2) < 6,
    "it lies on her half of the TV's screen",
    JSON.stringify(onTv),
  );
  check(await ann.locator(".arcade-running", { hasText: "controller 1 down" }).isVisible(), "the side panel says her game plays on, with Quit");
  await shot("5-put-down");

  // picking it up again: the same game, keys back
  await standAndLook(ann, seatX, table[0][2] + 0.1, table[0]);
  check((await ev(() => window.__chimp.state().tvPrompt))?.n === 1 && (await ann.locator(".play-prompt", { hasText: "Pick up controller 1 again" }).isVisible()), "looking at controller 1 offers to pick it up again");
  check((await ev(() => window.__chimp.tv.take("controller", 1))) === null, "Ann picks it up again");
  check(await waitFor((k) => window.__chimp.tv.placement()?.on === true && window.__chimp.tv.placement().key === k, key, 6000), "her same game takes her keys again, without a reload");
  await ev(() => window.__chimp.tv.putDown("controller"));
  await waitFor(() => window.__chimp.state().focus === null, null, 6000);

  // ------------------------------------------------ Cy takes over Ann's game
  const cy2 = await context.newPage();
  await cy2.goto(`${BASE}/tools/tv-visitor.html?name=Cy`);
  await cy2.waitForFunction(() => window.visitor?.tv().seats?.[0]?.name === "Ann", null, { timeout: 15000 });
  const as = await cy2.evaluate(() => window.visitor.take(1));
  check(as === "Ann", "Cy picks up controller 1: he takes over Ann's game, as Ann", as);
  await cy2.evaluate((name) => window.visitor.play(name), as);
  check(await waitFor(() => window.__chimp.state().tvFrame === null && window.__chimp.tv.placement() === null, null, 6000), "Ann's game leaves her page (ChimpVibe can't move a player between browsers)");
  check(await has("tv-watch: Ann", "follow", { state: "following", name: "Ann" }), "Ann's TV follows controller 1's player, now Cy playing as Ann");
  check(
    await cy2.waitForFunction(() => window.visitor.log().some((m) => m.frame === "player" && m.data?.type === "ready"), null, { timeout: 20000 }).then(() => true, () => false),
    "Cy's game, joined as Ann, sends ready",
  );
  await settle(6);
  const tags = await ann.locator(".tv-part-tag").allTextContents();
  check(tags.includes("P1 Cy (as Ann)"), "Ann's TV tags controller 1 as Cy playing as Ann", tags.join(", "));
  await shot("6-taken-over");
  await cy2.evaluate(() => window.visitor.quit());
  await cy2.close();
  check(await waitFor(() => window.__chimp.tv.state().seats[0] === null && window.__chimp.tv.panes().length === 1, null, 6000), "Cy quits: controller 1's player leaves the game");

  // ------------------------------------------------ Quit game ends Ann's game
  await standAndLook(ann, seatX, table[0][2] + 0.1, table[0]);
  check((await ev(() => window.__chimp.tv.take("controller", 1))) === null, "Ann picks up controller 1: a new player, as Ann");
  check(await has("tv-frame", "ready", { role: "player" }) && (await waitFor(() => window.__chimp.tv.placement()?.on === true, null, 10000)), "her new game shows");
  await bev(() => window.visitor.close("player"));
  await ann.locator(".focus-bar.bottom button", { hasText: "Quit game" }).click();
  check(await waitFor(() => window.__chimp.state().focus === null && window.__chimp.state().tvFrame === null && window.__chimp.tv.state().seats[0] === null, null, 6000), "Quit game: Ann stands up and her game leaves the page and the game");

  // ------------------------------------------------ nobody plays: the spectators end
  const ended = await boHas("overview", "ended");
  const endMsg = (await bev(() => window.visitor.log())).find((m) => m.frame === "overview" && (m.data?.type === "ended" || m.data?.type === "error"));
  check(ended && endMsg?.data.reason === "no-players", "with nobody playing, a spectator gets ended no-players", JSON.stringify(endMsg?.data));

  await bev(() => window.visitor.putDown());
  await ev(() => window.__chimp.tv.turnOff());

  // ------------------------------------------------ what was said, in order
  const all = [...(await annMsgs()).map((m) => ({ page: "Ann", ...m })), ...(await bev(() => window.visitor.log())).map((m) => ({ page: "Bo", ...m }))];
  await writeFile("captures/tv-real-messages.json", JSON.stringify(all, null, 2));
  const bad = all.filter((m) => m.origin !== "http://127.0.0.1:56892");
  check(bad.length === 0, "every message came from the play page's origin", bad.map((m) => m.origin).join(", "));
  const errors = all.filter((m) => m.data?.type === "error");
  check(errors.length === 0, "no error messages", errors.map((m) => `${m.page} ${m.frame}: ${m.data.code} ${m.data.reason}`).join("; "));
  console.log("\nmessages, by frame:");
  const byFrame = new Map();
  for (const m of all) {
    const k = `${m.page} · ${m.frame}`;
    byFrame.set(k, [...(byFrame.get(k) ?? []), `${m.data.type}${m.data.role ? ` ${m.data.role}` : ""}${m.data.state ? ` ${m.data.state}` : ""}${m.data.reason ? ` "${m.data.reason}"` : ""}${m.data.code ? ` ${m.data.code}` : ""}`]);
  }
  for (const [k, v] of byFrame) console.log(`  ${k}: ${v.join(" → ")}`);
}

/** Walk to (x, z) and look at a world point. */
async function standAndLook(page, x, z, at) {
  await page.evaluate(
    ({ x, z, at }) => {
      const c = window.__chimp;
      c.setPose({ x, y: 1.6, z, yaw: 0, pitch: 0, fov: 1.0 });
      c.setWalking(true);
      const w = c.walker();
      w.place(x, 1.6, z, 3.5);
      const eye = w.eyeY;
      const dx = at[0] - x;
      const dz = at[2] - z;
      c.setPose({ x, y: eye, z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(at[1] - eye, Math.hypot(dx, dz)), fov: 1.0 });
    },
    { x, z, at },
  );
  await page.evaluate(() => window.__chimp.settle(6));
}
