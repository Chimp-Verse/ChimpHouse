// How a chimp moves: procedural animation, worked out each frame from how fast it
// goes, which way it turns and where it looks. There are no recorded clips, so it
// fits any chimp the wardrobe makes, short or tall, long-armed or not.
//
// - Legs: a gait that runs from a walk through a jog to a run as the speed rises
//   (how long each foot bears weight, how far it swings, how high it lifts, when
//   both are off the ground), with each foot placed by two-bone IK and held still
//   on the ground while it bears weight, so feet never slide.
// - Body: the hips bob, sway and twist with the steps, the chest twists against
//   them, and the body leans into its speed and its turns; a chimp's stoop and
//   bent knees throughout.
// - Arms swing loose from the shoulders when walking and pump when running.
// - At rest: breathing, slow shifts of weight, glances about, blinks.
// - The head turns toward where the chimp looks, the eyes leading it.
// - Sitting (Motion.seat): it lowers its hips onto the seat, leans back as far as the seat's
//   back lets it, and puts its feet on the floor (or a stool's foot rail; hanging, from a seat too
//   high; out along a lounger), its hands in its lap; it eases into that and back out of it.
//
// Bones are turned by name (VRM humanoid names), with their rest pose read from
// the rig, so a Blender chimp with the same skeleton moves the same way.

import { Quaternion, Vector3 } from "@babylonjs/core";
import type { Chimp } from "./chimp";
import { FINGERS, SIDES } from "./rig";

export interface Motion {
  /** ground speed, metres per second (world) */
  speed: number;
  /** the way it moves, relative to the way it faces (radians, 0 ahead, positive to its right) */
  heading: number;
  /** how fast it turns, radians per second (positive to its right) */
  turn: number;
  /** on the ground, or falling */
  grounded: boolean;
  /** where it looks, relative to the way it faces: yaw (right +) and pitch (up +), radians */
  lookYaw: number;
  lookPitch: number;
  /** the ground under each foot (left, right) above the ground the body stands on, metres (world): a step up or down */
  feet?: [number, number];
  /**
   * Sitting on a seat (the chimp's root on the floor under it, facing the way the sitter faces), or
   * sitting down onto it; left out, it stands, getting up out of the last seat's pose.
   */
  seat?: SeatPose;
}

/** How a chimp sits on a seat (world/context.ts SeatInfo has the same fields): what the seated pose needs. */
export interface SeatPose {
  /** the seat's top above the floor the root stands on (m, world) */
  height: number;
  /** how far it leans back against the seat's back (radians); 0 sits upright */
  recline: number;
  /** the legs: down to the floor (or the foot rail, or hanging), or out along the seat */
  legs: "down" | "out";
  /** a foot rail's height above the floor (m, world), if the seat has one */
  footrest?: number;
}

/** How long sitting down, or getting up, takes (s). */
const SIT_TIME = 0.75;
/** The hip joints over the seat's top as a chimp sits (rest units): its buttocks under them. */
const HIP_ABOVE = 0.085;

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Move `v` toward `to` at a rate (1/s): an exponential ease, the same at any frame rate. */
const ease = (v: number, to: number, rate: number, dt: number) => v + (to - v) * (1 - Math.exp(-rate * dt));

/** A rotation about one of the character's axes. */
function rot(axis: Vector3, angle: number, out = new Quaternion()): Quaternion {
  return Quaternion.RotationAxisToRef(axis, angle, out);
}
const X = Vector3.RightReadOnly;
const Y = Vector3.UpReadOnly;
const Z = Vector3.Forward(false);

interface LegRest {
  hip: Vector3;
  knee: Vector3;
  ankle: Vector3;
  /** the thigh's and shin's lengths */
  a: number;
  b: number;
}

