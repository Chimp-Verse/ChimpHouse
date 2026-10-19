// Minimal observable store shared by the Babylon preview and the React HUD.

import { LiftState, initialLift } from "./liftState";
import { ME } from "./room";

export type Quality = "low" | "medium" | "high";
export type RefOverlay = "off" | "thumb" | "full";

export interface PickedInfo {
  label: string;
  point: [number, number, number];
}

/**
 * What a screen in use shows (engine/focus.ts): a game at a cabinet, the
 * theatre's video, or the Game Room TV: seated with a controller to play, or
 * standing to watch the players (`watching`).
 */
export type FocusInfo = { kind: "cabinet"; slot: number; gameId: string; name: string; author: string; url: string } | { kind: "theatre" } | { kind: "tv"; watching?: boolean };

/** A game running at a cabinet: from when it is first played until Quit, whether or not the visitor is at it. */
export interface RunningGame {
  slot: number;
  gameId: string;
  name: string;
  author: string;
  url: string;
  /** while no one is playing it, when it will quit by itself (Date.now() time); playing it again resets it */
  quitsAt: number | null;
  /** its page is being checked as it starts: its frame stays hidden until then */
  checking: boolean;
}

/** A screen in use, and whether the camera is gliding in to it, at it, or gliding back out. */
export type Focus = FocusInfo & { phase: "in" | "on" | "out" };

/** This visitor, as shared state names them: the lift's doorway and the theatre's remotes (engine/room.ts). */
export const VIEWER = ME.id;

/**
 * What the theatre is showing, as one object that the room server can later
 * share to keep everyone in step: the video, playing or paused, where it was at
 * a moment, and who holds each remote. Each viewer's own YouTube player follows it.
 */
export interface TheatreState {
  /** the YouTube video or live stream on the screen, or null */
  videoId: string | null;
  playing: boolean;
  /** seconds into the video at `since` */
  at: number;
  /** when it was at `at` (Date.now(), ms) */
  since: number;
  /** a live stream: viewers join it live, not at `at` */
  live: boolean;
  /** who holds each remote (remote n at n - 1), or null while it is on the stand: a holder controls the theatre */
  remotes: (string | null)[];
}

/** About the theatre's video, from YouTube. */
export interface TheatreVideo {
  title: string;
  channel: string;
}

/** A game the Game Room TV can play: one from ChimpVibe's catalogue. */
export interface TvGame {
  /** permanent where ChimpVibe gives it; otherwise "slug:<slug>" */
  gameId: string;
  name: string;
  author: string;
  /** the play page, as ChimpVibe gives it (engine/gameTv.ts adds embed mode and the player) */
  playUrl: string;
  art: string | null;
  palette: string[];
}

/** Someone holding a controller or the remote. */
export interface Holder {
  id: string;
  name: string;
}

/**
 * The Game Room TV, as one object visitors share (engine/room.ts): the game on it, who holds each controller (a player each, in
 * controller order: the TV's screen is split between them), and who holds its
 * remote (they choose the game).
 */
export interface TvState {
  game: TvGame | null;
  /** counts the games chosen, so choosing the same game again starts it afresh */
  run: number;
  /** controller n's holder at n - 1, or null while it is on the table */
  controllers: (Holder | null)[];
  /**
   * controller n's player in the game at n - 1, or null: it keeps playing while
   * its controller lies on the table, until it quits or someone picks it up
   */
  seats: (Seat | null)[];
  remote: Holder | null;
}

/**
 * A player in the TV's game: ChimpVibe's play page joined under `name`, in the
 * browser of the visitor `host`. Its controller may be on the table. Whoever
 * picks it up hosts it from then on, joining under the same name (ChimpVibe
 * can't hand a player from one browser to another, so the game sees a player
 * leave and one of the same name join), and the old host's game closes.
 */
export interface Seat {
  name: string;
  host: string;
  /** taken over from another host: the new host watches it until their own game is in */
  handover: boolean;
}

/** The game a player at the TV plays, in a frame in their page (engine/gameTv.ts). */
export interface TvFrame {
  /** stable while the same game runs: changing it reloads the frame */
  key: string;
  src: string;
  title: string;
  /** its page is being checked as it starts: the frame stays hidden until then */
  checking: boolean;
}

/**
 * One of the other players' games on this visitor's TV, watched: ChimpVibe's
 * spectator mode following that player (engine/gameTv.ts). Seated players see
 * the others beside their own game, a split screen; anyone else in the Game
 * Room sees every player's, on the TV as they walk about or square on when
 * they watch it.
 */
export interface TvPane {
  /** stable while the same game runs and the same player is followed: changing it reloads the frame */
  key: string;
  src: string;
  /** the player followed, and their controller */
  name: string;
  controller: number;
  /**
   * loading: not yet showing (hidden); showing: following the player; waiting:
   * the player isn't in the game (yet, or any more), or nobody is playing yet
   * and it will try again; failed: it can't be watched
   */
  state: "loading" | "showing" | "waiting" | "failed";
  /** its frame said it is showing, and hasn't since failed or gone to try again: it may be seen */
  shown: boolean;
  /** what to say about it, in plain words */
  note: string | null;
}

