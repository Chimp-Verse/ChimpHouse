// The air hockey table in the Game Room, against the running preview (npm run dev).
//   node tools/test-air-hockey.mjs        play it: the physics and the robot on their own, then a
//                                         visitor playing the robot with the mouse
// QUALITY=low loads at low quality (a hardware scaling other than 1, as on a Retina Mac at high)
//   SHARED=1 node tools/test-air-hockey.mjs   two visitors (separate browser contexts, at low
//                                         quality to spare memory) playing each other instead
//   node tools/test-air-hockey.mjs look   screenshots of the table: from a walker's eye at about
//                                         2.5 m, close-ups of its details, and at night
//   node tools/test-air-hockey.mjs lights [name]   the Game Room's light budget: every light meant
//                                         for the room reaches its meshes, no mesh past the 8 a
//                                         material takes; and screenshots of the room by day and
//                                         night, the front at night and the claw and snack machines
//                                         at night, as captures/lights-<name>-*.png
// Screenshots go to captures/air-hockey-*.png. Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:5173";
const mode = process.argv[2] ?? "play";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
mkdirSync("captures", { recursive: true });
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });

async function open(viewport = { width: 1400, height: 860 }, query = "capture=1&view=game", name = "") {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  await page.goto(`${URL}/?${query}${name ? `&name=${name}` : ""}${process.env.QUALITY && !query.includes("quality") ? `&quality=${process.env.QUALITY}` : ""}`, { timeout: 180000, waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
  return page;
}

/** A pose at table-local (x, y, z) looking at table-local (tx, ty, tz). */
function poseFor(t, [x, y, z], [tx, ty, tz], fov = 0.9) {
  const c = Math.cos(t.yaw);
  const s = Math.sin(t.yaw);
  // the table's X axis is (cos, 0, -sin) in the world, its Z axis (sin, 0, cos)
  const w = (lx, lz) => [t.at[0] + lx * c + lz * s, t.at[2] - lx * s + lz * c];
  const [ex, ez] = w(x, z);
  const [gx, gz] = w(tx, tz);
  const dx = gx - ex;
  const dz = gz - ez;
  return { x: ex, y: t.at[1] + y, z: ez, yaw: Math.atan2(dx, dz), pitch: Math.atan2(y - ty, Math.hypot(dx, dz)), fov };
}

async function shot(page, pose, name, night = false) {
  await page.evaluate(async ({ pose, night }) => {
    window.__chimp.setNight(night);
    window.__chimp.setPose(pose);
    await window.__chimp.settle(5);
    await window.__chimp.whenReady();
    await window.__chimp.settle(30);
  }, { pose, night });
  await page.screenshot({ path: `captures/air-hockey-${name}.png` });
  const info = await page.evaluate(() => window.__chimp.info());
  console.log(`shot ${name}: ${info.fps} fps, ${info.drawCalls} draw calls`);
}

if (mode === "look") {
  const page = await open();
  const t = await page.evaluate(() => window.__chimp.airHockey.where());
  check(!!t, "the table is found by its role", JSON.stringify(t));
  const field = await page.evaluate(() => window.__chimp.airHockey.field());
  check(field && Math.abs(field.hx * 2 - 2.08) < 0.01 && Math.abs(field.hz * 2 - 1.04) < 0.01, "the playfield is read from its mesh", JSON.stringify(field));
  if (t) {
    await shot(page, poseFor(t, [-2.0, 1.6, -1.5], [0, 0.75, 0]), "walker");
    await shot(page, poseFor(t, [1.9, 1.6, 1.6], [0, 0.8, 0]), "walker-2");
    await shot(page, poseFor(t, [-0.35, 1.2, -0.7], [-1.1, 0.78, 0], 0.75), "closeup-goal");
    await shot(page, poseFor(t, [-2.0, 0.95, -0.6], [-1.17, 0.55, 0], 0.75), "closeup-return");
    await shot(page, poseFor(t, [0.75, 1.25, -1.0], [0, 1.1, 0], 0.8), "closeup-board");
    await shot(page, poseFor(t, [-0.9, 0.55, -1.3], [-0.6, 0.4, -0.55], 0.85), "closeup-cabinet");
    await shot(page, poseFor(t, [-2.0, 1.6, -1.5], [0, 0.75, 0]), "night", true);
    // the table's own draw calls: the frame with its meshes of its own hidden, against the frame with them
    const cost = await page.evaluate(async () => {
      const c = window.__chimp;
      const own = c.scene.meshes.filter((m) => m.name.startsWith("gameRoom:ah") || m.name.startsWith("Air hockey"));
      const calls = async () => {
        await c.settle(60);
        return c.info().drawCalls;
      };
      const on = await calls();
      own.forEach((m) => m.setEnabled(false));
      const off = await calls();
      own.forEach((m) => m.setEnabled(true));
      return { meshes: own.length, on, off };
    });
    console.log(`the table's own meshes: ${cost.meshes}, ${cost.on - cost.off} draw calls (${cost.on} with them, ${cost.off} without)`);
  }
}

const SHARED = process.env.SHARED === "1";

/** Wait on a page until the puck is in play (after a faceoff's countdown, or a goal's pause); returns the game then. */
const playOn = (page) =>
  page.evaluate(async () => {
    const c = window.__chimp.airHockey;
    for (let k = 0; k < 400 && !(c.describe().phase === "play" && c.describe().live); k++) await new Promise((r) => setTimeout(r, 20));
    return c.describe();
  });

if (mode === "play" && !SHARED) {
  // ---------------------------------------------------------------- 1. the physics and the robot, on their own
  const page = await open({ width: 1200, height: 760 }, "view=game", "Ada");
  const phys = await page.evaluate(async () => {
    const P = await window.__chimp.airHockey.physics();
    const spec = { hx: 1.04, hz: 0.52, goalHalf: 0.15, cornerR: 0.06, puckR: 0.041, malletR: 0.048 };
    const out = {};
    const fresh = () => {
      const sim = P.makeSim(spec);
      // mallets parked out of the way unless a test uses them
      sim.targets[0].x = sim.mallets[0].x = -0.98;
      sim.targets[0].z = sim.mallets[0].z = 0.45;
      sim.targets[1].x = sim.mallets[1].x = 0.98;
      sim.targets[1].z = sim.mallets[1].z = -0.45;
      return sim;
    };
    const run = (sim, secs, each) => {
      for (let t = 0; t < secs; t += 1 / 60) {
        P.step(sim, 1 / 60);
        if (each) each(sim, t);
      }
    };
    // a near-frictionless glide
    let sim = fresh();
    P.placePuck(sim, -0.6, 0.2);
    sim.puck.vx = 0.5;
    run(sim, 1);
    out.glide = Math.hypot(sim.puck.vx, sim.puck.vz) / 0.5;
    // a rail rebound
    sim = fresh();
    P.placePuck(sim, 0.3, 0.2);
    sim.puck.vz = 3;
    run(sim, 0.25);
    out.rebound = sim.puck.vz / 3;
    // a thousand random shots, the puck never leaving the table except into a goal
    let escaped = 0;
    let goals = 0;
    for (let k = 0; k < 400; k++) {
      sim = fresh();
      P.placePuck(sim, (Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 0.9);
      const a = Math.random() * Math.PI * 2;
      sim.puck.vx = Math.cos(a) * P.PHYSICS.puckMax;
      sim.puck.vz = Math.sin(a) * P.PHYSICS.puckMax;
      run(sim, 1.5, (s) => {
        const p = s.puck;
        if (s.live && (Math.abs(p.z) > spec.hz - spec.puckR + 1e-6 || Math.abs(p.x) > spec.hx + spec.puckR + 1e-6)) escaped++;
      });
      if (sim.scored) goals++;
    }
    out.escaped = escaped;
    out.randomGoals = goals;
    // a fast mallet sweeping through a still puck strikes it, it doesn't pass through
    sim = fresh();
    P.placePuck(sim, -0.4, 0);
    sim.mallets[0].x = -0.8;
    sim.mallets[0].z = 0;
    sim.targets[0].x = -0.06;
    sim.targets[0].z = 0;
    let overlap = 0;
    run(sim, 0.4, (s) => {
      const m = s.mallets[0];
      if (Math.hypot(m.x - s.puck.x, m.z - s.puck.z) < spec.malletR + spec.puckR - 0.002) overlap++;
    });
    out.sweep = { vx: sim.puck.vx, overlap };
    // the mallet's speed passes to the puck: a harder blow, a faster puck
    const blow = (speed) => {
      const s = fresh();
      s.malletMax[0] = speed;
      P.placePuck(s, -0.3, 0);
      s.mallets[0].x = -0.9;
      s.mallets[0].z = 0;
      s.targets[0].x = -0.05;
      s.targets[0].z = 0;
      run(s, 0.3);
      return Math.hypot(s.puck.vx, s.puck.vz);
    };
    out.soft = blow(2);
    out.hard = blow(P.PHYSICS.malletMax[0]);
    out.robotHard = blow(P.ROBOT.speed);
    // a puck at full speed at a still mallet bounces off it
    sim = fresh();
    P.placePuck(sim, 0.5, 0);
    sim.mallets[0].x = sim.targets[0].x = -0.5;
    sim.mallets[0].z = sim.targets[0].z = 0;
    sim.puck.vx = -P.PHYSICS.puckMax;
    overlap = 0;
    run(sim, 0.15, (s) => {
      const m = s.mallets[0];
      if (Math.hypot(m.x - s.puck.x, m.z - s.puck.z) < spec.malletR + spec.puckR - 0.002) overlap++;
    });
    out.fast = { vx: sim.puck.vx, overlap };
    // a straight shot into the goal scores; one at the post doesn't
    sim = fresh();
    P.placePuck(sim, 0.4, 0.02);
    sim.puck.vx = 4;
    run(sim, 0.6);
    out.goal = sim.scored;
    sim = fresh();
    P.placePuck(sim, 0.4, 0.15);
    sim.puck.vx = 4;
    run(sim, 0.6);
    out.post = { scored: sim.scored, vx: sim.puck.vx };
    // a mallet can't cross the centre line or leave its half
    sim = fresh();
    sim.targets[0].x = 0.6;
    sim.targets[0].z = 2;
    run(sim, 0.5);
    out.clamp = [sim.mallets[0].x, sim.mallets[0].z];
    // the robot defending: shots from the far half at its goal, some saved, some not
    let saved = 0;
    const shots = 40;
    for (let k = 0; k < shots; k++) {
      sim = fresh();
      const mind = P.makeRobot();
      sim.mallets[1].x = 0.87;
      sim.mallets[1].z = 0;
      P.placePuck(sim, -0.35 - Math.random() * 0.3, (Math.random() - 0.5) * 0.8);
      // anywhere across the goal mouth, now and then off a side rail
      const bank = k % 4 === 3;
      const aimZ0 = (Math.random() - 0.5) * 0.26;
      const aimZ = bank ? Math.sign(Math.random() - 0.5) * (2 * (0.52 - 0.041)) - aimZ0 : aimZ0;
      const dx = 1.04 - sim.puck.x;
      const dz = aimZ - sim.puck.z;
      const sp = 3 + Math.random() * 3;
      const l = Math.hypot(dx, dz);
      sim.puck.vx = (dx / l) * sp;
      sim.puck.vz = (dz / l) * sp;
      let clock = 0;
      for (let t = 0; t < 2 && sim.live; t += 1 / 60) {
        clock += 1 / 60;
        P.robotMove(sim, 1, mind, clock, Math.random);
        P.step(sim, 1 / 60);
      }
      if (sim.scored !== 2) saved++;
    }
    out.saved = saved / shots;
    // the robot attacking: a puck left in its half, it scores on an empty goal
    let robotGoals = 0;
    for (let k = 0; k < 10; k++) {
      sim = fresh();
      const mind = P.makeRobot();
      P.placePuck(sim, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.7);
      let clock = 0;
      for (let t = 0; t < 6 && sim.live; t += 1 / 60) {
        clock += 1 / 60;
        P.robotMove(sim, 1, mind, clock, Math.random);
        P.step(sim, 1 / 60);
      }
      if (sim.scored === 1) robotGoals++;
    }
    out.robotGoals = robotGoals;
    out.malletMax = P.PHYSICS.malletMax[0];
    return out;
  });
  console.log(JSON.stringify(phys));
  check(phys.glide > 0.75, "the puck glides on its air cushion, near frictionless", `keeps ${(phys.glide * 100).toFixed(0)}% of its speed over 1 s`);
  check(phys.rebound < -0.6 && phys.rebound > -0.85, "the puck rebounds off a rail, losing some speed", `vz ${phys.rebound.toFixed(2)}x`);
  check(phys.escaped === 0, "400 random fast shots never leave the table", `${phys.escaped} escapes, ${phys.randomGoals} went in`);
  check(phys.sweep.vx > 3 && phys.sweep.overlap === 0, "a fast mallet sweeping through a still puck strikes it, never passing through", JSON.stringify(phys.sweep));
  check(phys.hard > phys.soft * 2, "the mallet's speed passes to the puck", `soft ${phys.soft.toFixed(2)} m/s, hard ${phys.hard.toFixed(2)} m/s`);
  check(phys.hard < phys.malletMax * 1.5 && phys.hard <= 8, "a hit gives the puck about the mallet's speed, no big boost", `${phys.hard.toFixed(2)} m/s from a ${phys.malletMax} m/s mallet`);
  check(phys.robotHard < phys.hard, "the robot never hits harder than a person can", `robot ${phys.robotHard.toFixed(2)} m/s, person ${phys.hard.toFixed(2)} m/s`);
  check(phys.fast.vx > 1 && phys.fast.overlap === 0, "a puck at full speed bounces off a still mallet", JSON.stringify(phys.fast));
  check(phys.goal === 2, "a straight shot into the blue goal scores");
  check(phys.post.scored === 0 && phys.post.vx < 0, "a shot onto the post bounces out", JSON.stringify(phys.post));
  check(phys.clamp[0] <= -0.047 && phys.clamp[1] <= 0.52 - 0.047, "a mallet stays in its own half, inside the rails", JSON.stringify(phys.clamp));
  check(phys.saved > 0.25 && phys.saved < 0.95, "the robot saves some shots but can be beaten", `saved ${(phys.saved * 100).toFixed(0)}%`);
  check(phys.robotGoals >= 6, "the robot scores from a puck left in its half", `${phys.robotGoals}/10`);

  // ---------------------------------------------------------------- 2. one visitor plays the robot with the mouse
  const t = await page.evaluate(() => window.__chimp.airHockey.where());
  await page.evaluate(() => window.__chimp.airHockey.reset());
  await sleep(400);
  const stand = poseFor(t, [-1.75, 1.7, 0], [0, 0.8, 0]);
  await page.evaluate((p) => {
    window.__chimp.setPose(p);
    window.__chimp.setWalking(true);
  }, stand);
  await sleep(800);
  const prompt = await page.evaluate(() => window.__chimp.state().airHockeyPrompt);
  check(prompt?.end === 1 && prompt.opponent === "the robot", "walking up to the red end offers it, against the robot", JSON.stringify(prompt));
  await page.keyboard.press("KeyE");
  await page.waitForFunction(() => window.__chimp.state().focus?.phase === "on", null, { timeout: 8000 }).catch(() => {});
  const s1 = await page.evaluate(() => ({ focus: window.__chimp.state().focus, hud: window.__chimp.state().airHockey, d: window.__chimp.airHockey.describe() }));
  check(s1.focus?.kind === "airHockey" && s1.focus.end === 1, "E sits the visitor at the red end, the view behind it", JSON.stringify(s1.focus));
  check(s1.d.runs && s1.d.phase === "ready" && s1.d.score[0] + s1.d.score[1] === 0, "their page runs the game, and a match starts with a faceoff", JSON.stringify({ runs: s1.d.runs, phase: s1.d.phase, players: s1.d.players }));
  check(s1.hud?.opponent === "the robot", "the HUD shows the score and the robot as the opponent", JSON.stringify(s1.hud));
  await page.screenshot({ path: "captures/air-hockey-faceoff.png" });
  // the faceoff: nothing moves the puck and the robot waits until a 3-2-1 countdown has run
  const face = await page.evaluate(async () => {
    const c = window.__chimp.airHockey;
    const t0 = performance.now();
    const first = c.describe();
    const counts = new Set();
    let puckMoved = 0;
    let robotOff = 0;
    let goals = 0;
    while (c.describe().phase === "ready" && performance.now() - t0 < 8000) {
      const d = c.describe();
      const h = window.__chimp.state().airHockey;
      if (h?.countdown) counts.add(h.countdown);
      puckMoved = Math.max(puckMoved, Math.hypot(d.puck[0] - first.puck[0], d.puck[1] - first.puck[1]), Math.hypot(d.puck[2], d.puck[3]));
      if (performance.now() - t0 > 400) robotOff = Math.max(robotOff, Math.hypot(d.mallets[1][0] - 0.87, d.mallets[1][1]));
      goals = d.score[0] + d.score[1];
      await new Promise((r) => setTimeout(r, 50));
    }
    const after = c.describe();
    return { counts: [...counts].sort(), puckMoved, robotOff, goals, waited: Math.round(performance.now() - t0), phase: after.phase };
  });
  check(face.counts.join() === "1,2,3" && face.waited > 2500, "a 3-2-1 countdown runs once the visitor is in place", JSON.stringify(face));
  check(face.goals === 0 && face.puckMoved < 0.001 && face.robotOff < 0.01, "no goal and no robot strike before the countdown ends: the puck held, the robot waiting", JSON.stringify(face));
  check(face.phase === "play", "then play begins");
  // the mouse: the mallet goes where the cursor is, across the visitor's half
  const follow = [];
  for (const [x, z] of [
    [-0.7, 0.25],
    [-0.3, -0.3],
    [-0.85, 0.0],
  ]) {
    const at = await page.evaluate(([x, z]) => window.__chimp.airHockey.aim(x, z), [x, z]);
    await page.mouse.move(at.x, at.y, { steps: 6 });
    await sleep(350);
    const m = await page.evaluate(() => window.__chimp.airHockey.describe().mallets[0]);
    follow.push(Math.hypot(m[0] - x, m[1] - z));
  }
  check(follow.every((d) => d < 0.02), "the mallet follows the mouse cursor", follow.map((d) => d.toFixed(3)).join(", ") + " m off");
  // the cursor over the far half: the mallet stops at the centre line
  {
    const at = await page.evaluate(() => window.__chimp.airHockey.aim(0.5, 0.1));
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await sleep(400);
    const m = await page.evaluate(() => window.__chimp.airHockey.describe().mallets[0]);
    check(m[0] <= -0.047, "with the cursor over the far half, the mallet stops short of the centre line", m[0].toFixed(3));
  }
  // a hard sweep into the puck: it flies
  await playOn(page);
  await page.evaluate(() => window.__chimp.airHockey.setPuck(-0.45, 0.0, 0, 0));
  {
    const a = await page.evaluate(() => window.__chimp.airHockey.aim(-0.95, 0));
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await sleep(500);
    await page.evaluate(() => window.__chimp.airHockey.setPuck(-0.45, 0.0, 0, 0));
    const b = await page.evaluate(() => window.__chimp.airHockey.aim(-0.1, 0.02));
    await page.mouse.move(b.x, b.y, { steps: 2 });
    await sleep(60);
    const d = await page.evaluate(() => window.__chimp.airHockey.describe());
    const sp = Math.hypot(d.puck[2], d.puck[3]);
    check(sp > 2, "sweeping the mallet through the puck sends it flying", `${sp.toFixed(2)} m/s`);
  }
  await page.screenshot({ path: "captures/air-hockey-play.png" });
  // the robot plays: it moves its mallet, and keeps the puck out more often than not
  const robotMoves = await page.evaluate(async () => {
    const c = window.__chimp.airHockey;
    const seen = new Set();
    const start = c.describe().mallets[1];
    let moved = 0;
    for (let k = 0; k < 20; k++) {
      c.setPuck(0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6, -0.3, 0);
      await new Promise((r) => setTimeout(r, 120));
      const d = c.describe();
      seen.add(d.robot);
      moved = Math.max(moved, Math.hypot(d.mallets[1][0] - start[0], d.mallets[1][1] - start[1]));
    }
    return { plans: [...seen], moved };
  });
  check(robotMoves.moved > 0.1 && robotMoves.plans.length >= 2, "the robot moves the other mallet by itself", JSON.stringify(robotMoves));
  // play is live and the robot can score at any moment: scripted shots wait for the puck to be in play,
  // and go in from the mouth of the goal, past its mallet
  const inPlay = () =>
    page.evaluate(async () => {
      const c = window.__chimp.airHockey;
      for (let k = 0; k < 300 && !(c.describe().phase === "play" && c.describe().live); k++) await new Promise((r) => setTimeout(r, 20));
      return c.describe();
    });
  // a goal: the puck into the robot's goal scores for red, and the scoreboard says so
  await inPlay();
  await page.evaluate(() => window.__chimp.airHockey.setScore(0, 0));
  await page.evaluate(() => window.__chimp.airHockey.setPuck(1.03, 0, 3, 0));
  await sleep(300);
  const g1 = await page.evaluate(() => ({ d: window.__chimp.airHockey.describe(), hud: window.__chimp.state().airHockey }));
  check(g1.d.score[0] === 1 && g1.d.phase === "goal", "a puck in the blue goal scores for red", JSON.stringify({ score: g1.d.score, phase: g1.d.phase }));
  await page.screenshot({ path: "captures/air-hockey-goal.png" });
  // the puck comes back into play, on blue's side, after the pause
  const g2 = await page.evaluate(async () => {
    const c = window.__chimp.airHockey;
    const t0 = performance.now();
    for (let k = 0; k < 200 && !(c.describe().phase === "play" && c.describe().live); k++) await new Promise((r) => setTimeout(r, 15));
    return { ...c.describe(), after: Math.round(performance.now() - t0) };
  });
  const g1clock = g1.d.clock;
  check(g2.phase === "play" && g2.live && g2.puck[0] > 0 && g2.after > 800, "after a pause the puck comes back on the side scored on", JSON.stringify({ phase: g2.phase, puck: g2.puck, runs: g2.runs, sim: g2.sim === g2.me, gameAge: g2.gameAge, seats: g2.seats, players: g2.players, me: g2.me, end: g2.end, after: g2.after, clockRan: +(g2.clock - g1clock).toFixed(2) }));
  // first to 7: the match ends, then a rematch starts at 0-0
  await inPlay();
  await page.evaluate(() => window.__chimp.airHockey.setScore(6, 4));
  await page.evaluate(() => window.__chimp.airHockey.setPuck(1.03, 0.01, 3, 0));
  await sleep(500);
  const over = await page.evaluate(() => ({ d: window.__chimp.airHockey.describe(), hud: window.__chimp.state().airHockey }));
  check(over.d.phase === "over" && over.d.winner === 1 && over.hud?.winner === 1, "at 7 the match is over and red wins", JSON.stringify({ phase: over.d.phase, score: over.d.score, winner: over.d.winner }));
  await sleep(300);
  await page.screenshot({ path: "captures/air-hockey-over.png" });
  // the robot plays on at once, so look straight after the click
  await page.getByRole("button", { name: "Rematch" }).click();
  const re = await page.evaluate(async () => {
    const c = window.__chimp.airHockey;
    const m = c.describe().match;
    for (let k = 0; k < 40 && c.describe().match === m; k++) await new Promise((r) => setTimeout(r, 10));
    return c.describe();
  });
  check(re.phase === "ready" && re.score[0] === 0 && re.score[1] === 0 && re.match === over.d.match + 1, "Rematch starts a new match at 0-0, with a faceoff", JSON.stringify({ phase: re.phase, score: re.score, match: re.match }));
  const re2 = await playOn(page);
  check(re2.phase === "play" && re2.score[0] + re2.score[1] === 0, "and play begins after its countdown, nobody having scored", JSON.stringify({ phase: re2.phase, score: re2.score }));

  // the sounds (a headless browser can't listen, so this reads what played)
  await sleep(1500);
  const snd = await page.evaluate(() => window.__chimp.airHockey.sounds());
  check(snd.running, "the table's sound is on after the visitor's key press", JSON.stringify(snd));
  check((snd.played.mallet ?? 0) > 0 && (snd.played.rail ?? 0) > 0, "the puck sounds on the mallets and the rails", JSON.stringify(snd.played));
  check((snd.played.goal ?? 0) >= 2 && (snd.played.win ?? 0) >= 1 && (snd.played.start ?? 0) >= 2, "goals drop and sound the horn, a won match its fanfare, a new match its jingle", JSON.stringify(snd.played));
  check(snd.air, "the air table hisses while a match is on");
  const lv = await page.evaluate(() => window.__chimp.airHockey.soundLevels());
  console.log(Object.entries(lv).map(([k, v]) => `${k} peak ${v.peak.toFixed(2)} rms ${v.rms.toFixed(3)}`).join(" · "));
  check(Object.values(lv).every((v) => v.peak > 0.02 && v.peak < 1), "every sound renders audible and unclipped", Object.entries(lv).map(([k, v]) => `${k} ${v.peak.toFixed(2)}`).join(", "));
  check(lv["hard mallet"].peak > lv["soft mallet"].peak * 2, "a hard hit sounds louder than a soft one", `${lv["soft mallet"].peak.toFixed(2)} vs ${lv["hard mallet"].peak.toFixed(2)}`);
  const info = await page.evaluate(() => window.__chimp.info());
  console.log(`at the table: ${info.fps} fps, ${info.drawCalls} draw calls`);
  await page.evaluate(() => window.__chimp.airHockey.leave());
  // walking away: the table falls quiet, its air off once nobody plays and out of earshot
  await sleep(1200);
  await page.evaluate(() => window.__chimp.goTo("entry"));
  await sleep(800);
  const away = await page.evaluate(() => window.__chimp.airHockey.sounds());
  check(!away.air, "after leaving and walking away, the air table is quiet", JSON.stringify(away));
  await page.close();
}

if (mode === "play" && SHARED) {
  // ---------------------------------------------------------------- two visitors, each a page of its own
  const page = await open({ width: 1000, height: 640 }, "view=game&quality=low", "Ada");
  const t = await page.evaluate(() => window.__chimp.airHockey.where());
  await page.evaluate(() => window.__chimp.airHockey.reset());
  await sleep(400);
  await page.evaluate((p) => {
    window.__chimp.setPose(p);
    window.__chimp.setWalking(true);
  }, poseFor(t, [-1.75, 1.7, 0], [0, 0.8, 0]));
  await sleep(500);
  await page.evaluate(() => window.__chimp.airHockey.sit(1));
  await sleep(600);
  const re = await page.evaluate(() => window.__chimp.airHockey.describe());
  check(re.end === 1 && re.runs, "the first visitor plays the robot at the red end, their page running the game", JSON.stringify({ end: re.end, runs: re.runs }));
  const b = await open({ width: 800, height: 500 }, "view=game&quality=low", "Bea");
  await b.evaluate((p) => {
    window.__chimp.setPose(p);
    window.__chimp.setWalking(true);
  }, poseFor(t, [1.75, 1.7, 0], [0, 0.8, 0]));
  await sleep(1000);
  const bp = await b.evaluate(() => window.__chimp.state().airHockeyPrompt);
  check(bp?.end === 2 && bp.opponent === "Ada", "a second visitor at the robot's end is offered it, against the first", JSON.stringify(bp));
  await b.keyboard.press("KeyE");
  await b.waitForFunction(() => window.__chimp.state().focus?.phase === "on", null, { timeout: 8000 }).catch(() => {});
  await sleep(700);
  const [da, db] = await Promise.all([page.evaluate(() => window.__chimp.airHockey.describe()), b.evaluate(() => window.__chimp.airHockey.describe())]);
  check(db.end === 2 && da.players[1] === db.me && db.players[0] === da.me, "they play each other, red against blue", JSON.stringify({ a: da.players, b: db.players }));
  check(da.runs && !db.runs, "the first to sit runs the game", JSON.stringify({ a: [da.runs, da.sim === da.me, da.gameAge, da.visible], b: [db.runs, db.sim === db.me, db.gameAge, db.visible] }));
  // whichever page runs the game is where the test moves the puck
  const runner = db.runs ? b : page;
  check(da.score[0] === 0 && da.score[1] === 0 && da.match > re.match, "a new match starts when the robot hands over", JSON.stringify({ score: da.score, match: da.match }));
  const hb0 = await b.evaluate(async () => {
    for (let k = 0; k < 200 && !window.__chimp.state().airHockey?.countdown; k++) await new Promise((r) => setTimeout(r, 20));
    return window.__chimp.state().airHockey;
  });
  check(hb0?.phase === "ready" && hb0.countdown > 0 && hb0.waitingFor === null, "the faceoff's countdown starts once both are in place", JSON.stringify(hb0));
  await playOn(page);
  const hb = await b.evaluate(() => window.__chimp.state().airHockey);
  check(hb?.opponent === "Ada" && hb.end === 2, "the second visitor's HUD shows the first as their opponent", JSON.stringify(hb));
  // B's mouse moves B's mallet at once on B's page, and on A's page soon after
  const at = await b.evaluate(() => window.__chimp.airHockey.aim(0.5, -0.2));
  await b.mouse.move(at.x, at.y, { steps: 5 });
  await sleep(150);
  const bm = await b.evaluate(() => window.__chimp.airHockey.describe().mallets[1]);
  check(Math.hypot(bm[0] - 0.5, bm[1] + 0.2) < 0.02, "the second visitor's mallet follows their own cursor at once", bm.map((v) => v.toFixed(3)).join(", "));
  await sleep(400);
  const am = await page.evaluate(() => window.__chimp.airHockey.describe().mallets[1]);
  check(Math.hypot(am[0] - bm[0], am[1] - bm[1]) < 0.03, "and the first visitor sees it there", am.map((v) => v.toFixed(3)).join(", "));
  // the puck in step on both pages
  await runner.evaluate(() => window.__chimp.airHockey.setPuck(-0.2, 0.3, 1.2, -0.7));
  await sleep(500);
  // each page's puck, brought to the same moment of the room's clock
  const both = await Promise.all([page, b].map((p) => p.evaluate(() => window.__chimp.airHockey.describe())));
  const dt = (both[1].now - both[0].now) / 1000;
  const off = Math.hypot(both[0].puck[0] + both[0].puck[2] * dt - both[1].puck[0], both[0].puck[1] + both[0].puck[3] * dt - both[1].puck[1]);
  check(off < 0.08, "both visitors see the puck in the same place", `${(off * 100).toFixed(1)} cm apart`);
  await b.screenshot({ path: "captures/air-hockey-two-players.png" });
  // a goal by blue counts on both pages
  await runner.evaluate(() => window.__chimp.airHockey.setPuck(-1.03, 0, -3, 0));
  await sleep(600);
  const sc = await Promise.all([page, b].map((p) => p.evaluate(() => window.__chimp.airHockey.describe().score)));
  check(sc[0][1] === 1 && sc[1][1] === 1, "a goal by blue counts for both visitors", JSON.stringify(sc));
  // the first visitor leaves: the second takes over the game, against the robot
  await page.getByRole("button", { name: /Leave/ }).first().click();
  await sleep(1500);
  const after = await Promise.all([page.evaluate(() => ({ d: window.__chimp.airHockey.describe(), focus: window.__chimp.state().focus })), b.evaluate(() => ({ d: window.__chimp.airHockey.describe(), hud: window.__chimp.state().airHockey }))]);
  check(after[0].focus === null && after[0].d.end === null, "Leave gives the first visitor walking back", JSON.stringify(after[0].focus));
  check(after[1].d.runs && after[1].d.players[0] === null && after[1].hud?.opponent === "the robot", "the second visitor's page takes the game over, the robot at the red end", JSON.stringify({ runs: after[1].d.runs, players: after[1].d.players, opp: after[1].hud?.opponent }));
  // Esc leaves too; the table is free again
  await b.keyboard.press("Escape");
  await sleep(1300);
  const freed = await page.evaluate(() => ({ players: window.__chimp.airHockey.describe().players, phase: window.__chimp.airHockey.describe().phase }));
  check(freed.players.every((p) => p === null) && freed.phase === "idle", "Esc leaves, and the table is free and idle", JSON.stringify(freed));
  await b.close();
  await page.close();
}

if (mode === "lights") {
  const name = process.argv[3] ?? "now";
  const page = await open({ width: 1400, height: 860 }, "capture=1&view=game", "");
  for (const night of [false, true]) {
    const r = await page.evaluate(async (night) => {
      const c = window.__chimp;
      c.setNight(night);
      await c.settle(5);
      const scene = c.scene;
      const inRoom = (m) => m.metadata?.room === "gameRoom" && m.isEnabled();
      const room = scene.meshes.filter(inRoom);
      // the lights meant for the room: the sky's (on every mesh) and every room light whose meshes include one of the room's
      const meant = scene.lights.filter((l) => l.isEnabled() && (!l.includedOnlyMeshes.length || l.includedOnlyMeshes.some(inRoom)));
      let worst = 0;
      let worstMesh = "";
      const missing = new Set();
      for (const m of room) {
        m.computeWorldMatrix(true);
        const has = m.lightSources ?? [];
        if (has.length > worst) {
          worst = has.length;
          worstMesh = m.name;
        }
        for (const l of meant) if ((!l.includedOnlyMeshes.length || l.includedOnlyMeshes.includes(m)) && !has.includes(l)) missing.add(`${l.name}@${l.position?.asArray?.().map((v) => v.toFixed(1)).join(",")}`);
      }
      const describe = (l) => `${l.name}${l.position ? "@" + l.position.asArray().map((v) => v.toFixed(1)).join(",") : ""}`;
      return { meshes: room.length, meant: meant.map(describe), worst, worstMesh, missing: [...missing] };
    }, night);
    console.log(`${night ? "night" : "day"}: ${r.meant.length} lights meant for the Game Room: ${r.meant.join(" ")}`);
    check(r.worst <= 8, `${night ? "at night" : "by day"}, no Game Room mesh has more than 8 lights`, `${r.worst} on ${r.worstMesh}, ${r.meshes} meshes`);
    check(r.meant.length <= 8 && r.missing.length === 0, `${night ? "at night" : "by day"}, every light meant for the Game Room reaches its meshes, within the cap`, `${r.meant.length} meant${r.missing.length ? `, missing ${r.missing.join(" ")}` : ""}`);
  }
  // the screenshots
  const view = async (id, night, file) => {
    await page.evaluate(async ({ id, night }) => {
      window.__chimp.goTo(id);
      window.__chimp.setNight(night);
      await window.__chimp.settle(5);
      await window.__chimp.whenReady();
      await window.__chimp.settle(30);
    }, { id, night });
    await page.screenshot({ path: `captures/lights-${name}-${file}.png` });
  };
  await view("game", false, "game-day");
  await view("game", true, "game-night");
  await view("front-night", true, "front-night");
  const machines = await page.evaluate(() => {
    const at = (role) => {
      const n = [...window.__chimp.scene.transformNodes, ...window.__chimp.scene.meshes].find((x) => x.metadata?.role === role);
      if (!n) return null;
      const m = n.computeWorldMatrix(true);
      const p = n.getAbsolutePosition();
      // its front, -Z in its own space
      const fx = -m.m[8];
      const fz = -m.m[10];
      const l = Math.hypot(fx, fz) || 1;
      return { x: p.x, y: p.y, z: p.z, fx: fx / l, fz: fz / l };
    };
    return { claw: at("claw-machine"), snack: at("snack-machine") };
  });
  if (machines.claw && machines.snack) {
    const mx = (machines.claw.x + machines.snack.x) / 2;
    const mz = (machines.claw.z + machines.snack.z) / 2;
    const fx = machines.claw.fx + machines.snack.fx;
    const fz = machines.claw.fz + machines.snack.fz;
    const l = Math.hypot(fx, fz) || 1;
    const ex = mx + (fx / l) * 2.6;
    const ez = mz + (fz / l) * 2.6;
    const pose = { x: ex, y: machines.claw.y + 1.5, z: ez, yaw: Math.atan2(mx - ex, mz - ez), pitch: Math.atan2(0.4, 2.6), fov: 0.9 };
    await page.evaluate(async (pose) => {
      window.__chimp.setNight(true);
      window.__chimp.setPose(pose);
      await window.__chimp.settle(5);
      await window.__chimp.whenReady();
      await window.__chimp.settle(30);
    }, pose);
    await page.screenshot({ path: `captures/lights-${name}-machines-night.png` });
  } else check(false, "the claw and snack machines are found by role", JSON.stringify(machines));
  await page.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
