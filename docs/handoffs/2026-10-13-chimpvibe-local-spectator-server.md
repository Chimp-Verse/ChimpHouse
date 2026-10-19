# Handoff to ChimpVibe: run the local demo with spectator mode, for ChimpHouse

Written 2026-10-13 by the ChimpHouse session, for the ChimpVibe session.
ChimpHouse is building the Game Room TV's split screen and watchers on top of spectator mode
(`docs/handoffs/2026-10-07-chimpvibe-spectator-mode.md` in ChimpHouse). To develop and test it, ChimpHouse needs a
ChimpVibe local demo running with the spectator changes, on this Mac only. This is for development. Nothing here is
for production.

## What to start

1. **Code:** branch `feat/spectator-mode`, in its worktree `~/Git/ChimpVibe/.claude/worktrees/spectator-mode`
   (last known commit `189bdd8`, "Tell a game's renderer when it shows a spectator…"). Use the latest commit on
   that branch. If later spectator work is somewhere else, use that instead and say which.
2. **The local demo** (`scripts/diagnostics/chimphouse-demo.mjs`) in **localhost mode, not LAN mode.** ChimpHouse
   now runs at `http://localhost:5173` on this Mac. The LAN demo of 2026-10-08 isn't needed. If it's still running
   and holds the ports, stop it and say so.
3. **Allow `http://localhost:5173`** for CORS on the list and art, for framing the play pages, and for embed messages.
   ChimpHouse reads the list from `http://127.0.0.1:56891/shared/chimphouse.json` by default. If the ports or
   addresses differ, say what they are.
4. **Games:** Snake (`ssnake`) admitted to the arcade as before. If you can, admit a second game too, so ChimpHouse can
   test switching games on the TV. Leave spectating **on** for every game. The owner may turn it off from the operator
   app to test `no-spectators`.
5. **Leave it running** in the background after you report, until the owner says to stop it.

## What ChimpHouse will do with it

ChimpHouse opens `http://localhost:5173/?arcade=local&tv=local` and will:

- load each seated player's game as `<playUrl>?embed=1&name=<name>`
- load the other players' panes, and watchers' frames, as `<playUrl>?embed=1&role=spectator&follow=<name>&mute=1`
- open several frames of one game on one page: up to 4 players plus spectator frames, across a few tabs and browser
  contexts on this Mac
- check `event.origin` against the play page's origin and read `ready` (with `role`), `playing`, `follow`, `ended` and
  `error`

## Check before you report

- The list answers with CORS for `http://localhost:5173`, and its `playUrl` and `art` point at addresses this Mac's
  browser can reach.
- A play page loads framed in embed mode from `http://localhost:5173`, as a player and as a spectator, and sends `ready`.
- A spectator with `follow=<name>` sends `waiting`, then `following` once that player joins.

## Report back

- the branch and commit running, and the worktree it runs from
- the list URL, the play page origin, and the games admitted (slug and name)
- the origins allowed
- how to stop it and start it again, and where its log is
- anything that differs from the spectator-mode handoff (parameters, messages, how a spectator picks its session)
- anything the owner must set