/** Where a screen in use is on the page, in CSS pixels. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PreviewState {
  loading: boolean;
  progress: number;
  message: string;
  error: string | null;
  fps: number;
  drawCalls: number;
  area: string;
  pos: [number, number, number];
  heading: number;
  speed: number;
  /** walk mode: at avatar height with collisions and gravity, instead of flying */
  walking: boolean;
  /** what the walker is walking into, while it is held up */
  blocked: string | null;
  viewId: string | null;
  night: boolean;
  roofHidden: boolean;
  upperHidden: boolean;
  planOverlay: boolean;
  refOverlay: RefOverlay;
  quality: Quality;
  picked: PickedInfo | null;
  inspectMode: boolean;
  help: boolean;
  pointerLocked: boolean;
  toast: string | null;
  /** walking up to a cabinet: the one that E (or a click on its screen) plays */
  arcadePrompt: { slot: number; name: string; outOfOrder?: boolean; full?: boolean } | null;
  /** a screen in use (a cabinet's game, the theatre's video): ChimpHouse's own keys and mouse look do nothing meanwhile */
  focus: Focus | null;
  /** the games running at cabinets, each in its own frame until quit (engine/arcade.ts) */
  arcadeRunning: RunningGame[];
  /** the screen in use on the page, once the camera is square onto it */
  focusRect: ScreenRect | null;
  theatre: TheatreState;
  /** the theatre's video's title and channel, once YouTube has said */
  theatreVideo: TheatreVideo | null;
  /** why the theatre's video can't play, in plain words */
  theatreError: string | null;
  /** walking up to the theatre screen: E (or a click on it) watches */
  theatrePrompt: boolean;
  /** at the stand under the theatre screen: E picks up remote n, or puts the one held back */
  remotePrompt: { action: "take" | "put"; remote: number } | null;
  /** the lift, as one object the room server can share: the car, its doors, the floors called, who is in a doorway (engine/liftState.ts) */
  lift: LiftState;
  /** a lift button within reach: E (or a click on it) presses it */
  /** the lift button the walker points at, and what pressing it does */
  liftPrompt: { id: string; label: string } | null;
  tv: TvState;
  /** the games the TV's remote can choose from, once loaded, and where they came from */
  tvCatalog: { games: TvGame[]; source: string } | null;
  /** this visitor's game failed to connect: their TV shows static, saying so, until the TV is turned off (only theirs: everyone else's is unaffected) */
  tvFailed: { reason: string } | null;
  /** this visitor's game at the TV while they hold a controller and a game is on, which engine/gameTv.ts places */
  tvFrame: TvFrame | null;
  /** this visitor's game said it is ready (the key of its frame): a seated player's split screen opens once it has */
  tvReady: string | null;
  /** the other players' games this visitor watches at the TV, in controller order */
  tvPanes: TvPane[];
  /**
   * at the Game Room's coffee table: E picks up controller n (and sits down to
   * play) or the remote, or puts the remote down; facing the TV while a game is
   * on, E watches it
   */
  tvPrompt: { action: "take" | "put"; item: "controller" | "remote"; n: number } | { action: "watch"; item: "tv"; n: 0 } | null;
}

type Listener = (s: PreviewState) => void;

class Store {
  private state: PreviewState = {
    loading: true,
    progress: 0,
    message: "Starting…",
    error: null,
    fps: 0,
    drawCalls: 0,
    area: "",
    pos: [0, 0, 0],
    heading: 0,
    speed: 6,
    walking: false,
    blocked: null,
    viewId: null,
    night: false,
    roofHidden: false,
    upperHidden: false,
    planOverlay: false,
    refOverlay: "thumb",
    quality: "high",
    picked: null,
    inspectMode: false,
    help: false,
    pointerLocked: false,
    toast: null,
    arcadePrompt: null,
    focus: null,
    arcadeRunning: [],
    focusRect: null,
    theatre: { videoId: null, playing: false, at: 0, since: 0, live: false, remotes: [] },
    theatreVideo: null,
    theatreError: null,
    theatrePrompt: false,
    remotePrompt: null,
    lift: initialLift(Date.now()),
    liftPrompt: null,
    tv: { game: null, run: 0, controllers: [], seats: [], remote: null },
    tvCatalog: null,
    tvFrame: null,
    tvReady: null,
    tvPanes: [],
    tvFailed: null,
    tvPrompt: null,
  };
  private listeners = new Set<Listener>();

  get(): PreviewState {
    return this.state;
  }

  set(patch: Partial<PreviewState>): void {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof PreviewState)[]) {
      if (this.state[k] !== patch[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const store = new Store();
