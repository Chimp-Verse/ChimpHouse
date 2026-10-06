# ChimpHouse 3D preview

A fly-through preview of ChimpHouse, built from `chimphouse-description.md` and the concept art in `Reference Images/`. It uses the stack recommended in `docs/research/2026-10-01-chimpverse-technology-stack.md`: TypeScript, Vite and a React DOM HUD around a Babylon.js (WebGL2) scene.

This is a look-and-layout preview only. There are no avatars, multiplayer, voice or room activities. The house, its furniture and its jungle setting are generated procedurally in code, so changes are quick to make and hot-reload in the browser.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
```

The first load takes a few seconds while textures are painted and shaders compile.

## Flying around

| Input | Action |
| --- | --- |
| Click the view | Capture the mouse to look around (Esc releases it) |
| Right-drag | Look around without capturing the mouse |
| W A S D / arrow keys | Fly forward, left, back and right |
| E or Space / Q or C | Fly up / down |
| Shift / Alt (held) | Four times faster / slower |
| Mouse wheel | Change flying speed (zoom in plan views) |
| F | Walk mode on / off (see below) |
| 1–9, 0, `[` `]` | Jump to viewpoints, previous and next viewpoint |
| N | Day / night |
| R / U | Hide roofs / hide the upper level |
| G | Floor-plan overlay (in the plan views) |
| O | Reference image: thumbnail, then overlay, then off |
| Alt-click, or I then click | Inspect: names the object under the cursor |
| P | Copy the current viewpoint, camera position and inspected object |
| H | Help |

Each reference image has a matching viewpoint, and the reference is shown in the corner so you can compare. The camera position is remembered between reloads.

## Walking

Press **F** to walk instead of fly. You drop onto the floor below the camera and move at avatar height with gravity, using the same mouse look. W A S D walk and Shift runs. Use it to check that the stairs, doorways, corridor, bridge and side entrance work for someone on foot.

- Walls, glass, railings and furniture block you, and you slide along them. Stairs and ledges up to 0.3 m are stepped onto. Leaves and plant stems are passed through.
- Roofs are ignored, so pressing F above the house drops you into the room below.
- When something stops you, the status panel shows **Bumped into** and the object's name, and **P** includes it in the copied details.
- Eye-level viewpoints keep you walking. Choosing a viewpoint in the air, or a plan view, switches back to flying.
- The avatar is a stand-in, 1.7 m tall and 0.6 m wide with its eyes at 1.55 m, until the chimp avatar is designed. Change `AVATAR` in `src/engine/walker.ts` to try other sizes.

## Playing at the arcade

The Game Room's cabinets hold the ChimpVibe games admitted to ChimpHouse, one per cabinet slot (eight, numbered 1–4 along the north wall and 5–8 by the south glass), filled in list order. Each is the shared cabinet design dressed in the game's colours, name and art.

- Walk up to a cabinet and look at it: **E**, or a click on its screen, plays it. The camera glides onto the screen and the game's play page opens over it. Every key then goes to the game; ChimpHouse's own keys do nothing.
- **Leave**, under the game, closes it and puts you back where you stood. If the game stops taking keys, click it.
- The list comes from ChimpVibe (`https://chimpvibe.dev/shared/chimphouse.json`) and is checked every two minutes. Until ChimpVibe serves it, `public/arcade/chimphouse.json` stands in (`node tools/make-arcade-fixture.mjs` rebuilds it from the live catalogue). In development, `/chimpvibe/…` on the dev server is proxied to chimpvibe.dev so the art works as a texture.
- ChimpVibe only lets its own site frame its games so far, so a real game shows a refusal over the screen. Add `?arcade=standin` to the address to play `public/arcade/standin.html` on every cabinet instead: it shows the keys it receives.

## Requesting changes

Fly to the spot, Alt-click the object you want changed and press **P**. Paste the copied text into your request, for example:

```
ChimpHouse preview — last viewpoint "Arrival Lounge"
Camera: (-5, 1.5, 0.9)  heading 318°  pitch -4°  fov 1.15
Area: Lower · Arrival Lounge
Picked: Lower › Arrival Lounge › Long curved teal sofa at (-9.81, 0.44, 2.09)
```

## Where things live

