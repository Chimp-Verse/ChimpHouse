// ChimpVibe's embed mode, as an embedder sees it: a game's play page opened
// with ?embed=1 tells its parent window what is happening, in messages of one
// envelope (docs/handoffs/2026-10-06-chimpvibe-embed-messages.md). The mode
// knows nothing about ChimpHouse; this reads it.
//
//   { protocol: "chimpvibe-embed", version: 1, type, ...fields }
//
//   ready { role }        the game can be played, or for a spectator is showing
//   playing               the first input was sent to the game (never to a spectator)
//   follow { name, state } a spectator's followed player: "waiting", "following" or "gone"
//   ended { reason }      play stopped, recoverably: "disconnected", or for a
//                         spectator "no-players" (the last player left)
//   error { code, reason } the game can't be played (or watched) right now
//
// Spectator mode (ChimpVibe's docs/spectator-mode.md) watches a game without
// joining it: ?role=spectator, &follow=<name> for one player's own view,
// &mute=1 for no sound. A spectator is refused while nobody plays.

export const EMBED_PROTOCOL = "chimpvibe-embed";

export type EmbedErrorCode = "unavailable" | "full" | "no-spectators" | "no-players" | "connection" | "renderer" | "other";

export type FollowState = "waiting" | "following" | "gone";

export type EmbedMessage =
  | { type: "ready"; role: "player" | "spectator" }
  | { type: "playing" }
  | { type: "follow"; name: string; state: FollowState }
  | { type: "ended"; reason: string }
  | { type: "error"; code: EmbedErrorCode; reason: string };

const CODES: EmbedErrorCode[] = ["unavailable", "full", "no-spectators", "no-players", "connection", "renderer", "other"];
const FOLLOW: FollowState[] = ["waiting", "following", "gone"];
let warnedVersion = false;

/**
 * A message in the envelope, or null for anything else (other messages a page
 * may receive, or a malformed one). Unknown error codes read as "other"; a
 * reason is cut to a length that fits a cabinet's sign.
 */
export function parseEmbedMessage(data: unknown): EmbedMessage | null {
  const m = data as { protocol?: unknown; version?: unknown; type?: unknown; code?: unknown; reason?: unknown; role?: unknown; name?: unknown; state?: unknown } | null;
  if (!m || typeof m !== "object" || m.protocol !== EMBED_PROTOCOL) return null;
  if (typeof m.version !== "number" || m.version < 1) return null;
  if (m.version > 1 && !warnedVersion) {
    warnedVersion = true;
    console.warn(`[embed] ChimpVibe sends embed protocol version ${m.version}; this reads version 1`);
  }
  const reason = typeof m.reason === "string" ? m.reason.trim().slice(0, 80) : "";
  switch (m.type) {
    case "ready":
      return { type: "ready", role: m.role === "spectator" ? "spectator" : "player" };
    case "playing":
      return { type: "playing" };
    case "follow":
      if (!FOLLOW.includes(m.state as FollowState)) return null;
      return { type: "follow", name: typeof m.name === "string" ? m.name : "", state: m.state as FollowState };
    case "ended":
      // a reason this doesn't know reads as a dropped connection
      return { type: "ended", reason: reason === "no-players" ? reason : "disconnected" };
    case "error": {
      const code = CODES.includes(m.code as EmbedErrorCode) ? (m.code as EmbedErrorCode) : "other";
      return { type: "error", code, reason: reason || ERROR_TEXT[code] };
    }
    default:
      return null;
  }
}

/** What to show for an error code when the page gives no reason. */
const ERROR_TEXT: Record<EmbedErrorCode, string> = {
  unavailable: "Game unavailable",
  full: "Game is full",
  "no-spectators": "Watching isn't available",
  "no-players": "Nobody is playing",
  connection: "Couldn't connect",
  renderer: "The game failed to start",
  other: "Something went wrong",
};

/** What to show when play has ended. */
export function endedText(reason: string): string {
  if (reason === "no-players") return "Nobody is playing";
  return "Disconnected: press Play to reconnect";
}

/** A play page's address in embed mode, joining as `name` when there is one (without, it asks). */
export function inEmbedMode(playUrl: string, name?: string): string {
  const u = new URL(playUrl, location.href);
  u.searchParams.set("embed", "1");
  if (name) u.searchParams.set("name", name);
  return u.href;
}

/** A play page's address for watching in embed mode, without sound: `follow` shows that player's own view, otherwise the game's spectator view. */
export function asSpectator(playUrl: string, follow?: string): string {
  const u = new URL(playUrl, location.href);
  u.searchParams.set("embed", "1");
  u.searchParams.set("role", "spectator");
  if (follow) u.searchParams.set("follow", follow);
  u.searchParams.set("mute", "1");
  return u.href;
}
