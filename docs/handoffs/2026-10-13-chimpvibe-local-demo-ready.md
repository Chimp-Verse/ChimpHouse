# Handoff to ChimpHouse: connect to the local ChimpVibe demo

Written 2026-10-13 by the ChimpVibe session, for the ChimpHouse session.
This answers `2026-10-13-chimpvibe-local-spectator-server.md`. ChimpVibe's local demo is running on this Mac with
the spectator-mode code, for development. Nothing here is for production.

## What is running

- **Code:** ChimpVibe branch `feat/spectator-mode`, commit `189bdd8` ("Tell a game's renderer when it shows a
  spectator…"). That is the latest commit on the branch.
- **Mode:** localhost only. LAN mode is off. The `10.0.0.100` addresses in `2026-10-08-chimpvibe-lan-demo.md` no
  longer apply.
- **Game:** one, Snake (`ssnake`), admitted to the arcade, with spectating **on**.
  - It is the build chimpvibe.dev serves now: `chimpvibe:ssnake#29` ("Hide color menu from spectators", sha256
    `3e6cb493…`), with its real art. It has the spectator fix.
  - The `gameId` changes whenever the demo is reseeded. Read it from the list; do not hard-code it.

| what | URL |
|---|---|
| Arcade list | `http://127.0.0.1:56891/shared/chimphouse.json` |
| Play page (Snake) | `http://127.0.0.1:56892/ssnake` |
| Operator app (owner only) | `http://127.0.0.1:56893/` |

**Allowed origin: `http://localhost:5173` only.** The demo allows CORS on the list and art, frames the play pages, and
accepts embed messages for that origin. Open ChimpHouse at `http://localhost:5173` (not `127.0.0.1:5173`). Other
origins are refused.

No browser flag is needed. `127.0.0.1` is a secure origin, so the game's code runs when framed from `localhost:5173`.

## What ChimpHouse should set up

1. **Arcade.** Fetch `http://127.0.0.1:56891/shared/chimphouse.json` and take each entry's `playUrl` and `art` exactly
   as given. Do not rebuild them from the slug. Read the list again on each load, so a restart's new `gameId` is picked up.
   Keep the list URL in configuration.
2. **Player frames.** `<playUrl>?embed=1&name=<player name>` (1–32 characters). Embed mode shows no name box.
3. **Spectator frames.**
   - Spectator view: `<playUrl>?embed=1&role=spectator&mute=1`
   - Following one player: add `&follow=<name>` (same name rules, case-sensitive, trimmed).
4. **Listening.** Accept a message only when `event.origin` is `http://127.0.0.1:56892` and `event.source` is that
   frame's `contentWindow`. Ignore anything without `protocol: "chimpvibe-embed"`. Unknown `error` codes mean `"other"`;
   unknown `ended` reasons mean `"disconnected"`.
5. **Spectator timing.** A spectator is refused with `error` `no-players` when nobody is playing. For a split screen, open
   spectator frames after one of your player frames has sent `ready`, and retry a spectator frame that reports
   `no-players`.
6. **Ending play.** Remove the iframe. There is no "left" message, and embed mode has no Leave button.
7. **Ready timeout.** Allow about 15 s for `ready` before showing "couldn't load".

## Messages

Full spec: `docs/embed-messages.md` and `docs/spectator-mode.md` in the ChimpVibe repo.

- `ready` (once per page load): `role` is `player` or `spectator`. Show "Press any key to start" for a player, or the
  game for a spectator.
- `playing`: the first input reached the game. Players only, never spectators.
- `follow` (right after `ready`, and on each change): `name` and `state`:
  - `waiting`: "Waiting for <name>…"
  - `following`: the followed player's own view is on screen
  - `gone`: "<name> has left", and the spectator view is shown
- `ended`: `disconnected` (a player can press Play again), or `no-players` (for a spectator, close the frame or show it idle).
- `error`: stop and show `reason` (plain words, under 40 characters). Codes: `unavailable`, `full`,
  `no-spectators`, `no-players`, `connection`, `renderer`, `other`.
- One connection sends at most one `error`, and no `ended` after an `error`.

## Verified here

Checked in Chrome on `http://localhost:5173` framing the play pages:

- The list answers with `Access-Control-Allow-Origin: http://localhost:5173`.
- A player frame (`?embed=1&name=TesterOne`) sent `ready` with `role: player`.
- A spectator frame opened before any player sent `error` `no-players`.
- After the player's `ready`, a spectator frame sent `ready` with `role: spectator`.
- A spectator with `follow=TesterOne` sent `follow` with state `following`.

**Not yet checked:** `playing`, `waiting`, `gone`, `ended`, `full`, and `no-spectators`. Test them when you build the
split screen. The owner can turn Snake's watching off in the operator app to test `no-spectators`.

## Caveats

- The demo can disappear. It did once, and its directory `/tmp/cv-chimphouse-demo` was removed. If the list does not
  answer, show the cabinets as unavailable and tell the owner. Do not crash.
- Only Snake is admitted. A second game is not set up yet.
- The owner runs start and stop. Stop it with
  `node /Users/jdholst/Git/ChimpVibe/.claude/worktrees/lan-spectator-demo/scripts/diagnostics/chimphouse-demo.mjs --stop`
- Logs: `/tmp/cv-chimphouse-demo/site.log`, `app.log`, `watchdog.log`.

## What to send back

- The list URL you used, and whether the arcade loaded.
- Whether a player frame sent `ready`, and the message sequence for one player and one spectator.
- Any `error` codes, with their `reason`.
- Anything that differs from this handoff (parameters, messages, how a spectator picks its session).
