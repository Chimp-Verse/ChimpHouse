// A pinball table's physics, as pure functions of its definition and state (no
// Babylon), so it runs the same in a test as in the page.
//
// The ball moves in the playfield's plane under the slope's share of gravity,
// in fixed steps of half a millisecond. In a step a ball moves under a third of
// its radius even at the fastest a flipper can send it, so it can't pass
// through a wall, post or flipper between steps (the walls are capsules round
// their lines, the flippers the hull of two circles). A flipper is driven by
// its button: it swings up in about 25 ms and its surface's speed where the
// ball touches it goes into the bounce, so a ball hit near the tip flies
// faster than one hit near the base, and a held flipper cradles a ball. Pop
// bumpers and slingshots kick; the plunger is a spring, launching the ball as
// fast as it was pulled back; ramps are a path the ball climbs, rolling back out
// if it was too slow; saucers catch a slow ball and kick it out when the rules
// say; spinners spin for as long as the ball's speed through them lasts.

import { Flipper, PF, TableDef, V2, rampCurve } from "../world/props/pinballTables";

/** Seconds per physics step. */
export const STEP = 1 / 2000;
/** The slope's share of gravity, m/s², and the part pressing the ball into the playfield. */
const G = 9.81 * Math.sin(PF.slope);
const GN = 9.81 * Math.cos(PF.slope);
const R = PF.ball;
/** Rolling losses: a constant drag (m/s²) and a share of speed per second. */
const ROLL = 0.012;
const DRAG = 0.02;
/** The fastest a ball goes, m/s (a hard shot off a flipper's tip). */
const VMAX = 6.5;
/** Flippers: angular speed up and back (rad/s), and how fast they get there (rad/s²). */
const FLIP_UP = 52;
const FLIP_DOWN = 30;
const FLIP_ACC = 5200;
/** The plunger's spring: launch speed per metre pulled back (m/s per m), and how long a full pull takes (s). */
const SPRING = 3.3 / PF.plungerPull;
const PULL_TIME = 0.9;
/** Pop bumpers and slingshots: the speed they send a ball off at, m/s. */
const BUMPER_KICK = 1.65;
const SLING_KICK = 1.45;

export type BallMode = "off" | "free" | "ramp" | "held" | "drained";

export interface Ball {
  mode: BallMode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** height of its centre above the playfield (on a ramp, higher) */
  h: number;
  /** on a ramp: which, how far along and how fast */
  ramp: number;
  s: number;
  u: number;
  /** in a saucer: which */
  scoop: number;
  /** a saucer just kicked it out: it isn't caught again until this runs out */
  noCatch: number;
  /** how long it has barely moved, for a ball search */
  still: number;
  /** last step's position, for lines crossed (rollovers, spinners, ramp mouths, the shooter gate) */
  px: number;
  py: number;
}

export interface FlipperState {
  def: Flipper;
  angle: number;
  /** rad/s */
  w: number;
  held: boolean;
  /** +1 if up is anticlockwise from rest, -1 if clockwise */
  dir: number;
}

export type PhysEvent =
  | { type: "bumper" | "sling" | "target" | "drop" | "rollover" | "scoop" | "kickback" | "rampDone" | "rampFail" | "spin"; id: string; ball: number }
  | { type: "drain" | "launch" | "flipper"; id: string; ball: number }
  | { type: "wall" | "post" | "flip"; id: string; ball: number; speed: number };

/** A line or capsule the ball bounces off. */
interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  t: number;
  e: number;
  mu: number;
  kind: "wall" | "rubber" | "sling" | "target" | "drop" | "gate" | "plunger";
  id: string;
  /** a drop target that's down, or a closed saucer lid: no collisions */
  off: boolean;
  /** for a gate: the way through */
  dx: number;
  dy: number;
  /** for a sling: kicks only after this */
  ready: number;
}

interface Circ {
  x: number;
  y: number;
  r: number;
  e: number;
  kind: "post" | "bumper";
  id: string;
  ready: number;
}

interface RampPath {
  id: string;
  pts: Float64Array;
  /** distance along at each point */
  dist: Float64Array;
  len: number;
  mouthA: V2;
  mouthB: V2;
  inX: number;
  inY: number;
}

