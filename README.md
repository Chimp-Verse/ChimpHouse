# ChimpHouse 3D preview

A fly-through preview of ChimpHouse, built from `chimphouse-description.md` and the concept art in `Reference Images/`. It uses the stack recommended in `docs/research/2026-10-01-chimpverse-technology-stack.md`: TypeScript, Vite and a React DOM HUD around a Babylon.js (WebGL2) scene.

This is a look-and-layout preview. There are no avatars, multiplayer or voice yet; the arcade cabinets and the theatre screen are the first room activities. The house, its furniture and its jungle setting are generated procedurally in code, so changes are quick to make and hot-reload in the browser.

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

- Walk right up to a cabinet, within about a metre of its front and squarely in front of it, and look at it: **E**, or a click on its screen, plays it. The camera glides onto the screen and the game's play page opens over it. Every key then goes to the game; ChimpHouse's own keys do nothing.
- Under the game, **Press any key to start** shows when the game's play page says it is ready, until it says the game is playing (or for 12 s). ChimpVibe's play page doesn't send these messages yet (it asks for a name first), so for now only the stand-in shows the prompt. The keyboard reaches the game through ChimpVibe's play page in steps, and the first key can land on the play page instead, so that key is only asked to start the game.
- **Step back**, under the game, puts you back in front of the cabinet, still within reach of it, and the game keeps running. As you walk about the Game Room it shows on the cabinet's screen in perspective, placed afresh in every frame the scene is drawn. The game's page lies under the 3D view, and the screen is drawn as a hole in it, so anything in front of the screen (the next cabinet, a plant) covers the game as it would a real screen. When the screen is out of view or you leave the room, the game hides but keeps running. (`?arcadeHole=0` lays the game over the scene instead, hidden whenever anything is in the way.) Your keys walk you again; walk back up and press **E** to pick it up where it is.
- **Quit**, beside Step back, ends the game: its page closes, and with it your place in ChimpVibe's shared game. The side panel lists running games with a **Quit** of their own.
- A game left alone quits by itself after 3 minutes, since it holds one of the 64 places in ChimpVibe's shared game. Its clock starts when you step back or walk off, and keeps running however close you stand; only playing it again resets it. The side panel counts down. (`?arcadeAway=<seconds>` changes the time, for testing.)
- If the game stops taking keys, click it.
- Games open in ChimpVibe's embed mode (`embed=1`), whose play page says what is happening in `chimpvibe-embed` messages (`src/engine/embed.ts`; the spec is `docs/handoffs/2026-10-06-chimpvibe-embed-messages.md`). `ready` shows the start prompt and `playing` clears it. `ended` ("disconnected") shows above the game, which stays open. Messages without the envelope, or not from the game's own page, are ignored.
- A cabinet whose game fails shows a sign with the reason in small print: **GAME FULL** for ChimpVibe's `full` error, **OUT OF ORDER** for anything else. The game closes (you're glided back if you were playing), and E offers to try it again. Errors the play page shows after loading come from it as `error` messages. What such a page can't report, ChimpHouse checks as the game starts, during the glide to the screen: whether ChimpVibe answers, and whether the page loads, answers with an error (a 404) or refuses to be shown here. For the last two, the page is loaded briefly, out of sight, as an `<object>`. The game's frame stays hidden until that check passes or the page says it is `ready`, so a broken page is never seen: its cabinet goes straight to OUT OF ORDER, within a second or so. A page that never loads counts too, after 20 s.

  Cabinets aren't checked in the background, because loading a play page wakes a parked ChimpVibe session. The stand-in play page sends the messages when its address carries `embed=1`. `&fail=<reason>` (with `&code=`) makes it send an error, and `&silent=1` makes it send nothing.
- The list comes from ChimpVibe's showcase (`https://chimpvibe.dev/shared/showcase.json`) and is checked every two minutes. Until ChimpVibe serves it, `public/arcade/chimphouse.json` stands in (`node tools/make-arcade-fixture.mjs` rebuilds it from the live catalogue). In development, `/chimpvibe/…` on the dev server is proxied to chimpvibe.dev so the art works as a texture.
- ChimpVibe's live site only lets itself frame its games so far, so a real game from chimpvibe.dev shows a refusal over the screen. A ChimpVibe server running on this machine can allow ChimpHouse, and its games then play on the cabinets: open `http://localhost:5173/?arcade=local` (exactly `localhost`, since the server refuses 127.0.0.1). The list and art come straight from that server, with CORS. ChimpVibe's local demo script (`scripts/diagnostics/chimphouse-demo.mjs`) was removed from its branch; its history has it (`git show b546dc1:scripts/diagnostics/embed-demo.mjs`, which serves `/shared/showcase.json` on port 56891).
- Without the demo, add `?arcade=standin` to the address to play the stand-in on every cabinet instead. It is served from the dev server's other name (127.0.0.1 for localhost) so that it is cross-origin, like a real game. It also matches ChimpVibe's setup: a play page (`public/arcade/standin.html`) with the game (`standin-game.html`) in a locked-down frame inside it. It loses the first key the way ChimpVibe's page can, and shows the keys the game receives.

