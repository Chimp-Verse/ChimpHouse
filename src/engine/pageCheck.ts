// Checking that a ChimpVibe play page will show in ChimpHouse, as a game
// starts at an arcade cabinet (engine/arcade.ts) or on the Game Room TV
// (engine/gameTv.ts). A page that speaks ChimpVibe's embed mode says what goes
// wrong itself, in an "error" message (engine/embed.ts); these catch what such
// a page can't say, because it never loads.

/** How long a game's page may take to load before it counts as failed. */
export const LOAD_MS = 20_000;

/**
 * Why a play page won't show here, or null when it loads. The game's own
 * frame can't tell: it fires "load" for a 404 or a refused page as for a working
 * one, and its contents can't be read. So the page is also loaded, out of sight
 * and briefly, as an <object>, which fires "error" when the answer is an error
 * status or the page refuses to be shown in ChimpHouse; a prefetch, which fails
 * only on an error status, tells the two apart. An error the page shows after
 * loading normally (a game unavailable, a refused connection) can only come from
 * the page itself, as an "error" message.
 */
export async function pageProblem(url: string): Promise<string | null> {
  const down = await unreachable(url);
  if (down) return down;
  if ((await probe("object", url)) !== "error") return null;
  return (await probe("prefetch", url)) === "error" ? "ChimpVibe answered with an error" : "ChimpVibe won't let it show here";
}

/** "ChimpVibe can't be reached" when a play page's server doesn't answer at all; otherwise null. One cheap request, whose answer can't be read. */
async function unreachable(url: string): Promise<string | null> {
  try {
    await fetch(url, { method: "HEAD", mode: "no-cors", cache: "no-store" });
    return null;
  } catch {
    return "ChimpVibe can't be reached";
  }
}

/** Load a URL as an out-of-sight <object> or a prefetch, and report how it went. */
function probe(kind: "object" | "prefetch", url: string): Promise<"load" | "error" | "timeout"> {
  return new Promise((resolve) => {
    let el: HTMLObjectElement | HTMLLinkElement;
    if (kind === "object") {
      const o = document.createElement("object");
      o.type = "text/html";
      o.data = url;
      Object.assign(o.style, { position: "fixed", left: "-10000px", top: "0", width: "320px", height: "200px", visibility: "hidden", pointerEvents: "none" });
      document.body.append(o);
      el = o;
    } else {
      const l = document.createElement("link");
      l.rel = "prefetch";
      // its own address, so the browser fetches it rather than answering from what it has
      l.href = `${url}${url.includes("?") ? "&" : "?"}chimphouse-check=${Date.now()}`;
      document.head.append(l);
      el = l;
    }
    const done = (how: "load" | "error" | "timeout") => {
      clearTimeout(timer);
      el.remove();
      resolve(how);
    };
    const timer = setTimeout(() => done("timeout"), LOAD_MS);
    el.addEventListener("load", () => done("load"), { once: true });
    el.addEventListener("error", () => done("error"), { once: true });
  });
}
