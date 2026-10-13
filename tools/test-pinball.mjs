// The pinball machines in a real browser against the running preview (npm run dev).
//   node tools/test-pinball.mjs [look | lab]      SHARED=1 node tools/test-pinball.mjs
// "look" only takes the screenshots of the machines (from a walker's eye, close up,
// the backboxes, at night); "lab" only runs the physics and rules checks, in Node
// without a browser. SHARED=1 runs only the two-visitor check (one player per
// machine, the high scores shared): a second copy of the house, so it's opt-in. Screenshots: captures/pinball-*.png. Exits non-zero when a check fails.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
const mode = process.argv[2] ?? "all";
/** SHARED=1: only the two-visitor check (a second copy of the house: run it rarely), both pages at low quality */
const SHARED = !!process.env.SHARED;
await mkdir("captures", { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
if (mode === "lab") {
  // the pure physics and rules in Node, no browser: bundled from src with rolldown
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "pinball-lab-"));
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, ["engine/pinballPhysics", "engine/pinballRules", "world/props/pinballTables"].map((m) => `export * from ${JSON.stringify(resolve("src", m))};`).join("\n"));
  execFileSync(resolve("node_modules/.bin/rolldown"), [entry, "--format", "esm", "--platform", "node", "--file", join(dir, "lab.mjs")], { stdio: "ignore" });
  const L = await import(join(dir, "lab.mjs"));
  physicsChecks(physicsLab(L));
  rulesChecks(rulesLab(L));
  console.log(failed ? `${failed} check(s) failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
}
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && !/\/chimpvibe\/|403|404/.test(m.text()) && console.log("[browser error]", m.text().slice(0, 300)));
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const shot = (name) => page.screenshot({ path: `captures/pinball-${name}.png` });
const frames = (n) => ev((n) => window.__chimp.settle(n), n);


/**
 * A machine's frame from its playfield node (role pinball-machine): its centre on the floor,
 * which way its front faces (toward the player), and the floor's height.
 */
const machine = (n) =>
  ev((n) => {
    const s = window.__chimp.scene;
    const node = s.transformNodes.find((t) => t.metadata?.role === "pinball-machine" && t.metadata.slot === n);
    const m = node.computeWorldMatrix(true).m;
    const up = [m[8], m[9], m[10]];
    const fl = Math.hypot(up[0], up[2]);
    const front = [-up[0] / fl, -up[2] / fl];
    const st = node.metadata.stand;
    const tr = (x, y, z) => [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]];
    const stand = tr(...st);
    const mid = tr(0, 0, 0.55);
    return { front, stand, floor: stand[1], mid, origin: [m[12], m[13], m[14]] };
  }, n);
/** The camera at eye, looking at target. */
const look = (eye, target, fov = 0.9) =>
  ev(
    ([e, t, fov]) => {
      const dx = t[0] - e[0], dy = t[1] - e[1], dz = t[2] - e[2];
      window.__chimp.setPose({ x: e[0], y: e[1], z: e[2], yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)), fov });
    },
    [eye, target, fov],
  );

// the browser is closed however the checks end
try {
await page.goto(`${URL}/?capture=1&view=entry${SHARED ? "&quality=low" : ""}`, { timeout: 300000 });
await waitFor(() => window.__chimp?.ready === true, null, 300000);
await sleep(500);

// ------------------------------------------------ 1. the machines, found by role
const found = await ev(() => {
  const s = window.__chimp.scene;
  const all = s.meshes.concat(s.transformNodes);
  const n = (role, slot) => all.filter((m) => m.metadata?.role === role && (slot === undefined || m.metadata.slot === slot)).length;
  return { machines: [n("pinball-machine", 1), n("pinball-machine", 2)], dmd: [n("pinball-dmd", 1), n("pinball-dmd", 2)], flippers: [n("pinball-flipper", 1), n("pinball-flipper", 2)], balls: [n("pinball-ball", 1), n("pinball-ball", 2)] };
});
check(found.machines.every((c) => c === 1) && found.dmd.every((c) => c === 1), "each machine's playfield and display carry their roles", JSON.stringify(found));
check(found.flippers[0] === 2 && found.flippers[1] === 3, "Jungle Quest has two flippers, Banana Blitz three", JSON.stringify(found.flippers));

if (!SHARED) await looks();

/** Screenshots: the machines from a walker's eye, as their players see them, the backboxes, the side, at night. */
async function looks() {
// ------------------------------------------------ 2. how they look
  const A = await machine(1);
  const B = await machine(2);
  const mid = [(A.mid[0] + B.mid[0]) / 2, A.floor + 1.0, (A.mid[2] + B.mid[2]) / 2];
  const front = [(A.front[0] + B.front[0]) / 2, (A.front[1] + B.front[1]) / 2];
  const away = (p, d, h) => [p[0] + front[0] * d, A.floor + h, p[2] + front[1] * d];
  await look(away(mid, 2.5, 1.55), mid, 1.0);
  await frames(30);
  await shot("room");
  const perf = await ev(() => window.__chimp.info());
  console.log(`at the machines: ${perf.fps} fps, ${perf.drawCalls} draw calls, ${perf.activeMeshes} active meshes; pose ${JSON.stringify(await ev(() => window.__chimp.pose()))}`);
  // each playfield as its player sees it, and the backboxes
  for (const [name, M] of [
    ["jq", A],
    ["bb", B],
  ]) {
    const eye = [M.stand[0] + M.front[0] * 0.05, M.floor + 1.62, M.stand[2] + M.front[1] * 0.05];
    await look(eye, [M.mid[0] - M.front[0] * 0.05, M.floor + 0.92, M.mid[2] - M.front[1] * 0.05], 0.85);
    await frames(20);
    await shot(`${name}-player`);
    const top = [M.mid[0] + M.front[0] * 0.15, M.floor + 1.75, M.mid[2] + M.front[1] * 0.15];
    await look(top, [M.mid[0] - M.front[0] * 0.08, M.floor + 0.9, M.mid[2] - M.front[1] * 0.08], 0.75);
    await frames(20);
    await shot(`${name}-above`);
  }
  await look(away(mid, 1.6, 1.4), [mid[0], A.floor + 1.45, mid[2]], 0.8);
  await frames(20);
  await shot("backboxes");
  // from the side: legs, cabinet art
  const side = [-front[1], front[0]];
  await look([A.mid[0] + side[0] * 1.6 + front[0] * 0.6, A.floor + 1.2, A.mid[2] + side[1] * 1.6 + front[1] * 0.6], [A.mid[0], A.floor + 0.8, A.mid[2]], 0.9);
  await frames(20);
  await shot("side");
  await ev(() => window.__chimp.setNight(true));
  await look(away(mid, 2.5, 1.55), mid, 1.0);
  await frames(40);
  await shot("night");
  await ev(() => window.__chimp.setNight(false));
}

if (SHARED) await shared();
else if (mode !== "look") {
  await physics();
  await rules();
  await play();
}

} finally {
  await browser.close().catch(() => {});
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");

// ------------------------------------------------ 3. the physics, pure, run in the page
async function physics() {
  const r = await inPage(physicsLab);
  physicsChecks(r);
}

/** Run a lab function in the page, against its own copy of the pure modules. */
function inPage(fn) {
  return ev(async (src) => (0, eval)(`(${src})`)(await window.__chimp.pinball.lab()), fn.toString());
}

/** The physics checks' measurements, from the pure modules L (in the page, or in Node for "lab"). */
function physicsLab(L) {
  {
    const out = {};
    const R = L.PF.ball;
    for (const def of L.TABLES) {
      const o = (out[def.id] = {});
      // a fresh table with one ball placed and a number of seconds stepped
      const run = (at, v, secs, each) => {
        const t = new L.Table(def);
        const b = t.balls[0];
        Object.assign(b, { mode: "free", x: at[0], y: at[1], px: at[0], py: at[1], vx: v[0], vy: v[1] });
        const n = Math.round(secs / L.STEP);
        for (let i = 0; i < n; i++) {
          t.step(L.STEP);
          if (each && each(t, b, i) === false) break;
        }
        return t;
      };
      // walls the ball must never get through: every wall line, and the inside of every block
      const segs = [];
      for (const w of def.walls) {
        const pts = w.closed ? [...w.pts, w.pts[0]] : w.pts;
        for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i], w.t ?? 0]);
      }
      const inside = (poly, x, y) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i], [xj, yj] = poly[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
        }
        return c;
      };
      const blocks = def.walls.filter((w) => w.closed).map((w) => w.pts).concat(def.slings.map((s) => [s.t, s.b, s.c]));
      const segDist = (x, y, [a, b]) => {
        const abx = b[0] - a[0], aby = b[1] - a[1];
        let u = ((x - a[0]) * abx + (y - a[1]) * aby) / (abx * abx + aby * aby);
        u = Math.max(0, Math.min(1, u));
        return Math.hypot(x - a[0] - abx * u, y - a[1] - aby * u);
      };
      // 1. hard shots everywhere, flippers flailing: never through a wall or into a block
      let worst = 0, escapes = 0, shots = 0;
      let seed = def.slot * 7919;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 160; k++) {
        const at = [-0.2 + rnd() * 0.38, 0.25 + rnd() * 0.6];
        if (blocks.some((p) => inside(p, at[0], at[1])) || segs.some((s) => segDist(at[0], at[1], s) < R + s[2] + 0.002)) continue;
        if (def.bumpers.some((bp) => Math.hypot(at[0] - bp.at[0], at[1] - bp.at[1]) < bp.r + R + 0.002)) continue;
        if (def.posts.some((p) => Math.hypot(at[0] - p.at[0], at[1] - p.at[1]) < p.r + R + 0.002)) continue;
        shots++;
        const a = rnd() * Math.PI * 2;
        const sp = 3 + rnd() * 3.5;
        run(at, [Math.cos(a) * sp, Math.sin(a) * sp], 1.5, (t, b, i) => {
          if (i % 90 === 0) for (const side of ["L", "R"]) t.setFlipper(side, rnd() < 0.5);
          if (b.mode !== "free") return false;
          if (b.x < -0.26 || b.x > 0.26 || b.y > 1.07) escapes++;
          if (blocks.some((p) => inside(p, b.x, b.y))) escapes++;
          for (const s of segs) worst = Math.max(worst, R + s[2] - segDist(b.x, b.y, s));
          return escapes === 0;
        });
        if (escapes) break;
      }
      o.tunnel = { shots, escapes, worstPenetration: worst };
      // 2. the plunger: launch speed by how far it was pulled back
      for (const pull of [0.3, 0.6, 1.0]) {
        const t = new L.Table(def);
        t.serve();
        t.autoLaunch(pull);
        let vmax = 0, ymax = 0, launched = false;
        for (let i = 0; i < 2.2 / L.STEP; i++) {
          t.step(L.STEP);
          vmax = Math.max(vmax, t.balls[0].vy);
          ymax = Math.max(ymax, t.balls[0].y);
          if (t.events.some((e) => e.type === "launch")) launched = true;
          t.events.length = 0;
        }
        o[`plunger${pull}`] = { speed: +vmax.toFixed(2), top: +ymax.toFixed(3), launched };
      }
      // 3. a flipper shot: a ball resting on the left flipper near the tip, then the button
      const f = def.flippers[0];
      const shoot = (frac) => {
        const t = new L.Table(def);
        const c = Math.cos(f.rest), s = Math.sin(f.rest);
        const px = f.pivot[0] + c * f.len * frac - s * (f.r1 + 0.0145);
        const py = f.pivot[1] + s * f.len * frac + c * (f.r1 + 0.0145);
        const b = t.balls[0];
        Object.assign(b, { mode: "free", x: px, y: py, px, py, vx: 0, vy: 0 });
        for (let i = 0; i < 0.02 / L.STEP; i++) t.step(L.STEP);
        t.setFlipper("L", true);
        let v = 0;
        for (let i = 0; i < 0.12 / L.STEP; i++) {
          t.step(L.STEP);
          v = Math.max(v, Math.hypot(b.vx, b.vy));
        }
        return { speed: +v.toFixed(2), vy: +b.vy.toFixed(2), up: +(t.flippers[0].angle * 180 / Math.PI).toFixed(1) };
      };
      o.flipTip = shoot(0.85);
      o.flipBase = shoot(0.25);
      // how long the flipper takes to swing up
      {
        const t = new L.Table(def);
        t.setFlipper("L", true);
        let ms = 0;
        while (t.flippers[0].angle !== f.up && ms < 200) {
          t.step(L.STEP);
          ms += L.STEP * 1000;
        }
        o.flipMs = +ms.toFixed(1);
      }
      // 4. cradling: the flipper held up, a ball dropped down the inlane comes to rest on it
      {
        const t = new L.Table(def);
        t.setFlipper("L", true);
        for (let i = 0; i < 0.1 / L.STEP; i++) t.step(L.STEP);
        const b = t.balls[0];
        Object.assign(b, { mode: "free", x: -0.191, y: 0.37, px: -0.191, py: 0.37, vx: 0, vy: -0.3 });
        for (let i = 0; i < 3 / L.STEP; i++) t.step(L.STEP);
        o.cradle = { mode: b.mode, speed: +Math.hypot(b.vx, b.vy).toFixed(3), x: +b.x.toFixed(3), y: +b.y.toFixed(3) };
      }
      // 5. a pop bumper kicks: a slow ball rolled into it leaves fast
      {
        const bp = def.bumpers[0];
        let kicked = false, vout = 0;
        run([bp.at[0], bp.at[1] - bp.r - 0.03], [0, 0.6], 0.3, (t, b) => {
          if (t.events.some((e) => e.type === "bumper")) kicked = true;
          t.events.length = 0;
          if (kicked) vout = Math.max(vout, Math.hypot(b.vx, b.vy));
        });
        o.bumper = { kicked, speed: +vout.toFixed(2) };
      }
      // 6. a slingshot kicks
      {
        const s = def.slings[0];
        const mx = (s.t[0] + s.c[0]) / 2 + 0.03, my = (s.t[1] + s.c[1]) / 2;
        let kicked = false, vout = 0;
        run([mx, my], [-0.8, 0], 0.3, (t, b) => {
          if (t.events.some((e) => e.type === "sling")) kicked = true;
          t.events.length = 0;
          if (kicked) vout = Math.max(vout, Math.hypot(b.vx, b.vy));
        });
        o.sling = { kicked, speed: +vout.toFixed(2) };
      }
      // 7. a ball between the flippers drains
      {
        let drained = false;
        run([L.PF.cx, 0.3], [0, -0.5], 1.5, (t) => {
          if (t.events.some((e) => e.type === "drain")) drained = true;
          t.events.length = 0;
          return !drained;
        });
        o.drain = drained;
      }
      // 8. the ramp: fast enough goes round and out the far end, too slow rolls back
      if (def.ramps.length) {
        const rp = def.ramps[0];
        const mid = [(rp.mouth[0][0] + rp.mouth[1][0]) / 2, (rp.mouth[0][1] + rp.mouth[1][1]) / 2];
        const dir = [rp.path[1][0] - rp.path[0][0], rp.path[1][1] - rp.path[0][1]];
        const dl = Math.hypot(...dir);
        const tryRamp = (sp) => {
          let res = null, end = null;
          run([mid[0] - (dir[0] / dl) * 0.03, mid[1] - (dir[1] / dl) * 0.03], [(dir[0] / dl) * sp, (dir[1] / dl) * sp], 4, (t, b) => {
            for (const e of t.events) if (e.type === "rampDone" || e.type === "rampFail") res = e.type;
            t.events.length = 0;
            if (res) {
              end = [+b.x.toFixed(3), +b.y.toFixed(3)];
              return false;
            }
          });
          return { res, end };
        };
        o.rampFast = tryRamp(3.2);
        o.rampSlow = tryRamp(1.0);
      }
      // 9. a spinner spins
      if (def.spinners.length) {
        const sp = def.spinners[0];
        let spins = 0;
        run([(sp.a[0] + sp.b[0]) / 2, sp.a[1] - 0.05], [0, 2.5], 1.5, (t) => {
          spins += t.events.filter((e) => e.type === "spin").length;
          t.events.length = 0;
        });
        o.spins = spins;
      }
      // 10. a saucer catches a slow ball and kicks it out when told
      {
        const sc = def.scoops[0];
        let caught = false;
        const t = run([sc.at[0], sc.at[1] - 0.06], [0, 0.75], 0.6, (t) => {
          if (t.events.some((e) => e.type === "scoop")) caught = true;
          t.events.length = 0;
          return !caught;
        });
        t.eject(0);
        for (let i = 0; i < 0.2 / L.STEP; i++) t.step(L.STEP);
        o.scoop = { caught, out: t.balls[0].mode, vy: +t.balls[0].vy.toFixed(2) };
      }
    }
    return out;
  }
}

function physicsChecks(r) {
  for (const [id, o] of Object.entries(r)) {
    console.log(`${id}: ${JSON.stringify(o)}`);
    check(o.tunnel.shots > 100 && o.tunnel.escapes === 0 && o.tunnel.worstPenetration < 0.0135 * 0.6, `${id}: ${o.tunnel.shots} hard shots at 3–6.5 m/s with the flippers flailing: never through a wall or into a block`, `deepest ${(o.tunnel.worstPenetration * 1000).toFixed(2)} mm into a wall`);
    check(o["plunger1"].speed > 3.0 && o["plunger0.6"].speed < o["plunger1"].speed * 0.75 && o["plunger0.3"].speed < o["plunger0.6"].speed, `${id}: the plunger launches as hard as it was pulled`, `${o["plunger0.3"].speed} / ${o["plunger0.6"].speed} / ${o["plunger1"].speed} m/s`);
    check(o["plunger1"].launched && o["plunger1"].top > 0.95 && !o["plunger0.3"].launched, `${id}: a full plunge goes up round the arch; a weak one falls back`, `tops ${o["plunger0.3"].top} / ${o["plunger1"].top} m`);
    check(o.flipMs < 50, `${id}: a flipper swings up in under 50 ms`, `${o.flipMs} ms`);
    check(o.flipTip.vy > 2.5 && o.flipTip.speed > o.flipBase.speed, `${id}: a flipper fires the ball up the playfield, harder near its tip`, `tip ${o.flipTip.speed} m/s, base ${o.flipBase.speed} m/s`);
    check(o.cradle.mode === "free" && o.cradle.speed < 0.05, `${id}: a held flipper cradles a ball`, JSON.stringify(o.cradle));
    check(o.bumper.kicked && o.bumper.speed > 1.4, `${id}: a pop bumper kicks the ball away`, `${o.bumper.speed} m/s`);
    check(o.sling.kicked && o.sling.speed > 1.2, `${id}: a slingshot kicks the ball away`, `${o.sling.speed} m/s`);
    check(o.drain, `${id}: a ball between the flippers drains`);
    if (o.rampFast) check(o.rampFast.res === "rampDone" && o.rampSlow.res === "rampFail", `${id}: a fast shot makes the ramp and comes out at its end; a slow one rolls back`, JSON.stringify([o.rampFast, o.rampSlow]));
    if (o.spins !== undefined) check(o.spins >= 6, `${id}: a ball through the spinner spins it`, `${o.spins} spins`);
    check(o.scoop.caught && o.scoop.out === "free" && o.scoop.vy < -0.5, `${id}: the saucer catches a slow ball and kicks it out`, JSON.stringify(o.scoop));
  }
}

// ------------------------------------------------ 4. the rules, pure, run in the page
async function rules() {
  rulesChecks(await inPage(rulesLab));
}

function rulesLab(L) {
  {
    const out = {};
    const mk = (i) => {
      const table = new L.Table(L.TABLES[i]);
      const game = new L.Game(L.TABLES[i], table);
      game.start();
      const tick = (secs) => {
        for (let k = 0; k < secs / 0.01; k++) {
          table.advance(0.01);
          game.update(0.01);
        }
      };
      return { table, game, tick };
    };
    const launch = (t, tick) => {
      t.table.autoLaunch(1);
      tick(1.0);
    };
    const drainBall = ({ table, tick }) => {
      const b = table.balls.find((b) => b.mode === "free" || b.mode === "held" || b.mode === "ramp");
      if (b) Object.assign(b, { mode: "free", x: L.PF.cx, y: 0.2, px: L.PF.cx, py: 0.2, vx: 0, vy: -0.5 });
      tick(0.6);
    };
    // ball save, three balls, game over
    {
      const g = mk(0);
      g.tick(0.5);
      launch(g, g.tick);
      drainBall(g);
      const saved = g.game.message?.top;
      g.tick(2);
      const stillBall1 = g.game.ball;
      // once the save has run out, a drain ends the ball
      g.game.saveUntil = 0;
      drainBall(g);
      g.tick(5);
      const ball2 = g.game.ball;
      for (let i = 0; i < 2; i++) {
        launch(g, g.tick);
        g.tick(9);
        drainBall(g);
        g.tick(5);
      }
      out.flow = { saved, stillBall1, ball2, state: g.game.state, score: g.game.score };
    }
    // tilt: nudging hard three times over
    {
      const g = mk(0);
      launch(g, g.tick);
      for (let i = 0; i < 12 && !g.game.tilted; i++) {
        g.game.nudge();
        g.tick(0.05);
      }
      out.tilt = { tilted: g.game.tilted, warnings: g.game.warnings, dead: g.table.dead, msg: g.game.message?.top };
    }
    // Jungle Quest: the idols light the temple, the temple starts a quest
    {
      const g = mk(0);
      launch(g, g.tick);
      for (const id of ["idol1", "idol2", "idol3"]) {
        g.table.drops.get(id).off = true;
        g.table.events.push({ type: "drop", id, ball: 0 });
        g.tick(0.05);
      }
      const lit = g.game.lamps.get("templeArrow");
      g.table.events.push({ type: "scoop", id: "temple", ball: 0 });
      g.tick(0.05);
      out.jq = { templeLit: lit, status: g.game.status, score: g.game.score };
    }
    // Banana Blitz: BANANA lights the lock, two locks, the third shot starts three-ball multiball
    {
      const g = mk(1);
      launch(g, g.tick);
      const spell = () => {
        for (let i = 1; i <= 6; i++) g.table.events.push({ type: "target", id: `banana${i}`, ball: 0 });
        g.tick(0.05);
      };
      const mouth = () => {
        // a ball into the mouth: one on the playfield, or a fresh one if none is (drained, or already in the mouth)
        let b = g.table.balls.find((b) => b.mode === "free");
        if (!b) b = g.table.balls[g.table.serve()];
        Object.assign(b, { mode: "held", scoop: 0, x: 0.03, y: 0.75, vx: 0, vy: 0 });
        g.table.events.push({ type: "scoop", id: "mouth", ball: g.table.balls.indexOf(b) });
        g.tick(3);
      };
      spell();
      const lock = g.game.lamps.get("lock");
      mouth();
      spell();
      mouth();
      const ready = g.game.status;
      mouth();
      // the two new balls are launched 0.6 s and 2.2 s in; the held one comes out at 2.2 s
      g.tick(0.5);
      out.bb = { lockLit: lock, ready, multiball: g.game.multiball, inPlay: g.table.inPlay, status: g.game.status };
    }
    return out;
  }
}

function rulesChecks(r) {
  console.log(JSON.stringify(r));
  check(r.flow.saved === "BALL SAVED" && r.flow.stillBall1 === 1, "a ball drained just after its launch is saved", JSON.stringify(r.flow));
  check(r.flow.ball2 === 2 && r.flow.state === "over", "after the ball save, a drain ends the ball; three balls end the game", JSON.stringify(r.flow));
  check(r.tilt.tilted && r.tilt.warnings === 3 && r.tilt.dead && r.tilt.msg === "TILT", "two warnings, then nudging too hard tilts: flippers dead", JSON.stringify(r.tilt));
  check(r.jq.templeLit > 0 && /VINE SWING/.test(r.jq.status), "Jungle Quest: the IDOL targets light the TEMPLE, which starts a quest", JSON.stringify(r.jq));
  check(r.bb.lockLit > 0 && /MULTIBALL/.test(r.bb.ready) && r.bb.multiball && r.bb.inPlay === 3, "Banana Blitz: BANANA lights the lock, two locks, then three-ball multiball", JSON.stringify(r.bb));
}

// ------------------------------------------------ 5. playing, in the page: walking up, the keys, leaving
async function play() {
  for (const [n, name] of [
    [1, "jq"],
    [2, "bb"],
  ]) {
    const M = await machine(n);
    // stand at the machine, looking at it, walking
    await ev(() => window.__chimp.setWalking(false));
    await look([M.stand[0], M.floor + 1.55, M.stand[2]], [M.mid[0], M.floor + 0.9, M.mid[2]], 1.0);
    await ev(() => window.__chimp.setWalking(true));
    await frames(10);
    const prompt = await ev(() => window.__chimp.state().pinballPrompt);
    check(prompt?.slot === n && !prompt.busy, `${name}: walking up to it offers it (E)`, JSON.stringify(prompt));
    await page.keyboard.press("KeyE");
    await waitFor((n) => window.__chimp.state().focus?.kind === "pinball" && window.__chimp.state().focus.phase === "on" && window.__chimp.state().focus.slot === n, n, 15000);
    const st0 = await ev((n) => window.__chimp.pinball.state(n), n);
    check(st0.state === "play" && st0.balls.some((b) => b.mode === "free"), `${name}: E plays it: a game starts with a ball on the plunger`, `${st0.state}`);
    await frames(10);
    await shot(`${name}-play-start`);
    // ChimpHouse's own keys do nothing while playing
    const night0 = await ev(() => window.__chimp.state().night);
    await page.keyboard.press("KeyN");
    check((await ev(() => window.__chimp.state().night)) === night0, `${name}: ChimpHouse's keys (N) do nothing while playing`);
    // the plunger: hold Space, let go
    await page.keyboard.down("Space");
    await sleep(700);
    const pulled = (await ev((n) => window.__chimp.pinball.state(n), n)).plunger;
    await page.keyboard.up("Space");
    // the highest the ball gets in the next second
    let top = 0;
    for (let i = 0; i < 20; i++) {
      const st1 = await ev((n) => window.__chimp.pinball.state(n), n);
      top = Math.max(top, ...st1.balls.filter((b) => b.mode !== "off").map((b) => b.y));
      await sleep(50);
    }
    check(pulled > 0.02 && top > 0.5, `${name}: holding Space pulls the plunger back; letting go launches the ball`, `pulled ${(pulled * 1000).toFixed(0)} mm, ball at y ${top.toFixed(2)}`);
    // the flippers answer their keys
    await page.keyboard.down("ShiftLeft");
    await sleep(120);
    const fl = await ev((n) => window.__chimp.pinball.state(n).flippers, n);
    await page.keyboard.up("ShiftLeft");
    check(fl[0].held && Math.abs(fl[0].angle - 0.4538) < 0.05, `${name}: Left Shift raises the left flipper${n === 2 ? "s" : ""}`, fl.map((f) => (f.angle * 180 / Math.PI).toFixed(0)).join(", "));
    // play a while: a robot at the flipper buttons (a ball close above a flipper and coming down gets flipped)
    await ev((n) => {
      const pb = window.__chimp.pinball;
      // per side: held now, since when, and a pause after letting a cradled ball go
      const st = { L: { held: false, since: 0, pauseUntil: 0 }, R: { held: false, since: 0, pauseUntil: 0 } };
      window.__pinBot = setInterval(() => {
        const s = pb.state(n);
        const now = performance.now();
        const want = { L: false, R: false };
        for (const b of s.balls) {
          if (b.mode !== "free" || b.y > 0.32 || b.x > 0.2) continue;
          want[b.x < -0.022 ? "L" : "R"] = b.vy < 0.2 && b.y < 0.27;
        }
        for (const side of ["L", "R"]) {
          const k = st[side];
          // a cradled ball: let the flipper drop, and flip again as the ball rolls down it
          if (k.held && now - k.since > 700) k.pauseUntil = now + 180;
          const on = want[side] && now >= k.pauseUntil;
          if (on !== k.held) {
            pb.press(n, side === "L" ? "ShiftLeft" : "ShiftRight", on);
            k.held = on;
            k.since = now;
          }
        }
        if (s.balls.some((b) => b.mode === "free" && b.x > 0.22 && b.y < 0.2) && s.plunger === 0) {
          pb.press(n, "Space", true);
          setTimeout(() => pb.press(n, "Space", false), 600 + Math.random() * 300);
        }
      }, 16);
    }, n);
    let best = 0;
    for (let i = 0; i < 6; i++) {
      await sleep(2500);
      const s = await ev((n) => window.__chimp.pinball.state(n), n);
      best = Math.max(best, s.score);
      if (i === 2) await shot(`${name}-play`);
    }
    await ev(() => clearInterval(window.__pinBot));
    const hud = await ev(() => window.__chimp.state().pinball);
    check(best > 0 && hud?.score === (await ev((n) => window.__chimp.pinball.state(n).score, n)), `${name}: playing scores, and the panel shows the score`, `${best.toLocaleString()} points`);
    // nudging: a game on, a ball rolling on the playfield
    if ((await ev((n) => window.__chimp.pinball.state(n).state, n)) === "over") await page.keyboard.press("Enter");
    await ev((n) => window.__chimp.pinball.place(n, 0, [-0.05, 0.6], [0, 0]), n);
    const before = await ev((n) => window.__chimp.pinball.state(n).balls.map((b) => b.vx), n);
    await page.keyboard.press("KeyX");
    const after = await ev((n) => window.__chimp.pinball.state(n).balls.map((b) => b.vx), n);
    check(after.some((v, i) => v !== before[i]), `${name}: X nudges the ball`);
    // Esc leaves, and gives walking back
    await page.keyboard.press("Escape");
    await waitFor(() => !window.__chimp.state().focus, null, 10000);
    const back = await ev(() => ({ walking: window.__chimp.state().walking, hud: window.__chimp.state().pinball }));
    check(back.walking && !back.hud, `${name}: Esc leaves and gives walking back`);
  }
}
process.exit(failed ? 1 : 0);

