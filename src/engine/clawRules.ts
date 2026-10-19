// A play of the claw machine, as pure rules (no Babylon), driving the claw's
// pose and the prizes' bodies (engine/clawPhysics.ts). engine/clawMachine.ts
// shows the pose and feeds in the controls.
//
// A play: the visitor steers the trolley with the joystick while the credit
// timer runs down, then drops (the button, or the timer running out). The claw
// opens, lowers on its cable until it lands on something (or the bed), closes,
// each prong stopping where it meets a prize, and winds back up. At the top it
// travels back over the chute by itself and opens.
//
// Whether a prize comes up with it is the machine's, as on a real one:
// - The gantry has inertia and the claw swings on its cable as the trolley
//   starts and stops, so it lands where the swing has it, not where it was aimed.
// - What the prongs catch decides the hold: how many touch the prize, whether
//   their tips are under its centre of mass, how near the middle of the claw
//   its centre is, the prize's shape (a chimp's neck and arms catch, a ball
//   rolls out) and anything lying on top of it.
// - Grip strength is set per play, mostly weak, now and then strong (the payout
//   rate). It is full while the claw picks up and drops to a weaker carrying
//   grip at the top, where the claw stops with a jolt; the swing on the way to
//   the chute shakes it too. Each of those can make the prize slip.
// So a prize can come up and fall at the top, slide off on the way, or land on
// the chute's rim, and only a good grab on a strong-enough play wins. README
// ("Playing the claw machine") has the numbers.

import { CHUTE_DOWN, ClawBox, PRIZES, PrizeWorld, capsule, seeded } from "./clawPhysics";

/** The claw's and the controls' places, which the engine shows (machine frame, metres). */
export interface ClawPose {
  /** the trolley over the bed */
  x: number;
  z: number;
  /** the cable's length below its top */
  cable: number;
  /** the head's swing off the plumb line, at the head */
  swingX: number;
  swingZ: number;
  /** each prong: 0 shut, 1 wide open */
  open: [number, number, number];
  /** the joystick's lean (-1..1: right, away) and the drop button's travel (0 up, 1 pressed) */
  joyX: number;
  joyZ: number;
  button: number;
  /** the pickup door's flap, 0 shut to 1 swung open */
  door: number;
}

/** The machine's measurements the rules need (props/clawMachine.ts ClawSpec). */
export interface ClawRig extends ClawBox {
  travel: [number, number, number, number];
  home: [number, number];
  cableTop: number;
  cableUp: number;
  hingeDrop: number;
  hingeR: number;
}

export type ClawPhase = "idle" | "aim" | "drop" | "grab" | "lift" | "carry" | "release" | "reset" | "over";

/** The controls, as this frame has them. */
export interface ClawInput {
  /** the joystick: -1..1 to the player's right (x) and away from them (z) */
  x: number;
  z: number;
  /** the drop button is down */
  drop: boolean;
}

/** What happened in a play, for the display, the sounds and the HUD. */
export type ClawEvent =
  | { kind: "start" }
  | { kind: "drop" }
  | { kind: "land" }
  | { kind: "close" }
  | { kind: "grab"; prize: number; hold: number }
  | { kind: "slip"; prize: number; where: "lift" | "top" | "carry" }
  | { kind: "top" }
  | { kind: "release" }
  | { kind: "won"; prize: number }
  | { kind: "over"; won: number[] };

