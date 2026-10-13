// Air hockey physics and the robot, with no Babylon in them: the puck gliding on
// its air cushion, the rails and their rounded corners, the goal mouths and their
// posts, and two mallets driven towards targets (a player's cursor, or the robot).
//
// All in the playfield's own plane: x along the table (end 1 at -x, end 2 at +x),
// z across it, the origin at the centre spot, metres and seconds. The simulation
// runs in fixed substeps, short enough that nothing moves more than a fraction of
// a puck in one, and the puck meets a mallet at the moment they touch within a
// substep (both swept along their paths), so a fast mallet or puck can't pass
// through the other. Nothing here allocates once a simulation is made.

/** The table's sizes, read from its model (engine/airHockey.ts). */
export interface TableSpec {
  /** half the playfield's length and width */
  hx: number;
  hz: number;
  /** half the goal mouth's width */
  goalHalf: number;
  cornerR: number;
  puckR: number;
  malletR: number;
}

export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Something the puck struck in a step, for its sound: a mallet, a rail, a post, or a goal (end scored into). */
export interface SimEvent {
  kind: "mallet" | "rail" | "post" | "goal";
  /** the speed of the blow (m/s), or for a goal the end it went into */
  strength: number;
  /** the mallet that struck it (0 or 1), or -1 */
  mallet: number;
}

export const PHYSICS = {
  /** the fixed substep (s) */
  substep: 1 / 600,
  /** the air cushion's drag on the puck, per second: it glides for many seconds */
  puckDrag: 0.16,
  /** with the blower off, the puck sits on the laminate and soon stops */
  stillDrag: 7,
  /** the rails' bounce: how much of the puck's speed into them it keeps */
  railBounce: 0.86,
  /** the speed along a rail it keeps in a bounce */
  railGrip: 0.97,
  /** a mallet's bounce on the puck */
  malletBounce: 0.82,
  /** the fastest a puck travels (m/s) */
  puckMax: 14,
  /** how quickly a mallet catches up with its target (s), and its top speed (m/s): a hand sweeps, it doesn't jump */
  malletLag: 0.016,
  malletMax: [6.5, 6.5] as [number, number],
};

export interface Sim {
  spec: TableSpec;
  puck: Body;
  /** mallet 1 (end 1, -x) and mallet 2 */
  mallets: [Body, Body];
  /** where each mallet is heading */
  targets: [{ x: number; z: number }, { x: number; z: number }];
  /** each mallet's top speed (m/s) */
  malletMax: [number, number];
  /** false while the puck is off the table (in a goal) */
  live: boolean;
  /** the blower is on (a game is on): without it the puck soon stops */
  air: boolean;
  /** the end the puck last went into, until it is put back */
  scored: 0 | 1 | 2;
  /** time not yet simulated (s) */
  acc: number;
  /** what happened in the last step: `events[0..nEvents)` */
  events: SimEvent[];
  nEvents: number;
}

export function makeSim(spec: TableSpec): Sim {
  const body = (): Body => ({ x: 0, z: 0, vx: 0, vz: 0 });
  const sim: Sim = {
    spec,
    puck: body(),
    mallets: [body(), body()],
    targets: [
      { x: -spec.hx * 0.7, z: 0 },
      { x: spec.hx * 0.7, z: 0 },
    ],
    malletMax: [...PHYSICS.malletMax],
    live: true,
    air: true,
    scored: 0,
    acc: 0,
    events: Array.from({ length: 16 }, () => ({ kind: "rail" as SimEvent["kind"], strength: 0, mallet: -1 })),
    nEvents: 0,
  };
  for (const i of [0, 1] as const) {
    sim.mallets[i].x = sim.targets[i].x;
    sim.mallets[i].z = 0;
  }
  return sim;
}

/** Put the puck at rest at (x, z), in play. */
export function placePuck(sim: Sim, x: number, z: number): void {
  const p = sim.puck;
  p.x = x;
  p.z = z;
  p.vx = 0;
  p.vz = 0;
  sim.live = true;
  sim.scored = 0;
}

