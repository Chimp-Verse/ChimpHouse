# Game Room overhaul plan

Status: in progress, started 2026-10-13. Run by an orchestrator agent, with one worker agent per machine working in parallel. There is no reviewer agent: each worker checks its own work, and the user decides afterwards what needs a review.

Every machine in the ChimpVibe Game Room is static and looks basic. This overhaul rebuilds each one as a realistic, polished machine that a visitor can walk up to and use. The arcade cabinets and the TV are out of scope.

Reference images for this run are kept outside the repo, in `/Users/jdholst/Git/ChimpVerse/game-room-run/refs/`.

## The five lanes

Each machine is a lane with its own branch and worktree, made from `game-room-overhaul`. The orchestrator merges each lane's finished milestones into `game-room-overhaul` (worktree `../ChimpHouse-game-room`). Nothing is pushed, and `main` isn't touched.

| Lane | Branch | Worktree | Dev server port |
| --- | --- | --- | --- |
| Air hockey | `air-hockey` | `../ChimpHouse-air-hockey` | 5181 |
| Pinball (both machines) | `pinball` | `../ChimpHouse-pinball` | 5182 |
| Claw machine | `claw-machine` | `../ChimpHouse-claw` | 5183 |
| Foosball | `foosball` | `../ChimpHouse-foosball` | 5184 |
| Snack machine | `snack-machine` | `../ChimpHouse-snack` | 5185 |
| Integration | `game-room-overhaul` | `../ChimpHouse-game-room` | 5180 |

Each lane runs its own dev server on its own port: `npx vite --port <port>` in its worktree, left running in the background. Port 5173 belongs to the user's own dev server: leave it alone. Every test tool reads the address from `URL` (for example `URL=http://localhost:5181`). Give any new tool the same `URL` override, and pass `URL` to `tools/debug-view.mjs`, which assumes 5173 otherwise.

### Milestones

Each lane delivers two milestones, and each is merged on its own.

1. **M1 · The look.** The machine rebuilt as a realistic, polished model in its place in the room. It is still static, apart from any idle animation such as attract-mode lights. Take screenshots: the machine from a walker's eye height at about 2.5 m, a close-up of its key details, and one at night (`N`). Look at them yourself and fix what isn't right before calling the milestone done.
2. **M2 · Playable.** The machine works, as its entry below describes, checked by a browser test, `tools/test-<machine>.mjs`, with screenshots of play. Play it yourself through the test hooks until it feels right.

There is no reviewer: you are responsible for your own quality. To finish a milestone:

1. Check that `npm run typecheck` passes, that your browser test passes, and that the screenshots look right.
2. Commit it to your own branch.
3. Ping the orchestrator with the commit SHA, the milestone, the test result, and where the screenshots are (`captures/<machine>-*.png` in your worktree).

The orchestrator merges that SHA into `game-room-overhaul`. Keep building on your branch after a merge: no rebases, and no force-pushes.

### Running browsers: one at a time

This Mac has 8 GB of RAM, and a headless browser rendering the house takes 1–2 GB. **Every** Playwright run, from any agent, goes through the run's lock, which allows one browser at a time across the whole run:

```sh
/Users/jdholst/Git/ChimpVerse/game-room-run/browser-lock.sh <your-name> env URL=http://localhost:<port> node tools/test-<machine>.mjs
```

The lock kills a run after 10 minutes, so keep each run short. Waiting for the lock can take minutes: run it in the background rather than letting a tool call time out. Don't leave a browser open between runs. Shut a lane's dev server down when its lane is finished.

### When to stop

- **At 09:00 Eastern on 2026-10-13, all work stops.** By 08:50, commit what you have to your branch (marked WIP if unfinished) and write a short note on where you got to and what's next in `/Users/jdholst/Git/ChimpVerse/game-room-run/status/<lane>.md`. Then stop, and don't start anything new.
- All agents share one 5-hour usage limit. When it runs out you stop, and you can't restart yourself. A watchdog script, `game-room-run/watchdog.sh`, watches every pane. After the reset it types `continue` into yours, unless it is 09:00 or later. When you get that, pick up where you left off: check `git status`, your branch's log and your status note.
- Keep `/Users/jdholst/Git/ChimpVerse/game-room-run/status/<lane>.md` up to date as you go: what's done, what you're on now, what's next. It's how you, or a fresh session, resume after a stop. Commit work in progress to your branch at natural points, not only at milestones.

## Shared conventions (all lanes)

Five lanes are writing in parallel, and the orchestrator merges them. These conventions keep that working.

**Where code goes.**

- Each machine's code goes in new files of its own:
  - the model: `src/world/props/<machine>.ts`
  - its behaviour: `src/engine/<machine>.ts`, plus pure rule and physics modules beside it if useful, like `liftState.ts`
  - its UI: `src/ui/<Machine>*.tsx`
