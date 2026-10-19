// The Game Room's arcade: cabinets for the games admitted to ChimpHouse, in the
// room's cabinet slots, and playing them.
//
// Slots and screens are found by role and slot number (world/roles.ts), never
// by how the room code builds them, so this carries over to the Blender files.
// Playing a game: the camera glides square onto the cabinet's screen and the
// game's play page goes in an iframe lined up over it (engine/focus.ts,
// ui/PlayOverlay.tsx); browsers don't let another site's page be drawn onto a
// 3D surface.
//
// A game keeps running from the first time it is played until Quit. Step back
// (or walking off) leaves it running in its frame, laid over the cabinet's
// screen in perspective while the screen is in clear view and hidden, still
// running, while it isn't; playing it again picks it up where it is. The frame
// is placed each frame, before the scene is drawn, so it never drifts from the
// screen.
//
// A running game holds one of the 64 places in ChimpVibe's shared session for
// that game, steered by no one while nobody plays it. So a game left alone
// quits by itself after AWAY_MS: its clock runs whenever it isn't being played,
// however close the visitor stands, and only playing it again resets it.
//
// A cabinet whose game fails on ChimpVibe's side shows OUT OF ORDER (or GAME
// FULL) until a visitor tries it again. The play page, in ChimpVibe's embed mode
// (engine/embed.ts), says so with an "error" message. What such a page can't
// say, ChimpHouse checks as the game starts, while the camera glides in
// (pageProblem): whether ChimpVibe answers, and whether the page loads or
// answers with an error or refuses to show here; plus a page that never loads
// (LOAD_MS). Until the check passes, or the page says it is ready, the game's
// frame stays hidden, so a broken page is never seen: its cabinet goes straight
// to OUT OF ORDER. Cabinets aren't checked in the background: loading a play
// page wakes a parked ChimpVibe session.