/** The point nearest (x, z) where mallet i may be: on its own half, inside the rails, short of the centre line. */
export function clampMallet(spec: TableSpec, i: 0 | 1, x: number, z: number, out: { x: number; z: number }): void {
  const { hx, hz, malletR: R, cornerR: Rc } = spec;
  const s = i === 0 ? -1 : 1;
  let ax = Math.min(hx - R, Math.max(R, s * x));
  let zz = Math.min(hz - R, Math.max(-(hz - R), z));
  // the rounded corners
  const cx = hx - Rc;
  const cz = hz - Rc;
  if (ax > cx && Math.abs(zz) > cz) {
    const dx = ax - cx;
    const dz = Math.abs(zz) - cz;
    const d = Math.hypot(dx, dz);
    const lim = Math.max(0, Rc - R);
    if (d > lim) {
      ax = cx + (dx / d) * lim;
      zz = Math.sign(zz) * (cz + (dz / d) * lim);
    }
  }
  out.x = s * ax;
  out.z = zz;
}

function event(sim: Sim, kind: SimEvent["kind"], strength: number, mallet = -1) {
  if (sim.nEvents >= sim.events.length) return;
  const e = sim.events[sim.nEvents++];
  e.kind = kind;
  e.strength = strength;
  e.mallet = mallet;
}

const tmp = { x: 0, z: 0 };

/** Advance the simulation by dt (s), in fixed substeps; `events` lists what happened. */
export function step(sim: Sim, dt: number): void {
  sim.nEvents = 0;
  sim.acc = Math.min(sim.acc + dt, 0.1);
  const h = PHYSICS.substep;
  while (sim.acc >= h) {
    sim.acc -= h;
    substep(sim, h);
  }
}

/**
 * Move the puck on by dt (s) with only the rails and its drag, the mallets left
 * where they are: brings a puck reported a moment ago up to now.
 */
export function coast(sim: Sim, dt: number): void {
  const h = PHYSICS.substep;
  const p = sim.puck;
  const k = Math.exp(-(sim.air ? PHYSICS.puckDrag : PHYSICS.stillDrag) * h);
  for (let t = 0; t < dt && sim.live; t += h) {
    p.x += p.vx * h;
    p.z += p.vz * h;
    walls(sim);
    p.vx *= k;
    p.vz *= k;
    if (Math.abs(p.x) > sim.spec.hx + sim.spec.puckR) {
      sim.live = false;
      sim.scored = p.x < 0 ? 1 : 2;
    }
  }
}

// a mallet's place at the start of the substep
const m0x = [0, 0];
const m0z = [0, 0];