/** The tuning, in one place (README "Playing the claw machine"). */
export const CLAW_TUNING = {
  /** seconds to steer per credit */
  time: 20,
  /** gantry speed (m/s) and how fast it gets up to speed and stops (m/s²): gently, as a real gantry's motors ramp */
  speed: 0.19,
  accel: 0.5,
  /** the swing's damping (1/s): the head's weight and the cable's stiffness kill a swing within a second or so */
  swingDamp: 3,
  /** lowering and winding up (m/s) */
  dropSpeed: 0.3,
  liftSpeed: 0.24,
  /** seconds for the prongs to open and to close */
  openTime: 0.3,
  closeTime: 0.85,
  /** how far (m) the claw must be left pressing into a prize to have landed on it (it sinks a little into the plush), and a prong to be stopped by one */
  landPress: 0.008,
  prongPress: 0.004,
  /** the chance a play is strong (the payout rate), and the grip of strong and weak plays (0..1) */
  strongChance: 1 / 4,
  strong: [0.9, 1.0] as [number, number],
  weak: [0.3, 0.62] as [number, number],
  /** the carrying grip after the top, as a share of the pick-up grip: strong and weak plays */
  carryStrong: 0.95,
  carryWeak: 0.62,
  /** what a prize needs held: (its mass + half what lies on it) times this */
  needPerKg: 2.2,
  /** how much the jolt at the top and a swing on the way take off the grip, the swing's at its full swing speed (m/s) */
  jolt: 0.15,
  swingShake: 0.35,
  swingFull: 0.07,
};

const T = CLAW_TUNING;
const G = 9.81;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const toward = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

/** One play's plan for a grabbed prize: its hold, and where (if anywhere) it slips. */
interface Grip {
  prize: number;
  /** the hold's quality (0..1) and what the prize needs */
  hold: number;
  need: number;
  /** the grip's strength picking up and carrying */
  pick: number;
  carry: number;
  /** slipping on the lift: at this much cable wound in (m), or never */
  slipLift: number;
  /** the held prize's centre relative to the head, and its turn, as grabbed */
  off: [number, number, number];
  q: [number, number, number, number];
  /** how far it has sagged in the prongs since */
  sag: number;
}

export class ClawGame {
  phase: ClawPhase = "idle";
  /** seconds left to steer */
  timer = 0;
  /** seconds in this phase */
  private t = 0;
  /** the gantry's velocity, and the swing's */
  private vx = 0;
  private vz = 0;
  private svx = 0;
  private svz = 0;
  /** this play's grip strength, and whether it is a strong play */
  strength = 0;
  strongPlay = false;
  private grip: Grip | null = null;
  /** prongs that met a prize while closing: per prong, the body (or -1) */
  private met: [number, number, number] = [-1, -1, -1];
  private fromCable = 0;
  /** what the claw lands at, for the grip */
  private wasDown = false;
  /** prizes in the chute already counted as won */
  private counted = new Set<number>();
  /** won this play */
  won: number[] = [];
  /** what happened since the last `events` read */
  readonly events: ClawEvent[] = [];
  /** for tests: force the next play's grip strength (0..1), or null for the machine's own */
  forceStrength: number | null = null;
  private dropWas = false;
  /** the prongs have gone slack (after a slip) until they next open */
  private slack = false;

  constructor(
    readonly world: PrizeWorld,
    readonly rig: ClawRig,
    readonly pose: ClawPose,
    private rnd: () => number = Math.random,
  ) {
    for (let i = 0; i < 7; i++) world.claw.push(capsule());
    this.placeCapsules();
  }

  /** Back to between plays, nothing held, nothing counted (the machine reset). */
  reset(): void {
    this.phase = "idle";
    this.t = 0;
    this.timer = 0;
    this.vx = this.vz = this.svx = this.svz = 0;
    this.grip = null;
    this.slack = false;
    this.counted.clear();
    this.won = [];
    this.events.length = 0;
  }

  /** A credit: the timer starts and the joystick works. Only between plays. */
  start(): boolean {
    if (this.phase !== "idle" && this.phase !== "over") return false;
    this.phase = "aim";
    this.t = 0;
    this.timer = T.time;
    this.won = [];
    this.grip = null;
    this.strongPlay = this.forceStrength === null ? this.rnd() < T.strongChance : this.forceStrength >= T.strong[0];
    const [a, b] = this.strongPlay ? T.strong : T.weak;
    this.strength = this.forceStrength ?? a + (b - a) * this.rnd();
    this.events.push({ kind: "start" });
    return true;
  }

  /** Whether the claw (or anything it set going) is moving: otherwise the engine needn't step it. */
  get busy(): boolean {
    return this.phase !== "idle" && this.phase !== "over";
  }

