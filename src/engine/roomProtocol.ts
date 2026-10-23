// What the pages and the room server (server/house.ts) say to each other, and the limits the
// server holds them to. Imported by both sides, so keep it free of the browser and of Node.

/** The room type pages join: the house. */
export const ROOM_NAME = "house";

/** A version of a topic's state: the newest wins, ties going to the higher visitor id. */
export interface Version {
  n: number;
  by: string;
}

export const newer = (a: Version, b: Version) => a.n > b.n || (a.n === b.n && a.by > b.by);

/** A topic's state as the server holds it. */
export interface TopicState {
  topic: string;
  state: unknown;
  v: Version;
}

/** Who a page says it is as it joins: its visitor id (made up per page load) and its name. */
export interface JoinOptions {
  id: string;
  name: string;
  /**
   * The name was chosen in the lobby and the server took it (a page joining again after a
   * restart or a long drop): it counts as taken for anyone asking for it after. Left out by older
   * pages, and by a page whose visitor hasn't chosen yet.
   */
  named?: boolean;
}

/** Normalised for comparing: two names that differ only in case or spacing are the same name. */
export const nameKey = (name: string) => cleanName(name).toLowerCase();

/** A name as it is shown: trimmed, runs of spaces made one, no control characters. */
export function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

// ------------------------------------------------ page to server

/** A visitor's change to a shared topic (one the pages own: not the lift). */
export interface StateMsg {
  topic: string;
  state: unknown;
  v: Version;
}

/** A command to a topic the server owns (the lift): the server runs it, and sends everyone the result. */
export interface CommandMsg {
  topic: string;
  name: string;
  args?: Record<string, unknown>;
}

/** The lobby asking for a name (`ask` matches the answer to the question): the server says whether it is free. */
export interface ClaimNameMsg {
  ask: number;
  name: string;
}

/** A clock check: the server answers with its time. */
export interface TimeAsk {
  sent: number;
}

// ------------------------------------------------ server to page

/** How things stand, as a page joins or comes back: every topic, the room's time and who has left lately. */
export interface Welcome {
  /** the visitor id the server knows this page by */
  you: string;
  t: number;
  topics: TopicState[];
  /** topics the server owns (commands only) */
  owned: string[];
  departed: string[];
}

export interface TimeReply {
  sent: number;
  t: number;
}

export interface GoneMsg {
  id: string;
}

/**
 * The answer to a ClaimNameMsg: `ok` and the name now this visitor's, or why not, with a free
 * name like it to offer (`suggestion`) when it was taken.
 */
export interface NamedMsg {
  ask: number;
  ok: boolean;
  name: string;
  why?: "taken" | "empty" | "long";
  suggestion?: string;
}

/** The server turned a message down (for the page's console: a feature sending too much, or to the wrong place). */
export interface RefusedMsg {
  what: string;
  why: string;
}

/** The message types, both ways. */
export const MSG = {
  welcome: "welcome",
  state: "state",
  command: "cmd",
  time: "time",
  gone: "gone",
  refused: "refused",
  /** page to server: ClaimNameMsg; server to page: NamedMsg */
  claimName: "name",
  named: "named",
} as const;

// ------------------------------------------------ limits

export const LIMITS = {
  /** a visitor id, as room.ts makes them */
  visitorId: /^v-[a-z0-9]{4,16}$/,
  nameChars: 24,
  /** a name chosen in the lobby (the 24 above is what older pages may still send) */
  chosenNameChars: 16,
  /** topic names: letters, digits and / : _ - . only */
  topic: /^[A-Za-z0-9/:_.-]{1,80}$/,
  /** the largest state one topic may hold (bytes of its JSON) */
  stateBytes: 32 * 1024,
  /** how many topics the house holds at most */
  topics: 800,
  /** the largest message the server reads (bytes on the wire) */
  payloadBytes: 64 * 1024,
  /** messages a page may send each second, on average, and in a burst: more are dropped */
  messagesPerSecond: 200,
  messageBurst: 400,
  /** lift commands a page may send each second, on average, and in a burst */
  commandsPerSecond: 10,
  commandBurst: 20,
  /** a page sending this many messages in one second is cut off (it isn't a ChimpHouse page) */
  hardMessagesPerSecond: 800,
  /** the highest version number a topic may have */
  maxVersion: 2 ** 40,
} as const;

/** A free name like `name` ("Bob 2", "Bob 3"...), within the lobby's length, when `taken(key)` says it is in use. */
export function freeName(name: string, taken: (key: string) => boolean): string {
  const base = cleanName(name);
  for (let n = 2; n < 1000; n++) {
    const tail = ` ${n}`;
    const tryName = `${base.slice(0, LIMITS.chosenNameChars - tail.length).trim()}${tail}`;
    if (!taken(nameKey(tryName))) return tryName;
  }
  return `Chimp ${Math.floor(1000 + Math.random() * 9000)}`;
}

/** How long (s) the server holds a dropped visitor's place while their page tries to come back. */
export const RECONNECT_GRACE_S = 15;
