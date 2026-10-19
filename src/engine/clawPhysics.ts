// The claw machine's prizes as bodies: pure physics, no Babylon, so it can be
// tested on its own (tools/test-claw.mjs runs it in the page).
//
// Each prize is a rigid cluster of spheres ("particles") moved by position-based
// dynamics: gravity, then constraints solved a few times per substep (the
// machine's walls, floor, chute guard and shaft; the other prizes; the claw's
// head and prongs, which push them), then shape matching pulls each cluster back
// to its rigid shape, which gives it its turn. Velocity is how far a particle
// moved, so contacts are soft and dead like plush, with Coulomb friction on
// every contact. Bodies that come to rest sleep until something wakes them, so a
// settled pile costs nothing.
//
// Only overlap made by a substep's own motion is undone at once (that is a contact
// stopping a body). Overlap a body already had (prizes dropped in on top of each
// other, a prize let go inside the prongs) is eased out a little at the start of each
// substep, before the substep's motion begins, the whole body moved as one, so it
// separates without being given the speed of the push: PBD turns every push into
// velocity, and a centimetre pushed out in one substep is a prize flung at metres a
// second. No prize moves faster than a plush toy can (MAX_* below) whatever happens.
//
// Everything is in the machine's own frame (metres; base at y 0, front -Z) as
// its ClawSpec gives it. A body held by the claw is moved by the claw (setHeld);
// letting go hands it back to gravity with the speed it had.

/** The inside of the machine (props/clawMachine.ts ClawSpec, carried on its root node). */
export interface ClawBox {
  bedY: number;
  bed: [number, number, number, number];
  chute: [number, number, number, number];
  guardH: number;
  binY: number;
  doorZ: number;
}

export type PrizeKind = "chimp" | "pinkChimp" | "banana" | "coconut" | "star" | "king";

/** A prize's body: its spheres in its own frame (x, y, z, r), how heavy it is and how well a claw holds it. */
export interface PrizeShape {
  spheres: [number, number, number, number][];
  /** kg, for the claw's grip */
  mass: number;
  /** 0..1: how well prongs catch it (a chimp's neck and arms catch; a ball slips) */
  catch: number;
}

const chimpSpheres = (s: number): [number, number, number, number][] =>
  (
    [
      [0, 0.07, 0.005, 0.066],
      [0, 0.168, -0.004, 0.058],
      [-0.045, 0.026, -0.078, 0.024],
      [0.045, 0.026, -0.078, 0.024],
      // the legs' tops and middles, joining the feet to the body all the way (with a gap anywhere along a leg, the
      // guard's thin wall could slip into it, and the chimp hang on the guard by its foot)
      [-0.024, 0.046, -0.04, 0.028],
      [0.024, 0.046, -0.04, 0.028],
      [-0.035, 0.036, -0.059, 0.026],
      [0.035, 0.036, -0.059, 0.026],
    ] as [number, number, number, number][]
  ).map(([x, y, z, r]) => [x * s, y * s, z * s, r * s]);

const bananaSpheres = (): [number, number, number, number][] =>
  [0.1, 0.3, 0.5, 0.7, 0.9].map((u) => {
    const t = -0.95 + u * 1.9;
    return [Math.sin(t) * 0.13, 0.11 - Math.cos(t) * 0.11 + 0.035, 0, 0.036 * Math.sin(Math.PI * (0.06 + u * 0.88)) + 0.004];
  });

const starSpheres = (): [number, number, number, number][] => {
  const out: [number, number, number, number][] = [[0, 0.03, 0, 0.032]];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    out.push([Math.cos(a) * 0.072, 0.03, Math.sin(a) * 0.072, 0.024]);
    // and its middle, so the arm is whole: the guard's thin wall can't slip between an arm's tip and the star
    out.push([Math.cos(a) * 0.04, 0.03, Math.sin(a) * 0.04, 0.026]);
  }
  return out;
};

export const PRIZES: Record<PrizeKind, PrizeShape> = {
  chimp: { spheres: chimpSpheres(1), mass: 0.12, catch: 0.92 },
  pinkChimp: { spheres: chimpSpheres(1), mass: 0.12, catch: 0.92 },
  banana: { spheres: bananaSpheres(), mass: 0.1, catch: 0.7 },
  coconut: { spheres: [[0, 0.064, 0, 0.064]], mass: 0.14, catch: 0.5 },
  star: { spheres: starSpheres(), mass: 0.09, catch: 0.62 },
  king: { spheres: chimpSpheres(1.42), mass: 0.34, catch: 0.85 },
};

/** A capsule the claw pushes prizes with: from a to b, radius r. */
export interface Capsule {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
}

export const capsule = (): Capsule => ({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0 });

const G = -9.81;
/** the fixed substep (s) and the constraint passes in each */
const H = 1 / 240;
const ITERS = 3;
/** friction on the felt, the glass, and plush on plush */
const MU_FLOOR = 0.75;
const MU_WALL = 0.3;
const MU_PLUSH = 0.6;
/** how still (m/s) and for how long (s) a body must be to sleep */
const SLEEP_V = 0.035;
const SLEEP_T = 0.35;
const CREEP_V = 0.12;
const CREEP_T = 2;
/** overlap a body already had is eased out by at most this much a substep (m): about 0.15 m/s */
const EASE = 0.0006;
/** and the solve takes back at most this much of it per pass (m), so what its passes leave can't build up; that too moves it without speed */
const CREEP_OUT = 0.0002;
/** overlap left under this (m) is let be: a resting pile always presses in a little, and easing it would keep the pile from sleeping */
const SLOP = 0.0005;
/** the chute guard's walls' half thickness (m), the radius of the tube along their top; and how steeply that rim tips a prize off it at the least (sideways per up) */
const GUARD_T = 0.004;
const RIM_TIP = 0.45;
/** how far clear of the guard a freshly stocked pile keeps (m) */
const GUARD_CLEAR = 0.03;
/** how far below the bed a prize's centre has gone down the chute when it counts as won (m) */
export const CHUTE_DOWN = 0.08;
/**
 * A prize longer than the hole is wide (the king lying across it, its feet on the glass and its neck
 * hooked on the rim) can't fall in as a rigid body: a plush one squashes past the rim and folds in.
 * After SAG_T s in the chute's mouth, the guard only keeps it in (it is let past it into the chute,
 * never back out), and it turns toward fitting at SAG_SPIN rad/s: its longest way toward upright,
 * its widest way across toward the hole's diagonal.
 */
const SAG_T = 0.4;
const SAG_SPIN = 1.5;
/** the fastest a prize's centre goes (m/s): across, and up; and falling (down the shaft) */
const MAX_ACROSS = 1.0;
const MAX_UP = 0.8;
const MAX_FALL = 6;
/** and the fastest any part of it turns about its centre (m/s): a chimp toppling over swings its head about this fast */
const MAX_SPIN = 1.5;