export class ChimpAnimator {
  /** the gait's phase, 0 to 1 over two steps (left foot's then right foot's) */
  private phase = 0;
  private speed = 0;
  private heading = 0;
  private lean = 0;
  private bank = 0;
  private air = 0;
  /** how much it is turning on the spot (0 to 1): it steps round */
  private turning = 0;
  /** each foot's ground, eased (rest units) */
  private ground: [number, number] = [0, 0];
  private time = Math.random() * 100;
  private lookYaw = 0;
  private lookPitch = 0;
  private glanceYaw = 0;
  private glancePitch = 0;
  private glanceAt = 0;
  private blinkAt = 1.5;
  private blink = 0;
  private legs: LegRest[] = [];
  /** how far into sitting (0 standing, 1 seated; eased), and the seat it sits on, or got up from last */
  private sitT = 0;
  private sitPose: SeatPose | null = null;
  private q = { a: new Quaternion(), b: new Quaternion(), c: new Quaternion(), d: new Quaternion() };
  /** each bone's turn in the character's frame this frame (parents before children) */
  private G: Record<string, Quaternion> = {};

  constructor(private chimp: Chimp) {
    const r = chimp.rig;
    const at = (n: string) => Vector3.FromArray(r.bones[r.index[n]].head);
    for (const side of SIDES) {
      const hip = at(`${side}UpperLeg`);
      const knee = at(`${side}LowerLeg`);
      const ankle = at(`${side}Foot`);
      this.legs.push({ hip, knee, ankle, a: Vector3.Distance(hip, knee), b: Vector3.Distance(knee, ankle) });
    }
    for (const b of r.bones) this.G[b.name] = Quaternion.Identity();
  }

  /** How far it has sat down: 0 standing, 1 seated (eased as the pose is). */
  get sitting(): number {
    return this.sitPose ? smooth(this.sitT) : 0;
  }

  /** The chimp's scale (height / rest height): speeds are worked in its own rest units. */
  private get scale(): number {
    return this.chimp.root.scaling.y || 1;
  }

