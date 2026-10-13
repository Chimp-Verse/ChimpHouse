// Minimal observable store shared by the Babylon preview and the React HUD.

import type { FoosballView, FoosballPrompt } from "./foosballMatch";
import { LiftState, initialLift } from "./liftState";
import { ME } from "./room";

export type Quality = "low" | "medium" | "high";
export type RefOverlay = "off" | "thumb" | "full";

export interface PickedInfo {
  label: string;
  point: [number, number, number];
}

/** What a screen in use shows (engine/focus.ts): a game at a cabinet, or the theatre's video. */
export type FocusInfo = { kind: "cabinet"; slot: number; gameId: string; name: string; author: string; url: string } | { kind: "theatre" } | { kind: "claw" } | { kind: "pinball"; slot: number; name: string } | { kind: "airHockey"; end: 1 | 2 } | { kind: "foosball"; side: "red" | "blue" } | { kind: "snack" };

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

/** A play of the claw machine, for the HUD while it is played (engine/clawMachine.ts). */
export interface ClawHud {
  phase: string;
  /** seconds left to steer */
  timer: number;
  /** the prizes behind the pickup door */
  won: string[];
  message: string;
}

/** A pinball game being played, for the panel beside the machine (engine/pinball.ts). */
export interface PinballHud {
  slot: number;
  name: string;
  state: "over" | "play" | "bonus";
  score: number;
  ball: number;
  status: string;
  /** the machine's best scores, highest first */
  high: { name: string; score: number }[];
  /** how far the plunger is pulled back, 0..1 */
  pull: number;
  tilted: boolean;
  extra: number;
}

/** Where a screen in use is on the page, in CSS pixels. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Playing air hockey (engine/airHockey.ts): the match as this player sees it. */
export interface AirHockeyHud {
  /** the end this visitor plays (1 red, 2 blue) */
  end: 1 | 2;
  /** red's goals, blue's */
  score: [number, number];
  phase: "idle" | "play" | "goal" | "over";
  /** the end that won the match, once it is over */
  winner: 0 | 1 | 2;
  /** who plays the other end: a visitor's name, or "the robot" */
  opponent: string;
  /** the end the last goal went into, while it is being shown */
  scored: 0 | 1 | 2;
  /** this player has asked for a rematch and waits for the other */
  waiting: boolean;
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
  arcadePrompt: { slot: number; name: string } | null;
  /** a screen in use (a cabinet's game, the theatre's video): ChimpHouse's own keys and mouse look do nothing meanwhile */
  focus: Focus | null;
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
  /** at the claw machine's deck: E plays it */
  clawPrompt: boolean;
  /** the claw machine's play, while this visitor plays it */
  claw: ClawHud | null;
  /** walking up to a pinball machine: E plays it (or who is playing it) */
  pinballPrompt: { slot: number; name: string; busy: string | null } | null;
  /** the pinball game being played, while one is */
  pinball: PinballHud | null;
  /** walking up to the air hockey table: E plays at that end (against the robot, or the visitor at the other end); end null while both ends are taken */
  airHockeyPrompt: { end: 1 | 2 | null; opponent: string } | null;
  /** playing air hockey: the score and the match */
  airHockey: AirHockeyHud | null;
  /** walking up to the foosball table: E plays the side offered, or both sides are taken (engine/foosball.ts) */
  foosballPrompt: FoosballPrompt | null;
  /** playing foosball: the score, the phase, the rod you kick with, for the HUD */
  foosball: FoosballView | null;
  /** at the snack machine: what E does (press the key pointed at, take a snack, step up to the machine), or eat the snack in hand */
  snackPrompt: { action: "key" | "take" | "eat" | "use"; label: string } | null;
  /** the snack in this visitor's hand, by name */
  snackHeld: string | null;
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
    focusRect: null,
    theatre: { videoId: null, playing: false, at: 0, since: 0, live: false, remotes: [] },
    theatreVideo: null,
    theatreError: null,
    theatrePrompt: false,
    remotePrompt: null,
    lift: initialLift(Date.now()),
    liftPrompt: null,
    clawPrompt: false,
    claw: null,
    pinballPrompt: null,
    pinball: null,
    airHockeyPrompt: null,
    airHockey: null,
    foosballPrompt: null,
    foosball: null,
    snackPrompt: null,
    snackHeld: null,
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
