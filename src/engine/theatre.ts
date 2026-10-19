// The theatre: YouTube videos and live streams on the theatre screen, chosen by
// anyone in the preview and watched together.
//
// The screen and the "Now Showing" lightbox are found by role (world/roles.ts).
// What the theatre shows is one object, the store's `theatre`: the video,
// playing or paused, and where it was at a moment, which the room server can
// later share to keep everyone in step. Each viewer watches through YouTube's
// own player, which a browser can't draw into the 3D scene, so it is laid over
// the screen: square on and with a frame of UI in watch mode (engine/focus.ts,
// ui/TheatreOverlay.tsx), and in perspective, following the screen, while the
// viewer moves about the theatre with the screen in clear view. Otherwise the
// screen and lightbox show the video's poster (world/props/theatreScreen.ts).
// The player's volume falls off with the viewer's distance from the screen.
//
// A remote's holder controls the theatre (engine/remotes.ts): their remote's
// buttons, the videos they choose, and what they do in YouTube's player move the
// theatre for everyone. Anyone else can still use the player (YouTube's terms
// don't allow blocking it), but only for themselves: their pause is theirs alone,
// and pressing play rejoins the theatre.
//
// YouTube's terms (see docs/handoffs/2026-10-06-theatre-youtube.md): the player
// is shown whole, uncovered and big enough, and never plays where it can't be
// seen, so it pauses whenever it is hidden. The theatre's own state isn't paused
// by that: like a cinema, it keeps going while someone looks away or steps out,
// and their player catches up when the screen is back in view.

