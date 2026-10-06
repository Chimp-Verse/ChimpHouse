import { useEffect, useRef, useState } from "react";
import { Focus, PreviewState } from "../engine/store";
import { FocusFrame } from "./FocusFrame";

/**
 * Playing at a cabinet: the game's play page in an iframe lined up over the
 * cabinet's screen (engine/focus.ts keeps `focusRect` on it), framed by the
 * game's name, a hint and a Leave button (FocusFrame). ChimpHouse can't see keys
 * typed into the game's frame, so leaving is a click on this frame, not a key.
 *
 * The frame mounts as the camera glides in, so the page loads meanwhile, and
 * shows once the camera is square onto the screen. Leaving unmounts it, which
 * ends the player's connection to the game.
 */
export function PlayOverlay({ s, onLeave }: { s: PreviewState; onLeave: () => void }) {
  const p = s.focus as Extract<Focus, { kind: "cabinet" }>;
  const r = s.focusRect;
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
    <>
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
        <FocusFrame rect={r} title={p.name} byline={p.author ? `by ${p.author}` : undefined} status={status} onLeave={onLeave}>
          <span className="focus-hint">Keys not reaching the game? Click it.</span>
        </FocusFrame>
      )}
    </>
  );
}
