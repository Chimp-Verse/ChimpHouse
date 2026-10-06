// The Game Room's arcade: cabinets for the games admitted to ChimpHouse, in the
// room's cabinet slots, and playing them.
//
// Slots and screens are found by role and slot number (world/roles.ts), never
// by how the room code builds them, so this carries over to the Blender files.
// Playing a game: the camera glides square onto the cabinet's screen and the
// game's play page goes in an iframe lined up over it (ui/PlayOverlay.tsx);
// browsers don't let another site's page be drawn onto a 3D surface.

import { Matrix, Mesh, Scene, TransformNode, Vector3, Viewport } from "@babylonjs/core";
import { SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { Cabinet, buildCabinet } from "../world/props/cabinet";
import { ROLE, ScreenMeta, findAll } from "../world/roles";
import { FlyCamera, Pose } from "./flyCamera";
import { ArcadeGame, GameList, loadGameList } from "./gameList";
import { Lighting } from "./lighting";
import { ScreenRect, store } from "./store";

/** How close (m) to a cabinet's screen, in front of it and looking at it, a visitor can play it. */
const REACH = 2.2;
/** Share of the view the screen fills while playing, leaving room for the frame round it. */
const FILL_H = 0.68;
const FILL_W = 0.82;
const GLIDE_IN = 0.9;
const GLIDE_OUT = 0.8;

interface Filled {
  game: ArcadeGame;
  cabinet: Cabinet;
}

const slotNo = (n: TransformNode) => (n.metadata as SlotMeta).slot;

export class Arcade {
  private slots: TransformNode[];
  private filled = new Map<number, Filled>();
  private playingSlot: number | null = null;
  private fovBefore = 1;
  /** render size the playing pose was set for: a resize sets it again */
  private poseSize = "";
  /** where the list last came from: "chimpvibe" or "fixture" */
  source = "";

  constructor(
    private scene: Scene,
    private mats: Materials,
    private lighting: Lighting,
    private fly: FlyCamera,
    private canvas: HTMLCanvasElement,
    /** called when cabinets come or go, e.g. to rebuild what the walker collides with */
    private onChange: () => void,
  ) {
    this.slots = findAll(scene, ROLE.cabinetSlot).filter((n): n is TransformNode => n instanceof TransformNode);
    for (const s of this.slots) s.computeWorldMatrix(true);
    fly.onClick = (e) => this.click(e);
  }

  /** The slots' numbers, in order. */
  get slotNumbers(): number[] {
    return this.slots.map(slotNo);
  }

  /** The game in each filled slot. */
  games(): { slot: number; game: ArcadeGame }[] {
    return [...this.filled].sort((a, b) => a[0] - b[0]).map(([slot, f]) => ({ slot, game: f.game }));
  }

  /** Load the game list (or take one already loading) and fill the slots from it. */
  async refresh(list: Promise<GameList> = loadGameList()): Promise<void> {
    const { games, source } = await list;
    this.source = source;
    this.setGames(games);
  }

  /**
   * Fill the slots in order with games, one each; more games than slots, the
   * rest are left out. A slot whose game is unchanged keeps its cabinet; one
   * whose game left is emptied (ending play there). Returns whether anything changed.
   */
  setGames(games: ArcadeGame[]): boolean {
    const want = new Map<number, ArcadeGame>();
    games.slice(0, this.slots.length).forEach((g, i) => want.set(slotNo(this.slots[i]), g));
    let changed = false;
    for (const node of this.slots) {
      const n = slotNo(node);
      const have = this.filled.get(n);
      const game = want.get(n);
      if (have && game && sameDress(have.game, game)) {
        have.game = game;
        continue;
      }
      if (have) {
        if (this.playingSlot === n) void this.leave();
        this.lighting.removeCasters(have.cabinet.casters);
        have.cabinet.dispose();
        this.filled.delete(n);
        changed = true;
      }
      if (game) {
        const cabinet = buildCabinet(this.mats, node, game);
        this.lighting.addMeshes(cabinet.meshes, cabinet.casters);
        this.filled.set(n, { game, cabinet });
        changed = true;
      }
    }
    if (changed) this.onChange();
    return changed;
  }

  /** Each frame: offer the cabinet the walker is at, or keep the playing screen lined up. */
  update(): void {
    const s = store.get();
    if (s.playing) {
      this.track();
      return;
    }
    const at = s.walking && this.fly.enabled ? this.cabinetAt() : null;
    if ((at ?? null) !== (s.arcadePrompt?.slot ?? null)) store.set({ arcadePrompt: at === null ? null : { slot: at, name: this.filled.get(at)!.game.name } });
  }

  /** Play the game in slot n: walk mode only. Resolves once the camera is at the screen. */
  async use(n: number): Promise<boolean> {
    const f = this.filled.get(n);
    if (!f || store.get().playing || !this.fly.walker || !store.get().walking) return false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.fly.releaseKeys();
    this.fly.enabled = false;
    this.playingSlot = n;
    this.fovBefore = this.fly.camera.fov;
    const { game } = f;
    store.set({ arcadePrompt: null, playRect: null, playing: { slot: n, gameId: game.gameId, name: game.name, author: game.author, url: game.playUrl, phase: "in" } });
    await this.fly.glide(this.screenPose(f.cabinet.screen), GLIDE_IN);
    const p = store.get().playing;
    if (this.playingSlot !== n || !p || p.phase !== "in") return false;
    this.poseSize = "";
    store.set({ playing: { ...p, phase: "playing" } });
    this.track();
    return true;
  }

  /** Stop playing: the game's frame goes (ending the connection), and the camera glides back to the stand point. */
  async leave(): Promise<void> {
    const n = this.playingSlot;
    const p = store.get().playing;
    if (n === null || !p || p.phase === "out") return;
    store.set({ playing: { ...p, phase: "out" }, playRect: null });
    const node = this.slots.find((s) => slotNo(s) === n)!;
    const wm = node.computeWorldMatrix(true);
    const stand = Vector3.TransformCoordinates(Vector3.FromArray((node.metadata as SlotMeta).stand), wm);
    const look = Vector3.TransformCoordinates(new Vector3(0, 1.3, 0), wm);
    const walker = this.fly.walker;
    if (walker && walker.place(stand.x, stand.y + 0.5, stand.z, 2)) {
      const f = walker.feet;
      const dx = look.x - f.x;
      const dz = look.z - f.z;
      const pose: Pose = { x: f.x, y: walker.eyeY, z: f.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(look.y - walker.eyeY, Math.hypot(dx, dz)), fov: this.fovBefore };
      await this.fly.glide(pose, GLIDE_OUT);
    }
    this.playingSlot = null;
    store.set({ playing: null, playRect: null });
    this.fly.releaseKeys();
    this.fly.enabled = true;
  }

  /** Where slot n's screen is on the page, in CSS pixels, from the camera as it is now. */
  screenRect(n: number): ScreenRect | null {
    const f = this.filled.get(n);
    if (!f) return null;
    const { screen } = f.cabinet;
    const [w, h] = (screen.metadata as ScreenMeta).screenSize;
    const wm = screen.computeWorldMatrix(true);
    const cam = this.fly.camera;
    const vp = cam.getViewMatrix(true).multiply(cam.getProjectionMatrix(true));
    const engine = this.scene.getEngine();
    const rw = engine.getRenderWidth();
    const rh = engine.getRenderHeight();
    const view = new Viewport(0, 0, rw, rh);
    const box = this.canvas.getBoundingClientRect();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const q = Vector3.Project(Vector3.TransformCoordinates(new Vector3((sx * w) / 2, (sy * h) / 2, 0), wm), Matrix.IdentityReadOnly, vp, view);
      const x = box.left + (q.x * box.width) / rw;
      const y = box.top + (q.y * box.height) / rh;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** The slot of the cabinet the walker can play: near its screen, in front of it and looking at it. */
  private cabinetAt(): number | null {
    const walker = this.fly.walker;
    if (!walker) return null;
    const feet = walker.feet;
    const fwd = this.fly.camera.getDirection(Vector3.Forward());
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    let best: number | null = null;
    let bestD = REACH;
    for (const [n, f] of this.filled) {
      const node = f.cabinet.root.parent as TransformNode;
      const c = f.cabinet.screen.getAbsolutePosition();
      const dx = c.x - feet.x;
      const dz = c.z - feet.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD || Math.abs(feet.y - node.position.y) > 0.6) continue;
      const front = node.getDirection(new Vector3(0, 0, -1));
      if (-(dx * front.x + dz * front.z) < 0.2) continue; // behind or beside it
      if ((fwd.x * dx + fwd.z * dz) / (fl * d) < Math.cos((55 * Math.PI) / 180)) continue; // looking away
      best = n;
      bestD = d;
    }
    return best;
  }

  /** A canvas click in walk mode on a cabinet's screen within reach plays it. */
  private click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().playing) return false;
    const engine = this.scene.getEngine();
    let x = engine.getRenderWidth() / 2;
    let y = engine.getRenderHeight() / 2;
    if (document.pointerLockElement !== this.canvas) {
      const box = this.canvas.getBoundingClientRect();
      x = ((e.clientX - box.left) / box.width) * engine.getRenderWidth();
      y = ((e.clientY - box.top) / box.height) * engine.getRenderHeight();
    }
    const pick = this.scene.pick(x, y, (m) => m.isPickable && m.isEnabled() && m.isVisible);
    const md = pick?.pickedMesh?.metadata as Partial<ScreenMeta> | undefined;
    if (!pick?.hit || md?.role !== ROLE.cabinetScreen || md.slot === undefined || pick.distance > REACH + 1) return false;
    void this.use(md.slot);
    return true;
  }

  /** The camera square onto a screen, near enough that it fills most of the view. */
  private screenPose(screen: Mesh): Pose {
    const wm = screen.computeWorldMatrix(true);
    const c = Vector3.TransformCoordinates(Vector3.Zero(), wm);
    const out = Vector3.TransformNormal(new Vector3(0, 0, -1), wm).normalize();
    const [w, h] = (screen.metadata as ScreenMeta).screenSize;
    const engine = this.scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const t = Math.tan(this.fovBefore / 2);
    const d = Math.max(h / 2 / (t * FILL_H), w / 2 / (t * aspect * FILL_W));
    const p = c.add(out.scale(d));
    return { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-out.x, -out.z), pitch: Math.asin(out.y), fov: this.fovBefore };
  }

  /** While playing: keep the camera on the screen through resizes, and the overlay on the screen. */
  private track() {
    const p = store.get().playing;
    const f = this.playingSlot === null ? undefined : this.filled.get(this.playingSlot);
    if (!p || p.phase !== "playing" || !f) return;
    const engine = this.scene.getEngine();
    const size = `${engine.getRenderWidth()}x${engine.getRenderHeight()}`;
    if (size !== this.poseSize) {
      this.poseSize = size;
      this.fly.setPose(this.screenPose(f.cabinet.screen));
    }
    const r = this.screenRect(this.playingSlot!);
    const was = store.get().playRect;
    if (r && (!was || Math.abs(r.x - was.x) > 0.5 || Math.abs(r.y - was.y) > 0.5 || Math.abs(r.w - was.w) > 0.5 || Math.abs(r.h - was.h) > 0.5)) store.set({ playRect: r });
  }
}

/** Whether a cabinet built for `a` also suits `b`: the same game, named and coloured the same. */
function sameDress(a: ArcadeGame, b: ArcadeGame): boolean {
  return a.gameId === b.gameId && a.name === b.name && a.art === b.art && a.palette.join() === b.palette.join();
}
