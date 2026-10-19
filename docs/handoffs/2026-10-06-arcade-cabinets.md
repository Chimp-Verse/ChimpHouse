# Handoff: playable arcade cabinets (ChimpHouse side)

Written 2026-10-06. Build the Game Room's arcade cabinets so that a visitor can walk up to one and play its ChimpVibe game on the cabinet's screen. The decisions behind this are in `AGENTS.md` ("Interactive features") and the Blender plan's [Dynamic rooms](../plans/2026-10-02-blender-switch-plan.md#dynamic-rooms-and-the-order-of-work) section; read both first.

ChimpVibe's side is a separate piece of work, briefed in `~/Git/ChimpVibe/docs/briefs/chimphouse-arcade.md`. Until it lands, build against the stand-ins described below. Nothing here waits on it.

## What the user asked for

- Cabinets hold the ChimpVibe games that moderators admit to ChimpHouse (a chosen selection, not every new game). The list comes from ChimpVibe at run time.
- Each cabinet's screen gets an overlay that embeds the game. Using the cabinet zooms the view onto the overlay so the game is easy to play, and every key then goes to the game.
- UI around the game screen lets the player leave: the cabinet loses focus and they walk freely again.
- For now, one shared basic cabinet design built in code, dressed per game. Unique AI-modelled cabinets come after the Blender cut-over (phase 5) and are out of scope.

## What exists today

- `src/world/rooms/gameroom.ts`: eight hard-coded cabinets (`CABINETS`), four along the north wall under the ChimpVibe sign and four by the south glass, each with a stool.
  - The names come from the concept art, not from ChimpVibe; "Yousef's Boom" isn't a live game.
- `arcadeCabinet()` in `src/world/props/tech.ts` builds the cabinet. The screen is 0.6 × 0.5 m, tilted back 0.12 rad. Marquee and screen images are crops of the concept art in `public/textures/screens/`, made by `tools/extract-screens.mjs`.
- All of it is merged into the room's per-material meshes (`ctx.g(zone, material)`). Nothing there can be added, removed or re-skinned at run time.
- Input:
  - `src/engine/flyCamera.ts` locks the pointer on a canvas click and handles WASD, Shift, E/Space and Q/C.
  - `src/engine/preview.ts` handles the HUD keys (1–9, N, F, R, U, G, O, H, I, P, [ ]) and Alt-click picking.
  - State lives in `src/engine/store.ts`; the HUD is `src/ui/Hud.tsx`.

## Facts about ChimpVibe (checked 2026-10-06)

- Every live game is served at `https://play.chimpvibe.dev/<slug>`. That page is allowed inside a frame only on the sites listed in its `frame-ancestors` setting, which today is only `https://chimpvibe.dev`. Real games won't load in ChimpHouse until ChimpVibe adds its address.
- The play page shows a name box and a Play button, then joins the game's one shared public session. Two visitors at the same game's cabinet play together, alongside anyone playing on chimpvibe.dev.
- The game runs in a locked-down frame nested inside the play page, and the play page focuses it when the game starts.
- ChimpHouse can't see keys typed into a cross-origin frame, so Esc can't be caught. Leaving is a mouse action on ChimpHouse's own UI; the browser already frees the mouse on Esc.
- ChimpVibe's public catalogue (`https://chimpvibe.dev/shared/catalog.json`) and thumbnails (`/brand/native-*.png`, 1280 × 720) don't allow reads from other sites (no CORS headers). From ChimpHouse's page, the browser can't read the list, and WebGL can't use the images as textures.
- The engine also has a spectator role. It isn't needed now, but it suits watching someone else play later.

## The game list contract

ChimpVibe owns this format. If the ChimpVibe session changes it, follow their version.

`GET https://chimpvibe.dev/shared/showcase.json` (renamed from `shared/chimphouse.json`; the format is unchanged), sent with CORS for ChimpHouse's addresses:

```json
{
  "version": 1,
  "games": [
    {
      "gameId": "game-0017e699-…",
      "slug": "pixelplatformer",
      "name": "Pixel Platformer",
      "blurb": "…",
      "author": "Ying",
      "palette": ["#1b2a24", "#2f6f55", "#4fb98a", "#7cf2c3", "#d9fff0"],
      "art": "https://chimpvibe.dev/brand/native-737e8c89-bee46066.png",
      "playUrl": "https://play.chimpvibe.dev/pixelplatformer",
      "order": 0
    }
  ]
}
```

- `gameId` is permanent; the slug can change when a game is renamed. Key everything per game on `gameId`, as the later unique cabinets will be.
- The play page may later accept `?embed=1&name=<name>`, plus messages to the parent window: `ready`, `playing`, `ended`. Treat both as optional extras and work without them.

## Steps

1. **Slots.** Turn the eight cabinet positions into named cabinet slots in the Game Room's code. Each slot has a position, a facing and a stand point, and carries its role and slot number as metadata, the way labels are carried today.
   - Done when the room builds with empty slots, and code can find "cabinet slot 3" by its metadata alone.
2. **The shared cabinet.** Build the cabinet as its own meshes per slot, outside the room's merged meshes, so it can be added, removed and dressed at run time. Dress it with the game's palette (sides, trim), a marquee drawn with its name, and its art on the screen.
   - The screen is a surface with the "cabinet screen" role and a clean 0–1 texture layout. Its aspect is yours to choose: thumbnails are 16:9, and games are scaled to fit the frame with letterboxing.
   - Done when a cabinet appears in a slot from a game entry and disappears when the entry is removed, without rebuilding the room.
3. **The game list.**
   - Load the list at run time and fill the slots in `order`.
   - Until ChimpVibe serves it, use a local fixture in the contract's format, built from the live catalogue.
   - In dev, a Vite `server.proxy` route to `https://chimpvibe.dev` makes the art same-origin, so it works as a texture.
   - More games than slots: fill the slots in order and drop the rest.
   - Done when the live games (eight on 2026-10-06) show on cabinets with their own names, colours and art, and the concept-art crops are no longer used for cabinets.
4. **Play at a cabinet.** In walk mode, standing at a cabinet and using it (a key, or clicking its screen):
   - frees the mouse;
   - glides the camera square onto the tilted screen;
   - places an iframe of the game's `playUrl` exactly over the screen;
   - puts a frame of UI around the screen: the game's name, a Leave button, and a hint to click the game if it lost the keyboard.

   While playing, the camera stays still, ChimpHouse's own keys do nothing, a canvas click doesn't lock the pointer, and the overlay stays lined up through window resizes. Leave removes the iframe, which ends the player's connection to the game, then glides back to the stand point and resumes walking.
   - Done when a whole round trip works: walk up, play, leave, walk on.
5. **Test with a stand-in game.** Until ChimpVibe lists ChimpHouse's address, use a same-origin stand-in page in `public/` that shows the keys it receives. Check with Playwright, as the scripts in `tools/` do, that:
   - keys reach the frame;
   - ChimpHouse ignores them while playing;
   - the overlay lines up with the screen;
   - Leave returns to walking.

   Once ChimpVibe allows `http://localhost:5173`, repeat the round trip with a real game.
   - Done when the checks pass and their output has been shown to the user.

## Out of scope

The Game Room TV, the theatre screen, unique AI-modelled cabinets, and showing other visitors what a player is doing.

## When you finish

Report to the user:
- what was built;
- the test output;
- any change you made to the game list contract;
- anything ChimpHouse still needs from ChimpVibe.

Commit when the user asks, following `AGENTS.md`.
