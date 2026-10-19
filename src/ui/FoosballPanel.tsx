import { Foosball } from "../engine/foosball";
import { PreviewState } from "../engine/store";
import { WIN_SCORE } from "../world/props/foosballSpec";

/**
 * Playing foosball (engine/foosball.ts): the scoreboard over the table, a word
 * for a goal or a serve, how to play on a first match, the rod you kick with and
 * the controls along the bottom with Leave, and Rematch or Leave once a side has
 * won. The table itself is the game: nothing covers the field.
 */
export function FoosballPanel({ s, foosball }: { s: PreviewState; foosball: Foosball }) {
  const v = s.foosball;
  const f = s.focus;
  if (!v || f?.kind !== "foosball" || f.phase === "out") return null;
  const won = v.winner === v.you;
  return (
    <div className="foos-layer">
      <div className="foos-score">
        <span className={`team red ${v.you === "red" ? "you" : ""}`}>{v.names.red}</span>
        <span className="num red">{v.red}</span>
        <span className="dash">:</span>
        <span className="num blue">{v.blue}</span>
        <span className={`team blue ${v.you === "blue" ? "you" : ""}`}>{v.names.blue}</span>
        <span className="to">first to {WIN_SCORE}</span>
      </div>
      {v.callout && <div className={`foos-callout ${v.callout === "GOAL!" ? "goal" : ""}`}>{v.callout}</div>}
      {v.coach && v.phase !== "over" && (
        <div className="foos-coach">
          <div>
            <b>Move the mouse up and down</b> — your men follow it across the table
          </div>
          <div>
            <b>Flick it right</b> (or click) — the glowing rod kicks, harder the faster you flick
          </div>
          <div>
            <b>The glowing rod</b> is always the one nearest the ball
          </div>
        </div>
      )}
      {v.phase === "over" && (
        <div className="foos-over">
          <div className="title">{won ? "You win!" : `${v.names[v.winner ?? "red"]} wins`}</div>
          <div className="final">
            <span className="red">{v.red}</span> : <span className="blue">{v.blue}</span>
          </div>
          <div className="buttons">
            <button className="again" onClick={() => foosball.rematch()}>
              Rematch
            </button>
            <button className="leave" onClick={() => void foosball.leave()}>
              Leave
            </button>
          </div>
        </div>
      )}
      <div className="foos-bar">
        <span className={`rod ${v.you}`}>
          Kicking with <b>{v.active.name}</b>
          {v.active.picked ? " (picked)" : ""}
        </span>
        <span className="keys">
          <b>mouse ↕</b> slide · <b>flick →</b> or <b>click</b> kick · <b>wheel / 1–4</b> pick a rod · hold <b>right button</b> lift · <b>Esc</b> leave
        </span>
        <button className="leave" onClick={() => void foosball.leave()}>
          Leave
        </button>
      </div>
    </div>
  );
}