  /** The trolley's speed (m/s). */
  get trolleySpeed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** Advance the play by dt seconds with these controls, in steps of at most 1/120 s, so it plays the same at any frame rate. */
  step(dt: number, input: ClawInput): void {
    dt = Math.min(dt, 0.1);
    const n = Math.max(1, Math.ceil(dt * 120 - 1e-6));
    for (let i = 0; i < n; i++) this.tick(dt / n, input);
  }

  private tick(dt: number, input: ClawInput): void {
    const p = this.pose;
    const R = this.rig;
    this.t += dt;
    const press = input.drop && !this.dropWas;
    this.dropWas = input.drop;
    p.button = toward(p.button, input.drop ? 1 : 0, dt * 14);
    const steer = this.phase === "aim";
    p.joyX = toward(p.joyX, steer ? clamp(input.x, -1, 1) : 0, dt * 9);
    p.joyZ = toward(p.joyZ, steer ? clamp(input.z, -1, 1) : 0, dt * 9);

    // the gantry: steered while aiming, driven home while carrying, still otherwise
    let tvx = 0;
    let tvz = 0;
    if (steer) {
      tvx = clamp(input.x, -1, 1) * T.speed;
      tvz = clamp(input.z, -1, 1) * T.speed;
    } else if (this.phase === "carry") {
      const dx = R.home[0] - p.x;
      const dz = R.home[1] - p.z;
      const d = Math.hypot(dx, dz);
      // slow into the stop as a real gantry's motors do (v² = 2 a d)
      const v = Math.min(T.speed, Math.sqrt(2 * T.accel * 0.8 * d));
      if (d > 1e-4) {
        tvx = (dx / d) * v;
        tvz = (dz / d) * v;
      }
    }
    const ax0 = this.vx;
    const az0 = this.vz;
    this.vx = toward(this.vx, tvx, T.accel * dt);
    this.vz = toward(this.vz, tvz, T.accel * dt);
    const [x0, x1, z0, z1] = R.travel;
    p.x += this.vx * dt;
    p.z += this.vz * dt;
    if (p.x < x0 || p.x > x1) {
      p.x = clamp(p.x, x0, x1);
      this.vx = 0;
    }
    if (p.z < z0 || p.z > z1) {
      p.z = clamp(p.z, z0, z1);
      this.vz = 0;
    }
    // the swing: a pendulum on the cable, pushed by the trolley's speeding up and slowing down
    const ax = (this.vx - ax0) / dt;
    const az = (this.vz - az0) / dt;
    const L = Math.max(0.03, p.cable);
    const n = Math.ceil(dt * 240);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.svx += (-(G / L) * p.swingX - T.swingDamp * this.svx - ax) * h;
      this.svz += (-(G / L) * p.swingZ - T.swingDamp * this.svz - az) * h;
      p.swingX += this.svx * h;
      p.swingZ += this.svz * h;
    }
    const lim = L * 0.5;
    p.swingX = clamp(p.swingX, -lim, lim);
    p.swingZ = clamp(p.swingZ, -lim, lim);

