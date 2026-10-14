// Won plushes out of the Chimp Claw (engine/clawMachine.ts): carried, looked at, put down on the
// floor and picked up again.
//
// A prize taken from the pickup door is in your hand: low on the left of the view, the way a held
// thing is in a first-person game (the snack machine's snack is held the same way, low on the
// right, engine/snackMachine.ts), its own mesh on the camera, drawn over the room so it never
// sinks into a wall. Hold T and move the mouse to bring it up in front of you and turn it about;
// Q puts it down: it drops from your hand and tumbles to rest on the floor in front of you (its own
// soft body, engine/clawPhysics.ts, falling onto a flat floor), at the nearest clear spot there,
// never in a wall or a machine. Looking at one on the floor, E picks it up again.
//
// Who carries which plush, and where the ones put down lie, is one list shared through the room
// (topic claw/plushes); a carrier's page says where their hand is a few times a second
// (claw/carry), so the others see the plush going about with them, their name over it. The room
// keeps the newest MAX_FLOOR put down, for as long as the room server runs. A plush is never solid
// for walking.

import { Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { MeshMeta } from "../world/context";
import { roomAt } from "../world/layout";
import { Materials } from "../world/materials/library";
import { ClawSpec, PRIZE_NAMES, PrizeKind, plushMat, prizeGeo } from "../world/props/clawMachine";
import { PrizeWorld } from "./clawPhysics";
import { closestOnTriangle, emptyProbe } from "./collision";
import { FlyCamera, isTyping } from "./flyCamera";
import { Lighting } from "./lighting";
import { ME, room } from "./room";
import { VIEWER, store } from "./store";

/** How many put-down plushes the room keeps: past this, the oldest goes. */
export const MAX_FLOOR = 20;
/** How often (s) a carrier's page says where the plush is. */
const CARRY_EVERY = 1 / 8;
/** Out of the pickup door or off the floor into the hand (ms). */
const TAKE_MS = 450;
/**
 * The plush in the hand, in the camera's frame: low on the left, its face turned in a little; and
 * held up to look at (T), in the middle of the view, a little low, facing you. Drawn smaller than
 * life (as a first-person game draws what is in hand), each kind to the same size in the view:
 * `size` is how far it reaches from its centre there (m).
 */
const HAND = { pos: new Vector3(-0.2, -0.17, 0.52), rot: Quaternion.RotationYawPitchRoll(-0.4, 0.15, 0.05), size: 0.075 };
const LOOK = { pos: new Vector3(0, -0.03, 0.42), rot: Quaternion.Identity(), size: 0.075 };
/** How far off (m) a plush on the floor can be picked up from the eye, and how near the line of sight its centre must pass. */
const REACH = 2.3;
const AIM = 0.14;
/** Turning a plush held up: radians per pixel of mouse movement. */
const TURN = 0.009;

/** A plush out of the machine: carried by a visitor, or lying on the floor. */
export interface Plush {
  id: string;
  kind: PrizeKind;
  /** who carries it (a visitor id), or null while it lies on the floor */
  by: string | null;
  /** the carrier's name, or the name of whoever put it down */
  name: string;
  /** its centre of mass (world): where it lies, or where it was picked up from while carried */
  at: [number, number, number];
  /** its turn (quaternion xyzw, world) where it lies */
  q: [number, number, number, number];
  /** when it was picked up or put down (room time, ms) */
  t: number;
  /** taken from the machine's pickup door: the prize's body there and where it lay (machine frame), so every page takes that one out */
  from?: { b: number; at: [number, number, number] };
}

interface PlushList {
  list: Plush[];
}

/** A carrier's hand, from their page: where the plush is (world) and the way they face. */
interface Carry {
  by: string;
  id: string;
  at: [number, number, number];
  yaw: number;
  /** where they stand (world): a plush left when they go is put down here */
  feet: [number, number, number];
}

/** A plush in this visitor's hand. */
interface Held {
  p: Plush;
  mesh: Mesh;
  phase: "taking" | "held";
  since: number;
  /** where it came from, in the camera's frame, while being taken */
  from: { pos: Vector3; rot: Quaternion };
  /** how far it is held up to look at, 0..1 */
  look: number;
  /** how the visitor has turned it, on top of how it is held */
  turn: Quaternion;
}

/** A plush shown in the world: on the floor, or carried by someone else. */
interface Shown {
  mesh: Mesh;
  kind: PrizeKind;
  /** carried by someone else: their name over it */
  tag: Mesh | null;
  /** falling to the floor: com xyz and quaternion xyzw per frame, 60 a second, from `since` (ms); let go from the hand, it grows from the hand's size to its own as it leaves */
  fall: { frames: Float32Array; since: number; grow?: number } | null;
  /** what is shown now (com, world), to ease toward where it is */
  at: Vector3;
  q: Quaternion;
}

/** What is known of each kind of prize: where its mesh's origin is from its centre of mass, how far it reaches, how it lies at rest. */
interface KindInfo {
  rest: Vector3;
  bound: number;
  /** at rest on a floor, sat as stocked: its turn, and its centre's height above the floor */
  restQ: Quaternion;
  restH: number;
}

export class PlushCarry {
  private list: Plush[] = [];
  private publishList: (s: PlushList) => void;
  private publishCarry: (c: Carry | null) => void;
  private carries = new Map<string, Carry>();
  private held: Held | null = null;
  /** this visitor's last put-down, until the room's list shows it (a change at the same moment as someone else's can be lost) */
  private lastDrop: Plush | null = null;
  private shown = new Map<string, Shown>();
  private sources = new Map<PrizeKind, Mesh>();
  private infos = new Map<PrizeKind, KindInfo>();
  private takesSeen = new Set<string>();
  private turning = false;
  private sentAt = 0;
  private clock = 0;
  private next = 1;
  private republish = false;
  private material: string;
  /** what E would pick up off the floor */
  private target: string | null = null;
  private tmp = { m: new Matrix(), m2: new Matrix(), v: new Vector3(), q: new Quaternion(), s: new Vector3() };

  constructor(
    private scene: Scene,
    mats: Materials,
    private lighting: Lighting,
    private fly: FlyCamera,
    private spec: ClawSpec,
    /** the machine's own meshes' metadata (the Game Room), for the plush in hand */
    private meta: { room: string; roomName: string; level: MeshMeta["level"] },
    /** a plush has been taken from the pickup door (by anyone): the machine takes that prize out */
    private onTaken: (p: Plush) => void,
    private flash: (msg: string) => void,
  ) {
    this.material = plushMat({ mats });
    const mat = mats.get(this.material);
    for (const kind of Object.keys(PRIZE_NAMES) as PrizeKind[]) {
      const m = prizeGeo(kind).build(`Plush: ${PRIZE_NAMES[kind]}`, scene);
      m.material = mat;
      m.setEnabled(false);
      m.isPickable = false;
      this.sources.set(kind, m);
    }
    this.publishList = room.share<PlushList>("claw/plushes", { list: [] }, (s) => this.apply(s));
    this.publishCarry = room.share<Carry | null>("claw/carry", null, (c) => {
      if (c && c.by !== VIEWER) this.carries.set(c.by, c);
    });
    // a visitor who goes leaves what they carried where they stood
    room.onGone((id) => {
      const theirs = this.list.filter((p) => p.by === id);
      if (!theirs.length) return;
      const c = this.carries.get(id);
      this.carries.delete(id);
      const now = room.now();
      const list = this.list.map((p) => {
        if (p.by !== id) return p;
        const k = this.info(p.kind);
        const at: [number, number, number] = c ? [c.feet[0], c.feet[1] + k.restH, c.feet[2]] : p.at;
        return { ...p, by: null, at, q: [k.restQ.x, k.restQ.y, k.restQ.z, k.restQ.w] as Plush["q"], t: now, from: undefined };
      });
      this.publishList({ list: capFloor(list) });
    });

    // T held: the plush comes up in front of you and the mouse turns it instead of the view
    fly.mouseTaken = () => this.turning;
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyT" || e.repeat || isTyping(e) || !this.held || store.get().focus) return;
      this.setTurning(true);
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "KeyT") this.setTurning(false);
    });
    window.addEventListener("blur", () => this.setTurning(false));
    document.addEventListener("mousemove", (e) => {
      if (this.turning) this.turn(e.movementX, e.movementY);
    });
  }

  /** Hold the plush up to look at it (or stop): while held up, the mouse turns it (tests and the HUD call this too). */
  setTurning(on: boolean): void {
    on = on && !!this.held;
    if (on === this.turning) return;
    this.turning = on;
    this.publishHeld();
  }

  /** Turn the plush held up by a mouse movement (px): sideways about the view's up, up and down about its right. */
  turn(dx: number, dy: number): void {
    const h = this.held;
    if (!h) return;
    const r = Quaternion.RotationAxis(Vector3.Up(), -dx * TURN).multiply(Quaternion.RotationAxis(Vector3.Right(), -dy * TURN));
    h.turn = r.multiply(h.turn);
    h.turn.normalize();
  }

  /** The plush carried, if any: its name. */
  get holding(): string | null {
    return this.held ? PRIZE_NAMES[this.held.p.kind] : null;
  }

  // ------------------------------------------------------------------ the shared list

  private apply(s: PlushList): void {
    this.list = s.list;
    for (const p of this.list)
      if (p.from && !this.takesSeen.has(p.id)) {
        this.takesSeen.add(p.id);
        this.onTaken(p);
      }
    // this visitor's own pick-up or put-down, lost to someone else's change made at the same moment: made again
    const h = this.held;
    if (h) {
      const e = this.list.find((p) => p.id === h.p.id);
      if (e && e.by !== null && e.by !== VIEWER) {
        // someone else got it first
        h.mesh.dispose();
        this.held = null;
        this.turning = false;
        this.publishHeld();
        this.flash(`${e.name} picked up the ${PRIZE_NAMES[e.kind]} first`);
      } else if (!e || e.by !== VIEWER) this.republish = true;
    }
    const d = this.lastDrop;
    if (d) {
      const e = this.list.find((p) => p.id === d.id);
      if (!e || (e.by === VIEWER && !this.held)) this.republish = true;
      else this.lastDrop = null;
    }
    this.syncShown();
  }

  /** Publish the list with this visitor's own change made: the plush in hand as theirs, the last put down on the floor. */
  private publish(list: Plush[]): void {
    this.publishList({ list: capFloor(list) });
  }

  private mend(): void {
    this.republish = false;
    let list = this.list;
    const h = this.held;
    if (h) list = [...list.filter((p) => p.id !== h.p.id), h.p];
    const d = this.lastDrop;
    if (d) list = [...list.filter((p) => p.id !== d.id), d];
    this.publish(list);
  }

  /** The machine's prize, taken out of the pickup door into this visitor's hand: its kind, where it lay (world matrix of its mesh), and which body it was. */
  takeFromDoor(kind: PrizeKind, lay: Matrix, from: { b: number; at: [number, number, number] }): boolean {
    if (this.held) return false;
    const now = room.now();
    const c = Vector3.TransformCoordinates(this.info(kind).rest, lay);
    const p: Plush = { id: `${VIEWER}:${this.next++}`, kind, by: VIEWER, name: ME.name, at: [c.x, c.y, c.z], q: [0, 0, 0, 1], t: now, from };
    this.hold(p, lay);
    // the machine sees it taken through the list, as every page does
    this.publish([...this.list, p]);
    return true;
  }

  /** A prize set out of the pickup door onto the floor (the bin is full): it drops from where it lay (`lay`) to lie at `spot` on the floor, facing `yaw`'s way round. */
  setOut(kind: PrizeKind, lay: Matrix, spot: Vector3, yaw: number, from: { b: number; at: [number, number, number] }): void {
    const k = this.info(kind);
    const q = Quaternion.RotationYawPitchRoll(yaw, 0, 0).multiply(k.restQ);
    const p: Plush = { id: `${VIEWER}:${this.next++}`, kind, by: null, name: "the attendant", at: [spot.x, spot.y + k.restH, spot.z], q: [q.x, q.y, q.z, q.w], t: room.now(), from };
    const s = this.show(p);
    lay.decompose(undefined, s.q, undefined);
    s.at.copyFrom(Vector3.TransformCoordinates(k.rest, lay));
    s.fall = { frames: this.settleFrames(s, p), since: room.now() };
    this.publish([...this.list, p]);
  }

  /** How many plushes lie on the floor. */
  outCount(): number {
    return this.list.filter((p) => p.by === null).length;
  }

  /** Pick up the plush on the floor that E is offered for. */
  pickUp(): boolean {
    if (this.held) {
      this.flash("One plush at a time: put down the one you have first (Q)");
      return false;
    }
    const id = this.target;
    const p = id ? this.list.find((x) => x.id === id && x.by === null) : null;
    if (!p) return false;
    const s = this.shown.get(p.id);
    const lay = s ? s.mesh.computeWorldMatrix(true).clone() : this.layMatrix(p.kind, Vector3.FromArray(p.at), Quaternion.FromArray(p.q));
    const mine: Plush = { ...p, by: VIEWER, name: ME.name, t: room.now(), from: undefined };
    this.hold(mine, lay);
    this.publish(this.list.map((x) => (x.id === p.id ? mine : x)));
    return true;
  }

  private hold(p: Plush, lay: Matrix): void {
    const mesh = this.sources.get(p.kind)!.clone(`Plush in hand: ${PRIZE_NAMES[p.kind]}`, this.fly.camera);
    mesh.setEnabled(true);
    mesh.metadata = { ...this.meta, labels: [{ face: 0, label: `Plush in hand: ${PRIZE_NAMES[p.kind]}` }], matKey: this.material, kind: "moving" } satisfies MeshMeta;
    mesh.isPickable = false;
    mesh.renderingGroupId = 2;
    mesh.alwaysSelectAsActiveMesh = true;
    this.lighting.addMeshes([mesh], []);
    // where it lay, in the camera's frame, to come out from
    const from = { pos: new Vector3(), rot: new Quaternion() };
    lay.multiply(this.fly.camera.getWorldMatrix().clone().invert()).decompose(undefined, from.rot, from.pos);
    mesh.rotationQuaternion = from.rot.clone();
    mesh.position.copyFrom(from.pos);
    this.held = { p, mesh, phase: "taking", since: room.now(), from, look: 0, turn: Quaternion.Identity() };
    this.lastDrop = null;
    this.publishHeld();
    this.sentAt = -1;
  }

  /** Put the plush in hand down: it drops onto the floor in front of you, at the nearest clear spot. */
  putDown(): boolean {
    const h = this.held;
    const walker = this.fly.walker;
    if (!h || !walker) return false;
    const k = this.info(h.p.kind);
    // where it is now (world): its centre and turn
    const wm = h.mesh.computeWorldMatrix(true);
    const q0 = new Quaternion();
    wm.decompose(undefined, q0, undefined);
    const c0 = Vector3.TransformCoordinates(k.rest, wm);
    const spot = this.spotFor();
    const fall = this.fall(h.p.kind, q0, Math.max(0.2, Math.min(1.5, c0.y - spot.y)));
    // the frames: the drop from the hand, drifting over to the spot as it falls
    const n = fall.length / 7;
    const top = fall[1];
    const lowest = fall[(n - 1) * 7 + 1];
    const frames = new Float32Array(fall.length);
    for (let i = 0; i < n; i++) {
      const o = i * 7;
      const u = Math.min(1, Math.max(0, (top - fall[o + 1]) / Math.max(0.01, top - lowest)));
      const e = u * (2 - u);
      frames[o] = c0.x + (spot.x - c0.x) * e + fall[o];
      frames[o + 1] = spot.y + fall[o + 1];
      frames[o + 2] = c0.z + (spot.z - c0.z) * e + fall[o + 2];
      for (let j = 3; j < 7; j++) frames[o + j] = fall[o + j];
    }
    const L = (n - 1) * 7;
    const now = room.now();
    const p: Plush = { ...h.p, by: null, name: ME.name, at: [frames[L], frames[L + 1], frames[L + 2]], q: [frames[L + 3], frames[L + 4], frames[L + 5], frames[L + 6]], t: now, from: undefined };
    const grow = h.mesh.scaling.x;
    h.mesh.dispose();
    this.held = null;
    this.turning = false;
    this.publishHeld();
    this.publishCarry(null);
    this.lastDrop = p;
    // shown falling here; the others see it come down from where they saw it carried
    const s = this.show(p);
    s.fall = { frames, since: now, grow };
    this.publish(this.list.map((x) => (x.id === p.id ? p : x)));
    return true;
  }

  /** A prize's fall onto a flat floor from `height` (m) above it, turned by q to begin with: com (off the spot) and turn per frame, 60 a second, until it lies still. */
  private fall(kind: PrizeKind, q: Quaternion, height: number): Float32Array {
    const S = this.spec;
    const w = new PrizeWorld(S);
    const cx = (S.bed[0] + S.bed[1]) / 2 + 0.08;
    const cz = (S.bed[2] + S.bed[3]) / 2 + 0.08;
    const b = w.add(kind, cx, S.bedY + height, cz, [q.x, q.y, q.z, q.w]);
    const out: number[] = [];
    for (let i = 0; i < 240; i++) {
      const o = b * 7;
      out.push(w.pose[o] - cx, w.pose[o + 1] - S.bedY, w.pose[o + 2] - cz, w.pose[o + 3], w.pose[o + 4], w.pose[o + 5], w.pose[o + 6]);
      if (w.isAsleep(b)) break;
      w.step(1 / 60);
    }
    return Float32Array.from(out);
  }

  /** What is known of a kind of prize (worked out once, on a flat floor of its own). */
  private info(kind: PrizeKind): KindInfo {
    let k = this.infos.get(kind);
    if (!k) {
      const S = this.spec;
      const w = new PrizeWorld(S);
      const cx = (S.bed[0] + S.bed[1]) / 2 + 0.08;
      const cz = (S.bed[2] + S.bed[3]) / 2 + 0.08;
      const b = w.add(kind, cx, S.bedY + 0.3, cz);
      w.settle(4);
      const o = b * 7;
      k = { rest: Vector3.FromArray(w.restCentre(b)), bound: w.boundOf(b), restQ: new Quaternion(w.pose[o + 3], w.pose[o + 4], w.pose[o + 5], w.pose[o + 6]), restH: w.pose[o + 1] - S.bedY };
      this.infos.set(kind, k);
    }
    return k;
  }

  /**
   * Where a plush put down lands: on the floor in front of the walker, or the nearest clear spot
   * to it on the same floor, reached without passing through a wall: under nothing (a machine's
   * top, a table), clear of walls and machines' sides. Failing all, at their feet.
   */
  private spotFor(): Vector3 {
    const walker = this.fly.walker!;
    const f = walker.feet;
    const dir = this.fly.camera.getDirection(Vector3.Forward());
    const yaw = Math.atan2(dir.x, dir.z);
    for (const d of [0.55, 0.45, 0.65, 0.35, 0.8, 0.25])
      for (const a of [0, 0.3, -0.3, 0.6, -0.6, 1.0, -1.0, 1.5, -1.5, 2.2, -2.2, Math.PI]) {
        const x = f.x + Math.sin(yaw + a) * d;
        const z = f.z + Math.cos(yaw + a) * d;
        const y = this.clearAt(f, x, z);
        if (y !== null) return new Vector3(x, y, z);
      }
    return f.clone();
  }

  /** The floor's height at (x, z) when a plush can lie there (see spotFor), else null. */
  private clearAt(f: Vector3, x: number, z: number): number | null {
    const w = this.fly.walker!.world;
    const p = emptyProbe();
    // the highest thing under the spot up to above head height must be the floor near the walker's own
    w.probe(x, z, f.y + 2.0, f.y - 0.5, p);
    if (p.walkY === -Infinity || Math.abs(p.walkY - f.y) > 0.25 || p.anyY > p.walkY + 0.02) return null;
    const y = p.walkY;
    // round it, the floor the same (no edge to fall off, nothing standing on it)
    for (const [dx, dz] of [[0.09, 0], [-0.09, 0], [0, 0.09], [0, -0.09]]) {
      const q = emptyProbe();
      w.probe(x + dx, z + dz, f.y + 2.0, f.y - 0.5, q);
      if (q.walkY === -Infinity || Math.abs(q.walkY - y) > 0.03 || q.anyY > q.walkY + 0.02) return null;
    }
    // nothing solid round it, nor between it and the walker (a plush isn't put down through a wall)
    const pad = 0.15;
    w.gather(Math.min(x, f.x) - pad, Math.max(x, f.x) + pad, y + 0.04, y + 0.5, Math.min(z, f.z) - pad, Math.max(z, f.z) + pad);
    const cp = new Float64Array(3);
    const steps = Math.ceil(Math.hypot(x - f.x, z - f.z) / 0.05);
    for (let i = 0; i <= steps; i++) {
      const u = steps ? i / steps : 1;
      const px = f.x + (x - f.x) * u;
      const pz = f.z + (z - f.z) * u;
      const r = i === steps ? 0.13 : 0.06;
      for (const py of [y + 0.12, y + 0.3]) {
        for (let t = 0; t < w.count; t++) {
          closestOnTriangle(px, py, pz, w.verts, t * 9, cp);
          if (Math.hypot(cp[0] - px, cp[1] - py, cp[2] - pz) < r) return null;
        }
      }
    }
    return y;
  }

  // ------------------------------------------------------------------ showing them

  /** The mesh for a plush on the floor or in someone else's hands, made if it isn't there yet. */
  private show(p: Plush): Shown {
    let s = this.shown.get(p.id);
    if (s && s.kind !== p.kind) {
      this.unshow(p.id);
      s = undefined;
    }
    if (!s) {
      const mesh = this.sources.get(p.kind)!.clone(`Plush: ${PRIZE_NAMES[p.kind]}`, null);
      mesh.setEnabled(true);
      const r = roomAt(Vector3.FromArray(p.at));
      const meta = r ? { room: r.id, roomName: r.name, level: r.level } : this.meta;
      mesh.metadata = { ...meta, labels: [{ face: 0, label: `Plush: ${PRIZE_NAMES[p.kind]}` }], matKey: this.material, kind: "moving" } satisfies MeshMeta;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      // drawn with the house (its meshes are all in group 1, over the sky's)
      mesh.renderingGroupId = 1;
      mesh.rotationQuaternion = Quaternion.FromArray(p.q);
      this.lighting.addMeshes([mesh], []);
      s = { mesh, kind: p.kind, tag: null, fall: null, at: Vector3.FromArray(p.at), q: Quaternion.FromArray(p.q) };
      this.shown.set(p.id, s);
      this.place(s);
    }
    return s;
  }

  private unshow(id: string): void {
    const s = this.shown.get(id);
    if (!s) return;
    s.tag?.dispose(false, true);
    s.mesh.dispose();
    this.shown.delete(id);
  }

  /** The meshes from the list: one for each plush on the floor or carried by someone else. */
  private syncShown(): void {
    const want = new Set<string>();
    for (const p of this.list) {
      if (p.by === VIEWER) continue;
      want.add(p.id);
      const s = this.show(p);
      if (p.by === null) {
        if (s.tag) {
          // put down by its carrier: it comes down from where it was seen in their hands
          s.tag.dispose(false, true);
          s.tag = null;
          if (!s.fall) s.fall = { frames: this.settleFrames(s, p), since: room.now() };
        }
      } else if (!s.tag) {
        s.fall = null;
        s.tag = this.nameTag(p.name);
      }
    }
    for (const id of [...this.shown.keys()]) if (!want.has(id)) this.unshow(id);
  }

  /** From where a plush is shown to where it lies (p), falling as a thing let go of does, 60 frames a second. */
  private settleFrames(s: Shown, p: Plush): Float32Array {
    const end = Vector3.FromArray(p.at);
    const endQ = Quaternion.FromArray(p.q);
    const drop = Math.max(0, s.at.y - end.y);
    const n = Math.max(2, Math.ceil(Math.sqrt((2 * drop) / 9.81) * 60) + 4);
    const out = new Float32Array(n * 7);
    const v = new Vector3();
    const q = new Quaternion();
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      Vector3.LerpToRef(s.at, end, u, v);
      v.y = s.at.y + (end.y - s.at.y) * u * u;
      Quaternion.SlerpToRef(s.q, endQ, Math.min(1, u * 1.3), q);
      out.set([v.x, v.y, v.z, q.x, q.y, q.z, q.w], i * 7);
    }
    return out;
  }

  /** A carrier's name, over the plush in their hands. */
  private nameTag(name: string): Mesh {
    const tex = new DynamicTexture("Plush carrier's name", { width: 512, height: 96 }, this.scene, true);
    tex.hasAlpha = true;
    const c = tex.getContext() as CanvasRenderingContext2D;
    c.clearRect(0, 0, 512, 96);
    c.font = "700 46px Montserrat, sans-serif";
    const w = Math.min(500, c.measureText(name).width + 44);
    c.fillStyle = "rgba(24, 12, 34, 0.78)";
    c.beginPath();
    c.roundRect((512 - w) / 2, 10, w, 76, 38);
    c.fill();
    c.fillStyle = "#ffffff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(name, 256, 50);
    tex.update(true);
    const mat = new StandardMaterial("Plush carrier's name", this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = Color3.White();
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    const tag = MeshBuilder.CreatePlane("Plush carrier's name", { width: 0.4, height: 0.075 }, this.scene);
    tag.material = mat;
    tag.billboardMode = Mesh.BILLBOARDMODE_ALL;
    tag.isPickable = false;
    tag.renderingGroupId = 1;
    tag.metadata = { ...this.meta, labels: [{ face: 0, label: `${name}'s plush` }], matKey: "", kind: "moving" } satisfies MeshMeta;
    return tag;
  }

  /** The world matrix of a plush's mesh with its centre at c, turned by q. */
  private layMatrix(kind: PrizeKind, c: Vector3, q: Quaternion): Matrix {
    const r = this.info(kind).rest;
    // mesh = T(-rest) · R · T(c), in Babylon's row-vector order
    const m = Matrix.Translation(-r.x, -r.y, -r.z).multiply(Matrix.FromQuaternionToRef(q, new Matrix())).multiply(Matrix.Translation(c.x, c.y, c.z));
    return m;
  }

  /** A shown plush's mesh where it is shown: its centre at s.at, turned by s.q. */
  private place(s: Shown): void {
    const r = this.info(s.kind).rest;
    s.mesh.rotationQuaternion!.copyFrom(s.q);
    r.rotateByQuaternionToRef(s.q, this.tmp.v).scaleInPlace(s.mesh.scaling.x);
    s.mesh.position.copyFrom(s.at).subtractInPlace(this.tmp.v);
    if (s.tag) s.tag.position.set(s.at.x, s.at.y + this.info(s.kind).bound + 0.1, s.at.z);
  }

  // ------------------------------------------------------------------ each frame

  /**
   * Each frame: the plush in hand where the hand holds it (and where it is, for the others), the
   * ones others carry following them, the ones put down falling and lying, and what E would pick
   * up: `door`, the machine's offer of the prize behind its pickup door, comes first.
   */
  update(dt: number, door: { label: string; sub: string } | null): void {
    this.clock += dt;
    const now = room.now();
    if (this.republish) this.mend();
    this.drawHeld(now, dt);
    const s = store.get();
    // whose hand is where
    if (this.held && this.clock - this.sentAt >= CARRY_EVERY) {
      this.sentAt = this.clock;
      const h = this.held;
      const c = Vector3.TransformCoordinates(this.info(h.p.kind).rest, h.mesh.computeWorldMatrix(true));
      const f = this.fly.walker?.feet ?? this.fly.camera.position;
      this.publishCarry({ by: VIEWER, id: h.p.id, at: [c.x, c.y, c.z], yaw: this.fly.camera.rotation.y, feet: [f.x, f.y, f.z] });
    }
    for (const p of this.list) {
      const sh = this.shown.get(p.id);
      if (!sh) continue;
      if (p.by && p.by !== VIEWER) {
        // in someone else's hands: following where their page says it is
        const c = this.carries.get(p.by);
        const at = c && c.id === p.id ? c.at : p.at;
        const k = 1 - Math.exp(-dt * 10);
        sh.at.x += (at[0] - sh.at.x) * k;
        sh.at.y += (at[1] - sh.at.y) * k;
        sh.at.z += (at[2] - sh.at.z) * k;
        Quaternion.RotationYawPitchRollToRef(c && c.id === p.id ? c.yaw : 0, 0, 0, this.tmp.q);
        Quaternion.SlerpToRef(sh.q, this.tmp.q, k, sh.q);
        this.place(sh);
      } else if (p.by === null && sh.fall) {
        const fr = sh.fall.frames;
        const n = fr.length / 7;
        const i = Math.min(n - 1, Math.floor(((now - sh.fall.since) / 1000) * 60));
        sh.at.set(fr[i * 7], fr[i * 7 + 1], fr[i * 7 + 2]);
        sh.q.set(fr[i * 7 + 3], fr[i * 7 + 4], fr[i * 7 + 5], fr[i * 7 + 6]);
        sh.mesh.scaling.setAll(sh.fall.grow === undefined ? 1 : sh.fall.grow + (1 - sh.fall.grow) * Math.min(1, i / 12));
        if (i === n - 1) {
          sh.fall = null;
          sh.mesh.scaling.setAll(1);
          sh.at.fromArray(p.at);
          sh.q.set(p.q[0], p.q[1], p.q[2], p.q[3]);
        }
        this.place(sh);
      }
    }

    // what E picks up: the machine's prize, else the plush on the floor looked at
    this.target = null;
    let prompt: { label: string; sub: string } | null = null;
    if (s.walking && !s.focus && this.fly.enabled) {
      if (door) prompt = this.held ? { label: "Your hands are full", sub: "put the plush you have down first (Q)" } : door;
      else {
        const eye = this.fly.camera.position;
        const dir = this.fly.camera.getDirection(Vector3.Forward());
        let best = Infinity;
        for (const p of this.list) {
          if (p.by !== null) continue;
          const v = Vector3.FromArray(p.at).subtractInPlace(eye);
          const along = Vector3.Dot(v, dir);
          if (along < 0.15 || along > REACH) continue;
          const off = v.subtractInPlace(dir.scale(along)).length();
          if (off < AIM + this.info(p.kind).bound * 0.5 && off / along < best) {
            best = off / along;
            this.target = p.id;
          }
        }
        const t = this.target ? this.list.find((p) => p.id === this.target)! : null;
        if (t) prompt = this.held ? { label: "Your hands are full", sub: "put the plush you have down first (Q)" } : { label: `Pick up the ${PRIZE_NAMES[t.kind]}`, sub: t.name === ME.name ? "where you put it down" : `put down by ${t.name}` };
      }
    }
    const was = s.plushPrompt;
    if (was?.label !== prompt?.label || was?.sub !== prompt?.sub) store.set({ plushPrompt: prompt });
  }

  /** The plush in hand: coming up out of the door or off the floor, held, or held up to look at. */
  private drawHeld(now: number, dt: number): void {
    const h = this.held;
    if (!h) return;
    const m = h.mesh;
    // hidden while a screen is in use: it would sit in front of the game, the film or the machine's view
    m.setEnabled(!store.get().focus);
    const k = this.info(h.p.kind);
    const ease = (x: number) => x * x * (3 - 2 * x);
    h.look += ((this.turning ? 1 : 0) - h.look) * (1 - Math.exp(-dt * 9));
    // where the hand holds its centre now, and how, and how big
    const pos = this.tmp.v;
    Vector3.LerpToRef(HAND.pos, LOOK.pos, ease(h.look), pos);
    const scale = (HAND.size + (LOOK.size - HAND.size) * ease(h.look)) / k.bound;
    const rot = Quaternion.Slerp(HAND.rot, LOOK.rot, ease(h.look));
    h.turn.multiplyToRef(rot, rot);
    let sc = scale;
    if (h.phase === "taking") {
      const u = ease(Math.min(1, (now - h.since) / TAKE_MS));
      // an arc up out of where it lay, shrinking from life size into the hand
      const at = Vector3.Lerp(h.from.pos.add(k.rest.rotateByQuaternionToRef(h.from.rot, new Vector3())), pos, u);
      at.y += Math.sin(u * Math.PI) * 0.06;
      pos.copyFrom(at);
      Quaternion.SlerpToRef(h.from.rot, rot, u, rot);
      sc = 1 + (scale - 1) * u;
      if (u >= 1) h.phase = "held";
    } else pos.y += Math.sin(now / 600) * 0.003;
    m.rotationQuaternion!.copyFrom(rot);
    m.scaling.setAll(sc);
    // its centre at pos: the mesh's origin is the rest frame's, `rest` off its centre
    m.position.copyFrom(pos).subtractInPlace(k.rest.rotateByQuaternionToRef(rot, new Vector3()).scaleInPlace(sc));
  }

  private publishHeld(): void {
    const next = this.held ? { name: PRIZE_NAMES[this.held.p.kind], turning: this.turning } : null;
    const was = store.get().plushHeld;
    if (was?.name !== next?.name || was?.turning !== next?.turning) store.set({ plushHeld: next });
  }

  // ------------------------------------------------------------------ for the page's checks

  /** Every plush out of the machine, as the room has it and as it is shown here. */
  describe() {
    const h = this.held;
    return {
      list: this.list.map((p) => {
        const s = this.shown.get(p.id);
        return { ...p, shown: s ? { at: s.at.asArray(), enabled: s.mesh.isEnabled(), tag: !!s.tag, falling: !!s.fall } : null };
      }),
      held: h
        ? {
            id: h.p.id,
            kind: h.p.kind,
            phase: h.phase,
            look: h.look,
            turn: h.turn.asArray(),
            // in the camera's frame, and where it shows on the page (0..1 across and down)
            local: h.mesh.position.asArray(),
            world: Vector3.TransformCoordinates(this.info(h.p.kind).rest, h.mesh.computeWorldMatrix(true)).asArray(),
            enabled: h.mesh.isEnabled(),
          }
        : null,
      turning: this.turning,
      target: this.target,
      carries: [...this.carries.values()],
    };
  }

  /** For tests: n plushes put down in a row from (x, y, z) on the floor, a second apart in time as if one after another; their ids. */
  scatter(n: number, x: number, y: number, z: number): string[] {
    const k = this.info("chimp");
    const now = room.now();
    const add: Plush[] = [];
    for (let i = 0; i < n; i++) add.push({ id: `${VIEWER}:${this.next++}`, kind: "chimp", by: null, name: ME.name, at: [x + (i % 5) * 0.3, y + k.restH, z + Math.floor(i / 5) * 0.3], q: [k.restQ.x, k.restQ.y, k.restQ.z, k.restQ.w], t: now - (n - i) * 1000 });
    this.publish([...this.list, ...add]);
    return add.map((p) => p.id);
  }

  /** Put every plush away (tests): the room's list emptied, none in hand. */
  clear(): void {
    this.held?.mesh.dispose();
    this.held = null;
    this.turning = false;
    this.lastDrop = null;
    this.publishHeld();
    this.publishCarry(null);
    this.publishList({ list: [] });
  }
}

/** The list with at most MAX_FLOOR plushes on the floor: past that, the ones put down longest ago go. */
function capFloor(list: Plush[]): Plush[] {
  const floor = list.filter((p) => p.by === null).sort((a, b) => b.t - a.t);
  if (floor.length <= MAX_FLOOR) return list;
  const keep = new Set(floor.slice(0, MAX_FLOOR).map((p) => p.id));
  return list.filter((p) => p.by !== null || keep.has(p.id));
}

