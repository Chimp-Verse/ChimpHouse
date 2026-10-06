import { useState } from "react";
import { PreviewController } from "../engine/preview";
import { PreviewState, VIEWER } from "../engine/store";
import { VideoPicker } from "./TheatreOverlay";

/**
 * The remote in hand (engine/remotes.ts): the theatre's controls for whoever
 * holds a remote, working for everyone in the theatre. Each button has the key
 * YouTube's player uses for it. Putting the remote back hands the control on.
 */
export function RemotePanel({ ctl, s }: { ctl: PreviewController; s: PreviewState }) {
  const [problem, setProblem] = useState<string | null>(null);
  const t = s.theatre;
  const press = (button: "toggle" | "back" | "forward") => setProblem(ctl.theatre.command(button));
  return (
    <div className="panel remote">
      <div className="section">Remote {t.remotes.indexOf(VIEWER) + 1} · you control the theatre</div>
      <div className="theatre-now" title={s.theatreVideo?.title}>
        {t.videoId ? (
          <>
            {t.live && <span className="live">LIVE</span>}
            {s.theatreVideo?.title || "YouTube video"}
          </>
        ) : (
          "Nothing showing: choose a video"
        )}
      </div>
      <div className="remote-buttons">
        <button onClick={() => press("back")} disabled={!t.videoId}>
          −10 s <kbd>J</kbd>
        </button>
        <button className="main" onClick={() => press("toggle")} disabled={!t.videoId}>
          {t.playing ? "Pause" : "Play"} <kbd>K</kbd>
        </button>
        <button onClick={() => press("forward")} disabled={!t.videoId}>
          +10 s <kbd>L</kbd>
        </button>
      </div>
      <VideoPicker theatre={ctl.theatre} />
      {problem && <div className="theatre-error">{problem}</div>}
      <button className="put-back" onClick={() => ctl.remotes.putBack()}>
        Put it back on the stand <kbd>B</kbd>
      </button>
    </div>
  );
}
