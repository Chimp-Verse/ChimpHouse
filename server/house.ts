// The house: the one room type of ChimpHouse's room server. Every visitor's page joins it, and
// it keeps what they share (the client side is src/engine/room.ts, the messages
// src/engine/roomProtocol.ts).
//
// - Shared topics (the TV, the claw machine, each visitor's chimp...): the newest version of
//   each, passed on to everyone else, and handed to whoever joins later. Pages own these: the
//   server only checks their size, their names, and that a visitor writes no other visitor's own.
// - The lift: the server's. Pages send commands (engine/liftCommands.ts), the server runs them
//   one at a time with the rules in engine/liftState.ts, moves the lift on by its own clock, and
//   sends everyone the result.
// - The room's clock: pages ask the time and set theirs by it, so timed state reads the same
//   everywhere.
// - Presence: a visitor whose connection drops keeps their place for RECONNECT_GRACE_S while
//   their page reconnects (they let go of the lift at once; their page tells it again when it is
//   back). After that, or when they close the page, everyone is told they have gone, and the
//   server forgets their own topics.
//
// Everything is kept in memory: restarting the server starts the lift afresh, and pages put
// back the shared topics they know as they reconnect (room.ts).

import { Room, type AuthContext, type Client, type Deferred } from "@colyseus/core";
import { LiftState, advanceLift, initialLift } from "../src/engine/liftState";
import { LIFT_TOPIC, letGoOfLift, parseLiftCommand, runLiftCommand } from "../src/engine/liftCommands";
import { LIMITS, MSG, RECONNECT_GRACE_S, newer, type CommandMsg, type JoinOptions, type StateMsg, type TimeAsk, type TopicState, type Version, type Welcome } from "../src/engine/roomProtocol";

/** How many of the visitors who left a newcomer is told about (they let go of anything those still hold). */
const DEPARTED = 100;
/** How often (ms) the server moves the lift on through its timed steps. */
const LIFT_TICK_MS = 100;