  update(dt: number, m: Motion): void {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const k = this.scale;
    // ---------------------------------------------------------------- sitting: how far into the seated pose
    if (m.seat) this.sitPose = m.seat;
    this.sitT = clamp(this.sitT + (m.seat ? dt : -dt) / SIT_TIME, 0, 1);
    const w = this.sitting;
    const seat = this.sitPose;
    // ---------------------------------------------------------------- gait
    const v = m.grounded ? m.speed / k : 0;
    this.speed = ease(this.speed, v, 8, dt);
    this.heading = ease(this.heading, m.heading, 10, dt);
    this.air = ease(this.air, m.grounded ? 0 : 1, 10, dt);
    const s = this.speed;
    // 0 at a walk's pace, 1 running flat out
    const g = smooth(clamp((s - 1.1) / 3.6, 0, 1));
    const moving = smooth(clamp((s - 0.04) / 0.5, 0, 1));
    // turning on the spot, it steps round rather than sliding its feet
    this.turning = ease(this.turning, clamp((Math.abs(m.turn) - 0.6) / 2.4, 0, 1) * (1 - moving), 10, dt);
    // seated, it doesn't step: it turns as it sits down
    const stepping = Math.max(moving, this.turning * 0.8) * (1 - w);
    // cycles per second rise with speed; the stride is what that leaves
    const freq = 0.82 + 0.3 * s + 0.6 * this.turning;
    this.phase = (this.phase + freq * dt * stepping) % 1;
    const p = this.phase;
    const duty = lerp(0.62, 0.34, g);
    const stride = s / freq;
    const lift = lerp(0.07, 0.19, g) * moving + 0.045 * this.turning;
    // lean into the speed and the turns
    this.lean = ease(this.lean, lerp(0.07, 0.36, g) * moving, 5, dt);
    this.bank = ease(this.bank, clamp(-m.turn * s * 0.035, -0.25, 0.25), 6, dt);

    // ---------------------------------------------------------------- hips
    const breath = Math.sin((this.time / 3.6) * TAU);
    const shift = Math.sin((this.time / 7.3) * TAU);
    // walking: lowest as a foot lands, highest passing; running: lowest mid-stance, highest in the air
    const bobWalk = -Math.cos(4 * Math.PI * p) * 0.016;
    const bobRun = -Math.cos(4 * Math.PI * (p - duty / 2)) * 0.035;
    const bob = lerp(bobWalk, bobRun, g) * moving;
    // each foot's ground: a step up or down under it, eased so the foot doesn't snap
    for (let i = 0; i < 2; i++) this.ground[i] = ease(this.ground[i], clamp((m.feet?.[i] ?? 0) / k, -0.32, 0.32), 14, dt);
    // a chimp stands with its knees bent; more so running; lower when a foot must reach down a step
    const crouch = -0.04 - 0.045 * g * moving - 0.04 * this.air + Math.min(0, this.ground[0], this.ground[1]) * 0.9;
    const sway = -Math.cos(TAU * (p - duty / 2)) * lerp(0.022, 0.008, g) * moving + shift * 0.012 * (1 - moving);
    const hipsNode = this.chimp.nodes.hips;
    const hipsRest = this.chimp.rest.hips;
    // the body moves along its heading: sway is across that, not across the facing
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    // sitting: the hip joints over the seat's top, where the root is (the seat's place)
    const seatY = seat ? seat.height / k + HIP_ABOVE : 0;
    hipsNode.position.set(lerp(hipsRest.x + sway * ch, 0, w), lerp(hipsRest.y + bob + crouch, seatY, w), lerp(hipsRest.z - sway * sh - 0.012 * g * moving, 0, w));
    const twist = Math.sin(TAU * p) * lerp(0.1, 0.16, g) * moving;
    const list = (Math.cos(TAU * (p - duty / 2)) * 0.05 * moving * (1 - g) - shift * 0.025 * (1 - moving)) * (1 - 0.7 * w);
    const G = this.G;
    // the whole body's lean, sitting: back against the seat's back, a touch of a slouch on a backless one
    const recline = seat ? seat.recline : 0;
    const sitLean = 0.04 - recline;
    rot(Y, twist + this.heading * 0.15 * moving, G.hips).multiplyInPlace(rot(Z, list + this.bank * 0.5, this.q.a)).multiplyInPlace(rot(X, lerp(this.lean * 0.35 + 0.13, sitLean - 0.16, w), this.q.b));
    this.set("hips", G.hips, null);

    // ---------------------------------------------------------------- spine: the stoop, the lean, breathing, the counter-twist
    const stoop = 0.15;
    const spineTurns: [string, number, number, number][] = [
      // name, pitch (forward +), yaw, roll
      ["spine", lerp(stoop * 0.3 + this.lean * 0.3, 0.06, w) + breath * 0.008, -twist * 0.5, -list * 0.4],
      ["chest", lerp(stoop * 0.35 + this.lean * 0.25, 0.06, w) + breath * 0.014, -twist * 0.7, -list * 0.3 + this.bank * 0.25],
      ["upperChest", lerp(stoop * 0.35 + this.lean * 0.15, 0.04, w) + breath * 0.01, -twist * 0.4, this.bank * 0.25],
    ];
    let parent = "hips";
    for (const [name, pitch, yaw, roll] of spineTurns) {
      // a local turn: pitch about the bone's own sideways axis, then yaw and roll
      const local = rot(X, pitch, this.q.a).multiplyInPlace(rot(Y, yaw, this.q.b)).multiplyInPlace(rot(Z, roll, this.q.c));
      G[parent].multiplyToRef(local, G[name]);
      this.set(name, G[name], parent);
      parent = name;
    }

    // ---------------------------------------------------------------- head: level with the world, turned to the look
    this.look(dt, m, moving);
    // leaning back, the head goes back a little with the body
    const wantHead = rot(Y, this.lookYaw, this.q.a).multiplyInPlace(rot(X, -this.lookPitch - 0.05 * moving - recline * 0.4 * w, this.q.b));
    // half the turn in the neck, half in the head
    const toHead = Quaternion.Inverse(G.upperChest).multiplyInPlace(wantHead);
    const neckLocal = Quaternion.Slerp(Quaternion.Identity(), toHead, 0.45);
    G.upperChest.multiplyToRef(neckLocal, G.neck);
    this.set("neck", G.neck, "upperChest");
    G.head.copyFrom(wantHead);
    this.set("head", G.head, "neck");
    // eyes lead the head: they look a little further than it has turned
    const eyeYaw = clamp((m.lookYaw - this.lookYaw) * 0.8, -0.35, 0.35);
    const eyePitch = clamp((m.lookPitch - this.lookPitch) * 0.8, -0.25, 0.25);
    for (const eye of ["leftEye", "rightEye"]) {
      const e = rot(Y, eyeYaw, this.q.a).multiplyInPlace(rot(X, -eyePitch, this.q.b));
      this.local(eye, e);
    }
    this.blinks(dt);
    this.chimp.setLids(1 - this.blink, eyePitch + this.lookPitch * 0.25);
    // the jaw: just open while running hard, as a chimp pants
    this.local("jaw", rot(X, 0.06 * g * moving * (0.6 + 0.4 * Math.sin(this.time * 9)), this.q.a));

    // ---------------------------------------------------------------- legs
    SIDES.forEach((side, i) => {
      const leg = this.legs[i];
      const sign = i === 0 ? -1 : 1;
      const ph = (p + i * 0.5) % 1;
      let along = 0;
      let up = 0;
      let pitch = 0;
      if (ph < duty) {
        // bearing weight: the foot stays put while the body goes over it
        along = stride * duty * (0.5 - ph / duty);
        const t = ph / duty;
        // heel down at the start, rolling up onto the toes at the end
        pitch = lerp(0, 0.32, smooth(clamp((t - 0.55) / 0.45, 0, 1))) * moving + (t < 0.15 ? -0.18 * (1 - t / 0.15) * moving : 0);
        // the ankle rises as the foot rolls over its ball (or, landing, over its heel)
        up = pitch > 0 ? 0.13 * Math.sin(pitch) : 0.045 * Math.sin(-pitch);
      } else {
        const u = (ph - duty) / (1 - duty);
        along = stride * duty * (smooth(u) - 0.5);
        up = Math.sin(Math.PI * u) * lift * (u < 0.5 ? 1 : 1 - 0.3 * (u - 0.5));
        pitch = lerp(0.4, -0.2, u) * moving;
      }
      // the foot's place under the hip, along the way the body moves; in the air, tucked up
      const foot = new Vector3(leg.ankle.x + sign * 0.006 * (1 - g), leg.ankle.y + up + 0.08 * this.air + this.ground[i], leg.ankle.z + 0.02);
      foot.x += along * sh;
      foot.z += along * ch;
      // a stance foot turned in toward the line of travel when running
      foot.x -= sign * 0.025 * g * moving;
      pitch = pitch * (1 - this.air) + 0.3 * this.air;
      if (w > 0 && seat) {
        const sat = this.seatedFoot(leg, seat, seatY, k);
        Vector3.LerpToRef(foot, sat.at, w, foot);
        pitch = lerp(pitch, sat.pitch, w);
      }
      this.leg(side, i, foot, pitch);
    });

    // ---------------------------------------------------------------- arms
    SIDES.forEach((side, i) => {
      const sign = i === 0 ? -1 : 1;
      // the left arm swings forward with the right leg
      const swing = Math.cos(TAU * p) * (i === 0 ? -1 : 1) * lerp(0.22, 0.6, g) * moving;
      // sitting, the hands in the lap (lying back on a lounger, beside it)
      const out = seat?.legs === "out";
      const hang = lerp(0.5 - 0.06 * g * moving, out ? 0.4 : 0.42, w);
      const elbow = lerp(lerp(0.2, 0.3, moving) + lerp(0, 1.15, g) * moving + Math.max(0, swing) * 0.5 * (1 - g), out ? 0.3 : 0.6, w) + breath * 0.02;
      // hanging close in from the A-pose, a touch forward, swinging about the shoulder; running pumps forward more than back
      const fwd = lerp(0.2 + swing + 0.12 * g * moving + 0.4 * this.air, out ? 0 : 0.26 + recline * 0.3, w);
      const ua = rot(Z, -sign * hang + sign * 0.35 * this.air, this.q.a);
      const sw = rot(X, -fwd, this.q.b);
      // the shoulder itself: a chimp's hunch forward, lifting with the breath and the swing
      this.local(`${side}Shoulder`, rot(Y, sign * 0.06, this.q.c).multiplyInPlace(rot(Z, sign * (0.03 * breath + 0.06 * Math.abs(swing) * g), this.q.d)));
      this.local(`${side}UpperArm`, sw.multiply(ua));
      const hinge = this.hinge(`${side}LowerArm`);
      this.local(`${side}LowerArm`, rot(hinge, elbow, this.q.a));
      // the wrist relaxed, the hand turned a little palm-back
      this.local(`${side}Hand`, rot(this.hinge(`${side}IndexProximal`), 0.12 + 0.25 * g * moving, this.q.a));
      // fingers loosely curled; into fists when running
      const curl = lerp(0.3, 1.1, g * moving) + 0.03 * breath;
      for (let f = 1; f < 5; f++) {
        const name = FINGERS[f];
        const spread = (f - 2.5) * 0.04;
        this.local(`${side}${name}Proximal`, rot(this.hinge(`${side}${name}Proximal`), curl * 0.8 + spread, this.q.a));
        this.local(`${side}${name}Intermediate`, rot(this.hinge(`${side}${name}Intermediate`), curl * 1.05, this.q.a));
        this.local(`${side}${name}Distal`, rot(this.hinge(`${side}${name}Distal`), curl * 0.7, this.q.a));
      }
      this.local(`${side}ThumbProximal`, rot(this.hinge(`${side}ThumbProximal`), 0.15 + curl * 0.3, this.q.a));
      this.local(`${side}ThumbDistal`, rot(this.hinge(`${side}ThumbDistal`), 0.2 + curl * 0.35, this.q.a));
    });
  }

