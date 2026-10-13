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
// again afterwards, and Esc or Leave walks away. A prize won drops down the chute
// and comes to rest behind the pickup door, which swings open; it is taken (and put
// back in the machine by the attendant a little later) when the next play starts or
// the player leaves.
//
// Nothing runs per frame unless the pile is moving, the claw is, or someone is playing.

import { DynamicTexture, Matrix, Mesh, PBRMaterial, Quaternion, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { MeshMeta, SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { ClawSpec, PRIZE_NAMES, PrizeKind, plushMat, prizeGeo } from "../world/props/clawMachine";
import { ROLE, find } from "../world/roles";
import { PrizeWorld, STOCK, dropIn, restock, seeded } from "./clawPhysics";
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
/** how often (s) a player's page tells the others where the claw is, and how far behind (s) a watcher shows it, to have a sample either side */
const MOTION_EVERY = 1 / 16;
const WATCH_BEHIND = 0.12;

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

  constructor(
    scene: Scene,
    mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    private focus: ScreenFocus,
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
    stockMachine(this.world, S, this.rnd);
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

  /** A new play: whatever is behind the pickup door is taken first. */
  play(): boolean {
    if (this.game.busy) return false;
    this.takePrizes();
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
    out.x = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    out.z = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
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
  /** how long a prize has waited behind the pickup door with nobody playing */
  private binWait = 0;
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

  /** The machine as it opens: every prize back in a freshly stocked pile, the claw home, nobody playing, for everyone (tests start from it). */
  reset(): void {
    if (store.get().focus?.kind === "claw") return;
    const w = this.world;
    const S = this.spec;
    const rnd = seeded(7);
    w.hold(-1);
    for (let b = 0; b < w.count; b++) restock(w, b, rnd, S.bedY + 0.12 + Math.floor(b / 6) * 0.16);
    w.settle(10);
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let b = 0; b < w.count; b++)
        if (w.pose[b * 7 + 1] < S.bedY) {
          restock(w, b, rnd, S.bedY + 0.45);
          moved = true;
        }
      if (!moved) break;
      w.settle(6);
    }
    this.restocks.length = 0;
    this.game.reset();
    Object.assign(this.pose, { x: S.home[0], z: S.home[1], cable: S.cableUp, swingX: 0, swingZ: 0, open: [0.45, 0.45, 0.45], joyX: 0, joyZ: 0, button: 0, door: 0 });
    this.syncPrizes();
    this.dirty = true;
    this.publishPile(this.pileNow());
    this.publishUse({ by: null, name: "" });
  }

  /** Plays simulated on fresh copies of this machine's stock (clawRules.ts simulatePlays). */
  simulate(n: number, strategy: "aim" | "random", strength: number | null) {
    return simulatePlays(this.spec, (w, rnd) => stockMachine(w, this.spec, rnd), n, strategy, strength);
  }

  /** Walk mode, at the deck: play. Resolves once the camera is at the player's view. */
  async use(): Promise<boolean> {
    const s = store.get();
    if (s.focus || !this.fly.walker || !s.walking || this.inUseByOther) return false;
    this.publishUse({ by: VIEWER, name: ME.name });
    this.fovBefore = this.fly.camera.fov;
    store.set({ clawPrompt: false });
    this.sound.unlock();
    const ok = await this.focus.enter({ kind: "claw" }, this.parts.display, () => this.playPose(), GLIDE_IN);
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
      if (p.gone.includes(b)) w.remove(b);
      else w.setPose(b, p.poses, b * 7, true);
    }
    this.restocks.length = 0;
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
    if (!this.game.busy) this.takePrizes();
    this.aim = null;
    this.publishHud();
  }

  /** The player's view: standing at the deck, looking down into the glass box with the whole bed and the chute in view. */
  playPose(): Pose {
    const wm = this.root.computeWorldMatrix(true);
    const eye = Vector3.TransformCoordinates(new Vector3(0, 1.66, -0.98), wm);
    const at = Vector3.TransformCoordinates(new Vector3(0, 1.13, 0.0), wm);
    const dx = at.x - eye.x;
    const dz = at.z - eye.z;
    return { x: eye.x, y: eye.y, z: eye.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(at.y - eye.y, Math.hypot(dx, dz)), fov: 0.86 };
  }

  /** Whether the walker stands at the deck, facing the machine and looking at it. */
  private atDeck(): boolean {
    const walker = this.fly.walker;
    if (!walker) return false;
    const wm = this.root.computeWorldMatrix(true);
    const stand = Vector3.TransformCoordinates(Vector3.FromArray((this.root.metadata as SlotMeta).stand), wm);
    const c = Vector3.TransformCoordinates(new Vector3(0, 0, 0), wm);
    const f = walker.feet;
    if (Math.hypot(f.x - stand.x, f.z - stand.z) > REACH || Math.abs(f.y - c.y) > 0.6) return false;
    const front = this.root.getDirection(new Vector3(0, 0, -1));
    const dx = c.x - f.x;
    const dz = c.z - f.z;
    const d = Math.hypot(dx, dz) || 1;
    if (-(dx * front.x + dz * front.z) / d < 0.3) return false; // beside or behind it
    const fwd = this.fly.camera.getDirection(Vector3.Forward());
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    return (fwd.x * dx + fwd.z * dz) / (fl * d) > Math.cos((55 * Math.PI) / 180);
  }

  /** Prizes behind the pickup door are taken, and go back in the machine a little later. */
  private takePrizes() {
    for (const b of this.game.take()) this.restocks.push({ b, at: this.clock + RESTOCK_AFTER });
    this.syncPrizes();
  }

  /** The HUD's view of the play, set when it changes. */
  private publishHud() {
    const g = this.game;
    const mine = store.get().focus?.kind === "claw";
    const binned = g.inBin();
    const hud: ClawHud | null = mine
      ? {
          phase: g.phase,
          timer: Math.ceil(g.timer),
          won: binned.map((b) => PRIZE_NAMES[this.world.kinds[b]]),
          message: this.message,
        }
      : null;
    const was = store.get().claw;
    if (JSON.stringify(was) !== JSON.stringify(hud)) store.set({ claw: hud });
  }
  private message = "";


  /** Each frame: offer the machine to a walker at its deck, run a play, move the pile on while it moves, show it all. */
  update(dt: number): void {
    this.clock += dt;
    const s = store.get();
    if (!s.focus) {
      const at = s.walking && this.fly.enabled && this.atDeck();
      if (at !== s.clawPrompt) store.set({ clawPrompt: at });
      const busy = at ? this.playerName : null;
      if (busy !== s.clawBusy) store.set({ clawBusy: busy });
    }
    // the attendant puts taken prizes back
    for (let i = this.restocks.length - 1; i >= 0; i--)
      if (this.clock >= this.restocks[i].at && !this.inUseByOther) {
        restock(this.world, this.restocks[i].b, this.rnd, this.spec.bedY + 0.42);
        this.restocks.splice(i, 1);
      }
    const g = this.game;
    const mine = s.focus?.kind === "claw";
    if (this.aim) {
      const near = Math.hypot(this.pose.x - this.aim[0], this.pose.z - this.aim[1]) < 0.008 && g.trolleySpeed < 0.004 && Math.hypot(this.pose.swingX, this.pose.swingZ) < 0.003;
      this.aimStill = near ? this.aimStill + dt : 0;
    }
    // a prize that reached the pickup door after its winner walked away is taken a little later
    if (!mine && !g.busy && !this.inUseByOther && g.inBin().some((b) => this.world.isAsleep(b))) {
      this.binWait += dt;
      if (this.binWait > 3) {
        this.binWait = 0;
        this.takePrizes();
      }
    } else this.binWait = 0;
    if (this.inUseByOther) {
      this.watch();
      return;
    }
    const doorTo = g.inBin().some((b) => this.world.isAsleep(b)) ? 1 : 0;
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
    // while this page plays, it tells the others where the claw and the moving prizes are; after, the pile, and frees the machine
    if (this.holder.by === VIEWER) {
      if (g.busy && this.clock - this.sentAt >= MOTION_EVERY) {
        this.sentAt = this.clock;
        this.publishMotion(this.motionNow());
      }
      if (g.busy || this.restocks.length) this.pileOwed = true;
      if (!g.busy && this.pileOwed && this.world.settled && !this.restocks.length) {
        this.pileOwed = false;
        this.publishMotion(this.motionNow());
        this.publishPile(this.pileNow());
      }
      if (!mine && !g.busy && !this.pileOwed) this.publishUse({ by: null, name: "" });
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
    P.button.position.y = buttonY(P.button) - p.button * 0.006;
    P.door.rotationQuaternion = Quaternion.RotationYawPitchRoll(0, p.door * 1.1, 0).multiply(baseTurn(P.door));
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

/** Fill a machine: every prize of the stock dropped in, settled into a pile, any that tumbled into the chute put back elsewhere. */
function stockMachine(world: PrizeWorld, S: ClawSpec, rnd: () => number) {
  STOCK.forEach((kind, i) => dropIn(world, kind, rnd, S.bedY + 0.12 + Math.floor(i / 6) * 0.16));
  world.settle(10);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let b = 0; b < world.count; b++)
      if (world.pose[b * 7 + 1] < S.bedY) {
        restock(world, b, rnd, S.bedY + 0.45);
        moved = true;
      }
    if (!moved) break;
    world.settle(6);
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