    this.phaseStep(dt, press);
    this.placeCapsules();
    this.holdPrize(dt);
    this.world.step(dt);
    this.sense();
    this.watchChute();
  }

  private next(phase: ClawPhase) {
    this.phase = phase;
    this.t = 0;
  }

  private phaseStep(dt: number, press: boolean) {
    const p = this.pose;
    const R = this.rig;
    const openTo = (v: number, time: number) => {
      for (let i = 0; i < 3; i++) p.open[i] = toward(p.open[i], v, dt / time);
    };
    if (this.slack && (this.phase === "lift" || this.phase === "carry")) for (let i = 0; i < 3; i++) p.open[i] = Math.max(p.open[i], toward(p.open[i], 0.6, dt / 0.25));
    if (this.phase === "release" || this.phase === "aim") this.slack = false;
    switch (this.phase) {
      case "idle":
      case "over":
        openTo(0.45, 0.6);
        return;
      case "aim":
        this.timer = Math.max(0, this.timer - dt);
        if (press || this.timer <= 0) {
          this.next("drop");
          this.wasDown = false;
          this.events.push({ kind: "drop" });
        }
        return;
      case "drop": {
        openTo(1, T.openTime);
        if (this.t < 0.15) return;
        const max = R.cableTop - R.hingeDrop - 0.115 - R.bedY + 0.004;
        if (this.wasDown) {
          // a moment at the bottom, then close
          if (this.t > 0.3) {
            this.next("grab");
            this.met = [-1, -1, -1];
            this.events.push({ kind: "close" });
          }
          return;
        }
        p.cable = Math.min(max, p.cable + T.dropSpeed * dt);
        if (p.cable >= max || this.world.clawPress > T.landPress) {
          this.wasDown = true;
          this.t = 0;
          this.events.push({ kind: "land" });
        }
        return;
      }
      case "grab": {
        let moving = false;
        for (let i = 0; i < 3; i++) {
          const pressed = Math.max(this.world.capPress[1 + i * 2] ?? 0, this.world.capPress[2 + i * 2] ?? 0);
          const body = (this.world.capPress[2 + i * 2] ?? 0) >= (this.world.capPress[1 + i * 2] ?? 0) ? this.world.capBody[2 + i * 2] : this.world.capBody[1 + i * 2];
          if (pressed > T.prongPress && body >= 0) {
            this.met[i] = body;
            continue;
          }
          if (p.open[i] > 0) {
            p.open[i] = Math.max(0, p.open[i] - dt / T.closeTime);
            moving = true;
          }
        }
        if ((!moving && this.t > 0.2) || this.t > T.closeTime * 1.4) {
          this.decide();
          this.fromCable = p.cable;
          this.next("lift");
        }
        return;
      }
      case "lift": {
        if (this.t < 0.25) return;
        p.cable = Math.max(R.cableUp, p.cable - T.liftSpeed * dt);
        const g = this.grip;
        if (g && this.fromCable - p.cable > g.slipLift) this.slip("lift");
        if (p.cable <= R.cableUp) {
          // the jolt at the top: the claw stops dead and the grip drops to carrying strength
          const kick = 0.05 + this.rnd() * 0.05;
          const a = this.rnd() * Math.PI * 2;
          this.svx += Math.cos(a) * kick;
          this.svz += Math.sin(a) * kick;
          this.events.push({ kind: "top" });
          if (g && g.carry * g.hold * (1 - T.jolt) * (0.94 + 0.12 * this.rnd()) < g.need) this.slip("top");
          this.next("carry");
        }
        return;
      }
      case "carry": {
        if (this.t < 0.35) {
          this.vx = this.vz = 0;
          return;
        }
        const g = this.grip;
        if (g) {
          const sw = Math.min(1, Math.hypot(this.svx, this.svz) / T.swingFull);
          if (g.carry * g.hold * (1 - T.swingShake * sw) < g.need) this.slip("carry");
        }
        if (Math.hypot(R.home[0] - p.x, R.home[1] - p.z) < 0.003 && Math.hypot(this.vx, this.vz) < 0.01) {
          this.next("release");
          this.events.push({ kind: "release" });
        }
        return;
      }
      case "release":
        openTo(1, T.openTime);
        if (this.grip && p.open[0] > 0.45) {
          this.world.hold(-1);
          this.grip = null;
        }
        if (this.t > 1.6) this.next("reset");
        return;
      case "reset":
        openTo(0.45, 0.5);
        // not over while a prize is still in the chute's mouth: it is on its way in (or off the rim), and decides the play
        if (this.t > 1.0 && (((this.world.settled || this.t > 5) && !this.inMouth()) || this.t > 12)) {
          this.next("over");
          this.events.push({ kind: "over", won: [...this.won] });
        }
        return;
    }
  }

  /** The prize slips out of the prongs. */
  private slip(where: "lift" | "top" | "carry") {
    const g = this.grip;
    if (!g) return;
    this.world.hold(-1);
    this.grip = null;
    // a weak claw sags open under the weight it lost, so the prize drops clear rather than riding the shut prongs
    this.slack = true;
    this.events.push({ kind: "slip", prize: g.prize, where });
  }

  /**
   * The prongs have shut on what they met: is it held, and how well? The prize
   * most prongs met is the one; its hold comes from the grab's shape, its need
   * from its weight and what lies on it, and the play's strength decides.
   */
  private decide() {
    const w = this.world;
    const counts = new Map<number, number>();
    for (const b of this.met) if (b >= 0) counts.set(b, (counts.get(b) ?? 0) + 1);
    let prize = -1;
    let n = 0;
    for (const [b, c] of counts) if (c > n) [prize, n] = [b, c];
    if (prize < 0) return;
    const head = this.headPos();
    const o = prize * 7;
    const cx = w.pose[o];
    const cy = w.pose[o + 1];
    const cz = w.pose[o + 2];
    // the tips of the prongs on it, against its centre: under it, the claw cradles it
    const caps = w.claw;
    let tipY = 0;
    let k = 0;
    for (let i = 0; i < 3; i++)
      if (this.met[i] === prize) {
        tipY += caps[2 + i * 2].by;
        k++;
      }
    tipY /= k;
    const [lo, hi] = w.extentY(prize);
    const hh = Math.max(0.03, (hi - lo) / 2);
    const depth = cy - tipY;
    const dq = clamp((depth + 0.2 * hh) / (0.8 * hh), 0, 1);
    const off = Math.hypot(cx - head[0], cz - head[2]);
    const cq = clamp(1 - (off / 0.075) ** 2, 0, 1);
    const nq = [0, 0.35, 0.8, 1][n];
    const shape = PRIZES[w.kinds[prize]];
    const hold = shape.catch * nq * (0.35 + 0.65 * dq) * (0.4 + 0.6 * cq);
    // what lies on it: other prizes resting on its top half
    let load = 0;
    const mine = w.spheres(prize, []);
    const theirs: number[] = [];
    for (let b = 0; b < w.count; b++) {
      if (b === prize || w.isGone(b) || w.pose[b * 7 + 1] < cy) continue;
      w.spheres(b, theirs);
      let touching = false;
      for (let i = 0; i < mine.length && !touching; i += 4)
        for (let j = 0; j < theirs.length; j += 4)
          if (Math.hypot(mine[i] - theirs[j], mine[i + 1] - theirs[j + 1], mine[i + 2] - theirs[j + 2]) < mine[i + 3] + theirs[j + 3] + 0.006) {
            touching = true;
            break;
          }
      if (touching) load += PRIZES[w.kinds[b]].mass;
    }
    const need = (shape.mass + 0.5 * load) * T.needPerKg;
    const pick = this.strength;
    const carry = this.strength * (this.strongPlay ? T.carryStrong : T.carryWeak);
    const power = pick * hold * (0.94 + 0.12 * this.rnd());
    // a grip too weak for it lifts it a little way before it slides out
    const slipLift = power >= need ? Infinity : 0.01 + this.rnd() * 0.05 * clamp(power / need, 0, 1);
    const q = w.pose.subarray(o + 3, o + 7);
    this.grip = { prize, hold, need, pick, carry, slipLift, off: [cx - head[0], cy - head[1], cz - head[2]], q: [q[0], q[1], q[2], q[3]], sag: 0 };
    w.hold(prize);
    this.events.push({ kind: "grab", prize, hold });
  }

  /** The held prize follows the head, sagging a little into the prongs. */
  private holdPrize(dt: number) {
    const g = this.grip;
    if (!g) return;
    g.sag = Math.min(0.012, g.sag + dt * 0.04);
    const h = this.headPos();
    this.world.setHeld(h[0] + g.off[0], h[1] + g.off[1] - g.sag, h[2] + g.off[2], g.q[0], g.q[1], g.q[2], g.q[3]);
  }

  private head = [0, 0, 0];
  /** The head's eye (machine frame). */
  headPos(): number[] {
    const p = this.pose;
    const s2 = p.swingX * p.swingX + p.swingZ * p.swingZ;
    this.head[0] = p.x + p.swingX;
    this.head[1] = this.rig.cableTop - Math.sqrt(Math.max(1e-6, p.cable * p.cable - s2));
    this.head[2] = p.z + p.swingZ;
    return this.head;
  }

  /** The claw's capsules for the physics: the head, then each prong's upper and lower segment. */
  private placeCapsules() {
    const R = this.rig;
    const p = this.pose;
    const [hx, hy, hz] = this.headPos();
    const c = this.world.claw;
    Object.assign(c[0], { ax: hx, ay: hy - 0.02, az: hz, bx: hx, by: hy - 0.07, bz: hz, r: 0.034 });
    for (let i = 0; i < 3; i++) {
      const ang = PRONG_SHUT + (PRONG_OPEN - PRONG_SHUT) * p.open[i];
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      // a point of the prong (u out, v up, in its own plane) turned open on the hinge, out round the head
      const at = (u: number, v: number, out: { x: number; y: number; z: number }) => {
        const ru = R.hingeR + u * cs - v * sn;
        out.y = hy - R.hingeDrop + u * sn + v * cs;
        out.x = hx + ru * ca;
        out.z = hz + ru * sa;
      };
      const h0 = { x: 0, y: 0, z: 0 };
      const m = { x: 0, y: 0, z: 0 };
      const t = { x: 0, y: 0, z: 0 };
      at(0, 0, h0);
      at(0.034, -0.075, m);
      at(0.014, -0.116, t);
      Object.assign(c[1 + i * 2], { ax: h0.x, ay: h0.y, az: h0.z, bx: m.x, by: m.y, bz: m.z, r: 0.006 });
      Object.assign(c[2 + i * 2], { ax: m.x, ay: m.y, az: m.z, bx: t.x, by: t.y, bz: t.z, r: 0.008 });
    }
  }

  /** Nothing to sense beyond the physics' own measures: kept for the land and prong checks. */
  private sense() {}

  /** A prize that has dropped down the chute is won (whether the claw put it there or knocked it in). */
  private watchChute() {
    const w = this.world;
    const R = this.rig;
    for (let b = 0; b < w.count; b++) {
      // one that came to rest jammed in the shaft, out of sight in the cabinet, goes on down to the (empty) bin;
      // one resting on the prizes already waiting there stays where it lies
      if (this.counted.has(b) && !w.isGone(b) && w.isAsleep(b) && w.pose[b * 7 + 1] > R.binY + 0.2 && w.pose[b * 7 + 1] < R.bedY - 0.05 && !this.binHolds(b)) {
        const q = w.pose.subarray(b * 7 + 3, b * 7 + 7);
        w.place(b, (R.chute[0] + R.chute[1]) / 2, R.binY + 0.16, (R.chute[2] + R.chute[3]) / 2, [q[0], q[1], q[2], q[3]]);
      }
      if (w.isGone(b) || this.counted.has(b) || b === w.held) continue;
      if (w.pose[b * 7 + 1] < this.rig.bedY - CHUTE_DOWN) {
        this.counted.add(b);
        if (this.busy) this.won.push(b);
        this.events.push({ kind: "won", prize: b });
      }
    }
  }

  /** Whether the bin holds a prize other than b. */
  private binHolds(b: number): boolean {
    const w = this.world;
    for (let o = 0; o < w.count; o++) if (o !== b && !w.isGone(o) && w.pose[o * 7 + 1] < this.rig.binY + 0.27) return true;
    return false;
  }

  /** Whether any prize is in the chute's mouth, not yet down it or off it. */
  inMouth(): boolean {
    const w = this.world;
    for (let b = 0; b < w.count; b++) if (!w.isGone(b) && b !== w.held && w.overChute(b)) return true;
    return false;
  }

  /** The prizes waiting behind the pickup door. */
  inBin(): number[] {
    const w = this.world;
    const out: number[] = [];
    for (let b = 0; b < w.count; b++) if (!w.isGone(b) && w.pose[b * 7 + 1] < this.rig.binY + 0.2) out.push(b);
    return out;
  }

  /** The prizes in the bin are taken: out of play until restocked. */
  take(): number[] {
    const taken = this.inBin();
    for (const b of taken) {
      this.world.remove(b);
      this.counted.delete(b);
    }
    return taken;
  }

  /** One prize taken out of the bin (picked up by a visitor): out of play until restocked. */
  takeOne(b: number): void {
    this.world.remove(b);
    this.counted.delete(b);
  }
}

