// ChimpHouse's room server: a Colyseus server with one room type, the house (house.ts).
//
//   npm run room                       on localhost:2567, from the source (development)
//   npm run room:build                 compile it to server/dist
//   npm run room:start                 run the compiled server, in production mode
//
// `npm run dev` and `npm run dev:lan` start it beside Vite (tools/dev.mjs). Hosting it online is
// in docs/deploy.md. Settings, all from the environment:
//   NODE_ENV=production            production mode (npm run room:start sets it): the origin list below
//                                  is required, and test commands are off whatever is asked for
//   PORT                           the port, when the host sets one (Render, Railway, Koyeb, DigitalOcean...)
//   CHIMPHOUSE_ROOM_PORT           the port otherwise (default 2567)
//   CHIMPHOUSE_ROOM_HOST           the address to listen on (default localhost; 0.0.0.0 for every network)
//   CHIMPHOUSE_ROOM_ORIGINS        the sites whose pages may join, comma-separated, e.g.
//                                  https://house.example.com (required in production; any, otherwise)
//   CHIMPHOUSE_ROOM_TEST_COMMANDS  1 allows commands only tests need (putting the lift back as it starts);
//                                  ignored in production
//
// GET /health answers 200 {"ok":true} for the host's health checks. SIGTERM and SIGINT (a deploy,
// a stop) end the server cleanly: visitors are disconnected, then the process exits.

import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { House, type HouseOptions } from "./house";
import { LIMITS, ROOM_NAME } from "../src/engine/roomProtocol";

/** How long (ms) a shutdown may take before the process exits regardless. */
const SHUTDOWN_LIMIT_MS = 10_000;

/** The minimal shape of the Express app Colyseus gives us (its types are not installed). */
interface HealthApp {
  get(path: string, handler: (req: unknown, res: { status(code: number): { json(body: unknown): void } }) => void): unknown;
}

function fail(message: string): never {
  console.error(`ChimpHouse room server: ${message}`);
  process.exit(1);
}

async function main() {
  const production = process.env.NODE_ENV === "production";
  const port = Number(process.env.PORT) || Number(process.env.CHIMPHOUSE_ROOM_PORT) || 2567;
  const host = process.env.CHIMPHOUSE_ROOM_HOST || "localhost";
  // an origin never has a path: a trailing slash typed by mistake is dropped
  const origins = (process.env.CHIMPHOUSE_ROOM_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  if (production && !origins.length) {
    fail(
      "CHIMPHOUSE_ROOM_ORIGINS is not set. In production it must list the sites whose pages may join, e.g. " +
        "CHIMPHOUSE_ROOM_ORIGINS=https://house.example.com (several: separate them with commas). " +
        "Without it any site could use this server.",
    );
  }
  for (const o of origins) {
    if (!/^https?:\/\/[^/\s]+$/.test(o)) fail(`"${o}" in CHIMPHOUSE_ROOM_ORIGINS is not an origin like https://house.example.com`);
  }
  const wantsTestCommands = process.env.CHIMPHOUSE_ROOM_TEST_COMMANDS === "1";
  if (production && wantsTestCommands) console.warn("ChimpHouse room server: CHIMPHOUSE_ROOM_TEST_COMMANDS is ignored in production");
  const options: HouseOptions = { testCommands: wantsTestCommands && !production, origins };

  const server = new Server({
    transport: new WebSocketTransport({ maxPayload: LIMITS.payloadBytes }),
    express: (app: HealthApp) => {
      app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
    },
    greet: false,
    // stopped below, with a limit on how long that may take
    gracefullyShutdown: false,
  });
  server.define(ROOM_NAME, House, options);

  let stopping = false;
  const stop = (why: string, code: number) => {
    if (stopping) return;
    stopping = true;
    console.log(`ChimpHouse room server: stopping (${why})`);
    setTimeout(() => process.exit(code || 1), SHUTDOWN_LIMIT_MS).unref();
    // gracefullyShutdown closes the rooms and the connections, then exits with the code
    server.gracefullyShutdown(false).finally(() => process.exit(code));
  };
  process.on("SIGTERM", () => stop("SIGTERM", 0));
  process.on("SIGINT", () => stop("SIGINT", 0));
  process.on("uncaughtException", (err) => {
    console.error("ChimpHouse room server: uncaught exception", err);
    stop("uncaught exception", 1);
  });
  process.on("unhandledRejection", (err) => {
    console.error("ChimpHouse room server: unhandled rejection", err);
  });

  await server.listen(port, host);
  console.log(
    `ChimpHouse room server listening on ws://${host}:${port}` +
      (production ? " (production)" : "") +
      (origins.length ? ` (pages from ${origins.join(", ")})` : " (pages from any site)") +
      (options.testCommands ? " (test commands on)" : ""),
  );
}

main().catch((err) => {
  console.error("ChimpHouse room server: could not start", err);
  process.exit(1);
});