## Watching in the theatre

The theatre screen shows YouTube videos and live streams in YouTube's own player, which YouTube's terms require.

- **The remotes:** two remotes lie on the stand under the screen. Whoever holds one controls the theatre. Walk up to the stand, look at a remote and press **E** (or click it) to pick it up; at the stand, **E** puts it down again, and **B** puts it back from anywhere in the theatre. Leaving the theatre with a remote sends it back to the stand. Handing a remote to another visitor comes with multiplayer.
- **The remote's panel** shows while you hold one: **Play/Pause** (**K**), **−10 s** (**J**) and **+10 s** (**L**), the same keys as YouTube's player, a box for choosing a video, and **Put it back** (**B**). They work for everyone in the theatre, as does whatever the holder does in YouTube's player on the screen.
- **Without a remote** you can still use the player, since YouTube's terms don't allow blocking it, but only for yourself: pausing it pauses just your copy, and pressing play rejoins the theatre where it has got to. The theatre's state, including who holds each remote, is ready for the room server to share.
- **Choosing what plays:** holding a remote, paste a YouTube link (`watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/`) or a video ID into the remote's panel, or into the box under the screen while watching, and press **Show**. A `t=` or `start=` time in the link is kept. The screen and the "Now Showing" lightbox in the corridor show the video's thumbnail and title whenever the player isn't over the screen.
- **Watching:** walk into the theatre and look at the screen, then press **E** (or click the screen while nothing is showing). The camera glides to a seated pose square onto the screen, and the player appears exactly over it with its own controls. The title is above it. Below it are a box for choosing another video and **Leave**. While you watch, ChimpHouse's own keys do nothing, and keys typed into the player go to YouTube.
- **When a video starts:** at once, since a remote's holder is always in the theatre.
- **Walking about:** **Leave** puts you back where you stood, and the video keeps playing on the screen. As you move about the theatre the player lies over the screen in perspective, placed afresh in every frame the scene is drawn. With the mouse free, clicks on it go to YouTube's player.
- **When it hides:** a browser draws the player on top of the 3D scene, so it hides when it can't be seen properly: when you look away, something stands in front of the screen, you see it too steeply or from too far away (smaller than YouTube's 200 px minimum), or you leave the theatre. YouTube's terms don't allow a hidden player to play, so it pauses as it hides. The theatre itself keeps going, as a cinema does: when the screen is back in view, your player catches up.
- **Sound:** the player's volume falls off with your distance from the screen, scaling whatever you set on the player's own volume slider. Its sound can't come from the speakers' direction: the browser keeps YouTube's sound sealed inside the player.
- **When YouTube refuses a video** (its owner doesn't allow it outside YouTube, or it's gone), the frame says so in plain words, with a link to watch it on YouTube.
- The theatre's state is one object, the store's `theatre`: the video, playing or paused, and where it was at a moment. A room server can share it later to keep everyone in step.
- Add `?theatre=standin` to the address to use `public/theatre/standin.html` instead of YouTube's player. It draws a test card with a solid colour in each corner, a clock and the keys it receives.

### Checking it with real YouTube videos

`tools/test-theatre.mjs` checks the theatre against the stand-in. To check real YouTube, open http://localhost:5173/?view=theatre in your own browser (with `npm run dev` running). Press **F** to walk, go to the stand under the screen, look at a remote and press **E** to pick it up. Then look at the screen and press **E** to watch, paste each of these into the box under the screen and press **Show**:

