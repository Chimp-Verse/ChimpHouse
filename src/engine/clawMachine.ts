// The Chimp Claw in the Game Room: walking up to it, playing it, and showing it.
//
// The machine and its moving parts are found by role (world/roles.ts): the root
// node (a slot) carries the inside's measurements (ClawSpec) and the stand point
// at the deck, so this works the same for a machine built in code or loaded from
// Blender. The prizes are bodies in engine/clawPhysics.ts, drawn as thin
// instances (one mesh per kind) in the root; a play's rules are engine/clawRules.ts.
//
// Walking up to the deck and looking at the machine offers it (store.clawPrompt);
// E plays: the camera glides to a player's view into the glass box (engine/focus.ts),
// the keys steer the claw (WASD or the arrows), Space or Enter drops it and plays
// again afterwards, and Esc or Leave walks away. V (or 1–4) changes the view: the
// panel, a close look in from the front, either side; the keys steer the way the
// view looks. A prize won drops down the chute and comes to rest behind the pickup
// door, which swings open; it waits there until someone looks at the door and picks
// it up with E (engine/clawPlush.ts carries it from there), and the attendant puts
// another in the machine a little later. A bin with more than BIN_KEEP waiting has
// its oldest set out on the floor in front of the door.
//
// Nothing runs per frame unless the pile is moving, the claw is, or someone is playing.

