# Handoff to ChimpVibe: hand a player over to another browser

> **Status: on hold, not sent to ChimpVibe (2026-10-14).** The owner decided this isn't needed for now. Picking up a
> put-down controller and starting fresh under that player's name is an acceptable concession. Keep this draft as a
> possible later improvement, once its security implications have been thought over. Before sending it, review the
> token's risks again: who can see it, leaks, griefing, scores under the wrong name, and games that keep state in the
> browser. Then move it back to `docs/handoffs/` with a new date.

Written 2026-10-13 by the ChimpHouse session, for the ChimpVibe session.
It builds on the embed messages and spectator mode handoffs: the same envelope, the same allowed-origins list, and
the same rules.

## Goal

Someone playing a game in an embedding site can pass their player to someone else, who carries on **as that player**
in another browser: the same character, its place in the world, and its score. Think of handing a controller to a
friend on the couch.

The feature is **off unless switched on for an embedder**. It works only in embed mode, inside a site the owner has
listed for it, and never on `play.chimpvibe.dev` itself. Today the only site to list is ChimpHouse. As before, nothing
in its names or settings refers to ChimpHouse: the owner turns it on for ChimpHouse's origins.

## Why ChimpHouse needs it

The Game Room TV has controllers on a coffee table. A player can now **put their controller down**: their game keeps
running in their browser, and they still watch it on the TV. Anyone else can then pick up that controller and should
carry on that game.

Today that can't be done. Each player belongs to one connection. Removing the frame removes the player at once
(`session-lifecycle.js`), and the play page accepts no messages from its embedder. So ChimpHouse does the closest thing
it can: the old frame closes, and the new holder joins **under the same name**. Spectators following that name pick the
new player up without a reload, but it's a new character: its length and score are lost.

## Turning it on

- **A new setting, `CHIMPVIBE_SEAT_HANDOVER_ORIGINS`:** a list of origins, each of which must also be on
  `CHIMPVIBE_EMBED_ORIGINS`. It is empty by default, which turns the feature off everywhere. The owner sets it to
  ChimpHouse's origins (for the local demo, `http://localhost:5173`).
- **The play page decides from `location.ancestorOrigins[0]`.** Handover is on only in embed mode, when that origin is on
  the handover list. Where the browser lacks `ancestorOrigins` (Firefox), handover is off: the page can't tell who
  embeds it, and the token must never be posted to `"*"`. ChimpHouse falls back to rejoining under the same name there.
- **Handover off means the old behaviour, exactly.** `ready` carries no `seat`, and `#seat=` is refused with
  `seat-gone`, the same as a bad token, so a page can't learn whether a token was real.

The list decides who is given tokens; the token is what lets someone take a player over.

## What the feature does

All of this applies only where handover is on.

1. **A player's `ready` carries a handover token.** It adds a field `seat`: an opaque, unguessable string, issued by the
   server for that player. Embedders that don't know the field ignore it.
2. **`#seat=<token>` takes the player over.** It goes in the URL fragment, not the query, so it never reaches a server
   log or a `Referer` header. The page joins as that player instead of a new one. The player keeps its participant,
   state and name (`name` is ignored). From then on, input comes only from the new connection.
3. **Each token works once.** A takeover uses it up, and the new connection's `ready` carries a new one. Tokens also
   expire, after about 10 minutes, or whatever you think suits.
4. **The takeover is one step, on the server.** If two pages present the same token, one wins and the other gets
   `seat-gone`. Input from the old connection that arrives after the takeover is dropped.
5. **The old connection is told.** It gets `ended` with a new reason, `"taken-over"`, and sends no more input. Current
   embedders read an unknown reason as `"disconnected"`.
6. **Spectators notice nothing.** A spectator following that player keeps following it, with no `gone` (the player
   never left).
7. **A token that doesn't work** (used, expired, the player has left, the Session restarted, another game or Session,
   or handover is off) gives `error` with a new code, `"seat-gone"`, and a reason such as "That player has left the
   game". Current embedders read it as `"other"`.
