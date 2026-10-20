// ChimpHouse's room server: a Colyseus server with one room type, the house (house.ts).
//
//   npm run room                       on localhost:2567
//   CHIMPHOUSE_ROOM_HOST=0.0.0.0 CHIMPHOUSE_ROOM_PORT=2568 npm run room
//
// `npm run dev` and `npm run dev:lan` start it beside Vite (tools/dev.mjs). Settings, all from
// the environment:
//   CHIMPHOUSE_ROOM_PORT           the port (default 2567)
//   CHIMPHOUSE_ROOM_HOST           the address to listen on (default localhost; 0.0.0.0 for every network)
//   CHIMPHOUSE_ROOM_ORIGINS        the sites whose pages may join, comma-separated (default: any)
//   CHIMPHOUSE_ROOM_TEST_COMMANDS  1 allows commands only tests need (putting the lift back as it starts)

import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { House, type HouseOptions } from "./house";
import { LIMITS, ROOM_NAME } from "../src/engine/roomProtocol";

const port = Number(process.env.CHIMPHOUSE_ROOM_PORT) || 2567;
const host = process.env.CHIMPHOUSE_ROOM_HOST || "localhost";
const origins = (process.env.CHIMPHOUSE_ROOM_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const options: HouseOptions = { testCommands: process.env.CHIMPHOUSE_ROOM_TEST_COMMANDS === "1", origins };

const server = new Server({
  transport: new WebSocketTransport({ maxPayload: LIMITS.payloadBytes }),
  greet: false,
});
server.define(ROOM_NAME, House, options);
await server.listen(port, host);
console.log(
  `ChimpHouse room server listening on ws://${host}:${port}` +
    (origins.length ? ` (pages from ${origins.join(", ")})` : "") +
    (options.testCommands ? " (test commands on)" : ""),
);
