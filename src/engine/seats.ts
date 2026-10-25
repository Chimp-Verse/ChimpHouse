// Sitting down. Every seat in the house (a sofa's places, an armchair, a stool, a bench's
// places…) is a slot with the seat role (world/roles.ts ROLE.seat), numbered and saying how it is
// sat on (world/context.ts SeatInfo); this finds them by that alone, so a seat modelled in Blender
// is found the same way.
//
// - Walking up to a free seat and looking at it offers "E: Sit down", unless something else
//   within reach already takes E (a cabinet, a remote, a controller, the screen…): seats come last.
//   Reach and aim are measured from the visitor's eyes (fly.eye, fly.aim), never the camera.
// - E sits: the walker holds still at the seat (engine/walker.ts sit), the eye lowered to the
//   seated chimp's; the chimp turns, sits and leans back (avatar/animator.ts), the camera behind it
//   as ever. E again (when nothing else takes it), a walking key or Esc gets up, back to where
//   the visitor stood.
// - One chimp a seat: who sits where is the room server's (engine/seatState.ts). A page sits on its
//   own copy at once; a seat someone else took first is refused, and the visitor gets up again. A
//   visitor leaving the house frees their seat. Other visitors see the chimp sitting from its own
//   word of which seat it is on (engine/avatars.ts), sat on this page's copy of that seat.

import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { SeatPose } from "../avatar/animator";
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
/** Standing up returns to where the visitor stood when they sat, when that is this near (m); otherwise to the seat's own place to stand. */
const BACK_TO = 2.2;

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
  /** the seat this visitor sits on (this page's word: the shared state can lag), the way they face on it, and where they stood */
  private mine: { seat: Seat; yaw: number; from: Vector3 } | null = null;
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
      return s ? pose(s.info) : null;
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
    const look = seat.info.turn ? new Vector3(this.fly.aim.x, 0, this.fly.aim.z) : seat.front;
    const yaw = look.lengthSquared() > 1e-6 ? Math.atan2(look.x, look.z) : Math.atan2(seat.front.x, seat.front.z);
    const from = this.mine?.from ?? w.feet.clone();
    this.mine = { seat, yaw, from };
    const p = pose(seat.info);
    w.sit(seat.at.x, seat.at.z, seat.floor, this.avatars.seatedEye(p));
    this.avatars.mySeat = { n, floor: seat.floor, yaw, pose: p };
    store.set({ seated: n, seatPrompt: null });
    return true;
  }

  /** Get up from the seat, back to where the visitor stood. */
  stand(): void {
    this.getUp(true);
  }

  /** Get up: off the seat for everyone, and (`walk`) back on the visitor's feet where they stood. */
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
    const back = mine.from;
    const near = Math.hypot(back.x - mine.seat.at.x, back.z - mine.seat.at.z) < BACK_TO && Math.abs(back.y - mine.seat.floor) < 0.4;
    const to = near ? back : mine.seat.stand;
    w.stand(to.x, to.z, to.y);
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
      seats: this.seats.map((s) => ({ n: s.n, kind: s.info.kind, label: s.label, room: (s.node.metadata as SeatMeta).room, at: s.at.asArray(), floor: s.floor, front: s.front.asArray(), stand: s.stand.asArray(), info: s.info })),
      taken: { ...store.get().seats.taken },
      mine: this.seated,
    };
  }
}

/** Whether a seat can be sat on from any side: nothing much behind the sitter to lean on. */
export function openSeat(info: SeatInfo): boolean {
  return !!info.turn || info.recline <= 0.12;
}

/** How the chimp sits on a seat, from the seat's info. */
function pose(info: SeatInfo): SeatPose {
  return { height: info.height, recline: info.recline, legs: info.legs, ...(info.footrest !== undefined && { footrest: info.footrest }) };
}