function substep(sim: Sim, h: number): void {
  const { spec, puck: p } = sim;
  const { malletR: R, puckR: r } = spec;
  // the mallets sweep towards their targets, no faster than a hand
  for (const i of [0, 1] as const) {
    const m = sim.mallets[i];
    const t = sim.targets[i];
    m0x[i] = m.x;
    m0z[i] = m.z;
    clampMallet(spec, i, t.x, t.z, tmp);
    let vx = (tmp.x - m.x) / PHYSICS.malletLag;
    let vz = (tmp.z - m.z) / PHYSICS.malletLag;
    const sp = Math.hypot(vx, vz);
    const max = sim.malletMax[i];
    if (sp > max) {
      vx *= max / sp;
      vz *= max / sp;
    }
    clampMallet(spec, i, m.x + vx * h, m.z + vz * h, tmp);
    m.vx = (tmp.x - m.x) / h;
    m.vz = (tmp.z - m.z) / h;
    m.x = tmp.x;
    m.z = tmp.z;
  }
  if (!sim.live) return;
  // the puck glides; where it meets a mallet within the substep, it is struck there
  let x0 = p.x;
  let z0 = p.z;
  let remain = 1;
  for (let pass = 0; pass < 3 && remain > 0; pass++) {
    const x1 = x0 + p.vx * h * remain;
    const z1 = z0 + p.vz * h * remain;
    let first = 2;
    let who = -1;
    for (const i of [0, 1]) {
      const m = sim.mallets[i];
      // the mallet's place at the start of what is left of the substep, and its end
      const ma = 1 - remain;
      const mx0 = m0x[i] + (m.x - m0x[i]) * ma;
      const mz0 = m0z[i] + (m.z - m0z[i]) * ma;
      const dx0 = x0 - mx0;
      const dz0 = z0 - mz0;
      const ddx = x1 - m.x - dx0;
      const ddz = z1 - m.z - dz0;
      const rr = R + r;
      const c = dx0 * dx0 + dz0 * dz0 - rr * rr;
      let t: number;
      if (c <= 0) t = 0;
      else {
        const a = ddx * ddx + ddz * ddz;
        const b = 2 * (dx0 * ddx + dz0 * ddz);
        const disc = b * b - 4 * a * c;
        if (a < 1e-12 || b >= 0 || disc < 0) continue;
        t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t > 1) continue;
      }
      if (t < first) {
        first = t;
        who = i;
      }
    }
    if (who < 0) {
      x0 = x1;
      z0 = z1;
      break;
    }
    // the contact: both where they meet, the puck bounced off the moving mallet
    const m = sim.mallets[who];
    const ma = 1 - remain + remain * first;
    const mx = m0x[who] + (m.x - m0x[who]) * ma;
    const mz = m0z[who] + (m.z - m0z[who]) * ma;
    let px = x0 + (x1 - x0) * first;
    let pz = z0 + (z1 - z0) * first;
    let nx = px - mx;
    let nz = pz - mz;
    const d = Math.hypot(nx, nz) || 1;
    nx /= d;
    nz /= d;
    px = mx + nx * (R + r + 1e-5);
    pz = mz + nz * (R + r + 1e-5);
    const vn = (p.vx - m.vx) * nx + (p.vz - m.vz) * nz;
    if (vn < 0) {
      p.vx -= (1 + PHYSICS.malletBounce) * vn * nx;
      p.vz -= (1 + PHYSICS.malletBounce) * vn * nz;
      event(sim, "mallet", -vn, who);
    }
    x0 = px;
    z0 = pz;
    remain *= 1 - first;
    if (first === 0) remain = Math.max(0, remain - 0.34);
  }
  p.x = x0;
  p.z = z0;
  walls(sim);
  // a mallet can't push the puck through a rail: a puck pinned against one pushes the mallet back
  for (const i of [0, 1] as const) {
    const m = sim.mallets[i];
    const dx = m.x - p.x;
    const dz = m.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < R + r && d > 1e-9) {
      clampMallet(spec, i, p.x + (dx / d) * (R + r), p.z + (dz / d) * (R + r), tmp);
      m.x = tmp.x;
      m.z = tmp.z;
    }
  }
  // the air cushion's faint drag, and the top speed
  const k = Math.exp(-(sim.air ? PHYSICS.puckDrag : PHYSICS.stillDrag) * h);
  p.vx *= k;
  p.vz *= k;
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > PHYSICS.puckMax) {
    p.vx *= PHYSICS.puckMax / sp;
    p.vz *= PHYSICS.puckMax / sp;
  }
  // a goal: the puck wholly past the end of the playfield, in the mouth
  if (Math.abs(p.x) > spec.hx + r) {
    sim.live = false;
    sim.scored = p.x < 0 ? 1 : 2;
    event(sim, "goal", sim.scored);
  }
}

/** Bounce the puck off a surface with outward normal (nx, nz) it has pressed into. */
function bounce(sim: Sim, nx: number, nz: number, kind: "rail" | "post") {
  const p = sim.puck;
  const vn = p.vx * nx + p.vz * nz;
  if (vn >= 0) return;
  const tx = p.vx - vn * nx;
  const tz = p.vz - vn * nz;
  p.vx = tx * PHYSICS.railGrip - vn * PHYSICS.railBounce * nx;
  p.vz = tz * PHYSICS.railGrip - vn * PHYSICS.railBounce * nz;
  if (-vn > 0.05) event(sim, kind, -vn);
}

