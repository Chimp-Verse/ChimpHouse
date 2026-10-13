import { ClawMachine } from "../engine/clawMachine";
import { PreviewState } from "../engine/store";

/**
 * Playing the claw machine (engine/clawMachine.ts): the credit timer, what the
 * claw is doing, the keys, a drop button for the mouse, and Leave. It sits at the
 * top and bottom of the view, clear of the glass box the player looks into.
 */
export function ClawMachineHud({ s, claw }: { s: PreviewState; claw: ClawMachine }) {
  const c = s.claw;
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
      {c.won.length > 0 && over && <div className="claw-won">🎉 {c.won.join(" & ")} — in the pickup door!</div>}
      <div className="claw-hud bottom">
        <span className="claw-keys">
          <kbd>W A S D</kbd> or <kbd>arrows</kbd> steer · <kbd>Space</kbd> {over ? "play again" : "drop"} · <kbd>Esc</kbd> leave
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
