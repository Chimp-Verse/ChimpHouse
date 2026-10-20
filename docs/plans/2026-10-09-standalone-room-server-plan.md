# ChimpHouse: plan for a standalone room server

Plan date: 2026-10-09.

Status: built and tested on this Mac, including over its home-network address (2026-10-20, branch `room-server`); not hosted yet. Done: steps 1-5 and 9, and step 6's rate and size limits. A Colyseus server in `server/` (`@colyseus/core` 0.18.19, `@colyseus/sdk` 0.18.5, MIT) that `npm run dev` and `npm run dev:lan` start beside Vite; the lift is the server's, run by commands; the dev-server relay (`server/roomServer.ts`) and the BroadcastChannel fallback are gone. Restarting the room server starts the lift afresh, and pages reconnect and put back the shared topics they know (the README's "The room server"). Tested: `test-room` (with a restart), `test-lift-sync` and `test-lift` against `npm run dev`; `test-lift-sync` with the pages loaded from the LAN demo's address (10.0.0.253, browsers on this Mac; not yet tried from a second computer) and against a production build (`vite preview`) with the room server run on its own; and every other multi-visitor and single-visitor browser test against `npm run dev`. Not done: hosting (step 8, chosen later; until then the "done when" below holds only on one network), step 6's reach check on lift presses (once chimps' positions are the server's), guest sessions from the server (step 7), and moving the other features to commands. "What there is now" below describes the relay as it was.

## Summary

Shared state (the lift today; the Game Room TV and the theatre next) goes through a room server. The one in use now is a stand-in that lives inside Vite's dev server, so it only exists while `npm run dev` is running. Before publishing, replace it with a standalone, authoritative room server: a Colyseus TypeScript server, as the [technology stack research](../research/2026-10-01-chimpverse-technology-stack.md) recommends. Features keep talking to `src/engine/room.ts`, so only the transport underneath them changes.

## What there is now

`server/roomServer.ts` is a Vite plugin. It uses the WebSocket the dev server already keeps open to every page (for hot reloading) and:

- keeps the newest version of each shared topic, so a visitor who arrives later is told how things stand;
- passes each change on to everyone else;
- keeps the room's clock, so timed state (where the lift car is, how far into its music) reads the same on every computer, whatever its own clock says;
- tells everyone when a visitor leaves: their page closed, or (a crashed tab) it went quiet for 90 s.

`src/engine/room.ts` is the client side: `ME` (this visitor), `room.share(topic, initial, apply)`, `room.onGone(fn)` and `room.now()`. Without the dev server (a production build) it falls back to a BroadcastChannel, which only reaches tabs of the same browser.

`tools/test-lift-sync.mjs` checks the lift across separate visitors, including one whose clock is 5 s out and one who leaves.

### Its limits

- **Development only.** A production build has no dev server, so published copies of the site wouldn't sync between computers.
- **Memory only.** Restarting the dev server resets the lift (and any other shared state).
- **Not authoritative.** Any page can replace a topic's state with anything; the newest version wins. Two presses at the same moment can lose one, until a page notices and puts its own part back (a visitor's place in the doorway or at the lift is put back on the next frame; a lost button press isn't).
- **No identity or checks.** Visitors are random ids per page load, and nothing checks that a visitor pressing a lift button is anywhere near it.
- **One room.** Everyone the dev server serves is in the same house.

## The standalone server

### Commands, not whole states

Pages send commands; the server runs the rules and owns the state. The lift's rules are already pure functions in `src/engine/liftState.ts`, timed off a clock, and they import only plain layout numbers (`world/layout.ts`, `world/geometry/curves.ts`), not Babylon. So the server can run the same code:

| Command | From | Lift function |
|---|---|---|
| A landing's call button, or a car button | a press (E or click) | `callLift` |
| Door-open / door-close in the car | a press | `holdDoors`, `shutDoorsNow` |
| Any lift button | a press | `playMusic` (starts the music) |
| Stepping into or out of a doorway | the visitor's page | `setDoorway` |
| Coming to the lift, or walking away | the visitor's page | `setNearby` |
| Leaving the house | the server, on disconnect | `setDoorway` and `setNearby` with `false` |

The server moves the state on with `advanceLift` on its own clock and sends the result; pages keep showing it on the room's clock, as now. This fixes lost presses, because the server applies commands one at a time.

### Steps

1. **Pick and pin versions.** Check Colyseus's current stable release when starting (the research saw a v0.18 banner in the docs, which on its own doesn't prove a stable npm release) and pin it.
2. **The server project.** A Node project in `server/` with one room type, the house. Its state schema holds the lift's state, and room for the Game Room TV and the theatre. It imports `liftState.ts` directly.
3. **The client transport.** `room.ts` connects to the server with the Colyseus SDK and keeps its API (`ME`, `share`, `onGone`, `now`). Features that only share state can keep `share`. The lift moves to sending commands, through a small addition such as `room.command(topic, name, args)`. The server's address comes from a build-time environment variable, `VITE_CHIMPHOUSE_ROOM_URL` (or the page's own host at `VITE_CHIMPHOUSE_ROOM_PORT`).
4. **Development.** `npm run dev` starts the room server beside Vite, so development and the LAN demo use the real server. Then remove `server/roomServer.ts` and the BroadcastChannel fallback.
5. **Presence and reconnecting.** Visitors leave on disconnect, after a short grace period for a reconnect (Colyseus can hold a seat while the SDK retries). Their place in the doorway and at the lift goes with them.
6. **Checks.** Rate-limit commands. Once avatar positions are shared, accept a button press only from a visitor within reach of that button.
7. **Identity.** Guest sessions from the server, with names. A link to ChimpVibe accounts is a separate design (see the research's identity notes); never reuse ChimpVibe's MCP bearer token as a game credential.
8. **Hosting.** The client stays a static site on an HTTPS origin. The room server runs where long-lived WebSocket connections are supported: Colyseus Cloud for a pilot, or a managed Node container, over WSS.
9. **Tests.** Port `tools/test-lift-sync.mjs` to run against the standalone server, and add a disconnect-and-reconnect test.

### Moving the other shared features

- **Game Room TV** (`engine/gameTv.ts`, in progress on `game-room-tv`): already uses `room.share`, so it works over the dev relay as is, and moves with step 3.
- **Theatre** (`engine/theatre.ts`, `engine/remotes.ts`): the store's `theatre` object, including who holds each remote, becomes server-owned. Decisions already made for it:
  - Everyone shares one timeline.
  - A viewer looking away pauses their own player, and that pause is never sent to the server.
  - The holder of a remote controls the screen.
  - Leaving the theatre returns a held remote.
  - Still to design: handing a remote to another visitor; what happens when one viewer gets an ad (YouTube reports no ad events); a re-sync now and then for buffering drift.

## Done when

- A production build, served from a normal HTTPS site, syncs the lift between two computers on different networks.
- Restarting the room server is handled. Either the lift starts fresh and pages pick up the new state without reloading, or the state is kept. Write down which.
- The lift sync tests pass against the standalone server, including disconnect and reconnect.
- `server/roomServer.ts` and the BroadcastChannel fallback are gone.

## Open questions

- **Rooms and capacity.** How many visitors share one house, and how a full house splits into instances (the research leaves crowd sizes to measurement).
- **Hosting choice and cost.** Colyseus Cloud or a self-managed container, at the expected number of visitors.
- **Durable state.** Whether anything needs to outlive a room process (PostgreSQL only if so). The lift doesn't.
