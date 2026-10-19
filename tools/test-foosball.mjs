// The foosball table, in a real browser against the running preview (npm run dev):
//   pure  the physics, rules and robot as pure functions in the page: rolling, walls, corners,
//         goals, no tunnelling at full speed, kicks, lifted men, and the robot good but beatable
//   solo  one visitor against the robot: the parts found by role, walking up and the prompt, E,
//         the real mouse sliding the rods and flicking a kick, a click's spin, goals and the
//         counters, a match to the end, Rematch, Esc
//   duo   two visitors (two pages): the second takes the robot's side, both pages agree on the
//         ball and see each other's kicks, the host leaving hands the game over, a closed page
//         frees its side. A second whole house in memory, so only with SHARED=1, and kept light
//   node tools/test-foosball.mjs [pure] [solo]            (default: pure and solo)
//   SHARED=1 node tools/test-foosball.mjs duo
//   URL=http://localhost:5184 node tools/test-foosball.mjs
// Screenshots: captures/foosball-*.png. Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
const parts = process.argv.slice(2);
const want = (p) => (p === "duo" ? !!process.env.SHARED : !parts.length || parts.includes(p));
await mkdir("captures", { recursive: true });
let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the browser always closes: at the end, on a failure, on a signal, and before the run's lock would kill the run
const browsers = [];
const closeAll = () => Promise.all(browsers.splice(0).map((b) => b.close().catch(() => {})));
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => void closeAll().then(() => process.exit(1)));
setTimeout(() => {
  console.log("FAIL  the test ran past 9 minutes");
  void closeAll().then(() => process.exit(1));
}, 540000).unref();
const launch = async () => {
  const b = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"] });
  browsers.push(b);
  return b;
};
const browser = await launch();

