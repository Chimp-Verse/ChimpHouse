import { PreviewState } from "../engine/store";

const TEAM = ["", "Red", "Blue"];

/**
 * Playing air hockey (engine/airHockey.ts): the score along the top, who is at the
 * other end, a hint, and Leave; "Goal!" as one goes in; and once a match is won,
 * Rematch or Leave. Nothing covers the middle of the table while play goes on.
 */
export function AirHockeyOverlay({ s, onLeave, onRematch }: { s: PreviewState; onLeave: () => void; onRematch: () => void }) {
  const h = s.airHockey;
  if (s.focus?.kind !== "airHockey" || s.focus.phase === "out") return null;
  const me = h?.end ?? s.focus.end;
  const them = me === 1 ? 2 : 1;
  const score = h?.score ?? [0, 0];
  const vsRobot = h?.opponent === "the robot";
  const theirName = vsRobot ? "The robot" : h?.opponent ?? "";
  return (
    <div className="ah-layer">
      <div className="ah-top">
        <div className="ah-score">
          <span className="ah-team red">RED</span>
          <b className="red">{score[0]}</b>
          <span className="ah-dash">–</span>
          <b className="blue">{score[1]}</b>
          <span className="ah-team blue">BLUE</span>
        </div>
        <div className="ah-sub">
          You're <span className={me === 1 ? "red" : "blue"}>{TEAM[me]}</span> · against {vsRobot ? "the robot" : theirName} · first to 7
        </div>
        <button className="ah-leave" onClick={onLeave}>
          Leave <kbd>Esc</kbd>
        </button>
      </div>
      {h?.phase === "goal" && h.scored > 0 && (
        <div className={`ah-goal ${h.scored === them ? "mine" : ""}`}>
          GOAL!
          <span>{h.scored === them ? "You scored" : `${theirName} scored`}</span>
        </div>
      )}
      {h?.phase === "over" && (
        <div className="ah-over">
          <div className="ah-result">{h.winner === me ? "You win!" : `${theirName} wins`}</div>
          <div className="ah-final">
            {score[0]} – {score[1]}
          </div>
          {h.waiting ? (
            <div className="ah-wait">Waiting for {theirName} to want a rematch…</div>
          ) : (
            <button className="ah-rematch" onClick={onRematch}>
              Rematch
            </button>
          )}
          <button className="ah-leave-big" onClick={onLeave}>
            Leave
          </button>
        </div>
      )}
      {h?.phase !== "over" && <div className="ah-hint">Move the mouse: your mallet follows it across your half · Esc to leave</div>}
    </div>
  );
}
