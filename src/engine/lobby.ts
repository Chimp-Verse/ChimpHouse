// The lobby: where every visitor chooses a name and a look before going into the house
// (ui/Lobby.tsx draws it, preview.ts holds the chimp still at the spawn point behind it). What
// they choose is kept in this browser and offered again next time; the look is the chimp's DNA,
// kept as it always is (engine/avatars.ts), the name here.
//
// It comes up on every visit, except:
// - in browsers driven by test tools (Playwright, Puppeteer: `navigator.webdriver`), so the
//   house's browser tests walk in at once as before; `?lobby=1` brings it up for them too
// - with `?lobby=0` in the address
// - when the developer-only fly-in camera starts flying (?view=, ?pose=, capture): nobody spawns

import { LIMITS, cleanName } from "./roomProtocol";

const NAME_KEY = "chimphouse.name.v1";

/** The most letters a name chosen in the lobby may have. */
export const NAME_CHARS = LIMITS.chosenNameChars;

/** Whether this visit starts in the lobby (given that the visitor is going to spawn). */
export function lobbyWanted(params: URLSearchParams): boolean {
  const asked = params.get("lobby");
  if (asked === "1") return true;
  if (asked === "0") return false;
  return !navigator.webdriver;
}

/** The name to offer: the one kept from the last visit, or ?name=. */
export function savedName(params: URLSearchParams): string {
  let kept = "";
  try {
    kept = localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    /* storage unavailable */
  }
  return cleanName(kept || params.get("name") || "").slice(0, NAME_CHARS);
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable: it lasts this visit */
  }
}

/** What is wrong with a name as typed, in words for the visitor, or null when it will do. */
export function nameProblem(typed: string): string | null {
  const name = cleanName(typed);
  if (!name) return "Type a name for your chimp first.";
  if (name.length > NAME_CHARS) return `Names can be up to ${NAME_CHARS} letters (this one has ${name.length}).`;
  return null;
}
