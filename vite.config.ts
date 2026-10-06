import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // the glTF exporter is only imported when a room is downloaded; pre-bundle it so that
  // first download doesn't make the dev server reload the page
  optimizeDeps: { include: ["@babylonjs/serializers/glTF/2.0"] },
  build: { chunkSizeWarningLimit: 8000 },
});
