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
// Who is at each cabinet is shared through the room server (engine/room.ts):
// its seat, one topic per slot ("arcade/seat/<slot>"), saying who plays it,
// under the name their game was given, and whether their game is in yet. A
// cabinet is one visitor's at a time, as at a real arcade: walking up to one in
// use says who has it. Its seat is freed when the game quits (Quit, left alone
// too long, or failed) or its player leaves (their page closed: onGone).
//
// Everyone else sees the game at an occupied cabinet live on its screen, as they
// walk about, from any angle, as they would someone playing in an arcade: it is
// ChimpVibe's spectator mode (engine/embed.ts) following the player, muted and
// taking no keys or clicks, in a frame of its own laid under the canvas through
// the screen's hole, as the player's own game is when they step back. Watching
// costs a running game in the page, so only cabinets in view with some of the
// screen unblocked are watched: anywhere in their own room, however far (it is
// one room), or from outside it within WATCH's reach. The biggest on the page
// (the nearest) come first, up to WATCH's max at once (fewer at lower quality,
// and while the computer is struggling today's fewer still, and only near
// ones): the nearer half at the game's full frame size, the rest at a smaller
// one (the game's own frame rate can't be lowered from here); one out of view a
// few seconds goes. Once a game shows on its screen it stays there, constantly:
// if its spectator drops (the game ended for it, nobody playing for a moment), the
// frame stays up and a fresh one loads hidden behind it and takes its place once
// it shows, so the screen never goes back to the art while its player is at it.
// Before a game first shows (loading), and where it can't (the game refuses
// spectators, it never showed within WATCH_MS, or the cabinet isn't among those
// watched), the cabinet shows its art, never blank.
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
import { ROOMS, levelAt, roomAt } from "../world/layout";
import { SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { Cabinet, buildCabinet } from "../world/props/cabinet";
import { ROLE, ScreenMeta, findAll } from "../world/roles";
import { FlyCamera, Pose } from "./flyCamera";
import { ScreenFocus, ScreenGeometry, nothingInTheWay, onPage, pageRect, partlyInSight, pickAt, quadTransform, screenGeometry, screenHoleMaterial, squarePose, toPage } from "./focus";
import { ArcadeGame, GameList, loadGameList } from "./gameList";
import { EmbedErrorCode, EmbedMessage, asSpectator, inEmbedMode, parseEmbedMessage } from "./embed";
import { LOAD_MS, pageProblem } from "./pageCheck";
import { Lighting } from "./lighting";
import { ME, room } from "./room";
import { Quality, ScreenRect, WatchedGame, store } from "./store";

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

/**
 * Other visitors' games, watched live on their cabinets' screens, by quality:
 * how many at once in the cabinet's room (`max`: the nearest first; the nearer
 * half at `width`, the rest at `farWidth`), and, from outside its room, how far
 * away (`dist`, m). Each frame's own width is in CSS px; a transform maps it onto
 * the screen, and ChimpVibe's spectator view works down to about 480 px, so
 * that is as small as a far one goes. While the computer is struggling today's
 * limits hold: `slowMax`, and `dist` in the room too.
 */
const WATCH: Record<Quality, { max: number; slowMax: number; dist: number; width: number; farWidth: number }> = {
  high: { max: 6, slowMax: 2, dist: 14, width: 640, farWidth: 480 },
  medium: { max: 4, slowMax: 1, dist: 11, width: 560, farWidth: 480 },
  low: { max: 2, slowMax: 1, dist: 8, width: 480, farWidth: 480 },
};
/** A cabinet showing its game counts as this much bigger on the page than it is when the nearest are chosen, so two alike don't trade places. */
const WATCH_STICKY = 1.3;
/** A frame's size (full or smaller) changes only once its cabinet has been in the other class this long. */
const WATCH_TIER_MS = 2500;
/** How long a watched game may take to say it is showing; then it is given up on, and tried again after WATCH_FAILED_MS. */
const WATCH_MS = 15_000;
const WATCH_FAILED_MS = 20_000;
/** How long before a watched game refused because its player's game wasn't in yet (or dropped) is tried again. */
const WATCH_RETRY_MS = 3000;
/** From outside the cabinet's room, its games are watched from no further than this from the room's outline (m): the doorway, not the next room. */
const WATCH_DOORWAY = 3;
/** How long a watched game's frame stays, hidden, once its cabinet is out of view: a glance away doesn't reload it. */
const WATCH_LINGER_MS = 5000;
/**
 * How long a watched game stays chosen, and showing, through its screen being out of sight or too small: a
 * blink (a sight check missing it, a step past the size limit) doesn't take the game off its screen. Hidden
 * longer, it is chosen as any other cabinet is again (its frame staying, hidden, up to WATCH_LINGER_MS).
 */
const WATCH_BLINK_MS = 1500;
/** A screen smaller than this on the page (CSS px high) isn't worth starting to watch (a cabinet 15 m off is ~16 px at 800 px high); one already watched is kept down to WATCH_KEEP_PX. */
const WATCH_MIN_PX = 12;
const WATCH_KEEP_PX = 9;

/** Who is at a cabinet, as every visitor shares it; null: nobody. */
export type Seat = {
  id: string;
  /** the name their game was given: whom a spectator follows */
  name: string;
  gameId: string;
  /** their game has said it is ready: from then it can be watched */
  ready: boolean;
  /** they stepped back, leaving it running */
  away: boolean;
} | null;

/** One try at watching a game: a spectator frame, following the player. */
interface Feed {
  key: string;
  url: string;
  /** when it started loading (performance.now()) */
  since: number;
  frame: HTMLIFrameElement | null;
}

/**
 * Another visitor's game at a cabinet, watched live. `live` is the frame that
 * has said it is showing: it stays up from then on, so the screen never goes
 * back to the cabinet's art while its player is at it. When it drops (its
 * spectator says the game ended, or nobody is playing), it stays up, `stale`,
 * and a fresh try (`next`) loads hidden behind it, replacing it once it says it
 * is showing. Before any frame has shown, `next` is the first try, and the
 * cabinet's art shows until it does; a try that fails waits until `until`
 * (Infinity: never again, for a game that refuses spectators).
 */
interface Watched {
  seat: NonNullable<Seat>;
  live: Feed | null;
  next: Feed | null;
  /** the live frame dropped: a fresh try replaces it as soon as one shows */
  stale: boolean;
  /** with no try loading: why the last one ended ("waiting": nobody playing yet, or it dropped; "failed": refused, or it never showed) and when to try again (performance.now()) */
  lastEnd: "waiting" | "failed";
  until: number;
  /** tries in a row that came to nothing, for backing off while a stale frame stays up */
  misses: number;
  /** how many times a fresh frame has replaced the one showing, for tests */
  swaps: number;
  /** when its cabinet was last in view and chosen to be watched (performance.now()) */
  wanted: number;
  view: "hidden" | "over";
  /** why it isn't showing, or why its frame is stale, for tests */
  note: string | null;
  /** the frame's size class now, the one it should be in, and since when that has been so (performance.now()) */
  tier: "near" | "far";
  tierWant: "near" | "far";
  tierAt: number;
}

type Pt = { x: number; y: number };

/** How far p is from a room's outline, on the floor plan (m). */
function outlineDistance(p: { x: number; z: number }, loop: { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz));
  }
  return best;
}

