// Sitting down. Every seat in the house (a sofa's places, an armchair, a stool, a bench's
// places…) is a slot with the seat role (world/roles.ts ROLE.seat), numbered and saying how it is
// sat on (world/context.ts SeatInfo); this finds them by that alone, so a seat modelled in Blender
// is found the same way.
//
// - Walking up to a free seat and looking at it offers "E: Sit down", unless something else
//   within reach already takes E (a cabinet, a remote, a controller, the screen…): seats come last.
//   Reach and aim are measured from the visitor's eyes (fly.eye, fly.aim), never the camera.
// - E sits: the chimp walks to where it sits down from (engine/walker.ts sit), turns round and
//   sits (avatar/animator.ts), fitted to the seat's shape, which is read from the furniture
//   (engine/seatShape.ts); the eye goes down to the seated chimp's, the camera behind it as ever.
//   A seat with a back is sat on from in front of it, back to it, feet where they stood; a stool,
//   a pouf, a lounger or a daybed from beside it, on its edge and then round onto it. E again
//   (when nothing else takes it), a walking key or Esc gets up, and a step clear of the seat.
// - One chimp a seat: who sits where is the room server's (engine/seatState.ts). A page sits on its
//   own copy at once; a seat someone else took first is refused, and the visitor gets up again. A
//   visitor leaving the house frees their seat. Other visitors see the chimp sitting from its own
//   word of which seat it is on (engine/avatars.ts), sat on this page's copy of that seat.

import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { SeatPose } from "../avatar/animator";
import { type SeatShape, measureSeat, roomAhead } from "./seatShape";
import type { SeatInfo, SeatMeta } from "../world/context";
import { ROLE, findAll } from "../world/roles";
import type { Avatars } from "./avatars";
import type { FlyCamera } from "./flyCamera";
import { ME, room } from "./room";
import { SEATS_TOPIC, type SeatCommand, type SeatsState, runSeatCommand, sitterOf } from "./seatState";
import { type PreviewState, store } from "./store";

/** How far a seat may be from the eyes to sit on it (m), across the floor, and how near the middle of the view it must be. */
const REACH = 2.4;
const REACH_ACROSS = 1.7;
const LOOK = Math.cos((35 * Math.PI) / 180);
/** The point looked at: this far above the seat's top (m), where a chimp's lap would be. */
const AIM_UP = 0.15;
/** Getting up, the chimp steps this far clear of the seat's edge (m): the walking body's radius and a little. */
const CLEAR = 0.38;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** A seat in the house, found by its role. */
interface Seat {
  n: number;
  node: TransformNode;
  info: SeatInfo;
  label: string;
  /** where a sitter's hips go (world), the floor under it, and the way it faces (unit, flat) */
  at: Vector3;
  floor: number;
  front: Vector3;
  /** its own place to stand up to (world, on the floor) */
  stand: Vector3;
}

/** What E does about seats here: sit on one, say who sits there, or stand up. */
export type SeatPrompt = { action: "sit"; seat: number; label: string } | { action: "taken"; seat: number; label: string; who: string } | { action: "stand"; seat: number; label: string };

/** What each kind of seat is called in the prompt. */
const NAMES: Record<SeatInfo["kind"], string> = {
  sofa: "sofa",
  armchair: "armchair",
  chair: "chair",
  stool: "stool",
  pouf: "pouf",
  bench: "bench",
  lounger: "sun lounger",
  daybed: "daybed",
  beanBag: "bean bag",
  eggChair: "egg chair",
  toilet: "golden toilet",
};

export class Seats {
  readonly seats: Seat[];
  private byNumber = new Map<number, Seat>();
  /** the seat this visitor sits on (this page's word: the shared state can lag), and where they step to getting up */
  private mine: { seat: Seat; out: Vector3 } | null = null;
  /** each seat's shape, measured the first time it is wanted, and the house it was measured in */
  private shapes = new Map<number, SeatShape>();
  private shapesOf: unknown = null;
  /** when this page last asked the server for its seat again (the server restarted, or its state crossed the sit) */
  private askedAt = 0;

