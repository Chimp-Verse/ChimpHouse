# ChimpHouse agent notes

## Editing the house

Until the cut-over to Blender (phase 5 of `docs/plans/2026-10-02-blender-switch-plan.md`, recorded in its Status line), the code in `src/world/` is the master copy of the house. Make every change there, then regenerate the Blender files: `node tools/export-house.mjs` (with `npm run dev` running with the builder's tools on: `VITE_ENABLE_FLY_IN=true`, see the README's "Developer-only fly-in camera and builder's tools"; without it the page has no export hooks), then `tools/blender/build_blend.py -- art/ChimpHouse.blend art/test/house --rooms art/rooms` (the full command is in the README). The build rewrites every file in `art/`, so a change made only in a `.blend` file is lost at the next build. Until the cut-over those generated files stay out of git (`.gitignore` lists them); they are committed once, at the cut-over, as the starting master copy.

After the cut-over the Blender files are the master copy, and each edit goes in the one file that owns it:

- **A room's items** (furniture, fittings, its walls and glazing): that room's file in `art/rooms/` (`upper-theatre.blend`, `structure.blend`…). Keep the room's collection, put a plant's leaves in the room's "· Foliage" collection parented to the plant, and keep object names stable: change requests and scripts find items by name.
- **A material**, shared by every room that uses it: `art/materials.blend`. **A texture**: its PNG in `art/textures/`.
- **Lights, sun, viewpoint cameras, render settings**: the master, `art/ChimpHouse.blend`. Rooms are linked into it read-only.

Script an edit by running Blender headless on the file that owns it (`/Applications/Blender.app/Contents/MacOS/Blender --background <file> --python <script>`, saving from the script), then check it with a render from the master: `tools/blender/render_views.py`.

## Interactive features

The house is live, not a fixed scene (the plan's "Dynamic rooms and the order of work" section has the detail):

- **Arcade cabinets** in the ChimpVibe Game Room hold the ChimpVibe games that moderators admit to ChimpHouse (a chosen selection, not every new game), and anyone can walk up to one and play its game on the cabinet. Each game gets a cabinet of its own, modelled for it by an AI in Blender after the cut-over. Until then every cabinet is one shared basic design built in code, showing its game's name, colours and art; afterwards that design is the stand-in for a newly admitted game whose own cabinet isn't made yet.
- **The Game Room's TV** plays any ChimpVibe game somebody loads onto it, live.
- **The theatre screen** shows YouTube videos and streams that everyone watches together.

These are built on the code world before the Blender cut-over, and built to survive it:

- Attach behaviour by **role** and **slot**: the client finds "the theatre screen" or "cabinet slot 3" through metadata on the object, which the Blender files will carry too, never through how the code happens to build it. Give each new screen, slot or interactive spot its role in the code that creates it.
- Every seat-type prop (a sofa, chair, stool, bench…) adds a seat slot for each sitter with `seat()` (`world/props/seats.ts`), on the seat's top, facing the way its sitter does, saying how it is sat on; chimps sit by that alone (`engine/seats.ts`). `tools/test-sit.mjs` checks every seat can be sat on.
- Keep dynamic things as runtime data: the list of admitted games and each game's art come from ChimpVibe, screen images are placeholders, and video and game content loads when someone uses it.
- Show another site's content (a YouTube player, a game hosted on ChimpVibe's site) as an overlay lined up with its screen or in a panel: browsers don't let it be drawn onto a 3D surface. Content running in ChimpVerse's own page can be drawn onto the screen.

## Shared state and the room server

