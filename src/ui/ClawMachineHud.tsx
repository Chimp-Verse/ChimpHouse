import { useEffect, useRef, useState } from "react";
import { CLAW_VIEWS, ClawMachine } from "../engine/clawMachine";
import { PreviewState } from "../engine/store";

/**
 * Playing the claw machine (engine/clawMachine.ts): the credit timer, what the
 * claw is doing, the keys, the views, a drop button for the mouse, and Leave. It
 * sits at the top and bottom of the view, clear of the glass box the player looks
 * into. A change of view says for a moment which it is, and that the keys steer
 * the way it looks.
 */
export function ClawMachineHud({ s, claw }: { s: PreviewState; claw: ClawMachine }) {
  const c = s.claw;
  const view = c?.view ?? "Panel";
  const [hint, setHint] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setHint(view === "Panel" ? "Panel view" : `${view} view · the keys steer the way you see it`);
    const t = setTimeout(() => setHint(null), 2400);
    return () => clearTimeout(t);
  }, [view]);
  if (s.focus?.kind !== "claw" || !c) return null;
  const steering = c.phase === "aim";
  const over = c.phase === "over" || c.phase === "idle";
  return (
    <>
      <div className="claw-hud top">
        <div className="claw-title">Chimp Claw</div>
        <div className={`claw-timer ${steering && c.timer <= 5 ? "hurry" : ""}`}>{steering ? `${c.timer}s` : over ? "—" : "…"}</div>
        <div className="claw-message">{c.message}</div>
      </div>
      {c.won.length > 0 && over && !hint && <div className="claw-won">🎉 {c.won.join(" & ")} — in the pickup door! Pick it up there with E</div>}
      {hint && <div className="claw-view-hint">{hint}</div>}
      <div className="claw-hud bottom">
        <span className="claw-keys">
          <kbd>W A S D</kbd> or <kbd>arrows</kbd> steer · <kbd>Space</kbd> {over ? "play again" : "drop"} · <kbd>V</kbd> view · <kbd>Esc</kbd> leave
        </span>
        <span className="claw-views">
          {CLAW_VIEWS.map((v, i) => (
            <button key={v.id} className={v.name === view ? "on" : ""} title={`${v.name} (${i + 1})`} onClick={() => claw.setView(v.id)}>
              {v.short}
            </button>
          ))}
        </span>
        <button
          className="claw-drop"
          disabled={!steering && !over}
          onPointerDown={(e) => {
            e.preventDefault();
            claw.pressDrop();
          }}
          onPointerUp={() => claw.releaseDrop()}
          onPointerLeave={() => claw.releaseDrop()}
        >
          {over ? "Play again" : "Drop"}
        </button>
        <button className="claw-leave" onClick={() => void claw.leave()}>
          Leave
        </button>
      </div>
    </>
  );
}