- Move the machine's old builder out of `src/world/props/arcade.ts` into the new prop file, and delete the old one. Don't touch the other machines' functions in `arcade.ts`.
- Edits to the shared files (`src/world/rooms/gameroom.ts`, `src/engine/preview.ts`, `src/engine/store.ts`, `src/ui/Hud.tsx`, `src/ui/hud.css`, `src/world/roles.ts`, `README.md`) are small and only add things, following the patterns already there. Never reformat or reorder these files. The orchestrator resolves the overlapping additions at merge time.
- Don't edit `src/engine/room.ts`, `server/roomServer.ts`, `focus.ts`, `flyCamera.ts`, `walker.ts`, `collision.ts`, `lighting.ts`, `package.json` or `vite.config.ts` without asking the orchestrator first. If one of them truly needs a change, ask first. Ask before adding an npm dependency too.

**The code world is the master copy** (see `AGENTS.md`). Build the machines in code, in `src/world/`. Don't create or commit anything under `art/` (it's Git LFS), and don't commit `captures/`.

**Finding things by role.** Give every interactive part a role in `src/world/roles.ts` (one `ROLE` entry each, named after its machine, e.g. `airHockeyTable`, `pinballFlipper`), with a slot number where there are several. The engine finds those parts only by role and slot (`find`/`findAll`), never by how the room code builds them, so this carries over to the Blender files. Static parts are merged into the room through `ctx.g(zone, mat)` as the rest of the house is, each labelled for inspect: "Air hockey table", "Pinball machine: Jungle Quest" and so on. Moving parts are meshes of their own, built at run time the way `props/cabinet.ts` and `props/remote.ts` build theirs, and added to the lights with `lighting.addMeshes`.

Moving parts must never become stale solids in the walker's collision grid. Read `MeshMeta.kind` in `src/world/context.ts` and `solid()`/`mover()` in `src/engine/collision.ts`, and choose accordingly. Moving parts don't cast the sun's shadow, which is only drawn once.

**Walking up and playing.** Follow the arcade, theatre and lift patterns:

- **Walking up:** walking up to the machine and looking at it offers it in a prompt. Each lane adds its own field in `store.ts` (for example `airHockeyPrompt`), plus an `else if` line for **E** in the keydown chain in `preview.ts`, and a prompt in `Hud.tsx` in the style of the existing `play-prompt`s.
- **Playing:** a machine that takes over the mouse or keys while you play uses the existing screen focus (`src/engine/focus.ts`). Add a kind of your own to `FocusInfo` in `store.ts` (for example `{ kind: "airHockey"; side: "left" | "right" }`). Then call `focus.enter(info, <a role-tagged mesh of the machine>, () => <your play pose>, glide)` and `focus.leave(backPose)`.
  - While `store.focus` is set, ChimpHouse's own keys and mouse look stop, the pointer is released and the side panels hide. Your engine handles input itself through its own listeners, active only while the focus is yours.
  - Your UI (score, Leave, hints) renders in `Hud.tsx` while `s.focus?.kind` is yours.
  - **Esc** or a **Leave** button always leaves, and gives walking back.
- **Shared state between visitors** goes through the existing room (`src/engine/room.ts`). Use `room.share(topic, initial, apply)` with topics of your own: one topic per writer, for example `airHockey/puck` from whoever simulates the puck and `airHockey/mallet/left` from that player. Use `room.onGone` to free a player's place when they leave, `room.now()` for the room's clock, and `VIEWER` from `store.ts` for who you are. Make it feel right on the same computer (two windows) and across the LAN. To test, open two pages of your lane's dev server.

**Performance.** The house is already heavy. Do nothing per frame unless someone is near or playing. Keep the meshes you add few (merge by material), and allocate nothing per frame in physics loops. Report the draw calls and fps at the machine before and after your change in each submission.

**Physics.** Use fixed-timestep simulation with substeps, and continuous collision for fast objects (a pinball, a puck), so nothing tunnels through walls, flippers or mallets. Keep the rules and physics as pure, testable modules (no Babylon), as `liftState.ts` does, and test them in the browser test.

**Docs.** Each lane adds a short section to `README.md` on how to use its machine, in the style of "Playing at the arcade". It also adds its test tool to the README's Tools table, and updates the Help card in `Hud.tsx` if it adds keys.

## The entries

Each entry below is the user's request. Meet it in full: "realistic" and "flawless" are the bar.

### 1. Air hockey (lane `air-hockey`)

- **Now:** `airHockey()` in `props/arcade.ts`, placed in `gameroom.ts` at `{ x: x0 + 6.0, z: c.z - 0.6 }` with its long axis east–west. It does nothing.
- **Look:** redesign it as a realistic, flawless air hockey table like one in a real arcade. That means:
  - a thick cabinet on a sturdy base or legs
  - a perforated air-table surface with printed markings
  - raised rails with goal slots, and a puck return at each end
  - electronic scoreboards
  - proper mallets and a puck
