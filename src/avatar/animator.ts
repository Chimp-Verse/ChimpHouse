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
// - Sitting (Motion.seat), fitted to the seat's shape and the chimp's own: its thighs along the
//   seat's top, the backs of its knees at the front edge (shuffling forward and slouching a little
//   on a deep seat, or its legs out along it when even that isn't enough), its shins hanging over
//   the edge or its feet on the floor or the foot rail, its back against the seat's back, its hands
//   on its thighs. Sitting down it leans forward and lowers its hips back onto the seat in an arc,
//   its feet where they stood; onto a stool, a pouf or a lounger it sits on the edge sideways
//   first, then swings round onto it. Getting up is the same backwards.
//
// Bones are turned by name (VRM humanoid names), with their rest pose read from
// the rig, so a Blender chimp with the same skeleton moves the same way.

import { type Mesh, Quaternion, Vector3 } from "@babylonjs/core";
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
   * Sitting on a seat (the chimp's root on the floor in front of it, or beside it: where it stood
   * to sit down), or sitting down onto it; left out, it stands, getting up out of the last seat's pose.
   */
  seat?: SeatPose;
}

/**
 * How a chimp sits on a seat: the seat's shape (engine/seatShape.ts measures it) and where it is
 * from the chimp's root. Metres, world; the seat's slot is on its top where the hips go.
 */
export interface SeatPose {
  /** the seat's top above the floor the root stands on */
  height: number;
  /** how far its back leans back (radians); 0 sits upright */
  recline: number;
  /** the legs: down over the front edge (to the floor, the foot rail, or hanging), or out along the seat */
  legs: "down" | "out";
  /** a foot rail's height above the floor, if the seat has one */
  footrest?: number;
  /** from the slot forward to the seat's front edge (default 0.3) */
  depth?: number;
  /** from the slot back to the face of the seat's back; null or left out: no back */
  back?: number | null;
  /** from the slot to the nearer side edge (default 0.25) */
  width?: number;
  /** from the slot back to the seat's rear edge (or its back) */
  rear?: number;
  /** from the slot forward to the front of what is under the seat by the feet (a plinth); 0 or left out: nothing */
  base?: number;
  /** the same out to its sides (a lounger's rail, a stool's legs), for sitting on its side edge */
  sideBase?: number;
  /** how far in front of the slot the way is clear down by the feet (a bar's front panel), the way the sitter faces; left out: clear */
  room?: number;
  /** how far the top rises in front of the slot, where legs lie out along it (a lounger's rolled towel); left out: flat */
  rise?: number;
  /** from the slot forward to where that rise begins */
  riseAt?: number;
  /** how far the way is clear beside the sitter at its elbows, to its right and its left (m): a counter's end, a booth's wall; left out: clear */
  elbows?: [number, number];
  /** a bar or a counter top over the sitter's lap, the way they face: how far ahead of the slot its edge is, and how high its top is over the seat (m); left out: none */
  bar?: { at: number; top: number };
  /** where the slot is from the root, in the root's frame (x right, z ahead); default under it */
  at?: [number, number];
  /** the way the seat faces, from the way the root does (radians, right +); default the same */
  turn?: number;
  /** sat on from in front of it (back to it, the default), or from beside it: on the edge sideways, then round onto it */
  from?: "front" | "side";
}

/** How long sitting down (or getting up) takes from the front, and from the side (s). */
const SIT_TIME = 1.05;
const SIT_TIME_SIDE = 1.6;
/** Of sitting from the side: the part spent sitting down on the edge, before swinging round. */
const EDGE = 0.5;
/** Sitting on a seat's side edge first, how far in from it the hips go (m) */
const EDGE_DEPTH = 0.24;
/** Sitting on a seat's side edge first, at most this far forward of the slot (m): a chair's front corner */
const EDGE_AHEAD = 0.3;

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

/**
 * The chimp's own measures for sitting (rest units), read from its skin: how far the seat is under
 * its hip joints and under its knees when the thighs lie along it, how far its rump is behind the
 * hip joints, the heel under the ankle, and the foot ahead of it.
 */
export interface SitBody {
  underHip: number;
  underKnee: number;
  rump: number;
  heel: number;
  toe: number;
  /** the back of the heel behind the ankle */
  heelBack: number;
}