import { DynamicTexture, Matrix, Mesh, PBRMaterial, Quaternion, Ray, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { MeshMeta, SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { ClawSpec, PRIZE_NAMES, PrizeKind, plushMat, prizeGeo } from "../world/props/clawMachine";
import { ROLE, find } from "../world/roles";
import { CHUTE_DOWN, PrizeWorld, restock, seeded, stockPile } from "./clawPhysics";
import { Plush, PlushCarry } from "./clawPlush";
import { ClawGame, ClawInput, ClawPose, PRONG_OPEN, PRONG_SHUT, bestChimp, simulatePlays, steerTo } from "./clawRules";
import { FlyCamera, Pose } from "./flyCamera";
import { ScreenFocus } from "./focus";
import { ClawSound } from "./clawSound";
import { Lighting } from "./lighting";
import { ME, room } from "./room";
import { ClawHud, VIEWER, store } from "./store";

/** How near (m) the walker must stand to the deck's stand point, looking at the machine, to be offered it. */
const REACH = 1.3;
const GLIDE_IN = 0.9;
const GLIDE_OUT = 0.7;
/** seconds until a taken prize is put back in the machine */
const RESTOCK_AFTER = 4;
/** the longest the pile a play leaves waits to come to rest before it's everyone's, and the machine free (s) */
const PILE_WAIT = 3;
/** how often (s) a player's page tells the others where the claw is, and how far behind (s) a watcher shows it, to have a sample either side */
const MOTION_EVERY = 1 / 16;
/** what the player's view must hold (machine-local): the joystick and drop button with their labels, the bed's corners, the gantry's travel at the top */
const FRAME: [number, number, number][] = [
  [0.15, 0.94, -0.48], [-0.17, 1.04, -0.48], [-0.17, 0.9, -0.575], [0.15, 0.9, -0.575],
  [-0.41, 0.94, -0.41], [0.41, 0.94, -0.41], [-0.41, 0.94, 0.41], [0.41, 0.94, 0.41],
  [-0.3, 1.71, -0.29], [0.31, 1.71, 0.3], [-0.3, 1.71, 0.3], [0.31, 1.71, -0.29],
];
const WATCH_BEHIND = 0.12;
/** the most prizes that wait behind the pickup door: one more, and the oldest is set out on the floor in front of it */
const BIN_KEEP = 3;
/** how far from the eye (m) the pickup door can be looked at to pick a prize up, and how near the line of sight must pass its middle (rad) */
const DOOR_REACH = 2.0;
const DOOR_AIM = 0.36;
/** changing view while playing (s) */
const GLIDE_VIEW = 0.6;

/** The views of the machine while playing it: V steps through them, 1–4 picks one. */
export const CLAW_VIEWS = [
  { id: "panel", name: "Panel", short: "Panel" },
  { id: "close", name: "Close up", short: "Close" },
  { id: "left", name: "Left side", short: "Left" },
  { id: "right", name: "Right side", short: "Right" },
] as const;
export type ClawView = (typeof CLAW_VIEWS)[number]["id"];
/** what the close and side views must hold (machine-local): the bed's corners and the gantry's travel at the top */
const BOX = FRAME.slice(4);
/** the close view holds the credit display too, at the back of the deck, clear of the HUD's bar */
const CLOSE: [number, number, number][] = [...BOX, [-0.09, 0.925, -0.48], [0.07, 0.925, -0.48], [-0.09, 0.97, -0.44], [0.07, 0.97, -0.44]];

/** Who is playing the machine: one visitor at a time. */
interface ClawUse {
  by: string | null;
  name: string;
}

/** The claw while someone plays, from their page: the pose and the prizes that are moving, at the room's time t. */
interface ClawMotion {
  by: string;
  t: number;
  pose: ClawPose;
  /** each moving prize: its index, then com xyz and quaternion xyzw */
  bodies: number[];
  /** the HUD's state machine phase, for the display */
  phase: string;
  timer: number;
}

/** The pile as it lies between plays: every prize's pose (7 numbers each) and those out of play, from the page that last played. */
interface ClawPile {
  poses: number[];
  gone: number[];
}

export class ClawMachine {
  readonly root: TransformNode;
  readonly spec: ClawSpec;
  readonly world: PrizeWorld;
  readonly pose: ClawPose;
  private parts: {
    gantry: Mesh;
    trolley: Mesh;
    cable: Mesh;
    cord: Mesh;
    head: Mesh;
    prongs: Mesh;
    joystick: TransformNode;
    button: Mesh;
    display: Mesh;
    door: TransformNode;
  };
  private prizeMeshes = new Map<PrizeKind, { mesh: Mesh; bodies: number[]; buf: Float32Array }>();
  private prongBuf = new Float32Array(16 * 3);
  private displayTex: DynamicTexture | null;
  private displayText = "";
  private rnd = seeded(7);
  private m = new Matrix();
  private m2 = new Matrix();
  private q = new Quaternion();
  private v = new Vector3();
  private one = new Vector3(1, 1, 1);
  private dirty = true;
  readonly game: ClawGame;
  /** the keys held while playing */
  private keys = new Set<string>();
  private dropHeld = false;
  private dropTapped = false;
  /** prizes taken, and when each goes back in */
  private restocks: { b: number; at: number }[] = [];
  private clock = 0;
  private fovBefore = 1;
  /** shared: who plays, the claw's motion while they do, the pile between plays */
  private holder: ClawUse = { by: null, name: "" };
  private publishUse: (u: ClawUse) => void;
  private publishMotion: (m: ClawMotion) => void;
  private publishPile: (p: ClawPile) => void;
  private motions: ClawMotion[] = [];
  private sentAt = 0;
  /** this page owes the room the pile once it settles (after a play or a restock) */
  private pileOwed = false;
  /** when this page's play (or a restock) last went on (clock s) */
  private busyAt = 0;
  /** won plushes out of the machine: carried, put down, picked up again */
  readonly plush: PlushCarry;
  /** the prizes waiting behind the pickup door, oldest first */
  private binOrder: number[] = [];
  /** prizes taken from the pickup door here, and where they lay: a pile sent before the taking reached its sender keeps them out */
  private taken = new Map<number, number[]>();
  /** what E would pick up at the pickup door, if anything */
  private doorOffer: { label: string; sub: string } | null = null;
  /** the view of the machine while playing it */
  view: ClawView = "panel";

  constructor(
    private scene: Scene,
    mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    private focus: ScreenFocus,
    /** shows a short message */
    flash: (msg: string) => void = () => undefined,
  ) {
    const need = <T>(n: T | null, what: string): T => {
      if (!n) throw new Error(`The claw machine has no ${what}`);
      return n;
    };
    this.root = need(find(scene, ROLE.clawMachine) as TransformNode | null, "root");
    this.spec = (this.root.metadata as { claw: ClawSpec }).claw;
    const mesh = (role: string) => need(this.root.getChildMeshes(false).find((m) => (m.metadata as MeshMeta | undefined)?.role === role) as Mesh | undefined, role) as Mesh;
    const nodeOf = (role: string) => need(this.root.getChildTransformNodes(false).find((n) => (n.metadata as { role?: string } | undefined)?.role === role) ?? null, role);
    this.parts = {
      gantry: mesh(ROLE.clawGantry),
      trolley: mesh(ROLE.clawTrolley),
      cable: mesh(ROLE.clawCable),
      cord: mesh(ROLE.clawCord),
      head: mesh(ROLE.clawHead),
      prongs: mesh(ROLE.clawProng),
      joystick: nodeOf(ROLE.clawJoystick),
      button: mesh(ROLE.clawButton),
      display: mesh(ROLE.clawDisplay),
      door: nodeOf(ROLE.clawDoor),
    };
    const dm = this.parts.display.material as PBRMaterial | null;
    this.displayTex = (dm?.emissiveTexture as DynamicTexture | null) ?? null;
    this.parts.prongs.thinInstanceSetBuffer("matrix", this.prongBuf, 16, false);
    this.parts.prongs.alwaysSelectAsActiveMesh = true;
    const S = this.spec;
    this.pose = { x: S.home[0], z: S.home[1], cable: S.cableUp, swingX: 0, swingZ: 0, open: [0.45, 0.45, 0.45], joyX: 0, joyZ: 0, button: 0, door: 0 };

    // the prizes: stocked by dropping them in, and settled into a pile before anyone looks
    this.world = new PrizeWorld(S);
    stockPile(this.world, this.rnd);
    const plush = mats.get(plushMat({ mats }));
    const sm = this.root.metadata as { room: string; roomName: string; level: MeshMeta["level"] };
    for (let b = 0; b < this.world.count; b++) {
      const kind = this.world.kinds[b];
      let e = this.prizeMeshes.get(kind);
      if (!e) {
        const pm = prizeGeo(kind).build(`Claw prize: ${PRIZE_NAMES[kind]}`, scene);
        pm.material = plush;
        pm.parent = this.root;
        pm.metadata = { room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label: `Claw machine prize: ${PRIZE_NAMES[kind]}` }], matKey: plush.name, kind: "moving" } satisfies MeshMeta;
        pm.receiveShadows = true;
        pm.renderingGroupId = 1;
        // the prizes move about inside the machine, so never cull them by a stale box
        pm.alwaysSelectAsActiveMesh = true;
        e = { mesh: pm, bodies: [], buf: new Float32Array(0) };
        this.prizeMeshes.set(kind, e);
      }
      e.bodies.push(b);
    }
    for (const e of this.prizeMeshes.values()) {
      e.buf = new Float32Array(e.bodies.length * 16);
      e.mesh.thinInstanceSetBuffer("matrix", e.buf, 16, false);
    }
    lighting.addMeshes([...[...this.prizeMeshes.values()].map((e) => e.mesh)], []);
    this.syncPrizes();
    this.syncClaw();
    this.paintDisplay("PLAY");
    this.game = new ClawGame(this.world, S, this.pose);

    // shared with the other visitors: one player at a time, whose page runs the play and tells the rest
    this.publishUse = room.share<ClawUse>("claw/use", this.holder, (u) => {
      this.holder = u;
      if (u.by !== VIEWER) this.motions.length = 0;
    });
    this.publishMotion = room.share<ClawMotion | null>("claw/motion", null, (m) => {
      if (!m || m.by === VIEWER) return;
      this.motions.push(m);
      if (this.motions.length > 6) this.motions.shift();
    }) as (m: ClawMotion) => void;
    this.publishPile = room.share<ClawPile | null>("claw/pile", null, (p) => {
      if (p && this.holder.by !== VIEWER) this.applyPile(p);
    }) as (p: ClawPile) => void;
    room.onGone((id) => {
      if (this.holder.by === id) this.publishUse({ by: null, name: "" });
    });
    this.plush = new PlushCarry(scene, mats, lighting, fly, S, sm, (p) => this.takenOut(p), flash);

    // the controls, only while this machine is being played
    const playing = () => store.get().focus?.kind === "claw" && store.get().focus?.phase === "on";
    window.addEventListener("keydown", (e) => {
      if (store.get().focus?.kind !== "claw") return;
      if (e.code === "Escape") {
        e.preventDefault();
        void this.leave();
        return;
      }
      this.sound.unlock();
      if (!playing()) return;
      if (CONTROL_KEYS.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if ((e.code === "Space" || e.code === "Enter") && !e.repeat) this.pressDrop();
      const n = CLAW_VIEWS.findIndex((v) => v.id === this.view);
      if (e.code === "KeyV" && !e.repeat) this.setView(CLAW_VIEWS[(n + (e.shiftKey ? CLAW_VIEWS.length - 1 : 1)) % CLAW_VIEWS.length].id);
      const digit = /^Digit([1-4])$/.exec(e.code);
      if (digit && !e.repeat) this.setView(CLAW_VIEWS[Number(digit[1]) - 1].id);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "Space" || e.code === "Enter") this.dropHeld = false;
    });
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.dropHeld = false;
    });
  }

  /** The drop button: drops the claw while steering, or starts the next play once one is over. */
  pressDrop(): void {
    this.dropHeld = true;
    // a tap shorter than a frame still counts
    this.dropTapped = true;
    const g = this.game;
    if (g.phase === "idle" || g.phase === "over") this.play();
  }

  /** Let go of the drop button (the HUD's button, a test). */
  releaseDrop(): void {
    this.dropHeld = false;
  }

  /** A new play (a prize behind the pickup door waits there to be picked up). */
  play(): boolean {
    if (this.game.busy) return false;
    this.aimStill = 0;
    const ok = this.game.start();
    // the press that started it isn't also the drop
    this.dropHeld = false;
    this.dropTapped = false;
    this.publishHud();
    return ok;
  }

  /** The joystick and drop button as the keys hold them. */
  private input(out: ClawInput): ClawInput {
    const k = this.keys;
    // the keys steer the way the view looks: up the screen is away from the eye, right is its right
    const sx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const sz = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const [fx, fz] = this.viewAxis();
    out.x = sz * fx + sx * fz;
    out.z = sz * fz - sx * fx;
    out.drop = this.dropHeld || this.dropTapped;
    this.dropTapped = false;
    if (this.aim && this.game.phase === "aim") {
      const drop = out.drop;
      steerTo(this.pose, this.aim[0], this.aim[1], out);
      out.drop = drop;
      return out;
    }
    if (this.override) {
      out.x = this.override.x;
      out.z = this.override.z;
      out.drop = this.override.drop || out.drop;
    }
    return out;
  }
  private inp: ClawInput = { x: 0, z: 0, drop: false };
  /** for tests: the joystick and button held as given, instead of the keys (null gives the keys back) */
  override: ClawInput | null = null;
  /** for tests: steer by itself onto this spot (machine frame) while aiming; `aimed` once it is still over it */
  aim: [number, number] | null = null;
  private aimStill = 0;
  private sound = new ClawSound();
  private lastCable = 0;
  get aimed(): boolean {
    return !!this.aim && this.game.phase === "aim" && this.aimStill > 0.5;
  }

  /** for tests: aim at the highest chimp in the pile */
  aimAtBest(): number {
    const b = bestChimp(this.world, this.spec.travel);
    this.aim = [this.world.pose[b * 7], this.world.pose[b * 7 + 2]];
    this.aimStill = 0;
    return b;
  }

  /** for tests: n prizes dropped in on top of one another in the middle of the bed, deep in each other and in the pile there */
  jumble(n: number): number[] {
    const w = this.world;
    const S = this.spec;
    const rnd = seeded(11);
    const cx = (S.bed[0] + S.bed[1]) / 2 + 0.06;
    const cz = (S.bed[2] + S.bed[3]) / 2 + 0.04;
    const out: number[] = [];
    for (let b = 0; b < w.count && out.length < n; b++) {
      if (w.isGone(b) || b === w.held) continue;
      w.place(b, cx + (rnd() - 0.5) * 0.06, S.bedY + 0.08 + rnd() * 0.06, cz + (rnd() - 0.5) * 0.06, [0, rnd(), 0, 1]);
      out.push(b);
    }
    this.syncPrizes();
    this.dirty = true;
    return out;
  }

  /** for tests: the furthest any prize pokes out through the glass (m), where the glass is (from just under the bed up) */
  glassOut(): number {
    const w = this.world;
    const [x0, x1, z0, z1] = this.spec.bed;
    const s: number[] = [];
    let out = 0;
    for (let b = 0; b < w.count; b++) {
      if (w.isGone(b)) continue;
      w.spheres(b, s);
      for (let i = 0; i < s.length; i += 4) {
        const [x, y, z, r] = [s[i], s[i + 1], s[i + 2], s[i + 3]];
        // the glass stands from just under the bed up; below it, down the chute's shaft, a prize is inside the
        // cabinet, behind its panels, out of sight
        if (y < this.spec.bedY - 0.04) continue;
        out = Math.max(out, x0 - (x - r), x + r - x1, z + r - z1, z0 - (z - r));
      }
    }
    return out;
  }

  /**
   * for tests: a prize of this kind (one still in the bed) let go over the chute as the claw lets go
   * of what it carried: (dx, dz) off the claw's home over the chute, turned by q, hanging below the
   * claw and kept inside the glass and over the guard. Its index, or -1.
   */
  chuteDrop(kind: PrizeKind, dx: number, dz: number, q: [number, number, number, number]): number {
    const w = this.world;
    const S = this.spec;
    const binned = new Set(this.game.inBin());
    const b = w.kinds.findIndex((k, i) => k === kind && !w.isGone(i) && !binned.has(i) && i !== w.held && !w.overChute(i) && w.pose[i * 7 + 1] > S.bedY);
    if (b < 0) return -1;
    w.placeClear(b, S.home[0] + dx, S.bedY + 0.42 - w.boundOf(b), S.home[1] + dz, q);
    // as if just let go by the claw: it drops out of the prongs
    w.hold(b);
    w.hold(-1);
    this.syncPrizes();
    this.dirty = true;
    return b;
  }

  /** The machine as it opens: every prize back in a freshly stocked pile, the claw home, nobody playing, for everyone (tests start from it). */
  reset(): void {
    if (store.get().focus?.kind === "claw") return;
    const w = this.world;
    const S = this.spec;
    w.hold(-1);
    stockPile(w, seeded(7), true);
    this.restocks.length = 0;
    this.binOrder.length = 0;
    this.taken.clear();
    this.game.reset();
    Object.assign(this.pose, { x: S.home[0], z: S.home[1], cable: S.cableUp, swingX: 0, swingZ: 0, open: [0.45, 0.45, 0.45], joyX: 0, joyZ: 0, button: 0, door: 0 });
    this.syncPrizes();
    this.dirty = true;
    this.publishPile(this.pileNow());
    this.publishUse({ by: null, name: "" });
  }

  /** Plays simulated on fresh copies of this machine's stock (clawRules.ts simulatePlays). */
  simulate(n: number, strategy: "aim" | "random", strength: number | null) {
    return simulatePlays(this.spec, (w, rnd) => stockPile(w, rnd), n, strategy, strength);
  }

  /** Walk mode, at the deck: play. Resolves once the camera is at the player's view. */
  async use(): Promise<boolean> {
    const s = store.get();
    if (s.focus || !this.fly.walker || !s.walking || this.inUseByOther) return false;
    this.publishUse({ by: VIEWER, name: ME.name });
    this.fovBefore = this.fly.camera.fov;
    store.set({ clawPrompt: false });
    this.sound.unlock();
    this.view = "panel";
    const ok = await this.focus.enter({ kind: "claw" }, this.parts.display, () => this.playPose(), GLIDE_IN);
    // the other views worked out now, while the camera stands still, so changing to one never waits on it
    if (ok) for (const v of CLAW_VIEWS) this.playPose(v.id);
    if (ok && !this.game.busy) this.play();
    return ok;
  }

  /** Someone else is playing the machine. */
  get inUseByOther(): boolean {
    return this.holder.by !== null && this.holder.by !== VIEWER;
  }

  /** Who is playing, if someone else is. */
  get playerName(): string | null {
    return this.inUseByOther ? this.holder.name : null;
  }

  /** The pile, as everyone else is to see it. */
  private pileNow(): ClawPile {
    const w = this.world;
    const gone: number[] = [];
    for (let b = 0; b < w.count; b++) if (w.isGone(b)) gone.push(b);
    return { poses: Array.from(w.pose, (v) => Math.round(v * 1e5) / 1e5), gone };
  }

  /** Another visitor's pile: every prize where they left it, at rest. */
  private applyPile(p: ClawPile) {
    const w = this.world;
    if (p.poses.length !== w.count * 7) return;
    for (let b = 0; b < w.count; b++) {
      const was = this.taken.get(b);
      // taken from the pickup door here, and the sender didn't know yet: still out
      if (was && Math.hypot(p.poses[b * 7] - was[0], p.poses[b * 7 + 1] - was[1], p.poses[b * 7 + 2] - was[2]) < 0.02) w.remove(b);
      else if (p.gone.includes(b)) w.remove(b);
      else {
        this.taken.delete(b);
        w.setPose(b, p.poses, b * 7, true);
      }
    }
    // the prizes this page is to put back that are still out in theirs
    this.restocks = this.restocks.filter((r) => w.isGone(r.b));
    this.syncPrizes();
    this.dirty = true;
  }

  /** Stop playing: back to the stand point, walking. A play under way finishes by itself. */
  async leave(): Promise<void> {
    const f = store.get().focus;
    if (f?.kind !== "claw" || f.phase === "out") return;
    this.keys.clear();
    this.dropHeld = false;
    this.override = null;
    const wm = this.root.computeWorldMatrix(true);
    const stand = Vector3.TransformCoordinates(Vector3.FromArray((this.root.metadata as SlotMeta).stand), wm);
    const look = Vector3.TransformCoordinates(new Vector3(0, 1.2, 0), wm);
    const walker = this.fly.walker;
    let pose: Pose | null = null;
    if (walker && walker.place(stand.x, stand.y + 0.5, stand.z, 2)) {
      const ft = walker.feet;
      const dx = look.x - ft.x;
      const dz = look.z - ft.z;
      pose = { x: ft.x, y: walker.eyeY, z: ft.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(look.y - walker.eyeY, Math.hypot(dx, dz)), fov: this.fovBefore };
    }
    await this.focus.leave(pose, GLIDE_OUT);
    this.aim = null;
    this.publishHud();
  }

  /** The view this play is seen from: glides there (V, 1–4 or the HUD's buttons). */
  setView(v: ClawView): void {
    const f = store.get().focus;
    if (f?.kind !== "claw" || f.phase !== "on" || v === this.view) return;
    this.view = v;
    this.publishHud();
    void this.fly.glide(this.playPose(), GLIDE_VIEW);
  }

  /**
   * Where the player's eye is for the view chosen:
   * - panel: standing at the deck, looking down past the joystick and drop button into the glass
   *   box, with the whole bed, the chute and the claw at the top in view;
   * - close up: nearer and lower, looking in through the front glass at the bed and the claw;
   * - the sides: round to the machine's left or right, looking in through its side glass; as far
   *   round as the room allows (the line from the eye to the machine clear of what stands beside it).
   * Each is backed off along its line until its key points fit the frame, clear of the HUD's bars,
   * the fov widening on a narrow window.
   */
  playPose(view: ClawView = this.view): Pose {
    const engine = this.scene.getEngine();
    // each view's pose is worked out once per window size (the machine and the room round it stand still)
    const key = `${view} ${engine.getRenderWidth()}x${engine.getRenderHeight()}x${engine.getHardwareScalingLevel()}`;
    const known = this.poses.get(key);
    if (known) return { ...known };
    const pose = this.viewPose(view);
    this.poses.set(key, pose);
    return { ...pose };
  }
  private poses = new Map<string, Pose>();

  private viewPose(v: ClawView): Pose {
    const engine = this.scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const wm = this.root.computeWorldMatrix(true);
    let fov = Math.min(1.45, Math.max(1.0, 2 * Math.atan(Math.tan(0.5) * (0.85 / aspect))));
    let C: Vector3;
    let eye: Vector3;
    if (v === "panel") {
      C = new Vector3(0, 1.28, -0.12);
      // low enough to see the claw at the top under the glass header
      eye = this.fit(C, 0, 0.38, FRAME, fov, aspect, 0.94);
    } else if (v === "close") {
      fov = Math.min(1.3, Math.max(0.86, 2 * Math.atan(Math.tan(0.43) * (1.1 / aspect))));
      C = new Vector3(0, 1.3, 0.02);
      eye = this.fit(C, 0, 0.42, CLOSE, fov, aspect, 0.98);
    } else {
      C = new Vector3(0, 1.3, 0);
      // wider, so the eye can be nearer and get further round between the machine and what stands beside it
      fov = Math.min(1.4, Math.max(1.2, fov));
      const side = v === "left" ? -1 : 1;
      // from straight off the side round toward the front, until the eye sees the machine clear of what stands
      // beside it (from higher up, looking down over it, if that gets further round)
      eye = this.fit(C, side * 0.5, 0.4, BOX, fov, aspect, 0.98);
      search: for (let a = Math.PI / 2; a > 0.5; a -= 0.087)
        for (const pitch of [0.4, 0.6, 0.8]) {
          const e = this.fit(C, side * a, pitch, BOX, fov, aspect, 0.98);
          if (this.clearSight(C, e, wm)) {
            eye = e;
            break search;
          }
        }
    }
    const w = Vector3.TransformCoordinates(eye, wm);
    const at = Vector3.TransformCoordinates(C, wm);
    const dx = at.x - w.x;
    const dz = at.z - w.z;
    return { x: w.x, y: w.y, z: w.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(at.y - w.y, Math.hypot(dx, dz)), fov };
  }

  /**
   * The eye (machine frame) looking at C from `yaw` round from the front (+ toward the machine's
   * right) and `pitch` above, as near as it can be with every point of `pts` in the frame: clear
   * of the HUD's bars top and bottom (about 70 px each) and `side` of the half-width across.
   */
  private fit(C: Vector3, yaw: number, pitch: number, pts: number[][], fov: number, aspect: number, side: number): Vector3 {
    const engine = this.scene.getEngine();
    const t = Math.tan(fov / 2);
    const bar = 140 / Math.max(300, engine.getRenderHeight() * engine.getHardwareScalingLevel());
    const lo = -t * (1 - bar);
    const hi = t * (1 - bar);
    const back = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const fwd = back.negate();
    const right = Vector3.Cross(Vector3.Up(), fwd).normalize();
    const up = Vector3.Cross(fwd, right);
    const fits = (d: number) => {
      const e = C.add(back.scale(d));
      return pts.every(([x, y, z]) => {
        const q = new Vector3(x - e.x, y - e.y, z - e.z);
        const depth = Vector3.Dot(q, fwd);
        const v = Vector3.Dot(q, up) / depth;
        return depth > 0 && v > lo && v < hi && Math.abs(Vector3.Dot(q, right) / depth) < t * aspect * side;
      });
    };
    // the nearest that fits, to a centimetre: further back only ever fits better, so halve the gap
    let near = 0.5;
    let far = 3.2;
    if (fits(near)) return C.add(back.scale(near));
    if (!fits(far)) return C.add(back.scale(1.6));
    while (far - near > 0.01) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    return C.add(back.scale(far));
  }

  /**
   * Whether the eye (machine frame) sees the machine with nothing else in the way: clear lines to
   * C and the view's key points, and room round the eye (lines from C to points a little off it
   * every way), so nothing beside the machine stands right by the eye either. The glass box's own
   * glass and corner posts (merged into the room's meshes, so known by where they are) are looked
   * through; its header, marquee and deck are in the way like anything else.
   */
  private clearSight(C: Vector3, eye: Vector3, wm: Matrix): boolean {
    const { tris, box } = this.occluders(wm);
    const inv = wm.clone().invert();
    const S = this.spec;
    const ours = (x: number, y: number, z: number) => {
      const l = Vector3.TransformCoordinatesFromFloatsToRef(x, y, z, inv, this.v);
      return l.x > S.bed[0] - 0.07 && l.x < S.bed[1] + 0.07 && l.z > S.bed[2] - 0.07 && l.z < S.bed[3] + 0.08 && l.y > S.bedY - 0.1 && l.y < S.bridgeY + 0.09;
    };
    // whether the segment a→b (and `past` beyond b) crosses no triangle but the glass box's own (Möller–Trumbore)
    const free = (a: Vector3, b: Vector3, past = 0) => {
      const d = b.subtract(a);
      const len = d.length();
      d.scaleInPlace(1 / len);
      const reach = len + past;
      const [x0, x1] = [Math.min(a.x, a.x + d.x * reach), Math.max(a.x, a.x + d.x * reach)];
      const [y0, y1] = [Math.min(a.y, a.y + d.y * reach), Math.max(a.y, a.y + d.y * reach)];
      const [z0, z1] = [Math.min(a.z, a.z + d.z * reach), Math.max(a.z, a.z + d.z * reach)];
      for (let o = 0, k = 0; o < tris.length; o += 9, k += 6) {
        // its box clear of the segment's: not in the way
        if (box[k + 1] < x0 || box[k] > x1 || box[k + 3] < y0 || box[k + 2] > y1 || box[k + 5] < z0 || box[k + 4] > z1) continue;
        const e1x = tris[o + 3] - tris[o], e1y = tris[o + 4] - tris[o + 1], e1z = tris[o + 5] - tris[o + 2];
        const e2x = tris[o + 6] - tris[o], e2y = tris[o + 7] - tris[o + 1], e2z = tris[o + 8] - tris[o + 2];
        const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det;
        const sx = a.x - tris[o], sy = a.y - tris[o + 1], sz = a.z - tris[o + 2];
        const u = f * (sx * px + sy * py + sz * pz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = f * (d.x * qx + d.y * qy + d.z * qz);
        if (v < 0 || u + v > 1) continue;
        const t = f * (e2x * qx + e2y * qy + e2z * qz);
        if (t < 0 || t > reach) continue;
        if (!ours(a.x + d.x * t, a.y + d.y * t, a.z + d.z * t)) return false;
      }
      return true;
    };
    const w = (p: Vector3) => Vector3.TransformCoordinates(p, wm);
    const e = w(eye);
    if (!free(w(C), e, 0.3)) return false;
    const fwd = C.subtract(eye).normalize();
    const right = Vector3.Cross(Vector3.Up(), fwd).normalize();
    const up = Vector3.Cross(fwd, right);
    for (const o of [right, right.negate(), up, up.negate()]) if (!free(w(C), w(eye.add(o.scale(0.2))))) return false;
    return BOX.every(([x, y, z]) => free(e, w(new Vector3(x, y, z))));
  }

  /**
   * The solid triangles round the machine (world, 9 numbers each): the walker's collision grid's,
   * within a few metres, gathered once (again only if the grid is rebuilt, a cabinet come or gone).
   * Testing the side views' lines of sight against these takes milliseconds; picking against the
   * whole scene took seconds.
   */
  private occluders(wm: Matrix): { tris: Float64Array; box: Float32Array } {
    const cw = this.fly.walker?.world ?? null;
    if (this.occ && this.occ.world === cw) return this.occ;
    const keep: number[] = [];
    const box: number[] = [];
    if (cw) {
      const c = wm.getTranslation();
      const R = 3.2;
      // every line of sight runs above the deck: what lies lower (the floor, most of the triangles) is never in the way
      const low = c.y + this.spec.bedY - 0.15;
      cw.gather(c.x - R, c.x + R, low, c.y + 3.5, c.z - R, c.z + R);
      const v = cw.verts;
      const inv = wm.clone().invert();
      const S = this.spec;
      const l = new Vector3();
      for (let o = 0; o < cw.count * 9; o += 9) {
        if (Math.max(v[o + 1], v[o + 4], v[o + 7]) < low) continue;
        // and the glass box's own glass and posts are looked through
        let inside = true;
        for (let p = o; p < o + 9 && inside; p += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(v[p], v[p + 1], v[p + 2], inv, l);
          inside = l.x > S.bed[0] - 0.07 && l.x < S.bed[1] + 0.07 && l.z > S.bed[2] - 0.07 && l.z < S.bed[3] + 0.08 && l.y > S.bedY - 0.1 && l.y < S.bridgeY + 0.09;
        }
        if (inside) continue;
        for (let p = o; p < o + 9; p++) keep.push(v[p]);
        box.push(Math.min(v[o], v[o + 3], v[o + 6]), Math.max(v[o], v[o + 3], v[o + 6]), Math.min(v[o + 1], v[o + 4], v[o + 7]), Math.max(v[o + 1], v[o + 4], v[o + 7]), Math.min(v[o + 2], v[o + 5], v[o + 8]), Math.max(v[o + 2], v[o + 5], v[o + 8]));
      }
    }
    this.occ = { world: cw, tris: Float64Array.from(keep), box: Float32Array.from(box) };
    return this.occ;
  }
  private occ: { world: unknown; tris: Float64Array; box: Float32Array } | null = null;


  /** The way the view looks into the machine, flat and squared to its sides (machine frame): the keys steer along it. */
  private viewAxis(): [number, number] {
    const inv = this.root.computeWorldMatrix(true).clone().invert();
    const f = Vector3.TransformNormal(this.fly.camera.getDirection(Vector3.Forward()), inv);
    if (Math.abs(f.x) > Math.abs(f.z)) return [Math.sign(f.x), 0];
    return [0, f.z < 0 ? -1 : 1];
  }

  /** For tests: the share of the view's key points in the frame as the camera is now (1: all of them). */
  inView(): number {
    const pts = this.view === "panel" ? FRAME : this.view === "close" ? CLOSE : BOX;
    const wm = this.root.computeWorldMatrix(true);
    const cam = this.fly.camera;
    const vp = cam.getViewMatrix(true).multiply(cam.getProjectionMatrix(true));
    let n = 0;
    for (const [x, y, z] of pts) {
      const p = Vector3.TransformCoordinates(Vector3.TransformCoordinates(new Vector3(x, y, z), wm), vp);
      if (Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z > 0) n++;
    }
    return n / pts.length;
  }

  /**
   * Whether the walker stands at the deck and is looking at this machine: near the stand point,
   * in front of it, and the first thing the line of sight meets inside the cabinet's own box
   * (so looking at the snack machine beside it doesn't offer the claw).
   */
  private atDeck(): boolean {
    const walker = this.fly.walker;
    if (!walker) return false;
    const wm = this.root.computeWorldMatrix(true);
    const stand = Vector3.TransformCoordinates(Vector3.FromArray((this.root.metadata as SlotMeta).stand), wm);
    const f = walker.feet;
    if (Math.hypot(f.x - stand.x, f.z - stand.z) > REACH || Math.abs(f.y - stand.y) > 0.6) return false;
    // in front of it, and the first thing on the line of sight is the machine (not the snack machine's keypad beside it)
    const inv = wm.clone().invert();
    if (Vector3.TransformCoordinates(this.fly.eye, inv).z > this.spec.outer[4]) return false;
    const ray = new Ray(this.fly.eye.clone(), this.fly.aim.clone(), 2.5);
    const hit = this.scene.pickWithRay(ray, (m) => m.isPickable && m.isEnabled() && m.isVisible);
    if (!hit?.hit || !hit.pickedPoint) return false;
    const p = Vector3.TransformCoordinates(hit.pickedPoint, inv);
    const b = this.spec.outer;
    const e = 0.02;
    return p.x > b[0] - e && p.x < b[1] + e && p.y > b[2] - e && p.y < b[3] + e && p.z > b[4] - e && p.z < b[5] + e;
  }

  /** The prizes waiting behind the pickup door, oldest first: down the chute (in the bin, on those in it, or on their way). */
  private waiting(): number[] {
    const w = this.world;
    const down = new Set<number>();
    for (let b = 0; b < w.count; b++) if (!w.isGone(b) && b !== w.held && w.pose[b * 7 + 1] < this.spec.bedY - CHUTE_DOWN) down.add(b);
    this.binOrder = this.binOrder.filter((b) => down.has(b));
    for (const b of down) if (!this.binOrder.includes(b)) this.binOrder.push(b);
    return this.binOrder;
  }

  /** Those of them come to rest: what can be picked up. */
  private resting(): number[] {
    return this.waiting().filter((b) => this.world.isAsleep(b));
  }

  /** For tests: the prizes waiting behind the pickup door, oldest first. */
  waitingNow(): number[] {
    return [...this.waiting()];
  }

  /** The world matrix of prize b's mesh (as syncPrizes places it, in the root). */
  private prizeMatrix(b: number): Matrix {
    const w = this.world;
    const o = b * 7;
    const [rx, ry, rz] = w.restCentre(b);
    const q = new Quaternion(w.pose[o + 3], w.pose[o + 4], w.pose[o + 5], w.pose[o + 6]);
    return Matrix.Translation(-rx, -ry, -rz)
      .multiply(Matrix.FromQuaternionToRef(q, new Matrix()))
      .multiply(Matrix.Translation(w.pose[o], w.pose[o + 1], w.pose[o + 2]))
      .multiply(this.root.computeWorldMatrix(true));
  }

  /** Whether the walker is looking at the pickup door from near it, in front of the machine. */
  private atDoor(): boolean {
    if (!this.fly.walker) return false;
    const wm = this.root.computeWorldMatrix(true);
    const S = this.spec;
    const door = Vector3.TransformCoordinates(new Vector3((S.chute[0] + S.chute[1]) / 2, S.binY + 0.13, S.doorZ), wm);
    const eye = this.fly.eye;
    const to = door.subtract(eye);
    const dist = to.length();
    if (dist > DOOR_REACH || Vector3.TransformCoordinates(eye, wm.clone().invert()).z > S.doorZ) return false;
    return Vector3.Dot(to.normalize(), this.fly.aim) > Math.cos(DOOR_AIM);
  }

  /** E: pick up the prize waiting behind the pickup door (the oldest), or the plush on the floor looked at. */
  pickUp(): boolean {
    if (!this.doorOffer) return this.plush.pickUp();
    const b = this.resting()[0];
    if (b === undefined) return false;
    if (this.plush.holding) return this.plush.pickUp();
    const o = b * 7;
    return this.plush.takeFromDoor(this.world.kinds[b], this.prizeMatrix(b), { b, at: [this.world.pose[o], this.world.pose[o + 1], this.world.pose[o + 2]] });
  }

  /**
   * A plush has been taken from the pickup door, here or on another page: that prize leaves the
   * machine here too (when it is still where it lay), and the page that runs the machine (whoever
   * plays it, or the visitor who took it while nobody does) has the attendant put it back later.
   */
  private takenOut(p: Plush): void {
    const f = p.from;
    if (!f) return;
    const w = this.world;
    const b = f.b;
    if (b < 0 || b >= w.count || w.isGone(b)) return;
    const o = b * 7;
    if (Math.hypot(w.pose[o] - f.at[0], w.pose[o + 1] - f.at[1], w.pose[o + 2] - f.at[2]) > 0.03) return;
    this.game.takeOne(b);
    this.taken.set(b, [...f.at]);
    if (this.holder.by === VIEWER || (this.holder.by === null && p.by === VIEWER)) this.restocks.push({ b, at: this.clock + RESTOCK_AFTER });
    this.syncPrizes();
    this.dirty = true;
  }

  /** More than BIN_KEEP waiting: the oldest is set out on the floor in front of the pickup door (by the page running the machine). */
  private overflow(): void {
    const waiting = this.waiting();
    if (waiting.length <= BIN_KEEP) return;
    const b = waiting[0];
    const S = this.spec;
    const n = this.plush.outCount();
    const wm = this.root.computeWorldMatrix(true);
    const spot = Vector3.TransformCoordinates(new Vector3((S.chute[0] + S.chute[1]) / 2 + ((n % 3) - 1) * 0.16, 0, S.doorZ - 0.3 - (Math.floor(n / 3) % 3) * 0.12), wm);
    // facing out of the machine, as its prizes do
    const out = Vector3.TransformNormal(new Vector3(0, 0, 1), wm);
    const o = b * 7;
    this.plush.setOut(this.world.kinds[b], this.prizeMatrix(b), spot, Math.atan2(out.x, out.z), { b, at: [this.world.pose[o], this.world.pose[o + 1], this.world.pose[o + 2]] });
  }

  /** The HUD's view of the play, set when it changes. */
  private publishHud() {
    const g = this.game;
    const mine = store.get().focus?.kind === "claw";
    const hud: ClawHud | null = mine
      ? {
          phase: g.phase,
          timer: Math.ceil(g.timer),
          // this play's (earlier wins wait at the door too, but aren't cheered again)
          won: g.won.map((b) => PRIZE_NAMES[this.world.kinds[b]]),
          message: this.message,
          view: CLAW_VIEWS.find((v) => v.id === this.view)!.name,
        }
      : null;
    const was = store.get().claw;
    if (JSON.stringify(was) !== JSON.stringify(hud)) store.set({ claw: hud });
  }
  private message = "";


  /** Each frame: offer the machine to a walker at its deck (or its prize at the pickup door), run a play, move the pile on while it moves, show it all. */
  update(dt: number): void {
    this.clock += dt;
    const s = store.get();
    const g = this.game;
    // the prize behind the pickup door, offered to a walker looking at the door; the machine to one at its deck
    let door: { label: string; sub: string } | null = null;
    if (!s.focus && s.walking && this.fly.enabled && this.pose.door > 0.5) {
      const waiting = this.resting();
      if (waiting.length && this.atDoor()) door = { label: `Pick up the ${PRIZE_NAMES[this.world.kinds[waiting[0]]]}`, sub: waiting.length > 1 ? `from the pickup door (${waiting.length - 1} more waiting)` : "from the pickup door" };
    }
    this.doorOffer = door;
    if (!s.focus) {
      const at = !door && s.walking && this.fly.enabled && this.atDeck();
      if (at !== s.clawPrompt) store.set({ clawPrompt: at });
      const busy = at ? this.playerName : null;
      if (busy !== s.clawBusy) store.set({ clawBusy: busy });
    }
    this.plush.update(dt, door);
    // the attendant puts taken prizes back
    for (let i = this.restocks.length - 1; i >= 0; i--)
      if (this.clock >= this.restocks[i].at && !this.inUseByOther) {
        restock(this.world, this.restocks[i].b, this.rnd, this.spec.bedY + 0.42);
        this.taken.delete(this.restocks[i].b);
        this.restocks.splice(i, 1);
      }
    const mine = s.focus?.kind === "claw";
    if (this.aim) {
      const near = Math.hypot(this.pose.x - this.aim[0], this.pose.z - this.aim[1]) < 0.008 && g.trolleySpeed < 0.004 && Math.hypot(this.pose.swingX, this.pose.swingZ) < 0.003;
      this.aimStill = near ? this.aimStill + dt : 0;
    }
    if (this.inUseByOther) {
      this.watch();
      return;
    }
    if (this.holder.by === VIEWER) this.overflow();
    const doorTo = this.resting().length ? 1 : 0;
    if (g.busy || mine || !this.world.settled || this.pose.door !== doorTo || this.pose.button > 0 || Math.abs(this.pose.joyX) + Math.abs(this.pose.joyZ) > 0) {
      g.step(dt, mine ? this.input(this.inp) : IDLE);
      this.pose.door = doorTo > this.pose.door ? Math.min(1, this.pose.door + dt * 2.5) : Math.max(0, this.pose.door - dt * 2.5);
      this.events();
      this.syncPrizes();
      this.dirty = true;
      // the motors, heard by the player
      this.sound.drive(g.trolleySpeed, (this.pose.cable - this.lastCable) / Math.max(dt, 1e-3), mine);
      this.lastCable = this.pose.cable;
    } else this.sound.drive(0, 0, false);
    if (this.dirty) {
      this.dirty = false;
      this.syncClaw();
      this.paintDisplay(this.displayFor());
    }
    if (mine || s.claw) this.publishHud();
    // while this page plays, it tells the others where the claw and the moving prizes are; after, the pile, and frees
    // the machine. A visitor who took a prize while nobody played sends the pile once its replacement is in.
    if (this.holder.by === VIEWER || this.holder.by === null) {
      const playing = this.holder.by === VIEWER;
      if (playing && g.busy && this.clock - this.sentAt >= MOTION_EVERY) {
        this.sentAt = this.clock;
        this.publishMotion(this.motionNow());
      }
      if (g.busy || this.restocks.length) {
        this.pileOwed = true;
        this.busyAt = this.clock;
      }
      // once the pile is at rest, or a little after the play (a prize can go on rocking a hair where it lies)
      if (!g.busy && this.pileOwed && !this.restocks.length && (this.world.settled || this.clock - this.busyAt > PILE_WAIT)) {
        this.pileOwed = false;
        if (playing) this.publishMotion(this.motionNow());
        this.publishPile(this.pileNow());
      }
      if (playing && !mine && !g.busy && !this.pileOwed) this.publishUse({ by: null, name: "" });
    }
  }

  private motionNow(): ClawMotion {
    const w = this.world;
    const bodies: number[] = [];
    for (let b = 0; b < w.count; b++)
      if (!w.isGone(b) && (!w.isAsleep(b) || b === w.held)) {
        bodies.push(b);
        for (let i = 0; i < 7; i++) bodies.push(Math.round(w.pose[b * 7 + i] * 1e5) / 1e5);
      }
    const p = this.pose;
    return { by: VIEWER, t: room.now(), pose: { ...p, open: [...p.open] as [number, number, number] }, bodies, phase: this.game.phase, timer: this.game.timer };
  }

  /** Someone else plays: show the claw where their page says it is (a little behind, between two samples), and the prizes it moves. */
  private watch() {
    const ms = this.motions;
    if (!ms.length) return;
    const t = room.now() - WATCH_BEHIND * 1000;
    let a = ms[0];
    let b = ms[ms.length - 1];
    for (let i = 0; i < ms.length - 1; i++)
      if (ms[i].t <= t && ms[i + 1].t >= t) {
        a = ms[i];
        b = ms[i + 1];
        break;
      }
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
    const p = this.pose;
    const lerp = (x: number, y: number) => x + (y - x) * k;
    p.x = lerp(a.pose.x, b.pose.x);
    p.z = lerp(a.pose.z, b.pose.z);
    p.cable = lerp(a.pose.cable, b.pose.cable);
    p.swingX = lerp(a.pose.swingX, b.pose.swingX);
    p.swingZ = lerp(a.pose.swingZ, b.pose.swingZ);
    for (let i = 0; i < 3; i++) p.open[i] = lerp(a.pose.open[i], b.pose.open[i]);
    p.joyX = lerp(a.pose.joyX, b.pose.joyX);
    p.joyZ = lerp(a.pose.joyZ, b.pose.joyZ);
    p.button = lerp(a.pose.button, b.pose.button);
    p.door = lerp(a.pose.door, b.pose.door);
    // the prizes it moves: the nearer sample's poses (they move little between two)
    const src = k < 0.5 ? a : b;
    for (let i = 0; i < src.bodies.length; i += 8) this.world.setPose(src.bodies[i], src.bodies, i + 1, false);
    this.syncPrizes();
    this.syncClaw();
    this.paintDisplay(src.phase === "aim" ? String(Math.ceil(src.timer)).padStart(2, "0") : src.phase === "over" || src.phase === "idle" ? "PLAY" : "----");
  }

  /** What the credit display shows. */
  private displayFor(): string {
    const g = this.game;
    if (g.phase === "aim") return String(Math.ceil(g.timer)).padStart(2, "0");
    if (g.busy) return "----";
    if (g.inBin().length) return "WIN!";
    return "PLAY";
  }

  /** What the play's events say to the player. */
  private events() {
    const g = this.game;
    const heard = store.get().focus?.kind === "claw";
    for (const e of g.events.splice(0)) {
      const name = (b: number) => PRIZE_NAMES[this.world.kinds[b]];
      if (heard) {
        if (e.kind === "start") this.sound.start();
        else if (e.kind === "close") this.sound.close();
        else if (e.kind === "top") this.sound.top();
        else if (e.kind === "slip") this.sound.slip();
        else if (e.kind === "won") this.sound.won();
      }
      if (e.kind === "start") this.message = "Steer the claw · drop it before the time runs out";
      else if (e.kind === "drop") this.message = "Dropping…";
      else if (e.kind === "grab") this.message = `Got hold of ${name(e.prize)}…`;
      else if (e.kind === "slip") this.message = e.where === "lift" ? `${name(e.prize)} slipped out of the claw` : e.where === "top" ? `${name(e.prize)} shook loose at the top!` : `${name(e.prize)} slipped off on the way!`;
      else if (e.kind === "won") this.message = `You won ${name(e.prize)}!`;
      else if (e.kind === "over") this.message = e.won.length ? `You won ${e.won.map(name).join(" and ")}! It's in the pickup door` : this.message.includes("slip") || this.message.includes("loose") ? this.message : "No prize this time";
    }
  }

  /** The claw's pose changed: show it next frame. */
  touch(): void {
    this.dirty = true;
  }

  /** The prizes' meshes from their bodies. */
  syncPrizes(): void {
    const w = this.world;
    for (const e of this.prizeMeshes.values()) {
      e.bodies.forEach((b, i) => {
        if (w.isGone(b)) {
          Matrix.ScalingToRef(0, 0, 0, this.m);
          this.m.copyToArray(e.buf, i * 16);
          return;
        }
        const o = b * 7;
        const [rx, ry, rz] = w.restCentre(b);
        this.q.set(w.pose[o + 3], w.pose[o + 4], w.pose[o + 5], w.pose[o + 6]);
        // mesh = T(com) · R · T(-rest com), in Babylon's row-vector order
        Matrix.TranslationToRef(-rx, -ry, -rz, this.m);
        Matrix.FromQuaternionToRef(this.q, this.m2);
        this.m.multiplyToRef(this.m2, this.m);
        this.m2.copyFrom(this.m);
        Matrix.TranslationToRef(w.pose[o], w.pose[o + 1], w.pose[o + 2], this.m);
        this.m2.multiplyToRef(this.m, this.m);
        this.m.copyToArray(e.buf, i * 16);
      });
      e.mesh.thinInstanceBufferUpdated("matrix");
    }
  }

  /** Where the claw's head hangs now (machine frame): the cable's top plus its length and swing. */
  headAt(out: Vector3): Vector3 {
    const p = this.pose;
    const S = this.spec;
    return out.set(p.x + p.swingX, S.cableTop - Math.sqrt(Math.max(1e-6, p.cable * p.cable - p.swingX * p.swingX - p.swingZ * p.swingZ)), p.z + p.swingZ);
  }

  /** The head's lean on its cable (a quaternion), from its swing. */
  private headTurn(out: Quaternion): Quaternion {
    const p = this.pose;
    const L = Math.max(0.02, p.cable);
    // lean so the cable's line runs through the head: about x for a swing in z, about z for one in x
    return Quaternion.RotationYawPitchRollToRef(0, -Math.asin(Math.max(-0.6, Math.min(0.6, p.swingZ / L))), Math.asin(Math.max(-0.6, Math.min(0.6, p.swingX / L))), out);
  }

  /** The gantry, trolley, cable, head, prongs and controls from the pose. */
  syncClaw(): void {
    const p = this.pose;
    const S = this.spec;
    const P = this.parts;
    P.gantry.position.z = p.z;
    P.trolley.position.x = p.x;
    P.trolley.position.z = p.z;
    const head = this.headAt(this.v);
    const turn = this.headTurn(P.head.rotationQuaternion ?? (P.head.rotationQuaternion = new Quaternion()));
    P.head.position.copyFrom(head);
    for (const c of [P.cable, P.cord]) {
      c.position.set(p.x, S.cableTop, p.z);
      c.scaling.y = Math.hypot(head.x - p.x, S.cableTop - head.y, head.z - p.z);
      c.rotationQuaternion = turn.clone();
    }
    // the prongs: three thin instances round the head, each turned open on its hinge
    Matrix.ComposeToRef(this.one, turn, head, this.m2);
    for (let i = 0; i < 3; i++) {
      const ang = PRONG_SHUT + (PRONG_OPEN - PRONG_SHUT) * p.open[i];
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      // hinge: turn open about its own z, out to the collar, round the head
      Matrix.RotationZToRef(ang, this.m);
      const hinge = Matrix.Translation(S.hingeR, -S.hingeDrop, 0);
      const around = Matrix.RotationY(-a);
      this.m.multiplyToRef(hinge, this.m);
      this.m.multiplyToRef(around, this.m);
      this.m.multiplyToRef(this.m2, this.m);
      this.m.copyToArray(this.prongBuf, i * 16);
    }
    P.prongs.thinInstanceBufferUpdated("matrix");
    P.joystick.rotationQuaternion = Quaternion.RotationYawPitchRoll(0, p.joyZ * 0.32, -p.joyX * 0.32).multiply(baseTurn(P.joystick));
    P.button.position.y = buttonY(P.button) - p.button * 0.008;
    P.door.rotationQuaternion = Quaternion.RotationYawPitchRoll(0, p.door * 1.4, 0).multiply(baseTurn(P.door));
  }

  /** Paint the credit display (the timer, a message). */
  paintDisplay(text: string): void {
    if (text === this.displayText || !this.displayTex) return;
    this.displayText = text;
    const c = this.displayTex.getContext() as CanvasRenderingContext2D;
    const w = this.displayTex.getSize().width;
    const h = this.displayTex.getSize().height;
    c.fillStyle = "#120406";
    c.fillRect(0, 0, w, h);
    // unlit segments behind the lit ones, as on a real LED display
    c.font = `700 ${Math.round(h * 0.56)}px Montserrat, monospace`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "rgba(255,58,42,0.12)";
    c.fillText("8888", w / 2, h / 2 + 2);
    c.fillStyle = "#ff3a2a";
    c.fillText(text, w / 2, h / 2 + 2);
    this.displayTex.update(true);
  }
}

const IDLE: ClawInput = { x: 0, z: 0, drop: false };
const CONTROL_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Enter"]);

/** A node's turn as built (kept the first time it is asked for), so the engine's turns go on top of it. */
const built = new WeakMap<TransformNode, { q: Quaternion; y: number }>();
function baseTurn(n: TransformNode): Quaternion {
  let b = built.get(n);
  if (!b) built.set(n, (b = { q: (n.rotationQuaternion ?? Quaternion.Identity()).clone(), y: n.position.y }));
  return b.q;
}
function buttonY(n: TransformNode): number {
  baseTurn(n);
  return built.get(n)!.y;
}
