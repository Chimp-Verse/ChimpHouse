// The games admitted to ChimpHouse's arcade, from ChimpVibe at run time.
//
// ChimpVibe owns the format (docs/handoffs/2026-10-06-arcade-cabinets.md, "The
// game list contract"). Until it serves the list, a local fixture in the same
// format stands in: public/arcade/chimphouse.json, made by
// tools/make-arcade-fixture.mjs from the live catalogue. In development the list
// and art come through the dev server's /chimpvibe proxy (vite.config.ts), so
// they are same-origin and the art works as a texture.

import { inEmbedMode } from "./embed";
import { TvGame } from "./store";

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
 * ?arcade=fixture skips ChimpVibe's showcase; ?arcade=standin also plays every cabinet's
 * game in the local stand-in play page (public/arcade/standin.html), for testing before
 * ChimpVibe lets ChimpHouse frame its games. ?arcade=local reads the showcase from
 * a ChimpVibe server running on this machine (LOCAL_LIST), whose real games ChimpHouse may frame.
 */
const MODE = params.get("arcade") ?? import.meta.env.VITE_ARCADE_MODE ?? null;
/**
 * The showcase of a ChimpVibe server running locally, or VITE_ARCADE_LOCAL_LIST
 * (.env.lan for a LAN setup). Read directly: it and its art send CORS only for the
 * addresses that server allows (http://localhost:5173, and in LAN mode
 * http://10.0.0.100:5174), so open ChimpHouse at exactly one of them.
 * VITE_ARCADE_MODE and VITE_TV_MODE set ?arcade= and ?tv= when the address doesn't.
 * The old demo script was removed from ChimpVibe's branch; ChimpVibe's history has it.
 */
const LOCAL_LIST: string = import.meta.env.VITE_ARCADE_LOCAL_LIST ?? "http://127.0.0.1:56891/shared/showcase.json";

/** A ChimpVibe URL as this page should load it: through the dev proxy in development. */
function viaProxy(url: string): string {
  return import.meta.env.DEV && url.startsWith(`${CHIMPVIBE}/`) ? `/chimpvibe/${url.slice(CHIMPVIBE.length + 1)}` : url;
}

/**
 * The stand-in play page for a game, from the dev server's other name (127.0.0.1
 * for localhost and the other way round) so that it is cross-origin, as a real
 * game is; elsewhere from this page's own origin.
 */
function standinUrl(name: string): string {
  const { protocol, hostname, port } = location;
  const other = hostname === "localhost" ? "127.0.0.1" : hostname === "127.0.0.1" ? "localhost" : hostname;
  return `${protocol}//${other}${port ? `:${port}` : ""}${import.meta.env.BASE_URL}arcade/standin.html?game=${encodeURIComponent(name)}`;
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
      // in ChimpVibe's embed mode, which says what is happening (engine/embed.ts)
      playUrl: inEmbedMode(MODE === "standin" ? standinUrl(name) : playUrl),
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
  if (MODE === "local") {
    try {
      return { games: await fetchList(LOCAL_LIST), source: "chimpvibe-local" };
    } catch (e) {
      console.warn(`[arcade] ChimpVibe's local showcase isn't available (${e instanceof Error ? e.message : e}): is a local ChimpVibe server running, and is ChimpHouse open at an address it allows? Using the local fixture`);
    }
  } else if (MODE !== "fixture" && MODE !== "standin") {
    try {
      return { games: await fetchList(viaProxy(`${CHIMPVIBE}/shared/showcase.json`)), source: "chimpvibe" };
    } catch (e) {
      console.info(`[arcade] ChimpVibe's game list isn't available (${e instanceof Error ? e.message : e}); using the local fixture`);
    }
  }
  return { games: await fetchList(`${import.meta.env.BASE_URL}arcade/chimphouse.json`), source: "fixture" };
}

// ---------------------------------------------------------------- the Game Room TV's catalogue

/**
 * ?tv=standin plays every TV game in the arcade's local stand-in play page
 * (public/arcade/standin.html), for testing before ChimpVibe lets ChimpHouse
 * frame its games; ?tv=local takes the TV's games from a local ChimpVibe server
 * (see LOCAL_LIST, with ?arcade=local).
 */
const TV_MODE = params.get("tv") ?? import.meta.env.VITE_TV_MODE ?? null;

/** ChimpVibe's public catalogue (https://chimpvibe.dev/shared/catalog.json): its live, visible games, in its order. */
export function parseCatalog(json: unknown): TvGame[] {
  const list = (json as { projects?: unknown })?.projects;
  if (!Array.isArray(list)) throw new Error("catalogue has no projects array");
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const games: TvGame[] = [];
  for (const p of list as Record<string, unknown>[]) {
    const slug = str(p?.slug);
    if (!slug || p.status !== "live" || p.hidden || (p.kind && p.kind !== "game")) continue;
    games.push({
      gameId: str(p.gameId) || `slug:${slug}`,
      name: str(p.name) || slug,
      author: str(p.author),
      playUrl: `https://play.chimpvibe.dev/${slug}`,
      art: str(p.art) ? viaProxy(new URL(str(p.art), CHIMPVIBE).href) : null,
      palette: Array.isArray(p.palette) ? p.palette.filter((c): c is string => typeof c === "string") : [],
    });
  }
  return games;
}

/** An admitted game as the TV takes it, at its play page without the arcade's embed parameters (the TV adds its own). */
function fromArcade(g: ArcadeGame): TvGame {
  const u = new URL(g.playUrl);
  u.searchParams.delete("embed");
  return { gameId: g.gameId, name: g.name, author: g.author, playUrl: u.href, art: g.art, palette: g.palette };
}

/**
 * The games the TV's remote can choose from: ChimpVibe's whole catalogue (the
 * TV plays any ChimpVibe game, not only the arcade's admitted ones). ChimpVibe
 * sends no CORS headers for it yet, so it is read through the dev server's
 * proxy, and elsewhere falls back to the admitted list.
 */
export async function loadTvCatalog(): Promise<{ games: TvGame[]; source: string }> {
  if (TV_MODE === "standin") {
    const res = await fetch(`${import.meta.env.BASE_URL}arcade/chimphouse.json`, { cache: "no-store" });
    const games = parseGameList(await res.json()).map(fromArcade);
    return { games: games.map((g) => ({ ...g, playUrl: standinUrl(g.name) })), source: "stand-in" };
  }
  if (TV_MODE !== "local") {
    try {
      const res = await fetch(viaProxy(`${CHIMPVIBE}/shared/catalog.json`), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { games: parseCatalog(await res.json()), source: "chimpvibe" };
    } catch (e) {
      console.info(`[tv] ChimpVibe's catalogue isn't available (${e instanceof Error ? e.message : e}); using the arcade's game list`);
    }
  }
  const list = await loadGameList();
  return { games: list.games.map(fromArcade), source: list.source };
}
