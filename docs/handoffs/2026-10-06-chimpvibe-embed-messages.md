# Handoff to ChimpVibe: embed mode messages

Written 2026-10-06 by the ChimpHouse session, for the ChimpVibe session.
It replaces the earlier pasted notes about messages, which arrived cut off.
It includes everything agreed since.

## Goal

Any allowed site can embed a game's play page in an iframe:
`https://play.chimpvibe.dev/<slug>`.

In embed mode, the play page tells the embedding page what is happening,
with messages to its parent window.

The embedding page can't see inside the play page: the browser keeps it
private. Without these messages, it can only tell whether the page loaded,
not whether the game works.

Embed mode must not know who the embedder is. ChimpHouse is one embedder.
Nothing in the mode, its names or its settings refers to ChimpHouse.

## Turning it on

- `?embed=1` on the play URL turns on embed mode.
  It shows only what is needed to play, in a small frame.
- `&name=<name>` joins as that player, without the name box.
- One configured list holds the origins allowed to embed.
  Today that is `CHIMPVIBE_FRAME_ANCESTORS`.
  Its new generic name is `CHIMPVIBE_EMBED_ORIGINS`.
  Accept both names for a while, so nothing breaks on deploy.

## The envelope

Every message is an object of this shape:

```js
{ protocol: "chimpvibe-embed", version: 1, type: "...", /* fields */ }
```

- Post it from the play page's own window (the shell).
  Never post it from the sandboxed renderer frame.
- Post it with `window.parent.postMessage(message, targetOrigin)`.
- A change that would break embedders raises `version`.

Embedders ignore any message without `protocol: "chimpvibe-embed"`.
They also check that it comes from the iframe they created,
and from the play URL's origin.

### targetOrigin

- Where the browser has `location.ancestorOrigins` (Chrome, Safari):
  - If `ancestorOrigins[0]` is on the allowed list, post to that origin.
  - If it is not on the list, post nothing.
    The page never announces itself to a page it doesn't recognise.
- Where the browser lacks it (Firefox): post to `"*"`.
  That is safe, because messages never carry anything secret.

## The messages

There are four types.

### ready

- Sent once per page load.
- Sent when the game can be played: after joining,
  and after waking a parked session if one was parked.
- Never sent while the name box is showing.
- No extra fields.

### playing

- Sent when the first input is sent to the game.
- No extra fields.
- Round-level events (a round starting or ending) are left for later.
  The engine has no round event today. ChimpHouse doesn't need one.

### ended

- Sent when play stops in a way the player can recover from.
  The page stays open.
- Field `reason`: `"disconnected"`, when the connection dropped mid-game.
  The player can press Play to reconnect.
- Embed mode shows no Leave button of its own (player mode already hides
  it). The embedding site gives the player its own way out, by removing
  the iframe, so there is no `"left"` reason.

### error

- Sent when the game can't be played right now.
- Fields `code` and `reason`.
- `code` is one of:
  - `"unavailable"`: the game or its session can't be found,
    or the game is retired or hidden.
  - `"full"`: the session already has its 64 players.
  - `"connection"`: the connection was refused when joining
    (for example the WebSocket 403).
  - `"renderer"`: the renderer failed to load or crashed.
  - `"other"`: anything else.
- A dropped connection mid-game is not an error.
  It is `ended` with reason `"disconnected"`.
- Embedders treat a code they don't know as `"other"`.
- `reason` is plain words an embedder may show to its users.
  - Keep it under about 40 characters.
  - No IDs, URLs or anything secret.
  - Examples: "Game unavailable", "Game is full", "Couldn't connect".

### When nothing is sent

When the player leaves on purpose from the embedding site,
the embedder removes the iframe. That ends the session.
The play page is gone at that point, so it sends nothing,
and it needs no special handling.

## Changes this needs

### Play page (game-evolve/client/shell.js)

Errors already show in these places.
Each needs one `postMessage` beside it, in embed mode:

- the "Game unavailable" title: `error`, code `"unavailable"`
- `showLobby(message)` after an `error` frame:
  `error`, with the code that fits
- the socket failing to open when joining: `error`, code `"connection"`
- the renderer-failed callback (it closes the socket with 1008):
  `error`, code `"renderer"`
- the socket closing mid-game ("Disconnected — press Play to reconnect"):
  `ended`, reason `"disconnected"`

Plus:

- `ready` once the game can be played, as above.
- `playing` on the first input sent.

### Server

Today the server closes the 65th player's connection without saying why.
It should first send a "full" message, so the play page can send
`error` with code `"full"`.

### Config

- Rename the setting as above, accepting both names for a while.
- This touches the box config and the release overlay.

## Timing

Embedders may treat "no `ready` within N seconds" as a failed load.
So:

- Send `ready` on every successful load,
  including after waking a parked session.
- Please measure and write down how long a wake can take,
  so embedders can choose N.

## Testing

Build a generic embedding fixture: a page on an allowed origin
that frames the play page in embed mode and records every message.
`tests/fixtures/chimphouse-focus-browser.mjs` could grow into it.

Check that:

- every message has the envelope and comes from the shell's origin
- `ready` arrives after joining, and never while the name box shows
- `playing` arrives on the first input
- each error path sends `error` with the right `code`
- a dropped connection sends `ended` with reason `"disconnected"`
- embed mode shows no Leave button
- the 65th player gets `error` with code `"full"`
- a parent origin not on the allowed list gets no messages

## Optional: the game list and art

Generalising these too would leave nothing on ChimpVibe's side
named after one embedder:

- `/shared/chimphouse.json` becomes a named collection,
  for example `/shared/collections/<name>.json`:
  the admitted, ordered games for one embedding site,
  managed by moderators. ChimpHouse is then just one collection.
- `?for=chimphouse` on art URLs becomes a generic cache key,
  for example `?cors=1`.
- `resolveChimpHouseOrigins` becomes the same allowed-embedder list.

If you do this, tell ChimpHouse the new list URL.

## How ChimpHouse uses it (for reference, not part of the mode)

- `error`: closes the game, glides the player back,
  and shows the cabinet as OUT OF ORDER with `reason`.
  Later, code `"full"` will show it as full instead.
- `ready`: shows "Press any key to start" until `playing`.
- `ended`: shows the reason above the game. The game stays open.
- As a game starts, ChimpHouse checks for itself that the page loads
  (it can't send messages if it doesn't). The game stays hidden until
  that check passes or `ready` arrives, so a page that fails to load
  goes straight to out of order without ever being seen.

## When you finish

Report:

- what changed, with test results
- the final message format, if it differs from this
- how long a parked session takes to wake
- what the owner must set or deploy