import { Material, Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { roomAt } from "../world/layout";
import { SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { Cabinet, buildCabinet } from "../world/props/cabinet";
import { ROLE, ScreenMeta, findAll } from "../world/roles";
import { FlyCamera, Pose } from "./flyCamera";
import { ScreenFocus, ScreenGeometry, nothingInTheWay, onPage, pageRect, pickAt, quadTransform, screenGeometry, screenHoleMaterial, squarePose, toPage } from "./focus";
import { ArcadeGame, GameList, loadGameList } from "./gameList";
import { EmbedErrorCode, EmbedMessage, parseEmbedMessage } from "./embed";
import { LOAD_MS, pageProblem } from "./pageCheck";
import { Lighting } from "./lighting";
import { ScreenRect, store } from "./store";

/**
 * Where a visitor can play a cabinet: in front of its screen, at most `ahead`
 * out from it (about 0.9 m from the cabinet's front edge; the control deck and
 * the walker's width keep them at least ~0.55 m out) and at most `aside` to
 * either side of its middle, so only one cabinet of a row is in reach at a time.
 */
const PLAY = { ahead: 1.15, aside: 0.45 };
/** Share of the view the screen fills while playing, leaving room for the frame round it. */
const FILL_H = 0.68;
const FILL_W = 0.82;
const GLIDE_IN = 0.9;
const GLIDE_OUT = 0.8;
/** A running game over its cabinet's screen in perspective: its frame's own width (CSS px; a transform maps it onto the screen), and the steepest it is shown at. */
const OVER = { width: 960, maxAngle: (80 * Math.PI) / 180 };

/**
 * Seen through the scene: while the visitor walks about, a running game's frame
 * lies under the 3D canvas, and its cabinet's screen is drawn as a hole in the
 * canvas (transparent, but in the depth buffer), so the game shows exactly where
 * the screen is visible and anything in front of it (a neighbouring cabinet, a
 * plant) covers it as it would a screen. ?arcadeHole=0 lays the frame over the
 * scene instead, hidden whenever anything is in the way.
 */
const HOLE = new URLSearchParams(location.search).get("arcadeHole") !== "0";

/** How long a running game may be left alone before it quits by itself (?arcadeAway=<seconds> to try it sooner). */
const AWAY_MS = (Number(new URLSearchParams(location.search).get("arcadeAway")) || 180) * 1000;

const AWAY_TEXT = AWAY_MS % 60000 === 0 ? `${AWAY_MS / 60000} minute${AWAY_MS === 60000 ? "" : "s"}` : `${AWAY_MS / 1000} seconds`;

/** Where a running game's frame is: hidden (still running), over its screen in perspective, or square on while it is played. */
type View = "hidden" | "over" | "on";

interface Running {
  game: ArcadeGame;
  frame: HTMLIFrameElement | null;
  view: View;
  /** the screen in clear view, last checked at frame `at` */
  clear: { at: number; ok: boolean };
  /** when the visitor left it alone (Date.now()), while they are away from it */
  awaySince: number | null;
  /** until its page has loaded: the timer that puts its cabinet out of order */
  loading: ReturnType<typeof setTimeout> | null;
  /** its page is known to work: the check as it started passed, or the page has spoken in embed mode; until then its frame is hidden */
  verified: boolean;
}

interface Filled {
  game: ArcadeGame;
  cabinet: Cabinet;
}

const slotNo = (n: TransformNode) => (n.metadata as SlotMeta).slot;

export class Arcade {
  private slots: TransformNode[];
  private filled = new Map<number, Filled>();
  private playingSlot: number | null = null;
  /** the games running at cabinets, by slot (published as the store's `arcadeRunning`) */
  private running = new Map<number, Running>();
  private geos = new Map<number, ScreenGeometry>();
  /** each screen drawn as a hole in the canvas (engine/focus.ts), with its own material to put back */
  private holed = new Map<number, Material>();
  /** cabinets out of order (or full), by slot: why, and ChimpVibe's error code when it gave one */
  private broken = new Map<number, { reason: string; code: EmbedErrorCode | null }>();
  private frames = 0;
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
    /** tells the visitor something briefly (a game left alone has quit) */
    private say: (msg: string) => void = () => {},
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
        if (this.running.has(n)) void this.quit(n);
        this.geos.delete(n);
        this.broken.delete(n);
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

  /** Each frame: offer the cabinet the walker is at, and place each running game's frame (ScreenFocus keeps a screen in use lined up). */
  update(): void {
    this.frames++;
    const s = store.get();
    if (!s.focus) {
      const at = s.walking && this.fly.enabled ? this.cabinetAt() : null;
      const outOfOrder = at !== null && this.broken.has(at);
      const full = outOfOrder && this.broken.get(at!)!.code === "full";
      if ((at ?? null) !== (s.arcadePrompt?.slot ?? null) || outOfOrder !== !!s.arcadePrompt?.outOfOrder || full !== !!s.arcadePrompt?.full)
        store.set({ arcadePrompt: at === null ? null : { slot: at, name: this.filled.get(at)!.game.name, outOfOrder, full } });
    }
    for (const [n, r] of this.running) this.place(n, r);
    this.minding();
  }

  /** Start each running game's clock when play stops, and stop it when it is played again; quit any left alone for AWAY_MS. */
  private minding(): void {
    const now = Date.now();
    let changed = false;
    const expired: number[] = [];
    for (const [n, r] of this.running) {
      if (this.beingPlayed(n)) {
        if (r.awaySince !== null) (r.awaySince = null), (changed = true);
      } else if (r.awaySince === null) (r.awaySince = now), (changed = true);
      else if (now - r.awaySince >= AWAY_MS) expired.push(n);
    }
    if (changed) this.publish();
    for (const n of expired) {
      const name = this.running.get(n)!.game.name;
      void this.quit(n);
      this.say(`${name} has quit: it was left alone for ${AWAY_TEXT}`);
    }
  }

  /** Someone is playing slot n's game: using its screen, or gliding in to it. */
  private beingPlayed(n: number): boolean {
    const f = store.get().focus;
    return f?.kind === "cabinet" && f.slot === n && f.phase !== "out";
  }


  /**
   * Play the game in slot n (walk mode), starting it or picking it up where it
   * is; an out-of-order cabinet is tried again. Resolves once the camera is at the screen.
   */
  async use(n: number): Promise<boolean> {
    const f = this.filled.get(n);
    if (!f || store.get().focus || !this.fly.walker || !store.get().walking) return false;
    if (!this.running.has(n)) {
      if (this.broken.delete(n)) f.cabinet.outOfOrder(null);

      this.running.set(n, { game: f.game, frame: null, view: "hidden", clear: { at: -100, ok: false }, awaySince: null, loading: null, verified: false });
      this.publish();
      void this.verify(n, this.running.get(n)!);
    }
    this.playingSlot = n;
    this.fovBefore = this.fly.camera.fov;
    const { game } = f;
    store.set({ arcadePrompt: null });
    const info = { kind: "cabinet", slot: n, gameId: game.gameId, name: game.name, author: game.author, url: game.playUrl } as const;
    return this.focus.enter(info, f.cabinet.screen, () => this.screenPose(f.cabinet.screen), GLIDE_IN);
  }

  /** Step back from the game being played: it keeps running, and the camera glides back to the stand point. */
  async stepBack(): Promise<void> {
    const n = this.playingSlot;
    const p = store.get().focus;
    if (n === null || p?.kind !== "cabinet" || p.phase === "out") return;
    const node = this.slots.find((s) => slotNo(s) === n)!;
    const wm = node.computeWorldMatrix(true);
    const stand = Vector3.TransformCoordinates(Vector3.FromArray((node.metadata as SlotMeta).stand), wm);
    // up the cabinet a little, so its marquee stays in view this close
    const look = Vector3.TransformCoordinates(new Vector3(0, 1.45, 0), wm);
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

  /**
   * Quit the game at slot n (by default the one being played): its frame leaves
   * the page, which ends the visitor's connection to it, and if it was being
   * played the camera glides back to the stand point.
   */
  async quit(n?: number): Promise<void> {
    const f = store.get().focus;
    const slot = n ?? (f?.kind === "cabinet" ? f.slot : null);
    const r = slot === null ? undefined : this.running.get(slot);
    if (slot === null || !r) return;
    if (r.loading) clearTimeout(r.loading);
    this.running.delete(slot);
    this.hole(slot, false);
    this.publish();
    if (f?.kind === "cabinet" && f.slot === slot) await this.stepBack();
  }

  /**
   * The game at slot n has failed on ChimpVibe's side: it quits (gliding back if
   * it was being played) and its cabinet shows OUT OF ORDER until it is tried again.
   */
  fail(n: number, reason: string, code: EmbedErrorCode | null = null): void {
    const f = this.filled.get(n);
    const was = this.broken.get(n);
    if (!f || (was?.reason === reason && was.code === code)) return;
    this.broken.set(n, { reason, code });
    const what = code === "full" ? "is full" : "is out of order";
    f.cabinet.outOfOrder(reason, code === "full" ? "GAME FULL" : "OUT OF ORDER");
    console.warn(`[arcade] ${f.game.name} ${what}: ${reason}`);
    if (this.running.has(n)) {
      void this.quit(n);
      this.say(`${f.game.name} ${what}: ${reason}`);
    }
  }

  /** The cabinets out of order (or full): slot, why, and ChimpVibe's error code when it gave one. */
  outOfOrder(): { slot: number; reason: string; code: EmbedErrorCode | null }[] {
    return [...this.broken].map(([slot, b]) => ({ slot, ...b }));
  }

  /**
   * A message from the page in slot n's frame (ui/PlayOverlay.tsx checks it came
   * from that frame and the game's origin). Returns it when it is an embed-mode
   * message, for the frame of UI to follow; an error puts the cabinet out of order.
   */
  receive(n: number, data: unknown): EmbedMessage | null {
    const r = this.running.get(n);
    const msg = parseEmbedMessage(data);
    if (!r || !msg) return null;
    if (msg.type === "error") this.fail(n, msg.reason, msg.code);
    else if (!r.verified) {
      // a page speaking embed mode has loaded and works
      r.verified = true;
      this.publish();
    }
    return msg;
  }

  /**
   * Check a game just started, while the camera glides in: a page that fails
   * (pageProblem) puts its cabinet out of order before it is ever seen; one that
   * loads is shown. A page that has already said it is ready needs no answer.
   */
  private async verify(n: number, r: Running): Promise<void> {
    const t0 = performance.now();
    const reason = await pageProblem(r.game.playUrl);
    if (this.running.get(n) !== r) return;
    if (reason) this.fail(n, reason);
    else if (!r.verified) {
      r.verified = true;
      this.publish();
    }
    console.info(`[arcade] ${r.game.name}: checked in ${Math.round(performance.now() - t0)} ms${reason ? `: ${reason}` : ""}`);
  }

  /** The running games, by slot, with where each frame is. */
  runningGames(): { slot: number; gameId: string; name: string; view: View }[] {
    return [...this.running].map(([slot, r]) => ({ slot, gameId: r.game.gameId, name: r.game.name, view: r.view }));
  }

  /** A running game's frame is in the page (ui/PlayOverlay.tsx), or has left it. */
  attach(slot: number, frame: HTMLIFrameElement): void {
    const r = this.running.get(slot);
    if (!r) return;
    r.frame = frame;
    r.view = "hidden";
    // a page that never loads puts its cabinet out of order
    r.loading = setTimeout(() => this.running.get(slot) === r && this.fail(slot, "the game didn't load"), LOAD_MS);
    frame.addEventListener("load", () => r.loading && (clearTimeout(r.loading), (r.loading = null)), { once: true });
  }

  detach(slot: number, frame: HTMLIFrameElement): void {
    const r = this.running.get(slot);
    if (r?.frame === frame) r.frame = null;
  }

  /** Give the keyboard to the game being played, if it lost it (never taken back while its page hands it on to the game). */
  giveKeys(slot: number): void {
    const r = this.running.get(slot);
    if (r?.frame && r.view === "on" && document.activeElement !== r.frame) r.frame.focus();
  }

  private publish(): void {
    store.set({
      arcadeRunning: [...this.running].map(([slot, r]) => ({
        slot,
        gameId: r.game.gameId,
        name: r.game.name,
        author: r.game.author,
        url: r.game.playUrl,
        quitsAt: r.awaySince === null ? null : r.awaySince + AWAY_MS,
        checking: !r.verified,
      })),
    });
  }

  /**
   * Place a running game's frame for this frame: square on while it is played;
   * over its screen in perspective while the screen is in clear view (and no
   * other screen is in use); otherwise hidden, still running. It takes the
   * keyboard as it is played and gives it back to ChimpHouse as play stops, so
   * the visitor's keys walk them again.
   */
  private place(n: number, r: Running): void {
    const frame = r.frame;
    if (!frame) return;
    const s = store.get();
    const f = s.focus;
    const mine = f?.kind === "cabinet" && f.slot === n;
    let view: View = "hidden";
    let quad: { x: number; y: number }[] | null = null;
    // a page not yet known to work stays out of sight (its cabinet shows its art meanwhile)
    if (!r.verified) view = "hidden";
    else if (mine && f.phase === "on" && s.focusRect) view = "on";
    else if ((!f || mine) && (quad = this.screenOnPage(n, r))) view = "over";
    const was = r.view;
    r.view = view;
    const st = frame.style;
    if (was === "on" && view !== "on" && document.activeElement === frame) frame.blur();
    // seen through the scene: under the canvas, through the screen's hole
    const through = HOLE && view === "over";
    this.hole(n, through);
    st.zIndex = through ? "0" : "";
    if (view === "hidden") {
      st.visibility = "hidden";
      st.pointerEvents = "none";
      return;
    }
    if (view === "on") {
      const rect = s.focusRect!;
      Object.assign(st, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, transform: "none", pointerEvents: "auto" });
    } else {
      const g = this.geo(n)!;
      const w = OVER.width;
      const h = Math.round((w * g.height) / g.width);
      // seen, not played: clicks go to the scene (a click on the screen plays it)
      Object.assign(st, { left: "0px", top: "0px", width: `${w}px`, height: `${h}px`, transformOrigin: "0 0", transform: quadTransform(w, h, quad!), pointerEvents: "none" });
    }
    st.visibility = "visible";
    if (view === "on" && was !== "on") frame.focus();
  }

  /** Draw slot n's screen as a hole in the canvas, or as itself again. */
  private hole(n: number, on: boolean): void {
    const screen = this.filled.get(n)?.cabinet.screen;
    if (!screen || on === this.holed.has(n)) return;
    if (on) {
      this.holed.set(n, screen.material!);
      screen.material = screenHoleMaterial(this.scene);
    } else {
      screen.material = this.holed.get(n)!;
      this.holed.delete(n);
    }
  }

  private geo(n: number): ScreenGeometry | null {
    let g = this.geos.get(n);
    const f = this.filled.get(n);
    if (!g && f) this.geos.set(n, (g = screenGeometry(f.cabinet.screen)));
    return g ?? null;
  }

  /**
   * A cabinet's screen on the page (top-left, top-right, bottom-right,
   * bottom-left) when its game may lie over it in perspective: the viewer is in
   * its room, in front of the whole screen, not seeing it edge on, with some of
   * it on the page and nothing in the way (the frame always draws on top of the
   * scene). Otherwise null.
   */
  private screenOnPage(n: number, r: Running): { x: number; y: number }[] | null {
    const s = store.get();
    const g = this.geo(n);
    const screen = this.filled.get(n)?.cabinet.screen;
    const cam = this.fly.camera;
    if (!g || !screen || s.help || s.refOverlay === "full" || this.fly.isOrtho) return null;
    if (roomAt(cam.position)?.id !== (screen.metadata as ScreenMeta).room) return null;
    const view = cam.getViewMatrix(true);
    if (g.corners.some((c) => Vector3.TransformCoordinates(c, view).z < cam.minZ)) return null;
    if (!HOLE && Vector3.Dot(cam.position.subtract(g.centre).normalize(), g.normal) < Math.cos(OVER.maxAngle)) return null;
    const [bl, br, tr, tl] = toPage(g.corners, this.scene, this.canvas);
    const quad = [tl, tr, br, bl];
    if (onPage(quad, this.canvas.getBoundingClientRect()) <= 0) return null;
    // seen through the scene, whatever is in front of the screen covers the game
    if (HOLE) return quad;
    // checked every few frames: rays are the costly part
    if (this.frames - r.clear.at >= 3) r.clear = { at: this.frames, ok: nothingInTheWay(this.scene, cam.position, screen, g) };
    return r.clear.ok ? quad : null;
  }

  /** Slot n's screen corners on the page (top-left, top-right, bottom-right, bottom-left), from the camera as it is now. */
  screenQuad(n: number): { x: number; y: number }[] | null {
    const g = this.geo(n);
    if (!g) return null;
    const [bl, br, tr, tl] = toPage(g.corners, this.scene, this.canvas);
    return [tl, tr, br, bl];
  }

  /** Where slot n's screen is on the page, in CSS pixels, from the camera as it is now. */
  screenRect(n: number): ScreenRect | null {
    const f = this.filled.get(n);
    return f ? pageRect(f.cabinet.screen, this.scene, this.canvas) : null;
  }

  /** The slot of the cabinet the walker can play: in reach of it (PLAY) and looking at it. */
  private cabinetAt(): number | null {
    const fwd = this.fly.camera.getDirection(Vector3.Forward());
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    let best: number | null = null;
    let bestD = Infinity;
    for (const n of this.filled.keys()) {
      const d = this.inReach(n);
      if (d === null || d >= bestD) continue;
      const c = this.filled.get(n)!.cabinet.screen.getAbsolutePosition();
      const feet = this.fly.walker!.feet;
      const dx = c.x - feet.x;
      const dz = c.z - feet.z;
      if ((fwd.x * dx + fwd.z * dz) / (fl * Math.hypot(dx, dz)) < Math.cos((55 * Math.PI) / 180)) continue; // looking away
      best = n;
      bestD = d;
    }
    return best;
  }

  /** How far out in front of slot n's screen the walker stands, when that is within reach to play it (PLAY); otherwise null. */
  private inReach(n: number): number | null {
    const walker = this.fly.walker;
    const cab = this.filled.get(n)?.cabinet;
    if (!walker || !cab) return null;
    const node = cab.root.parent as TransformNode;
    if (Math.abs(walker.feet.y - node.position.y) > 0.6) return null;
    const c = cab.screen.getAbsolutePosition();
    const dx = walker.feet.x - c.x;
    const dz = walker.feet.z - c.z;
    const front = node.getDirection(new Vector3(0, 0, -1));
    const ahead = dx * front.x + dz * front.z;
    const aside = Math.abs(dx * front.z - dz * front.x);
    return ahead > 0 && ahead <= PLAY.ahead && aside <= PLAY.aside ? ahead : null;
  }

  /** A canvas click in walk mode on a cabinet's screen within reach plays it. */
  click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().focus) return false;
    const hit = pickAt(this.scene, this.canvas, e);
    const md = hit?.mesh.metadata as Partial<ScreenMeta> | undefined;
    if (!hit || md?.role !== ROLE.cabinetScreen || md.slot === undefined || this.inReach(md.slot) === null) return false;
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
