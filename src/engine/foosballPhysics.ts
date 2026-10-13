// The foosball's physics, as pure functions (no Babylon), in the table's frame
// (world/props/foosballSpec.ts): the ball rolls on the playfield, rebounds off the
// walls, the goal posts and the men, rolls back out of the raised corners, and
// drops into a goal. The rods are driven from outside (a player's hand, the
// robot): they push the ball and are never pushed back, as a hand on a real rod.
//
// Each man is a rounded slab hanging from his rod: a segment in the plane across
// the rod, from his head above it to his toe below, as thick as his body and as
// wide as his legs along the rod. Where he meets the ball, the ball takes his
// surface's speed there (the rod's spin, and its slide) with some bounce; a man
// coming down on top of the ball presses it into the field and squeezes it out
// forward, or traps it.
//
// Steps are fixed (STEP) and short enough that nothing moves more than a few
// millimetres in one, well under the ball's radius, so the ball can't pass
// through a man or a wall however hard it is kicked: `advance` takes as many
// steps as the time needs, more while things move fast.

import { BALL_R, FIELD, GOAL, MAN, ROD_Y, RODS, Team, manZ } from "../world/props/foosballSpec";

/** A rod as the physics sees it: its slide along Z and turn about Z (+ swings the toes towards +X), and how fast each is changing. */
export interface RodPose {
  slide: number;
  turn: number;
  slideV: number;
  turnV: number;
}