/** Rotate (x, y, z) by quaternion q (x, y, z, w) into out[o..o+2]. */
function rot(q: Float64Array, qo: number, x: number, y: number, z: number, out: Float64Array, o: number) {
  const qx = q[qo];
  const qy = q[qo + 1];
  const qz = q[qo + 2];
  const qw = q[qo + 3];
  // t = 2 q.xyz × v; v' = v + w t + q.xyz × t
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[o] = x + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/** q = (axis-angle rotation of vector w, |w| radians) * q, normalised. */
function turn(q: Float64Array, o: number, wx: number, wy: number, wz: number) {
  const a = Math.hypot(wx, wy, wz);
  if (a < 1e-12) return;
  const s = Math.sin(a / 2) / a;
  const rx = wx * s;
  const ry = wy * s;
  const rz = wz * s;
  const rw = Math.cos(a / 2);
  const x = q[o];
  const y = q[o + 1];
  const z = q[o + 2];
  const w = q[o + 3];
  const nx = rw * x + rx * w + ry * z - rz * y;
  const ny = rw * y - rx * z + ry * w + rz * x;
  const nz = rw * z + rx * y - ry * x + rz * w;
  const nw = rw * w - rx * x - ry * y - rz * z;
  const l = Math.hypot(nx, ny, nz, nw) || 1;
  q[o] = nx / l;
  q[o + 1] = ny / l;
  q[o + 2] = nz / l;
  q[o + 3] = nw / l;
}

/** The prizes in a machine, and stepping them. */
export class PrizeWorld {
  readonly kinds: PrizeKind[] = [];
  /** per body: first particle, centre of mass (rest frame), pose (com xyz, quaternion xyzw) */
  private start: number[] = [0];
  private restCom: number[] = [];
  pose = new Float64Array(0);
  /** per body: 0 awake, 1 asleep; seconds still; held by the claw; out of play (won and taken) */
  private sleeping = new Uint8Array(0);
  private still = new Float64Array(0);
  held = -1;
  private gone = new Uint8Array(0);
  /** per particle: position, position before this substep, velocity, radius, rest offset from the com, body, mass */
  private p = new Float64Array(0);
  private prev = new Float64Array(0);
  private v = new Float64Array(0);
  private r = new Float64Array(0);
  private rest = new Float64Array(0);
  private body = new Uint16Array(0);
  private w = new Float64Array(0);
  /** per body: bounding radius about the com */
  private bound = new Float64Array(0);
  /** in the easing pass (old overlap eased out, no speed given), not the substep's solve */
  private easing = false;
  /** per body, in the easing pass: the most any of its spheres wants moving each way (+x, -x, +y, -y, +z, -z), by the other prizes and by the machine */
  private ease = new Float64Array(0);
  private easeWall = new Float64Array(0);
  private easingWall = false;
  /** per body: its centre and turn as this substep began, before easing (whether it is still is how far those moved) */
  private comStart = new Float64Array(0);
  private turnStart = new Float64Array(0);
  /** per body: how far the solve's creeping out of old overlap moved its centre this substep (not to become speed) */
  private crept = new Float64Array(0);
  /** per body: how long it has been in the chute's mouth (overChute); and its longest way, the two spheres furthest apart (-1 for a ball) */
  private mouthT = new Float64Array(0);
  private longEnds: number[] = [];
  private acc = 0;
  private tmp = new Float64Array(3);
  private sagQ = new Float64Array(4);
  /** per particle: how far sag() turned it this substep (not to become speed) */
  private sagMove = new Float64Array(0);
  /** the claw's capsules this step: the head, then each prong's two segments */
  readonly claw: Capsule[] = [];
  /** set by each step: how far the claw's capsules are left pressed into prizes once the pile has pushed back (m), and into which (-1 none) */
  clawPress = 0;
  clawOn = -1;
  /** per capsule: deepest push this step (m), and the body it touched */
  capPress: number[] = [];
  capBody: number[] = [];
  /** the held body's pose to follow (com xyz, quaternion xyzw), set by setHeld */
  private heldPose = new Float64Array(7);
  /**
   * The body just let go (or slipped), still in the prongs it was held in (-1 none): it drops out
   * of them as they open (they had dug into the plush, and would drag it or shoot it out), and
   * the head eases it out of the overlap it had there rather than shooting it out, still
   * stopping whatever new overlap the claw or its fall makes. So until it has fallen clear below
   * the claw, or come to rest.
   */
  loose = -1;
  /** per particle of the loose body: how far into the claw it was last substep */
  private clawHad = new Float64Array(0);

  constructor(readonly box: ClawBox) {}

  get count(): number {
    return this.kinds.length;
  }

  /** Add a prize at (x, y, z) turned by quaternion q; returns its index. */
  add(kind: PrizeKind, x: number, y: number, z: number, q: [number, number, number, number] = [0, 0, 0, 1]): number {
    const shape = PRIZES[kind];
    const b = this.kinds.length;
    this.kinds.push(kind);
    const n0 = this.start[b];
    const n = shape.spheres.length;
    this.start.push(n0 + n);
    // the rest frame's centre of mass, spheres weighted by volume
    let m = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const [sx, sy, sz, sr] of shape.spheres) {
      const wm = sr * sr * sr;
      m += wm;
      cx += sx * wm;
      cy += sy * wm;
      cz += sz * wm;
    }
    cx /= m;
    cy /= m;
    cz /= m;
    this.restCom.push(cx, cy, cz);
    const grow = (a: Float64Array, k: number) => {
      const out = new Float64Array(a.length + k);
      out.set(a);
      return out;
    };
    this.p = grow(this.p, n * 3);
    this.prev = grow(this.prev, n * 3);
    this.v = grow(this.v, n * 3);
    this.rest = grow(this.rest, n * 3);
    this.r = grow(this.r, n);
    this.w = grow(this.w, n);
    const bodyArr = new Uint16Array(this.body.length + n);
    bodyArr.set(this.body);
    this.body = bodyArr;
    this.pose = grow(this.pose, 7);
    this.bound = grow(this.bound, 1);
    this.ease = grow(this.ease, 6);
    this.easeWall = grow(this.easeWall, 6);
    this.comStart = grow(this.comStart, 3);
    this.turnStart = grow(this.turnStart, 4);
    this.crept = grow(this.crept, 3);
    this.mouthT = grow(this.mouthT, 1);
    this.clawHad = grow(this.clawHad, n);
    this.sagMove = grow(this.sagMove, n * 3);
    this.still = grow(this.still, 1);
    const s8 = new Uint8Array(b + 1);
    s8.set(this.sleeping);
    this.sleeping = s8;
    const g8 = new Uint8Array(b + 1);
    g8.set(this.gone);
    this.gone = g8;
    let bound = 0;
    shape.spheres.forEach(([sx, sy, sz, sr], i) => {
      const k = n0 + i;
      this.rest[k * 3] = sx - cx;
      this.rest[k * 3 + 1] = sy - cy;
      this.rest[k * 3 + 2] = sz - cz;
      this.r[k] = sr;
      this.w[k] = (sr * sr * sr) / m;
      this.body[k] = b;
      bound = Math.max(bound, Math.hypot(sx - cx, sy - cy, sz - cz) + sr);
    });
    this.bound[b] = bound;
    // its longest way: across its two spheres furthest apart, edge to edge
    let far = 0;
    let ends = [-1, -1];
    for (let i = n0; i < n0 + n; i++)
      for (let j = i + 1; j < n0 + n; j++) {
        const d = Math.hypot(this.rest[i * 3] - this.rest[j * 3], this.rest[i * 3 + 1] - this.rest[j * 3 + 1], this.rest[i * 3 + 2] - this.rest[j * 3 + 2]);
        if (d + this.r[i] + this.r[j] > far) {
          far = d + this.r[i] + this.r[j];
          ends = [i, j];
        }
      }
    this.longEnds.push(...ends);
    this.place(b, x, y, z, q);
    return b;
  }

  /** Put body b at com (x, y, z) turned by q, at rest and awake. */
  place(b: number, x: number, y: number, z: number, q: [number, number, number, number]): void {
    const o = b * 7;
    this.pose[o] = x;
    this.pose[o + 1] = y;
    this.pose[o + 2] = z;
    const l = Math.hypot(...q) || 1;
    for (let i = 0; i < 4; i++) this.pose[o + 3 + i] = q[i] / l;
    for (let k = this.start[b]; k < this.start[b + 1]; k++) {
      rot(this.pose, o + 3, this.rest[k * 3], this.rest[k * 3 + 1], this.rest[k * 3 + 2], this.p, k * 3);
      this.p[k * 3] += x;
      this.p[k * 3 + 1] += y;
      this.p[k * 3 + 2] += z;
      for (let j = 0; j < 3; j++) {
        this.prev[k * 3 + j] = this.p[k * 3 + j];
        this.v[k * 3 + j] = 0;
      }
    }
    this.gone[b] = 0;
    this.mouthT[b] = 0;
    this.wake(b);
  }

  /** The rest frame's centre of mass of body b (where its mesh's origin is relative to its com). */
  restCentre(b: number): [number, number, number] {
    return [this.restCom[b * 3], this.restCom[b * 3 + 1], this.restCom[b * 3 + 2]];
  }

  /** Set body b where another visitor's page has it (com xyz, quaternion xyzw at `o` in `src`), asleep or not. */
  setPose(b: number, src: ArrayLike<number>, o: number, asleep: boolean): void {
    const q = this.pose;
    for (let i = 0; i < 7; i++) q[b * 7 + i] = src[o + i];
    for (let k = this.start[b]; k < this.start[b + 1]; k++) {
      rot(q, b * 7 + 3, this.rest[k * 3], this.rest[k * 3 + 1], this.rest[k * 3 + 2], this.p, k * 3);
      for (let j = 0; j < 3; j++) {
        this.p[k * 3 + j] += q[b * 7 + j];
        this.prev[k * 3 + j] = this.p[k * 3 + j];
        this.v[k * 3 + j] = 0;
      }
    }
    this.gone[b] = 0;
    this.sleeping[b] = asleep ? 1 : 0;
    this.still[b] = 0;
  }

  /** Put body b at (x, y, z) turned by q as place() does, then slid clear of the glass and over the guard, as the claw keeps what it holds. */
  placeClear(b: number, x: number, y: number, z: number, q: [number, number, number, number]): void {
    this.place(b, x, y, z, q);
    this.confine(b);
    const o = b * 7;
    this.place(b, this.pose[o], this.pose[o + 1], this.pose[o + 2], [this.pose[o + 3], this.pose[o + 4], this.pose[o + 5], this.pose[o + 6]]);
  }

  /** Take body b out of play (won and taken), or put it back with place(). */
  remove(b: number): void {
    this.gone[b] = 1;
    this.sleeping[b] = 1;
    if (this.held === b) this.held = -1;
    if (this.loose === b) this.loose = -1;
  }

  isGone(b: number): boolean {
    return this.gone[b] === 1;
  }

  isAsleep(b: number): boolean {
    return this.sleeping[b] === 1;
  }

  wake(b: number): void {
    this.sleeping[b] = 0;
    this.still[b] = 0;
  }

  /** Whether everything is at rest and nothing is held: then step() does nothing. */
  get settled(): boolean {
    if (this.held >= 0) return false;
    for (let b = 0; b < this.count; b++) if (!this.sleeping[b]) return false;
    return true;
  }

  /** How far body b reaches from its centre (m). */
  boundOf(b: number): number {
    return this.bound[b];
  }

  /** Body b's spheres, now: [x, y, z, r] each, in a reused array. */
  spheres(b: number, out: number[] = []): number[] {
    out.length = 0;
    for (let k = this.start[b]; k < this.start[b + 1]; k++) out.push(this.p[k * 3], this.p[k * 3 + 1], this.p[k * 3 + 2], this.r[k]);
    return out;
  }

  /** The lowest and highest points of body b now (y). */
  extentY(b: number): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = this.start[b]; k < this.start[b + 1]; k++) {
      lo = Math.min(lo, this.p[k * 3 + 1] - this.r[k]);
      hi = Math.max(hi, this.p[k * 3 + 1] + this.r[k]);
    }
    return [lo, hi];
  }

  /** Hold body b with the claw (or -1 to let go): from now it follows setHeld's pose. */
  hold(b: number): void {
    if (this.held >= 0 && this.held !== b) {
      this.wake(this.held);
      // let go from inside shut prongs: eased out of them, not shot out by them
      this.loose = this.held;
      for (let k = this.start[this.loose]; k < this.start[this.loose + 1]; k++) this.clawHad[k] = Infinity;
    }
    if (b >= 0 && this.loose === b) this.loose = -1;
    this.held = b;
    if (b >= 0) {
      this.wake(b);
      this.heldPose.set(this.pose.subarray(b * 7, b * 7 + 7));
    }
  }

  /** Where the held body is to be this step: its com and turn. */
  setHeld(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): void {
    const h = this.heldPose;
    h[0] = x;
    h[1] = y;
    h[2] = z;
    h[3] = qx;
    h[4] = qy;
    h[5] = qz;
    h[6] = qw;
  }

  /** Advance by dt seconds in fixed substeps. Returns the substeps taken. */
  step(dt: number): number {
    this.acc = Math.min(this.acc + dt, 0.1);
    let n = 0;
    this.clawPress = 0;
    this.clawOn = -1;
    this.capPress.length = this.claw.length;
    this.capBody.length = this.claw.length;
    this.capPress.fill(0);
    this.capBody.fill(-1);
    while (this.acc >= H) {
      this.acc -= H;
      this.substep();
      n++;
    }
    return n;
  }

  /** Run until everything sleeps or `max` seconds pass (settling a freshly stocked machine). */
  settle(max = 6): void {
    for (let t = 0; t < max && !this.settled; t += H) {
      this.acc = H;
      this.substep();
    }
  }

  private substep() {
    const { p, prev, v, body } = this;
    const N = this.start[this.count];
    for (let b = 0; b < this.count; b++) {
      this.centre(b, this.comStart, b * 3);
      for (let i = 0; i < 4; i++) this.turnStart[b * 4 + i] = this.pose[b * 7 + 3 + i];
    }
    this.easeOut();
    // the held body moves to its pose; the rest fall
    if (this.held >= 0) this.pose.set(this.heldPose, this.held * 7);
    for (let k = 0; k < N; k++) {
      const b = body[k];
      if (this.sleeping[b] || this.gone[b]) continue;
      const o = k * 3;
      prev[o] = p[o];
      prev[o + 1] = p[o + 1];
      prev[o + 2] = p[o + 2];
      if (b === this.held) {
        rot(this.pose, b * 7 + 3, this.rest[o], this.rest[o + 1], this.rest[o + 2], p, o);
        p[o] += this.pose[b * 7];
        p[o + 1] += this.pose[b * 7 + 1];
        p[o + 2] += this.pose[b * 7 + 2];
        continue;
      }
      v[o + 1] += G * H;
      // a little air drag keeps tumbling from going on forever
      v[o] *= 0.999;
      v[o + 1] *= 0.999;
      v[o + 2] *= 0.999;
      p[o] += v[o] * H;
      p[o + 1] += v[o + 1] * H;
      p[o + 2] += v[o + 2] * H;
    }
    if (this.held >= 0) this.confine(this.held);
    for (let b = 0; b < this.count; b++) if (this.mouthT[b] > SAG_T && !this.sleeping[b] && !this.gone[b] && b !== this.held) this.sag(b);
    // the claw pushes first, so what the walls and the pile push back with shows as the claw's overlap left at the end
    for (let it = 0; it < ITERS; it++) {
      this.collideClaw(false);
      this.solvePile();
    }
    this.collideClaw(true);
    this.speedLimit();
    // velocities from how far each moved; bodies that have been still go to sleep
    for (let b = 0; b < this.count; b++) {
      if (this.sleeping[b] || this.gone[b]) continue;
      // creeping out of old overlap moved it, but gives it no speed
      const cx = this.crept[b * 3];
      const cy = this.crept[b * 3 + 1];
      const cz = this.crept[b * 3 + 2];
      this.crept[b * 3] = this.crept[b * 3 + 1] = this.crept[b * 3 + 2] = 0;
      for (let k = this.start[b]; k < this.start[b + 1]; k++) {
        const o = k * 3;
        prev[o] += cx + this.sagMove[o];
        prev[o + 1] += cy + this.sagMove[o + 1];
        prev[o + 2] += cz + this.sagMove[o + 2];
        this.sagMove[o] = this.sagMove[o + 1] = this.sagMove[o + 2] = 0;
        v[o] = (p[o] - prev[o]) / H;
        v[o + 1] = (p[o + 1] - prev[o + 1]) / H;
        v[o + 2] = (p[o + 2] - prev[o + 2]) / H;
      }
      if (b === this.held) continue;
      // still, or barely creeping for a while (held in a jam that jitters): to sleep either way. It is
      // how far the body went this substep, easing too, as drawn (its centre, and its turn at its
      // edge): eased off a prize and settled back onto it is still, being eased out of one is moving,
      // and its spheres shimmering a fraction of a millimetre about its shape is not moving
      const c = this.tmp;
      this.centre(b, c, 0);
      const q = this.pose;
      const t0 = this.turnStart;
      const dot = Math.abs(q[b * 7 + 3] * t0[b * 4] + q[b * 7 + 4] * t0[b * 4 + 1] + q[b * 7 + 5] * t0[b * 4 + 2] + q[b * 7 + 6] * t0[b * 4 + 3]);
      const turned = 2 * Math.acos(Math.min(1, dot)) * this.bound[b];
      const moved = (Math.hypot(c[0] - this.comStart[b * 3], c[1] - this.comStart[b * 3 + 1], c[2] - this.comStart[b * 3 + 2]) + turned) / H;
      // never to sleep in the chute's mouth: on until it has fallen in or off
      const mouth = this.overChute(b);
      this.mouthT[b] = mouth ? this.mouthT[b] + H : 0;
      if (mouth) this.still[b] = 0;
      else if (moved < SLEEP_V) this.still[b] += H;
      else if (moved < CREEP_V) this.still[b] += H * (SLEEP_T / CREEP_T);
      else this.still[b] = 0;
      if (this.still[b] > SLEEP_T) {
        this.sleeping[b] = 1;
        for (let k = this.start[b]; k < this.start[b + 1]; k++) v[k * 3] = v[k * 3 + 1] = v[k * 3 + 2] = 0;
      }
    }
  }

  /**
   * No prize goes faster than a plush toy can, whatever pushed it (prizes jammed deep in one
   * another push each other on in a chain within one substep): each body's centre is held to
   * MAX_* this substep (easing and all), the body drawn back as one toward where it began it,
   * which was clear of the machine, so this can't put it through the glass; and its turn is held
   * to MAX_SPIN.
   */
  private speedLimit() {
    const { p, prev, w } = this;
    for (let b = 0; b < this.count; b++) {
      if (this.sleeping[b] || this.gone[b] || b === this.held) continue;
      // the centre's move since the solve began (its motion), and since the substep began (easing too)
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (let k = this.start[b]; k < this.start[b + 1]; k++) {
        mx += (p[k * 3] - prev[k * 3]) * w[k];
        my += (p[k * 3 + 1] - prev[k * 3 + 1]) * w[k];
        mz += (p[k * 3 + 2] - prev[k * 3 + 2]) * w[k];
      }
      const c = this.tmp;
      this.centre(b, c, 0);
      const dx = c[0] - this.comStart[b * 3];
      const dy = c[1] - this.comStart[b * 3 + 1];
      const dz = c[2] - this.comStart[b * 3 + 2];
      const across = Math.hypot(dx, dz);
      const s = across > MAX_ACROSS * H ? (MAX_ACROSS * H) / across : 1;
      const bx = dx * (s - 1);
      const by = Math.max(-MAX_FALL * H, Math.min(MAX_UP * H, dy)) - dy;
      const bz = dz * (s - 1);
      // each sphere's move apart from the centre's is its turn
      let spin = 0;
      for (let k = this.start[b]; k < this.start[b + 1]; k++)
        spin = Math.max(spin, Math.hypot(p[k * 3] - prev[k * 3] - mx, p[k * 3 + 1] - prev[k * 3 + 1] - my, p[k * 3 + 2] - prev[k * 3 + 2] - mz));
      const f = spin > MAX_SPIN * H ? (MAX_SPIN * H) / spin : 1;
      if (bx === 0 && by === 0 && bz === 0 && f === 1) continue;
      for (let k = this.start[b]; k < this.start[b + 1]; k++) {
        const o = k * 3;
        p[o] = prev[o] + mx + bx + (p[o] - prev[o] - mx) * f;
        p[o + 1] = prev[o + 1] + my + by + (p[o + 1] - prev[o + 1] - my) * f;
        p[o + 2] = prev[o + 2] + mz + bz + (p[o + 2] - prev[o + 2] - mz) * f;
      }
      this.pose[b * 7] += bx;
      this.pose[b * 7 + 1] += by;
      this.pose[b * 7 + 2] += bz;
    }
  }

  /**
   * Old overlap eased out a little, before this substep's motion begins: each body moved as one
   * (a small sphere pushed alone would mostly be pulled back by its shape) by what its spheres
   * want, at most EASE each way, so it is moved but given no speed. The machine wins over the
   * other prizes: one pressed between a prize and the glass or floor is eased along the glass,
   * never into it.
   */
  private easeOut() {
    const N = this.start[this.count];
    const e = this.ease;
    const ew = this.easeWall;
    e.fill(0);
    ew.fill(0);
    this.easing = true;
    this.collidePairs();
    this.easingWall = true;
    for (let k = 0; k < N; k++) {
      const b = this.body[k];
      if (!this.sleeping[b] && !this.gone[b] && b !== this.held) this.collideStatic(k);
    }
    this.easingWall = false;
    this.easing = false;
    const axis = (o: number) => {
      // what the machine wants this way and that, then the other prizes where the machine doesn't push back
      const plus = ew[o + 1] > 0 ? ew[o] : Math.max(ew[o], e[o]);
      const minus = ew[o] > 0 ? ew[o + 1] : Math.max(ew[o + 1], e[o + 1]);
      return Math.max(-EASE, Math.min(EASE, plus - minus));
    };
    const B = this.box;
    const [bx0, bx1, bz0, bz1] = B.bed;
    for (let b = 0; b < this.count; b++) {
      const o = b * 6;
      let dx = axis(o);
      let dy = axis(o + 2);
      let dz = axis(o + 4);
      if (dx === 0 && dy === 0 && dz === 0) continue;
      // never eased into the glass or down into the bed: only as far as the room it has that way
      for (let k = this.start[b]; k < this.start[b + 1]; k++) {
        const x = this.p[k * 3];
        const y = this.p[k * 3 + 1];
        const z = this.p[k * 3 + 2];
        const r = this.r[k];
        if (dx > 0) dx = Math.min(dx, Math.max(0, bx1 - r - x));
        if (dx < 0) dx = Math.max(dx, Math.min(0, bx0 + r - x));
        if (dz > 0) dz = Math.min(dz, Math.max(0, bz1 - r - z));
        if (dz < 0 && y > B.bedY) dz = Math.max(dz, Math.min(0, bz0 + r - z));
        if (dy < 0 && y > B.bedY) dy = Math.max(dy, Math.min(0, B.bedY + r - y));
      }
      if (dx === 0 && dy === 0 && dz === 0) continue;
      this.pose[b * 7] += dx;
      this.pose[b * 7 + 1] += dy;
      this.pose[b * 7 + 2] += dz;
      for (let k = this.start[b]; k < this.start[b + 1]; k++) {
        this.p[k * 3] += dx;
        this.p[k * 3 + 1] += dy;
        this.p[k * 3 + 2] += dz;
      }
    }
  }

  /**
   * Whether body b is in the chute's mouth, not yet down it: its centre over the hole (or on the
   * guard's rim), above where it counts as down. It never sleeps there, so it can't come to rest
   * on the rim or across the mouth: it goes on until it has fallen in or off.
   */
  overChute(b: number): boolean {
    const B = this.box;
    const o = b * 7;
    const [, cx1, , cz1] = B.chute;
    const y = this.pose[o + 1];
    return this.pose[o] < cx1 + GUARD_T && this.pose[o + 2] < cz1 + GUARD_T && y > B.bedY - CHUTE_DOWN && y < B.bedY + B.guardH + this.bound[b];
  }

  /**
   * Body b, stuck across the chute's mouth, turned a little toward fitting: its longest way toward
   * upright, and its widest way across toward the hole's diagonal, about its centre. The turn is
   * part of the substep's motion, so the glass and the shaft stop it as they stop a fall (it slides
   * along them), but it gives the body no speed (sagMove): it slips in, it doesn't flip in.
   */
  private sag(b: number) {
    const i = this.longEnds[b * 2];
    const j = this.longEnds[b * 2 + 1];
    if (i < 0) return;
    const { p, r } = this;
    // which end goes up: one hanging out over the guard (it has to come back over the rim), else the higher
    const [, cx1, , cz1] = this.box.chute;
    const out = (k: number) => p[k * 3] > cx1 - GUARD_T || p[k * 3 + 2] > cz1 - GUARD_T;
    const up = out(i) !== out(j) ? (out(i) ? i : j) : p[i * 3 + 1] >= p[j * 3 + 1] ? i : j;
    const dn = up === i ? j : i;
    let ax = p[up * 3] - p[dn * 3];
    let ay = p[up * 3 + 1] - p[dn * 3 + 1];
    let az = p[up * 3 + 2] - p[dn * 3 + 2];
    const al = Math.hypot(ax, ay, az);
    if (al < 1e-9) return;
    ax /= al;
    ay /= al;
    az /= al;
    // the tip: about (long way × up), by what is left to upright, at most SAG_SPIN a second
    let wx = 0;
    let wy = 0;
    let wz = 0;
    const left = Math.acos(Math.max(-1, Math.min(1, ay)));
    const kl = Math.hypot(az, ax);
    if (left > 0.05 && kl > 1e-9) {
      const a = Math.min(left, SAG_SPIN * H) / kl;
      wx = -az * a;
      wz = ax * a;
    }
    // and the turn about the upright: its widest way across toward the hole's diagonal, where it has the most room
    let wide = 0;
    let dx = 0;
    let dz = 0;
    for (let m = this.start[b]; m < this.start[b + 1]; m++)
      for (let n = m + 1; n < this.start[b + 1]; n++) {
        const hx = p[m * 3] - p[n * 3];
        const hz = p[m * 3 + 2] - p[n * 3 + 2];
        const h = Math.hypot(hx, hz) + r[m] + r[n];
        if (h > wide) [wide, dx, dz] = [h, hx, hz];
      }
    if (dx || dz) {
      // its angle across the hole's square, 0..90°: 45° is a diagonal
      const quarter = Math.PI / 2;
      const off = (((Math.atan2(dz, dx) % quarter) + quarter) % quarter) - quarter / 2;
      // a turn by +w about the upright takes a direction's angle by -w
      if (Math.abs(off) > 0.05) wy = Math.sign(off) * Math.min(Math.abs(off), SAG_SPIN * H);
    }
    if (wx === 0 && wy === 0 && wz === 0) return;
    // about its centre, so both ends come in toward the hole
    const ang = Math.hypot(wx, wy, wz);
    const sn = Math.sin(ang / 2) / ang;
    const q = this.sagQ;
    q[0] = wx * sn;
    q[1] = wy * sn;
    q[2] = wz * sn;
    q[3] = Math.cos(ang / 2);
    const t = this.tmp;
    this.centre(b, t, 0);
    const cx = t[0];
    const cy = t[1];
    const cz = t[2];
    const m = this.sagMove;
    for (let k = this.start[b]; k < this.start[b + 1]; k++) {
      const o = k * 3;
      rot(q, 0, p[o] - cx, p[o + 1] - cy, p[o + 2] - cz, t, 0);
      m[o] += cx + t[0] - p[o];
      m[o + 1] += cy + t[1] - p[o + 1];
      m[o + 2] += cz + t[2] - p[o + 2];
      p[o] = cx + t[0];
      p[o + 1] = cy + t[1];
      p[o + 2] = cz + t[2];
    }
    turn(this.pose, b * 7 + 3, wx, wy, wz);
  }

  /** Body b's centre of mass now, into out[o..o+2]. */
  private centre(b: number, out: Float64Array, o: number) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = this.start[b]; k < this.start[b + 1]; k++) {
      x += this.p[k * 3] * this.w[k];
      y += this.p[k * 3 + 1] * this.w[k];
      z += this.p[k * 3 + 2] * this.w[k];
    }
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
  }

  /**
   * The prizes against each other, back to their shapes, then against the machine: the glass,
   * the floor and the guard have the last word, so the pile can't press a prize into them.
   */
  private solvePile() {
    const N = this.start[this.count];
    this.collidePairs();
    for (let b = 0; b < this.count; b++) if (!this.sleeping[b] && !this.gone[b] && b !== this.held) this.match(b);
    for (let k = 0; k < N; k++) {
      const b = this.body[k];
      if (!this.sleeping[b] && !this.gone[b] && b !== this.held) this.collideStatic(k);
    }
  }

  /**
   * Move particle k out by (nx, ny, nz) * depth, with friction against a still surface (plush on
   * plush grips like that too: friction only as strong as the push this solve gives). In the
   * easing pass, only noted for its body (easeOut). In the solve, the overlap this substep's
   * motion made, and at most CREEP_OUT of what it had before beyond SLOP (`had`; -1: work it out
   * against a still surface), the rest left for the easing pass.
   */
  private push(k: number, nx: number, ny: number, nz: number, depth: number, mu: number, had = -1) {
    const o = k * 3;
    const { p, prev } = this;
    if (this.easing) {
      // touching the machine at all blocks easing into it, however little it presses
      depth = this.easingWall ? Math.max(1e-9, depth - SLOP) : depth - SLOP;
      if (depth <= 0) return;
      const e = this.easingWall ? this.easeWall : this.ease;
      const eb = this.body[k] * 6;
      const ax = nx * depth;
      const ay = ny * depth;
      const az = nz * depth;
      if (ax > 0) e[eb] = Math.max(e[eb], ax);
      else e[eb + 1] = Math.max(e[eb + 1], -ax);
      if (ay > 0) e[eb + 2] = Math.max(e[eb + 2], ay);
      else e[eb + 3] = Math.max(e[eb + 3], -ay);
      if (az > 0) e[eb + 4] = Math.max(e[eb + 4], az);
      else e[eb + 5] = Math.max(e[eb + 5], -az);
      return;
    }
    if (had < 0) had = depth + (p[o] - prev[o]) * nx + (p[o + 1] - prev[o + 1]) * ny + (p[o + 2] - prev[o + 2]) * nz;
    had = Math.max(0, Math.min(depth, had));
    const creep = Math.min(Math.max(0, had - SLOP), CREEP_OUT);
    depth = depth - had + creep;
    if (depth <= 0) return;
    if (creep > 0) {
      // what it moves the body's centre by, once shape matching shares it out
      const cb = this.body[k] * 3;
      const wk = this.w[k] * creep;
      this.crept[cb] += nx * wk;
      this.crept[cb + 1] += ny * wk;
      this.crept[cb + 2] += nz * wk;
    }
    p[o] += nx * depth;
    p[o + 1] += ny * depth;
    p[o + 2] += nz * depth;
    // friction: take back the sliding along the surface, up to mu times the push
    const dx = p[o] - prev[o];
    const dy = p[o + 1] - prev[o + 1];
    const dz = p[o + 2] - prev[o + 2];
    const dn = dx * nx + dy * ny + dz * nz;
    const tx = dx - dn * nx;
    const ty = dy - dn * ny;
    const tz = dz - dn * nz;
    const tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-12) return;
    const k2 = Math.min(1, (mu * depth) / tl);
    p[o] -= tx * k2;
    p[o + 1] -= ty * k2;
    p[o + 2] -= tz * k2;
  }

  /** Particle k against an axis-aligned box (a guard wall, the rim). */
  private boxOut(k: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mu: number) {
    const o = k * 3;
    const px = this.p[o];
    const py = this.p[o + 1];
    const pz = this.p[o + 2];
    const r = this.r[k];
    const qx = Math.max(x0, Math.min(x1, px));
    const qy = Math.max(y0, Math.min(y1, py));
    const qz = Math.max(z0, Math.min(z1, pz));
    const dx = px - qx;
    const dy = py - qy;
    const dz = pz - qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) return;
    if (d2 > 1e-14) {
      const d = Math.sqrt(d2);
      this.push(k, dx / d, dy / d, dz / d, r - d, mu);
      return;
    }
    // the centre is inside: out the face it came in through (a fast fall can carry it past a thin wall's middle in one substep), else the nearest
    const q = this.prev;
    const ox = q[o], oy = q[o + 1], oz = q[o + 2];
    const came: [number, number, number, number][] = [];
    if (ox < x0) came.push([px - x0 + r, -1, 0, 0]);
    if (ox > x1) came.push([x1 - px + r, 1, 0, 0]);
    if (oy < y0) came.push([py - y0 + r, 0, -1, 0]);
    if (oy > y1) came.push([y1 - py + r, 0, 1, 0]);
    if (oz < z0) came.push([pz - z0 + r, 0, 0, -1]);
    if (oz > z1) came.push([z1 - pz + r, 0, 0, 1]);
    const opts: [number, number, number, number][] = came.length ? came : [
      [px - x0 + r, -1, 0, 0],
      [x1 - px + r, 1, 0, 0],
      [py - y0 + r, 0, -1, 0],
      [y1 - py + r, 0, 1, 0],
      [pz - z0 + r, 0, 0, -1],
      [z1 - pz + r, 0, 0, 1],
    ];
    let best = opts[0];
    for (const c of opts) if (c[0] < best[0]) best = c;
    this.push(k, best[1], best[2], best[3], best[0], mu);
  }

  private collideStatic(k: number) {
    const B = this.box;
    const o = k * 3;
    const r = this.r[k];
    const [bx0, bx1, bz0, bz1] = B.bed;
    const [, cx1, , cz1] = B.chute;
    const p = this.p;
    const inHole = (x: number, z: number) => x < cx1 && z < cz1;
    // the glass walls; round the chute nothing grips (a prize there slides down it, never hangs on the glass)
    if (p[o] < bx0 + r) this.push(k, 1, 0, 0, bx0 + r - p[o], p[o + 2] < cz1 + r ? 0 : MU_WALL);
    if (p[o] > bx1 - r) this.push(k, -1, 0, 0, p[o] - (bx1 - r), MU_WALL);
    if (p[o + 2] > bz1 - r) this.push(k, 0, 0, -1, p[o + 2] - (bz1 - r), MU_WALL);
    const y = p[o + 1];
    const binTop = B.binY + 0.27;
    if (y < binTop + 0.02) {
      // the bin behind the pickup door: its floor slopes down to the door, which stands open a little way
      const front = B.doorZ - 0.05;
      if (p[o + 2] < front + r) this.push(k, 0, 0, 1, front + r - p[o + 2], MU_WALL);
    } else if (p[o + 2] < bz0 + r) this.push(k, 0, 0, 1, bz0 + r - p[o + 2], p[o] < cx1 + r ? 0 : MU_WALL);
    if (y - r < B.bedY + 0.001 && y > B.bedY - 0.3) {
      if (!inHole(p[o], p[o + 2])) {
        // the bed's floor, out of the hole; at its edge a particle half over the hole rests on the lip
        if (y < B.bedY + r && y > B.bedY - r * 0.5) this.push(k, 0, 1, 0, B.bedY + r - y, MU_FLOOR);
      }
    }
    if (y < B.bedY + 0.005) {
      // inside the shaft and the bin: its walls are the chute's
      if (inHole(p[o] - r * 0.5, p[o + 2] - r * 0.5) || y < B.bedY - 0.01) {
        if (p[o] > cx1 - r) this.push(k, -1, 0, 0, p[o] - (cx1 - r), 0);
        if (p[o + 2] > cz1 - r) this.push(k, 0, 0, -1, p[o + 2] - (cz1 - r), 0);
      }
      const fy = B.binY + 0.2 * (p[o + 2] - B.doorZ);
      if (p[o + 1] < fy + r) this.push(k, 0, 1, 0, fy + r - p[o + 1], MU_WALL);
    }
    // the guard round the chute: its two walls of slick acrylic, and the chrome tube along their top
    const t = GUARD_T;
    const gy1 = B.bedY + B.guardH;
    if (y - r < gy1 + t) {
      if (this.mouthT[this.body[k]] > SAG_T) {
        // a prize stuck in the chute's mouth a while is folding in over the guard: squashed past it, one way only, into the
        // chute (eased, as old overlap is), never back out of it, and never through the glass
        // (only as far as the room it has before the glass: the guard comes last, and must not press it into the glass)
        const x = p[o];
        const z = p[o + 2];
        if (z < cz1 + t + r && x > cx1 - t - r && x < cx1 + t + r) this.push(k, -1, 0, 0, Math.min(x - (cx1 - t - r), x - (bx0 + r)), 0);
        if (x < cx1 + t + r && z > cz1 - t - r && z < cz1 + t + r) this.push(k, 0, 0, -1, Math.min(z - (cz1 - t - r), z - (bz0 + r)), 0);
      } else if (y < gy1) {
        this.boxOut(k, cx1 - t, cx1 + t, B.bedY - 0.02, gy1, bz0 - 0.03, cz1 + t, 0);
        this.boxOut(k, bx0 - 0.03, cx1 + t, B.bedY - 0.02, gy1, cz1 - t, cz1 + t, 0);
      } else this.rimOut(k);
    }
  }

  /**
   * Particle k on the guard's rim, a tube of radius GUARD_T along the top of its two walls. Nothing
   * balances on it: it pushes a prize off toward the side its weight is on (into the chute, or back
   * onto the bed), however squarely it sits on top, and it is slick, so a prize there slides off.
   */
  private rimOut(k: number) {
    const B = this.box;
    const o = k * 3;
    const { p } = this;
    const [bx0, , bz0] = B.bed;
    const [, cx1, , cz1] = B.chute;
    const gy1 = B.bedY + B.guardH;
    const px = p[o];
    const py = p[o + 1];
    const pz = p[o + 2];
    // the nearest point on the tube's line: along the wall at x = cx1, or the one at z = cz1
    const zOn = Math.max(bz0, Math.min(cz1, pz));
    const xOn = Math.max(bx0, Math.min(cx1, px));
    const dA = Math.hypot(px - cx1, py - gy1, pz - zOn);
    const dB = Math.hypot(px - xOn, py - gy1, pz - cz1);
    const onX = dA <= dB;
    const d = onX ? dA : dB;
    const depth = this.r[k] + GUARD_T - d;
    if (depth <= 0 || d < 1e-9) return;
    let nx = (onX ? px - cx1 : px - xOn) / d;
    const ny = (py - gy1) / d;
    let nz = (onX ? pz - zOn : pz - cz1) / d;
    // which side of this wall the body's weight is on: the chute's, if it is over the hole
    const c = this.body[k] * 7;
    const hole = this.pose[c] < cx1 && this.pose[c + 2] < cz1;
    if (onX) {
      const side = hole || this.pose[c] < cx1 ? -1 : 1;
      if (nx * side < RIM_TIP * ny) nx = side * RIM_TIP * ny;
    } else {
      const side = hole || this.pose[c + 2] < cz1 ? -1 : 1;
      if (nz * side < RIM_TIP * ny) nz = side * RIM_TIP * ny;
    }
    const l = Math.hypot(nx, ny, nz);
    this.push(k, nx / l, ny / l, nz / l, depth, 0);
  }

  private collidePairs() {
    const { p, r, body, start } = this;
    for (let a = 0; a < this.count; a++) {
      if (this.gone[a]) continue;
      for (let b = a + 1; b < this.count; b++) {
        if (this.gone[b]) continue;
        const sa = this.sleeping[a];
        const sb = this.sleeping[b];
        if (sa && sb) continue;
        // the bodies' bounds first
        const ao = a * 7;
        const bo = b * 7;
        const dx0 = this.pose[ao] - this.pose[bo];
        const dy0 = this.pose[ao + 1] - this.pose[bo + 1];
        const dz0 = this.pose[ao + 2] - this.pose[bo + 2];
        const rr = this.bound[a] + this.bound[b] + 0.01;
        if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > rr * rr) continue;
        for (let i = start[a]; i < start[a + 1]; i++)
          for (let j = start[b]; j < start[b + 1]; j++) {
            const io = i * 3;
            const jo = j * 3;
            const dx = p[io] - p[jo];
            const dy = p[io + 1] - p[jo + 1];
            const dz = p[io + 2] - p[jo + 2];
            const rs = r[i] + r[j];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= rs * rs || d2 < 1e-14) continue;
            const d = Math.sqrt(d2);
            const pen = rs - d;
            const nx = dx / d;
            const ny = dy / d;
            const nz = dz / d;
            // a sleeping body woken by a real push; a held one doesn't give
            const ia = body[i] === this.held;
            const ib = body[j] === this.held;
            let ka = ia ? 0 : sa ? 0 : 0.5;
            let kb = ib ? 0 : sb ? 0 : 0.5;
            if (sa && pen > 0.002) {
              this.wake(a);
              ka = 0.5;
            }
            if (sb && pen > 0.002) {
              this.wake(b);
              kb = 0.5;
            }
            const sum = ka + kb;
            if (sum === 0) continue;
            // how much they overlapped before this substep moved them: that is the easing pass's to undo, gently
            const { prev } = this;
            const had = rs - Math.hypot(prev[io] - prev[jo], prev[io + 1] - prev[jo + 1], prev[io + 2] - prev[jo + 2]);
            if (ka) this.push(i, nx, ny, nz, (pen * ka) / sum, MU_PLUSH, (had * ka) / sum);
            if (kb) this.push(j, -nx, -ny, -nz, (pen * kb) / sum, MU_PLUSH, (had * kb) / sum);
          }
      }
    }
  }

  /** The claw's capsules against the prizes: pushing them out, or (measure) only noting how far each still overlaps one. */
  private collideClaw(measure: boolean) {
    const { p, r, body } = this;
    const N = this.start[this.count];
    const c = this.tmp;
    const L = this.loose;
    if (measure && L >= 0) for (let k = this.start[L]; k < this.start[L + 1]; k++) this.clawHad[k] = 0;
    for (let ci = 0; ci < this.claw.length; ci++) {
      const cap = this.claw[ci];
      if (cap.r <= 0) continue;
      const ex = cap.bx - cap.ax;
      const ey = cap.by - cap.ay;
      const ez = cap.bz - cap.az;
      const el = ex * ex + ey * ey + ez * ez || 1e-12;
      for (let k = 0; k < N; k++) {
        const b = body[k];
        if (this.gone[b] || b === this.held) continue;
        const o = k * 3;
        let t = ((p[o] - cap.ax) * ex + (p[o + 1] - cap.ay) * ey + (p[o + 2] - cap.az) * ez) / el;
        t = Math.max(0, Math.min(1, t));
        c[0] = cap.ax + ex * t;
        c[1] = cap.ay + ey * t;
        c[2] = cap.az + ez * t;
        const dx = p[o] - c[0];
        const dy = p[o + 1] - c[1];
        const dz = p[o + 2] - c[2];
        const rs = r[k] + cap.r;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rs * rs || d2 < 1e-14) continue;
        const d = Math.sqrt(d2);
        const pen = rs - d;
        if (b === L) {
          // what the claw just let go of: out through the prongs; the head eases it out of the overlap it had, and isn't sensed
          if (ci > 0) continue;
          if (measure) {
            this.clawHad[k] = Math.max(this.clawHad[k], pen);
          } else this.push(k, dx / d, dy / d, dz / d, pen, MU_PLUSH, this.clawHad[k]);
          continue;
        }
        if (!measure) {
          if (this.sleeping[b]) this.wake(b);
          // the claw moves slowly, so its push is all this substep's
          this.push(k, dx / d, dy / d, dz / d, pen, MU_PLUSH, 0);
          continue;
        }
        if (pen > this.clawPress) {
          this.clawPress = pen;
          this.clawOn = b;
        }
        if (pen > this.capPress[ci]) {
          this.capPress[ci] = pen;
          this.capBody[ci] = b;
        }
      }
    }
    if (measure && L >= 0 && (this.sleeping[L] || !this.claw.length || this.pose[L * 7 + 1] < this.claw[0].ay - 0.3)) this.loose = -1;
  }

  /**
   * The held body against the glass and the chute's guard: held, it is moved by the claw, not
   * pushed about, but the glass still stops it, so it slides over in the prongs (the whole body,
   * as rigid as it's held) rather than passing through.
   */
  private confine(b: number) {
    const B = this.box;
    const { p, r } = this;
    const [bx0, bx1, bz0, bz1] = B.bed;
    const [, cx1, , cz1] = B.chute;
    const gy1 = B.bedY + B.guardH;
    for (let pass = 0; pass < 3; pass++) {
      // the most each way any sphere must move: +x, -x, +y, +z, -z
      let px = 0, nx = 0, py = 0, pz = 0, nz = 0;
      for (let k = this.start[b]; k < this.start[b + 1]; k++) {
        const o = k * 3;
        const x = p[o], y = p[o + 1], z = p[o + 2], rk = r[k];
        px = Math.max(px, bx0 + rk - x);
        nx = Math.max(nx, x - (bx1 - rk));
        pz = Math.max(pz, bz0 + rk - z);
        nz = Math.max(nz, z - (bz1 - rk));
        // the guard's walls stand up round the chute: over them, or beside them
        if (y - rk < gy1) {
          const inX = x < cx1 + rk;
          const inZ = z < cz1 + rk;
          if (inX && inZ && (x > cx1 - rk || z > cz1 - rk)) py = Math.max(py, gy1 + rk - y);
        }
      }
      if (!(px || nx || py || pz || nz)) return;
      const dx = px - nx, dy = py, dz = pz - nz;
      const o = b * 7;
      this.pose[o] += dx;
      this.pose[o + 1] += dy;
      this.pose[o + 2] += dz;
      for (let k = this.start[b]; k < this.start[b + 1]; k++) {
        p[k * 3] += dx;
        p[k * 3 + 1] += dy;
        p[k * 3 + 2] += dz;
      }
    }
  }

  /** Shape matching: body b's spheres back to its rigid shape, best fitted to where they are now. */
  private match(b: number) {
    const { p, rest, w } = this;
    const k0 = this.start[b];
    const k1 = this.start[b + 1];
    const o = b * 7;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = k0; k < k1; k++) {
      cx += p[k * 3] * w[k];
      cy += p[k * 3 + 1] * w[k];
      cz += p[k * 3 + 2] * w[k];
    }
    const n = k1 - k0;
    if (n === 1) {
      // a ball: it turns as it rolls
      const dx = cx - this.pose[o];
      const dz = cz - this.pose[o + 2];
      const rr = this.r[k0];
      turn(this.pose, o + 3, dz / rr, 0, -dx / rr);
    } else {
      // A = Σ w (p - c) restᵀ; its rotation, found from the last pose by a few steps (Müller et al. 2016)
      let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
      for (let k = k0; k < k1; k++) {
        const px = (p[k * 3] - cx) * w[k];
        const py = (p[k * 3 + 1] - cy) * w[k];
        const pz = (p[k * 3 + 2] - cz) * w[k];
        const rx = rest[k * 3];
        const ry = rest[k * 3 + 1];
        const rz = rest[k * 3 + 2];
        a00 += px * rx;
        a01 += px * ry;
        a02 += px * rz;
        a10 += py * rx;
        a11 += py * ry;
        a12 += py * rz;
        a20 += pz * rx;
        a21 += pz * ry;
        a22 += pz * rz;
      }
      const q = this.pose;
      const t = this.tmp;
      for (let it = 0; it < 4; it++) {
        // R's columns: R e_x, R e_y, R e_z
        rot(q, o + 3, 1, 0, 0, t, 0);
        const r0x = t[0], r0y = t[1], r0z = t[2];
        rot(q, o + 3, 0, 1, 0, t, 0);
        const r1x = t[0], r1y = t[1], r1z = t[2];
        rot(q, o + 3, 0, 0, 1, t, 0);
        const r2x = t[0], r2y = t[1], r2z = t[2];
        // ω = Σ r_i × a_i / |Σ r_i · a_i|
        const wx = r0y * a20 - r0z * a10 + (r1y * a21 - r1z * a11) + (r2y * a22 - r2z * a12);
        const wy = r0z * a00 - r0x * a20 + (r1z * a01 - r1x * a21) + (r2z * a02 - r2x * a22);
        const wz = r0x * a10 - r0y * a00 + (r1x * a11 - r1y * a01) + (r2x * a12 - r2y * a02);
        const dn = Math.abs(r0x * a00 + r0y * a10 + r0z * a20 + r1x * a01 + r1y * a11 + r1z * a21 + r2x * a02 + r2y * a12 + r2z * a22) + 1e-12;
        const s = 1 / dn;
        if (Math.hypot(wx, wy, wz) * s < 1e-7) break;
        turn(q, o + 3, wx * s, wy * s, wz * s);
      }
    }
    this.pose[o] = cx;
    this.pose[o + 1] = cy;
    this.pose[o + 2] = cz;
    const t = this.tmp;
    for (let k = k0; k < k1; k++) {
      rot(this.pose, o + 3, rest[k * 3], rest[k * 3 + 1], rest[k * 3 + 2], t, 0);
      p[k * 3] = cx + t[0];
      p[k * 3 + 1] = cy + t[1];
      p[k * 3 + 2] = cz + t[2];
    }
  }
}

