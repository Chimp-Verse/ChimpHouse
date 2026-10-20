// This visitor, and the state visitors share. Shared state goes through ChimpHouse's room server
// (server/, a Colyseus server: `npm run dev` starts it beside the dev server), which every page
// joins wherever it is served from: two windows, or two computers on the home network, see the
// same lift and the same players at the TV.
//
// Two kinds of topic:
// - Shared topics (share, family): one object each, replaced whole, the newest version winning.
//   The pages own them; the server keeps the newest of each, so a visitor who arrives later is
//   told how things stand.
// - The server's topics (watch, command): the lift. Pages send commands; the server runs them
//   and sends everyone the result.
//
// The server keeps the room's clock (now()), so timed state reads the same for everyone, and
// tells everyone when a visitor leaves, so what they held is let go of. A page whose connection
// drops reconnects by itself and is told how things stand; if the server restarted meanwhile, the
// page puts back the shared topics it knows (the lift starts afresh, as the server's own).
//
// The server's address: VITE_CHIMPHOUSE_ROOM_URL when the page was built with it (ws:// or wss://),
// or this page's own host on port VITE_CHIMPHOUSE_ROOM_PORT (2567 unless the dev runner set it).

import { Client, type Room as Connection } from "@colyseus/sdk";
import { LIMITS, MSG, ROOM_NAME, newer, type GoneMsg, type JoinOptions, type RefusedMsg, type TimeReply, type TopicState, type Version, type Welcome } from "./roomProtocol";

/** A visitor as shared state names them. */
export interface Visitor {
  id: string;
  name: string;
}

const params = new URLSearchParams(location.search);

/** This visitor: a new id per page load, and a name from ?name= or made up (ChimpHouse has no accounts yet). */
export const ME: Visitor = {
  id: `v-${Math.random().toString(36).slice(2, 10).padEnd(4, "0")}`,
  name: (params.get("name") ?? "").trim().slice(0, LIMITS.nameChars) || `Chimp ${Math.floor(1000 + Math.random() * 9000)}`,
};

