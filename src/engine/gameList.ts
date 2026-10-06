// The games admitted to ChimpHouse's arcade, from ChimpVibe at run time.
//
// ChimpVibe owns the format (docs/handoffs/2026-10-06-arcade-cabinets.md, "The
// game list contract"). Until it serves the list, a local fixture in the same
// format stands in: public/arcade/chimphouse.json, made by
// tools/make-arcade-fixture.mjs from the live catalogue. In development the list
// and art come through the dev server's /chimpvibe proxy (vite.config.ts), so
// they are same-origin and the art works as a texture.

export interface ArcadeGame {
  /** permanent: everything per game is keyed on it */
  gameId: string;
  /** can change when a game is renamed */
  slug: string;
  name: string;
  blurb: string;
  author: string;
  palette: string[];
  /** art URL as this page can load it (proxied in development), or null */
  art: string | null;
  playUrl: string;
  order: number;
}

export interface GameList {
  games: ArcadeGame[];
  /** where the list came from: "chimpvibe" or "fixture" */
  source: string;
}

const CHIMPVIBE = "https://chimpvibe.dev";
const params = new URLSearchParams(location.search);
/**
 * ?arcade=fixture skips ChimpVibe's list; ?arcade=standin also plays every cabinet's
 * game in the local stand-in page (public/arcade/standin.html), for testing before
 * ChimpVibe lets ChimpHouse frame its games.
 */
const MODE = params.get("arcade");

/** A ChimpVibe URL as this page should load it: through the dev proxy in development. */
function viaProxy(url: string): string {
  return import.meta.env.DEV && url.startsWith(`${CHIMPVIBE}/`) ? `/chimpvibe/${url.slice(CHIMPVIBE.length + 1)}` : url;
}

/** Entries in the contract's format, checked, in order. Entries missing what a cabinet needs are dropped. */
export function parseGameList(json: unknown): ArcadeGame[] {
  const list = (json as { games?: unknown })?.games;
  if (!Array.isArray(list)) throw new Error("game list has no games array");
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const games: ArcadeGame[] = [];
  for (const [i, g] of (list as Record<string, unknown>[]).entries()) {
    const gameId = str(g?.gameId);
    const playUrl = str(g?.playUrl);
    const name = str(g?.name) || str(g?.slug);
    if (!gameId || !playUrl || !name) {
      console.warn("[arcade] skipping game list entry without gameId, name or playUrl", g);
      continue;
    }
    games.push({
      gameId,
      slug: str(g.slug),
      name,
      blurb: str(g.blurb),
      author: str(g.author),
      palette: Array.isArray(g.palette) ? g.palette.filter((p): p is string => typeof p === "string") : [],
      art: str(g.art) ? viaProxy(str(g.art)) : null,
      playUrl: MODE === "standin" ? `${import.meta.env.BASE_URL}arcade/standin.html?game=${encodeURIComponent(name)}` : playUrl,
      order: typeof g.order === "number" ? g.order : i,
    });
  }
  return games.sort((a, b) => a.order - b.order);
}

async function fetchList(url: string): Promise<ArcadeGame[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseGameList(await res.json());
}

/** The admitted games: ChimpVibe's list, or the local fixture while ChimpVibe doesn't serve one. */
export async function loadGameList(): Promise<GameList> {
  if (MODE !== "fixture" && MODE !== "standin") {
    try {
      return { games: await fetchList(viaProxy(`${CHIMPVIBE}/shared/chimphouse.json`)), source: "chimpvibe" };
    } catch (e) {
      console.info(`[arcade] ChimpVibe's game list isn't available (${e instanceof Error ? e.message : e}); using the local fixture`);
    }
  }
  return { games: await fetchList(`${import.meta.env.BASE_URL}arcade/chimphouse.json`), source: "fixture" };
}