// ------------------------------------------------ 6. shared through the room: one player per machine, high scores
async function shared() {
  const ctx2 = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const other = await ctx2.newPage();
  other.on("pageerror", (e) => console.log("[pageerror 2]", e.message));
  await other.goto(`${URL}/?capture=1&view=entry&quality=low&name=Bonzo`, { timeout: 300000 });
  await other.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 200 });
  const M = await machine(1);
  // this visitor plays Jungle Quest
  await ev(() => window.__chimp.setWalking(false));
  await look([M.stand[0], M.floor + 1.55, M.stand[2]], [M.mid[0], M.floor + 0.9, M.mid[2]], 1.0);
  await ev(() => window.__chimp.setWalking(true));
  await frames(10);
  await page.keyboard.press("KeyE");
  await waitFor(() => window.__chimp.state().focus?.phase === "on", null, 15000);
  const me = await ev(() => window.__chimp.pinball.machines()[0].player);
  // the other visitor walks up to it
  await other.evaluate(([e, t]) => {
    const dx = t[0] - e[0], dy = t[1] - e[1], dz = t[2] - e[2];
    window.__chimp.setPose({ x: e[0], y: e[1], z: e[2], yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)), fov: 1 });
    window.__chimp.setWalking(true);
  }, [[M.stand[0], M.floor + 1.55, M.stand[2]], [M.mid[0], M.floor + 0.9, M.mid[2]]]);
  await other.waitForFunction(() => window.__chimp.state().pinballPrompt?.busy, null, { timeout: 15000, polling: 200 }).catch(() => {});
  const seen = await other.evaluate(() => window.__chimp.state().pinballPrompt);
  check(!!seen?.busy && seen.busy === me?.name, "another visitor walking up sees who is playing it", JSON.stringify(seen));
  const took = await other.evaluate(() => window.__chimp.pinball.use(1));
  check(took === false, "and can't play it meanwhile");
  await other.screenshot({ path: "captures/pinball-in-use.png" });
  // leaving ends the game; its score joins the high scores (the robot's games before this added theirs)
  await page.keyboard.press("Escape");
  await waitFor(() => !window.__chimp.state().focus, null, 10000);
  await other.waitForFunction(() => !window.__chimp.state().pinballPrompt?.busy, null, { timeout: 15000, polling: 200 }).catch(() => {});
  const free = await other.evaluate(() => window.__chimp.state().pinballPrompt);
  check(free && !free.busy, "when they leave, it's free for the other visitor", JSON.stringify(free));
  // the high scores, as both see them
  const highs = [await ev(() => window.__chimp.pinball.machines()[0].high), await other.evaluate(() => window.__chimp.pinball.machines()[0].high)];
  check(JSON.stringify(highs[0]) === JSON.stringify(highs[1]), "both visitors see the same high scores", JSON.stringify(highs));
  // a visitor who closes their page frees the machine
  const ok = await other.evaluate(() => window.__chimp.pinball.use(1));
  await other.waitForFunction(() => window.__chimp.state().focus?.phase === "on", null, { timeout: 15000, polling: 200 }).catch(() => {});
  await waitFor(() => window.__chimp.pinball.machines()[0].player?.name === "Bonzo", null, 10000).catch(() => {});
  const taken = await ev(() => window.__chimp.pinball.machines()[0].player);
  await ctx2.close();
  await waitFor(() => !window.__chimp.pinball.machines()[0].player, null, 30000).catch(() => {});
  const after = await ev(() => window.__chimp.pinball.machines()[0].player);
  check(ok && taken?.name === "Bonzo" && !after, "a visitor who closes their page frees the machine", JSON.stringify({ ok, taken, after }));
}
