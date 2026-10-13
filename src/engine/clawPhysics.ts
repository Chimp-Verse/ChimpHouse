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
  private acc = 0;
  private tmp = new Float64Array(3);
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

  /** Take body b out of play (won and taken), or put it back with place(). */
  remove(b: number): void {
    this.gone[b] = 1;
    this.sleeping[b] = 1;
    if (this.held === b) this.held = -1;
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
    if (this.held >= 0 && this.held !== b) this.wake(this.held);
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
    // the claw pushes first, so what the walls and the pile push back with shows as the claw's overlap left at the end
    for (let it = 0; it < ITERS; it++) {
      this.collideClaw(false);
      for (let k = 0; k < N; k++) {
        const b = body[k];
        if (this.sleeping[b] || this.gone[b] || b === this.held) continue;
        this.collideStatic(k);
      }
      this.collidePairs();
      for (let b = 0; b < this.count; b++) if (!this.sleeping[b] && !this.gone[b] && b !== this.held) this.match(b);
    }
    this.collideClaw(true);
    // velocities from how far each moved; bodies that have been still go to sleep
    for (let b = 0; b < this.count; b++) {
      if (this.sleeping[b] || this.gone[b]) continue;
      let vmax = 0;
      for (let k = this.start[b]; k < this.start[b + 1]; k++) {
        const o = k * 3;
        v[o] = (p[o] - prev[o]) / H;
        v[o + 1] = (p[o + 1] - prev[o + 1]) / H;
        v[o + 2] = (p[o + 2] - prev[o + 2]) / H;
        vmax = Math.max(vmax, Math.hypot(v[o], v[o + 1], v[o + 2]));
      }
      if (b === this.held) continue;
      // still, or barely creeping for a while (held in a jam that jitters): to sleep either way
      if (vmax < SLEEP_V) this.still[b] += H;
      else if (vmax < CREEP_V) this.still[b] += H * (SLEEP_T / CREEP_T);
      else this.still[b] = 0;
      if (this.still[b] > SLEEP_T) {
        this.sleeping[b] = 1;
        for (let k = this.start[b]; k < this.start[b + 1]; k++) v[k * 3] = v[k * 3 + 1] = v[k * 3 + 2] = 0;
      }
    }
  }

  /** Move particle k out by (nx, ny, nz) * depth, with friction against a still surface. */
  private push(k: number, nx: number, ny: number, nz: number, depth: number, mu: number) {
    const o = k * 3;
    const { p, prev } = this;
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
    // the centre is inside: out the nearest face
    const opts: [number, number, number, number][] = [
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
    // the glass walls
    if (p[o] < bx0 + r) this.push(k, 1, 0, 0, bx0 + r - p[o], MU_WALL);
    if (p[o] > bx1 - r) this.push(k, -1, 0, 0, p[o] - (bx1 - r), MU_WALL);
    if (p[o + 2] > bz1 - r) this.push(k, 0, 0, -1, p[o + 2] - (bz1 - r), MU_WALL);
    const y = p[o + 1];
    const binTop = B.binY + 0.27;
    if (y < binTop + 0.02) {
      // the bin behind the pickup door: its floor slopes down to the door, which stands open a little way
      const front = B.doorZ - 0.05;
      if (p[o + 2] < front + r) this.push(k, 0, 0, 1, front + r - p[o + 2], MU_WALL);
    } else if (p[o + 2] < bz0 + r) this.push(k, 0, 0, 1, bz0 + r - p[o + 2], MU_WALL);
    if (y - r < B.bedY + 0.001 && y > B.bedY - 0.3) {
      if (!inHole(p[o], p[o + 2])) {
        // the bed's floor, out of the hole; at its edge a particle half over the hole rests on the lip
        if (y < B.bedY + r && y > B.bedY - r * 0.5) this.push(k, 0, 1, 0, B.bedY + r - y, MU_FLOOR);
      }
    }
    if (y < B.bedY + 0.005) {
      // inside the shaft and the bin: its walls are the chute's
      if (inHole(p[o] - r * 0.5, p[o + 2] - r * 0.5) || y < B.bedY - 0.01) {
        // below the guard the shaft widens inside the cabinet, so no prize wedges on its way down
        const wide = y < B.bedY - 0.06 ? 0.07 : 0;
        if (p[o] > cx1 + wide - r) this.push(k, -1, 0, 0, p[o] - (cx1 + wide - r), MU_WALL);
        if (p[o + 2] > cz1 + wide - r) this.push(k, 0, 0, -1, p[o + 2] - (cz1 + wide - r), MU_WALL);
      }
      const fy = B.binY + 0.2 * (p[o + 2] - B.doorZ);
      if (p[o + 1] < fy + r) this.push(k, 0, 1, 0, fy + r - p[o + 1], MU_WALL);
    }
    // the guard round the chute, its two walls and their rim
    const t = 0.004;
    const gy1 = B.bedY + B.guardH;
    if (y - r < gy1 + t) {
      this.boxOut(k, cx1 - t, cx1 + t, B.bedY - 0.02, gy1, bz0 - 0.03, cz1 + t, MU_WALL);
      this.boxOut(k, bx0 - 0.03, cx1 + t, B.bedY - 0.02, gy1, cz1 - t, cz1 + t, MU_WALL);
    }
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
            if (ka) this.push(i, nx, ny, nz, (pen * ka) / sum, MU_PLUSH);
            if (kb) this.push(j, -nx, -ny, -nz, (pen * kb) / sum, MU_PLUSH);
          }
      }
    }
  }

  /** The claw's capsules against the prizes: pushing them out, or (measure) only noting how far each still overlaps one. */
  private collideClaw(measure: boolean) {
    const { p, r, body } = this;
    const N = this.start[this.count];
    const c = this.tmp;
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
        if (!measure) {
          if (this.sleeping[b]) this.wake(b);
          this.push(k, dx / d, dy / d, dz / d, pen, MU_PLUSH);
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

/** What a full machine holds: kinds in stocking order. */
export const STOCK: PrizeKind[] = ["king", "chimp", "banana", "chimp", "coconut", "star", "chimp", "banana", "pinkChimp", "chimp", "star", "coconut", "chimp", "banana", "chimp", "star", "pinkChimp", "chimp", "banana", "coconut"];

/** Drop a prize in from above the bed at a random spot away from the chute, randomly turned. */
export function dropIn(world: PrizeWorld, kind: PrizeKind, rnd: () => number, y: number): number {
  const [x, z, q] = dropSpot(world, rnd);
  return world.add(kind, x, y, z, q);
}

/** Put a prize that was won back in (restocking), dropped from height y. */
export function restock(world: PrizeWorld, b: number, rnd: () => number, y: number): void {
  const [x, z, q] = dropSpot(world, rnd);
  world.place(b, x, y, z, q);
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