import { DynamicTexture, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { roomAt } from "../world/layout";
import { makeCanvas, toTexture } from "../world/materials/canvas";
import { Materials } from "../world/materials/library";
import { TheatreCard, drawTheatreCard } from "../world/props/theatreScreen";
import { ROLE, ScreenMeta, find } from "../world/roles";
import { FlyCamera, Pose } from "./flyCamera";
import { ScreenFocus, ScreenGeometry, nothingInTheWay, onPage, pickAt, quadTransform, screenGeometry, squarePose, toPage } from "./focus";
import { VIEWER, store } from "./store";
import { AVATAR } from "./walker";
import { PLAYER, PlayerEvents, VideoPlayer, embedUrl, fetchVideoInfo, loadThumbnail, parseYouTube, youTubeError, youTubePlayer } from "./youtube";

/** How far from the screen a visitor can start watching (m), and how near the middle of the view it must be. */
const REACH = 13;
const LOOK = Math.cos((40 * Math.PI) / 180);
/** Room round the screen in watch mode for the frame of UI (CSS px): its bar above, and either side. */
const MARGIN = { top: 72, side: 40 };
const GLIDE_IN = 1.2;
const GLIDE_OUT = 1.0;
/** How far a playing player may drift from the theatre's time before it is put right (s); one starting or rejoining is put within LINE_UP of it. */
const DRIFT = 2;
const LINE_UP = 0.5;
/** How far the remote's skip buttons skip (s). */
const SKIP = 10;
/** Without a remote, what choosing or controlling the theatre needs. */
const NEED_REMOTE = "Pick up a remote from the stand under the screen to control what's showing.";
/** The player over the screen in perspective, as the viewer moves about. */
const OVER = {
  /** its own width (CSS px): a transform maps it onto the screen */
  width: 960,
  /** the least it may measure on the page along any side: YouTube's smallest player is 200 × 200 px */
  minPx: 200,
  /** the steepest it is seen at, from straight on */
  maxAngle: (65 * Math.PI) / 180,
  /** the share of it that must be on the page: YouTube starts playback only when more than half of the player shows */
  onPage: 0.5,
};
/** Volume by distance: the viewer's own volume within `full` metres of the screen, falling off as 1/distance beyond, to no less than `floor` of it. */
const VOLUME = { full: 5.5, floor: 0.25 };

const params = new URLSearchParams(location.search);

/** Where the player is: hidden (and paused), over the screen in perspective, or square on in watch mode. */
type View = "hidden" | "over" | "watch";
type Pt = { x: number; y: number };

export class Theatre {
  readonly screen: Mesh | null;
  readonly lightbox: Mesh | null;
  /** ?theatre=standin: a same-origin test card plays instead of YouTube's player (public/theatre/standin.html) */
  readonly standin = params.get("theatre") === "standin";
  private geo: ScreenGeometry | null;
  private cards: { tex: DynamicTexture; note: string }[] = [];
  private thumb: HTMLImageElement | null = null;
  /** the player's frame and, once it is ready, the player */
  private frame: HTMLIFrameElement | null = null;
  private player: VideoPlayer | null = null;
  /** the player has played since it loaded */
  private played = false;
  /** a viewer without a remote paused their own player: it stays paused until they press play */
  private ownPause = false;
  /** the state the theatre last asked the player for, and until when, so the player's answer isn't taken for the viewer's doing */
  private asked: { state: number; until: number } | null = null;
  private view: View = "hidden";
  /** why the player is hidden, while it is */
  private why = "no video";
  /** the viewer's own volume (the player's slider near the screen), what was last set, when, and the last few values set */
  private volume = { own: 100, set: -1, at: 0, recent: [] as number[] };
  /** where the viewer was before watching: Leave glides back there */
  private back: Pose | null = null;
  private frames = 0;
  private clear = { frame: -100, ok: false };

  constructor(
    private scene: Scene,
    mats: Materials,
    private fly: FlyCamera,
    private focus: ScreenFocus,
    private canvas: HTMLCanvasElement,
  ) {
    this.screen = find(scene, ROLE.theatreScreen) as Mesh | null;
    this.lightbox = find(scene, ROLE.theatreLightbox) as Mesh | null;
    this.geo = this.screen && screenGeometry(this.screen);
    // the screen and lightbox show cards drawn here from now on
    for (const [mesh, w, note] of [
      [this.screen, 1280, "Walk up to the screen and press E to watch"],
      [this.lightbox, 640, "Now in the theatre"],
    ] as const) {
      if (!mesh) continue;
      const tex = toTexture(scene, `theatre:${mesh.name}`, makeCanvas(w, (w * 9) / 16).canvas, { wrap: false }) as DynamicTexture;
      mesh.material = mats.unlit(`theatre:${mesh.name}`, { tex, intensity: 1.05 });
      this.cards.push({ tex, note });
    }
    this.redraw();
  }

  /** Where the theatre's video is now, in seconds. */
  position(now = Date.now()): number {
    const t = store.get().theatre;
    return t.playing ? t.at + (now - t.since) / 1000 : t.at;
  }

  /** Where the player is now and, while hidden, why. */
  get placement(): { view: View; why: string } {
    return { view: this.view, why: this.view === "hidden" ? this.why : "" };
  }

  /** Each frame, after the camera has moved: offer the screen to a walker looking at it, and place the player. */
  update(): void {
    this.frames++;
    const s = store.get();
    // at the stand, E is for the remotes
    const prompt = !s.focus && s.walking && !s.remotePrompt && this.fly.enabled && this.inSight();
    if (prompt !== s.theatrePrompt) store.set({ theatrePrompt: prompt });
    this.place();
  }

  /** A canvas click in walk mode on the theatre screen watches it. */
  click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().focus) return false;
    const hit = pickAt(this.scene, this.canvas, e);
    if ((hit?.mesh.metadata as Partial<ScreenMeta> | undefined)?.role !== ROLE.theatreScreen || hit!.distance > REACH) return false;
    void this.use();
    return true;
  }

  /**
   * Watch the screen (walk mode): the camera glides to a seat-height pose square
   * onto it and the player lies over it, caught up with the theatre. Resolves
   * once there.
   */
  async use(): Promise<boolean> {
    const s = store.get();
    const walker = this.fly.walker;
    if (!this.screen || s.focus || !s.walking || !walker) return false;
    this.back = this.fly.getPose();
    store.set({ theatrePrompt: false });
    const eyeY = walker.feet.y + AVATAR.seatedEye;
    const fov = this.fly.camera.fov;
    const there = await this.focus.enter({ kind: "theatre" }, this.screen, () => this.seatPose(eyeY, fov), GLIDE_IN);
    // the player shows square on in the next frame drawn; it is caught up and played once it has
    if (there) afterDrawn(() => this.sync());
    return there;
  }

  /** Stop watching: the camera glides back to where the viewer stood; the player stays on the screen while it is in view. */
  async leave(): Promise<void> {
    const f = store.get().focus;
    if (f?.kind !== "theatre" || f.phase === "out") return;
    await this.focus.leave(this.back, GLIDE_OUT);
    this.back = null;
  }

  /** Whether this visitor holds a remote, and so controls the theatre. */
  holding(): boolean {
    return store.get().theatre.remotes.includes(VIEWER);
  }

  /**
   * Show a YouTube video or live stream, from a pasted link or ID: a remote's
   * holder's choice, which starts at once. Returns what's wrong, in plain words, or null.
   */
  choose(input: string): string | null {
    if (!this.holding()) return NEED_REMOTE;
    const ref = parseYouTube(input);
    if (!ref) return "That isn't a YouTube link or video ID.";
    const s = store.get();
    const again = ref.id === s.theatre.videoId;
    store.set({ theatre: { ...s.theatre, videoId: ref.id, playing: true, at: ref.start, since: Date.now(), live: ref.live }, theatreVideo: again ? s.theatreVideo : null, theatreError: null });
    this.ownPause = false;
    if (!again) {
      this.thumb = null;
      void this.describe(ref.id);
    }
    this.redraw();
    // the same video again keeps its player, which starts over; another gets a player of its own
    if (again) this.sync(true);
    return null;
  }

  /** The remote's buttons, for everyone: play or pause, or skip back or forward. Returns why not, or null. */
  command(button: "toggle" | "back" | "forward"): string | null {
    if (!this.holding()) return NEED_REMOTE;
    const t = store.get().theatre;
    if (!t.videoId) return "Nothing is showing: choose a video first.";
    const since = Date.now();
    const at = this.position(since);
    if (button === "toggle") store.set({ theatre: { ...t, playing: !t.playing, at, since } });
    else store.set({ theatre: { ...t, at: Math.max(0, at + (button === "back" ? -SKIP : SKIP)), since } });
    this.ownPause = false;
    this.sync(true);
    return null;
  }

  // ---------------------------------------------------------------- the player

  /** The address of the player's frame for the current video, starting where the theatre is. */
  frameSrc(): string {
    const { videoId, live } = store.get().theatre;
    const id = videoId ?? "";
    // a live stream's player starts at its live edge
    const start = live ? 0 : Math.max(0, Math.floor(this.position()));
    return this.standin ? `${import.meta.env.BASE_URL}theatre/standin.html?v=${id}&start=${start}` : embedUrl(id, start);
  }

  /** The player's frame is in the page (ui/TheatreOverlay.tsx): control the player in it. The theatre places and shows it. */
  async attach(frame: HTMLIFrameElement): Promise<void> {
    this.frame = frame;
    this.player = null;
    this.played = false;
    this.ownPause = false;
    let player: VideoPlayer | null = null;
    const mine = () => frame === this.frame;
    // the keyboard goes to the player in watch mode, again once its page has loaded
    frame.addEventListener("load", () => mine() && this.view === "watch" && frame.focus());
    const events: PlayerEvents = {
      onReady: () => {
        if (!mine() || !player) return;
        this.player = player;
        this.volume = { own: player.getVolume() || 100, set: -1, at: 0, recent: [] };
        if (this.view !== "hidden") this.sync();
      },
      onStateChange: (e) => mine() && this.onState(e.data),
      onError: (e) => {
        if (!mine()) return;
        store.set({ theatreError: youTubeError(e.data) });
        this.redraw();
      },
      onAutoplayBlocked: () => mine() && store.set({ theatreError: "Your browser held back playback: press play on the video." }),
    };
    try {
      player = this.standin ? await standinPlayer(frame, events) : await youTubePlayer(frame, events);
    } catch {
      if (mine()) store.set({ theatreError: "YouTube's player couldn't load. Check the connection, or that nothing blocks youtube.com." });
    }
  }

  /** The player's frame has left the page. */
  detach(frame: HTMLIFrameElement): void {
    if (frame !== this.frame) return;
    this.frame = null;
    this.player = null;
    this.view = "hidden";
  }

  private watching(): boolean {
    const f = store.get().focus;
    return f?.kind === "theatre" && f.phase === "on" && !!store.get().focusRect;
  }

  /**
   * Place the player for this frame (it is drawn with the scene, so it never
   * drifts from the screen): square on in watch mode; over the screen in
   * perspective while the screen is in clear view; otherwise hidden, paused
   * before it hides.
   */
  private place(): void {
    const frame = this.frame;
    let view: View = "hidden";
    let quad: Pt[] | null = null;
    if (!frame) this.why = "no video";
    else if (this.watching()) view = "watch";
    else if ((quad = this.screenOnPage())) view = "over";
    const was = this.view;
    this.view = view;
    if (!frame) return;
    const st = frame.style;
    if (view === "hidden") {
      // never playing where it can't be seen: out of view first, so the pause isn't
      // taken for the viewer pausing the theatre, then paused, then hidden
      if (was !== "hidden") this.pause();
      st.visibility = "hidden";
      st.pointerEvents = "none";
      return;
    }
    if (view === "watch") {
      const r = store.get().focusRect!;
      Object.assign(st, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, transform: "none" });
      // the player has the keyboard, so YouTube's own keys work
      if (was !== "watch") frame.focus();
    } else {
      const w = OVER.width;
      const h = Math.round((w * this.geo!.height) / this.geo!.width);
      Object.assign(st, { left: "0px", top: "0px", width: `${w}px`, height: `${h}px`, transformOrigin: "0 0", transform: quadTransform(w, h, quad!) });
    }
    st.visibility = "visible";
    st.pointerEvents = "auto";
    this.loudness();
    // shown in the next frame drawn: then caught up, and played if the theatre is playing
    if (was === "hidden") afterDrawn(() => this.sync());
  }

  private pause(): void {
    const state = this.player?.getPlayerState();
    if (state === PLAYER.playing || state === PLAYER.buffering) this.player!.pauseVideo();
  }

  /**
   * Bring the viewer's player to the theatre, while it shows: its time, and
   * playing or paused (unless a viewer without a remote has paused their own).
   * `force` follows a skip even in a player that hasn't started.
   */
  private sync(force = false): void {
    const p = this.player;
    const t = store.get().theatre;
    if (!p || this.view === "hidden") return;
    const state = p.getPlayerState();
    const fresh = state === PLAYER.unstarted || state === PLAYER.cued;
    const play = t.playing && !this.ownPause;
    // a video that has only just been chosen isn't skipped into while its player loads (its
    // first play sets the theatre's time instead); and a seek would play a player that hasn't
    // started, which the frame's start time covers. A live stream's time is its running
    // time, so this joins it at its live edge.
    const tolerance = force || state !== PLAYER.playing ? LINE_UP : DRIFT;
    if (Math.abs(p.getCurrentTime() - this.position()) > tolerance && (play ? force || !fresh || this.position() - t.at > 10 : state === PLAYER.paused)) {
      if (play) this.ask(PLAYER.playing);
      p.seekTo(this.position(), true);
    }
    if (play) {
      if (state !== PLAYER.playing) this.ask(PLAYER.playing);
      p.playVideo();
    } else if (state === PLAYER.playing || state === PLAYER.buffering) {
      this.ask(PLAYER.paused);
      p.pauseVideo();
    }
  }

  /** Note what the theatre has asked the player for, so the player's answer isn't taken for the viewer's doing. */
  private ask(state: number): void {
    this.asked = { state, until: performance.now() + 3000 };
  }

  /**
   * Whether a player state answers what the theatre asked for (or is on the way
   * there), rather than being the viewer's doing. The next settled state is the
   * answer or isn't: either way the request is done with.
   */
  private answers(state: number): boolean {
    if (state === PLAYER.buffering || state === PLAYER.unstarted || state === PLAYER.cued) return true;
    const a = this.asked;
    this.asked = null;
    return !!a && performance.now() <= a.until && a.state === state;
  }

  /** The player changed state. Only what the viewer does in the player while it shows moves the theatre. */
  private onState(state: number): void {
    const p = this.player;
    if (state === PLAYER.playing && store.get().theatreError) {
      store.set({ theatreError: null });
      this.redraw();
    }
    if (!p || this.view === "hidden") return;
    const t = store.get().theatre;
    // a video first plays where it was cued, a live stream at its live edge: far past that
    if (state === PLAYER.playing && !this.played) {
      this.played = true;
      if (!t.live && p.getCurrentTime() > this.position() + 60) {
        store.set({ theatre: { ...store.get().theatre, live: true } });
        this.redraw();
      }
    }
    const ours = this.answers(state);
    if (!this.holding()) {
      // without a remote the player is the viewer's own: their pause is theirs alone, and
      // their play (or skip) rejoins the theatre
      if (ours) return;
      if (state === PLAYER.paused) this.ownPause = true;
      else if (state === PLAYER.playing) {
        this.ownPause = false;
        this.sync(true);
      }
      return;
    }
    // the holder's player is the theatre's: what they do in it, everyone sees
    const now = store.get().theatre;
    const since = Date.now();
    if (state === PLAYER.playing) store.set({ theatre: { ...now, playing: true, at: p.getCurrentTime(), since } });
    else if (state === PLAYER.paused) store.set({ theatre: { ...now, playing: false, at: p.getCurrentTime(), since } });
    else if (state === PLAYER.ended) store.set({ theatre: { ...now, playing: false, at: p.getDuration(), since } });
  }

  /**
   * Volume by distance: the viewer's own volume, set with the player's slider,
   * scaled down the further they are from the screen. A change on the slider
   * becomes their own volume; the player reports a volume set here only after a
   * moment, so it is judged against the last few set.
   */
  private loudness(): void {
    const p = this.player;
    if (!p || !this.geo) return;
    const k = Math.max(VOLUME.floor, Math.min(1, VOLUME.full / Vector3.Distance(this.fly.eye, this.geo.centre)));
    const v = this.volume;
    const now = performance.now();
    const heard = p.getVolume();
    if (v.set >= 0 && now - v.at > 1000 && !v.recent.some((x) => Math.abs(x - heard) <= 1)) v.own = Math.min(100, heard / k);
    const want = Math.round(v.own * k);
    if (want !== v.set && now - v.at > 100) {
      p.setVolume(want);
      v.set = want;
      v.at = now;
      v.recent = [...v.recent.slice(-4), want];
    }
  }

  // ---------------------------------------------------------------- the screen and lightbox

  /** The video's title, channel and thumbnail, for the frame and the poster. */
  private async describe(id: string): Promise<void> {
    const [info, thumb] = await Promise.all([fetchVideoInfo(id), loadThumbnail(id)]);
    if (store.get().theatre.videoId !== id) return;
    this.thumb = thumb;
    if (info) store.set({ theatreVideo: info });
    this.redraw();
  }

  /** Draw what the screen and lightbox show: the idle card, or the video's poster. */
  private redraw(): void {
    const s = store.get();
    for (const { tex, note } of this.cards) {
      const card: TheatreCard = s.theatre.videoId
        ? { kind: "poster", title: s.theatreVideo?.title || "YouTube video", channel: s.theatreVideo?.channel ?? "", thumb: this.thumb, live: s.theatre.live, note: s.theatreError ?? note, warn: !!s.theatreError }
        : { kind: "idle" };
      const { width, height } = tex.getSize();
      drawTheatreCard(tex.getContext() as unknown as CanvasRenderingContext2D, card, width, height);
      tex.update(true);
    }
  }

  /** The address of the thumbnail the poster shows, once it has loaded. */
  get thumbnail(): string | null {
    return this.thumb?.src ?? null;
  }

  // ---------------------------------------------------------------- where the viewer is

  /**
   * The screen's corners on the page (top-left, top-right, bottom-right,
   * bottom-left) when the player may lie over it in perspective; otherwise null,
   * with the reason in `why`. The viewer must be in the theatre, with the whole
   * screen in front of them, not seen too steeply, big enough, mostly on the page,
   * and with nothing in the way: the player always draws on top of the scene.
   */
  private screenOnPage(): Pt[] | null {
    const s = store.get();
    const g = this.geo;
    const cam = this.fly.camera;
    const hide = (why: string) => ((this.why = why), null);
    if (!g || !this.screen) return hide("no screen");
    if (s.focus && s.focus.kind !== "theatre") return hide("another screen is in use");
    if (s.help || s.refOverlay === "full") return hide("the HUD covers the view");
    if (this.fly.isOrtho || roomAt(cam.position)?.id !== (this.screen.metadata as ScreenMeta).room) return hide("out of the theatre");
    const view = cam.getViewMatrix(true);
    if (g.corners.some((c) => Vector3.TransformCoordinates(c, view).z < cam.minZ)) return hide("behind the camera");
    if (Vector3.Dot(cam.position.subtract(g.centre).normalize(), g.normal) < Math.cos(OVER.maxAngle)) return hide("seen too steeply");
    const [bl, br, tr, tl] = toPage(g.corners, this.scene, this.canvas);
    const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
    if (Math.min(len(tl, tr), len(bl, br), len(tl, bl), len(tr, br)) < OVER.minPx) return hide("too small");
    const quad = [tl, tr, br, bl];
    if (onPage(quad, this.canvas.getBoundingClientRect()) < OVER.onPage) return hide("mostly off the page");
    if (!this.clearView()) return hide("something is in the way");
    return quad;
  }

  /** Whether the walker could watch from where they are: in front of the screen, within reach, looking at it, and nothing in the way. */
  private inSight(): boolean {
    const g = this.geo;
    if (!g || !this.fly.walker) return false;
    const eye = this.fly.eye;
    const to = g.centre.subtract(eye);
    const dist = to.length();
    if (dist > REACH || Vector3.Dot(to, g.normal) > -0.5) return false;
    if (Vector3.Dot(this.fly.aim, to) / dist < LOOK) return false;
    return this.clearView();
  }

  /**
   * Nothing between the eye and the screen: rays to its centre and to just inside
   * its corners meet it first. Checked every few frames, against the screen's own
   * room only: whatever can stand between a viewer in the theatre and its screen
   * is in the theatre, and the house's terrain and trees, which every ray crosses,
   * would make each ray some fifty times slower.
   */
  private clearView(): boolean {
    if (this.frames - this.clear.frame < 3) return this.clear.ok;
    const ok = nothingInTheWay(this.scene, this.fly.camera.position, this.screen!, this.geo!);
    this.clear = { frame: this.frames, ok };
    return ok;
  }

  /** Square onto the screen with the eye at `eyeY` (seated), leaving room round it for the frame of UI. */
  private seatPose(eyeY: number, fov: number): Pose {
    const engine = this.scene.getEngine();
    const box = this.canvas.getBoundingClientRect();
    const fill = { w: 1 - (2 * MARGIN.side) / Math.max(1, box.width), h: 1 - (2 * MARGIN.top) / Math.max(1, box.height) };
    return squarePose(this.geo!, fov, engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()), fill, eyeY);
  }
}

/** Run `fn` once the page has drawn the next frame. */
function afterDrawn(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/** The test stand-in's player (public/theatre/standin.html): YouTube's calls and events, on a same-origin page. */
function standinPlayer(frame: HTMLIFrameElement, events: PlayerEvents): Promise<VideoPlayer> {
  type Standin = { standin?: { attach(e: PlayerEvents): VideoPlayer } };
  return new Promise((resolve) => {
    const attach = () => resolve((frame.contentWindow as unknown as Standin).standin!.attach(events));
    if ((frame.contentWindow as unknown as Standin | null)?.standin) attach();
    else frame.addEventListener("load", attach, { once: true });
  });
}