  /**
   * Where a foot goes sitting (rest units, the root's space) and its pitch: on the floor (or the
   * foot rail) a thigh's length ahead with the shin down to it; hanging under the knee from a seat
   * too high for the floor; out along the seat for a lounger. Knees a little apart.
   */
  private seatedFoot(leg: LegRest, seat: SeatPose, hipY: number, k: number): { at: Vector3; pitch: number } {
    const x = leg.ankle.x * 1.25;
    if (seat.legs === "out") return { at: new Vector3(x * 0.9, hipY - HIP_ABOVE + leg.ankle.y * 0.6, (leg.a + leg.b) * 0.93), pitch: -0.9 };
    const floor = (seat.footrest ?? 0) / k + leg.ankle.y;
    // the lowest a foot hangs: the shin straight down from a knee out level with the hip
    const hang = hipY - leg.b * 0.95;
    const y = Math.max(floor, hang);
    // a low seat (a bean bag) brings the knees up: the feet further out
    const z = leg.a * (seat.footrest !== undefined ? 0.7 : 0.92) + Math.max(0, floor - hang) * 0.55;
    const pitch = y > floor + 0.02 ? 0.5 : seat.footrest !== undefined ? 0.25 : 0;
    return { at: new Vector3(x, y, z), pitch };
  }

