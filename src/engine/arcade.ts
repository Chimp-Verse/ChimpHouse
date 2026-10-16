// The Game Room's arcade: cabinets for the games admitted to ChimpHouse, in the
// room's cabinet slots, and playing them.
//
// Slots and screens are found by role and slot number (world/roles.ts), never
// by how the room code builds them, so this carries over to the Blender files.
// Playing a game: the camera glides square onto the cabinet's screen and the
// game's play page goes in an iframe lined up over it (engine/focus.ts,
// ui/PlayOverlay.tsx); browsers don't let another site's page be drawn onto a
// 3D surface.

import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { Cabinet, buildCabinet } from "../world/props/cabinet";
import { ROLE, ScreenMeta, findAll } from "../world/roles";
import { FlyCamera, Pose } from "./flyCamera";
import { ScreenFocus, pageRect, pickAt, screenGeometry, squarePose } from "./focus";
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
  /** where the list last came from: "chimpvibe" or "fixture" */
  source = "";

  constructor(
    private scene: Scene,
    private mats: Materials,
    private lighting: Lighting,
    private fly: FlyCamera,
    private focus: ScreenFocus,
    private canvas: HTMLCanvasElement,
    /** called when cabinets come or go, e.g. to rebuild what the walker collides with */
    private onChange: () => void,
  ) {
    this.slots = findAll(scene, ROLE.cabinetSlot).filter((n): n is TransformNode => n instanceof TransformNode);
    for (const s of this.slots) s.computeWorldMatrix(true);
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

  /** Each frame: offer the cabinet the walker is at (ScreenFocus keeps a screen in use lined up). */
  update(): void {
    const s = store.get();
    if (s.focus) return;
    const at = s.walking && this.fly.enabled ? this.cabinetAt() : null;
    if ((at ?? null) !== (s.arcadePrompt?.slot ?? null)) store.set({ arcadePrompt: at === null ? null : { slot: at, name: this.filled.get(at)!.game.name } });
  }

  /** Play the game in slot n: walk mode only. Resolves once the camera is at the screen. */
  async use(n: number): Promise<boolean> {
    const f = this.filled.get(n);
    if (!f || store.get().focus || !this.fly.walker || !store.get().walking) return false;
    this.playingSlot = n;
    this.fovBefore = this.fly.camera.fov;
    const { game } = f;
    store.set({ arcadePrompt: null });
    const info = { kind: "cabinet", slot: n, gameId: game.gameId, name: game.name, author: game.author, url: game.playUrl } as const;
    return this.focus.enter(info, f.cabinet.screen, () => this.screenPose(f.cabinet.screen), GLIDE_IN);
  }

  /** Stop playing: the game's frame goes (ending the connection), and the camera glides back to the stand point. */
  async leave(): Promise<void> {
    const n = this.playingSlot;
    const p = store.get().focus;
    if (n === null || p?.kind !== "cabinet" || p.phase === "out") return;
    const node = this.slots.find((s) => slotNo(s) === n)!;
    const wm = node.computeWorldMatrix(true);
    const stand = Vector3.TransformCoordinates(Vector3.FromArray((node.metadata as SlotMeta).stand), wm);
    const look = Vector3.TransformCoordinates(new Vector3(0, 1.3, 0), wm);
    const walker = this.fly.walker;
    let pose: Pose | null = null;
    if (walker && walker.place(stand.x, stand.y + 0.5, stand.z, 2)) {
      const f = walker.feet;
      const dx = look.x - f.x;
      const dz = look.z - f.z;
      pose = { x: f.x, y: walker.eyeY, z: f.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(look.y - walker.eyeY, Math.hypot(dx, dz)), fov: this.fovBefore };
    }
    await this.focus.leave(pose, GLIDE_OUT);
    this.playingSlot = null;
  }

  /** Where slot n's screen is on the page, in CSS pixels, from the camera as it is now. */
  screenRect(n: number): ScreenRect | null {
    const f = this.filled.get(n);
    return f ? pageRect(f.cabinet.screen, this.scene, this.canvas) : null;
  }

  /** The slot of the cabinet the walker can play: near its screen, in front of it and looking at it. */
  private cabinetAt(): number | null {
    const walker = this.fly.walker;
    if (!walker) return null;
    const feet = walker.feet;
    const fwd = this.fly.aim;
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
  click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().focus) return false;
    const hit = pickAt(this.scene, this.canvas, e);
    const md = hit?.mesh.metadata as Partial<ScreenMeta> | undefined;
    if (!hit || md?.role !== ROLE.cabinetScreen || md.slot === undefined || hit.distance > REACH + 1) return false;
    void this.use(md.slot);
    return true;
  }

  /** The camera square onto a screen, near enough that it fills most of the view. */
  private screenPose(screen: Mesh): Pose {
    const engine = this.scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    return squarePose(screenGeometry(screen), this.fovBefore, aspect, { w: FILL_W, h: FILL_H });
  }
}

/** Whether a cabinet built for `a` also suits `b`: the same game, named and coloured the same. */
function sameDress(a: ArcadeGame, b: ArcadeGame): boolean {
  return a.gameId === b.gameId && a.name === b.name && a.art === b.art && a.palette.join() === b.palette.join();
}