/** Where a running game's frame is: hidden (still running), over its screen in perspective, or square on while it is played. */
type View = "hidden" | "over" | "on";

interface Running {
  game: ArcadeGame;
  /** the address its frame loads: the game in embed mode, joined under this visitor's name (whom spectators follow) */
  url: string;
  /** the page has said it is ready (embed mode): the game is in, and others can watch it */
  ready: boolean;
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
  /** who is at each cabinet, by slot, as the room has it, and the setters for each slot's seat */
  private seats = new Map<number, NonNullable<Seat>>();
  private sendSeat = new Map<number, (seat: Seat) => void>();
  /** other visitors' games, watched live on their cabinets' screens, by slot */
  private watched = new Map<number, Watched>();
  private watchTries = 0;
  /** whether some of each screen can be seen, last checked at frame `at` */
  private sight = new Map<number, { at: number; ok: boolean }>();
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
    // who is at each cabinet, shared; a visitor who leaves (their page closed, or their connection stayed down) frees theirs
    for (const node of this.slots) {
      const n = slotNo(node);
      this.sendSeat.set(n, room.share<Seat>(`arcade/seat/${n}`, null, (seat) => this.seated(n, seat)));
    }
    room.onGone((id) => {
      for (const [n, seat] of this.seats) if (seat.id === id) this.sendSeat.get(n)!(null);
    });
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
        this.unwatch(n);
        this.geos.delete(n);
        this.broken.delete(n);
        this.lighting.removeCasters(have.cabinet.casters);
        have.cabinet.dispose();
        this.filled.delete(n);
        changed = true;
      }
      if (game) {
        const cabinet = buildCabinet(this.mats, node, game);
        const seat = this.seats.get(n);
        if (seat && seat.id !== ME.id) cabinet.inUse(seat.name);
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
      // someone else's cabinet: the prompt says who has it, and E doesn't play it
      const seat = at === null ? undefined : this.seats.get(at);
      const taken = seat && seat.id !== ME.id ? { by: seat.name, away: seat.away } : undefined;
      const outOfOrder = at !== null && !taken && this.broken.has(at);
      const full = outOfOrder && this.broken.get(at!)!.code === "full";
      const was = s.arcadePrompt;
      if ((at ?? null) !== (was?.slot ?? null) || outOfOrder !== !!was?.outOfOrder || full !== !!was?.full || taken?.by !== was?.taken?.by || taken?.away !== was?.taken?.away)
        store.set({ arcadePrompt: at === null ? null : { slot: at, name: this.filled.get(at)!.game.name, outOfOrder, full, ...(taken ? { taken } : {}) } });
    }
    for (const [n, r] of this.running) this.place(n, r);
    this.minding();
    this.watching();
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
    if (changed) {
      this.publish();
      // the seat says whether its player is at the cabinet
      for (const [n, r] of this.running) if (this.seats.get(n)?.id === ME.id && this.seats.get(n)!.away !== (r.awaySince !== null)) this.sendSeat.get(n)!(this.mySeat(r));
    }
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
    const seat = this.seats.get(n);
    if (seat && seat.id !== ME.id && !this.running.has(n)) {
      // the prompt already says who is playing it; a click from further off is told
      if (store.get().arcadePrompt?.slot !== n) this.say(`${seat.name} is playing ${f.game.name}${seat.away ? " (stepped away, leaving it running)" : ""}`);
      return false;
    }
    if (!this.running.has(n)) {
      if (this.broken.delete(n)) f.cabinet.outOfOrder(null);
      this.unwatch(n);
      const r: Running = { game: f.game, url: inEmbedMode(f.game.playUrl, ME.name), ready: false, frame: null, view: "hidden", clear: { at: -100, ok: false }, awaySince: null, loading: null, verified: false };
      this.running.set(n, r);
      // the cabinet is this visitor's
      this.sendSeat.get(n)?.(this.mySeat(r));
      this.publish();
      void this.verify(n, r);
    }
    this.playingSlot = n;
    this.fovBefore = this.fly.camera.fov;
    const { game } = f;
    store.set({ arcadePrompt: null });
    const info = { kind: "cabinet", slot: n, gameId: game.gameId, name: game.name, author: game.author, url: this.running.get(n)!.url } as const;
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
    // the cabinet is free again
    if (this.seats.get(slot)?.id === ME.id) this.sendSeat.get(slot)?.(null);
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
    if (msg.type === "ready" && !r.ready && this.running.get(n) === r) {
      // the game is in: others can watch it now
      r.ready = true;
      if (this.seats.get(n)?.id === ME.id) this.sendSeat.get(n)?.(this.mySeat(r));
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
        url: r.url,
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

  // ---------------------------------------------------------------- who is at each cabinet

  /** This visitor's seat at a cabinet whose game they run. */
  private mySeat(r: Running): NonNullable<Seat> {
    return { id: ME.id, name: ME.name, gameId: r.game.gameId, ready: r.ready, away: r.awaySince !== null };
  }

  /** The room says who is at slot n now (this visitor's own change, or another's). */
  private seated(n: number, seat: Seat): void {
    // the room still holds a seat for a visitor who left before this page was listening (everyone else
    // had gone too, so nobody freed it): it is free, for everyone
    if (seat && seat.id !== ME.id && room.hasLeft(seat.id)) return this.sendSeat.get(n)?.(null);
    if (seat) this.seats.set(n, seat);
    else this.seats.delete(n);
    const f = this.filled.get(n);
    const other = seat && seat.id !== ME.id ? seat : null;
    f?.cabinet.inUse(other?.name ?? null);
    const r = this.running.get(n);
    if (r && other) {
      // two took the cabinet at once, and the room gave it to the other
      void this.quit(n);
      this.say(`${other.name} got to ${r.game.name} first`);
    } else if (r && !seat) {
      // freed while this visitor's game still runs there (a page that left took the wrong seat with it): take it back
      queueMicrotask(() => this.running.get(n) === r && !this.seats.has(n) && this.sendSeat.get(n)?.(this.mySeat(r)));
    }
    // someone else's game works there: it is no longer out of order for this visitor either
    if (other?.ready && this.broken.delete(n)) f?.cabinet.outOfOrder(null);
    const w = this.watched.get(n);
    if (w && (!other || other.id !== w.seat.id || other.gameId !== w.seat.gameId || !other.ready)) this.unwatch(n);
    else if (w && other) w.seat = other;
  }

  // ---------------------------------------------------------------- other visitors' games, live on their screens

  /** How many games may be watched at once, how far from outside their room, and how big their frames are, at the quality the page runs at. */
  private watchLimits(): { max: number; near: number; dist: number; roomDist: number; width: number; farWidth: number } {
    const s = store.get();
    const q = WATCH[s.quality] ?? WATCH.high;
    // a computer that is struggling keeps today's limits: fewer games, and none beyond `dist` even in their room
    if (s.renderScaleAuto) return { max: q.slowMax, near: q.slowMax, dist: q.dist, roomDist: q.dist, width: q.width, farWidth: q.farWidth };
    return { max: q.max, near: Math.ceil(q.max / 2), dist: q.dist, roomDist: Infinity, width: q.width, farWidth: q.farWidth };
  }

  /**
   * Each frame: choose the other visitors' games to watch (the biggest on the
   * page, up to the limit), start and end their frames, try again those that
   * dropped or failed when it is time, and place each on its screen. A screen
   * showing its game stays up until the one chosen in its place shows. The
   * nearer half of those showing get the full frame size; the rest a smaller one, changed only
   * after WATCH_TIER_MS in the other class so a cabinet at the boundary doesn't
   * keep resizing its game (a new size only resizes the frame: it never reloads).
   * A game already watched stays a candidate (and shows) through a blink out
   * of sight or too small (WATCH_BLINK_MS), as long as its cabinet passes the
   * room and distance rules and its screen is on the page; its frame goes once
   * it hasn't been seen for WATCH_LINGER_MS.
   */
  private watching(): void {
    const now = performance.now();
    const lim = this.watchLimits();
    const s = store.get();
    const seen: { n: number; d: number; size: number; inSight: boolean }[] = [];
    for (const [n, seat] of this.seats) {
      if (seat.id === ME.id || !seat.ready || this.running.has(n) || this.filled.get(n)?.game.gameId !== seat.gameId) continue;
      const v = this.watchable(n, lim);
      const w = this.watched.get(n);
      const framed = !!w && !!(w.live || w.next);
      if (!v || (!v.inSight && !(framed && now - w!.wanted < WATCH_BLINK_MS))) continue;
      // the page area the screen covers, as a length; one showing its game counts for more, so ties don't flip (only one
      // showing: frames kept hidden for a glance away, or loading, would otherwise tie with those showing)
      seen.push({ n, d: v.d, size: v.size * (w?.view === "over" ? WATCH_STICKY : 1), inSight: v.inSight });
    }
    seen.sort((a, b) => b.size - a.size);
    // chosen: the biggest, up to the limit, each with a frame (showing, or a try loading)
    const chosen: number[] = [];
    for (const { n, inSight } of seen) {
      let w = this.watched.get(n);
      // one waiting to try again with nothing to show keeps its place without a frame (the cabinet's art shows)
      if (w && !w.live && !w.next) {
        w.wanted = now;
        continue;
      }
      if (chosen.length >= lim.max) continue;
      if (!w) w = this.watch(n, this.seats.get(n)!, chosen.length < lim.near ? "near" : "far");
      if (inSight) w.wanted = now;
      chosen.push(n);
    }
    // shown: the chosen games that are showing; and, while a chosen one is still loading, a game showing that it would
    // take the place of stays up until it shows (so a try that comes to nothing, tried again and again, never blinks a
    // screen that is showing its game to the art)
    const shown: number[] = chosen.filter((n) => this.watched.get(n)!.live);
    for (const { n, inSight } of seen) {
      if (shown.length >= lim.max) break;
      const w = this.watched.get(n);
      // (only one showing now: one already back to its art isn't brought back for a moment)
      if (!w?.live || w.view !== "over" || shown.includes(n)) continue;
      shown.push(n);
      if (inSight) w.wanted = now;
    }
    // the nearer half of those showing get the full frame size (a try loading, by its place among the chosen)
    const rank = new Map(seen.map((c, i) => [c.n, i]));
    shown.sort((a, b) => rank.get(a)! - rank.get(b)!);
    const tierOf = (n: number): "near" | "far" => ((shown.includes(n) ? shown.indexOf(n) : chosen.indexOf(n)) < lim.near ? "near" : "far");
    for (const n of new Set([...chosen, ...shown])) {
      const w = this.watched.get(n)!;
      const want = tierOf(n);
      if (w.tierWant !== want) Object.assign(w, { tierWant: want, tierAt: now });
      if (w.tier !== w.tierWant && now - w.tierAt >= WATCH_TIER_MS) w.tier = w.tierWant;
    }
    for (const [n, w] of this.watched) {
      if (now - w.wanted > WATCH_LINGER_MS) {
        this.unwatch(n);
        continue;
      }
      // a try that doesn't say it is showing in time is given up on (a frame already showing stays up meanwhile)
      if (w.next && now - w.next.since > WATCH_MS) this.missed(w, "failed", "it didn't show in time", now);
      // the first try, or a fresh one behind a frame that dropped, when it is time
      if (!w.next && (w.stale || !w.live) && now >= w.until) w.next = this.feed(n, w, now);
    }
    // frames kept for a glance away, beyond those chosen and shown: one, the most recently chosen; the rest go
    const keep = new Set([...chosen, ...shown]);
    const lingering = [...this.watched].filter(([n, w]) => (w.live || w.next) && !keep.has(n)).sort((a, b) => b[1].wanted - a[1].wanted);
    for (const [n] of lingering.slice(1)) this.unwatch(n);
    this.publishWatched();
    for (const [n, w] of this.watched) this.placeWatched(n, w, !s.focus && w.live?.frame && shown.includes(n) ? this.quadOf(n) : null, w.tier === "near" ? lim.width : lim.farWidth);
  }

  /** Start watching the player at slot n: a first try, its frame hidden until it says it is showing. */
  private watch(n: number, seat: NonNullable<Seat>, tier: "near" | "far"): Watched {
    const now = performance.now();
    const w: Watched = { seat, live: null, next: null, stale: false, lastEnd: "waiting", until: 0, misses: 0, swaps: 0, wanted: now, view: "hidden", note: null, tier, tierWant: tier, tierAt: now };
    w.next = this.feed(n, w, now);
    this.watched.set(n, w);
    return w;
  }

  /** A new try at watching slot n's game: a frame of its own, following its player. */
  private feed(n: number, w: Watched, now: number): Feed {
    const playUrl = this.filled.get(n)?.game.playUrl ?? "";
    return { key: `${w.seat.gameId}:${w.seat.id}:${++this.watchTries}`, url: asSpectator(playUrl, w.seat.name), since: now, frame: null };
  }

  /**
   * The try loading for a watched game came to nothing: its frame goes, and
   * another is made at `until`. With a frame still up (stale) the tries come
   * soon, backing off; with none, the cabinet's art shows meanwhile.
   */
  private missed(w: Watched, end: Watched["lastEnd"], note: string, now: number): void {
    w.misses++;
    const wait = w.live ? Math.min(WATCH_RETRY_MS * 2 ** (w.misses - 1), WATCH_FAILED_MS) : end === "waiting" ? WATCH_RETRY_MS : WATCH_FAILED_MS;
    Object.assign(w, { next: null, lastEnd: end, note, until: now + wait });
  }

  /** Stop watching slot n: its frames go, and the screen shows itself again. */
  private unwatch(n: number): void {
    if (!this.watched.delete(n)) return;
    this.hole(n, false);
    this.publishWatched();
  }

  /** The frames of watched games, in the page (ui/PlayOverlay.tsx): the one showing and the one loading behind it. */
  private publishWatched(): void {
    const want: WatchedGame[] = [];
    for (const [slot, w] of this.watched)
      for (const f of [w.live, w.next]) if (f) want.push({ slot, key: f.key, url: f.url, name: w.seat.name, game: this.filled.get(slot)?.game.name ?? "" });
    const was = store.get().arcadeWatched;
    if (want.length !== was.length || want.some((g, i) => g.key !== was[i].key)) store.set({ arcadeWatched: want });
  }

  /**
   * Slot n's cabinet, when another visitor's game there is worth watching from
   * here: the camera is in front of the screen with some of it on the page, big
   * enough to see and not wholly blocked (checked every few frames), and either
   * in the cabinet's room (`roomDist` away at most: any, normally, the room being
   * one room) or on its level within `dist`, as in the doorway. Its distance,
   * size on the page (the square root of its area, CSS px) and whether it is big
   * enough and in sight; or null when the rules or the camera rule it out.
   */
  private watchable(n: number, lim: { dist: number; roomDist: number }): { d: number; size: number; inSight: boolean } | null {
    const g = this.geo(n);
    const screen = this.filled.get(n)?.cabinet.screen;
    const cam = this.fly.camera;
    if (!g || !screen) return null;
    const meta = screen.metadata as ScreenMeta;
    const d = Vector3.Distance(cam.position, g.centre);
    if (levelAt(cam.position.y) !== meta.level) return null;
    if (roomAt(cam.position)?.id === meta.room) {
      if (d > lim.roomDist) return null;
    } else if (d > lim.dist || outlineDistance(cam.position, ROOMS.find((r) => r.id === meta.room && r.level === meta.level)?.loop ?? []) > WATCH_DOORWAY) return null;
    const quad = this.quadOf(n);
    if (!quad) return null;
    const ys = quad.map((p) => p.y);
    const big = Math.max(...ys) - Math.min(...ys) >= (this.watched.has(n) ? WATCH_KEEP_PX : WATCH_MIN_PX);
    // the checks are spread over the frames, not all on the same one
    let c = this.sight.get(n);
    if (big && (!c || this.frames - c.at >= 10)) this.sight.set(n, (c = { at: this.frames + (c ? 0 : n % 5), ok: partlyInSight(this.scene, cam.position, screen, g) }));
    let area = 0;
    quad.forEach((p, i) => {
      const q = quad[(i + 1) % 4];
      area += p.x * q.y - q.x * p.y;
    });
    return { d, size: Math.sqrt(Math.abs(area) / 2), inSight: big && !!c?.ok };
  }

  /**
   * Slot n's screen on the page (top-left, top-right, bottom-right,
   * bottom-left), when the camera is in front of it with some of it on the
   * page; otherwise null. What stands in front of it isn't checked: it covers
   * the screen's hole as it would the screen.
   */
  private quadOf(n: number): Pt[] | null {
    const s = store.get();
    const g = this.geo(n);
    const cam = this.fly.camera;
    if (!g || s.help || s.refOverlay === "full" || this.fly.isOrtho) return null;
    if (Vector3.Dot(cam.position.subtract(g.centre), g.normal) <= 0) return null;
    const view = cam.getViewMatrix(true);
    if (g.corners.some((c) => Vector3.TransformCoordinates(c, view).z < cam.minZ)) return null;
    const [bl, br, tr, tl] = toPage(g.corners, this.scene, this.canvas);
    const quad = [tl, tr, br, bl];
    return onPage(quad, this.canvas.getBoundingClientRect()) > 0 ? quad : null;
  }

  /**
   * Place a watched game's frames for this frame: the one showing it in
   * perspective under the canvas, through its screen's hole, while its screen
   * is on the page (`quad`), or hidden, the screen showing the cabinet's art;
   * one loading behind it hidden, at the same size, ready to take its place.
   */
  private placeWatched(n: number, w: Watched, quad: Pt[] | null, width: number): void {
    const show = !!quad && !!w.live?.frame;
    w.view = show ? "over" : "hidden";
    this.hole(n, show);
    const g = this.geo(n);
    const h = g ? Math.round((width * g.height) / g.width) : 0;
    const next = w.next?.frame?.style;
    if (next) Object.assign(next, { left: "0px", top: "0px", width: `${width}px`, height: `${h}px`, zIndex: "0", pointerEvents: "none", visibility: "hidden" });
    const st = w.live?.frame?.style;
    if (!st) return;
    if (!show) {
      st.visibility = "hidden";
      return;
    }
    Object.assign(st, { left: "0px", top: "0px", width: `${width}px`, height: `${h}px`, transformOrigin: "0 0", transform: quadTransform(width, h, quad!), zIndex: "0", pointerEvents: "none", visibility: "visible" });
  }

  /** A watched game's frame is in the page (ui/PlayOverlay.tsx), or has left it. */
  attachWatched(slot: number, key: string, el: HTMLIFrameElement): void {
    const w = this.watched.get(slot);
    for (const f of [w?.live, w?.next]) if (f?.key === key) f.frame = el;
  }

  detachWatched(slot: number, key: string, el: HTMLIFrameElement): void {
    const w = this.watched.get(slot);
    for (const f of [w?.live, w?.next]) if (f?.key === key && f.frame === el) f.frame = null;
  }

  /**
   * A message from a watched game's frame (ui/PlayOverlay.tsx checks it came
   * from that frame and the game's origin). A try that says it is showing
   * takes the screen, replacing a frame that dropped. A frame showing that
   * drops (the game ended for it, or nobody is playing) stays up, and a fresh
   * try loads behind it at once; a try that is refused goes, and another comes
   * shortly. A game that refuses spectators isn't asked again while this player
   * is at it: its cabinet shows its art. Its player being away shows in
   * ChimpVibe's own view, which says so.
   */
  receiveWatched(slot: number, key: string, data: unknown): void {
    const w = this.watched.get(slot);
    const msg = parseEmbedMessage(data);
    if (!w || !msg) return;
    const feed = w.live?.key === key ? "live" : w.next?.key === key ? "next" : null;
    if (!feed) return;
    const now = performance.now();
    if (msg.type === "ready") {
      if (feed === "next") {
        if (w.live) w.swaps++;
        Object.assign(w, { live: w.next, next: null, stale: false, misses: 0, note: null });
      }
    } else if (msg.type === "error" && msg.code === "no-spectators") {
      Object.assign(w, { live: null, next: null, stale: false, lastEnd: "failed", note: `${msg.code}: ${msg.reason}`, until: Infinity });
    } else if (msg.type === "ended" || msg.type === "error") {
      const nobody = msg.type === "ended" || msg.code === "no-players";
      const note = msg.type === "ended" ? `ended: ${msg.reason}` : msg.code === "no-players" ? "nobody playing yet" : `${msg.code}: ${msg.reason}`;
      if (feed === "live") {
        Object.assign(w, { stale: true, note });
        if (!w.next) w.until = now;
      } else this.missed(w, nobody ? "waiting" : "failed", note, now);
    }
    this.publishWatched();
  }

  /** Who is at each cabinet, as the room has it: for tests. */
  seatList(): { slot: number; id: string; name: string; gameId: string; ready: boolean; away: boolean }[] {
    return [...this.seats].sort((a, b) => a[0] - b[0]).map(([slot, seat]) => ({ slot, ...seat }));
  }

  /**
   * Seat other visitors (made up: nobody's page) at slots as if the room had said so, each
   * following the player named (null: the slot is free again), their games in: for tests of
   * many cabinets in use, with one real player's game for all the spectators to follow.
   */
  testSeats(seats: { slot: number; name: string | null }[]): void {
    for (const { slot, name } of seats) {
      const game = this.filled.get(slot)?.game;
      this.seated(slot, name && game ? { id: `test-${slot}`, name, gameId: game.gameId, ready: true, away: false } : null);
    }
  }

  /**
   * The other visitors' games being watched, and how each is doing: for tests. `state` is live
   * while a frame shows the game (`stale`: it dropped, and a fresh try loads behind it), loading
   * for a first try, else why the last try ended; `swaps` counts fresh frames that replaced one showing.
   */
  watchedGames(): { slot: number; key: string; next: string | null; name: string; state: "live" | "loading" | Watched["lastEnd"]; stale: boolean; swaps: number; view: Watched["view"]; note: string | null; framed: boolean; tier: Watched["tier"]; width: number }[] {
    const lim = this.watchLimits();
    return [...this.watched].map(([slot, w]) => ({
      slot,
      key: (w.live ?? w.next)?.key ?? "",
      next: w.live ? w.next?.key ?? null : null,
      name: w.seat.name,
      state: w.live ? "live" : w.next ? "loading" : w.lastEnd,
      stale: w.stale,
      swaps: w.swaps,
      view: w.view,
      note: w.note,
      framed: !!(w.live ?? w.next)?.frame,
      tier: w.tier,
      width: w.tier === "near" ? lim.width : lim.farWidth,
    }));
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
    const fwd = this.fly.aim;
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