- **Play:** your mallet follows the mouse cursor: wherever the cursor goes, the mallet goes, kept within your half.
  - **Two players:** two visitors can play each other, one at each end.
  - **One player:** if only one visitor comes up to it, an invisible robot drives the other mallet. There is no robot model, just a force moving that mallet, and it plays well but can be beaten.
  - Realistic puck physics: near-frictionless glide, rebounds off the rails, the mallet's speed transferring to the puck. Goals, scoring and a match to a set score.

### 2. Pinball, two machines (lane `pinball`)

- **Now:** `pinball()` in `props/arcade.ts`, two of them in `gameroom.ts` in the north-east curve: BANANA BLITZ (pink) and JUNGLE QUEST (blue). They are coloured boxes with an empty flat playfield, a backbox with a title and a fixed score, and a plunger rod. Screenshot: `refs/ref-02-pinball-current.png`.
- **Look:** a heavy overhaul into real pinball machines:
  - the cabinet on legs, with a lockdown bar, flipper buttons, a plunger and a coin door
  - a backbox with lit backglass art and a score display (DMD style)
  - a playfield under glass: an inlane and an outlane each side, slingshots, pop bumpers, ramps or orbits, targets, lit inserts, a drain, a shooter lane, and two flippers (more where a design calls for them)
- **Play:** fully interactive and playable. A visitor walks up and plays with full, working, flawless pinball mechanics:
  - a plunger launch with variable strength, flippers, ball physics on the sloped playfield
  - bumpers, slingshots and targets that score
  - a drain, a ball count (3), a ball-save, and nudge/tilt
  - high scores kept per machine
- **Unique:** the two machines must differ in **both** visual style and gameplay: a different layout, theme, features and rules (modes, multiball, combos…), not a recolour.

### 3. Chimp Claw machine (lane `claw-machine`)

- **Now:** `clawMachine()` in `props/arcade.ts`, in the south-east curve of `gameroom.ts`. It has a CHIMP CLAW marquee, a glass box of plush chimps and bananas, a static claw, a joystick, a button and a pink base. Screenshot: `refs/ref-03-claw-current.png`. The plush chimp "won from the claw" on the floor nearby is `plushChimp` in `gameroom.ts`.
- **Look:** clean it up into a flawless, realistic claw machine:
  - the cabinet, glass, interior lighting and marquee
  - a gantry on rails, and a claw on its cable
  - a prize bed piled with prizes, a prize chute with its guard, a pickup door, a coin slot, and the joystick and drop button
- **Play:** walk up and press **E** to play.
  - Steer the claw with the controls, then press another button to drop it.
  - It descends, closes and tries to lift a prize. Then it carries the prize up and back over the chute and lets go, dropping it in.
- **Challenge:** winning must be hard, as on a real machine, not a prize every time. Use realistic claw mechanics:
  - grip strength, and prizes slipping on the lift or at the jolt at the top
  - the prize's shape and where the claw catches it mattering
  - the claw swinging on its cable, and a time limit for positioning
- A won prize drops out of the pickup door.

### 4. Foosball (lane `foosball`)

- **Now:** `foosball()` in `props/arcade.ts`, placed in `gameroom.ts` at `{ x: x0 + 4.0, z: z1 - 4.5 }`, turned 0.12 rad: 8 rods with red and blue players. Screenshot: `refs/ref-04-foosball-current.png`.
- **Look:** the user thinks it looks fine. Improve the design where playing needs it:
  - rods through both walls, with each team's handles on its own side
  - goals a ball can enter, and a ball return
  - score counters on the rails
  - figures that spin on their rods
- **Play:** like air hockey. Play another visitor, or an invisible robot working the other team's rods when nobody else is there.
- **Controls** are yours to design. They must be very intuitive, fun and right for foosball. A starting point to weigh up (not required):
  - the rod nearest the ball on your side is picked automatically, with a key or the wheel to override
  - moving the mouse slides that rod across the table
  - a click or a flick of the mouse spins it to kick, harder the faster the flick

  Explain your final scheme when you finish the milestone. The test is how easy it is to pick up.
- Realistic ball physics on the field: walls, corners, figures and kicks, with goals scored and a match to a set score.

### 5. Snack machine (lane `snack-machine`)

- **Now:** `vendingMachine()` in `props/arcade.ts`, in the south-east curve of `gameroom.ts`, beside the claw machine. It's a red box with a flat picture of coloured squares and a keypad. Screenshot: `refs/ref-05-snack-current.png`.
- **The kind of machine wanted:** a real glass-front spiral snack machine (`refs/ref-05-snack-real-reference.png`): snacks on spiral coils behind glass, a selection keypad, a payment area, and a PUSH pickup flap.
  - **Don't copy that machine's look.** Design one unique to ChimpHouse, in its jungle, chimp and ChimpVibe style.
  - Invent ChimpHouse snack brands. No real brands.
- **Real mechanics:** choosing a snack with the buttons makes that actual snack behind the glass move. Its coil turns, pushes it off the shelf, and it falls into the collection bin.
- **Eating:** the visitor takes the snack from the bin and can choose to eat it, with a little eating animation. Then it's gone.
