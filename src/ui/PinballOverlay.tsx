import { PreviewState } from "../engine/store";

/**
 * Playing a pinball machine: a panel beside it with the score (the machine's
 * own display shows it too), the ball, the machine's high scores and its keys,
 * and Leave. The keys go to the machine (engine/pinball.ts).
 */
export function PinballOverlay({ s, onLeave, onStart }: { s: PreviewState; onLeave: () => void; onStart: () => void }) {
  const p = s.pinball;
  const f = s.focus;
  if (f?.kind !== "pinball" || f.phase === "out") return null;
  return (
    <div className="panel pinball-panel">
      <div className="pinball-name">{f.name}</div>
      {p && (
        <>
          <div className="pinball-score">{p.score.toLocaleString("en-US")}</div>
          <div className="pinball-ball">
            {p.state === "over" ? "Game over" : `Ball ${p.ball} of 3`}
            {p.extra > 0 && <span> · extra ball</span>}
            {p.tilted && <span className="tilt"> · TILT</span>}
          </div>
          {p.status && p.state !== "over" && <div className="pinball-status">{p.status}</div>}
          <div className="pinball-pull">
            <div style={{ width: `${Math.round(p.pull * 100)}%` }} />
          </div>
          {p.state === "over" && (
            <button className="pinball-start" onClick={onStart}>
              Play again <kbd>Enter</kbd>
            </button>
          )}
          <div className="section">High scores</div>
          <ol className="pinball-high">
            {p.high.length ? p.high.map((h, i) => <li key={i}><span>{h.name}</span><b>{h.score.toLocaleString("en-US")}</b></li>) : <li className="none">None yet: be the first</li>}
          </ol>
        </>
      )}
      <div className="section">Keys</div>
      <table className="pinball-keys">
        <tbody>
          <tr><td><kbd>Shift</kbd> <kbd>Z</kbd> · <kbd>Shift</kbd> <kbd>/</kbd></td><td>Left · right flippers</td></tr>
          <tr><td><kbd>Space</kbd> or <kbd>↓</kbd></td><td>Hold to pull the plunger, let go to launch</td></tr>
          <tr><td><kbd>X</kbd> <kbd>.</kbd> <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd></td><td>Nudge (too much tilts)</td></tr>
          <tr><td><kbd>Enter</kbd></td><td>New game</td></tr>
        </tbody>
      </table>
      <button className="pinball-leave" onClick={onLeave}>
        Leave <kbd>Esc</kbd>
      </button>
    </div>
  );
}
