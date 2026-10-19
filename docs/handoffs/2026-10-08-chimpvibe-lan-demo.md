# Handoff to ChimpHouse: connect to the ChimpVibe LAN demo

Written 2026-10-08 by the ChimpVibe session, for the ChimpHouse session.
It says what ChimpHouse needs to point at the local ChimpVibe demo, which runs on the owner's Mac for testing from
another computer on the owner's home network. It is temporary. Nothing here is for production.

## What is running

ChimpVibe's local demo, started on the owner's Mac (10.0.0.100) in LAN mode, with the spectator-mode code
(branch `feat/spectator-mode`, commit `189bdd8`). It serves one game: Snake (`ssnake`), already admitted to the
arcade.

| what | URL (reachable from the network) |
|---|---|
| ChimpHouse's arcade list | `http://10.0.0.100:56891/shared/chimphouse.json` |
| Play page (Snake) | `http://10.0.0.100:56892/ssnake` |
| Cabinet art | `http://10.0.0.100:56891/brand/…png?for=chimphouse` (the list gives the exact URLs) |

Nothing else of the demo is reachable from the network. The operator app stays on the Mac's loopback.

ChimpHouse's own dev server runs on the Mac at `http://10.0.0.100:5174`, and the other computer opens ChimpHouse there.
The demo allows both `http://localhost:5173` and `http://10.0.0.100:5174` for CORS, framing and embed messages.

## What ChimpHouse should set up

1. **Use the LAN list on the other computer.** Fetch `http://10.0.0.100:56891/shared/chimphouse.json` (not
   `127.0.0.1`: on the other computer that address is the other computer itself). The list is ordered and has one entry
   right now. Take `playUrl` and `art` exactly as given, and do not rebuild them from the slug.
2. **Keep the list URL in configuration**, not in code. The demo is temporary and the Mac's address could change. The
   owner will say if it does.
3. **Play embed URL.** Build it from the entry's `playUrl`:
   - Player: `<playUrl>?embed=1&name=<player name, 1–32 chars>`
   - Spectator (Game Room TV or a cabinet someone watches): `<playUrl>?embed=1&role=spectator&mute=1`
   - Spectator following one player: add `&follow=<player name>` (same name rules, case-sensitive, trimmed).
   Don't add a name box for players. Embed mode shows none.
4. **Listen for embed messages** from the play iframe. Accept a message only when `event.origin` is
   `http://10.0.0.100:56892` and `event.source` is that iframe's `contentWindow`. Ignore anything without
   `protocol: "chimpvibe-embed"`. Treat unknown `error` codes as `"other"` and unknown `ended` reasons as `"disconnected"`.
   The full list is in `docs/embed-messages.md` and `docs/spectator-mode.md` in the ChimpVibe repo.
5. **Spectator timing.** Spectators are refused when nobody is playing (`error` `no-players`, or `ended` `no-players`
   after the last player leaves). For a split screen, open a spectator frame after one of your player frames has sent
   `ready`, and retry a spectator frame that reports `no-players`.
6. **Watching can be off.** A game can turn watching off (`error` `no-spectators`). Snake is not turned off in this demo,
   but the owner may switch it off from the operator app to test. Show the cabinet as unavailable to spectators in that case.

## The one thing that needs a browser setting (other computer only)

On the other computer, the game won't load over `http://10.0.0.100` by default. Browsers only allow the game's code
to run on secure origins, and a plain `http://` address on a LAN is not one. The result is an embed `error` with code
`renderer` ("The game couldn't load"), even though the connection is fine.

The owner must set this once, in that computer's browser:

- **Chrome / Edge:** `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, enter
  `http://10.0.0.100:5174,http://10.0.0.100:56892`, enable, relaunch.
- **Firefox:** `about:config`, `dom.securecontext.allowlist`, same list.

The list must include ChimpHouse's origin: a frame counts as secure only when the page around it is secure too.

## Messages you will see

- `ready`: show "Press any key to start" for a player, or the game for a spectator. `role` is `player` or `spectator`.
- `playing`: the first input went to the game. Never sent to spectators.
- `follow`: a spectator's followed player changed state: `waiting`, `following` or `gone`. Show "Waiting for <name>…"
  or "<name> has left" as you like.
- `ended`: `disconnected` (player can press Play again), or `no-players` (spectator; close the frame or show it idle).
- `error`: stop and show `reason` (plain words, under 40 characters). Codes: `unavailable`, `full`, `no-spectators`,
  `no-players`, `connection`, `renderer`, `other`.

Embedders that want to wait for a game to load should allow about 15 s for `ready`.

## Verified from this Mac, through 10.0.0.100

- The list answers CORS for `http://10.0.0.100:5174` and `http://localhost:5173`, and sends no CORS header to other origins.
- `playUrl` and art point at `10.0.0.100`.
- The play page loads and frames in embed mode from `http://10.0.0.100:5174`.
- A real-browser test framed `http://10.0.0.100:56892/ssnake?embed=1&name=…` from `http://10.0.0.100:5174`, and the
  embed `ready` arrived from the play origin. This needed the secure-origin setting above.

## When it stops

The demo stops when the owner runs `node scripts/diagnostics/chimphouse-demo.mjs --stop` in the ChimpVibe repo. After
that the list URL stops answering. ChimpHouse should show the cabinets as empty or unavailable, not crash.

## What to send back

- The LAN list URL you used, and whether the arcade loaded.
- Whether the play iframe loaded on the other computer (`ready` seen), and the message sequence for one player and one spectator.
- Any `error` codes you got, with the `reason`.
