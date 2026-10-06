# ChimpHouse agent notes

## Editing the house

Until the cut-over to Blender (phase 5 of `docs/plans/2026-10-02-blender-switch-plan.md`, recorded in its Status line), the code in `src/world/` is the master copy of the house. Make every change there, then regenerate the Blender files: `node tools/export-house.mjs` (with `npm run dev` running), then `tools/blender/build_blend.py -- art/ChimpHouse.blend art/test/house --rooms art/rooms` (the full command is in the README). The build rewrites every file in `art/`, so a change made only in a `.blend` file is lost at the next build. Until the cut-over those generated files stay out of git (`.gitignore` lists them); they are committed once, at the cut-over, as the starting master copy.

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
- Keep dynamic things as runtime data: the list of admitted games and each game's art come from ChimpVibe, screen images are placeholders, and video and game content loads when someone uses it.
- Show another site's content (a YouTube player, a game hosted on ChimpVibe's site) as an overlay lined up with its screen or in a panel: browsers don't let it be drawn onto a 3D surface. Content running in ChimpVerse's own page can be drawn onto the screen.

## Committing Git LFS files

The large art files are stored with Git LFS: the Blender files (the master, the room files and the material library), their textures and the exports (the tracked patterns are in `.gitattributes`). The house is split into room files so a change commits only the rooms it touched. GitHub keeps every committed version of an LFS file in full and counts it against the account's limited LFS storage and download allowance, and deleting the files later doesn't give that space back.

- Commit LFS files at **milestones** only: a finished room, an agreed batch of model or texture changes, a step of the move to Blender. Between milestones, Blender work stays as local saves.
- Keep art and code in separate commits, so code can be committed whenever it's ready while the art waits for its milestone.
- When asked to commit and an LFS file has changed without reaching a milestone, commit the code, leave the LFS file out, and say so, asking whether this counts as a milestone.
- Before an LFS commit, list the LFS files being committed and their sizes for the user.
