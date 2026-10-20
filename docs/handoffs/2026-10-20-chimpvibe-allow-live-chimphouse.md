# Handoff to ChimpVibe: allow the live ChimpHouse site

Written 2026-10-20 by the ChimpHouse session, for the ChimpVibe session.
ChimpHouse is now online. For ChimpVibe's games to play on its arcade cabinets and Game Room TV, ChimpVibe's
production site has to allow ChimpHouse's address. This is production, not a local demo.

## The address to allow

`https://chimphouse.chimphouse-preview.workers.dev`

Exactly that origin: `https`, no trailing slash, no path. It is a Cloudflare Workers address for now; ChimpHouse may
move to its own domain later (for example `https://house.chimpvibe.dev`), and will send a new handoff when it does.
Keep the local origins (`http://localhost:5173`, and `http://10.0.0.100:5174` if still listed) for development.

## What to allow it for

Add it to the allowed-embedder list (`CHIMPVIBE_EMBED_ORIGINS`, per
`docs/handoffs/2026-10-06-chimpvibe-embed-messages.md` in ChimpHouse), so that all of these follow from it:

1. **CORS on the game lists and art.** In a browser the house fetches, straight from ChimpVibe (there is no relay on a
   static host):
   - `https://chimpvibe.dev/shared/showcase.json`: the games admitted to the arcade
   - `https://chimpvibe.dev/shared/catalog.json`: the games that can be loaded on the TV
   - each game's `art` image, which the house draws as a texture (so it needs CORS too, not just `<img>` access)
   Answer with `Access-Control-Allow-Origin: https://chimphouse.chimphouse-preview.workers.dev` for that origin, and
   send no CORS header to origins not on the list.
2. **Framing.** The house frames `https://play.chimpvibe.dev/<game>?embed=1…` (players) and
   `…?embed=1&role=spectator&follow=<name>&mute=1` (watchers on the TV). Allow it in the play pages'
   `frame-ancestors`.
3. **Embed messages.** Post `ready` (with `role`), `playing`, `follow`, `ended` and `error` to that origin, by the same
   `targetOrigin` rules as for the local demo.

## Games

ChimpVibe's live showcase list for ChimpHouse is empty today, so the cabinets fall back to the house's sample list
even once the address is allowed. Please have a moderator admit at least one game (Snake, `ssnake`, worked in the local
demos), with spectating on, so ChimpHouse can check the cabinets and the TV against production.

## How to check, and what to report back

- `curl -sI -H "Origin: https://chimphouse.chimphouse-preview.workers.dev" https://chimpvibe.dev/shared/showcase.json`
  shows the `Access-Control-Allow-Origin` header for that origin (and the same for `catalog.json` and one art URL).
- A play page's response headers allow that origin in `frame-ancestors`.
- Report: the commit or deploy that made the change, the origins now allowed, the games admitted (slug and name),
  and anything ChimpHouse must change on its side.

ChimpHouse will then open https://chimphouse.chimphouse-preview.workers.dev, walk to a cabinet and the TV, and confirm
the games load and the embed messages arrive.
