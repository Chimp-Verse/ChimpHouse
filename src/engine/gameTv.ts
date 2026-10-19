// The Game Room TV: ChimpVibe games played from the couch.
//
// Game controllers and a remote lie on the coffee table (spots found by role,
// world/roles.ts; engine/handhelds.ts). Whoever holds the remote chooses a game
// from ChimpVibe's catalogue. Whoever picks up a controller sits down: the
// camera glides square onto the TV, close enough that it fills the view, and
// the game is loaded for them as a player. Choosing a game loads it for
// everyone holding a controller; putting the controller down ends their game
// and stands them up again.
//
// A player's game is ChimpVibe's play page in embed mode, joined under their
// name, in an iframe laid exactly over the TV (browsers don't let another
// site's page be drawn onto a 3D surface). In the room the TV shows the game's
// card, saying who is playing (world/props/tvScreen.ts).
//
// The players see each other, and the room sees them, through ChimpVibe's
// spectator mode (engine/embed.ts): a browser can't see into another player's
// game, so each other player's game is a frame of its own, watching the game
// and following that player. A seated player's TV is split between the players
// in controller order: their own game in their part, each other player's
// followed in theirs. Anyone else in the Game Room sees every player's part on
// the TV as they walk about, in perspective, as a game running at a cabinet
// shows on its screen (engine/arcade.ts): the parts lie under the 3D canvas and
// the TV's screen is drawn as a hole in it, so they show exactly where the
// screen can be seen. Facing the TV and pressing E watches it square on. A part
// refused because nobody plays yet, or whose watching ended, tries again.
//
// A game that fails to connect fails only for the player who saw it fail: their
// game closes and their TV shows static with "Failed to connect" until the TV
// is turned off with the remote; the other players play on, and the room sees
// the TV as before. As at
// an arcade cabinet (engine/arcade.ts), a failure is ChimpVibe's play page
// saying so in embed mode (an "error" message), or ChimpHouse's own check as
// the game starts (engine/pageCheck.ts: ChimpVibe doesn't answer, the page is
// an error or refuses to show here, or it never loads). Until the check passes,
// or the page says it is ready, a player's game stays hidden, so a broken page
// is never seen.
//
// What the TV is doing is one object visitors share, the store's `tv`: the
// game, who holds each controller and who holds the remote. It goes through
// the room (engine/room.ts), so a few pages, in one browser or on several
// computers, make a couch of players.

