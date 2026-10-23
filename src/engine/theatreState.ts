// The theatre's shared state, and the pure rules that change it: what is showing on the screen,
// playing or paused, where it was at a moment, and who holds each remote. The room server owns it
// (server/house.ts runs these through engine/theatreCommands.ts); a page runs the same rules on its
// own copy as it sends a command, so its own visitor sees the change at once, and runs them alone
// when there is no room server. Imported by both sides, so keep it free of the browser and of Node.
//
// Times are on the room's clock (room.now() in a page, Date.now() on the server).

export interface TheatreState {
  /** the YouTube video or live stream on the screen, or null */
  videoId: string | null;
  playing: boolean;
  /** seconds into the video at `since` */
  at: number;
  /** when it was at `at` (the room's clock, ms) */
  since: number;
  /** a live stream: viewers join it live, not at `at` */
  live: boolean;
  /** who holds each remote (remote n at n - 1), or null (or missing) while it is on the stand: a holder controls the theatre */
  remotes: (string | null)[];
}

/** The most remotes the theatre may have (the stand has two). */
export const MAX_REMOTES = 8;
/** How far one skip may go (s). */
export const MAX_SKIP = 600;
/** The furthest into a video it may be said to be (s): a live stream's time is how long it has been running, which can be years. */
export const MAX_AT = 1e9;
/** A YouTube video's ID. */
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function initialTheatre(): TheatreState {
  return { videoId: null, playing: false, at: 0, since: 0, live: false, remotes: [] };
}

/** Where the theatre's video is at `now`, in seconds. */
export function theatreAt(s: TheatreState, now: number): number {
  return s.playing ? s.at + (now - s.since) / 1000 : s.at;
}

/** Who holds remote n (1, 2…), or null while it is on the stand. */
export function holderOf(s: TheatreState, n: number): string | null {
  return s.remotes[n - 1] ?? null;
}

/** The remote `who` holds (1, 2…), or null. */
export function remoteHeldBy(s: TheatreState, who: string): number | null {
  const i = s.remotes.indexOf(who);
  return i < 0 ? null : i + 1;
}

/** `who` picks up remote n: only while it is on the stand and they hold none. */
export function takeRemote(s: TheatreState, who: string, n: number): TheatreState {
  if (n < 1 || n > MAX_REMOTES || holderOf(s, n) !== null || remoteHeldBy(s, who) !== null) return s;
  const remotes = Array.from({ length: Math.max(s.remotes.length, n) }, (_, i) => s.remotes[i] ?? null);
  remotes[n - 1] = who;
  return { ...s, remotes };
}

/** `who` puts their remote back on the stand (they set it down, left the theatre, or left the house). Playback goes on. */
export function letGoOfRemote(s: TheatreState, who: string): TheatreState {
  if (remoteHeldBy(s, who) === null) return s;
  return { ...s, remotes: s.remotes.map((h) => (h === who ? null : (h ?? null))) };
}

/** A video chosen: it starts at `start` at once (the same video again starts over). */
export function chooseVideo(s: TheatreState, videoId: string, start: number, live: boolean, now: number): TheatreState {
  return { ...s, videoId, playing: true, at: start, since: now, live };
}

/** Play or pause, from where it is now. */
export function togglePlaying(s: TheatreState, now: number): TheatreState {
  if (!s.videoId) return s;
  return { ...s, playing: !s.playing, at: theatreAt(s, now), since: now };
}

/** Skip back or forward `by` seconds. */
export function skipBy(s: TheatreState, by: number, now: number): TheatreState {
  if (!s.videoId) return s;
  return { ...s, at: Math.max(0, theatreAt(s, now) + by), since: now };
}

/** A holder's player played, paused or ended at `at` s: the theatre follows it. */
export function playerAt(s: TheatreState, playing: boolean, at: number, now: number): TheatreState {
  if (!s.videoId) return s;
  return { ...s, playing, at: Math.max(0, at), since: now };
}

/** The video turned out to be a live stream (its player started far past where it was cued). */
export function markLive(s: TheatreState, videoId: string): TheatreState {
  return s.videoId === videoId && !s.live ? { ...s, live: true } : s;
}