/** Keep the puck on the table: the side rails, the rounded corners, the end rails, the goal posts and the mouths. */
function walls(sim: Sim): void {
  const { hx, hz, goalHalf: g, cornerR: Rc, puckR: r } = sim.spec;
  const p = sim.puck;
  // the corners
  const cx = hx - Rc;
  const cz = hz - Rc;
  if (Math.abs(p.x) > cx && Math.abs(p.z) > cz) {
    const sx = Math.sign(p.x);
    const sz = Math.sign(p.z);
    const dx = Math.abs(p.x) - cx;
    const dz = Math.abs(p.z) - cz;
    const d = Math.hypot(dx, dz);
    if (d > Rc - r) {
      p.x = sx * (cx + (dx / d) * (Rc - r));
      p.z = sz * (cz + (dz / d) * (Rc - r));
      bounce(sim, -sx * (dx / d), -sz * (dz / d), "rail");
    }
  }
  // the side rails
  if (p.z > hz - r) {
    p.z = hz - r;
    bounce(sim, 0, -1, "rail");
  } else if (p.z < -(hz - r)) {
    p.z = -(hz - r);
    bounce(sim, 0, 1, "rail");
  }
  const s = Math.sign(p.x) || 1;
  const ax = Math.abs(p.x);
  if (ax <= hx) {
    if (Math.abs(p.z) >= g) {
      // the end rail beside the goal
      if (ax > hx - r) {
        p.x = s * (hx - r);
        bounce(sim, -s, 0, "rail");
      }
    } else {
      // a goal post: the corner where the mouth meets the end rail
      const pz = Math.sign(p.z) * g || g;
      const dx = p.x - s * hx;
      const dz = p.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-9) {
        p.x = s * hx + (dx / d) * r;
        p.z = pz + (dz / d) * r;
        bounce(sim, dx / d, dz / d, "post");
      }
    }
  } else {
    // in the mouth: its sides
    if (p.z > g - r) {
      p.z = g - r;
      bounce(sim, 0, -1, "post");
    } else if (p.z < -(g - r)) {
      p.z = -(g - r);
      bounce(sim, 0, 1, "post");
    }
  }
}

// ------------------------------------------------------------------ the robot

/** What the robot remembers between its looks at the table. */
export interface RobotMind {
  /** when it next looks (s, the simulation's clock) */
  next: number;
  /** where it is aiming its next shot (z at the far goal; a bank shot aims past a side rail) */
  aimZ: number;
  /** where it decided to go at its last look */
  tx: number;
  tz: number;
  /** "home", "defend", "line up", "strike", "around" */
  plan: string;
}

export const ROBOT = {
  /** how often it looks at the table (s): it reacts, it doesn't foresee */
  look: 0.075,
  /** its top speed (m/s): a little slower than a player's hand */
  speed: 5.1,
  /** how far off its aim and its guesses are (m) */
  aimError: 0.07,
  guessError: 0.05,
  /** how far past the puck it drives through on a strike (m) */
  follow: 0.16,
};

export function makeRobot(): RobotMind {
  return { next: 0, aimZ: 0, tx: 0, tz: 0, plan: "home" };
}

/** Where the puck crosses x = atX, bouncing off the side rails, or NaN if it is moving away or too slowly. */
export function predictZ(spec: TableSpec, p: Body, atX: number): number {
  if (Math.abs(p.vx) < 0.05) return NaN;
  const t = (atX - p.x) / p.vx;
  if (t < 0) return NaN;
  const lim = spec.hz - spec.puckR;
  // unfold the bounces off the side rails
  let z = p.z + p.vz * t + lim;
  const span = 4 * lim;
  z = ((z % span) + span) % span;
  return z <= 2 * lim ? z - lim : 3 * lim - z;
}

