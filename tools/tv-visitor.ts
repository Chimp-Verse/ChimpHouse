// A light visitor at the Game Room TV (tools/tv-visitor.html), driven by tools/test-tv-real.mjs.
import { asSpectator, inEmbedMode } from "../src/engine/embed";
import { ME, room } from "../src/engine/room";
import type { TvState } from "../src/engine/store";

let tv: TvState = { game: null, run: 0, controllers: [null, null, null, null], seats: [null, null, null, null], remote: null };
let heard = false;
const setTv = room.share<TvState>("tv", tv, (s) => {
  tv = s;
  heard = true;
});

/** Every embed message from this page's frames: which frame, when (ms since load), and what. */
const log: { frame: string; t: number; origin: string; data: unknown }[] = [];
const frames = new Map<string, HTMLIFrameElement>();
addEventListener("message", (e) => {
  for (const [name, el] of frames) if (e.source === el.contentWindow) log.push({ frame: name, t: Math.round(performance.now()), origin: e.origin, data: e.data });
});

function open(name: string, src: string): string {
  close(name);
  const el = document.createElement("iframe");
  el.src = src;
  el.title = name;
  el.allow = "autoplay; fullscreen; gamepad";
  frames.set(name, el);
  document.body.append(el);
  return src;
}

function close(name: string): void {
  frames.get(name)?.remove();
  frames.delete(name);
}

(window as unknown as { visitor: unknown }).visitor = {
  me: ME,
  heard: () => heard,
  tv: () => tv,
  log: () => log,
  /**
   * Pick up controller n in the shared state, as engine/gameTv.ts does (a house visitor's TV then
   * splits for this player): with a game left playing on it, taking it over. Returns the name to play as.
   */
  take(n: number): string | null {
    const controllers = [...tv.controllers];
    controllers[n - 1] = { ...ME };
    const seats = [...tv.seats];
    const was = seats[n - 1];
    if (tv.game) seats[n - 1] = was ? { name: was.name, host: ME.id, handover: was.host !== ME.id } : { name: ME.name, host: ME.id, handover: false };
    setTv({ ...tv, controllers, seats });
    return seats[n - 1]?.name ?? null;
  },
  /** put the controller down: the game plays on */
  putDown() {
    setTv({ ...tv, controllers: tv.controllers.map((h) => (h?.id === ME.id ? null : h)) });
  },
  /** quit: the controller down and this visitor's player out of the game */
  quit() {
    setTv({ ...tv, controllers: tv.controllers.map((h) => (h?.id === ME.id ? null : h)), seats: tv.seats.map((st) => (st?.host === ME.id ? null : st)) });
    close("player");
  },
  /** play the TV's game, as this visitor or under `name` (a game taken over) */
  play: (name?: string) => open("player", inEmbedMode(tv.game!.playUrl, name ?? ME.name)),
  /** watch the TV's game, following `follow` or not */
  watch: (name: string, follow?: string) => open(name, asSpectator(tv.game!.playUrl, follow)),
  close,
  focus: (name: string) => frames.get(name)?.focus(),
};
