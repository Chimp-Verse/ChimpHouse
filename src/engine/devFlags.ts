// Developer-only options, fixed when the page is built: never from the URL, storage,
// cookies or anything on `window`, so nobody visiting the house can turn them on.

/**
 * The fly-in camera: flying freely round the house and its grounds, the viewpoint tour
 * (keys 1–9, 0, [ ] and the side panel's list), the plan views, `?view=` and `?pose=`
 * in the address, and the saved camera restored on reload. Without it every visitor
 * arrives as their chimp at the spawn point and walks.
 *
 * On only in the development dev server (`npm run dev`, mode "development") with
 * `VITE_ENABLE_FLY_IN=true`, kept in `.env.development.local` (git ignores it). The LAN
 * demo's dev server (mode "lan") and every production build (`DEV` is false there, even
 * built with the flag) leave it off, and the build drops the fly-in code. Vite writes
 * these values into the code, so `FLY_IN_ENABLED` is a constant the bundler folds.
 */
export const FLY_IN_ENABLED: boolean = import.meta.env.DEV && import.meta.env.MODE === "development" && import.meta.env.VITE_ENABLE_FLY_IN === "true";

/**
 * The builder's tools, on with the same flag and in the same places as the fly-in camera:
 * inspecting (I, Alt-click) and copying the view's details (P) for a change request, downloading
 * a room as .glb and the export hooks the Blender build uses (tools/export-house.mjs, export-room,
 * audit-items), the cutaways (R hides roofs, U the upper level), and the status panel's
 * position, fps and draw-call readout and "bumped into" line. Visitors see none of them.
 */
export const DEV_TOOLS_ENABLED: boolean = import.meta.env.DEV && import.meta.env.MODE === "development" && import.meta.env.VITE_ENABLE_FLY_IN === "true";