/**
 * The robot's move for mallet i (it plays end i + 1): it guards its goal, lines up
 * behind a puck in its half and strikes it at the far goal (now and then off a
 * side rail), and goes back to guard when the puck is away. `now` is the
 * simulation's clock (s), `rand` a source of 0..1. Sets the mallet's target.
 */
export function robotMove(sim: Sim, i: 0 | 1, mind: RobotMind, now: number, rand: () => number): void {
  const { spec, puck: p } = sim;
  const { hx, hz, goalHalf: g, puckR: r, malletR: R } = spec;
  const m = sim.mallets[i];
  const s = i === 0 ? -1 : 1;
  const target = sim.targets[i];
  sim.malletMax[i] = ROBOT.speed;
  if (now < mind.next) {
    // between looks, keep driving at the spot chosen (a strike follows the puck it chose)
    target.x = mind.tx;
    target.z = mind.tz;
    return;
  }
  mind.next = now + ROBOT.look * (0.8 + rand() * 0.5);
  const homeX = s * (hx - 0.17);
  const jitter = () => (rand() - 0.5) * 2;
  const inHalf = s * p.x > -0.02;
  const towards = s * p.vx;
  const speed = Math.hypot(p.vx, p.vz);
  let tx = homeX;
  let tz = 0;
  if (!sim.live) {
    mind.plan = "home";
    tz = 0;
  } else if (towards > 0.4 && (!inHalf || towards > 2.2)) {
    // the puck is coming: get between it and the goal, where it will cross
    mind.plan = "defend";
    const z = predictZ(spec, p, homeX);
    tz = Number.isNaN(z) ? p.z * 0.5 : Math.max(-g * 1.3, Math.min(g * 1.3, z + jitter() * ROBOT.guessError));
    // come out to meet a slow one
    if (towards < 2.5 && inHalf) tx = s * Math.max(R, s * p.x + (R + r) * 0.8);
    mind.aimZ = (rand() - 0.5) * g * 1.2;
  } else if (inHalf && (towards <= 0.4 || speed < 1.2)) {
    // the puck is in its half: line up behind it towards the aim, then drive through it
    if (rand() < 0.012) mind.aimZ = (rand() < 0.5 ? -1 : 1) * (2 * (hz - r) - Math.abs(mind.aimZ)); // a bank shot
    const ax = -s * hx;
    const az = mind.aimZ + jitter() * ROBOT.aimError;
    let dx = ax - p.x;
    let dz = az - p.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const behindX = p.x - dx * (R + r + 0.035);
    const behindZ = p.z - dz * (R + r + 0.035);
    // how far the mallet is behind the puck along the shot, and off its line
    const along = (m.x - p.x) * dx + (m.z - p.z) * dz;
    const off = Math.abs((m.x - p.x) * -dz + (m.z - p.z) * dx);
    if (along < -(R + r) * 0.6 && off < R * 0.7) {
      mind.plan = "strike";
      tx = p.x + dx * ROBOT.follow;
      tz = p.z + dz * ROBOT.follow;
    } else if (s * m.x < s * p.x - 0.02 && Math.abs(m.z - p.z) < R + r + 0.02) {
      // the puck is behind the mallet (between it and its own goal): go round it, not through it
      mind.plan = "around";
      tx = m.x;
      tz = p.z + (m.z >= p.z ? 1 : -1) * (R + r + 0.07);
    } else {
      mind.plan = "line up";
      tx = behindX;
      tz = behindZ;
    }
  } else {
    // the puck is in the other half: guard, leaning towards it
    mind.plan = "home";
    tz = Math.max(-g, Math.min(g, p.z * 0.4));
  }
  mind.tx = tx;
  mind.tz = tz;
  target.x = tx;
  target.z = tz;
}

// ------------------------------------------------------------------ the match

/** First to this many goals wins, as arcade tables play. */
export const WIN_SCORE = 7;

/** The winner (1 or 2) of a match at this score, or 0 while it goes on. */
export function winner(score: [number, number]): 0 | 1 | 2 {
  return score[0] >= WIN_SCORE ? 1 : score[1] >= WIN_SCORE ? 2 : 0;
}