/** A visitor: a page of its own, loaded and ready (in a browser of its own when given one, so it is never a background window). */
async function visitor(name, size = { width: 1400, height: 820 }, from = browser, query = "") {
  const ctx = await from.newContext({ viewport: size });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  page.on("console", (m) => m.type() === "error" && !/status of (530|404)|chimpvibe/i.test(m.text()) && console.log(`[${name} error]`, m.text().slice(0, 300)));
  const t0 = Date.now();
  await page.goto(`${URL}/?pov=first&view=game&name=${encodeURIComponent(name)}${query}`, { timeout: 180000 });
  await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
  console.log(`(${name} loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const ev = (fn, a) => page.evaluate(fn, a);
  const v = {
    page,
    ev,
    name,
    fb: () => ev(() => window.__chimp.foosball.describe()),
    state: () => ev(() => window.__chimp.state()),
    settle: (n = 10) => Promise.race([ev((n) => window.__chimp.settle(n), n), sleep(4000)]),
    shot: (file) => page.screenshot({ path: `captures/foosball-${file}.png` }),
    /** stand at a side of the table, in walk mode, looking at it */
    standAt: async (side, back = 0.75) => {
      await page.bringToFront();
      await ev(
        ({ side, back }) => {
          const c = window.__chimp;
          const t = c.scene.transformNodes.find((n) => n.metadata?.role === "foosball-table");
          const wm = t.computeWorldMatrix(true);
          const V = t.position.constructor;
          const s = side === "red" ? -1 : 1;
          const eye = V.TransformCoordinates(new V(0.1, 0.8, s * (0.39 + back)), wm);
          const at = V.TransformCoordinates(new V(0, 0, 0), wm);
          const dx = at.x - eye.x;
          const dz = at.z - eye.z;
          c.setWalking(false);
          c.setPose({ x: eye.x, y: eye.y, z: eye.z, yaw: Math.atan2(dx, dz), pitch: 0.5, fov: 1 });
          c.setWalking(true);
        },
        { side, back },
      );
      await v.settle(8);
    },
    /** where a point on the table (its frame) is on the page, in CSS px */
    onPage: (x, y, z) =>
      ev(
        ([x, y, z]) => {
          const c = window.__chimp;
          const s = c.scene;
          const t = s.transformNodes.find((n) => n.metadata?.role === "foosball-table");
          const V = t.position.constructor;
          const p = V.TransformCoordinates(new V(x, y, z), t.computeWorldMatrix(true));
          const e = s.getEngine();
          const M = s.activeCamera.getViewMatrix().multiply(s.activeCamera.getProjectionMatrix());
          const q = V.Project(p, M.constructor.Identity(), M, s.activeCamera.viewport.toGlobal(e.getRenderWidth(), e.getRenderHeight()));
          const box = s.getEngine().getRenderingCanvas().getBoundingClientRect();
          return { x: box.left + (q.x * box.width) / e.getRenderWidth(), y: box.top + (q.y * box.height) / e.getRenderHeight() };
        },
        [x, y, z],
      ),
  };
  return v;
}

try {
  // ------------------------------------------------------------------ pure
  if (want("pure")) {
    const a = await visitor("Pure");
    const r = await a.ev(() => {
      const { physics: P, match: M, robot: R, spec: S } = window.__chimp.foosball.pure;
      const out = {};
      const rods = () => S.RODS.map(() => P.restPose());
      const run = (ball, secs, poses = rods(), each) => {
        const events = [];
        let alive = true;
        let t = 0;
        const tmp = S.RODS.map(() => P.restPose());
        while (alive && t < secs) {
          each?.(t, poses);
          alive = P.advance(ball, 1 / 60, (_, o) => poses.forEach((p, i) => Object.assign(o[i], p)), tmp, events);
          t += 1 / 60;
        }
        return { alive, events, t };
      };
      // rolling slows and stops
      const b1 = P.newBall(-0.02, 0.33 - S.BALL_R - 0.001, 0.6, 0);
      const lifted = rods().map((p) => ({ ...p, turn: Math.PI / 2 }));
      run(b1, 6, lifted);
      out.rollStops = { x: b1.x, v: Math.hypot(b1.vx, b1.vz) };
      // struck from rest, it skids: friction spins it up until it rolls, slower (5/7 for a solid ball, less a little)
      const sb = { ...P.newBall(-0.55, 0.15, 3, 0), wx: 0, wz: 0 };
      run(sb, 0.36, lifted);
      out.skid = { vx: sb.vx, wx: sb.wx };
      out.hands = { player: P.PLAYER_HAND.turnSpeed, robot: R.ROBOT.turnSpeed };
      // a side wall: back out, slower
      const b2 = P.newBall(0.0, 0.2, 0, 3);
      run(b2, 0.12, lifted);
      out.wall = { vz: b2.vz, z: b2.z };
      // the hardest shot at a man hanging still, from in front: it never gets through
      let through = 0;
      let minX = Infinity;
      for (let k = 0; k < 40; k++) {
        const z = S.manZ(S.RODS[4], 2) + (k / 40 - 0.5) * 0.024;
        const b = P.newBall(0.3, z, -P.PHYS.maxSpeed, 0);
        run(b, 0.2, rods(), () => (minX = Math.min(minX, b.x)));
        if (b.x < S.RODS[4].x) through++;
      }
      out.tunnel = { through, minX };
      // a kick: rod 4 (red midfield) swinging through a ball resting in front of its middle man
      const kb = P.newBall(S.RODS[3].x + 0.03, 0, 0, 0);
      const kp = lifted.map((p) => ({ ...p }));
      run(kb, 0.08, kp, (t, poses) => {
        const p = poses[3];
        p.turnV = 45;
        p.turn = -0.6 + 45 * t;
      });
      out.kick = { vx: kb.vx, vz: kb.vz, x: kb.x };
      // men lifted out of the way: the ball rolls under them
      const lb = P.newBall(-0.3, 0, 2.5, 0);
      run(lb, 0.25, lifted);
      out.lifted = { x: lb.x };
      // into the goal: a goal, into the right one
      const gb = P.newBall(0.4, 0.02, 3, 0);
      const g = run(gb, 1, lifted);
      out.goal = { alive: g.alive, into: g.events.find((e) => e.kind === "goal")?.into ?? null };
      // at the end wall beside the mouth: a rebound, no goal
      const wb = P.newBall(0.4, 0.22, 3, 0);
      const w = run(wb, 0.3, lifted);
      out.endWall = { alive: w.alive, vx: wb.vx };
      // a ball left in a corner rolls back out of it
      const cb = P.newBall(0.6 - 0.02, 0.34 - 0.02, 0, 0);
      run(cb, 1.5, lifted);
      out.corner = { x: cb.x, z: cb.z };
      // the match rules
      let gm = M.startMatch(M.initialGame(0), "me", "red", 0, 0.5);
      const served = gm.phase;
      gm = M.advanceGame(gm, M.TIMING.serve + 1, 0.5);
      const playing = gm.phase;
      for (let i = 0; i < S.WIN_SCORE; i++) gm = M.advanceGame(M.scoreGoal(gm, "blue", 10000 * (i + 1)), 10000 * (i + 1) + M.TIMING.goal + 1, 0.5);
      out.match = { served, playing, red: gm.red, blue: gm.blue, phase: gm.phase, winner: M.winner(gm), serve: gm.serve };
      // a player's flick, frame by frame through the hand, the rod's driver and the physics as the engine runs
      // them, over where the ball rests in front of the man (just touching his foot to the tip of his reach),
      // the flick's size and speed, the frame rate, and the rod at rest, drawn back, or still settling from a
      // forward flick: the midfield's first strike always sends the ball forward
      const flicks = { runs: 0, wrong: [], weak: [] };
      for (const fps of [30, 60])
        for (const pre of ["rest", "drawn", "forward"])
          for (const dx of [0.02, 0.03, 0.045, 0.06, 0.075])
            for (const px of [60, 160, 320])
              for (const frames of [1, 2, 4]) {
                const dt = 1 / fps;
                const poses = rods();
                const prev = rods();
                const tmp = rods();
                const ball = P.newBall(S.RODS[3].x + dx, 0, 0, 0);
                let forward = 0;
                const moves = pre === "drawn" ? [[0.05, -60]] : pre === "forward" ? [[0.2, 120]] : [];
                for (let k = 0; k < frames; k++) moves.push([0.3 + k * dt, px / frames]);
                let last = -1;
                let first = null;
                const events = [];
                for (let f = 1; f * dt <= 0.7 && !first; f++) {
                  const t = f * dt;
                  let mx = 0;
                  for (const [mt, mp] of moves) if (mt > t - dt - 1e-9 && mt <= t + 1e-9) mx += mp;
                  if (mx) last = t;
                  forward = P.handTurn(forward, true, mx, last < 0 || (t - last) * 1000 > P.HAND.stillMs, dt);
                  poses.forEach((p, i) => Object.assign(prev[i], p));
                  P.driveRod(3, poses[3], 0, forward, dt, P.PLAYER_HAND);
                  events.length = 0;
                  P.advance(
                    ball,
                    dt,
                    (tt, out) => {
                      const k = Math.min(1, tt / dt);
                      poses.forEach((p, i) => Object.assign(out[i], { slide: p.slide, turn: prev[i].turn + (p.turn - prev[i].turn) * k, slideV: p.slideV, turnV: p.turnV }));
                    },
                    tmp,
                    events,
                  );
                  first = events.find((e) => e.kind === "man" && e.rod === 3) ?? null;
                }
                flicks.runs++;
                const seen = { fps, pre, dx, px, frames, first: first && { turn: +first.turn.toFixed(2), turnV: +first.turnV.toFixed(1), nx: +first.nx.toFixed(2), before: +first.before[0].toFixed(2), after: +first.after[0].toFixed(2) } };
                // backwards, or no faster: wrong. A big flick (160 px or more) that misses or barely moves it: weak
                if (first && (first.nx <= 0 || first.after[0] <= first.before[0])) flicks.wrong.push(seen);
                else if (px >= 160 && (!first || first.after[0] < 1)) flicks.weak.push(seen);
              }
      out.flicks = { runs: flicks.runs, wrong: flicks.wrong.length, weak: flicks.weak.length, examples: [...flicks.wrong, ...flicks.weak].slice(0, 3) };
      // the robot (blue) against straight shots and hard angled ones, from red's attack rod
      const trial = (speed, angled, seed) => {
        let s = seed;
        const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        const mind = R.newRobot("blue");
        const poses = rods();
        const z0 = (rand() - 0.5) * 0.4;
        const aimZ = angled ? (rand() < 0.5 ? -1 : 1) * (S.GOAL.half - 0.025) : z0;
        const dist = 0.6 - (S.RODS[5].x + 0.03);
        const b = P.newBall(S.RODS[5].x + 0.03, z0, speed * (dist / Math.hypot(dist, aimZ - z0)), speed * ((aimZ - z0) / Math.hypot(dist, aimZ - z0)));
        // red's own rods lifted out of the way; the robot's rods start lined up with the ball, as if it had been tracking it
        for (const i of mind.rods) poses[i].slide = P.slideFor(i, z0).slide;
        const tmp = S.RODS.map(() => P.restPose());
        const events = [];
        let t = 0;
        let alive = true;
        while (alive && t < 1.5) {
          const targets = R.robotPlay(mind, b, poses, "red", t, rand);
          mind.rods.forEach((i, k) => P.driveRod(i, poses[i], targets[k].slide, -targets[k].forward, 1 / 60, { slideSpeed: R.ROBOT.slideSpeed, turnSpeed: R.ROBOT.turnSpeed }));
          for (const i of [0, 1, 3, 5]) poses[i].turn = Math.PI / 2;
          alive = P.advance(b, 1 / 60, (_, o) => poses.forEach((p, i) => Object.assign(o[i], p)), tmp, events);
          t += 1 / 60;
          if (b.vx < -0.5) break; // cleared back up the table
        }
        return !alive && events.some((e) => e.kind === "goal" && e.into === "blue");
      };
      let slowIn = 0;
      let hardIn = 0;
      for (let k = 0; k < 30; k++) {
        if (trial(1.5, false, 1000 + k)) slowIn++;
        if (trial(5.2, true, 5000 + k)) hardIn++;
      }
      out.robot = { slowIn, hardIn, of: 30 };
      return out;
    });
    check(r.rollStops.v < 0.01, "a rolling ball slows to a stop", JSON.stringify(r.rollStops));
    check(r.wall.vz < -1.2 && r.wall.vz > -2.4, "a ball bounces back off a side wall, slower", JSON.stringify(r.wall));
    check(Math.abs(r.skid.vx - r.skid.wx) < 1e-3 && r.skid.vx > 1.8 && r.skid.vx < 2.2, "a struck ball skids, then rolls on at about 5/7 of its speed", JSON.stringify(r.skid));
    check(r.hands.robot < r.hands.player, "the robot's hands turn a rod slower than a player's, so it never kicks harder", JSON.stringify(r.hands));
    check(r.tunnel.through === 0, "the hardest shot never passes through a man hanging in its way (40 shots across his foot)", JSON.stringify(r.tunnel));
    check(r.kick.vx > 2, "a man swinging through the ball kicks it forward, hard", JSON.stringify(r.kick));
    check(r.lifted.x > 0.25, "with the men lifted, the ball rolls under them", JSON.stringify(r.lifted));
    check(!r.goal.alive && r.goal.into === "blue", "a ball into a goal's mouth is a goal, in the right goal", JSON.stringify(r.goal));
    check(r.endWall.alive && r.endWall.vx < 0, "a ball at the end wall beside the mouth bounces back", JSON.stringify(r.endWall));
    check(r.corner.x < 0.6 - 0.035 && r.corner.z < 0.34 - 0.035, "a ball left in a corner rolls back out of it", JSON.stringify(r.corner));
    check(r.match.served === "serve" && r.match.playing === "play" && r.match.red === 5 && r.match.phase === "over" && r.match.winner === "red", "a match: serve, play, first to 5 wins", JSON.stringify(r.match));
    check(r.flicks.wrong === 0 && r.flicks.weak === 0, "a flick's first strike always sends the ball forward, and a big one always strikes hard (any ball in reach, flick size and speed, frame rate, rod state)", `${r.flicks.runs} flicks, ${r.flicks.wrong} backwards, ${r.flicks.weak} weak${r.flicks.wrong + r.flicks.weak ? `: ${JSON.stringify(r.flicks.examples)}` : ""}`);
    check(r.robot.slowIn <= 3, "the robot stops slow straight shots", `${r.robot.slowIn} of ${r.robot.of} went in`);
    check(r.robot.hardIn >= 3 && r.robot.hardIn <= 26, "the robot can be beaten by hard angled shots, but not every time", `${r.robot.hardIn} of ${r.robot.of} went in`);
    await a.page.context().close();
  }

  // ------------------------------------------------------------------ solo
  if (want("solo")) {
    const a = await visitor("Solo");
    await a.ev(() => window.__chimp.foosball.reset());
    // the parts, found by role
    const roles = await a.ev(() => {
      const s = window.__chimp.scene;
      const nodes = [...s.transformNodes, ...s.meshes];
      const by = (r) => nodes.filter((n) => n.metadata?.role === r);
      return {
        table: by("foosball-table").length,
        field: by("foosball-field").length,
        rodSlots: by("foosball-rod-slot").map((n) => n.metadata.slot),
        rods: by("foosball-rod").map((n) => `${n.metadata.slot}:${n.name.split(": ")[1]?.split(":")[0]}`),
        counters: by("foosball-counter").length,
        ball: by("foosball-ball").length,
        kinds: [...new Set(s.meshes.filter((m) => /^Foosball/.test(m.name) && m.metadata?.role !== "foosball-field").map((m) => m.metadata?.kind))],
      };
    });
    check(roles.table === 1 && roles.field === 1 && roles.rodSlots.join() === "1,2,3,4,5,6,7,8" && roles.counters === 2 && roles.ball === 1, "the table, playfield, eight rod slots, two counters and the ball are found by role", JSON.stringify(roles));
    check(roles.rods.join() === "1:red goalie,2:red defence,3:blue attack,4:red midfield,5:blue midfield,6:red attack,7:blue defence,8:blue goalie", "the rods: goalie, defence, attack and midfield each, alternating from the middle", roles.rods.join(", "));
    check(roles.kinds.length === 1 && roles.kinds[0] === "moving", "the parts built at run time are kind moving (never solid, never exported)", roles.kinds.join());

    // walk up: the prompt
    await a.standAt("red");
    await sleep(300);
    const prompt = (await a.state()).foosballPrompt;
    check(prompt?.side === "red" && prompt?.against === "the robot", "walking up to red's side offers it, against the robot", JSON.stringify(prompt));
    await a.shot("prompt");
    const before = await a.ev(() => window.__chimp.info());
    // E plays
    await a.page.waitForFunction(() => window.__chimp.state().foosballPrompt?.side === "red", null, { timeout: 5000 });
    await a.page.keyboard.press("KeyE");
    const entered = await a.page.waitForFunction(() => window.__chimp.state().focus?.kind === "foosball" && window.__chimp.state().focus.phase === "on", null, { timeout: 15000 }).then(() => true, () => false);
    if (!entered) console.log("      (after E:", JSON.stringify({ focus: (await a.state()).focus, prompt: (await a.state()).foosballPrompt, walking: (await a.state()).walking, fb: await a.fb() }), ")");
    check(entered, "E takes the player to the table");
    let d = await a.fb();
    check(d.side === "red" && d.host === d.seats.red?.id && d.robot === "blue", "E plays red; this page hosts, and the robot plays blue", JSON.stringify({ side: d.side, robot: d.robot, phase: d.game.phase }));
    check(d.game.phase === "serve" || d.game.phase === "play", "a match starts with a serve", d.game.phase);
    await a.page.waitForFunction(() => window.__chimp.foosball.describe().game.phase === "play", null, { timeout: 5000 });
    await a.shot("play");
    const hud = await a.ev(() => ({ score: document.querySelector(".foos-score")?.textContent, bar: document.querySelector(".foos-bar")?.textContent, coach: !!document.querySelector(".foos-coach") }));
    check(/You.*0.*0.*Robot/.test(hud.score ?? "") && /Kicking with/.test(hud.bar ?? ""), "the scoreboard and the controls bar show", JSON.stringify(hud));

    // the real mouse: up and down slides the rods under the cursor's line. The line is at the ball's
    // height, so the ball under the cursor is the one the men go to. Checked at a hardware scaling of
    // 0.8, as on a Retina screen at high quality (picking takes CSS pixels, whatever the scaling)
    const scaling = await a.ev(() => {
      const e = window.__chimp.scene.getEngine();
      const was = e.getHardwareScalingLevel();
      e.setHardwareScalingLevel(0.8);
      return was;
    });
    await a.settle(4);
    const near = await a.onPage(0, 0.0175, -0.2);
    const far = await a.onPage(0, 0.0175, 0.2);
    await a.page.mouse.move(near.x, near.y);
    await sleep(250);
    const atNear = await a.fb();
    await a.page.mouse.move(far.x, far.y, { steps: 6 });
    await sleep(250);
    const atFar = await a.fb();
    check(Math.abs(atNear.aimZ + 0.2) < 0.02 && Math.abs(atFar.aimZ - 0.2) < 0.02, "the cursor's line across the table follows the mouse up and down (at a scaling of 0.8, as on a Retina screen)", `${atNear.aimZ.toFixed(3)} then ${atFar.aimZ.toFixed(3)}`);
    const goalieMoved = atFar.rods[0].slide - atNear.rods[0].slide;
    check(goalieMoved > 0.3, "the player's rods slide after it (the goalie from one side of his goal to the other)", `goalie slid ${goalieMoved.toFixed(3)} m`);
    await a.ev((was) => window.__chimp.scene.getEngine().setHardwareScalingLevel(was), scaling);
    await a.settle(4);

    // a flick: the ball resting in front of red's midfield, under the cursor; a quick move right
    // strikes it. What's checked is the strike itself, as the physics records it: a hard shot can meet
    // the robot's midfield 11 cm on within the same frame and come straight back (real foosball), so
    // the ball's speed sampled frame by frame can't say how hard it was struck
    const mid = await a.onPage(0, 0.0175, 0);
    await a.ev(() => window.__chimp.foosball.place(-0.075 + 0.035, 0.0, 0, 0));
    await a.page.mouse.move(mid.x - 60, mid.y);
    await sleep(400);
    d = await a.fb();
    check(d.active === 4, "the glowing rod is the player's nearest the ball (red midfield, slot 4)", `active ${d.active}`);
    const outline = await a.ev(() => window.__chimp.scene.meshes.filter((m) => m.metadata?.role === "foosball-rod" && m.renderOutline).map((m) => m.metadata.slot));
    check(outline.length === 1 && outline[0] === 4, "only the glowing rod is outlined", outline.join());
    const firstStrike = (since) =>
      a.page
        .waitForFunction((since) => window.__chimp.foosball.describe().strikes.find((h) => h.rod === 4 && h.at > since) ?? false, since, { timeout: 2000, polling: 30 })
        .then((h) => h.jsonValue(), () => null);
    const flickStrike = firstStrike((await a.fb()).now);
    await a.page.mouse.move(mid.x + 160, mid.y, { steps: 4 });
    const fs = await flickStrike;
    check(!!fs && fs.after > 1.2 && fs.after > fs.before && fs.turnV > 0, "a quick flick to the right strikes the ball towards blue's goal", fs ? `struck from ${fs.before.toFixed(2)} to ${fs.after.toFixed(2)} m/s, the rod turning ${fs.turnV.toFixed(0)} rad/s` : "no strike");
    await a.shot("kick");

    // a click: the glowing rod spins right round, striking the ball forward on the way
    await a.ev(() => window.__chimp.foosball.place(-0.075 + 0.03, 0.12, 0, 0));
    const p2 = await a.onPage(0, 0.0175, 0.12);
    await a.page.mouse.move(p2.x, p2.y, { steps: 3 });
    await sleep(350);
    const t0 = (await a.fb()).rods[3].turn;
    const clickStrike = firstStrike((await a.fb()).now);
    await a.page.mouse.down();
    await a.page.mouse.up();
    const cs = await clickStrike;
    await sleep(250);
    d = await a.fb();
    check(d.rods[3].turn - t0 > 5.5 && !!cs && cs.after > 1.5, "a click whips the glowing rod right round, striking the ball forward", `turned ${(d.rods[3].turn - t0).toFixed(2)} rad${cs ? `, struck to ${cs.after.toFixed(2)} m/s` : ", no strike"}`);

    // the wheel picks another rod until the ball moves on
    await a.ev(() => window.__chimp.foosball.place(-0.04, -0.1, 0, 0));
    await sleep(200);
    await a.page.mouse.wheel(0, 120);
    await sleep(150);
    d = await a.fb();
    check(d.active === 2 && d.picked === 2, "the wheel picks the rod behind (defence)", `active ${d.active}`);
    await a.page.keyboard.press("Digit4");
    await sleep(150);
    d = await a.fb();
    check(d.active === 6, "4 picks the attack rod", `active ${d.active}`);

    // the robot plays: its rods follow a ball rolling about its half
    await a.ev(() => window.__chimp.foosball.place(0.3, -0.25, 0.0, 0.9));
    const r0 = (await a.fb()).rods[6].slide;
    await sleep(700);
    const r1 = (await a.fb()).rods[6].slide;
    check(Math.abs(r1 - r0) > 0.05, "the robot's rods move after the ball", `blue defence slid ${(r1 - r0).toFixed(3)} m`);

    // a goal: the score, the counter's beads, the ball out of the return
    await a.ev(() => window.__chimp.foosball.lift(true));
    await a.ev(() => window.__chimp.foosball.place(0.565, 0.0, 3, 0));
    await a.page.waitForFunction(() => window.__chimp.foosball.describe().game.phase === "goal", null, { timeout: 4000 }).catch(() => {});
    await a.ev(() => window.__chimp.foosball.lift(false));
    d = await a.fb();
    check(d.game.phase === "goal" && d.game.red === 1 && d.game.into === "blue", "a ball into blue's goal scores for red", JSON.stringify(d.game));
    await sleep(250);
    const callout = await a.ev(() => document.querySelector(".foos-callout")?.textContent);
    check(callout === "GOAL!", "the HUD calls the goal", callout);
    await a.shot("goal");
    await a.page.waitForFunction(() => window.__chimp.foosball.describe().shown[0] > 0.7, null, { timeout: 3000, polling: "raf" }).catch(() => {});
    const back = await a.ev(() => ({ ball: window.__chimp.foosball.describe().shown, phase: window.__chimp.foosball.describe().game.phase }));
    check(back.ball[0] > 0.7 && back.ball[1] < -0.1 && back.phase === "goal", "the ball comes out of the ball return at that end", JSON.stringify(back));
    await a.shot("return");
    await a.page.waitForFunction(() => window.__chimp.foosball.describe().game.phase === "play", null, { timeout: 5000 }).catch(() => {});
    d = await a.fb();
    check(d.game.phase === "play" && d.game.serve === "blue", "the side scored on serves next", `${d.game.phase}, ${d.game.serve} serving`);

    // to the end: Rematch or Leave
    await a.ev(() => window.__chimp.foosball.setScore(4, 2));
    await a.ev(() => window.__chimp.foosball.lift(true));
    await a.ev(() => window.__chimp.foosball.place(0.565, 0.0, 3, 0));
    await a.page.waitForFunction(() => window.__chimp.foosball.describe().game.phase === "over", null, { timeout: 6000 }).catch(() => {});
    await a.ev(() => window.__chimp.foosball.lift(false));
    d = await a.fb();
    const over = await a.ev(() => document.querySelector(".foos-over")?.textContent ?? "");
    check(d.game.phase === "over" && /You win/.test(over) && /Rematch/.test(over), "first to 5 wins: the end card offers Rematch or Leave", over);
    await a.shot("won");
    await a.page.click(".foos-over .again");
    await sleep(300);
    d = await a.fb();
    check(d.game.red === 0 && d.game.blue === 0 && (d.game.phase === "serve" || d.game.phase === "play"), "Rematch starts a new match", JSON.stringify(d.game));
    const during = await a.ev(() => window.__chimp.info());
    // at night the field still reads: it glows a little more, as if lit by the lamp over it
    await a.ev(() => window.__chimp.setNight(true));
    await a.settle(20);
    const glow = await a.ev(() => window.__chimp.scene.getMaterialByName("foosField").emissiveColor.r);
    check(glow > 0.2, "at night the playfield glows a little more", `emissive ${glow.toFixed(2)}`);
    await a.shot("night-play");
    await a.ev(() => window.__chimp.setNight(false));
    console.log(`      draws and fps: walking up ${before.drawCalls} draws, ${before.fps} fps; playing ${during.drawCalls} draws, ${during.fps} fps`);

    // Esc leaves, and gives the side up
    await a.page.keyboard.press("Escape");
    await a.page.waitForFunction(() => !window.__chimp.state().focus, null, { timeout: 5000 }).catch(() => {});
    d = await a.fb();
    const st = await a.state();
    check(!st.focus && st.walking && d.side === null && !d.seats.red && d.game.phase === "idle", "Esc leaves: walking again, the side free, the table quiet", JSON.stringify({ focus: st.focus, side: d.side, phase: d.game.phase }));
    await a.page.context().close();
  }

  // ------------------------------------------------------------------ duo
  if (want("duo")) {
    // two visitors in one browser, both drawing (no background throttling), kept light; each page is
    // brought to the front before it's used, and every wait polls, as two whole houses draw slowly
    const a = await visitor("Ana", { width: 860, height: 540 }, browser, "&quality=low");
    await a.ev(() => window.__chimp.foosball.reset());
    const b = await visitor("Ben", { width: 800, height: 500 }, browser, "&quality=low");
    const until = (v, fn, arg, timeout = 20000) => v.page.waitForFunction(fn, arg, { timeout, polling: 150 }).then(() => true, () => false);
    await a.standAt("red");
    await until(a, () => window.__chimp.state().foosballPrompt?.side === "red");
    await a.page.keyboard.press("KeyE");
    check(await until(a, () => window.__chimp.state().focus?.phase === "on", null, 60000), "the first visitor plays red");
    await b.standAt("blue");
    await until(b, () => window.__chimp.state().foosballPrompt?.against === "Ana");
    const bp = (await b.state()).foosballPrompt;
    check(bp?.side === "blue" && bp?.against === "Ana", "a second visitor at the other side is offered it, against the first", JSON.stringify(bp));
    await b.page.keyboard.press("KeyE");
    check(await until(b, () => window.__chimp.state().focus?.phase === "on", null, 60000), "the second visitor plays blue");
    const seated = await until(a, () => window.__chimp.foosball.describe().seats.blue?.name === "Ben");
    let [da, db] = await Promise.all([a.fb(), b.fb()]);
    check(seated && db.side === "blue", "the second visitor takes the robot's side", JSON.stringify({ a: da.seats, benSide: db.side }));
    if (!seated) console.log("      (Ana's log:", da.log.join(" | "), ")\n      (Ben's log:", db.log.join(" | "), ")");
    check(da.host === db.host && da.host === da.seats.red?.id, "both pages agree red's page hosts", `${da.host} / ${db.host}`);
    // Ben's hands reach Ana's page
    await b.page.bringToFront();
    await b.ev(() => window.__chimp.foosball.aim(0.25));
    const followed = await until(a, () => Math.abs(window.__chimp.foosball.describe().rods[7].slide - 0.2) < 0.03, null, 10000);
    da = await a.fb();
    check(followed, "Ben's rods move on Ana's page as his hands move them", `blue goalie at ${da.rods[7].slide.toFixed(3)} on Ana's page`);
    // the ball, the same on both: rolling slowly, compared at the same room time
    await a.ev(() => window.__chimp.foosball.place(0.0, 0.05, 0.4, 0.25));
    await sleep(1500);
    const at = (v) => v.ev(() => ({ ...window.__chimp.foosball.describe().ball }));
    const [ba, bb] = await Promise.all([at(a), at(b)]);
    const apart = Math.hypot(ba.x - bb.x, ba.z - bb.z);
    check(apart < 0.05, "both pages show the ball in the same place", `${(apart * 100).toFixed(1)} cm apart`);
    await Promise.all([a.shot("duo-ana"), b.shot("duo-ben")]);
    // Ben kicks: Ana sees it
    await a.ev(() => window.__chimp.foosball.place(0.075 - 0.035, -0.12, 0, 0));
    await b.ev(() => window.__chimp.foosball.aim(-0.12));
    await until(b, () => Math.abs(window.__chimp.foosball.describe().ball.x - 0.04) < 0.01, null, 5000);
    await sleep(400);
    const watch = a.ev(() => new Promise((done) => {
      let best = 0;
      const t0 = performance.now();
      const look = () => {
        const d = window.__chimp.foosball.describe();
        best = Math.min(best, d.ball.vx);
        if (performance.now() - t0 < 2500 && best > -1) requestAnimationFrame(look);
        else done({ vx: best, touch: d.touch });
      };
      look();
    }));
    await b.ev(() => window.__chimp.foosball.flick(220));
    const kick = await watch;
    check(kick.vx < -1, "Ben's kick sends the ball towards red's goal on Ana's page", `vx down to ${kick.vx.toFixed(2)}`);
    // Ana leaves: Ben carries on, hosting, against the robot
    await a.page.bringToFront();
    await a.page.keyboard.press("Escape");
    const handed = await until(b, () => {
      const d = window.__chimp.foosball.describe();
      return d.host === d.seats.blue?.id && d.robot === "red";
    });
    db = await b.fb();
    check(handed && db.game.phase !== "idle", "when the host leaves, the other player hosts and the robot takes the side", JSON.stringify({ host: db.host, robot: db.robot, phase: db.game.phase }));
    // Ben closes his page: Ana, still at the table, sees his side free again
    await b.page.context().close();
    await until(a, () => !window.__chimp.foosball.describe().seats.blue, null, 25000);
    const dc = await a.fb();
    check(!dc.seats.blue && !dc.seats.red, "a visitor who closes their page gives up their side", JSON.stringify(dc.seats));
    await a.page.context().close();
  }
} finally {
  await closeAll();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
