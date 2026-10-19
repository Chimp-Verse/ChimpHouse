// Make the arcade's stand-in game list, public/arcade/chimphouse.json, in the
// format ChimpVibe serves at https://chimpvibe.dev/shared/showcase.json
// (docs/handoffs/2026-10-06-arcade-cabinets.md), from the live public catalogue.
// Every live, visible game is in it, in catalogue order: ChimpVibe has no
// admission list yet.
//   node tools/make-arcade-fixture.mjs
//
// The catalogue leaves out gameIds. They come from the play origin's public
// sessions, matched by title; a game whose session carries another title is
// in KNOWN, matched on 2026-10-06 through its serving revision
// (chimpvibe_games' serving id = the session's revisionId).
import { writeFileSync } from "node:fs";

const KNOWN = {
  ssnake: "game-ef0358f8-7880-4995-ac81-36ae3109bd71",
  lumencoil: "game-5a51d453-b94c-4490-95ee-3d49f6013f97",
  pixelplatformer: "game-0017e699-5e2c-495c-948b-33ffd5785430",
};
const out = "public/arcade/chimphouse.json";

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};
const catalog = await get("https://chimpvibe.dev/shared/catalog.json");
const sessions = await get("https://play.chimpvibe.dev/api/sessions");
const byTitle = new Map(sessions.map((s) => [s.title, s.gameId]));

const games = [];
for (const p of catalog.projects) {
  if (p.status !== "live" || p.hidden || (p.kind && p.kind !== "game")) continue;
  const gameId = KNOWN[p.slug] ?? byTitle.get(p.name);
  if (!gameId) {
    console.warn(`no gameId for ${p.slug} (${p.name}): add it to KNOWN`);
    continue;
  }
  games.push({
    gameId,
    slug: p.slug,
    name: p.name,
    blurb: p.blurb ?? "",
    author: p.author ?? "",
    palette: p.palette ?? [],
    art: p.art ? new URL(p.art, "https://chimpvibe.dev").href : null,
    playUrl: `https://play.chimpvibe.dev/${p.slug}`,
    order: games.length,
  });
}
writeFileSync(out, JSON.stringify({ version: 1, games }, null, 2) + "\n");
console.log(`${out}: ${games.length} games`);
for (const g of games) console.log(`  ${g.order}  ${g.name.padEnd(18)} ${g.gameId}`);
