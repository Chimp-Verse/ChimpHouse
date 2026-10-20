// `npm run room:build`: compile the room server (server/main.ts and the files it shares with the
// pages) to plain JavaScript in server/dist, ready for `npm run room:start` or the Dockerfile.
//
//   node tools/build-room.mjs
//
// The compiled files are CommonJS: the shared code has extension-less imports (Vite bundles the
// pages), which node only resolves in CommonJS. server/dist/package.json says so, as the project
// as a whole is ES modules. Entry point afterwards: server/dist/server/main.js.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = `${root}server/dist`;

rmSync(dist, { recursive: true, force: true });
const tsc = spawnSync(`${root}node_modules/.bin/tsc`, ["-p", `${root}server/tsconfig.build.json`], { cwd: root, stdio: "inherit" });
if (tsc.status !== 0) {
  console.error("room:build: tsc failed");
  process.exit(tsc.status ?? 1);
}
mkdirSync(dist, { recursive: true });
writeFileSync(`${dist}/package.json`, JSON.stringify({ type: "commonjs" }) + "\n");
console.log("room:build: compiled to server/dist (run it with: npm run room:start)");