| Link | What should happen |
| --- | --- |
| `https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30` | Big Buck Bunny plays with sound from 0:30, exactly over the screen. The bar above says "YouTube · Blender". |
| `https://www.youtube.com/watch?v=M3HKLzjvKPc` | NASA's live view from the space station plays, and the bar above says LIVE once it starts. Live streams come and go: if this one has ended, use any stream that's live on YouTube. |
| `https://www.youtube.com/watch?v=jfKfPfyJRdk` | An ended stream. YouTube refuses it, and the frame says so, with a link to watch it on YouTube. |
| `https://youtu.be/aaaaaaaaaaa` | A video that doesn't exist: the same refusal. |

Then try:

- Press **Leave** while it plays and walk about the theatre: the video keeps playing on the screen, in perspective, and gets quieter towards the back.
- Turn away, or walk out of the door, for ten seconds, then look at the screen again: it pauses meanwhile, and comes back about ten seconds on.
- Pause with the player's own button, then walk out and back: it is still paused where you left it.
- The player's fullscreen button, and resizing the window while you watch (the player stays on the screen).
- With the remote, **K**, **J** and **L** while you walk about; then **B**, and pause and play the player yourself: without a remote, only your copy pauses, and it rejoins the theatre.
- Walking out of the theatre with the remote: it goes back to the stand. From the corridor, the lightbox shows what's on.

## Playing on the Game Room TV

The Game Room's TV plays any ChimpVibe game, chosen with its remote, for everyone who picks up a controller.

- **The coffee table** in front of the TV holds four game controllers, each with a light in its player's colour, and the TV's remote. Walk up, look at one and press **E** (or click it) to pick it up.
- **The remote:** whoever holds it chooses the game from ChimpVibe's catalogue, in the remote's panel (or in the bar under the TV while seated), and can restart it or turn the TV off. **E** at the table or **B** puts it down; leaving the Game Room with it puts it back on the table.
- **A controller:** picking one up sits you down. The camera glides square onto the TV until it fills the view, and the game loads for you as a player, under your name. Choosing another game loads it for every player. **Put the controller down** (under the TV) ends your game and stands you up again. While you play, ChimpHouse's own keys do nothing and your keys go to the game.
- **When a game fails to connect** (ChimpVibe's page reports an error, ChimpVibe doesn't answer, the page refuses to show here, or it never loads), it fails only for the player who saw it: their game closes and their TV shows static with a small "Failed to connect" notice and the reason, until the TV is turned off with the remote. The other players play on, and the room sees the TV as before. A game's page stays hidden until it is known to work, as at the arcade.
- **Everyone else** sees the TV's card: the game, "playing now", and each player in their controller's colour. Showing the players' games to the room, or a split screen, is still to be designed: each player's game is ChimpVibe's page in its own frame, which nobody else's browser can see into.
- **Several visitors:** the TV's state goes through the room server (see below), so each page is a visitor. Open the preview in two windows, or on two computers, to sit two players on the couch. `?name=Ann` sets a tab's name.
- The catalogue comes through the dev server's `/chimpvibe` proxy, since ChimpVibe sends no CORS headers for it yet; elsewhere the TV falls back to the arcade's admitted games. Add `?tv=standin` to play the arcade's stand-in game instead of real ones.

## Using the lift

The lift beside the stairs runs between the lower and upper floors, and works as a real one does.

