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
| `src/world/props/` | Furniture, lights, plants, screens and arcade cabinets, studio equipment, firetruck |
| `src/world/environment/` | Sky, terrain, waterfalls, jungle, giant trees, front approach, canopy bridge |
| `src/world/materials/` | Procedural textures, leaf atlas, signs, shared material library |
| `src/world/viewpoints.ts` | Saved camera viewpoints |
| `src/engine/` | Engine bootstrap, fly camera, walk mode (`walker.ts`, `collision.ts`), lighting, post-processing, HUD state |
| `public/textures/screens/` | Screen artwork extracted from the reference images |
| `docs/plans/2026-10-02-blender-switch-plan.md` | The plan for moving the house into Blender once the layout is settled |

## Tools

| Command | Purpose |
| --- | --- |
| `npm run screens` | Re-extract screen artwork from the reference images (`tools/screens.json` holds the screen corners) |
| `npm run capture [ids…]` | With `npm run dev` running, render viewpoints to `captures/` along with reference/render comparison sheets |
| `node tools/try-poses.mjs out.png '[{"x":…}]'` | With `npm run dev` running, render several candidate camera poses into one contact sheet |
| `node tools/plan-grid.mjs …` | Overlay a metre grid on the floor plan, for tracing footprints |
| `node tools/px-grid.mjs …` | Overlay a pixel grid on a reference image, for locating screens |
| `node tools/debug-view.mjs <view> <out.png> "<js>"` | With `npm run dev` running, open a viewpoint, run a snippet against the scene and screenshot it |

The screen artwork (Yousef's stream thumbnail, community project screens, arcade art, MixChimp interface and the trading display) is cropped from the concept renders, so it carries their resolution and style. Replace the PNGs in `public/textures/screens/` with real assets when they are available.
