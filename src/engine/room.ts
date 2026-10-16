// This visitor, and the state visitors share. Shared state (the lift's, engine/liftState.ts)
// goes through the room server (server/roomServer.ts), which runs inside the dev server and
// reaches every page it serves, on this computer or across the home network. Each page is a
// visitor of its own: open the preview in two windows, or on two computers, and both see the
// same lift.
//
// Each topic is one object, replaced whole, the newest version winning. The server keeps the
// newest of each, so a visitor who arrives later is told how things stand, and it keeps the
// room's clock (now()), so timed state reads the same for everyone. Visitors say they are here
// every few seconds and say goodbye as their page closes; the server tells everyone when one
// leaves, so what they held is let go of.
//
// Without the dev server (a production build) there is no room server yet: tabs of the same
// browser share state with a BroadcastChannel instead, each answering newcomers itself.

/** A visitor as shared state names them. */
export interface Visitor {
  id: string;
  name: string;
}

const params = new URLSearchParams(location.search);

/** This visitor: a new id per page load, and a name from ?name= or made up (ChimpHouse has no accounts yet). */
export const ME: Visitor = {
  id: `v-${Math.random().toString(36).slice(2, 10)}`,
  name: (params.get("name") ?? "").trim().slice(0, 24) || `Chimp ${Math.floor(1000 + Math.random() * 9000)}`,
};

/** The room server's custom event. Keep in step with server/roomServer.ts. */
const ROOM_EVENT = "chimphouse:room";
const HEARTBEAT_MS = 3000;
/** Without the server: a visitor quiet this long is gone (a background tab's timers slow to about one a minute). */
const GONE_MS = 90_000;

/** A version of a topic's state: the newest wins, ties going to the higher visitor id. */
interface Version {
  n: number;
  by: string;
}

type Message =
  | { kind: "state"; from?: string; topic: string; state: unknown; v: Version }
  | { kind: "hello"; from: string; sent: number }
  | { kind: "here"; from: string; sent: number }
  | { kind: "bye"; from: string }
  | { kind: "gone"; id: string }
  | { kind: "time"; sent: number; t: number };

const newer = (a: Version, b: Version) => a.n > b.n || (a.n === b.n && a.by > b.by);

interface Topic {
  state: unknown;
  v: Version;
  apply: (state: unknown) => void;
}

/** A family of topics, one per visitor: `<prefix><visitor id>` (each visitor's chimp, say). */
interface Family {
  apply: (topic: string, state: unknown) => void;
  /** the newest version seen of each member */
  seen: Map<string, Version>;
}

class Room {
  private hot = import.meta.hot;
  private channel: BroadcastChannel | null = null;
  private topics = new Map<string, Topic>();
  private families = new Map<string, Family>();
  private seen = new Map<string, number>();
  private goneListeners = new Set<(id: string) => void>();
  /** the room's clock less this computer's (ms), and the round trip it was measured over */
  private offset = 0;
  private rtt = Infinity;

  constructor() {
    if (this.hot) this.hot.on(ROOM_EVENT, (m: Message) => this.receive(m));
    else if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("chimphouse-room");
      this.channel.onmessage = (e: MessageEvent<Message>) => this.receive(e.data);
    } else return;
    this.send({ kind: "hello", from: ME.id, sent: Date.now() });
    setInterval(() => {
      this.send({ kind: "here", from: ME.id, sent: Date.now() });
      if (this.channel) {
        const now = Date.now();
        for (const [id, at] of this.seen) if (now - at > GONE_MS) this.gone(id);
      }
    }, HEARTBEAT_MS);
    addEventListener("pagehide", () => this.send({ kind: "bye", from: ME.id }));
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
    this.topics.set(topic, { state: initial, v: { n: 0, by: "" }, apply: apply as (s: unknown) => void });
    // whoever is here already (or the server) says how things stand
    this.send({ kind: "hello", from: ME.id, sent: Date.now() });
    return (state: T) => {
      const t = this.topics.get(topic)!;
      t.state = state;
      t.v = { n: t.v.n + 1, by: ME.id };
      apply(state);
      this.send({ kind: "state", from: ME.id, topic, state, v: t.v });
    };
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
    const own = `${prefix}${ME.id}`;
    // this visitor's member is an ordinary topic, so it is passed on and handed to newcomers as any is
    const set = this.share<T>(own, undefined as T, () => undefined);
    this.send({ kind: "hello", from: ME.id, sent: Date.now() });
    return set;
  }

  /** Call `fn` with each visitor's id as they leave (their page closed, or went quiet). */
  onGone(fn: (id: string) => void): void {
    this.goneListeners.add(fn);
  }

  private receive(m: Message): void {
    switch (m.kind) {
      case "state": {
        const t = this.topics.get(m.topic);
        if (!t) {
          for (const [prefix, f] of this.families) {
            if (!m.topic.startsWith(prefix) || m.topic === `${prefix}${ME.id}`) continue;
            const was = f.seen.get(m.topic);
            if (was && !newer(m.v, was)) return;
            f.seen.set(m.topic, m.v);
            f.apply(m.topic, m.state);
            return;
          }
          return;
        }
        if (!newer(m.v, t.v)) return;
        t.state = m.state;
        t.v = m.v;
        t.apply(m.state);
        return;
      }
      case "time": {
        // the server's clock, from the quickest round trip so far
        const back = Date.now();
        const rtt = back - m.sent;
        if (rtt <= this.rtt) {
          this.rtt = rtt;
          this.offset = m.t - (m.sent + back) / 2;
        }
        return;
      }
      case "gone":
        return this.gone(m.id);
      case "bye":
        return this.gone(m.from);
      case "hello":
      case "here":
        // only between tabs: the server answers for itself
        this.seen.set(m.from, Date.now());
        if (m.kind === "hello") {
          this.send({ kind: "here", from: ME.id, sent: Date.now() });
          for (const [topic, t] of this.topics) if (t.v.n > 0) this.send({ kind: "state", from: ME.id, topic, state: t.state, v: t.v });
        }
    }
  }

  private gone(id: string): void {
    this.seen.delete(id);
    if (id === ME.id) return;
    for (const [prefix, f] of this.families) f.seen.delete(`${prefix}${id}`);
    for (const fn of this.goneListeners) fn(id);
  }

  private send(m: Message): void {
    if (this.hot) this.hot.send(ROOM_EVENT, m);
    else this.channel?.postMessage(m);
  }
}

export const room = new Room();