export interface BallState {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/**
 * What happened in a step. A man's strike carries its details: the push across the table
 * (the contact's normal, from the man to the ball, and its height part), the rod's turn and
 * spin then, and the ball's velocity before and after.
 */
export type ManHit = { kind: "man"; rod: number; speed: number; nx: number; nz: number; ny: number; turn: number; turnV: number; before: [number, number]; after: [number, number] };
export type PhysicsEvent = ManHit | { kind: "wall"; speed: number } | { kind: "goal"; into: Team };

/** The physics' tuning, in SI units. */
export const PHYS = {
  /** fixed step (s) */
  step: 1 / 960,
  /** the most a ball or a man's surface may travel relative to the other in one step (m) */
  maxTravel: 0.008,
  /** rolling resistance (m/s²) and air and felt drag (1/s) */
  roll: 0.16,
  drag: 0.07,
  /** bounce off the walls and off the men, and the scuff along a wall */
  wallBounce: 0.7,
  wallScuff: 0.96,
  manBounce: 0.5,
  /** grip between a man's foot and the ball he presses down on */
  manGrip: 0.35,
  /** how much of a rod's slide a struck ball takes with it: sliding as you kick angles the shot */
  manScuff: 0.3,
  /** the fastest a ball can go (m/s): a hard shot */
  maxSpeed: 8.5,
  /** the corner ramps: the size of their legs (m), and the pull down them (m/s²) */
  rampLeg: 0.05,
  rampPull: 2.6,
  /** the goal mouth's corners are rounded this much (m) */
  postR: 0.004,
};

const HL = FIELD.length / 2;
const HW = FIELD.width / 2;
/** the ball's centre above the field, under the rods' axes */
const DROP = ROD_Y - BALL_R;
/** the men's reach in X from their rod: beyond it, a rod can't touch the ball */
const REACH = MAN.toe + MAN.thick + BALL_R;

export function newBall(x = 0, z = 0, vx = 0, vz = 0): BallState {
  return { x, z, vx, vz };
}

export function restPose(): RodPose {
  return { slide: 0, turn: 0, slideV: 0, turnV: 0 };
}

/**
 * Advance the ball by `dt` seconds with the rods where `rodsAt(t)` puts them, t
 * running from 0 to dt (so a rod's motion through a frame is followed step by
 * step). Pushes what happened to `events`. Returns false once the ball has gone
 * into a goal (and is left where it went in).
 */
export function advance(ball: BallState, dt: number, rodsAt: (t: number, out: RodPose[]) => void, rods: RodPose[], events: PhysicsEvent[]): boolean {
  let t = 0;
  while (t < dt - 1e-9) {
    rodsAt(t, rods);
    // shorter steps while things move fast, so nothing moves more than maxTravel in one
    let fast = Math.hypot(ball.vx, ball.vz);
    for (const r of rods) fast = Math.max(fast, Math.abs(r.slideV) + Math.abs(r.turnV) * (MAN.toe + MAN.thick));
    const h = Math.min(PHYS.step, PHYS.maxTravel / Math.max(1e-6, fast * 2), dt - t);
    if (!stepBall(ball, h, rods, events)) return false;
    t += h;
  }
  return true;
}

/** One step of the ball: roll, the men, the walls, the corners, the goals. False once it has gone in. */
export function stepBall(ball: BallState, h: number, rods: RodPose[], events: PhysicsEvent[]): boolean {
  // rolling: resistance and drag
  const v = Math.hypot(ball.vx, ball.vz);
  if (v > 0) {
    const nv = Math.max(0, v - PHYS.roll * h) * (1 - PHYS.drag * h);
    ball.vx *= nv / v;
    ball.vz *= nv / v;
  }
  // the raised corners: a ball on a ramp rolls down it, back towards the field
  const cx = HL - Math.abs(ball.x);
  const cz = HW - Math.abs(ball.z);
  if (cx + cz < PHYS.rampLeg) {
    const k = PHYS.rampPull * h * Math.SQRT1_2;
    ball.vx -= Math.sign(ball.x) * k;
    ball.vz -= Math.sign(ball.z) * k;
  }
  ball.x += ball.vx * h;
  ball.z += ball.vz * h;

  for (let i = 0; i < RODS.length; i++) if (Math.abs(ball.x - RODS[i].x) < REACH) hitMen(ball, i, rods[i], events);
  if (!walls(ball, events)) return false;
  const s = Math.hypot(ball.vx, ball.vz);
  if (s > PHYS.maxSpeed) {
    ball.vx *= PHYS.maxSpeed / s;
    ball.vz *= PHYS.maxSpeed / s;
  }
  return true;
}

/** The ball against rod i's men. */
function hitMen(ball: BallState, i: number, pose: RodPose, events: PhysicsEvent[]): void {
  const rod = RODS[i];
  // the men hang along (sin turn, -cos turn) in the rod's plane; the ball's centre is DROP below the axis
  const sx = Math.sin(pose.turn);
  const sy = -Math.cos(pose.turn);
  const dx = ball.x - rod.x;
  const dy = -DROP;
  // the nearest point on the man's line (from his head, behind the axis, to his toe)
  const along = Math.max(-MAN.head, Math.min(MAN.toe, dx * sx + dy * sy));
  const px = dx - along * sx;
  const py = dy - along * sy;
  const reach = BALL_R + MAN.thick;
  if (px * px + py * py >= reach * reach) return;
  for (let k = 0; k < rod.men; k++) {
    const dz = ball.z - (manZ(rod, k) + pose.slide);
    const ez = Math.abs(dz) - MAN.halfWidth;
    const qz = ez > 0 ? Math.sign(dz) * ez : 0;
    const d2 = px * px + py * py + qz * qz;
    if (d2 >= reach * reach) continue;
    const d = Math.sqrt(d2) || 1e-6;
    let nx = px / d;
    const ny = py / d;
    let nz = qz / d;
    // the man's surface where it meets the ball: the rod's spin about its axis, and its slide
    const cyp = py - ny * MAN.thick + along * sy;
    const ux = -pose.turnV * cyp;
    const uz = pose.slideV;
    // the field takes whatever presses the ball down: only the push across it counts
    let nh = Math.hypot(nx, nz);
    if (nh < 0.25) {
      // squarely on top: the ball squeezes out the way the foot is going
      const dir = Math.sign(ux) || Math.sign(dx) || 1;
      nx = dir * 0.25;
      nz = 0;
      nh = 0.25;
    }
    const hx = nx / nh;
    const hz = nz / nh;
    const rvx = ball.vx - ux;
    const rvz = ball.vz - uz;
    const vn = rvx * hx + rvz * hz;
    if (vn < 0) {
      const bx = ball.vx;
      const bz = ball.vz;
      // bounce, weaker the more the man comes down on top of the ball
      const j = -(1 + PHYS.manBounce) * vn * nh;
      ball.vx += j * hx;
      ball.vz += j * hz;
      // the foot's slide across the table scuffs the ball sideways
      ball.vz += (uz - ball.vz) * PHYS.manScuff * Math.abs(hx);
      // and grip: pressed down, the ball is dragged along with the foot
      const grip = PHYS.manGrip * Math.max(0, -ny);
      const tx = ball.vx - ux;
      const tz = ball.vz - uz;
      ball.vx -= tx * grip;
      ball.vz -= tz * grip;
      const speed = Math.abs(vn);
      if (speed > 0.05) events.push({ kind: "man", rod: i, speed, nx: hx * nh, nz: hz * nh, ny, turn: pose.turn, turnV: pose.turnV, before: [bx, bz], after: [ball.vx, ball.vz] });
    }
    // out of the man, across the field
    const pen = reach - d;
    const push = Math.min(0.01, pen / nh);
    ball.x += hx * push;
    ball.z += hz * push;
  }
}

/** The walls, the goal mouths' corners and the goals. False once the ball has gone in. */
function walls(ball: BallState, events: PhysicsEvent[]): boolean {
  const r = BALL_R;
  // the side walls
  if (Math.abs(ball.z) > HW - r) {
    const s = Math.sign(ball.z);
    ball.z = s * (HW - r);
    if (ball.vz * s > 0) {
      if (Math.abs(ball.vz) > 0.2) events.push({ kind: "wall", speed: Math.abs(ball.vz) });
      ball.vz = -ball.vz * PHYS.wallBounce;
      ball.vx *= PHYS.wallScuff;
    }
  }
  const sx = Math.sign(ball.x) || 1;
  const inMouth = Math.abs(ball.z) < GOAL.half;
  // the goal mouth's corners: the ball glances off them
  for (const sz of [-1, 1]) {
    const px = sx * HL;
    const pz = sz * GOAL.half;
    const dx = ball.x - px;
    const dz = ball.z - pz;
    const d = Math.hypot(dx, dz);
    const reach = r + PHYS.postR;
    if (d < reach && d > 1e-6 && (dx * sx > -r || Math.abs(ball.z) < GOAL.half)) {
      const nx = dx / d;
      const nz = dz / d;
      ball.x = px + nx * reach;
      ball.z = pz + nz * reach;
      const vn = ball.vx * nx + ball.vz * nz;
      if (vn < 0) {
        if (-vn > 0.2) events.push({ kind: "wall", speed: -vn });
        ball.vx -= (1 + PHYS.wallBounce) * vn * nx;
        ball.vz -= (1 + PHYS.wallBounce) * vn * nz;
      }
    }
  }
  if (!inMouth || Math.abs(ball.x) < HL) {
    // the end walls, either side of the mouth
    if (Math.abs(ball.x) > HL - r && !(Math.abs(ball.z) < GOAL.half - PHYS.postR)) {
      if (Math.abs(ball.x) < HL + r * 0.5) {
        ball.x = sx * (HL - r);
        if (ball.vx * sx > 0) {
          if (Math.abs(ball.vx) > 0.2) events.push({ kind: "wall", speed: Math.abs(ball.vx) });
          ball.vx = -ball.vx * PHYS.wallBounce;
          ball.vz *= PHYS.wallScuff;
        }
      }
    }
    return true;
  }
  // in the mouth: the goal box's sides keep it in line, and once its centre is past the line it's in
  if (Math.abs(ball.z) > GOAL.half - r) {
    const s = Math.sign(ball.z);
    ball.z = s * (GOAL.half - r);
    if (ball.vz * s > 0) ball.vz = -ball.vz * PHYS.wallBounce;
  }
  if (Math.abs(ball.x) > HL + r) {
    events.push({ kind: "goal", into: sx < 0 ? "red" : "blue" });
    return false;
  }
  return true;
}

/** Where a man's toe is, in the table's frame (x, height above the field), for rod i turned `turn`. */
export function toeAt(i: number, turn: number): { x: number; y: number } {
  return { x: RODS[i].x + Math.sin(turn) * MAN.toe, y: ROD_Y - Math.cos(turn) * MAN.toe };
}

/**
 * The slide that puts one of rod i's men at `z` across the table (as near as its
 * travel lets it), keeping man `prefer` while he can reach it. Returns the slide
 * and which man.
 */
export function slideFor(i: number, z: number, prefer = -1): { slide: number; man: number } {
  const rod = RODS[i];
  let best = { slide: 0, man: 0 };
  let bestMiss = Infinity;
  for (let k = 0; k < rod.men; k++) {
    const want = z - manZ(rod, k);
    const slide = Math.max(-rod.travel, Math.min(rod.travel, want));
    // a small bias for the man already in use, so the rod doesn't hop between two that both reach
    const miss = Math.abs(want - slide) + (k === prefer ? 0 : 0.004) + Math.abs(want) * 1e-3;
    if (miss < bestMiss) {
      bestMiss = miss;
      best = { slide, man: k };
    }
  }
  return best;
}

/** How fast a hand can move a rod: top slide speed (m/s) and turn speed (rad/s). */
export interface Hand {
  slideSpeed: number;
  turnSpeed: number;
}

/** A visitor's hand: quick. */
export const PLAYER_HAND: Hand = { slideSpeed: 3, turnSpeed: 75 };

/**
 * Move rod i towards a target slide and turn over dt, as a hand does: it closes
 * most of the gap in a few hundredths of a second, no faster than `hand` allows,
 * and the bumpers stop the slide at the ends of its travel. Sets the pose's
 * speeds to what it did, which is what a man hits the ball with.
 */
export function driveRod(i: number, pose: RodPose, slide: number, turn: number, dt: number, hand: Hand): void {
  if (dt <= 0) return;
  const travel = RODS[i].travel;
  const want = Math.max(-travel, Math.min(travel, slide));
  const k = 1 - Math.exp(-dt / 0.03);
  const ds = Math.max(-hand.slideSpeed * dt, Math.min(hand.slideSpeed * dt, (want - pose.slide) * k));
  const kt = 1 - Math.exp(-dt / 0.018);
  const dt2 = Math.max(-hand.turnSpeed * dt, Math.min(hand.turnSpeed * dt, (turn - pose.turn) * kt));
  pose.slide += ds;
  pose.turn += dt2;
  pose.slideV = ds / dt;
  pose.turnV = dt2 / dt;
}

/** A turn of the same rod with its men pointing the way `base` does, nearest to `cur`. */
export const nearestTurn = (cur: number, base: number): number => base + 2 * Math.PI * Math.round((cur - base) / (2 * Math.PI));

/**
 * The player's hands: the turn a pixel of sideways mouse movement gives the lit rod (rad), how
 * quickly a rod settles back with its men hanging down (s), and how long without sideways
 * movement counts as the mouse having stopped (ms).
 */
export const HAND = { flick: 0.0115, settle: 0.09, stillMs: 60 };

/**
 * One frame of a player's rod's turn, as the team sees it (+ swings the toes towards the goal it
 * attacks): the lit rod turned by the mouse's sideways movement this frame, and a rod that isn't
 * being flicked settling back to its nearest hanging-down turn.
 */
export function handTurn(forward: number, lit: boolean, flickPx: number, still: boolean, dt: number): number {
  if (lit) forward += flickPx * HAND.flick;
  if (!lit || still) forward += (nearestTurn(forward, 0) - forward) * (1 - Math.exp(-dt / HAND.settle));
  return forward;
}
