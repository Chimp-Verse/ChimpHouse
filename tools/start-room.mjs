// `npm run room:start`: run the compiled room server (npm run room:build) in production mode.
// Hosts that start it themselves do the same with: NODE_ENV=production node server/dist/server/main.js

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const main = fileURLToPath(new URL("../server/dist/server/main.js", import.meta.url));
if (!existsSync(main)) {
  console.error("room:start: the room server is not built yet; run: npm run room:build");
  process.exit(1);
}
process.env.NODE_ENV ??= "production";
await import(main);