/** A small seeded random generator (mulberry32), so a machine stocks the same way everywhere. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a full machine holds: kinds in stocking order (27: 9 chimps, 3 pink, 6 bananas, 5 stars, 3 Coco Balls and the King). */
export const STOCK: PrizeKind[] = [
  "king", "chimp", "banana", "chimp", "coconut", "star", "chimp", "banana", "pinkChimp", "chimp", "star", "coconut", "chimp", "banana",
  "chimp", "star", "pinkChimp", "chimp", "banana", "coconut", "star", "banana", "chimp", "pinkChimp", "star", "banana", "chimp",
];

/**
 * Fill a machine (`fresh`: its prizes are already added, just put back in): every prize of the
 * stock dropped in, settled into a pile; any that ended up in the chute or against its guard put
 * back elsewhere, so the pile starts well clear of the chute.
 */
export function stockPile(world: PrizeWorld, rnd: () => number, fresh = false): void {
  const B = world.box;
  const y = (i: number) => B.bedY + 0.12 + Math.floor(i / 6) * 0.16;
  if (fresh) {
    for (let b = 0; b < world.count; b++) world.remove(b);
    for (let b = 0; b < world.count; b++) restock(world, b, rnd, y(b));
  } else STOCK.forEach((kind, i) => dropIn(world, kind, rnd, y(i)));
  world.settle(10);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let b = 0; b < world.count; b++)
      if (world.pose[b * 7 + 1] < B.bedY || nearGuard(world, b, GUARD_CLEAR)) {
        restock(world, b, rnd, B.bedY + 0.45);
        moved = true;
      }
    if (!moved) break;
    world.settle(6);
  }
}

