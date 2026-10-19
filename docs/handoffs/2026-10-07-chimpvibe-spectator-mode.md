# Handoff to ChimpVibe: spectator mode

Written 2026-10-07 by the ChimpHouse session, for the ChimpVibe session.
It builds on the embed messages handoff (2026-10-06): same envelope,
same allowed-origins list, same rules.

## Goal

Anyone can watch a game being played, without joining it as a player.

This is a basic ChimpVibe feature, not a ChimpHouse one.
It should work on `https://play.chimpvibe.dev/<slug>` for any visitor,
and in embed mode for any allowed site.
Nothing in the mode, its names or its settings refers to ChimpHouse.

ChimpHouse is the first site that needs it.
It shows how the mode will be used (see the last section),
so build the basic feature in a way that also covers that use.

## Why ChimpHouse needs it

ChimpHouse has a TV that several people play one ChimpVibe game on, together.
Each player's game is the play page in its own iframe.
The browser keeps each iframe private, so ChimpHouse can't show one player's
game to anyone else.

Today embed mode always joins as a player.
A frame opened only to watch would join the game as an extra player.

## What the mode does

A spectator:

- joins the same running session as the players
- sees the game, live, but sends no input
- doesn't take a player's place:
  doesn't count toward the 64 players, and isn't in player lists or scores
- shows no name box (a spectator needs no name)

The engine already has a spectator role and gives each recipient its own view.
If that's true, most of this is opening it up to the play page.
Please confirm what the engine already does.

## Turning it on

All are URL parameters on the play page, with or without `?embed=1`.

- `role=spectator` joins as a spectator.
  Without it, the page joins as a player, as now.
- `follow=<name>` shows exactly what that player sees.
  `<name>` is the name the player joined with (`&name=<name>` in embed mode).
- Without `follow`, the spectator sees the game's default spectator view.
  Pick whatever fits the engine: an overview, or following someone.
  On the normal (non-embed) page, the spectator should be able to switch
  who they follow. In embed mode no switching UI is needed:
  the embedder changes `follow` by loading a new URL.
- `mute=1` plays no sound. It works for players too.

Outside embed mode, a "Watch" option next to Play would let any visitor
use the mode. Whether and how to add it is ChimpVibe's choice.

## Which session

The spectator must end up in the same session as the players it watches.
ChimpHouse loads `/<slug>?embed=1&name=<name>` for each player and assumes
they share one session per game. If sessions are chosen some other way
(a room code, more than one session per game), please say how a spectator
names the session it wants.

## Behaviour to get right

- **The followed player isn't there yet.** Wait for them, and show that you're
  waiting. Start following when they join, without a reload.
- **The followed player leaves or drops.** Show that they've gone,
  and pick them up again if they come back, without a reload.
- **Two players with the same name.** Decide which one is followed
  (for example the one who joined most recently) and write it down.
- **Small frames.** The view must work at about a quarter of a TV screen,
  around 480×270 CSS pixels, keeping the game's aspect ratio.
- **Many spectators.** One player may be watched by several spectators,
  and one page may hold up to 12 spectator frames at once.
  A spectator could get updates at a lower rate than a player
  if that keeps the server light.
- **Games with no spectator view.** Either the engine gives every game a
  sensible default view, or a game can turn spectating off.
  If it's off, the spectator gets an `error` (below).
- **A cap on spectators**, if you want one, separate from the 64 players.

## Messages in embed mode

These use the envelope from the embed messages handoff
(`protocol: "chimpvibe-embed"`, `version: 1`).
Everything here adds to version 1 without breaking it:
embedders already ignore types and fields they don't know.

### ready

As now: sent once per page load, when the spectator view is showing.
Add a field `role`: `"player"` or `"spectator"`.

### playing

Never sent to a spectator (it sends no input).

### follow (new)

Sent when a spectator with `follow=<name>` starts or stops seeing that player.

- Field `name`: the followed player's name.
- Field `state`:
  - `"waiting"`: the player isn't in the session (yet, or any more)
  - `"following"`: the view shows that player
  - `"gone"`: the player has left or dropped (after `"following"`)
- Sent each time the state changes, starting with the first after `ready`.

### ended and error

As now. A spectator's dropped connection is `ended` with reason
`"disconnected"`. New error codes, which current embedders read as `"other"`:

- `"no-spectators"`: this game doesn't allow spectators.
  Example reason: "Watching isn't available".
- `"full"` also covers a spectator cap, if there is one.
  Example reason: "Too many watching".

## Testing

Grow the generic embedding fixture from the embed messages work. Check that:

- a spectator sees the game and can't send input
- a spectator isn't counted as a player, and the 64th player can still join
- `follow` shows the named player's view
- `follow` for a player not yet there sends `waiting`, then `following`
  when they join, without a reload
- a followed player leaving sends `gone`; coming back sends `following`
- `mute=1` plays no sound, for spectators and players
- `ready` carries `role`, and spectators never get `playing`
- a game with spectating off sends `error` with code `"no-spectators"`
- the view works in a 480×270 frame
- a page with 12 spectator frames on one game stays responsive

## How ChimpHouse will use it (for reference, not part of the mode)

- **Split screen.** On the TV, each seated player plays their own game in one
  pane. The other panes are spectator frames following the other players:
  `/<slug>?embed=1&role=spectator&follow=<name>&mute=1`.
  Up to 4 players, so up to 3 spectator frames each.
- **Watchers in the room.** Someone standing who faces the TV sees spectator
  frames of the players, with no player frame of their own.
- **Failures.** A spectator frame that sends `error`, or never loads, shows as
  static with the reason, as a failed player's game does now.
  `waiting` and `gone` show as a "waiting for <name>" pane.

## When you finish

Report:

- what changed, with test results
- what the engine already had, and what was added
- how a spectator picks its session, if it isn't one per game
- the final parameters and message format, if they differ from this
- any cap on spectators, and the update rate they get
- what the owner must set or deploy