  constructor(
    scene: Scene,
    private fly: FlyCamera,
    private avatars: Avatars,
    /** shows a short message */
    private flash: (msg: string) => void,
  ) {
    this.seats = findAll(scene, ROLE.seat)
      .filter((n): n is TransformNode => n instanceof TransformNode && !!(n.metadata as Partial<SeatMeta>).seat)
      .map((node) => {
        const md = node.metadata as SeatMeta;
        const wm = node.computeWorldMatrix(true);
        const at = wm.getTranslation();
        const f = Vector3.TransformNormal(new Vector3(0, 0, -1), wm);
        const front = new Vector3(f.x, 0, f.z).normalize();
        const stand = Vector3.TransformCoordinates(Vector3.FromArray(md.stand), wm);
        return { n: md.slot, node, info: md.seat, label: md.label, at, floor: at.y - md.seat.height, front, stand };
      });
    for (const s of this.seats) this.byNumber.set(s.n, s);
    // other visitors' chimps sit on this page's copy of their seat
    avatars.seatPose = (n) => {
      const s = this.byNumber.get(n);
      if (!s) return null;
      return { pose: this.pose(s), x: s.at.x, z: s.at.z, yaw: Math.atan2(s.front.x, s.front.z) };
    };
    // the server's state: everyone's sitting and getting up, and a latecomer told who sits where
    room.watch<SeatsState>(SEATS_TOPIC, (s) => this.follow(s));
  }

  /** The seat this visitor sits on, or null. */
  get seated(): number | null {
    return this.mine?.seat.n ?? null;
  }

  /**
   * Run a seat command: on this page's copy at once, so its visitor sits straight away, and on the
   * server's (which sends everyone the result, and puts this page right if it refuses). Returns why not, or null.
   */
  tell(cmd: SeatCommand): string | null {
    const next = runSeatCommand(store.get().seats, ME.id, cmd);
    if (typeof next === "string") return next;
    this.follow(next);
    room.command(SEATS_TOPIC, cmd.name, cmd.args);
    return null;
  }

  /** The seats are now `next` (this visitor's command, or the server's state). */
  private follow(next: SeatsState): void {
    store.set({ seats: next });
  }

  /**
   * Each frame, after everything else that offers E: keep this visitor seated (or get them up when
   * they walk, fly, or lost the seat to someone who sat first), and offer what E would do here.
   */
  update(): void {
    const s = store.get();
    const w = this.fly.walker;
    if (this.mine) {
      const sitter = sitterOf(s.seats, this.mine.seat.n);
      if (!s.walking || !w || !w.seated) this.getUp(false);
      else if (w.wantsToMove) this.stand();
      else if (sitter === null && room.connected && performance.now() - this.askedAt > 2000) {
        // the server doesn't have this visitor on their seat (it restarted, or its state crossed the sit): ask again
        this.askedAt = performance.now();
        room.command(SEATS_TOPIC, "sit", { seat: this.mine.seat.n });
      } else if (sitter !== null && sitter !== ME.id) {
        const who = this.avatars.nameOf(sitter);
        this.getUp(true);
        this.flash(`${who ?? "Someone"} sat there first`);
      }
    }
    const prompt = !s.focus && !s.wardrobe && s.walking && this.fly.enabled && w ? this.offer(s) : null;
    const was = s.seatPrompt;
    if (prompt?.action !== was?.action || prompt?.seat !== was?.seat || (prompt?.action === "taken" && was?.action === "taken" && prompt.who !== was.who)) store.set({ seatPrompt: prompt });
  }

  /** Do what E offers: sit down, or get up. */
  act(): void {
    const p = store.get().seatPrompt;
    if (p?.action === "sit") this.sit(p.seat);
    else if (p?.action === "stand") this.stand();
  }