/** Whether any part of prize b is within `gap` (m) of the chute's guard, or over it. */
function nearGuard(world: PrizeWorld, b: number, gap: number): boolean {
  const [, cx1, , cz1] = world.box.chute;
  const s = world.spheres(b, []);
  for (let i = 0; i < s.length; i += 4) if (s[i] - s[i + 3] < cx1 + gap && s[i + 2] - s[i + 3] < cz1 + gap) return true;
  return false;
}

/** Drop a prize in from above the bed at a random spot away from the chute, randomly turned. */
export function dropIn(world: PrizeWorld, kind: PrizeKind, rnd: () => number, y: number): number {
  const b = world.add(kind, 0, y, 0);
  restock(world, b, rnd, y);
  return b;
}

/**
 * Put prize b in from height y (stocking, or a won one put back) at a random spot: inside the
 * glass, well clear of the chute's guard, and clear of every prize already in, so it starts
 * inside none of them (raised a little if the spots at that height are taken).
 */
export function restock(world: PrizeWorld, b: number, rnd: () => number, y: number): void {
  for (let i = 0; i < 120; i++) {
    const [x, z, q] = dropSpot(world, rnd);
    world.place(b, x, y + Math.floor(i / 30) * 0.08, z, q);
    if (startsClear(world, b)) return;
  }
}