  /** Where the head is looking: the wanted look, or glances about when there is none. */
  private look(dt: number, m: Motion, moving: number) {
    if (this.time > this.glanceAt) {
      this.glanceAt = this.time + 1.8 + Math.random() * 4.5;
      this.glanceYaw = (Math.random() * 2 - 1) * 0.5 * (1 - moving * 0.7);
      this.glancePitch = (Math.random() * 2 - 1) * 0.12 - 0.04;
    }
    // the wanted look, within what a neck can turn, with the idle glances on top
    const wy = clamp(m.lookYaw, -1.2, 1.2) + this.glanceYaw * 0.35;
    const wp = clamp(m.lookPitch, -0.6, 0.5) + this.glancePitch * 0.4;
    this.lookYaw = ease(this.lookYaw, wy, 5, dt);
    this.lookPitch = ease(this.lookPitch, wp, 5, dt);
  }

  private blinks(dt: number) {
    if (this.time > this.blinkAt) {
      const into = this.time - this.blinkAt;
      // shut fast, open a little slower: 0.14 s in all
      this.blink = into < 0.06 ? into / 0.06 : into < 0.14 ? 1 - (into - 0.06) / 0.08 : 0;
      if (into >= 0.14) {
        this.blink = 0;
        // now and then a double blink
        this.blinkAt = this.time + (Math.random() < 0.18 ? 0.12 : 1.8 + Math.random() * 4.2);
      }
    }
    void dt;
  }