  /** Sit on seat n (walking, and it free); facing the seat's way, or (a stool, a pouf) the way the visitor looks. */
  sit(n: number): boolean {
    const seat = this.byNumber.get(n);
    const w = this.fly.walker;
    const s = store.get();
    if (!seat || !w || !s.walking || s.focus) return false;
    const by = sitterOf(s.seats, n);
    if (by !== null && by !== ME.id) return false;
    if (this.tell({ name: "sit", args: { seat: n } })) return false;
    this.askedAt = performance.now();
    const look = seat.info.turn ? new Vector3(this.fly.aim.x, 0, this.fly.aim.z) : seat.front.clone();
    let f = look.lengthSquared() > 1e-6 ? look.normalize() : seat.front.clone();
    // a stool tucked in at the end of a counter, its top over the stool's side: turned to face it,
    // not with the counter over one side of the lap
    if (seat.info.turn) {
      const near = (d: Vector3) => {
        let r = Infinity;
        for (const up of [0.3, 0.38]) r = Math.min(r, w.world.raycast(seat.at.x, seat.at.y + up, seat.at.z, d.x, 0, d.z, 1));
        return r;
      };
      const right = new Vector3(f.z, 0, -f.x);
      const [r, l] = [near(right), near(right.scale(-1))];
      if (Math.min(r, l) < 0.3 && near(f) > Math.min(r, l)) f = r < l ? right : right.scale(-1);
    }
    const seatYaw = Math.atan2(f.x, f.z);
    let p = this.pose(seat);
    // a stool faces the way the visitor looks: what is in front of the feet that way
    if (seat.info.turn) p = { ...p, room: roomAhead((x, y, z, dx, dy, dz, max) => w.world.raycast(x, y, z, dx, dy, dz, max), seat.at.x, seat.at.z, f.x, f.z, seat.floor, seat.floor + p.height, Math.max(p.depth ?? 0.3, p.base ?? 0)) };
    // a bar or a counter top over the lap, the way the sitter will face: its edge and its height over the seat
    for (let d = 0.1; d < 0.56; d += 0.03) {
      const top = seat.at.y + 0.6 - w.world.raycast(seat.at.x + f.x * d, seat.at.y + 0.6, seat.at.z + f.z * d, 0, -1, 0, 0.6);
      if (top - seat.at.y > 0.12 && top - seat.at.y < 0.5) {
        p = { ...p, bar: { at: d, top: top - seat.at.y } };
        break;
      }
    }
    // beside the sitter at its elbows (over the seat, a little in front of the hips), right and left
    // (at the elbows' height: not the seat's own armrests under them)
    {
      const right = new Vector3(f.z, 0, -f.x);
      const elbows: [number, number] = [Infinity, Infinity];
      [right, right.scale(-1)].forEach((d, i) => {
        for (const up of [0.3, 0.38]) for (const a of [-0.05, 0.12]) elbows[i] = Math.min(elbows[i], w.world.raycast(seat.at.x + f.x * a, seat.at.y + up, seat.at.z + f.z * a, d.x, 0, d.z, 1));
      });
      p = { ...p, elbows };
    }
    const { out: off, along, arm } = this.avatars.standOff(p);
    // what is in front the way the sitter will face (for a stool, the way the visitor looks: the bar)
    let clear = Infinity;
    const from0 = (p.depth ?? 0.3) + 0.02;
    for (const up of [0.5, 0.75, 1.0, 1.1]) clear = Math.min(clear, from0 + w.world.raycast(seat.at.x + f.x * from0, seat.floor + up, seat.at.z + f.z * from0, f.x, 0, f.z, 2));
    // where it sits down from: in front of the seat; or beside it, on the visitor's side unless
    // that side has no room to stand in (a wall, a planter, the next lounger) and the other has
    let to = f;
    let edge = p.depth ?? 0.3;
    if (p.from === "side") {
      const right = new Vector3(f.z, 0, -f.x);
      const wide = p.width ?? 0.25;
      // the room from the seat's side out (at a chimp's shins, hips and chest, just under the seat's
      // top, the next stool's cushion, and over it, a counter's top: where an arm hangs)
      const room = (d: Vector3) => {
        let r = Infinity;
        for (const up of [0.3, 0.6, 0.9, p.height - 0.03, p.height + 0.28]) {
          // (from past the seat's own side: under its top, past what it stands on, a lounger's side rail)
          const from = (up < p.height - 0.05 ? Math.max(wide, p.sideBase ?? 0) : wide) + 0.04;
          r = Math.min(r, from + w.world.raycast(seat.at.x + d.x * from, seat.floor + up, seat.at.z + d.z * from, d.x, 0, d.z, 2) - wide);
        }
        return r;
      };
      const mine = Vector3.Dot(w.feet.subtract(seat.at), right) < 0 ? right.scale(-1) : right;
      const other = mine.scale(-1);
      const need = off + 0.32 - wide;
      const rm = room(mine);
      const ro = room(other);
      to = rm < need && ro > rm ? other : mine;
      // both sides crowded (a stool in a row of them): beside it and back, toward where the visitor came from
      if (seat.info.turn && Math.max(rm, ro) < need) {
        const slant = to.scale(0.6).subtractInPlace(f.scale(0.8)).normalize();
        if (room(slant) > Math.max(rm, ro)) to = slant;
      }
      edge = p.width ?? 0.25;
    }
    // beside it, a little back from what it faces (a counter's edge, a desk's): far enough that the
    // arm hanging that side, beside it as it faces along the seat's side, is clear of it
    const stand = seat.at.add(to.scale(off)).addInPlace(f.scale(along));
    if (p.from === "side") {
      // (what it faces there, where it stands beside the seat: a desk curving round toward it)
      let here = clear;
      for (const up of [0.5, 0.75, 1.0, p.height + 0.28]) for (const a of [-0.15, 0, 0.15]) {
        const o = seat.at.add(to.scale(off + a)).subtractInPlace(f.scale(0.2));
        here = Math.min(here, w.world.raycast(o.x, seat.floor + up, o.z, f.x, 0, f.z, 2) - 0.2);
      }
      stand.subtractInPlace(f.scale(clamp(Math.max(0.45 - clear, along + arm - here), 0, 0.3)));
    }
    this.mine = { seat, out: seat.at.add(to.scale(Math.max(off, edge + CLEAR))) };
    const back = this.avatars.seatedEyeBack(p);
    w.sit(stand.x, stand.z, seat.floor, this.avatars.seatedEye(p), seat.at.x - f.x * back, seat.at.z - f.z * back);
    this.avatars.mySeat = { n, floor: seat.floor, yaw: Math.atan2(to.x, to.z), pose: p, x: seat.at.x, z: seat.at.z, seatYaw };
    store.set({ seated: n, seatPrompt: null });
    return true;
  }