/** A token bucket: `rate` a second on average, up to `burst` at once. */
class Bucket {
  private tokens: number;
  private at = Date.now();
  constructor(
    private rate: number,
    private burst: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

interface Visitor {
  id: string;
  name: string;
  sessionId: string;
  /** dropped, and held for a reconnect: the deferred that gives up on them */
  held: Deferred<Client> | null;
  messages: Bucket;
  commands: Bucket;
  /** messages dropped since the last report */
  dropped: number;
}

export interface HouseOptions {
  /** allow the lift's "reset" command (tests) */
  testCommands?: boolean;
  /** the sites (origins, e.g. https://chimphouse.example) whose pages may join; any, when not given */
  origins?: string[];
}

export class House extends Room {
  maxClients = 200;
  // the house stays open while nobody is in it, with its lift and shared topics as they were
  autoDispose = false;
  // no Colyseus schema state: everything travels as messages
  patchRate = null;
  maxMessagesPerSecond = LIMITS.hardMessagesPerSecond;

  private topics = new Map<string, { state: unknown; v: Version; bytes: number }>();
  private lift: LiftState = initialLift(Date.now());
  private liftV: Version = { n: 1, by: "server" };
  private visitors = new Map<string, Visitor>();
  private bySession = new Map<string, Visitor>();
  private departed: string[] = [];
  private testCommands = false;
  private origins: string[] | null = null;
  private peak = { bytes: 0, topic: "" };

  onCreate(options: HouseOptions = {}) {
    this.testCommands = !!options.testCommands;
    this.origins = options.origins?.length ? options.origins : null;
    this.onMessage(MSG.state, (client: Client, m: StateMsg) => this.onState(client, m));
    this.onMessage(MSG.command, (client: Client, m: CommandMsg) => this.onCommand(client, m));
    this.onMessage(MSG.time, (client: Client, m: TimeAsk) => {
      const v = this.bySession.get(client.sessionId);
      if (!v || !this.allowed(client, v, "time")) return;
      if (typeof m?.sent === "number" && Number.isFinite(m.sent)) client.send(MSG.time, { sent: m.sent, t: Date.now() });
    });
    // anything else is refused
    this.onMessage("*", (client: Client, type: string | number) => this.refuse(client, String(type).slice(0, 40), "unknown message"));
    // the lift's timed steps (the car arriving, the doors opening and shutting) on the server's clock
    this.clock.setInterval(() => {
      const next = advanceLift(this.lift, Date.now());
      if (next !== this.lift) this.setLift(next);
    }, LIFT_TICK_MS);
    // a short report of what is going on, now and then
    this.clock.setInterval(() => this.report(), 60_000);
  }

  /** Only pages from the sites allowed, when the server was given a list. */
  onAuth(_client: Client, _options: unknown, context: AuthContext) {
    if (!this.origins) return true;
    const origin = context.headers?.get("origin") ?? "";
    if (!this.origins.includes(origin)) throw new Error("This house doesn't take visitors from that site");
    return true;
  }

  onJoin(client: Client, options: JoinOptions) {
    const id = String(options?.id ?? "");
    if (!LIMITS.visitorId.test(id)) throw new Error("A visitor id like v-abc123 is needed to join");
    const name = String(options?.name ?? "").trim().slice(0, LIMITS.nameChars) || "A chimp";
    const was = this.visitors.get(id);
    if (was) {
      // the same visitor joining again: a page whose reconnect gave up while the server still held
      // its place takes it over; a visitor id already in use by a connected page is refused
      if (!was.held) throw new Error("That visitor is already here");
      this.bySession.delete(was.sessionId);
      was.held.reject();
    }
    const v: Visitor = {
      id,
      name,
      sessionId: client.sessionId,
      held: null,
      messages: new Bucket(LIMITS.messagesPerSecond, LIMITS.messageBurst),
      commands: new Bucket(LIMITS.commandsPerSecond, LIMITS.commandBurst),
      dropped: 0,
    };
    this.visitors.set(id, v);
    this.bySession.set(client.sessionId, v);
    // one taken as gone who is back
    const back = this.departed.indexOf(id);
    if (back >= 0) this.departed.splice(back, 1);
    this.welcome(client, v);
  }

  onDrop(client: Client) {
    const v = this.bySession.get(client.sessionId);
    if (!v) return;
    const held = this.allowReconnection(client, RECONNECT_GRACE_S);
    v.held = held;
    // while away they hold nothing at the lift: their page says where they are when it is back
    this.setLift(letGoOfLift(this.lift, v.id, Date.now()));
  }

  onReconnect(client: Client) {
    const v = this.bySession.get(client.sessionId);
    if (!v) return;
    v.held = null;
    // how things stand now: what changed while they were away
    this.welcome(client, v);
  }

  onLeave(client: Client) {
    const v = this.bySession.get(client.sessionId);
    this.bySession.delete(client.sessionId);
    // gone, unless the visitor has already joined again under a new session
    if (!v || this.visitors.get(v.id) !== v) return;
    this.visitors.delete(v.id);
    this.gone(v.id);
  }

  // ------------------------------------------------ messages

  private welcome(client: Client, v: Visitor) {
    const topics: TopicState[] = [...this.topics].map(([topic, t]) => ({ topic, state: t.state, v: t.v }));
    topics.push({ topic: LIFT_TOPIC, state: advanceLift(this.lift, Date.now()), v: this.liftV });
    const w: Welcome = { you: v.id, t: Date.now(), topics, owned: [LIFT_TOPIC], departed: [...this.departed] };
    client.send(MSG.welcome, w);
  }

  private onState(client: Client, m: StateMsg) {
    const v = this.bySession.get(client.sessionId);
    if (!v || !this.allowed(client, v, "state")) return;
    const topic = m?.topic;
    if (typeof topic !== "string" || !LIMITS.topic.test(topic)) return this.refuse(client, String(topic).slice(0, 80), "not a topic name");
    if (topic === LIFT_TOPIC) return this.refuse(client, topic, "the lift takes commands, not states");
    // a visitor's own topics (their chimp, "chimp:<id>") are theirs alone to write
    const owner = /:(v-[a-z0-9]+)$/.exec(topic)?.[1];
    if (owner && owner !== v.id) return this.refuse(client, topic, "another visitor's topic");
    const n = m.v?.n;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > LIMITS.maxVersion) return this.refuse(client, topic, "not a version");
    const bytes = sizeOf(m.state);
    if (bytes < 0 || bytes > LIMITS.stateBytes) return this.refuse(client, topic, `state too large (${bytes} bytes, at most ${LIMITS.stateBytes})`);
    const t = this.topics.get(topic);
    if (!t && this.topics.size >= LIMITS.topics) return this.refuse(client, topic, "the house holds no more topics");
    // who wrote it is the visitor the server knows, whatever the page says
    const version: Version = { n, by: v.id };
    if (t && !newer(version, t.v)) {
      // an older change (two at once, or a page behind): the sender is put right
      client.send(MSG.state, { topic, state: t.state, v: t.v });
      return;
    }
    this.topics.set(topic, { state: m.state, v: version, bytes });
    if (bytes > this.peak.bytes) this.peak = { bytes, topic };
    this.broadcast(MSG.state, { topic, state: m.state, v: version }, { except: client });
  }

  private onCommand(client: Client, m: CommandMsg) {
    const v = this.bySession.get(client.sessionId);
    if (!v || !this.allowed(client, v, "command")) return;
    if (!v.commands.take()) {
      v.dropped++;
      return;
    }
    if (m?.topic !== LIFT_TOPIC) return this.refuse(client, String(m?.topic).slice(0, 80), "no commands for that topic");
    const cmd = parseLiftCommand(m.name, m.args);
    if (!cmd) return this.refuse(client, `${LIFT_TOPIC} ${String(m.name).slice(0, 40)}`, "not a lift command");
    if (cmd.name === "reset" && !this.testCommands) return this.refuse(client, "lift reset", "only on a test server");
    this.setLift(runLiftCommand(this.lift, v.id, cmd, Date.now()));
  }

  /** The visitor's message allowance: false (and the message dropped) when they are sending too fast. */
  private allowed(_client: Client, v: Visitor, _what: string): boolean {
    if (v.messages.take()) return true;
    v.dropped++;
    return false;
  }

  private refuse(client: Client, what: string, why: string) {
    client.send(MSG.refused, { what, why });
  }

  private setLift(next: LiftState) {
    if (next === this.lift) return;
    this.lift = next;
    this.liftV = { n: this.liftV.n + 1, by: "server" };
    this.broadcast(MSG.state, { topic: LIFT_TOPIC, state: next, v: this.liftV });
  }

  private gone(id: string) {
    this.departed.push(id);
    if (this.departed.length > DEPARTED) this.departed.shift();
    // a visitor's own topics (a family member such as their chimp, "chimp:<id>") go with them
    for (const topic of this.topics.keys()) if (topic.endsWith(`:${id}`)) this.topics.delete(topic);
    this.setLift(letGoOfLift(this.lift, id, Date.now()));
    this.broadcast(MSG.gone, { id });
  }

  private report() {
    let dropped = 0;
    for (const v of this.visitors.values()) {
      dropped += v.dropped;
      v.dropped = 0;
    }
    if (!this.visitors.size && !dropped) return;
    console.log(
      `[house] ${this.visitors.size} visitor(s), ${this.topics.size} topic(s), largest state ${this.peak.bytes} bytes (${this.peak.topic || "none"})${dropped ? `, ${dropped} message(s) dropped for sending too fast` : ""}`,
    );
  }
}

/** The size of a state as JSON (bytes, near enough), or -1 when it can't be measured. */
function sizeOf(state: unknown): number {
  try {
    return JSON.stringify(state ?? null).length;
  } catch {
    return -1;
  }
}