  /**
   * Place a leg: the hip where the hips put it, the ankle at `ankle` (rest
   * space), the knee bent forward between by two-bone IK; the foot pitched by
   * `pitch` (toes down +).
   */
  private leg(side: string, i: number, ankle: Vector3, pitch: number) {
    const leg = this.legs[i];
    const G = this.G;
    const hipsNode = this.chimp.nodes.hips;
    // the hip joint where the hips are now
    const off = leg.hip.subtract(Vector3.FromArray(this.chimp.rig.bones[this.chimp.rig.index.hips].head));
    const hip = hipsNode.position.add(off.applyRotationQuaternion(G.hips));
    const d = ankle.subtract(hip);
    const reach = leg.a + leg.b;
    const dist = clamp(d.length(), Math.abs(leg.a - leg.b) + 1e-4, reach * 0.999);
    const n = d.normalize();
    // the knee points ahead, and a little out
    const pole = new Vector3((i === 0 ? -1 : 1) * 0.12, 0, 1).normalize();
    const poleP = pole.subtract(n.scale(Vector3.Dot(pole, n))).normalize();
    const cosA = clamp((leg.a * leg.a + dist * dist - leg.b * leg.b) / (2 * leg.a * dist), -1, 1);
    const A = Math.acos(cosA);
    const knee = hip.add(n.scale(leg.a * cosA)).addInPlace(poleP.scale(leg.a * Math.sin(A)));
    const end = hip.add(n.scale(dist));
    // the thigh and shin turned from their rest directions to these, knees kept ahead
    this.aim(G[`${side}UpperLeg`], leg.knee.subtract(leg.hip), knee.subtract(hip), Z, poleP);
    this.set(`${side}UpperLeg`, G[`${side}UpperLeg`], "hips");
    this.aim(G[`${side}LowerLeg`], leg.ankle.subtract(leg.knee), end.subtract(knee), Z, poleP);
    this.set(`${side}LowerLeg`, G[`${side}LowerLeg`], `${side}UpperLeg`);
    // the foot: level with the ground (the body's heading), pitched for the step
    rot(X, pitch, G[`${side}Foot`]);
    this.set(`${side}Foot`, G[`${side}Foot`], `${side}LowerLeg`);
    // toes bend back as the heel lifts
    this.local(`${side}Toes`, rot(X, -Math.max(0, pitch) * 0.8, this.q.a));
  }

  /**
   * The turn that takes a bone from its rest direction `from` to `to`, with the
   * rest pole `pole0` (square to it) turned toward `pole1`: shortest arc, then a
   * twist about the new direction.
   */
  private aim(out: Quaternion, from: Vector3, to: Vector3, pole0: Vector3, pole1: Vector3) {
    const f = from.normalize();
    const t = to.normalize();
    const arc = Quaternion.FromUnitVectorsToRef(f, t, new Quaternion());
    const p0 = pole0.subtract(f.scale(Vector3.Dot(pole0, f))).normalize().applyRotationQuaternion(arc);
    const p1 = pole1.subtract(t.scale(Vector3.Dot(pole1, t))).normalize();
    const p0t = p0.subtract(t.scale(Vector3.Dot(p0, t))).normalize();
    const angle = Math.atan2(Vector3.Dot(t, Vector3.Cross(p0t, p1)), Vector3.Dot(p0t, p1));
    rot(t, angle, out).multiplyInPlace(arc);
  }

  /** A bone's hinge axis at rest (its own frame: bones rest unturned). */
  private hinge(name: string): Vector3 {
    const h = this.chimp.rig.bones[this.chimp.rig.index[name]].hinge;
    return h ? new Vector3(h[0], h[1], h[2]) : X;
  }

  /** Set a bone's turn relative to its parent (and remember its turn in the character's frame). */
  private local(name: string, q: Quaternion) {
    const node = this.chimp.nodes[name];
    if (!node) return;
    node.rotationQuaternion!.copyFrom(q);
    const b = this.chimp.rig.bones[this.chimp.rig.index[name]];
    const parent = b.parent >= 0 ? this.chimp.rig.bones[b.parent].name : null;
    if (parent) this.G[parent].multiplyToRef(q, this.G[name]);
    else this.G[name].copyFrom(q);
  }

  /** Set a bone so its turn in the character's frame is `global`, given its parent's. */
  private set(name: string, global: Quaternion, parent: string | null) {
    const node = this.chimp.nodes[name];
    if (!node) return;
    if (!parent) node.rotationQuaternion!.copyFrom(global);
    else Quaternion.InverseToRef(this.G[parent], this.q.d).multiplyToRef(global, node.rotationQuaternion!);
  }
}