  /** Seat n's shape (engine/seatShape.ts), measured in the house as it is now; null without a walker to measure with. */
  shape(n: number): SeatShape | null {
    const seat = this.byNumber.get(n);
    return seat ? this.shapeOf(seat) : null;
  }

  private shapeOf(seat: Seat): SeatShape | null {
    const world = this.fly.walker?.world;
    if (!world) return null;
    // cabinets came or went: the house's solid surfaces are new, and so are the seats' shapes
    if (world !== this.shapesOf) {
      this.shapes.clear();
      this.shapesOf = world;
    }
    let sh = this.shapes.get(seat.n);
    if (!sh) {
      sh = measureSeat((x, y, z, dx, dy, dz, max) => world.raycast(x, y, z, dx, dy, dz, max), seat.at.x, seat.at.y, seat.at.z, seat.front.x, seat.front.z, seat.floor, seat.info);
      this.shapes.set(seat.n, sh);
    }
    return sh;
  }

  /** How a chimp sits on a seat: its shape as measured (or, with nothing to measure with, as it says), and how it is sat on. */
  private pose(seat: Seat): SeatPose {
    const info = seat.info;
    const sh = this.shapeOf(seat);
    return {
      height: sh?.height ?? info.height,
      recline: sh?.recline ?? info.recline,
      legs: info.legs,
      depth: sh?.depth ?? 0.3,
      back: sh ? sh.back : null,
      width: sh?.width ?? 0.25,
      rear: sh?.rear ?? 0.2,
      base: sh?.base ?? 0,
      sideBase: sh?.sideBase ?? 0,
      room: sh?.room ?? Infinity,
      rise: sh?.rise ?? 0,
      riseAt: sh?.riseAt ?? Infinity,
      // from beside it: a stool, a pouf, a lounger, or a seat pulled up to something (a desk, a counter, a piano) where its sitter would stand to sit down
      from: info.from ?? (info.turn || info.legs === "out" || (sh && !sh.arms && sh.clear < sh.depth + 0.6) ? "side" : "front"),
      ...(info.footrest !== undefined && { footrest: info.footrest }),
    };
  }