Everything visitors share goes through the room server (`server/house.ts`, a Colyseus room; the page side `src/engine/room.ts`; the README's "The room server" has how to run it). `npm run dev` starts it beside Vite, and browser tests need both.

- **State a page owns** (what its visitor is doing, a game its page simulates): `room.share` (or `room.family` for one member per visitor). The server only keeps the newest version and passes it on, so any page can overwrite it.
- **State the server owns** (the lift, and each feature moved off `share` after it): `room.watch` to follow it and `room.command(topic, name, args)` to change it. The server checks each command's name and arguments (`liftCommands.ts` is the pattern) and runs it with the feature's pure rules, imported from `src/engine/` without Babylon. Move a feature here when two visitors can change it at once or one could cheat it.
- Keep every shared state under the server's limits (`LIMITS` in `src/engine/roomProtocol.ts`: 32 KB a state, 200 messages a second per visitor across every feature, 10 commands a second): send a change when it happens, not every frame, unless the feature truly moves every frame. A topic ending in `:<visitor id>` is that visitor's alone and goes when they leave.
- A test page opened with a visitor of its own joins as a separate visitor, even in the same browser: there is no sharing between tabs outside the server.

## Chimp avatars

Every visitor walks the house as a chimp they shape and dress (`docs/plans/2026-10-16-chimp-avatar-plan.md` has how, and what a Blender chimp must do to take its place):

- The chimp is made in code, in `src/avatar/`, as the house is until its cut-over. Its DNA (`dna.ts`) is the one record of what a chimp looks like; everything else is built from it. A new setting is a row in `SHAPES` or `COLOURS`; a new item an entry in `wardrobe.ts` and its builder in `items.ts` (worn on a bone) or `garments.ts` (fitted to the body), each piece of cloth saying what it is made of (`fabric`: `FABRICS` in `materials.ts` has how each takes the light and its grain).
- Work on its look and movement in the chimp lab (`chimp.html`): `tools/chimp-shots.mjs` photographs it there, `tools/chimp-house-shots.mjs` in the house. Check it with `tools/test-chimp.mjs` and, for other visitors' chimps, `tools/test-chimp-sync.mjs`.
- Fit clothes to the chimp's own shapes, never to sizes guessed for an average chimp: a hat to its skull, a strap or a band to the skin found along its path (`avatar/fit.ts`). Check every item on every kind of body with `tools/wardrobe-shots.mjs` before calling it done.
- Walking, the camera is behind the chimp. Measure reach and aim from the visitor's eyes, `fly.eye` and `fly.aim` (`viewer` in `engine/flyCamera.ts`), never from `fly.camera`, which is only for what is drawn on the page (an overlay lined up with a screen, what is in view). Browser tests written for walking from the eyes open the page with `?pov=first`.
- A chimp is lit by lights of its own that copy the room lights where it stands (`ChimpLights` in `engine/lighting.ts`). Never light something that moves by adding it to the room lights' mesh lists or taking it out: each change is a pass over every mesh in the house, a hitch every time it crosses a doorway.
- Keep the skeleton's VRM bone names and unrotated A-pose rest, and the vertex attributes the materials read: the animation, the wardrobe and a Blender chimp all rely on them.
- Give every sampler a material plugin declares a texture, or leave the sampler out of the shader with a define (as the cloth's print is, `CHIMPPRINT`). A sampler with nothing bound reads whatever an earlier draw left on its unit; when that is the image being drawn into, WebGL refuses the whole draw call and the mesh silently isn't drawn (it hid the shorts, at random, in the house). `tools/test-chimp.mjs` checks that every piece the chimp wears is drawn.

## Committing Git LFS files

The large art files are stored with Git LFS: the Blender files (the master, the room files and the material library), their textures and the exports (the tracked patterns are in `.gitattributes`). The house is split into room files so a change commits only the rooms it touched. GitHub keeps every committed version of an LFS file in full and counts it against the account's limited LFS storage and download allowance, and deleting the files later doesn't give that space back.

- Commit LFS files at **milestones** only: a finished room, an agreed batch of model or texture changes, a step of the move to Blender. Between milestones, Blender work stays as local saves.
- Keep art and code in separate commits, so code can be committed whenever it's ready while the art waits for its milestone.
- When asked to commit and an LFS file has changed without reaching a milestone, commit the code, leave the LFS file out, and say so, asking whether this counts as a milestone.
- Before an LFS commit, list the LFS files being committed and their sizes for the user.
