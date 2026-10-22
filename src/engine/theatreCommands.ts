// The theatre's commands: what a page may ask of the theatre, and how the room server
// (server/house.ts) runs each one with the pure rules in theatreState.ts. The server owns the
// theatre, so everyone sees the same video at the same moment and the same remotes on the stand.
//
// The server checks every command here: an unknown name or a malformed argument is refused, and
// who sent it is the visitor the server knows the page as. Picking up a remote needs it to be on
// the stand; everything that changes what is showing needs the sender to hold a remote. A page
// runs the same function on its own copy as it sends a command (engine/theatre.ts), and alone
// when there is no room server.

import { MAX_AT, MAX_REMOTES, MAX_SKIP, TheatreState, VIDEO_ID, chooseVideo, initialTheatre, letGoOfRemote, markLive, playerAt, remoteHeldBy, skipBy, takeRemote, togglePlaying, holderOf } from "./theatreState";

/** The topic the theatre is shared as. */
export const THEATRE_TOPIC = "theatre";

export type TheatreCommand =
  /** pick up remote n from the stand */
  | { name: "take"; args: { remote: number } }
  /** put the held remote back on the stand */
  | { name: "put"; args?: undefined }
  /** a holder chose a video or live stream: it starts at `start` s */
  | { name: "choose"; args: { videoId: string; start: number; live: boolean } }
  /** a holder's remote: play or pause */
  | { name: "toggle"; args?: undefined }
  /** a holder's remote: skip back or forward */
  | { name: "skip"; args: { by: number } }
  /** a holder's own player played, paused or ended at `at` s */
  | { name: "player"; args: { playing: boolean; at: number } }
  /** anyone's player found the video to be a live stream */
  | { name: "live"; args: { videoId: string } }
  /** the theatre as the house opens with it, for tests (only when the server allows it) */
  | { name: "reset"; args?: undefined };

const finite = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;

/** The command checked: one of TheatreCommand, or null when it isn't one. */
export function parseTheatreCommand(name: unknown, args: unknown): TheatreCommand | null {
  const a = (args ?? {}) as Record<string, unknown>;
  if (typeof a !== "object" || Array.isArray(a)) return null;
  switch (name) {
    case "take":
      return Number.isInteger(a.remote) && finite(a.remote, 1, MAX_REMOTES) ? { name, args: { remote: a.remote } } : null;
    case "put":
    case "toggle":
    case "reset":
      return { name };
    case "choose":
      return typeof a.videoId === "string" && VIDEO_ID.test(a.videoId) && finite(a.start, 0, MAX_AT) && typeof a.live === "boolean" ? { name, args: { videoId: a.videoId, start: a.start, live: a.live } } : null;
    case "skip":
      return finite(a.by, -MAX_SKIP, MAX_SKIP) ? { name, args: { by: a.by } } : null;
    case "player":
      return typeof a.playing === "boolean" && finite(a.at, 0, MAX_AT) ? { name, args: { playing: a.playing, at: a.at } } : null;
    case "live":
      return typeof a.videoId === "string" && VIDEO_ID.test(a.videoId) ? { name, args: { videoId: a.videoId } } : null;
    default:
      return null;
  }
}

/** The theatre after `who`'s command at `now`, or why it is refused (in plain words). */
export function runTheatreCommand(s: TheatreState, who: string, cmd: TheatreCommand, now: number): TheatreState | string {
  switch (cmd.name) {
    case "reset":
      return initialTheatre();
    case "take":
      if (remoteHeldBy(s, who) !== null) return "you already hold a remote";
      if (holderOf(s, cmd.args.remote) !== null) return "someone else holds that remote";
      return takeRemote(s, who, cmd.args.remote);
    case "put":
      return letGoOfRemote(s, who);
    case "live":
      return markLive(s, cmd.args.videoId);
  }
  // the rest change what is showing: a remote's holder's alone
  if (remoteHeldBy(s, who) === null) return "only a remote's holder controls the theatre";
  switch (cmd.name) {
    case "choose":
      return chooseVideo(s, cmd.args.videoId, cmd.args.start, cmd.args.live, now);
    case "toggle":
      return togglePlaying(s, now);
    case "skip":
      return skipBy(s, cmd.args.by, now);
    case "player":
      return playerAt(s, cmd.args.playing, cmd.args.at, now);
  }
}

/** A visitor has left the house: their remote goes back to the stand, and whatever is showing goes on. */
export function letGoOfTheatre(s: TheatreState, who: string): TheatreState {
  return letGoOfRemote(s, who);
}