8. **The token controls the in-game player only.** It never gives access to a ChimpVibe account, its sign-in, or
   anything outside that one player in that one Session.

### Questions for you

- **Games that keep state in the browser.** Some community games may keep a player's state in the client (in memory
  or in `localStorage`). The new browser won't have it, and a takeover would break. Can the engine guarantee that a
  player's state is all on the server? If not, should each game opt in to handover (a setting in the operator app, off
  by default)?
- **Scores and names.** After a takeover, the new holder plays and scores under the old holder's name. Where ChimpVibe
  keeps leaderboards, achievements or chat, should a handed-over run be marked, or handover be off for ranked play?
- **A fresh token on request.** Suppose a player puts their controller down, ChimpHouse shares the token, and the same
  player then picks the controller up again. The token still works, so anyone who saw it could take that player in the
  middle of a game. Could the play page accept one message from a handover origin, such as `seat-renew`, that replaces
  the token and sends the new one back? Then ChimpHouse would renew it whenever its owner picks the controller up again.
- **A short grace period.** If a player's connection drops, could the player stay in the Session for a little while
  (say 30 s) before leaving, so a takeover or a reload can catch it? If that's hard, skip it: ChimpHouse keeps the old
  frame open until the new one takes over.
- **Promotion in place, optional.** Could a spectator frame become the player without a reload? It isn't needed.
  ChimpHouse keeps the spectator view on screen until the new player frame sends `ready` (about 0.25 s when the game
  is warm), so the switch already looks seamless. Only do it if it's cheap.
- **Idle players.** A player whose controller is down sends no input, sometimes for minutes. Does ChimpVibe ever remove
  idle players? If so, say after how long. If not, should it, so that put-down players can't fill a game that has a
  player limit?

## How ChimpHouse will use it

- When a player's `ready` carries `seat`, ChimpHouse keeps the token in that player's browser. It shares the token
  in the TV's shared state, for that controller only, when the player puts the controller down, and only with visitors
  in the same room.
- ChimpHouse doesn't use tokens until its standalone room server limits each room to the people in it. Today the room
  runs on the dev server, with no sign-in, so anyone who connected to it would see every token.
- Whoever picks up that controller loads `<playUrl>?embed=1&name=<name>&mute=…#seat=<token>`. Until it sends `ready`,
  the TV keeps showing that player through a spectator frame.
- The old frame gets `ended taken-over`. ChimpHouse removes it, and its visitor watches that player through a
  spectator frame.
- When no token is offered (handover off, Firefox, or an older build), ChimpHouse falls back to rejoining under the
  same name, as it does today.

## Testing

Grow the embedding fixture. Check that:

- with the handover list empty, nothing changes: no `seat` in `ready`, and `#seat=` gives `seat-gone`
- an embedder on `CHIMPVIBE_EMBED_ORIGINS` but not on the handover list gets no `seat`, and its `#seat=` gives
  `seat-gone`
- the normal page (not embed mode) never offers or accepts a token
- with no `ancestorOrigins` (Firefox), no `seat` is ever posted
- on a handover origin, `ready` for a player carries `seat`, and a spectator's `ready` doesn't
- a second page with `#seat=` takes the player over: same participant id, state and score, and input from the new
  page only; its `ready` carries a new token
- the old page gets `ended taken-over`, and its input is ignored
- using a token a second time, or after it expires, gives `seat-gone`
- two pages with the same token at once: exactly one takes over
- a spectator following the player sees no `gone` and no change of view
- a token for a player who has left gives `seat-gone`, as does a token from another Session or game
- the token never appears in a request URL or `Referer` header

## When you finish

Report:

- what changed, with test results
- the final setting, parameter, field, reason and error names, if they differ from this
- your answers to the questions above
- what the owner must set or deploy, including the handover list for the local demo
