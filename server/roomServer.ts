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

      // visitors whose page has closed, or gone quiet
      const sweep = setInterval(() => {
        const open = server.ws.clients;
        const now = Date.now();
        for (const [id, v] of visitors) if (!open.has(v.client) || now - v.seen > GONE_MS) gone(id);
      }, SWEEP_MS);
      server.httpServer?.on("close", () => clearInterval(sweep));
    },
  };
}