/** The prongs' turn on their hinges (rad): shut, and wide open. The engine draws them the same. */
export const PRONG_SHUT = -0.32;
export const PRONG_OPEN = 0.62;

/** Where a player aims: the highest chimp (the easiest prize, lying on top), or anywhere. */
export function bestChimp(world: PrizeWorld, travel?: [number, number, number, number]): number {
  let best = -1;
  let by = -Infinity;
  for (let b = 0; b < world.count; b++) {
    const k = world.kinds[b];
    if (world.isGone(b) || (k !== "chimp" && k !== "pinkChimp")) continue;
    // one the claw can get over
    const x = world.pose[b * 7];
    const z = world.pose[b * 7 + 2];
    if (travel && (x < travel[0] || x > travel[1] || z < travel[2] || z > travel[3])) continue;
    const y = world.pose[b * 7 + 1];
    if (y > by) [best, by] = [b, y];
  }
  return best;
}

/** The joystick that steers the trolley onto (tx, tz), easing off near it so it stops there. */
export function steerTo(pose: ClawPose, tx: number, tz: number, out: ClawInput): ClawInput {
  const dx = tx - pose.x;
  const dz = tz - pose.z;
  out.x = Math.abs(dx) > 0.004 ? Math.sign(dx) * Math.min(1, Math.abs(dx) / 0.03) : 0;
  out.z = Math.abs(dz) > 0.004 ? Math.sign(dz) * Math.min(1, Math.abs(dz) / 0.03) : 0;
  out.drop = false;
  return out;
}

