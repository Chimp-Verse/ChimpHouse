import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev:lan` (mode "lan", .env.lan) listens on the home network for
// ChimpVibe's LAN demo; otherwise on localhost:5173. Both start the room server
// beside Vite (tools/dev.mjs); `npx vite` alone serves the pages without it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "CHIMPHOUSE_");
  return {
    plugins: [react()],
    // its own dependency cache, so it can run beside the localhost server
    cacheDir: mode === "lan" ? "node_modules/.vite-lan" : undefined,
    server: {
      host: env.CHIMPHOUSE_HOST || undefined,
      port: Number(env.CHIMPHOUSE_PORT) || 5173,
      strictPort: true,
      // ChimpVibe's game list and art, same-origin in development so the art works as a
      // texture (ChimpVibe doesn't send CORS headers for them yet)
      proxy: { "/chimpvibe": { target: "https://chimpvibe.dev", changeOrigin: true, rewrite: (p) => p.replace(/^\/chimpvibe/, "") } },
    },
    // the glTF exporter is only imported when a room is downloaded; pre-bundle it so that
    // first download doesn't make the dev server reload the page
    optimizeDeps: { include: ["@babylonjs/serializers/glTF/2.0"] },
    build: { chunkSizeWarningLimit: 8000 },
  };
});
