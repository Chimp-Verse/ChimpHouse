// `npm run dev` and `npm run dev:lan`: the room server (server/main.ts) and Vite's dev server,
// started together and stopped together.
//
//   node tools/dev.mjs [--mode lan] [more Vite options]
//
// Settings come from the environment, or the mode's env files as Vite reads them:
//   CHIMPHOUSE_HOST         where Vite listens (the LAN demo: this computer's address); the room
//                           server listens there too (every network, 0.0.0.0, when it is set)
//   CHIMPHOUSE_PORT         Vite's port (5173 by default)
//   CHIMPHOUSE_ROOM_PORT    the room server's port: 2567 for dev, 2568 for the LAN demo, so both can run
// The pages find the room server on their own host at that port (VITE_CHIMPHOUSE_ROOM_PORT,
// set here for Vite). The dev server's room server allows the commands tests need (putting the
// lift back as it starts).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf("--mode");
const mode = at >= 0 ? args[at + 1] : "development";
const env = loadEnv(mode, root, "CHIMPHOUSE_");
const roomPort = env.CHIMPHOUSE_ROOM_PORT || (mode === "lan" ? "2568" : "2567");
const roomHost = env.CHIMPHOUSE_HOST ? "0.0.0.0" : "localhost";
const bin = (name) => `${root}node_modules/.bin/${name}`;

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  process.exitCode = code;
}

function start(name, cmd, cmdArgs, extraEnv) {
  const child = spawn(cmd, cmdArgs, { cwd: root, stdio: "inherit", env: { ...process.env, ...extraEnv } });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!stopping) console.log(`[dev] ${name} stopped (${signal ?? code}); stopping the rest`);
    stop(code ?? 0);
  });
  return child;
}

// the room server first, so the pages find it as they open; it restarts when its code changes in development
start("room server", bin("tsx"), mode === "lan" ? ["server/main.ts"] : ["watch", "--clear-screen=false", "server/main.ts"], {
  CHIMPHOUSE_ROOM_PORT: roomPort,
  CHIMPHOUSE_ROOM_HOST: process.env.CHIMPHOUSE_ROOM_HOST || roomHost,
  CHIMPHOUSE_ROOM_TEST_COMMANDS: "1",
});
start("Vite", bin("vite"), args, { VITE_CHIMPHOUSE_ROOM_PORT: roomPort });

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(0));