- **Using a button:** point at it, with the mouse cursor, or with the crosshair while the mouse is captured. The button you're pointing at gets an outline and the prompt names it. Press **E** or click to press it.
- **Calling it:** each landing has a call station on the pier beside the doors, with an up button on the lower floor and a down button on the upper floor. The car comes to that floor and its doors open. A call from the other floor waits until the car has finished where it is.
- **Riding it:** the car's panel is on the right-hand wall by the doors. It has a button for each floor (2 above 1), and below them the door-open and door-close buttons. The doors shut a short while after you choose a floor, and the car runs between the floors in about seven seconds, speeding up, cruising and slowing. The floor buttons light while their call waits. The indicators above each landing door and over the car's doors show the floor the car is at or passing, with an arrow while it travels.
- **Doors:** each landing has a pair of stainless doors that slide behind the wall. The car carries its own pair, which opens with them. Each pair meets in a dark line down the middle: a black rubber edge on each leaf, solid, so you can't see through it. The doors stay open for about four and a half seconds. Someone standing in the doorway holds them open, and they open again if they meet someone while closing. Once the doorway clears, they wait a moment and then shut. The door-open button reopens or holds them, and the door-close button shuts them at once unless someone is in the way.
- **Sounds** are made in the browser, not recorded: the button beep, the arrival chime (one ding for a car that came up, two for one that came down), the door operator's whirr ending in a thud, the brake's clunk as the car sets off and stops, and while it travels the motor's hum, the drive's rising whine, the rushing air and the rails' ticks. They come from the car in 3D: they fade as you walk away (full beside the car, about a quarter as loud 3 m off and a tenth 5 m off) and come from the car's side of you. They play through a little reverb. From outside a shut car its sounds are muffled. Browsers only allow sound after a key press or click, so it starts at your first one.
- **Music**: the car plays easy-listening bossa nova from its speaker, an original tune made in the browser (`liftMusic.ts`). It starts a second after anyone presses one of the lift's buttons and keeps playing through every press after that. It's part of the lift's shared state, so everyone at the lift hears the same tune at the same point, and it stops once the last person at the lift (in the car, or near a landing's doors) has walked away.
- **Shared between visitors:** everyone on the same dev server (this computer's windows, or other computers on the LAN demo) sees the same car, doors, calls and music. The lift is one object, `store.lift` (`src/engine/liftState.ts`), whose timing is pure functions of that state and the clock. Each page moves it on by the room's clock and passes on the changes its visitor makes through the room server (see below). A visitor who closes their page is let go of: out of the doorway, and away from the lift.

## The room server

Shared state goes through a room server. For now it lives inside the dev server (`server/roomServer.ts`, a Vite plugin), using the WebSocket Vite already keeps open to each page, so `npm run dev` (and the LAN demo) runs it with no extra setup. The page side is `src/engine/room.ts`.

- It keeps the newest version of each shared topic, so a visitor who arrives later is told how things stand, and passes each change on to everyone else.
- It keeps the room's clock, so the car is in the same place on every computer whatever its own clock says.
- It tells everyone when a visitor leaves.

It only exists in development. A production build has no dev server, so it falls back to sharing between tabs of the same browser. Restarting the dev server resets the lift and the TV. Before ChimpHouse is published for real players it needs a standalone, authoritative room server: see `docs/plans/2026-10-09-standalone-room-server-plan.md`.

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
| `src/world/props/` | Furniture, lights, plants, screens, the shared arcade cabinet (`cabinet.ts`), what the theatre screen shows when nobody is watching (`theatreScreen.ts`), the Game Room TV's card and controllers (`tvScreen.ts`, `gamepad.ts`), studio equipment, firetruck |
| `src/world/roles.ts` | Roles: how code finds a screen or slot (the theatre screen, cabinet slot 3) from its metadata, which the Blender files will carry too |
| `src/world/structure/lift.ts` | The lift's car (its doors, panels, lights and buttons), each landing's frame, sill, doors, call station and indicator, and the shaft's dark lining, built at rest; the shaft's walls are in `facades.ts` and `floors.ts`, its materials in `materials/lift.ts` |
| `src/engine/liftState.ts` | The lift's shared state and its rules, as pure functions (no Babylon): the timing, the commands, and the steps the state takes on its own |
| `server/roomServer.ts` | The room server for now: a Vite plugin sharing state between the pages the dev server serves |
| `src/engine/room.ts` | This visitor (`ME`), and shared state through the room server: `room.share`, `room.onGone`, the room's clock `room.now()` |
| `src/engine/lift.ts` | The lift in the page: shows the shared state, reads the doorway, finds the button you point at, lights the car, plays the sounds (`liftSound.ts`) and the car's music (`liftMusic.ts`) |
| `src/world/environment/` | Sky, terrain, waterfalls, jungle, giant trees, front approach, canopy bridge |
| `src/world/materials/` | Procedural textures, leaf atlas, signs, shared material library |
| `src/world/viewpoints.ts` | Saved camera viewpoints |
| `src/engine/` | Engine bootstrap, fly camera, walk mode (`walker.ts`, `collision.ts`), lighting, post-processing, HUD state; using a screen (`focus.ts`: the glide onto it and lining content up over it), the arcade (`arcade.ts`), the theatre (`theatre.ts`, `youtube.ts`), the Game Room TV (`gameTv.ts`), things picked up and put down (`handhelds.ts`), and the state visitors share until the room server (`room.ts`) |
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
| `node tools/test-arcade-real.mjs` | With `npm run dev` and a local ChimpVibe server allowing ChimpHouse running, the round trip with a real game: the server's showcase and art, joining the game on ChimpVibe's play page, every key reaching the game, leaving and walking on. Screenshots go to `captures/arcade-real-*.png` |
| `node tools/make-arcade-fixture.mjs` | Rebuild the arcade's stand-in game list from ChimpVibe's live catalogue |
| `node tools/test-theatre.mjs` | With `npm run dev` running, check the theatre in a real browser with the stand-in player. It checks that the screen and lightbox are found by role, and the watch-mode round trip: the player exactly over the screen (also in a screenshot), nothing over it, keys going to it and not to ChimpHouse, a window resize. It checks the remotes: taking one, putting it down, leaving the theatre with it, its buttons, and a viewer without one. After Leave it checks the player over the screen in perspective (in screenshots, and in every frame while walking), each reason for it to hide (paused first), catching up, and volume by distance. It also checks choosing videos, live streams and refused videos. Screenshots go to `captures/theatre-*.png` |
| `node tools/test-lift.mjs` | With `npm run dev` running, check the lift in a real browser: its parts found by role, the timing rules as pure functions (a trip, the doors, the dwell, the doorway holding them, the same state from any step size), then a visitor calling the car with **E**, walking in, riding it, holding the doors from the doorway, and walking into the shut doors. Screenshots go to `captures/lift-*.png` |
| `node tools/test-lift-sync.mjs` | With `npm run dev` running, check the lift shared between visitors (separate browser contexts): a press reaching another visitor, the car at the same height for both, the music playing for both from the same moment, a latecomer with its clock 5 s out seeing the car where the others do, and a visitor who leaves being let go of. Both lift tests reset the shared lift first, so anyone else on the server sees it jump back downstairs |
| `node tools/test-tv.mjs` | With `npm run dev` running, check the Game Room TV in a real browser, with three tabs as three visitors and the stand-in game: the TV, controllers and remote found by role; taking the remote and choosing a game, seen in the other tabs; picking up a controller (the camera glides onto the TV, which fills the view, and the game lines up with it, joined under the player's name; keys reach it and not ChimpHouse); a second player; a watcher who sees the "playing now" card and loads no game; changing the game reloads every player's; putting the controller down; a game that fails to connect for one player (static for them only, until Turn off); a closed tab letting go of its controller; turning the TV off and leaving with the remote. Screenshots go to `captures/tv-*.png` |
| `node tools/test-tv-real.mjs` | With `npm run dev` and a local ChimpVibe server (localhost mode) running, the Game Room TV's split screen with a real game: Ann seated in the house, Bo a light visitor (`tools/tv-visitor.html`: the room and plain frames, no house). Checks the console-style split (two tall halves; quarters for three, the spare one showing the game's card, with Cy a third light visitor); putting the controller down (the game plays on, seen on the TV while walking about; picked up again without a reload), another visitor taking over that game under the player's name, and Quit game and logs ChimpVibe's embed messages: Ann's game ready and playing, her part for Bo waiting, following, gone and following again, a spectator ended when nobody plays. Screenshots go to `captures/tv-real-*.png`, every message to `captures/tv-real-messages.json` |
| `node tools/export-house.mjs` | With `npm run dev` running, export every room and zone to `art/test/house/` (one .glb each) with `scene.json`: the house's lights, sun and viewpoint cameras |
| `blender --background --factory-startup --python tools/blender/build_blend.py -- <out.blend> <export.glb or folder>… [--rooms <dir>]` | Build Blender files from exports: Group › Zone collections (Lower, Upper, Building, Site), shared materials and images, quads and welded vertices rebuilt from glTF's triangles (so items can be reshaped), textures saved as PNGs beside it, each zone's leaves in a "· Foliage" collection, the lights, the sun and a camera per viewpoint. With `--rooms` it writes a file per room, the material library and a master that links them: `-- art/ChimpHouse.blend art/test/house --rooms art/rooms` |
| `blender --background <file.blend> --python tools/blender/render_views.py -- <out dir> [view…] [--scale 50] [--samples 16]` | Render viewpoint cameras from a Blender file, e.g. to compare with `npm run capture` |

The export splits each room into one object per item (a sofa, a lamp, a planter with its plant), named from its inspect label, turned the way it was placed and with its origin at the centre of its base. Pieces built without a label of their own join the item they belong to; the export prints how it placed them, which is the place to look when an object comes out wrong. Blender lives at `/Applications/Blender.app/Contents/MacOS/Blender` on this Mac.

The screen artwork (community project screens, MixChimp interface and the trading display) is cropped from the concept renders, so it carries their resolution and style. Replace the PNGs in `public/textures/screens/` with real assets when they are available.