/** Where everything goes, sitting, in the root's frame (rest units): the hips, each knee, ankle and hand, the body's turn and lean. */
interface SitTargets {
  hips: Vector3;
  yaw: number;
  /** the hips' pitch (forward +) */
  lean: number;
  knee: [Vector3, Vector3];
  ankle: [Vector3, Vector3];
  pitch: [number, number];
  hand: [Vector3, Vector3];
  /** whether each foot is on the floor (where it stood, sitting down from the front) */
  planted: boolean;
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
  /** how far into sitting (0 standing, 1 seated; linear in time), and the seat it sits on, or got up from last */
  private sitT = 0;
  private sitPose: SeatPose | null = null;
  readonly body: SitBody;
  /** For tools (filmstrips, clip tests): hold sitting down at this far in (0 to 1, linear in time), or null to let it run. */
  freeze: number | null = null;
  /** each leg's hip joint and knee as placed this frame (rest units, the root's frame): where a sitter's hands rest */
  private hipNow = [new Vector3(), new Vector3()];
  /** how far what it wears on its back (a backpack) stands out behind it (rest units), for the outfit it last had (Chimp.version) */
  private pack = 0;
  private packFor = -1;
  private kneeNow = [new Vector3(), new Vector3()];
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
    this.body = this.measure();
  }

  /** How far it has sat down: 0 standing, 1 seated (eased as the pose is). */
  get sitting(): number {
    return this.sitPose ? smooth(this.sitT) : 0;
  }

  /** The chimp's scale (height / rest height): speeds are worked in its own rest units. */
  private get scale(): number {
    return this.chimp.root.scaling.y || 1;
  }

  /** Its measures for sitting, read from its skin at rest (see SitBody). */
  private measure(): SitBody {
    const r = this.chimp.rig;
    const leg = this.legs[0];
    const body = this.chimp.meshes.find((m) => m.name.endsWith(" body")) as Mesh | undefined;
    const pos = body?.getVerticesData("position");
    const mi = body?.getVerticesData("matricesIndices");
    const mw = body?.getVerticesData("matricesWeights");
    // the foot: how far it reaches ahead of the ankle, and behind it
    let toe = 0.17;
    let heelBack = 0.06;
    const foot = this.chimp.meshes.find((m) => m.name.endsWith(" footL")) as Mesh | undefined;
    const fp = foot?.getVerticesData("position");
    if (fp) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 2; i < fp.length; i += 3) {
        lo = Math.min(lo, fp[i]);
        hi = Math.max(hi, fp[i]);
      }
      toe = hi - leg.ankle.z;
      heelBack = leg.ankle.z - lo;
    }
    const fallback: SitBody = { underHip: 0.085, underKnee: 0.05, rump: 0.13, heel: leg.ankle.y, toe, heelBack };
    if (!pos || !mi || !mw) return fallback;
    const iHips = r.index.hips;
    const thigh = new Set([r.index.leftUpperLeg, r.index.rightUpperLeg]);
    const hipsY = r.bones[iHips].head[1];
    const under: number[] = [];
    const knee: number[] = [];
    const rump: number[] = [];
    const seatBone: number[] = [];
    const dir = leg.knee.subtract(leg.hip).normalize();
    for (let v = 0; v < pos.length / 3; v++) {
      let b = 0;
      for (let j = 1; j < 4; j++) if (mw[v * 4 + j] > mw[v * 4 + b]) b = j;
      const bone = mi[v * 4 + b];
      const x = pos[v * 3];
      const y = pos[v * 3 + 1];
      const z = pos[v * 3 + 2];
      // the left thigh, or the right one mirrored onto it
      const p = new Vector3(bone === r.index.rightUpperLeg ? -x : x, y, z);
      if (thigh.has(bone)) {
        const rel = p.subtract(leg.hip);
        const t = Vector3.Dot(rel, dir) / leg.a;
        // the back of the thigh (behind it at rest: under it, sitting)
        const behind = -rel.subtract(dir.scale(t * leg.a)).z;
        if (t > 0.05 && t < 0.4) under.push(behind);
        if (t > 0.75 && t < 1.05) knee.push(behind);
      }
      // the rump: what hangs from the hips, behind the hip joints and below them
      if (bone === iHips && Math.abs(x) < 0.14) {
        if (y > hipsY - 0.12 && y < hipsY + 0.12) rump.push(-(z - leg.hip.z));
        if (z < leg.hip.z + 0.02) seatBone.push(leg.hip.y - y);
      }
    }
    const pct = (a: number[], q: number, d: number) => (a.length ? a.sort((m, n) => m - n)[Math.min(a.length - 1, Math.floor(a.length * q))] : d);
    const toes = r.bones[r.index.leftToes]?.head;
    return {
      underHip: Math.max(pct(under, 0.95, fallback.underHip), pct(seatBone, 0.97, 0)),
      underKnee: pct(knee, 0.95, fallback.underKnee),
      rump: pct(rump, 0.97, fallback.rump),
      heel: leg.ankle.y,
      toe: fp ? toe : toes ? toes[2] - leg.ankle.z + 0.05 : fallback.toe,
      heelBack,
    };
  }

  /**
   * Where the root should stand to sit on `seat` (its slot at the origin, facing +Z), metres: in
   * front of it (from "front") or beside it (from "side"), how far from the slot. Sitting from in
   * front with its feet on the floor, that is where its feet are as it sits, so they don't move.
   * `along`: beside a seat, how far forward of the slot (sitting on a chair's edge forward of its back).
   * `arm`: how far out to its sides its hanging arms (elbows and hands) reach from its root.
   */
  standOff(seat: SeatPose): { out: number; along: number; arm: number } {
    const k = this.scale;
    const r = this.chimp.rig;
    const head = (n: string) => Vector3.FromArray(r.bones[r.index[n]].head);
    // (hanging down from the shoulder and a little forward, reaching for the thighs as it sits; and the arm's own thickness)
    const arm = (Math.abs(head("leftUpperArm").x) + 0.25 * Vector3.Distance(head("leftUpperArm"), head("leftHand")) + 0.06) * k + 0.03;
    const side = seat.from === "side";
    const edge = this.edgeOf(seat);
    // from the front, onto the edge of a lounging seat: the edge is ahead of the slot
    const ahead = edge ? (side ? edge.aside : edge.ahead) : 0;
    const t = this.targets(seat, edge?.shape ?? seat, 0, 0, 0, k);
    const toe = this.body.toe * k;
    const clear = (edge?.shape.depth ?? seat.depth ?? 0.3) + toe + 0.05;
    const along = edge && side ? edge.ahead : 0;
    if (!t.planted) return { out: ahead + clear, along, arm };
    // the root where the feet will be: its feet stand a little ahead of it
    const feet = ((t.ankle[0].z + t.ankle[1].z) / 2 - (this.legs[0].ankle.z + 0.02)) * k;
    return { out: ahead + Math.max(feet, clear - toe), along, arm };
  }

  /**
   * Sitting down in two steps: first on the seat's edge, legs down over it, then onto the seat.
   * From the side (a stool, a pouf, a lounger, a desk chair) on its side edge, facing the way the
   * chimp stood, then swinging round onto it (on a chair, forward of its back); from the front onto
   * a lounging seat (a daybed), on its front edge, then sliding back with the legs out along it.
   * Null when it sits straight down. `ahead`: how far the edge sitting is ahead of the slot, along
   * the seat's way.
   */
  private edgeOf(seat: SeatPose): { shape: SeatPose; ahead: number; aside: number } | null {
    const depth = seat.depth ?? 0.3;
    if (seat.from === "side") {
      const width = seat.width ?? 0.25;
      // on a long side (a bench's length, a lounger's width), near the edge, sliding along after
      const aside = Math.max(0, width - EDGE_DEPTH);
      return {
        shape: { height: seat.height, recline: 0, legs: "down", depth: width - aside, back: null, footrest: seat.footrest, base: Math.max(0, (seat.sideBase ?? 0) - aside) },
        // (a chair: on its front corner, well forward of its back, so an elbow swinging round clears it;
        // a long seat, a lounger, no further along it than that, not down by its foot end)
        ahead: seat.back != null ? clamp((depth - 0.06) * 0.9, 0, EDGE_AHEAD) : 0,
        aside,
      };
    }
    if (seat.legs === "out") {
      const ahead = Math.max(0, depth - 0.14);
      return { shape: { height: seat.height, recline: 0, legs: "down", depth: 0.12, back: null, base: Math.max(0, (seat.base ?? 0) - ahead) }, ahead, aside: 0 };
    }
    return null;
  }

  update(dt: number, m: Motion): void {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const k = this.scale;
    // ---------------------------------------------------------------- sitting: how far into the seated pose
    if (m.seat) this.sitPose = m.seat;
    const seat = this.sitPose;
    const edge = seat ? this.edgeOf(seat) : null;
    this.sitT = this.freeze ?? clamp(this.sitT + (m.seat ? dt : -dt) / (edge ? SIT_TIME_SIDE : SIT_TIME), 0, 1);
    const w = this.sitting;
    // sitting down onto the seat (or onto its edge), then (from its edge) round or back onto it
    const ta = edge ? clamp(this.sitT / EDGE, 0, 1) : this.sitT;
    const tb = edge ? smooth(clamp((this.sitT - EDGE) / (1 - EDGE), 0, 1)) : 1;
    let sit: SitTargets | null = null;
    /** where the seat (or its edge) sat down on first ends, ahead of the root (rest units): the hips go over it, not through it */
    let frontZ = Infinity;
    if (seat && this.sitT > 0) {
      const ox = seat.at?.[0] ?? 0;
      const oz = seat.at?.[1] ?? 0;
      const turn = seat.turn ?? 0;
      const final = this.targets(seat, seat, ox, oz, turn, k);
      if (edge) {
        // (the root faces away from the slot when it sits from beside: toward it is -Z, the side edge nearer by `aside`)
        const ex = ox + Math.sin(turn) * edge.ahead;
        const ez = oz + Math.cos(turn) * edge.ahead + edge.aside;
        sit = this.blendTargets(this.targets(seat, edge.shape, ex, ez, 0, k), final, tb, seat, k);
        frontZ = (ez + (edge.shape.depth ?? 0.3)) / k;
      } else {
        sit = final;
        frontZ = (oz + (seat.depth ?? 0.3) * Math.cos(turn)) / k;
      }
    }
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
    // seated, it doesn't step
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
    const standHips = new Vector3(hipsRest.x + sway * ch, hipsRest.y + bob + crouch, hipsRest.z - sway * sh - 0.012 * g * moving);
    // sitting down: the hips go back over the seat, then down onto it (up onto a high one first, then back), in an arc
    let wh = 0;
    let wv = 0;
    let bump = 0;
    if (sit) {
      const up = sit.hips.y > standHips.y;
      wh = smooth(clamp(up ? (ta - 0.25) / 0.75 : ta / 0.75, 0, 1));
      wv = smooth(clamp(up ? ta / 0.7 : (ta - 0.2) / 0.8, 0, 1));
      // leaning forward over the feet to sit down and get up, most part way
      bump = Math.sin(Math.PI * clamp(ta, 0, 1)) * (up ? 0.15 : 0.38);
      const hz = lerp(standHips.z, sit.hips.z, wh);
      let hy = lerp(standHips.y, sit.hips.y, wv);
      // over the seat, the rump is above its top: up onto a high seat before back onto it, and not down through its front
      const over = clamp((frontZ - (hz - this.body.rump)) / 0.08, 0, 1);
      hy += Math.max(0, sit.hips.y - hy) * smooth(over);
      // (sitting from beside a chair, along its side to its front corner first, then back onto it: past the end of its back)
      const wx = seat?.from === "side" && seat.back != null ? smooth(clamp(ta / 0.5, 0, 1)) : wh;
      hipsNode.position.set(lerp(standHips.x, sit.hips.x, wx), hy, hz);
    } else hipsNode.position.copyFrom(standHips);
    const twist = Math.sin(TAU * p) * lerp(0.1, 0.16, g) * moving;
    const list = (Math.cos(TAU * (p - duty / 2)) * 0.05 * moving * (1 - g) - shift * 0.025 * (1 - moving)) * (1 - 0.8 * w);
    const G = this.G;
    const standPitch = this.lean * 0.35 + 0.13;
    const bodyYaw = sit ? sit.yaw * wh : 0;
    const pitch = sit ? lerp(standPitch, sit.lean, wh) + bump : standPitch;
    rot(Y, twist + this.heading * 0.15 * moving + bodyYaw, G.hips).multiplyInPlace(rot(Z, list + this.bank * 0.5, this.q.a)).multiplyInPlace(rot(X, pitch, this.q.b));
    this.set("hips", G.hips, null);
    const recline = seat ? seat.recline : 0;

    // ---------------------------------------------------------------- spine: the stoop, the lean, breathing, the counter-twist
    const stoop = 0.15;
    const spineTurns: [string, number, number, number][] = [
      // name, pitch (forward +), yaw, roll
      ["spine", lerp(stoop * 0.3 + this.lean * 0.3, 0.05, w) + breath * 0.008, -twist * 0.5, -list * 0.4],
      ["chest", lerp(stoop * 0.35 + this.lean * 0.25, 0.04, w) + breath * 0.014, -twist * 0.7, -list * 0.3 + this.bank * 0.25],
      ["upperChest", lerp(stoop * 0.35 + this.lean * 0.15, 0.03, w) + breath * 0.01, -twist * 0.4, this.bank * 0.25],
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
    // leaning back, the head goes back a little with the body (but not so far it looks at the ceiling)
    const wantHead = rot(Y, this.lookYaw, this.q.a).multiplyInPlace(rot(X, -this.lookPitch - 0.05 * moving - Math.min(recline, 0.5) * 0.3 * w, this.q.b));
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
      let pole: Vector3 | null = null;
      let footYaw = 0;
      if (sit) {
        // the feet stay where they stood if they will be on the floor; else they lift to where they go, after the hips set off
        // (and by the time the hips are back past the seat's front, the feet are up off the floor as far: the thighs don't cross its edge)
        const rump = this.body.rump;
        const past = clamp((frontZ - (hipsNode.position.z - rump)) / Math.max(1e-3, frontZ - (sit.hips.z - rump)), 0, 1);
        const wf = sit.planted ? wh : Math.max(smooth(clamp((ta - 0.2) / 0.7, 0, 1)), past);
        const lifted = Vector3.Lerp(foot, sit.ankle[i], wf);
        if (!sit.planted) lifted.y += Math.sin(Math.PI * wf) * 0.05;
        foot.copyFrom(lifted);
        pitch = lerp(pitch, sit.pitch[i], wf);
        footYaw = sit.yaw * wf;
        // the knee bent toward where it goes sitting
        const hip = this.hipAt(i);
        const standPole = new Vector3(sign * 0.12, 0, 1).normalize();
        pole = Vector3.Lerp(standPole, sit.knee[i].subtract(hip).normalize(), Math.max(wh, wf));
        // lifting the feet up off the floor (onto a deep seat, a high one), the knee comes up with them, not down through the seat's front
        if (!sit.planted) pole.addInPlace(new Vector3(0, 0.9, 0.3).scaleInPlace(Math.sin(Math.PI * wf)));
      }
      this.leg(side, i, foot, pitch, pole, footYaw);
    });

    // ---------------------------------------------------------------- arms
    SIDES.forEach((side, i) => {
      const sign = i === 0 ? -1 : 1;
      // the left arm swings forward with the right leg
      const swing = Math.cos(TAU * p) * (i === 0 ? -1 : 1) * lerp(0.22, 0.6, g) * moving;
      const hang = 0.5 - 0.06 * g * moving;
      const elbow = lerp(0.2, 0.3, moving) + lerp(0, 1.15, g) * moving + Math.max(0, swing) * 0.5 * (1 - g) + breath * 0.02;
      // hanging close in from the A-pose, a touch forward, swinging about the shoulder; running pumps forward more than back
      const fwd = 0.2 + swing + 0.12 * g * moving + 0.4 * this.air;
      const ua = rot(Z, -sign * hang + sign * 0.35 * this.air, this.q.a);
      const sw = rot(X, -fwd, this.q.b);
      // the shoulder itself: a chimp's hunch forward, lifting with the breath and the swing
      this.local(`${side}Shoulder`, rot(Y, sign * 0.06, this.q.c).multiplyInPlace(rot(Z, sign * (0.03 * breath + 0.06 * Math.abs(swing) * g), this.q.d)));
      this.local(`${side}UpperArm`, sw.multiply(ua));
      const hinge = this.hinge(`${side}LowerArm`);
      this.local(`${side}LowerArm`, rot(hinge, elbow, this.q.a));
      // sitting, the hands on the thighs (where the thighs are now), reached by IK, from early on sitting down
      if (sit) {
        const hip = this.hipNow[i];
        const kn = this.kneeNow[i];
        const along = kn.subtract(hip);
        const up = new Vector3(0, 1, 0).subtract(along.scale(along.y / Math.max(1e-6, along.lengthSquared()))).normalize();
        const out = new Vector3(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw)).scale(sign * Math.abs(this.legs[i].hip.x) * 0.3);
        const hand = Vector3.Lerp(hip, kn, 0.52).addInPlace(up.scale(this.body.underKnee * 1.5 + 0.02)).addInPlace(out);
        // a bar top over the lap (a stool pulled up to it): the hands further back on the thighs, the forearms clear under its edge
        if (seat?.bar) {
          const turn = seat.turn ?? 0;
          const fx = Math.sin(turn) * w;
          const fz = Math.cos(turn) * w;
          const ahead = (hand.x - (seat.at?.[0] ?? 0) / k) * Math.sin(turn) + (hand.z - (seat.at?.[1] ?? 0) / k) * Math.cos(turn);
          const by = Math.max(0, ahead - (seat.bar.at - 0.1) / k);
          hand.x -= fx * by;
          hand.z -= fz * by;
        }
        // sitting sideways on a chair's edge, the elbows tucked in, not out into its back (or a desk it is pulled up to)
        const turn = seat?.turn ?? 0;
        let tuck = edge && seat?.from === "side" && seat.back != null ? Math.abs(Math.sin(turn)) * (1 - smooth(clamp(tb / 0.7, 0, 1))) : 0;
        // (and on a stool, beside something close at its elbows, seated: a counter's end, a booth's wall;
        // not a sofa's cushions, which its arms rest on)
        const beside = seat?.back == null ? seat?.elbows?.[i === 0 ? 1 : 0] ?? Infinity : Infinity;
        tuck = Math.max(tuck, clamp((0.55 * k - beside) / (0.25 * k), 0, 1) * w);
        this.reach(side, i, hand, bodyYaw, smooth(clamp(ta / 0.3, 0, 1)), tuck);
      }
      // the wrist relaxed, the hand turned a little palm-back
      this.local(`${side}Hand`, rot(this.hinge(`${side}IndexProximal`), 0.12 + 0.25 * g * moving - 0.25 * w, this.q.a));
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
   * Sitting on a seat of shape `shape`, its slot at (ox, oz) from the root facing `yaw` from it
   * (metres): where the hips, knees, feet and hands go, in the root's frame (rest units).
   *
   * The hip joints over the top by what is under them; their rump against the seat's back (or at
   * the slot, on a backless one), shuffled forward (and slouching back to the back) until the
   * backs of the knees reach the front edge, as far as that goes. The thighs along the top; the
   * shins down over the edge to the floor (the thighs tipping down off the edge as far as it lets
   * them, on a high seat), to the foot rail, or hanging; out along the seat on a lounger, or where
   * the seat is too deep for the knees to reach its edge.
   */
  private targets(seat: SeatPose, shape: SeatPose, ox: number, oz: number, yaw: number, k: number): SitTargets {
    const B = this.body;
    const h = shape.height;
    const depth = shape.depth ?? 0.3;
    const back = shape.back ?? null;
    const legs0 = this.legs[0];
    const a = legs0.a * k;
    const b = legs0.b * k;
    const hipY = h + B.underHip * k;
    // the rump against the back, or the hips at the slot
    // (what it wears on its back between it and the seat's back)
    // (leaning far back, the shoulder blades stand out further than the rump: a little further off a steep back)
    const hz0 = back !== null ? -back + (B.rump + this.wornBack()) * k + 0.035 + 0.06 * Math.sin(Math.max(0, shape.recline)) : 0;
    const flatKnee = h + B.underKnee * k;
    const dy = Math.max(0, hipY - flatKnee);
    const aH = Math.sqrt(Math.max(1e-6, a * a - dy * dy));
    // the backs of the knees at the front edge: a little of the knee past it
    const wantHz = depth + B.underKnee * k * 0.6 - aH;
    const most = back !== null ? 0.1 * k : Math.max(0, depth - 0.12);
    let hz = Math.max(hz0, Math.min(wantHz, hz0 + most));
    // something in front by the feet (a bar's front panel): on a backless seat, sit back on it
    // (as far as its rear lets the rump stay on) rather than tuck the shins back against its edge
    if (back === null && shape.room !== undefined) {
      const toes = hz + aH + b * Math.sin(0.15) + B.toe * k + 0.02;
      const over = toes - shape.room;
      // (never so far back that the knees are on the seat: the legs hang over its edge still, the calves clear of a cushion's rounded side)
      if (over > 0) hz = Math.max(hz - Math.min(over, Math.max(0, (shape.rear ?? 0.2) - B.rump * k * 0.6)), Math.min(hz, depth + 0.045 - aH));
    }
    const slouch = back !== null ? hz - hz0 : 0;
    // the body leans back as the seat's back does (and further, slouched), upright on a backless one
    const torso = (this.chimp.rig.bones[this.chimp.rig.index.upperChest].head[1] - legs0.hip.y) * k;
    const lie = back !== null ? shape.recline + Math.atan2(slouch, torso) : -0.04;
    const knee: Vector3[] = [];
    const ankle: Vector3[] = [];
    const pitch: number[] = [];
    let planted = shape.legs === "down";
    const footY = (shape.footrest ?? 0) + B.heel * k;
    // the heels clear of what is under the seat (a sofa's plinth)
    const clearZ = shape.base ? shape.base + B.heelBack * k + 0.015 : -Infinity;
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      const hx = leg.hip.x * k;
      let kz: number;
      let ky: number;
      let az: number;
      let ay: number;
      let fp = 0;
      if (shape.legs === "out" || hz + aH < depth - 0.03) {
        // out along the seat: knees a little up, heels on the top; past a deep seat's edge, the
        // shins drooping down over it as far as the edge lets them
        ky = flatKnee + (shape.legs === "out" ? 0.05 * k : 0);
        kz = hz + Math.sqrt(Math.max(1e-6, a * a - (hipY - ky) ** 2));
        // (the heel on the top, the calf above it: it is thicker than the heel; over what lies on the top, a rolled towel)
        // (only a rise the heel reaches: the shin rests on it with the knee raised as far)
        const rise = shape.legs === "out" && kz + b + B.heelBack * k > (shape.riseAt ?? Infinity) ? shape.rise ?? 0 : 0;
        ky += rise * 0.6;
        kz = hz + Math.sqrt(Math.max(1e-6, a * a - (hipY - ky) ** 2));
        let ang = Math.asin(clamp((ky - (h + rise + B.heel * k * 1.15 + 0.025)) / b, -1, 1));
        if (shape.legs === "down") {
          const run = Math.max(0.02, depth - kz);
          const most = Math.atan2(Math.max(0, ky - h - B.underKnee * k * 0.9), run);
          ang = Math.max(ang, Math.min(most, Math.asin(clamp((ky - footY) / b, -1, 1))));
        }
        az = kz + b * Math.cos(ang);
        ay = ky - b * Math.sin(ang);
        fp = shape.legs === "out" ? -0.7 : 0.2;
        planted = false;
      } else {
        // the thighs along the top, and tipped down off its edge as far as the edge lets them
        const over = Math.max(0.02, depth - hz);
        const tipMost = Math.atan2(Math.max(0, hipY - h - B.underKnee * k * 1.1), over);
        const need = Math.asin(clamp((hipY - (footY + b * 0.97)) / a, -1, 1));
        let tip = Math.asin(clamp(dy / a, -1, 1));
        const reaches = need <= Math.min(tipMost, 0.75);
        tip = clamp(reaches ? Math.max(tip, need) : Math.min(Math.max(tip, need), tipMost, 0.75), -0.6, 0.75);
        kz = hz + a * Math.cos(tip);
        ky = hipY - a * Math.sin(tip);
        const drop = ky - footY;
        if (drop <= b * 0.995 && drop > b * 0.5) {
          // the foot on the floor or the rail, the shin down and forward to it (back to a rail under the seat)
          const run = Math.sqrt(b * b - drop * drop);
          ay = footY;
          if (shape.footrest !== undefined) {
            const ring = Math.min(depth * 0.85, 0.17);
            // (the shin no further back under the seat than about upright: the calf clear of the cushion's front)
            az = clamp(Math.max(ring, kz - 0.03 * k), kz - run, kz + run * 0.3);
            ay = ky - Math.sqrt(Math.max(1e-6, b * b - (az - kz) ** 2));
            fp = 0.3;
            planted = false;
          } else if (kz + run >= clearZ) az = kz + run;
          else {
            // the floor under the edge is taken (a plinth): the feet forward of it, off the floor
            az = clearZ;
            ay = ky - Math.sqrt(Math.max(1e-6, b * b - (clearZ - kz) ** 2));
            fp = 0.3;
            planted = false;
          }
        } else if (drop <= b * 0.5) {
          // a low seat: the knees come up, the shins a little forward to the feet
          const s = 0.3;
          ky = footY + b * Math.cos(s);
          az = kz + b * Math.sin(s);
          kz = hz + Math.sqrt(Math.max(1e-6, a * a - (ky - hipY) ** 2));
          az = kz + b * Math.sin(s);
          ay = footY;
        } else {
          // hanging: the shins down from the knees, relaxed a touch forward (or further, clear of what is under the seat), toes down
          const lean = Math.max(0.15, Math.asin(clamp((clearZ - kz) / b, -1, 0.9)));
          az = kz + b * Math.sin(lean);
          ay = ky - b * Math.cos(lean);
          fp = 0.45;
          planted = false;
        }
      }
      knee.push(new Vector3(hx * 1.12, ky, kz));
      ankle.push(new Vector3(hx * 1.22, ay, az));
      pitch.push(fp);
    }
    // the hands on the thighs, most of the way to the knees, on top
    const hand = knee.map((kn, i) => {
      const hip = new Vector3(this.legs[i].hip.x * k, hipY, hz);
      const p = Vector3.Lerp(hip, kn, 0.62);
      p.x *= 1.35;
      p.y += B.underKnee * k * 1.6 + 0.03 * k;
      return p;
    });
    // into the root's frame, in rest units
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const to = (v: Vector3) => new Vector3((ox + v.x * c + v.z * sn) / k, v.y / k, (oz - v.x * sn + v.z * c) / k);
    const hipsRest = this.chimp.rig.bones[this.chimp.rig.index.hips].head;
    const hips = to(new Vector3(0, hipY + (hipsRest[1] - legs0.hip.y) * k, hz + (hipsRest[2] - legs0.hip.z) * k));
    void seat;
    return {
      hips,
      yaw,
      // the hips' pitch: a sitting chimp's pelvis rolls back from its standing stoop
      lean: -0.12 - lie,
      knee: [to(knee[0]), to(knee[1])],
      ankle: [to(ankle[0]), to(ankle[1])],
      pitch: [pitch[0], pitch[1]],
      hand: [to(hand[0]), to(hand[1])],
      planted,
    };
  }

  /**
   * Between sitting on the edge (`a`) and on the seat (`b`), `t` of the way: turning round about
   * the hips first (so an elbow doesn't sweep through a chair's back), then sliding to the seat's
   * place, the feet lifted over its edge as they swing up onto it.
   */
  private blendTargets(a: SitTargets, b: SitTargets, t: number, seat: SeatPose, k: number): SitTargets {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const ty = smooth(clamp(t / 0.7, 0, 1));
    const tp = smooth(clamp((t - 0.25) / 0.75, 0, 1));
    const yaw = lerp(a.yaw, b.yaw, ty);
    // the body (from the hips up), on a chair, turning a little ahead of the legs: its shoulders square to the chair's back sooner
    const bodyYaw = seat.back != null && seat.legs === "down" ? lerp(a.yaw, b.yaw, smooth(clamp(t / 0.5, 0, 1))) : yaw;
    const hips = Vector3.Lerp(a.hips, b.hips, tp);
    // each point in its pose's own frame about the hips, mixed, and put back about the hips now
    const local = (v: Vector3, o: Vector3, y0: number) => {
      const c = Math.cos(-y0);
      const s = Math.sin(-y0);
      const x = v.x - o.x;
      const z = v.z - o.z;
      return new Vector3(x * c + z * s, v.y, -x * s + z * c);
    };
    const back = (v: Vector3) => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      return new Vector3(hips.x + v.x * c + v.z * s, v.y, hips.z - v.x * s + v.z * c);
    };
    const mix = (u: Vector3, v: Vector3, lift = 0) => {
      const p = back(Vector3.Lerp(local(u, a.hips, a.yaw), local(v, b.hips, b.yaw), ty));
      p.y += lift * Math.sin(Math.PI * ty);
      return p;
    };
    const h = seat.height / k;
    // (swinging the legs up onto a lounging seat, the feet over its edge; down over a chair's, they stay down)
    const lift = (i: number) => (seat.legs === "out" ? Math.max(0, h + 0.18 - Math.min(a.ankle[i].y, b.ankle[i].y)) : 0);
    const knee = [mix(a.knee[0], b.knee[0], lift(0) * 0.7), mix(a.knee[1], b.knee[1], lift(1) * 0.7)];
    const ankle = [mix(a.ankle[0], b.ankle[0], lift(0)), mix(a.ankle[1], b.ankle[1], lift(1))];
    // swivelling round on a chair, the feet tucked in under it half way round, not swept out wide (into a desk);
    // (not on a bench or a stool: under its edge is the bench itself)
    if (seat.legs === "down" && seat.back != null) {
      const tuck = 0.35 * Math.sin(Math.PI * ty);
      ankle.forEach((v, i) => {
        // (no further in than a little ahead of the knee: the calf not back under the seat's edge)
        const out = Math.hypot(v.x - hips.x, v.z - hips.z);
        const most = Math.min(tuck, Math.max(0, 1 - (Math.hypot(knee[i].x - hips.x, knee[i].z - hips.z) + 0.06) / Math.max(1e-6, out)));
        v.x -= (v.x - hips.x) * most;
        v.z -= (v.z - hips.z) * most;
      });
    }
    const hand = [mix(a.hand[0], b.hand[0]), mix(a.hand[1], b.hand[1])];
    // something in front by the feet (a desk's front panel): sliding back onto the seat sooner, as
    // far as keeps the knees and toes clear of it as the legs swing round to it
    // (legs hanging down: on a lounging seat they lie along it, over its front)
    if (seat.legs === "down" && seat.room !== undefined && Number.isFinite(seat.room)) {
      const turn = seat.turn ?? 0;
      const fx = Math.sin(turn);
      const fz = Math.cos(turn);
      const ox = (seat.at?.[0] ?? 0) / k;
      const oz = (seat.at?.[1] ?? 0) / k;
      const ahead = (v: Vector3) => (v.x - ox) * fx + (v.z - oz) * fz;
      const most = seat.room / k - 0.03;
      // (the toes reach forward as far as the body has turned to face the way the seat does)
      const facing = Math.cos(yaw - turn);
      let over = 0;
      for (let i = 0; i < 2; i++) over = Math.max(over, ahead(knee[i]) + 0.05 - most, ahead(ankle[i]) + Math.max(0, facing) * this.body.toe + 0.03 - most);
      // (no further back than it ends up, nor so far, still turned sideways, that a shoulder is in the seat's back)
      let room = Math.max(0, ahead(hips) - ahead(b.hips));
      // (the back's face at the shoulders: further back up there as it leans)
      if (seat.back != null) room = Math.min(room, Math.max(0, ahead(hips) + (seat.back + 0.35 * Math.tan(seat.recline)) / k - 0.02 - this.shoulder() * Math.abs(Math.sin(bodyYaw - turn))));
      const by = Math.min(over, room);
      if (by > 0) for (const v of [hips, ...knee, ...ankle, ...hand]) v.subtractInPlace(new Vector3(fx * by, 0, fz * by));
    }
    return {
      hips,
      yaw: bodyYaw,
      lean: lerp(a.lean, b.lean, tp),
      knee: [knee[0], knee[1]],
      ankle: [ankle[0], ankle[1]],
      pitch: [lerp(a.pitch[0], b.pitch[0], ty), lerp(a.pitch[1], b.pitch[1], ty)],
      hand: [hand[0], hand[1]],
      planted: a.planted && b.planted,
    };
  }

  /**
   * How far what the chimp wears on its back stands out behind its own back (rest units): a
   * backpack's depth, so it sits forward of a seat's back by that much. Items are made in the
   * rest pose's space, as the skin is.
   */
  private wornBack(): number {
    const c = this.chimp;
    if (this.packFor === c.version) return this.pack;
    this.packFor = c.version;
    this.pack = 0;
    const id = c.wearing().back;
    const body = c.meshes.find((m) => m.name.endsWith(" body")) as Mesh | undefined;
    const bp = body?.getVerticesData("position");
    if (!id || !bp) return 0;
    let lo = Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const m of c.scene.meshes) {
      if (!m.name.startsWith(`${c.root.name} ${id} `)) continue;
      const p = m.getVerticesData("position");
      if (!p) continue;
      for (let i = 0; i < p.length; i += 3) {
        // behind the body only (not the straps over the chest)
        if (p[i + 2] > 0) continue;
        lo = Math.min(lo, p[i + 2]);
        y0 = Math.min(y0, p[i + 1]);
        y1 = Math.max(y1, p[i + 1]);
      }
    }
    if (lo === Infinity) return 0;
    let back = 0;
    for (let i = 0; i < bp.length; i += 3) if (bp[i + 1] > y0 && bp[i + 1] < y1 && Math.abs(bp[i]) < 0.15) back = Math.min(back, bp[i + 2]);
    this.pack = Math.max(0, back - lo);
    return this.pack;
  }

  /** How far out to its sides its shoulders stand from its middle (rest units): the upper arms' tops, and their thickness (a big chimp's deltoids). */
  private shoulder(): number {
    const r = this.chimp.rig;
    return Math.abs(r.bones[r.index.leftUpperArm].head[0]) + 0.1;
  }

  /** Where the hip joint of leg i is now (rest units, the root's frame). */
  private hipAt(i: number): Vector3 {
    const off = this.legs[i].hip.subtract(Vector3.FromArray(this.chimp.rig.bones[this.chimp.rig.index.hips].head));
    return this.chimp.nodes.hips.position.add(off.applyRotationQuaternion(this.G.hips));
  }

  /** Where bone `name`'s head is now (rest units, the root's frame), from the hips down its parents' turns this frame. */
  private jointAt(name: string): Vector3 {
    const r = this.chimp.rig;
    const b = r.bones[r.index[name]];
    if (name === "hips" || b.parent < 0) return this.chimp.nodes.hips.position.clone();
    const parent = r.bones[b.parent];
    const off = new Vector3(b.head[0] - parent.head[0], b.head[1] - parent.head[1], b.head[2] - parent.head[2]);
    return this.jointAt(parent.name).addInPlace(off.applyRotationQuaternion(this.G[parent.name]));
  }

  /**
   * Reach a hand to `target` (rest units, the root's frame) by two-bone IK, the elbow back and out,
   * blended in by `w` over the arm's own pose this frame (set just before).
   */
  private reach(side: string, i: number, target: Vector3, yaw: number, w: number, tuck = 0) {
    if (w <= 0) return;
    const r = this.chimp.rig;
    const head = (n: string) => Vector3.FromArray(r.bones[r.index[n]].head);
    const ua = `${side}UpperArm`;
    const la = `${side}LowerArm`;
    const sh = `${side}Shoulder`;
    const restUpper = head(la).subtract(head(ua));
    const restFore = head(`${side}Hand`).subtract(head(la));
    const A = restUpper.length();
    const Bl = restFore.length();
    const S = this.jointAt(ua);
    const d = target.subtract(S);
    const dist = clamp(d.length(), Math.abs(A - Bl) + 1e-4, (A + Bl) * 0.995);
    const n = d.normalize();
    // the elbow back and out, turned with the body
    const sign = i === 0 ? -1 : 1;
    // (tucked: down by its side and a little back)
    const pole = Vector3.Lerp(new Vector3(sign * 0.6, -0.5, 0.05), new Vector3(-sign * 0.05, -0.85, -0.35), tuck)
      .applyRotationQuaternion(rot(Y, yaw, new Quaternion()))
      .normalize();
    const poleP = pole.subtract(n.scale(Vector3.Dot(pole, n))).normalize();
    const cosA = clamp((A * A + dist * dist - Bl * Bl) / (2 * A * dist), -1, 1);
    const elbow = S.add(n.scale(A * cosA)).addInPlace(poleP.scale(A * Math.sin(Math.acos(cosA))));
    const hand = S.add(n.scale(dist));
    const G = this.G;
    // the upper arm: from the arm's own turn toward the IK's
    const ikUpper = new Quaternion();
    this.aim(ikUpper, restUpper, elbow.subtract(S), Z.scale(-1), poleP);
    const upper = Quaternion.Slerp(G[ua], ikUpper, w);
    G[ua].copyFrom(upper);
    this.set(ua, upper, sh);
    // the forearm: its own turn (on the blended upper arm) toward the IK's
    const fkFore = G[ua].multiply(this.chimp.nodes[la].rotationQuaternion!);
    const ikFore = new Quaternion();
    this.aim(ikFore, restFore, hand.subtract(elbow), Z.scale(-1), poleP);
    const fore = Quaternion.Slerp(fkFore, ikFore, w);
    G[la].copyFrom(fore);
    this.set(la, fore, ua);
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
   * space), the knee bent forward between by two-bone IK (toward `pole`, when
   * given); the foot pitched by `pitch` (toes down +) and turned by `yaw`.
   */
  private leg(side: string, i: number, ankle: Vector3, pitch: number, pole: Vector3 | null = null, yaw = 0) {
    const leg = this.legs[i];
    const G = this.G;
    // the hip joint where the hips are now
    const hip = this.hipAt(i);
    const d = ankle.subtract(hip);
    const reach = leg.a + leg.b;
    const dist = clamp(d.length(), Math.abs(leg.a - leg.b) + 1e-4, reach * 0.999);
    const n = d.normalize();
    // the knee points ahead, and a little out
    const want = pole ?? new Vector3((i === 0 ? -1 : 1) * 0.12, 0, 1).normalize();
    let poleP = want.subtract(n.scale(Vector3.Dot(want, n)));
    if (poleP.lengthSquared() < 1e-8) poleP = new Vector3(0, 1, 0).subtract(n.scale(n.y));
    poleP.normalize();
    const cosA = clamp((leg.a * leg.a + dist * dist - leg.b * leg.b) / (2 * leg.a * dist), -1, 1);
    const A = Math.acos(cosA);
    const knee = hip.add(n.scale(leg.a * cosA)).addInPlace(poleP.scale(leg.a * Math.sin(A)));
    const end = hip.add(n.scale(dist));
    this.hipNow[i].copyFrom(hip);
    this.kneeNow[i].copyFrom(knee);
    // the thigh and shin turned from their rest directions to these, knees kept ahead
    this.aim(G[`${side}UpperLeg`], leg.knee.subtract(leg.hip), knee.subtract(hip), Z, poleP);
    this.set(`${side}UpperLeg`, G[`${side}UpperLeg`], "hips");
    this.aim(G[`${side}LowerLeg`], leg.ankle.subtract(leg.knee), end.subtract(knee), Z, poleP);
    this.set(`${side}LowerLeg`, G[`${side}LowerLeg`], `${side}UpperLeg`);
    // the foot: level with the ground (the body's heading), pitched for the step
    rot(Y, yaw, G[`${side}Foot`]).multiplyInPlace(rot(X, pitch, this.q.a));
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