| Path | Contents |
| --- | --- |
| `src/world/layout.ts` | Every dimension: storey heights, room footprints, trees, stairs, bridge. `PLAN_SCALE` (wings and depth) and `HALL_SCALE` (entry hall width) resize the whole house; furniture spacing, terrain and viewpoints follow. |
| `src/world/structure/` | Floors, glazing, roofs and atrium dome, arches, stairs, railings, substructure |
| `src/world/rooms/` | Room furnishing (`lower.ts`, `upper.ts`) |
| `src/world/props/` | Furniture, lights, plants, screens, the shared arcade cabinet (`cabinet.ts`), studio equipment, firetruck |
| `src/world/environment/` | Sky, terrain, waterfalls, jungle, giant trees, front approach, canopy bridge |
| `src/world/materials/` | Procedural textures, leaf atlas, signs, shared material library |
| `src/world/viewpoints.ts` | Saved camera viewpoints |
| `src/engine/` | Engine bootstrap, fly camera, walk mode (`walker.ts`, `collision.ts`), lighting, post-processing, HUD state |
| `public/textures/screens/` | Screen artwork extracted from the reference images |
| `docs/plans/2026-10-02-blender-switch-plan.md` | The plan for moving the house into Blender once the layout is settled |
| `art/ChimpHouse.blend` | The Blender master: links every room and zone, and holds the lights, sun, viewpoint cameras and render settings |
| `art/rooms/` | One Blender file per room or zone (`upper-theatre.blend`, `structure.blend`…), each opening on its own; edit a room here and the master shows the change |
| `art/materials.blend`, `art/textures/` | The shared material library every room file links to, and the textures as PNGs. Until the cut-over to Blender, everything in `art/` is generated from the code and kept out of git; after it, Git LFS (see `AGENTS.md`) |
| `src/engine/exportRoom.ts`, `tools/blender/` | Export to glTF and the Blender build and render scripts, for the move to Blender |
| `art/test/` | Exports, test files and renders (not in git) |

## Tools

| Command | Purpose |
| --- | --- |
| `npm run screens` | Re-extract screen artwork from the reference images (`tools/screens.json` holds the screen corners) |
| `npm run capture [ids…]` | With `npm run dev` running, render viewpoints to `captures/` along with reference/render comparison sheets |
| `node tools/try-poses.mjs out.png '[{"x":…}]'` | With `npm run dev` running, render several candidate camera poses into one contact sheet |
| `node tools/plan-grid.mjs …` | Overlay a metre grid on the floor plan, for tracing footprints |
| `node tools/px-grid.mjs …` | Overlay a pixel grid on a reference image, for locating screens |
| `node tools/debug-view.mjs <view> <out.png> "<js>"` | With `npm run dev` running, open a viewpoint, run a snippet against the scene and screenshot it |
| `node tools/export-room.mjs <room>` | With `npm run dev` running, export a room (an id from `ROOMS` in `layout.ts`) to `art/test/<room>.glb`. The preview's **Download this room** button does the same for the room you're in |
| `node tools/audit-items.mjs [zone…]` | With `npm run dev` running, review how the export splits every room and zone into items and flag what looks wrong; the full item lists go to `art/test/item-audit.txt` |
| `node tools/test-arcade.mjs [slot]` | With `npm run dev` running, check the arcade round trip in a real browser: slots and cabinets, walking up, playing the stand-in game (keys reach it, ChimpHouse ignores them, the frame lines up with the screen through a resize), leaving and walking on. `GAME=real` plays the real game instead. Screenshots go to `captures/arcade-*.png` |
| `node tools/make-arcade-fixture.mjs` | Rebuild the arcade's stand-in game list from ChimpVibe's live catalogue |
| `node tools/export-house.mjs` | With `npm run dev` running, export every room and zone to `art/test/house/` (one .glb each) with `scene.json`: the house's lights, sun and viewpoint cameras |
| `blender --background --factory-startup --python tools/blender/build_blend.py -- <out.blend> <export.glb or folder>… [--rooms <dir>]` | Build Blender files from exports: Group › Zone collections (Lower, Upper, Building, Site), shared materials and images, quads and welded vertices rebuilt from glTF's triangles (so items can be reshaped), textures saved as PNGs beside it, each zone's leaves in a "· Foliage" collection, the lights, the sun and a camera per viewpoint. With `--rooms` it writes a file per room, the material library and a master that links them: `-- art/ChimpHouse.blend art/test/house --rooms art/rooms` |
| `blender --background <file.blend> --python tools/blender/render_views.py -- <out dir> [view…] [--scale 50] [--samples 16]` | Render viewpoint cameras from a Blender file, e.g. to compare with `npm run capture` |

The export splits each room into one object per item (a sofa, a lamp, a planter with its plant), named from its inspect label, turned the way it was placed and with its origin at the centre of its base. Pieces built without a label of their own join the item they belong to; the export prints how it placed them, which is the place to look when an object comes out wrong. Blender lives at `/Applications/Blender.app/Contents/MacOS/Blender` on this Mac.

The screen artwork (Yousef's stream thumbnail, community project screens, MixChimp interface and the trading display) is cropped from the concept renders, so it carries their resolution and style. Replace the PNGs in `public/textures/screens/` with real assets when they are available.
