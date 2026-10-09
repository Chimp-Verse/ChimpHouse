import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { roomServer } from "./server/roomServer";

export default defineConfig({
  // the room server: shared state (the lift's) between every page this dev server serves
  plugins: [react(), roomServer()],
  server: {
    port: 5173,
    strictPort: true,
    // ChimpVibe's game list and art, same-origin in development so the art works as a
    // texture (ChimpVibe doesn't send CORS headers for them yet)
    proxy: { "/chimpvibe": { target: "https://chimpvibe.dev", changeOrigin: true, rewrite: (p) => p.replace(/^\/chimpvibe/, "") } },
  },
  // the glTF exporter is only imported when a room is downloaded; pre-bundle it so that
  // first download doesn't make the dev server reload the page
  optimizeDeps: { include: ["@babylonjs/serializers/glTF/2.0"] },
  build: { chunkSizeWarningLimit: 8000 },
});