/**
 * Plays simulated on fresh copies of a stocked machine, with no rendering: for the odds
 * (README) and the browser test. "aim" steers over the highest chimp and waits for the
 * swing to settle before dropping; "random" drops anywhere. `strength` forces the grip.
 */
export function simulatePlays(rig: ClawRig, stock: (w: PrizeWorld, rnd: () => number) => void, n: number, strategy: "aim" | "random", strength: number | null, seed = 100) {
  let wins = 0;
  let grabs = 0;
  let slips = 0;
  for (let k = 0; k < n; k++) {
    const rnd = seeded(seed + k);
    const w = new PrizeWorld(rig);
    stock(w, rnd);
    const pose: ClawPose = { x: rig.home[0], z: rig.home[1], cable: rig.cableUp, swingX: 0, swingZ: 0, open: [0.45, 0.45, 0.45], joyX: 0, joyZ: 0, button: 0, door: 0 };
    const g = new ClawGame(w, rig, pose, rnd);
    g.forceStrength = strength;
    let tx = rig.travel[0] + rnd() * (rig.travel[1] - rig.travel[0]);
    let tz = rig.travel[2] + rnd() * (rig.travel[3] - rig.travel[2]);
    if (strategy === "aim") {
      const b = bestChimp(w, rig.travel);
      tx = w.pose[b * 7];
      tz = w.pose[b * 7 + 2];
    }
    g.start();
    const input: ClawInput = { x: 0, z: 0, drop: false };
    let still = 0;
    for (let t = 0; g.phase !== "over" && t < 60; t += 1 / 60) {
      if (g.phase === "aim") {
        steerTo(pose, tx, tz, input);
        still = input.x || input.z ? 0 : still + 1 / 60;
        input.drop = still > 0.6;
      } else input.x = input.z = 0;
      g.step(1 / 60, input);
    }
    for (const e of g.events) {
      if (e.kind === "grab") grabs++;
      if (e.kind === "slip") slips++;
    }
    if (g.won.length) wins++;
  }
  return { plays: n, wins, grabs, slips };
}