/** The room server's address. */
export function roomUrl(): string {
  const url = import.meta.env.VITE_CHIMPHOUSE_ROOM_URL as string | undefined;
  if (url) return url;
  const port = Number(import.meta.env.VITE_CHIMPHOUSE_ROOM_PORT) || 2567;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:${port}`;
}

/** How often (ms) the page checks its clock against the room's. */
const TIME_MS = 5000;
/** Waits (ms) between attempts to join, growing to the last. */
const JOIN_RETRY_MS = [500, 1000, 2000, 4000, 8000];

interface Topic {
  state: unknown;
  v: Version;
  apply: (state: unknown) => void;
  /** the server's (the lift): changed by commands, never by this page */
  owned: boolean;
}

/** A family of topics, one per visitor: `<prefix><visitor id>` (each visitor's chimp, say). */
interface Family {
  apply: (topic: string, state: unknown) => void;
  /** the newest version seen of each member */
  seen: Map<string, Version>;
}

export type RoomStatus = "connecting" | "connected" | "reconnecting" | "offline";

class Room {
  private client: Client | null = null;
  private conn: Connection | null = null;
  private topics = new Map<string, Topic>();
  private families = new Map<string, Family>();
  /** states for topics nobody here has shared yet: handed over when they are */
  private unclaimed = new Map<string, TopicState>();
  private goneListeners = new Set<(id: string) => void>();
  /** the room's clock less this computer's (ms), and the round trip it was measured over */
  private offset = 0;
  private rtt = Infinity;
  private closing = false;
  private attempt = 0;
  /** where the connection stands, and how many times it has joined (for tests) */
  status: RoomStatus = "connecting";
  joins = 0;

  constructor() {
    if (typeof WebSocket === "undefined") {
      this.status = "offline";
      return;
    }
    this.client = new Client(roomUrl());
    void this.join();
    setInterval(() => this.askTime(), TIME_MS);
    addEventListener("pagehide", () => {
      this.closing = true;
      void this.conn?.leave(true).catch(() => undefined);
    });
  }

  /** The room's time (ms): this computer's clock, set by the room server's. */
  now(): number {
    return Date.now() + this.offset;
  }

  /**
   * Share a topic's state: `apply` is called with it whenever another visitor
   * changes it (and once the room says how it stands, if anyone has). Returns
   * the setter for this visitor's own changes, which applies them here too.
   */
  share<T>(topic: string, initial: T, apply: (state: T) => void): (state: T) => void {
    this.topics.set(topic, { state: initial, v: { n: 0, by: "" }, apply: apply as (s: unknown) => void, owned: false });
    this.claim(topic);
    return (state: T) => {
      const t = this.topics.get(topic)!;
      t.state = state;
      t.v = { n: t.v.n + 1, by: ME.id };
      apply(state);
      this.send(MSG.state, { topic, state, v: t.v });
    };
  }

  /**
   * Follow a topic the server owns (the lift): `apply` is called with its state
   * as the server sends it. Change it with command().
   */
  watch<T>(topic: string, apply: (state: T) => void): void {
    this.topics.set(topic, { state: undefined, v: { n: 0, by: "" }, apply: apply as (s: unknown) => void, owned: true });
    this.claim(topic);
  }

  /** Ask the server to run a command on a topic it owns (the lift: engine/liftCommands.ts). */
  command(topic: string, name: string, args?: Record<string, unknown>): void {
    this.send(MSG.command, { topic, name, args });
  }

  /**
   * Share this visitor's member of a family of topics, `<prefix><visitor id>`,
   * and hear everyone else's: `apply` is called with a member's topic and state
   * whenever its visitor changes it (and for each the room has, as this visitor
   * arrives). Returns the setter for this visitor's own member. Each visitor's
   * members go when they leave (see onGone): the room server forgets them.
   */
  family<T>(prefix: string, apply: (topic: string, state: T) => void): (state: T) => void {
    this.families.set(prefix, { apply: apply as (topic: string, s: unknown) => void, seen: new Map() });
    for (const topic of [...this.unclaimed.keys()]) if (topic.startsWith(prefix)) this.claim(topic);
    // this visitor's member is an ordinary topic, so it is passed on and handed to newcomers as any is
    return this.share<T>(`${prefix}${ME.id}`, undefined as T, () => undefined);
  }

  /** Call `fn` with each visitor's id as they leave (their page closed, or their connection stayed down). */
  onGone(fn: (id: string) => void): void {
    this.goneListeners.add(fn);
  }

  // ------------------------------------------------ the connection

  private async join(): Promise<void> {
    if (!this.client || this.closing) return;
    this.status = this.joins ? "reconnecting" : "connecting";
    try {
      const options: JoinOptions = { id: ME.id, name: ME.name };
      const conn = await this.client.joinOrCreate(ROOM_NAME, options);
      this.attempt = 0;
      this.joins++;
      this.conn = conn;
      this.status = "connected";
      // the SDK reconnects by itself within the server's grace (about 12 s of tries)
      conn.reconnection.maxRetries = 8;
      conn.reconnection.maxDelay = 3000;
      // a page dropped soon after joining reconnects too (the SDK waits 5 s by default; a page that can't is joined afresh below)
      conn.reconnection.minUptime = 1000;
      conn.onMessage(MSG.welcome, (w: Welcome) => this.welcome(w));
      conn.onMessage(MSG.state, (m: TopicState) => this.receive(m));
      conn.onMessage(MSG.gone, (m: GoneMsg) => this.gone(m.id));
      conn.onMessage(MSG.time, (m: TimeReply) => this.timed(m));
      conn.onMessage(MSG.refused, (m: RefusedMsg) => console.warn(`[room] the server refused ${m.what}: ${m.why}`));
      conn.onDrop(() => (this.status = "reconnecting"));
      conn.onReconnect(() => {
        this.status = "connected";
        this.askTime();
      });
      conn.onLeave(() => {
        if (this.conn !== conn) return;
        this.conn = null;
        if (this.closing) return;
        // the server let go of this page (or restarted): join again as the same visitor
        this.status = "reconnecting";
        void this.join();
      });
      this.askTime();
    } catch (e) {
      const wait = JOIN_RETRY_MS[Math.min(this.attempt++, JOIN_RETRY_MS.length - 1)];
      if (this.attempt === 1) console.warn(`[room] can't reach the room server at ${roomUrl()} (${(e as Error)?.message ?? e}); trying again`);
      this.status = "reconnecting";
      setTimeout(() => void this.join(), wait);
    }
  }

  private send(type: string, m: unknown): void {
    const conn = this.conn;
    if (!conn) return;
    try {
      conn.send(type, m);
    } catch {
      // not connected: a shared topic is put back on the next welcome, a command is lost
    }
  }

  private askTime(): void {
    if (this.status === "connected") this.send(MSG.time, { sent: Date.now() });
  }

  // ------------------------------------------------ what the server says

  /** How things stand, as this page joins or comes back. */
  private welcome(w: Welcome): void {
    const there = new Map(w.topics.map((t) => [t.topic, t]));
    for (const t of w.topics) {
      const mine = this.topics.get(t.topic);
      // the server's own topics are as it says, whatever came before (it may have restarted)
      if (mine?.owned) mine.v = { n: 0, by: "" };
      this.receive(t);
    }
    // the shared topics this page knows better than the server (it restarted, or this page's
    // changes were lost while away): put them back
    for (const [topic, t] of this.topics) {
      if (t.owned || t.v.n === 0) continue;
      const known = there.get(topic);
      if (!known || newer(t.v, known.v)) this.send(MSG.state, { topic, state: t.state, v: t.v });
    }
    for (const id of w.departed) this.gone(id);
  }

  private receive(m: TopicState): void {
    const t = this.topics.get(m.topic);
    if (!t) {
      for (const [prefix, f] of this.families) {
        if (!m.topic.startsWith(prefix)) continue;
        if (m.topic === `${prefix}${ME.id}`) return;
        const was = f.seen.get(m.topic);
        if (was && !newer(m.v, was)) return;
        f.seen.set(m.topic, m.v);
        f.apply(m.topic, m.state);
        return;
      }
      const was = this.unclaimed.get(m.topic);
      if (!was || newer(m.v, was.v)) this.unclaimed.set(m.topic, m);
      return;
    }
    if (!newer(m.v, t.v)) return;
    t.state = m.state;
    t.v = m.v;
    t.apply(m.state);
  }

  /** A topic just shared or watched here, or a family member: the state the room already has for it. */
  private claim(topic: string): void {
    const m = this.unclaimed.get(topic);
    if (!m) return;
    this.unclaimed.delete(topic);
    // after the caller has its setter
    queueMicrotask(() => this.receive(m));
  }

  private timed(m: TimeReply): void {
    // the server's clock, from the quickest round trip so far
    const back = Date.now();
    const rtt = back - m.sent;
    if (rtt <= this.rtt) {
      this.rtt = rtt;
      this.offset = m.t - (m.sent + back) / 2;
    }
  }

  private gone(id: string): void {
    if (id === ME.id) return;
    for (const [prefix, f] of this.families) f.seen.delete(`${prefix}${id}`);
    for (const topic of [...this.unclaimed.keys()]) if (topic.endsWith(`:${id}`)) this.unclaimed.delete(topic);
    for (const fn of this.goneListeners) fn(id);
  }

  // ------------------------------------------------ for tests

  /** Cuts the connection as a network fault would (the page reconnects by itself). */
  dropForTest(): void {
    (this.conn?.connection as unknown as { close: (code?: number, reason?: string) => void } | undefined)?.close(4010, "test drop");
  }
}

export const room = new Room();
(window as unknown as { __room: Room }).__room = room;