interface Spin {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  angle: number;
  w: number;
}

const CELL = 0.04;
const GX0 = -0.3;
const GY0 = -0.1;
const GNX = Math.ceil(0.6 / CELL);
const GNY = Math.ceil(1.25 / CELL);

/** One machine's table: its fixed parts compiled from the definition, and the moving state. */
export class Table {
  readonly balls: Ball[];
  readonly flippers: FlipperState[];
  readonly spinners: Spin[];
  /** each drop target's down-ness, by target id */
  readonly drops = new Map<string, Seg>();
  readonly events: PhysEvent[] = [];
  /** the plunger: how far pulled back (m), its speed (m/s, + toward the ball) and whether it's being pulled */
  plunger = { pull: 0, v: 0, held: false };
  /** lit kickbacks, by id */
  readonly kickLit = new Set<string>();
  /** flippers dead (tilt, game over), and bumpers and slings with them */
  dead = false;
  /** seconds simulated */
  time = 0;

  private segs: Seg[] = [];
  private circs: Circ[] = [];
  private grid: Int32Array[] = [];
  private ramps: RampPath[] = [];
  private acc = 0;
  private plungerSeg: Seg;

  constructor(readonly def: TableDef) {
    const seg = (a: V2, b: V2, o: Partial<Seg>): Seg => {
      const s: Seg = { ax: a[0], ay: a[1], bx: b[0], by: b[1], t: 0, e: 0.45, mu: 0.15, kind: "wall", id: "", off: false, dx: 0, dy: 0, ready: 0, ...o };
      this.segs.push(s);
      return s;
    };
    for (const w of def.walls) {
      const pts = w.closed ? [...w.pts, w.pts[0]] : w.pts;
      const o: Partial<Seg> = w.mat === "rubber" ? { e: 0.78, mu: 0.3, kind: "rubber", t: w.t ?? 0.004 } : { e: w.mat === "metal" ? 0.42 : 0.38, mu: 0.12, t: w.t ?? 0 };
      for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], o);
    }
    for (const p of def.posts) this.circs.push({ x: p.at[0], y: p.at[1], r: p.r, e: 0.7, kind: "post", id: "post", ready: 0 });
    for (const b of def.bumpers) this.circs.push({ x: b.at[0], y: b.at[1], r: b.r, e: 0.6, kind: "bumper", id: b.id, ready: 0 });
    for (const s of def.slings) {
      // the kicking face, the passive faces, and a post at each corner
      seg(s.t, s.c, { kind: "sling", id: s.id, e: 0.7, mu: 0.25, t: 0.003 });
      seg(s.c, s.b, { kind: "rubber", e: 0.7, mu: 0.3, t: 0.003 });
      seg(s.b, s.t, { kind: "rubber", e: 0.7, mu: 0.3, t: 0.003 });
      for (const c of [s.t, s.b, s.c]) this.circs.push({ x: c[0], y: c[1], r: 0.0058, e: 0.65, kind: "post", id: "post", ready: 0 });
    }
    for (const t of def.targets) {
      const s = seg(t.a, t.b, { kind: t.drop ? "drop" : "target", id: t.id, e: 0.3, mu: 0.2, t: 0.003 });
      if (t.drop) this.drops.set(t.id, s);
    }
    for (const g of def.gates) {
      const l = Math.hypot(g.dir[0], g.dir[1]);
      seg(g.a, g.b, { kind: "gate", id: "gate", e: 0.2, t: 0.0015, dx: g.dir[0] / l, dy: g.dir[1] / l });
    }
    this.plungerSeg = { ax: PF.shooterWall + 0.003, ay: PF.plungerY, bx: 0.26, by: PF.plungerY, t: 0, e: 0, mu: 0.3, kind: "plunger", id: "plunger", off: false, dx: 0, dy: 0, ready: 0 };
    for (const r of def.ramps) {
      const c = rampCurve(r);
      const pts = new Float64Array(c.length * 3);
      const dist = new Float64Array(c.length);
      c.forEach((p, i) => {
        pts.set(p, i * 3);
        if (i) dist[i] = dist[i - 1] + Math.hypot(p[0] - c[i - 1][0], p[1] - c[i - 1][1], p[2] - c[i - 1][2]);
      });
      const l = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
      this.ramps.push({ id: r.id, pts, dist, len: dist[c.length - 1], mouthA: r.mouth[0], mouthB: r.mouth[1], inX: (c[1][0] - c[0][0]) / l, inY: (c[1][1] - c[0][1]) / l });
    }
    this.spinners = def.spinners.map((s) => ({ id: s.id, ax: s.a[0], ay: s.a[1], bx: s.b[0], by: s.b[1], angle: 0, w: 0 }));
    this.flippers = def.flippers.map((f) => ({ def: f, angle: f.rest, w: 0, held: false, dir: Math.sign(f.up - f.rest) }));
    this.balls = [0, 1, 2].map(() => ({ mode: "off" as BallMode, x: 0, y: 0, vx: 0, vy: 0, h: R, ramp: -1, s: 0, u: 0, scoop: -1, noCatch: 0, still: 0, px: 0, py: 0 }));
    this.buildGrid();
  }

  /** Bucket the fixed segments and circles into a grid, each in every cell its reach (plus the ball) touches. */
  private buildGrid(): void {
    const lists: number[][] = Array.from({ length: GNX * GNY }, () => []);
    const add = (id: number, x0: number, y0: number, x1: number, y1: number) => {
      const pad = R + 0.01;
      const i0 = Math.max(0, Math.floor((x0 - pad - GX0) / CELL));
      const i1 = Math.min(GNX - 1, Math.floor((x1 + pad - GX0) / CELL));
      const j0 = Math.max(0, Math.floor((y0 - pad - GY0) / CELL));
      const j1 = Math.min(GNY - 1, Math.floor((y1 + pad - GY0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * GNX + i].push(id);
    };
    this.segs.forEach((s, k) => add(k, Math.min(s.ax, s.bx) - s.t, Math.min(s.ay, s.by) - s.t, Math.max(s.ax, s.bx) + s.t, Math.max(s.ay, s.by) + s.t));
    // circles after the segments: ids from 100000
    this.circs.forEach((c, k) => add(100000 + k, c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r));
    this.grid = lists.map((l) => Int32Array.from(l));
  }

  // ------------------------------------------------ controls

  /** A flipper button down or up: every flipper on that side. */
  setFlipper(button: "L" | "R", down: boolean): void {
    for (const f of this.flippers) if (f.def.button === button) f.held = down;
  }

  /** Pull the plunger back (held) or let it go. */
  setPlunger(held: boolean): void {
    this.plunger.held = held;
  }

  /** Fire the plunger by itself, pulled back `strength` (0..1) of the way: a ball save or multiball's launch. */
  autoLaunch(strength: number): void {
    this.plunger.held = false;
    this.plunger.pull = PF.plungerPull * Math.max(0, Math.min(1, strength));
    this.plunger.v = 0;
    // a ball in the lane sits on the pulled-back tip, as it would have followed it down
    for (const b of this.balls)
      if (b.mode === "free" && b.x > PF.shooterWall && b.y < 0.25) {
        b.y = b.py = PF.plungerY - this.plunger.pull + R + 0.0002;
        b.vy = 0;
      }
  }

  /** Bump the cabinet: every ball on the playfield gets a push, m/s (x across, y up the playfield). */
  nudge(dx: number, dy: number): void {
    for (const b of this.balls) {
      if (b.mode !== "free") continue;
      b.vx += dx;
      b.vy += dy;
    }
  }

  /** Put a ball on the plunger in the shooter lane; returns its index, or -1 with all three in play. */
  serve(): number {
    const i = this.balls.findIndex((b) => b.mode === "off" || b.mode === "drained");
    if (i < 0) return -1;
    const b = this.balls[i];
    Object.assign(b, { mode: "free", x: PF.shooterX, y: PF.plungerY - this.plunger.pull + R + 0.0005, vx: 0, vy: 0, h: R, ramp: -1, scoop: -1, noCatch: 0, still: 0 });
    b.px = b.x;
    b.py = b.y;
    return i;
  }

  /** Take every ball off the table (game over, a new game). */
  clear(): void {
    for (const b of this.balls) b.mode = "off";
    for (const f of this.flippers) {
      f.held = false;
      f.angle = f.def.rest;
      f.w = 0;
    }
    this.plunger = { pull: 0, v: 0, held: false };
  }

  /** Kick the ball out of its saucer. */
  eject(ball: number): void {
    const b = this.balls[ball];
    if (b.mode !== "held") return;
    const sc = this.def.scoops[b.scoop];
    b.mode = "free";
    b.vx = sc.eject[0];
    b.vy = sc.eject[1];
    b.noCatch = 0.5;
    b.scoop = -1;
  }

  /** Put drop targets back up. */
  raiseDrops(ids: string[]): void {
    for (const id of ids) {
      const s = this.drops.get(id);
      if (s) s.off = false;
    }
  }

  /** Whether a drop target is down. */
  dropped(id: string): boolean {
    return this.drops.get(id)?.off ?? false;
  }

  /** Balls on the table (on the playfield, a ramp or in a saucer). */
  get inPlay(): number {
    let n = 0;
    for (const b of this.balls) if (b.mode === "free" || b.mode === "ramp" || b.mode === "held") n++;
    return n;
  }

  /** Whether a ball sits in the shooter lane, waiting for the plunger. */
  ballInLane(): boolean {
    return this.balls.some((b) => b.mode === "free" && b.x > PF.shooterWall && b.y < 0.25);
  }

  // ------------------------------------------------ stepping

  /** Move on by dt seconds of real time, in fixed steps. */
  advance(dt: number): void {
    this.acc = Math.min(this.acc + dt, 0.06);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  /** One fixed step. */
  step(dt: number): void {
    this.time += dt;
    this.stepFlippers(dt);
    this.stepPlunger(dt);
    for (const s of this.spinners) {
      s.angle += s.w * dt;
      s.w -= Math.sign(s.w) * (6 + 0.6 * Math.abs(s.w)) * dt;
      if (Math.abs(s.w) < 0.5) s.w = 0;
      if (s.w !== 0 && Math.floor((s.angle - s.w * dt) / (Math.PI * 2)) !== Math.floor(s.angle / (Math.PI * 2))) this.events.push({ type: "spin", id: s.id, ball: -1 });
    }
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.mode === "free") this.stepFree(b, i, dt);
      else if (b.mode === "ramp") this.stepRamp(b, i, dt);
    }
    // balls knock each other
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) {
        const a = this.balls[i];
        const c = this.balls[j];
        if (a.mode !== "free" || c.mode !== "free") continue;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= 2 * R || d < 1e-9) continue;
        const nx = dx / d;
        const ny = dy / d;
        const pen = 2 * R - d;
        a.x -= (nx * pen) / 2;
        a.y -= (ny * pen) / 2;
        c.x += (nx * pen) / 2;
        c.y += (ny * pen) / 2;
        const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (vn < 0) {
          const j2 = (-(1 + 0.9) * vn) / 2;
          a.vx -= j2 * nx;
          a.vy -= j2 * ny;
          c.vx += j2 * nx;
          c.vy += j2 * ny;
        }
      }
  }

  private stepFlippers(dt: number): void {
    for (const f of this.flippers) {
      const up = f.held && !this.dead;
      const target = up ? f.def.up : f.def.rest;
      const sign = up ? f.dir : -f.dir;
      const wmax = up ? FLIP_UP : FLIP_DOWN;
      f.w += sign * FLIP_ACC * dt;
      if (Math.abs(f.w) > wmax) f.w = sign * wmax;
      if (Math.sign(f.w) !== sign) f.w = sign * Math.min(Math.abs(f.w), FLIP_ACC * dt);
      f.angle += f.w * dt;
      // the stop: up at the end of its stroke, down at rest
      if ((f.angle - target) * sign >= 0) {
        f.angle = target;
        f.w = 0;
      }
    }
  }

  private stepPlunger(dt: number): void {
    const p = this.plunger;
    if (p.held) {
      p.pull = Math.min(PF.plungerPull, p.pull + (PF.plungerPull / PULL_TIME) * dt);
      p.v = 0;
    } else if (p.pull > 0) {
      // the spring: accelerates toward rest, and stops dead there
      p.v += SPRING * SPRING * p.pull * dt;
      p.pull -= p.v * dt;
      if (p.pull <= 0) {
        p.pull = 0;
        p.v = 0;
      }
    } else p.v = 0;
    const s = this.plungerSeg;
    s.ay = s.by = PF.plungerY - p.pull;
  }

  private stepFree(b: Ball, i: number, dt: number): void {
    b.px = b.x;
    b.py = b.y;
    b.vy -= G * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      const k = Math.max(0, sp - (ROLL + DRAG * sp) * dt) / sp;
      b.vx *= k;
      b.vy *= k;
    }
    if (sp > VMAX) {
      b.vx *= VMAX / sp;
      b.vy *= VMAX / sp;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.h = R;
    if (b.noCatch > 0) b.noCatch -= dt;
    // the fixed parts near it
    const ci = Math.floor((b.x - GX0) / CELL);
    const cj = Math.floor((b.y - GY0) / CELL);
    if (ci >= 0 && cj >= 0 && ci < GNX && cj < GNY) {
      const list = this.grid[cj * GNX + ci];
      for (let k = 0; k < list.length; k++) {
        const id = list[k];
        if (id >= 100000) this.hitCircle(b, i, this.circs[id - 100000]);
        else this.hitSeg(b, i, this.segs[id], 0, 0);
      }
    }
    for (const f of this.flippers) this.hitFlipper(b, i, f);
    if (b.x > PF.shooterWall) this.hitSeg(b, i, this.plungerSeg, 0, this.plunger.v);
    // the outer walls as a last resort (a ball shoved outside the grid comes back)
    if (b.x < -0.26 + R) {
      b.x = -0.26 + R;
      if (b.vx < 0) b.vx = -b.vx * 0.3;
    } else if (b.x > 0.26 - R) {
      b.x = 0.26 - R;
      if (b.vx > 0) b.vx = -b.vx * 0.3;
    }
    this.triggers(b, i);
    // drained: below the apron, left of the shooter lane
    if (b.y < PF.drain && b.x < PF.shooterWall) {
      b.mode = "drained";
      this.events.push({ type: "drain", id: "drain", ball: i });
      return;
    }
    // a ball search: one that has sat still a while (not on the plunger, not cradled) gets a nudge
    const resting = b.x > PF.shooterWall && b.y < 0.2;
    let cradled = false;
    for (let k = 0; k < this.flippers.length; k++) {
      const f = this.flippers[k];
      if (f.held && Math.hypot(b.x - f.def.pivot[0], b.y - f.def.pivot[1]) < f.def.len + 0.03) cradled = true;
    }
    if (!resting && !cradled && Math.hypot(b.vx, b.vy) < 0.03) {
      b.still += dt;
      if (b.still > 3) {
        b.still = 0;
        b.vx += (Math.sin(this.time * 7.3) > 0 ? 1 : -1) * 0.4;
        b.vy += 0.5;
      }
    } else b.still = 0;
  }

  /** Bounce off a segment (a capsule of half-thickness t round it), moving at (svx, svy). */
  private hitSeg(b: Ball, i: number, s: Seg, svx: number, svy: number): void {
    if (s.off) return;
    const abx = s.bx - s.ax;
    const aby = s.by - s.ay;
    const l2 = abx * abx + aby * aby;
    let t = l2 > 0 ? ((b.x - s.ax) * abx + (b.y - s.ay) * aby) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = s.ax + abx * t;
    const qy = s.ay + aby * t;
    let nx = b.x - qx;
    let ny = b.y - qy;
    const d = Math.hypot(nx, ny);
    const reach = R + s.t;
    if (d >= reach) return;
    if (d < 1e-9) {
      nx = -aby;
      ny = abx;
    }
    const nl = d < 1e-9 ? Math.hypot(nx, ny) : d;
    nx /= nl;
    ny /= nl;
    if (s.kind === "gate") {
      // a one-way gate: through it the way it opens; a wall coming back
      const side = (b.x - s.ax) * -aby + (b.y - s.ay) * abx;
      const along = -aby * s.dx + abx * s.dy;
      if (side * along < 0 || b.vx * s.dx + b.vy * s.dy > 0) return;
    }
    this.resolve(b, i, nx, ny, reach - d, svx, svy, s.e, s.mu, s);
  }

  private hitCircle(b: Ball, i: number, c: Circ): void {
    let nx = b.x - c.x;
    let ny = b.y - c.y;
    const d = Math.hypot(nx, ny);
    const reach = R + c.r;
    if (d >= reach || d < 1e-9) return;
    nx /= d;
    ny /= d;
    b.x += nx * (reach - d);
    b.y += ny * (reach - d);
    const vn = b.vx * nx + b.vy * ny;
    if (c.kind === "bumper" && !this.dead && this.time >= c.ready) {
      // the bumper's ring pulls down and throws the ball off
      const out = Math.max(BUMPER_KICK, -vn * 0.6);
      b.vx += (out - vn) * nx;
      b.vy += (out - vn) * ny;
      c.ready = this.time + 0.08;
      this.events.push({ type: "bumper", id: c.id, ball: i });
      return;
    }
    if (vn < 0) {
      const e = -vn < 0.1 ? 0 : c.e;
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      if (-vn > 0.4) this.events.push({ type: "post", id: c.id, ball: i, speed: -vn });
    }
  }

  /** Separate a ball from a surface and bounce it: normal (nx, ny) out of the surface, the surface moving at (svx, svy). */
  private resolve(b: Ball, i: number, nx: number, ny: number, pen: number, svx: number, svy: number, e: number, mu: number, s: Seg | null): void {
    b.x += nx * pen;
    b.y += ny * pen;
    const rvx = b.vx - svx;
    const rvy = b.vy - svy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;
    const impact = -vn;
    if (s && s.kind === "sling" && !this.dead && impact > 0.18 && this.time >= s.ready) {
      // the slingshot fires: its rubber throws the ball back out
      const out = Math.max(SLING_KICK, impact * 0.7);
      b.vx += (out + impact) * nx;
      b.vy += (out + impact) * ny;
      s.ready = this.time + 0.12;
      this.events.push({ type: "sling", id: s.id, ball: i });
      return;
    }
    const ee = impact < 0.08 ? 0 : e;
    const jn = (1 + ee) * impact;
    // friction along the surface, no more than stops its sliding
    const tx = -ny;
    const ty = nx;
    const vt = rvx * tx + rvy * ty;
    const jt = Math.min(Math.abs(vt), mu * jn) * Math.sign(vt);
    b.vx += jn * nx - jt * tx;
    b.vy += jn * ny - jt * ty;
    if (!s) return;
    if (s.kind === "drop" && impact > 0.15) {
      s.off = true;
      this.events.push({ type: "drop", id: s.id, ball: i });
    } else if (s.kind === "target" && impact > 0.1) this.events.push({ type: "target", id: s.id, ball: i });
    else if (impact > 0.35 && s.kind !== "plunger") this.events.push({ type: "wall", id: s.kind, ball: i, speed: impact });
  }

  /** A flipper: the hull of its base and tip circles, turning about its pivot. */
  private hitFlipper(b: Ball, i: number, f: FlipperState): void {
    const { pivot, len, r1, r2 } = f.def;
    const px = pivot[0];
    const py = pivot[1];
    // quick reject
    const dx0 = b.x - px;
    const dy0 = b.y - py;
    if (dx0 * dx0 + dy0 * dy0 > (len + r1 + R + 0.01) ** 2) return;
    const c = Math.cos(f.angle);
    const s = Math.sin(f.angle);
    // the ball in the flipper's frame (pivot at 0, tip along +x)
    const lx = dx0 * c + dy0 * s;
    const ly = -dx0 * s + dy0 * c;
    // nearest of: the base circle, the tip circle, and the two tangent sides
    const a = Math.asin((r1 - r2) / len);
    let best = Infinity;
    let qx = 0;
    let qy = 0;
    // the circles (no closures or arrays here: this runs 2000 times a second)
    for (let k = 0; k < 2; k++) {
      const cx = k === 0 ? 0 : len;
      const r = k === 0 ? r1 : r2;
      const ex = lx - cx;
      const d = Math.hypot(ex, ly);
      if (d - r < best && d > 1e-9) {
        best = d - r;
        qx = cx + (ex / d) * r;
        qy = (ly / d) * r;
      }
    }
    const na = Math.sin(a);
    const nb = Math.cos(a);
    for (let k = 0; k < 2; k++) {
      // the tangent side's outward normal, and its ends on the two circles
      const nx = na;
      const ny = k === 0 ? nb : -nb;
      const ax = nx * r1;
      const ay = ny * r1;
      const ex = len + nx * r2 - ax;
      const ey = ny * r2 - ay;
      let t = ((lx - ax) * ex + (ly - ay) * ey) / (ex * ex + ey * ey);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const sx = ax + ex * t;
      const sy = ay + ey * t;
      // only from outside: the ball on the normal's side
      if ((lx - sx) * nx + (ly - sy) * ny < 0) continue;
      const d = Math.hypot(lx - sx, ly - sy);
      if (d < best) {
        best = d;
        qx = sx;
        qy = sy;
      }
    }
    if (best >= R) return;
    // back to the playfield: the contact point and the normal from it to the ball
    const wx = px + qx * c - qy * s;
    const wy = py + qx * s + qy * c;
    let nx = b.x - wx;
    let ny = b.y - wy;
    const d = Math.hypot(nx, ny) || 1e-9;
    nx /= d;
    ny /= d;
    // the flipper's surface moves at w × r where it touches
    const svx = -f.w * (wy - py);
    const svy = f.w * (wx - px);
    const rvn = (b.vx - svx) * nx + (b.vy - svy) * ny;
    if (rvn < -0.3) this.events.push({ type: "flip", id: f.def.id, ball: i, speed: -rvn });
    this.resolve(b, i, nx, ny, R - best, svx, svy, -rvn < 0.25 ? 0 : 0.55, 0.25, null);
  }

  /** Lines and spots the ball passes: rollovers, spinners, saucers, kickbacks, ramp mouths, the shooter gate. */
  private triggers(b: Ball, i: number): void {
    for (const r of this.def.rollovers) {
      const d1 = Math.hypot(b.x - r.at[0], b.y - r.at[1]);
      const d0 = Math.hypot(b.px - r.at[0], b.py - r.at[1]);
      if (d1 < 0.014 && d0 >= 0.014) this.events.push({ type: "rollover", id: r.id, ball: i });
    }
    for (const s of this.spinners) {
      if (crossed(b.px, b.py, b.x, b.y, s.ax, s.ay, s.bx, s.by)) {
        const speed = Math.abs(b.vy);
        s.w = Math.sign(b.vy || 1) * Math.max(Math.abs(s.w), (speed / 0.0145) * 0.35);
        b.vx *= 0.95;
        b.vy *= 0.95;
      }
    }
    const scoops = this.def.scoops;
    for (let k = 0; k < scoops.length && b.noCatch <= 0; k++) {
      const sc = scoops[k];
      if (Math.hypot(b.x - sc.at[0], b.y - sc.at[1]) < 0.014 && Math.hypot(b.vx, b.vy) < 1.7) {
        b.mode = "held";
        b.x = sc.at[0];
        b.y = sc.at[1];
        b.vx = b.vy = 0;
        b.h = R - 0.006;
        b.scoop = k;
        this.events.push({ type: "scoop", id: sc.id, ball: i });
        break;
      }
    }
    if (b.mode !== "free") return;
    for (const kb of this.def.kickbacks) {
      if (this.kickLit.has(kb.id) && b.vy < 0 && Math.hypot(b.x - kb.at[0], b.y - kb.at[1]) < 0.016) {
        b.vx = kb.v[0];
        b.vy = kb.v[1];
        this.kickLit.delete(kb.id);
        this.events.push({ type: "kickback", id: kb.id, ball: i });
      }
    }
    for (let k = 0; k < this.ramps.length; k++) {
      const r = this.ramps[k];
      // in across the mouth, moving up the ramp
      if (crossed(b.px, b.py, b.x, b.y, r.mouthA[0], r.mouthA[1], r.mouthB[0], r.mouthB[1])) {
        // the ramp's side walls turn an angled ball up it, keeping most of its speed
        const sp = Math.hypot(b.vx, b.vy);
        const along = sp > 0 ? (b.vx * r.inX + b.vy * r.inY) / sp : 0;
        if (along <= 0.2) continue;
        const u = sp * (0.55 + 0.45 * along);
        b.mode = "ramp";
        b.ramp = k;
        b.s = 0;
        b.u = u;
        return;
      }
    }
    // out of the shooter lane, past its gate
    const g = this.def.gates[0];
    if (g && b.px > PF.shooterWall && crossed(b.px, b.py, b.x, b.y, g.a[0], g.a[1], g.b[0], g.b[1]) && b.vy > 0) this.events.push({ type: "launch", id: "gate", ball: i });
  }

  /** On a ramp: along its path, slowed by the climb; out the far end, or back out of the mouth. */
  private stepRamp(b: Ball, i: number, dt: number): void {
    const r = this.ramps[b.ramp];
    const n = r.dist.length;
    let k = 0;
    while (k < n - 2 && r.dist[k + 1] < b.s) k++;
    const P = r.pts;
    const seg = r.dist[k + 1] - r.dist[k] || 1e-6;
    const ty = (P[(k + 1) * 3 + 1] - P[k * 3 + 1]) / seg;
    const th = (P[(k + 1) * 3 + 2] - P[k * 3 + 2]) / seg;
    // gravity along it: the playfield's slope and the climb; and rolling losses
    b.u += (-G * ty - GN * th) * dt;
    b.u -= Math.sign(b.u) * (0.05 + 0.05 * Math.abs(b.u)) * dt;
    b.s += b.u * dt;
    const f = Math.max(0, Math.min(1, (b.s - r.dist[k]) / seg));
    b.px = b.x;
    b.py = b.y;
    b.x = P[k * 3] + (P[(k + 1) * 3] - P[k * 3]) * f;
    b.y = P[k * 3 + 1] + (P[(k + 1) * 3 + 1] - P[k * 3 + 1]) * f;
    b.h = R + P[k * 3 + 2] + (P[(k + 1) * 3 + 2] - P[k * 3 + 2]) * f;
    if (b.s >= r.len) {
      // off the end, back on the playfield
      const j = (n - 2) * 3;
      const ex = P[j + 3] - P[j];
      const ey = P[j + 4] - P[j + 1];
      const el = Math.hypot(ex, ey) || 1;
      b.mode = "free";
      b.x = P[j + 3];
      b.y = P[j + 4];
      b.h = R;
      b.vx = (ex / el) * b.u * 0.9;
      b.vy = (ey / el) * b.u * 0.9;
      this.events.push({ type: "rampDone", id: r.id, ball: i });
    } else if (b.s <= 0) {
      // too slow: it rolled back out of the mouth
      b.mode = "free";
      b.x = r.pts[0] - r.inX * 0.002;
      b.y = r.pts[1] - r.inY * 0.002;
      b.h = R;
      b.vx = r.inX * b.u;
      b.vy = r.inY * b.u;
      this.events.push({ type: "rampFail", id: r.id, ball: i });
    }
  }
}

/** Whether the move p0 → p1 crosses the segment a → b. */
function crossed(p0x: number, p0y: number, p1x: number, p1y: number, ax: number, ay: number, bx: number, by: number): boolean {
  const d1 = (bx - ax) * (p0y - ay) - (by - ay) * (p0x - ax);
  const d2 = (bx - ax) * (p1y - ay) - (by - ay) * (p1x - ax);
  if (d1 * d2 > 0 || (d1 === 0 && d2 === 0)) return false;
  const d3 = (p1x - p0x) * (ay - p0y) - (p1y - p0y) * (ax - p0x);
  const d4 = (p1x - p0x) * (by - p0y) - (p1y - p0y) * (bx - p0x);
  return d3 * d4 <= 0;
}
