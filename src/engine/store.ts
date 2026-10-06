// Minimal observable store shared by the Babylon preview and the React HUD.

export type Quality = "low" | "medium" | "high";
export type RefOverlay = "off" | "thumb" | "full";

export interface PickedInfo {
  label: string;
  point: [number, number, number];
}

/** A game being played at a cabinet. */
export interface PlayingInfo {
  slot: number;
  gameId: string;
  name: string;
  author: string;
  url: string;
  /** gliding in to the screen, at it, or gliding back out */
  phase: "in" | "playing" | "out";
}

/** Where the cabinet's screen is on the page, in CSS pixels. */
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
  arcadePrompt: { slot: number; name: string } | null;
  /** playing at a cabinet: ChimpHouse's own keys and mouse look do nothing meanwhile */
  playing: PlayingInfo | null;
  /** the playing cabinet's screen on the page, once the camera is square onto it */
  playRect: ScreenRect | null;
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
    playing: null,
    playRect: null,
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
