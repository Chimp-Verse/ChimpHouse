// The room server, until ChimpHouse has one of its own: a Vite plugin that lets every page the
// dev server serves (npm run dev, or the LAN demo) share state, over the WebSocket Vite already
// keeps open to each page for hot reloading. The client side is src/engine/room.ts.
//
// It keeps the newest version of each topic (the lift's state, say), so a visitor who comes
// later is told how things stand; passes each change on to everyone else; keeps the room's
// clock, so timed state (where the car is, how far into the music) is the same for everyone
// whatever their computer's clock says; and tells everyone when a visitor leaves: their tab
// closed, or (a crashed tab) went quiet.

import type { Plugin, ViteDevServer } from "vite";

/** The custom event the room's messages travel as. Keep in step with src/engine/room.ts. */
export const ROOM_EVENT = "chimphouse:room";

/** A visitor that hasn't said it's here for this long is taken as gone (a background tab's timers slow to about one a minute). */
const GONE_MS = 90_000;
const SWEEP_MS = 3000;
/** Pages say they're here every 3 s: one quiet this long, when there are fewer pages open than visitors known, is one that closed without saying goodbye. */
const QUIET_MS = 10_000;

interface Version {
  n: number;
  by: string;
}

type FromPage =
  | { kind: "hello"; from: string; sent: number }
  | { kind: "here"; from: string; sent: number }
  | { kind: "bye"; from: string }
  | { kind: "state"; from: string; topic: string; state: unknown; v: Version };

type ToPage = { kind: "state"; topic: string; state: unknown; v: Version } | { kind: "gone"; id: string } | { kind: "time"; sent: number; t: number };

type Client = ViteDevServer["ws"]["clients"] extends Set<infer C> ? C : never;

const newer = (a: Version, b: Version) => a.n > b.n || (a.n === b.n && a.by > b.by);

export function roomServer(): Plugin {
  return {
    name: "chimphouse-room",
    apply: "serve",
    configureServer(server) {
      const topics = new Map<string, { state: unknown; v: Version }>();
      const visitors = new Map<string, { client: Client; seen: number }>();
      const send = (client: Client, m: ToPage) => client.send(ROOM_EVENT, m);
      const others = (from: string, m: ToPage) => {
        for (const c of server.ws.clients) if (c !== visitors.get(from)?.client) send(c, m);
      };
      const gone = (id: string) => {
        if (!visitors.delete(id)) return;
        // a visitor's own topics (a family member such as their chimp, "chimp:<id>") go with them
        for (const topic of topics.keys()) if (topic.endsWith(`:${id}`)) topics.delete(topic);
        for (const c of server.ws.clients) send(c, { kind: "gone", id });
      };

      server.ws.on(ROOM_EVENT, (m: FromPage, client: Client) => {
        if (m.kind === "bye") return gone(m.from);
        visitors.set(m.from, { client, seen: Date.now() });
        if (m.kind === "hello" || m.kind === "here") {
          send(client, { kind: "time", sent: m.sent, t: Date.now() });
          // a newcomer: how things stand
          if (m.kind === "hello") for (const [topic, t] of topics) send(client, { kind: "state", topic, state: t.state, v: t.v });
          return;
        }
        const t = topics.get(m.topic);
        if (t && !newer(m.v, t.v)) {
          // an older change (two at once, or a page behind): the sender is put right
          send(client, { kind: "state", topic: m.topic, state: t.state, v: t.v });
          return;
        }
        topics.set(m.topic, { state: m.state, v: m.v });
        others(m.from, { kind: "state", topic: m.topic, state: m.state, v: m.v });
      });

      // visitors whose page has closed, or gone quiet. Vite hands this listener a wrapper of each
      // page's socket, never the socket itself that server.ws.clients holds, so a closed page can't
      // be matched to its visitor (testing membership would find every visitor gone at every sweep).
      // Instead: when fewer pages are open than visitors are known, the quiet ones are those that
      // closed; and a visitor quiet for GONE_MS is gone whatever the count.
      const sweep = setInterval(() => {
        const now = Date.now();
        const missing = visitors.size - server.ws.clients.size;
        if (missing > 0) {
          const quiet = [...visitors].filter(([, v]) => now - v.seen > QUIET_MS).sort((a, b) => a[1].seen - b[1].seen);
          for (const [id] of quiet.slice(0, missing)) gone(id);
        }
        for (const [id, v] of visitors) if (now - v.seen > GONE_MS) gone(id);
      }, SWEEP_MS);
      server.httpServer?.on("close", () => clearInterval(sweep));
    },
  };
}