  /** Get up from the seat, back to where the visitor stood. */
  stand(): void {
    this.getUp(true);
  }

  /** Get up: off the seat for everyone, and (`walk`) up on the visitor's feet, a step clear of the seat. */
  private getUp(walk: boolean): void {
    const mine = this.mine;
    if (!mine) return;
    this.mine = null;
    this.avatars.mySeat = null;
    // said to the server even when this page's copy has lost the seat already (a state that crossed the sit on its way)
    this.tell({ name: "stand" });
    store.set({ seated: null, seatPrompt: null });
    const w = this.fly.walker;
    if (!walk || !w?.seated) return;
    w.stand(mine.out.x, mine.out.z);
  }

  /** What E would do about seats here, if nothing else takes it: get up, or sit on the seat looked at (or say who sits there). */
  private offer(s: PreviewState): SeatPrompt | null {
    // a snack in hand is eaten with E anywhere: a seat looked at comes first, but sitting, E eats
    const eat = s.snackPrompt?.action === "eat";
    const other =
      !!s.arcadePrompt || !!s.remotePrompt || !!s.tvPrompt || s.theatrePrompt || !!s.liftPrompt || !!s.plushPrompt || s.clawPrompt || !!s.pinballPrompt || !!s.airHockeyPrompt || !!s.foosballPrompt || (!!s.snackPrompt && !eat);
    if (other) return null;
    if (this.mine) return eat ? null : { action: "stand", seat: this.mine.seat.n, label: NAMES[this.mine.seat.info.kind] };
    const seat = this.lookedAt();
    if (!seat) return null;
    const by = sitterOf(s.seats, seat.n);
    const label = NAMES[seat.info.kind];
    if (by !== null && by !== ME.id) return { action: "taken", seat: seat.n, label, who: this.avatars.nameOf(by) ?? "Someone" };
    return { action: "sit", seat: seat.n, label };
  }

  /** The seat the visitor is looking at, within reach of their eyes, in front of it (a seat with a back) and in plain view; or null. */
  private lookedAt(): Seat | null {
    const w = this.fly.walker!;
    const eye = this.fly.eye;
    const aim = this.fly.aim;
    let best: Seat | null = null;
    let bestCos = LOOK;
    for (const seat of this.seats) {
      const dx = seat.at.x - eye.x;
      const dz = seat.at.z - eye.z;
      if (Math.abs(dx) > REACH || Math.abs(dz) > REACH) continue;
      const across = Math.hypot(dx, dz);
      // on the same floor as the visitor: the seat's floor near their feet
      if (across > REACH_ACROSS || Math.abs(seat.floor - w.feet.y) > 0.45) continue;
      const to = new Vector3(dx, seat.at.y + AIM_UP - eye.y, dz);
      const d = to.length();
      if (d > REACH) continue;
      const cos = Vector3.Dot(aim, to) / d;
      if (cos < bestCos) continue;
      // a seat with a back to lean on is sat on from in front of it, not over its back; a backless or
      // low-backed one (a stool, a bench, a desk chair pulled up to its desk) from anywhere round it
      if (!openSeat(seat.info) && -(dx * seat.front.x + dz * seat.front.z) < -0.15) continue;
      // nothing in the way but the seat itself (a wall, glass, a railing)
      const hit = w.world.raycast(eye.x, eye.y, eye.z, to.x / d, to.y / d, to.z / d, d);
      if (hit < d - 0.5) continue;
      best = seat;
      bestCos = cos;
    }
    return best;
  }

  /** For tests and tools: every seat (number, kind, where), who sits where, and this visitor's. */
  describe() {
    return {
      seats: this.seats.map((s) => ({ n: s.n, kind: s.info.kind, label: s.label, room: (s.node.metadata as SeatMeta).room, at: s.at.asArray(), floor: s.floor, front: s.front.asArray(), stand: s.stand.asArray(), info: s.info, shape: this.shapes.get(s.n) ?? null })),
      taken: { ...store.get().seats.taken },
      mine: this.seated,
    };
  }
}

/** Whether a seat can be sat on from any side: nothing much behind the sitter to lean on. */
export function openSeat(info: SeatInfo): boolean {
  return !!info.turn || info.recline <= 0.12;
}
