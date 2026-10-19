# Handoff: the Game Room TV (ChimpHouse side)

Written 2026-10-07, for the Claude session taking over the Game Room TV. Read `AGENTS.md` first ("Interactive features" and the Git LFS rules), then this.

## What the user asked for

- The Game Room's TV plays ChimpVibe games for people on the couch.
- Game controllers lie on the coffee table. Picking one up sits you down: the camera zooms onto the TV so it fills the view, and the game loads for you as a player.
- One person picks up the TV's remote (as with the theatre's remotes) and chooses a game from ChimpVibe's catalogue. It loads for everyone holding a controller.
- People who aren't playing can see the screen and what's going on.
- **Split screen was asked for, then deferred by the user.** A browser can't see into another player's ChimpVibe game: each is a cross-origin iframe. So for now each seated player sees only their own game, over the whole TV. The room sees a "playing now" card naming the players. **The user wants to discuss spectating next.** Don't build it before that conversation.
- **Connection failures**, from a later request:
  - They work like the arcade's: ChimpVibe's embed-mode `error` message, ChimpHouse's own page check as a game starts, or a page that never loads.
  - A failure shows the TV as moving static, with a small "Failed to connect" box and the reason.
  - **It affects only the player whose game failed.** Everyone else is unaffected.
  - It stays until the TV is turned off with the remote. Choosing another game doesn't clear it.
  - While failed, that player's remote (if they hold it) can't start a game until they turn the TV off.

## Where it stands

All on branch `game-room-tv` (made from `arcade-cabinets`), **uncommitted**. Commit only when the user asks.

- Tests pass (2026-10-07): `tools/test-tv.mjs` (new), `tools/test-arcade.mjs`, `tools/test-theatre.mjs`. Run them with `npm run dev` on 5173.
- **The working tree also holds earlier, uncommitted arcade work** (ChimpVibe embed messages, out of order, `embed.ts`…) from another session. It was snapshotted before the TV work started, without touching the index, at `refs/snapshots/arcade-wip-2026-10-06`. That snapshot includes the then-untracked files.
- When the user asks to commit, commit the arcade work first and the TV work on top. Two TV changes later touched arcade files:
  - `pageProblem` moved from `arcade.ts` to `engine/pageCheck.ts`.
  - `public/arcade/standin.html` gained `failFor`.
  
  Those belong in the TV commit. Show the user the plan before committing.

## How it's built

| File | What it does |
| --- | --- |
| `src/world/rooms/gameroom.ts` | The TV screen carries the `game-tv-screen` role. The coffee table has 4 controller spots and 1 remote spot (slots). The old merged controller meshes are gone and the cans moved. `TV_CONTROLLERS = 4`. |
| `src/world/roles.ts` | `gameTvScreen`, `gameTvControllerSpot`, `gameTvController`, `gameTvRemoteSpot`, `gameTvRemote`. |
| `src/world/props/gamepad.ts` | The controller model. It has a light in its player's colour (`PLAYER_COLORS`). |
| `src/world/props/remote.ts` | Now takes `{ label, role }`, so the TV reuses the theatre's remote. |
| `src/world/props/tvScreen.ts` | What the TV shows in 3D: idle card, the game's card ("PLAYING NOW" with player tags), and the failed card (static plus notice). |
| `src/world/props/tech.ts` | `tvConsole()` takes a role and returns the screen mesh. |
| `src/engine/handhelds.ts` | Shared "kept on a spot, picked up, put down" logic. The theatre's `remotes.ts` was refitted onto it. |
| `src/engine/gameTv.ts` | The TV: take/put down, choose and turn off, sit and stand (via `ScreenFocus`), the player's frame over the TV, the page check, failures, and the texture. |
| `src/engine/room.ts` | `ME` (this visitor's id and name, `?name=`). Shared state between **this browser's tabs** through BroadcastChannel, standing in for a room server. |
| `src/engine/pageCheck.ts` | `pageProblem()` and `LOAD_MS`, shared with the arcade. |
| `src/engine/gameList.ts` | `loadTvCatalog()`: ChimpVibe's whole catalogue through the dev proxy; falls back to the arcade's admitted list. `?tv=standin` and `?tv=local`. |
| `src/engine/store.ts` | Shared `tv` (game, run, controllers, remote). Local `tvFrame` (this player's game; `checking` while unverified), `tvFailed`, `tvCatalog` and `tvPrompt`. Focus kind `"tv"`. |
| `src/ui/TvOverlay.tsx` | The player's iframe and the frame of UI round the TV: players, status, hints, remote controls, "Put the controller down". `RemoteControls` is also used in the side panel. |
| `src/ui/Hud.tsx`, `hud.css` | The TV remote panel, the "Game Room TV" section, the E prompts and help rows. |
| `src/engine/preview.ts` | Wiring: clicks, **E** and **B** keys, the update loop, and the `__chimp.tv` test hooks. |
| `tools/test-tv.mjs` | Three tabs (Ann, Bo, Cy) on one couch. It covers the whole round trip and the per-player failures. Screenshots go to `captures/tv-*.png`. |

Things worth knowing:
- **What triggers reloads.** A game's frame key is `${run}:${gameId}`. Choosing a game bumps `run`, so every player's frame reloads.
- **Gone visitors.** A visitor who leaves (closed tab, or silent for 90 s) lets go of what they held: `room.onGone`.
- **Hidden until verified.** A player's frame stays hidden until `pageProblem` passes or the page sends an embed message, as at the arcade.
- **The first key.** The "Press any key to start" prompt comes from the arcade's lost-first-key workaround; see the `arcade-first-key-lost` memory.
- **Test stand-in.** `?tv=standin` uses the arcade's stand-in play page, so the stand-in options (`fail`, `failFor`, `silent`) work for the TV too.

## Open items

1. **Spectating.** This is the user's next topic. The facts:
   - ChimpVibe's embed mode forces the player role, so a "watch" frame would join as another player.
   - ChimpVibe's engine has a spectator role, and each recipient gets its own view.
   - A likely ask of ChimpVibe is `?embed=1&role=spectator&follow=<name>&mute=1`. Each watcher or split-screen pane would then be its own connection.
   - Present the options; don't decide.
2. **Regenerate the Blender files.** `gameroom.ts` changed, and `AGENTS.md` says to regenerate after any change in `src/world/`. Ask the user before running the export and build: `node tools/export-house.mjs`, then `tools/blender/build_blend.py …` (the full command is in the README). The new slots are exported as empties, like the cabinet slots.
3. **Not tested:** clicking a controller or the remote to pick it up (only **E** is tested). Also unchecked: the TV with real ChimpVibe games, which needs the local demo (`?tv=local&arcade=local`).
4. **Unused texture:** the TV still loads the old `game-tv` concept-art texture through `screenMat()`, which `gameTv.ts` then replaces. It's harmless and could go.

## Don't

- **Don't build a room server.** The user stopped that on 2026-10-07; tab-to-tab sharing is enough for now.
- **Don't touch the dev servers.** A separate session owns the second-computer setup: a network dev server on port **5174** and ChimpVibe's local demo in LAN mode. Don't stop or restart 5174, and don't stop the user's own 5173 server.
- **Don't change ChimpVibe.** Its changes go through its own session, by way of the user.