import { DynamicTexture, Material, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { makeCanvas, toTexture } from "../world/materials/canvas";
import { Materials } from "../world/materials/library";
import { buildGamepad } from "../world/props/gamepad";
import { buildRemote } from "../world/props/remote";
import { TvCard, drawTvCard } from "../world/props/tvScreen";
import { ROLE, find } from "../world/roles";
import { EmbedMessage, asSpectator, inEmbedMode, parseEmbedMessage } from "./embed";
import { FlyCamera, Pose } from "./flyCamera";
import { ScreenFocus, ScreenGeometry, nothingInTheWay, onPage, pickAt, quadTransform, screenGeometry, screenHoleMaterial, squarePose, toPage } from "./focus";
import { loadTvCatalog } from "./gameList";
import { Handhelds } from "./handhelds";
import { Lighting } from "./lighting";
import { LOAD_MS, pageProblem } from "./pageCheck";
import { ME, room } from "./room";
import { ScreenRect, TvFrame, TvPane, TvState, store } from "./store";

/** Room round the TV while seated for the frame of UI (CSS px): its bar above, the one below, and either side. */
const MARGIN = { top: 64, bottom: 64, side: 36 };
const GLIDE_IN = 1.1;
const GLIDE_OUT = 0.9;
/** How near the TV, and how squarely looking at it, a walker must be for E to watch it. */
const WATCH_REACH = 7;
const LOOK = Math.cos((35 * Math.PI) / 180);
/** How long a watched part waits before trying again, when nobody was playing or its connection dropped. */
const RETRY_MS = 3000;
/** The line between the parts of a split screen, as a share of the TV's width (the same thickness both ways). */
const DIVIDER = 0.003;
/** The TV's shape, width over height. */
const TV_ASPECT = 16 / 9;
/** The TV's picture as a walker sees it: its own width (CSS px; a transform maps it onto the screen). */
const SURFACE_W = 960;

/**
 * The TV's parts for `n` players, in controller order, as shares of the TV
 * (0–1), split as a console's split screen is: the whole TV for one; two side by
 * side, each the TV's full height (a game fills a tall part by showing more of
 * its world up and down); a quarter each for three or four, the fourth quarter
 * left over for three (spareTvPart). Parts reach the TV's edges, with a thin
 * line between them.
 */
export function tvParts(n: number): ScreenRect[] {
  if (n <= 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  const gx = DIVIDER / 2;
  const gy = (DIVIDER * TV_ASPECT) / 2;
  const half = (i: number, g: number) => ({ at: i ? 0.5 + g : 0, size: 0.5 - g });
  if (n === 2) return [0, 1].map((i) => ({ x: half(i, gx).at, y: 0, w: half(i, gx).size, h: 1 }));
  return Array.from({ length: Math.min(n, 4) }, (_, i) => {
    const col = half(i % 2, gx);
    const row = half(Math.floor(i / 2), gy);
    return { x: col.at, y: row.at, w: col.size, h: row.size };
  });
}

/** The quarter no one plays in, with three players (the game's card shows there), or null. */
export function spareTvPart(n: number): ScreenRect | null {
  return n === 3 ? tvParts(4)[3] : null;
}

/** A part (shares of the TV) on the page, for the TV at `r`. */
function partOn(r: ScreenRect, p: ScreenRect): ScreenRect {
  return { x: r.x + p.x * r.w, y: r.y + p.y * r.h, w: p.w * r.w, h: p.h * r.h };
}

/** A watched part's frame, once in the page. */
interface PaneEl {
  el: HTMLIFrameElement;
  /** it said it is showing (ready): from then it may show, unless it failed */
  ready: boolean;
  /** until it says it is ready, the timer that fails it; then, the one that tries again */
  timer: ReturnType<typeof setTimeout> | null;
}
export class GameTv {
  readonly screen: Mesh | null;
  readonly controllers: Handhelds;
  readonly remote: Handhelds;
  private geo: ScreenGeometry | null;
  private tex: DynamicTexture | null = null;
  private art: { url: string; img: HTMLImageElement | null } | null = null;
  private setShared: (tv: TvState) => void;
  /** this visitor's game's frame, once in the page: whether it is showing, and until its page has loaded, the timer that fails it */
  private placed: { key: string; el: HTMLIFrameElement; on: boolean; loading: ReturnType<typeof setTimeout> | null } | null = null;
  /** frames drawn, for the static's pace, and times the TV's picture was drawn */
  private frames = 0;
  private drawn = 0;
  /** where the player stood before sitting down: standing up glides back there */
  private back: Pose | null = null;
  /** the watched parts' frames in the page, by pane key */
  private paneEls = new Map<string, PaneEl>();
  /** how many times each watched part has tried again, by controller and name */
  private retries = new Map<string, number>();
  /** whether the TV can be seen from here, as last checked (every few frames) */
  private clear = { frame: -99, ok: false };
  /** the TV's picture of watched parts (ui/TvOverlay.tsx), once in the page; and the TV's own material while its screen is a hole */
  private surface: HTMLElement | null = null;
  private holedMat: Material | null = null;

  constructor(
    private scene: Scene,
    mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    private focus: ScreenFocus,
    private canvas: HTMLCanvasElement,
    /** tells the visitor something briefly */
    private flash: (msg: string) => void,
  ) {
    this.screen = find(scene, ROLE.gameTvScreen) as Mesh | null;
    this.geo = this.screen && screenGeometry(this.screen);
    if (this.screen) {
      // the TV shows cards drawn here from now on
      this.tex = toTexture(scene, "gameTv", makeCanvas(1280, 720).canvas, { wrap: false }) as DynamicTexture;
      this.screen.material = mats.unlit("gameTv", { tex: this.tex, intensity: 1.1 });
    }
    this.controllers = new Handhelds(scene, lighting, fly, canvas, ROLE.gameTvControllerSpot, ROLE.gameTvController, (spot, n) => buildGamepad(mats, spot, n));
    this.remote = new Handhelds(scene, lighting, fly, canvas, ROLE.gameTvRemoteSpot, ROLE.gameTvRemote, (spot, n) => buildRemote(mats, spot, n, { label: "TV remote", role: ROLE.gameTvRemote }));
    const initial: TvState = { game: null, run: 0, controllers: this.controllers.spots.map(() => null), seats: this.controllers.spots.map(() => null), remote: null };
    store.set({ tv: initial });
    this.setShared = room.share("tv", initial, (tv) => this.applied(tv));
    // a visitor who leaves lets go of what they held, and their games end with their page
    room.onGone((id) => {
      const tv = store.get().tv;
      if (tv.remote?.id === id || tv.controllers.some((h) => h?.id === id) || tv.seats.some((st) => st?.host === id))
        this.setShared({
          ...tv,
          remote: tv.remote?.id === id ? null : tv.remote,
          controllers: tv.controllers.map((h) => (h?.id === id ? null : h)),
          seats: tv.seats.map((st) => (st?.host === id ? null : st)),
        });
    });
    loadTvCatalog()
      .then((c) => store.set({ tvCatalog: c }))
      .catch((e: unknown) => console.warn("[tv] no catalogue:", e));
    this.applied(initial);
  }

  // ---------------------------------------------------------------- who holds what

  /** The controller this visitor holds (1, 2…), or null. */
  get myController(): number | null {
    const i = store.get().tv.controllers.findIndex((h) => h?.id === ME.id);
    return i < 0 ? null : i + 1;
  }

  /** The controller whose player in the game runs in this visitor's page (1, 2…), held or put down, or null. */
  get mySeat(): number | null {
    const i = store.get().tv.seats.findIndex((st) => st?.host === ME.id);
    return i < 0 ? null : i + 1;
  }

  /** Whether this visitor holds the remote. */
  get holdingRemote(): boolean {
    return store.get().tv.remote?.id === ME.id;
  }

  /**
   * Pick up controller n and sit down to play, or the remote, from the coffee
   * table (in the Game Room, walking). Returns why not, or null.
   */
  take(item: "controller" | "remote", n = 1): string | null {
    const s = store.get();
    const tv = s.tv;
    if (!this.controllers.inRoom()) return "Go to the Game Room's coffee table first.";
    if (item === "remote") {
      if (tv.remote) return tv.remote.id === ME.id ? null : `${tv.remote.name} has the remote.`;
      this.setShared({ ...tv, remote: { ...ME } });
      store.set({ tvPrompt: null });
      return null;
    }
    if (this.myController !== null) return "You already have a controller.";
    const h = tv.controllers[n - 1];
    if (h === undefined) return "There's no such controller.";
    if (h) return `${h.name} has controller ${n}.`;
    if (!s.walking || !this.fly.walker || s.focus) return "Walk up to the coffee table to pick up a controller.";
    const controllers = [...tv.controllers];
    controllers[n - 1] = { ...ME };
    // a game this visitor left playing on another controller ends
    const seats = tv.seats.map((st, i) => (st?.host === ME.id && i !== n - 1 ? null : st));
    const was = seats[n - 1];
    // the controller's player plays on, now from this visitor's page; or, with a game on, a new one joins
    if (tv.game) seats[n - 1] = was ? (was.host === ME.id ? was : { name: was.name, host: ME.id, handover: true }) : { name: ME.name, host: ME.id, handover: false };
    this.setShared({ ...tv, controllers, seats });
    store.set({ tvPrompt: null });
    if (was && was.host !== ME.id) this.flash(`You take over ${was.name}'s game`);
    void this.sit();
    return null;
  }

  /**
   * Put the controller down, standing up, or the remote back on the table. The
   * game plays on, and this visitor still sees it on the TV, until they quit it
   * or someone else picks the controller up and takes it over.
   */
  putDown(item: "controller" | "remote"): void {
    const tv = store.get().tv;
    if (item === "remote") {
      if (this.holdingRemote) this.setShared({ ...tv, remote: null });
      return;
    }
    const n = this.myController;
    if (n !== null) {
      this.setShared({ ...tv, controllers: tv.controllers.map((h) => (h?.id === ME.id ? null : h)) });
      if (tv.game && tv.seats[n - 1]?.host === ME.id) this.flash(`Your game plays on: anyone can pick up controller ${n} and take it over`);
    }
    void this.standUp();
  }

  /** Quit the game: put the controller down, standing up, and this visitor's player leaves the game. */
  quit(): void {
    const tv = store.get().tv;
    if (this.myController !== null || this.mySeat !== null)
      this.setShared({ ...tv, controllers: tv.controllers.map((h) => (h?.id === ME.id ? null : h)), seats: tv.seats.map((st) => (st?.host === ME.id ? null : st)) });
    void this.standUp();
  }

  /** The remote: put a game from the catalogue on the TV, loading it for everyone holding a controller. Returns why not, or null. */
  choose(gameId: string): string | null {
    if (!this.holdingRemote) return "Pick up the remote from the coffee table to choose a game.";
    const game = store.get().tvCatalog?.games.find((g) => g.gameId === gameId);
    if (!game) return "That game isn't in the catalogue.";
    const tv = store.get().tv;
    if (store.get().tvFailed) return "Your TV failed to connect: turn it off first.";
    // a new game: whoever holds a controller plays it; games left playing end
    this.setShared({ ...tv, game, run: tv.run + 1, seats: tv.controllers.map((h) => (h ? { name: h.name, host: h.id, handover: false } : null)) });
    return null;
  }

  /** The remote: turn the TV off, ending everyone's game (they keep their controllers) and clearing anyone's failure. */
  turnOff(): string | null {
    if (!this.holdingRemote) return "Pick up the remote from the coffee table first.";
    const tv = store.get().tv;
    if (tv.game) this.setShared({ ...tv, game: null, run: tv.run + 1, seats: tv.seats.map(() => null) });
    return null;
  }

  /**
   * The game failed to connect in this visitor's frame (for the game started as
   * `run`): their game closes and their TV shows static until the TV is turned
   * off. Nobody else's TV changes. A failure from a game since replaced is ignored.
   */
  fail(run: number, reason: string): void {
    const tv = store.get().tv;
    if (tv.run !== run || !tv.game || store.get().tvFailed) return;
    console.warn(`[tv] ${tv.game.name} failed to connect: ${reason}`);
    store.set({ tvFailed: { reason } });
    this.publishFrame();
    this.publishPanes();
    this.redraw();
    this.flash(`${tv.game.name} failed to connect: ${reason}`);
  }

  /** Do what E offers here. */
  act(): void {
    const p = store.get().tvPrompt;
    if (!p) return;
    if (p.item === "tv") return void this.watch();
    const why = p.action === "put" ? (this.putDown(p.item), null) : this.take(p.item, p.n);
    if (why) this.flash(why);
  }

  /** A canvas click in walk mode on a controller or the remote within reach picks it up; on the TV, watches it. */
  click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().focus) return false;
    const c = this.controllers.clicked(e);
    const r = c === null ? this.remote.clicked(e) : null;
    if (c === null && r === null) {
      const hit = pickAt(this.scene, this.canvas, e);
      if (!this.screen || hit?.mesh !== this.screen || hit.distance > WATCH_REACH) return false;
      void this.watch();
      return true;
    }
    const why = c !== null ? this.take("controller", c) : this.take("remote");
    if (why) this.flash(why);
    return true;
  }

  /** Watch the TV, standing (walk mode): the camera glides square onto it and every player's game is followed on it. */
  async watch(): Promise<boolean> {
    const s = store.get();
    if (!this.screen || s.focus || !s.walking || !this.fly.walker) return false;
    this.back = this.fly.getPose();
    store.set({ tvPrompt: null });
    const fov = this.fly.camera.fov;
    return this.focus.enter({ kind: "tv", watching: true }, this.screen, () => this.seatPose(fov), GLIDE_IN);
  }

  /** Stop watching the TV: the camera glides back to where the watcher stood. */
  async stopWatching(): Promise<void> {
    const f = store.get().focus;
    if (f?.kind !== "tv" || !f.watching) return;
    await this.standUp();
  }

  /** The shared state changed (here or in another visitor's tab). */
  private applied(shared: TvState): void {
    const was = store.get().tv;
    // (from a page from before games played on with their controller down)
    const tv = { ...shared, seats: shared.seats ?? shared.controllers.map(() => null) };
    // turning the TV off clears this visitor's failure
    store.set({ tv, ...(tv.game ? {} : { tvFailed: null }) });
    if (tv.game?.art !== this.art?.url) this.loadArt(tv.game?.art ?? null);
    this.publishFrame();
    this.publishPanes();
    this.redraw();
    // seated, but the controller went to someone else (two picked it up at once)
    const f = store.get().focus;
    if (f?.kind === "tv" && !f.watching && f.phase !== "out" && this.myController === null) {
      void this.standUp();
      this.flash("Someone else picked up that controller");
    }
    if (tv.game && tv.run !== was.run && this.myController !== null) this.flash(`${tv.game.name} is starting`);
    // the game this visitor left playing was taken over
    const taken = tv.run === was.run ? tv.seats.findIndex((st, i) => st && st.host !== ME.id && was.seats[i]?.host === ME.id) : -1;
    if (taken >= 0) this.flash(`${tv.controllers[taken]?.name ?? "Someone"} took over your game on controller ${taken + 1}`);
  }

  // ---------------------------------------------------------------- sitting down to play

  /** Sit down on the couch to play: the camera glides square onto the TV, level with its middle, and it fills the view. */
  private async sit(): Promise<void> {
    if (!this.screen || !this.fly.walker) return;
    this.back = this.fly.getPose();
    const fov = this.fly.camera.fov;
    await this.focus.enter({ kind: "tv" }, this.screen, () => this.seatPose(fov), GLIDE_IN);
  }

  /** Stand up again: the camera glides back to where the player stood. */
  private async standUp(): Promise<void> {
    const f = store.get().focus;
    if (f?.kind !== "tv" || f.phase === "out") return;
    await this.focus.leave(this.back, GLIDE_OUT);
    this.back = null;
  }

  /** Square onto the TV, leaving room round it for the frame of UI. */
  private seatPose(fov: number): Pose {
    const engine = this.scene.getEngine();
    const box = this.canvas.getBoundingClientRect();
    const fill = { w: 1 - (2 * MARGIN.side) / Math.max(1, box.width), h: 1 - (2 * Math.max(MARGIN.top, MARGIN.bottom)) / Math.max(1, box.height) };
    return squarePose(this.geo!, fov, engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()), fill);
  }

  // ---------------------------------------------------------------- the player's game

  /** The players in the game, by controller number, in order: whoever holds the controller, or the player left playing with it down. */
  players(): { controller: number; name: string }[] {
    const tv = store.get().tv;
    return tv.seats.flatMap((st, i) => (st ? [{ controller: i + 1, name: tv.controllers[i]?.name ?? st.name }] : []));
  }

  /**
   * This visitor's game, while a player in the game runs in their page (their
   * controller in hand or put down) and it hasn't failed: joined under the
   * player's name, their own or that of the player they took over.
   */
  private wantedFrame(): TvFrame | null {
    const { game, run, seats } = store.get().tv;
    const n = this.mySeat;
    const seat = n && seats[n - 1];
    if (!game || store.get().tvFailed || !seat) return null;
    return { key: `${run}:${game.gameId}:${n}:${seat.name}`, src: inEmbedMode(game.playUrl, seat.name), title: game.name, checking: true };
  }

  private publishFrame(): void {
    const want = this.wantedFrame();
    if (want?.key !== store.get().tvFrame?.key) store.set({ tvFrame: want });
  }

  /**
   * The game's frame is in the page (ui/TvOverlay.tsx): the TV places it each
   * frame, and checks its page as it starts, while the camera glides in.
   */
  attach(key: string, el: HTMLIFrameElement): void {
    const run = Number(key.split(":")[0]);
    const p = { key, el, on: false, loading: null as ReturnType<typeof setTimeout> | null };
    this.placed = p;
    const mine = () => this.placed === p;
    // a page that never loads fails
    p.loading = setTimeout(() => mine() && this.fail(run, "the game didn't load"), LOAD_MS);
    el.addEventListener("load", () => p.loading && (clearTimeout(p.loading), (p.loading = null)), { once: true });
    const t0 = performance.now();
    void pageProblem(store.get().tvFrame?.src ?? el.src).then((reason) => {
      if (!mine()) return;
      console.info(`[tv] checked in ${Math.round(performance.now() - t0)} ms${reason ? `: ${reason}` : ""}`);
      if (reason) this.fail(run, reason);
      else this.verified(key);
    });
  }

  detach(el: HTMLIFrameElement): void {
    const p = this.placed;
    if (p?.el !== el) return;
    if (p.loading) clearTimeout(p.loading);
    this.placed = null;
  }

  /** The game's page is known to work (the check passed, or it spoke in embed mode): its frame may show. */
  private verified(key: string): void {
    const f = store.get().tvFrame;
    if (f?.key === key && f.checking) store.set({ tvFrame: { ...f, checking: false } });
  }

  /**
   * A message from the frame `key`'s page (ui/TvOverlay.tsx checks it came from
   * that frame and the game's origin): ChimpVibe's embed mode, or null. An error
   * fails the TV; any other message says the page works.
   */
  receive(key: string, data: unknown): EmbedMessage | null {
    const msg = parseEmbedMessage(data);
    if (!msg || this.placed?.key !== key) return null;
    if (msg.type === "error") this.fail(Number(key.split(":")[0]), msg.reason);
    else this.verified(key);
    if (msg.type === "ready") {
      store.set({ tvReady: key });
      this.publishPanes();
    }
    return msg;
  }

  // ---------------------------------------------------------------- the other players' games, watched

  /** The players in the game on this visitor's TV, in controller order: the parts it is split into. `me`: it runs in this page. */
  private layoutPlayers(): { controller: number; name: string; me: boolean; handover: boolean }[] {
    return store.get().tv.seats.flatMap((st, i) => (st ? [{ controller: i + 1, name: st.name, me: st.host === ME.id, handover: st.handover }] : []));
  }

  /**
   * The other players' games this visitor should be watching: while in the
   * Game Room (or at the TV) with a game on, and it hasn't failed for them,
   * each other player's, followed.
   */
  private wantedPanes(): { key: string; src: string; name: string; controller: number }[] {
    const s = store.get();
    const { game, run } = s.tv;
    if (!game || s.tvFailed || (s.focus?.kind !== "tv" && !this.controllers.inRoom())) return [];
    const players = this.layoutPlayers();
    const mine = players.find((p) => p.me);
    const ready = !!s.tvFrame && s.tvReady === s.tvFrame.key;
    // a player watches the others once their own game is in (ChimpVibe refuses a spectator while nobody
    // plays), unless they took over a game, which others are playing; and a player who took over a game
    // watches it until their own is in
    if (s.tvFrame && !ready && !mine?.handover) return [];
    return players
      .filter((p) => !p.me || (p.handover && !ready))
      .map(({ controller, name }) => {
        const tries = this.retries.get(`${controller}:${name}`) ?? 0;
        return { key: `${run}:${game.gameId}:watch:${controller}:${name}:${tries}`, src: asSpectator(game.playUrl, name), name, controller };
      });
  }

  /** Bring the store's watched parts in line with who is playing: new ones start loading, ones still wanted keep their state. */
  private publishPanes(): void {
    const want = this.wantedPanes();
    const was = store.get().tvPanes;
    if (want.length === was.length && want.every((w, i) => w.key === was[i].key)) return;
    const panes: TvPane[] = want.map((w) => was.find((p) => p.key === w.key) ?? { ...w, state: "loading", note: null, shown: false });
    store.set({ tvPanes: panes });
  }

  private setPane(key: string, patch: Partial<TvPane>): void {
    const panes = store.get().tvPanes;
    const i = panes.findIndex((p) => p.key === key);
    if (i < 0) return;
    const next = [...panes];
    next[i] = { ...panes[i], ...patch };
    store.set({ tvPanes: next });
  }

  /** A watched part's frame is in the page (ui/TvOverlay.tsx): until it says it is showing, it stays hidden, and fails if that takes too long. */
  attachPane(key: string, el: HTMLIFrameElement): void {
    const p: PaneEl = { el, ready: false, timer: null };
    this.paneEls.set(key, p);
    p.timer = setTimeout(() => {
      if (this.paneEls.get(key) === p && !p.ready) this.setPane(key, { state: "failed", note: "It didn't load", shown: false });
    }, LOAD_MS);
  }

  detachPane(key: string, el: HTMLIFrameElement): void {
    const p = this.paneEls.get(key);
    if (p?.el !== el) return;
    if (p.timer) clearTimeout(p.timer);
    this.paneEls.delete(key);
  }

  /**
   * A message from a watched part's frame (ui/TvOverlay.tsx checks where it came
   * from): showing, whether its player is there, or why it can't be watched.
   * Nobody playing, or a dropped connection, tries again shortly.
   */
  receivePane(key: string, data: unknown): void {
    const msg = parseEmbedMessage(data);
    const p = this.paneEls.get(key);
    const pane = store.get().tvPanes.find((x) => x.key === key);
    if (!msg || !p || !pane) return;
    if (msg.type === "ready") {
      p.ready = true;
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      this.setPane(key, { state: "showing", note: null, shown: true });
    } else if (msg.type === "follow") {
      this.setPane(key, msg.state === "following" ? { state: "showing", note: null } : { state: "waiting", note: msg.state === "gone" ? `${pane.name} has left` : `Waiting for ${pane.name}…` });
    } else if ((msg.type === "error" && msg.code === "no-players") || msg.type === "ended") {
      this.retryPane(pane, msg.type === "ended" && msg.reason === "disconnected" ? "Reconnecting…" : `Waiting for ${pane.name} to play…`);
    } else if (msg.type === "error") {
      p.ready = false;
      this.setPane(key, { state: "failed", note: msg.reason, shown: false });
    }
  }

  /** Hide a watched part and, after a moment, load it again. */
  private retryPane(pane: TvPane, note: string): void {
    const p = this.paneEls.get(pane.key);
    if (p) {
      p.ready = false;
      if (p.timer) clearTimeout(p.timer);
      p.timer = setTimeout(() => {
        const id = `${pane.controller}:${pane.name}`;
        this.retries.set(id, (this.retries.get(id) ?? 0) + 1);
        this.publishPanes();
      }, RETRY_MS);
    }
    this.setPane(pane.key, { state: "waiting", note, shown: false });
  }

  /** The TV's picture of watched parts is in the page (ui/TvOverlay.tsx): placed each frame. */
  attachSurface(el: HTMLElement | null): void {
    this.surface = el;
  }

  /** Give the keyboard back to this visitor's game, if it lost it. */
  giveKeys(): void {
    const p = this.placed;
    if (p?.on && document.activeElement !== p.el) p.el.focus();
  }

  // ---------------------------------------------------------------- each frame

  /** Each frame, after the camera has moved: show what's held, offer what E would do, and place the game's frame. */
  update(): void {
    this.frames++;
    const s = store.get();
    const tv = s.tv;
    // static keeps moving, while anyone here can see it
    if (s.tvFailed && this.frames % 3 === 0 && this.controllers.inRoom()) this.redraw();
    this.controllers.show((n) => tv.controllers[n - 1] !== null);
    this.remote.show(() => tv.remote !== null);
    if (this.holdingRemote && !this.remote.inRoom() && s.focus?.kind !== "tv") {
      this.putDown("remote");
      this.flash("You left the Game Room, so the TV's remote went back on the coffee table");
    }
    const prompt = !s.focus && s.walking && this.fly.enabled ? this.offer() : null;
    const was = s.tvPrompt;
    if (prompt?.action !== was?.action || prompt?.item !== was?.item || prompt?.n !== was?.n) store.set({ tvPrompt: prompt });
    this.publishPanes();
    this.place();
  }

  /** What E would do here: take the controller or remote looked at, or put down the remote in hand. */
  private offer(): GameTvPrompt | null {
    const c = this.controllers.lookedAt();
    const r = this.remote.lookedAt();
    const tv = store.get().tv;
    if (r && (!c || r.cos >= c.cos)) {
      if (this.holdingRemote) return { action: "put", item: "remote", n: 1 };
      return tv.remote ? null : { action: "take", item: "remote", n: 1 };
    }
    if (c && !tv.controllers[c.n - 1] && this.myController === null) return { action: "take", item: "controller", n: c.n };
    if (!c && !r && tv.game && this.inSight()) return { action: "watch", item: "tv", n: 0 };
    return null;
  }

  /** Whether a walker is near the TV, in front of it, looking at it, with nothing in the way. */
  private inSight(): boolean {
    const g = this.geo;
    if (!g || !this.screen) return false;
    const eye = this.fly.camera.position;
    const to = g.centre.subtract(eye);
    const dist = to.length();
    if (dist > WATCH_REACH || Vector3.Dot(to, g.normal) > -0.5) return false;
    if (Vector3.Dot(this.fly.camera.getDirection(Vector3.Forward()), to) / dist < LOOK) return false;
    if (this.frames - this.clear.frame >= 3) this.clear = { frame: this.frames, ok: nothingInTheWay(this.scene, eye, this.screen, g) };
    return this.clear.ok;
  }

  /**
   * Place this visitor's game for this frame, in its part of the TV: square on
   * while at the TV, taking the keyboard while they hold its controller; while
   * they walk about the Game Room with the controller put down, in perspective
   * under the canvas, as the other players' games are; otherwise hidden. A
   * page not yet known to work stays out of sight.
   */
  private place(): void {
    const s = store.get();
    const f = s.focus;
    const at = f?.kind === "tv" && f.phase === "on" ? s.focusRect : null;
    const players = this.layoutPlayers();
    const parts = tvParts(players.length);
    const p = this.placed;
    const part = p && !s.tvFrame?.checking ? parts[players.findIndex((x) => x.me)] : undefined;
    const quad = !at && !s.focus && (part || s.tvPanes.some((x) => x.shown)) ? this.screenOnPage() : null;
    this.placeSurface(at, quad);
    if (!p) return;
    const was = p.on;
    p.on = !!at && !!part && f?.kind === "tv" && !f.watching && this.myController !== null;
    const st = p.el.style;
    if (at && part) {
      const r = partOn(at, part);
      Object.assign(st, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, transform: "none", zIndex: "21", visibility: "visible", pointerEvents: p.on ? "auto" : "none" });
    } else if (quad && part) {
      const w = SURFACE_W;
      const h = this.surfaceHeight();
      Object.assign(st, {
        left: "0px",
        top: "0px",
        width: `${part.w * w}px`,
        height: `${part.h * h}px`,
        transform: `${quadTransform(w, h, quad)} translate(${part.x * w}px, ${part.y * h}px)`,
        zIndex: "0",
        visibility: "visible",
        pointerEvents: "none",
      });
    } else {
      st.visibility = "hidden";
      st.pointerEvents = "none";
    }
    if (!p.on && was && document.activeElement === p.el) p.el.blur();
    if (p.on && !was) p.el.focus();
  }

  /** The height of the TV's picture as a walker sees it, for its width SURFACE_W (CSS px). */
  private surfaceHeight(): number {
    return this.geo ? Math.round((SURFACE_W * this.geo.height) / this.geo.width) : Math.round((SURFACE_W * 9) / 16);
  }

  /**
   * Place the TV's picture of the players' parts: square on over the TV while
   * at it (this visitor's own game lies under it, the parts' tags over that);
   * while walking about, in perspective under the canvas with the TV's screen a
   * hole in it, at `quad`, the screen on the page; otherwise hidden (the parts
   * keep running).
   */
  private placeSurface(at: ScreenRect | null, quad: { x: number; y: number }[] | null): void {
    const el = this.surface;
    this.hole(!!quad);
    if (!el) return;
    const st = el.style;
    if (at) {
      Object.assign(st, { left: `${at.x}px`, top: `${at.y}px`, width: `${at.w}px`, height: `${at.h}px`, transform: "none", zIndex: "22", visibility: "visible" });
      el.classList.remove("over");
    } else if (quad) {
      const h = this.surfaceHeight();
      Object.assign(st, { left: "0px", top: "0px", width: `${SURFACE_W}px`, height: `${h}px`, transform: quadTransform(SURFACE_W, h, quad), zIndex: "0", visibility: "visible" });
      el.classList.add("over");
    } else st.visibility = "hidden";
  }

  /**
   * The TV's screen on the page (top-left, top-right, bottom-right,
   * bottom-left) when its picture may lie under it: the viewer is in the Game
   * Room, in front of the whole screen, with some of it on the page. Otherwise null.
   */
  private screenOnPage(): { x: number; y: number }[] | null {
    const s = store.get();
    const g = this.geo;
    const cam = this.fly.camera;
    if (!g || s.help || s.refOverlay === "full" || this.fly.isOrtho || !this.controllers.inRoom()) return null;
    const view = cam.getViewMatrix(true);
    if (g.corners.some((c) => Vector3.TransformCoordinates(c, view).z < cam.minZ)) return null;
    if (Vector3.Dot(cam.position.subtract(g.centre), g.normal) <= 0) return null;
    const [bl, br, tr, tl] = toPage(g.corners, this.scene, this.canvas);
    const quad = [tl, tr, br, bl];
    return onPage(quad, this.canvas.getBoundingClientRect()) > 0 ? quad : null;
  }

  /** Draw the TV's screen as a hole in the canvas, or as itself again. */
  private hole(on: boolean): void {
    if (!this.screen || on === !!this.holedMat) return;
    if (on) {
      this.holedMat = this.screen.material;
      this.screen.material = screenHoleMaterial(this.scene);
    } else {
      this.screen.material = this.holedMat;
      this.holedMat = null;
    }
  }

  /** Whether the game's frame is in the page, taking keys (on) and showing, and where: for tests. */
  placement(): { key: string; on: boolean; visible: boolean; left: string; top: string; width: string; height: string; transform: string; zIndex: string } | null {
    const p = this.placed;
    const st = p?.el.style;
    return p && st ? { key: p.key, on: p.on, visible: st.visibility === "visible", left: st.left, top: st.top, width: st.width, height: st.height, transform: st.transform, zIndex: st.zIndex } : null;
  }

  // ---------------------------------------------------------------- the picture on the TV

  private loadArt(url: string | null): void {
    this.art = url ? { url, img: null } : null;
    if (!url) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (this.art?.url !== url) return;
      this.art.img = img;
      this.redraw();
    };
    img.onerror = () => console.info(`[tv] no art: ${url}`);
    img.src = url;
  }

  /** Draw what the TV shows under its players' games: idle, the game's card naming who is playing, or static when it failed to connect. */
  private redraw(): void {
    if (!this.tex) return;
    const tv = store.get().tv;
    const failed = store.get().tvFailed;
    const card: TvCard = failed
      ? { kind: "failed", name: tv.game?.name ?? "The game", reason: failed.reason }
      : tv.game
      ? {
          kind: "game",
          name: tv.game.name,
          author: tv.game.author,
          art: this.art?.img ?? null,
          palette: tv.game.palette,
          players: this.players(),
          note: "Pick up a controller to play, or face the TV and press E to watch",
        }
      : { kind: "idle" };
    const { width, height } = this.tex.getSize();
    drawTvCard(this.tex.getContext() as unknown as CanvasRenderingContext2D, card, width, height);
    this.tex.update(true);
    this.tex.metadata = { card: card.kind, players: card.kind === "game" ? card.players.length : 0, drawn: (this.drawn += 1) };
  }
}

type GameTvPrompt = NonNullable<ReturnType<typeof store.get>["tvPrompt"]>;
