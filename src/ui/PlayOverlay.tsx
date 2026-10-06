import { useEffect, useRef, useState } from "react";
import { PreviewState } from "../engine/store";

/**
 * Playing at a cabinet: the game's play page in an iframe lined up over the
 * cabinet's screen (engine/arcade.ts keeps `playRect` on it), framed by the
 * game's name, a hint and a Leave button. ChimpHouse can't see keys typed into
 * the game's frame, so leaving is a click on this frame, not a key.
 *
 * The frame mounts as the camera glides in, so the page loads meanwhile, and
 * shows once the camera is square onto the screen. Leaving unmounts it, which
 * ends the player's connection to the game.
 */
export function PlayOverlay({ s, onLeave }: { s: PreviewState; onLeave: () => void }) {
  const p = s.playing!;
  const r = s.playRect;
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  // the optional messages ChimpVibe's play page may send: ready, playing, ended
  useEffect(() => {
    const origin = new URL(p.url, location.href).origin;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== origin) return;
      const msg = e.data as { type?: string; reason?: string } | null;
      if (msg?.type === "ready" || msg?.type === "playing") {
        setStatus(null);
        frame.current?.focus();
      } else if (msg?.type === "ended") setStatus(`Game ended${msg.reason ? `: ${msg.reason}` : ""}`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [p.url]);

  // give the game the keyboard once it is in place
  const shown = !!r;
  useEffect(() => {
    if (shown) frame.current?.focus();
  }, [shown]);

  if (p.phase === "out") return null;
  return (
    <div className="play-layer">
      <iframe
        ref={frame}
        className={`play-frame ${shown ? "shown" : ""}`}
        src={p.url}
        title={p.name}
        style={r ? { left: r.x, top: r.y, width: r.w, height: r.h } : undefined}
        allow="autoplay; fullscreen; gamepad; clipboard-write"
        onLoad={() => shown && frame.current?.focus()}
      />
      {r && (
        <>
          <div className="play-ring" style={{ left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12 }} />
          <div className="play-bar top" style={{ left: r.x - 6, top: r.y - 50, width: r.w + 12 }}>
            <span className="name">{p.name}</span>
            {p.author && <span className="by">by {p.author}</span>}
            {status && <span className="status">{status}</span>}
          </div>
          <div className="play-bar bottom" style={{ left: r.x - 6, top: r.y + r.h + 12, width: r.w + 12 }}>
            <span className="play-hint">Keys not reaching the game? Click it.</span>
            <button className="leave" onClick={onLeave}>
              Leave
            </button>
          </div>
        </>
      )}
    </div>
  );
}