/** Whether prize b, where it was just put, is inside the glass, away from the guard, and in no other prize. */
function startsClear(world: PrizeWorld, b: number): boolean {
  const [bx0, bx1, bz0, bz1] = world.box.bed;
  const mine = world.spheres(b, []);
  for (let i = 0; i < mine.length; i += 4) {
    const [x, , z, r] = [mine[i], mine[i + 1], mine[i + 2], mine[i + 3]];
    if (x - r < bx0 || x + r > bx1 || z - r < bz0 || z + r > bz1) return false;
  }
  if (nearGuard(world, b, GUARD_CLEAR + 0.05)) return false;
  const other: number[] = [];
  for (let o = 0; o < world.count; o++) {
    if (o === b || world.isGone(o)) continue;
    const reach = world.boundOf(b) + world.boundOf(o);
    if (Math.hypot(world.pose[b * 7] - world.pose[o * 7], world.pose[b * 7 + 1] - world.pose[o * 7 + 1], world.pose[b * 7 + 2] - world.pose[o * 7 + 2]) > reach) continue;
    world.spheres(o, other);
    for (let i = 0; i < mine.length; i += 4)
      for (let j = 0; j < other.length; j += 4)
        if (Math.hypot(mine[i] - other[j], mine[i + 1] - other[j + 1], mine[i + 2] - other[j + 2]) < mine[i + 3] + other[j + 3]) return false;
  }
  return true;
}

function dropSpot(world: PrizeWorld, rnd: () => number): [number, number, [number, number, number, number]] {
  const [bx0, bx1, bz0, bz1] = world.box.bed;
  const [, cx1, , cz1] = world.box.chute;
  let x = 0;
  let z = 0;
  for (let i = 0; i < 20; i++) {
    x = bx0 + 0.09 + rnd() * (bx1 - bx0 - 0.18);
    z = bz0 + 0.09 + rnd() * (bz1 - bz0 - 0.18);
    if (!(x < cx1 + 0.09 && z < cz1 + 0.09)) break;
  }
  // mostly upright or lying on a side, as an attendant tips them in
  const yaw = rnd() * Math.PI * 2;
  const tip = (rnd() - 0.5) * (rnd() < 0.35 ? 2.6 : 0.7);
  // a turn about the vertical, then a tip about x: q = yaw * tip
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const st = Math.sin(tip / 2);
  const ct = Math.cos(tip / 2);
  const q: [number, number, number, number] = [cy * st, sy * ct, -sy * st, cy * ct];
  return [x, z, q];
}
