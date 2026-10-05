import { PreviewController } from "../engine/preview";
import { PreviewState, Quality } from "../engine/store";
import { store } from "../engine/store";
import { VIEWPOINTS, findView } from "../world/viewpoints";

export function Hud({ ctl, s }: { ctl: PreviewController; s: PreviewState }) {
  const view = findView(s.viewId);
  return (
    <>
      <div className="panel status">
        <div className="title">
          ChimpHouse <span>preview</span>
        </div>
        <div className="area">{s.area}</div>
        <div className="coords">
          x {s.pos[0]} · y {s.pos[1]} · z {s.pos[2]} · {s.heading}°
        </div>
        <div className="perf">
          {s.fps} fps · {s.drawCalls} draws · speed {s.speed}
        </div>
      </div>

      <div className="panel views">
        <div className="section">Viewpoints</div>
        {VIEWPOINTS.map((v) => (
          <button key={v.id} className={s.viewId === v.id ? "active" : ""} onClick={() => ctl.goTo(v.id)}>
            <span>{v.label}</span>
            {v.key && <kbd>{v.key}</kbd>}
          </button>
        ))}
        <div className="section">Display</div>
        <Toggle on={s.night} label="Night" k="N" onClick={() => ctl.setNight(!s.night)} />
        <Toggle on={s.roofHidden} label="Hide roofs" k="R" onClick={() => ctl.setRoofHidden(!s.roofHidden)} />
        <Toggle on={s.upperHidden} label="Hide upper level" k="U" onClick={() => ctl.setUpperHidden(!s.upperHidden)} />
        <Toggle on={s.planOverlay} label="Floor-plan overlay" k="G" onClick={() => ctl.setPlanOverlay(!s.planOverlay)} />
        <Toggle
          on={s.refOverlay !== "off"}
          label={`Reference: ${s.refOverlay}`}
          k="O"
          onClick={() => store.set({ refOverlay: s.refOverlay === "off" ? "thumb" : s.refOverlay === "thumb" ? "full" : "off" })}
        />
        <Toggle on={s.inspectMode} label="Inspect on click" k="I" onClick={() => store.set({ inspectMode: !s.inspectMode })} />
        <div className="quality">
          {(["low", "medium", "high"] as Quality[]).map((q) => (
            <button key={q} className={s.quality === q ? "active" : ""} onClick={() => ctl.setQuality(q)}>
              {q}
            </button>
          ))}
        </div>
        <button className="copy" onClick={() => void ctl.copyReport()}>
          Copy view details <kbd>P</kbd>
        </button>
      </div>

      {s.picked && (
        <div className="panel picked">
          <div className="section">Inspected</div>
          <div className="label">{s.picked.label}</div>
          <div className="coords">({s.picked.point.map((v) => v.toFixed(2)).join(", ")})</div>
          <button onClick={() => store.set({ picked: null })}>Clear</button>
        </div>
      )}

      {view?.ref && s.refOverlay === "thumb" && (
        <div className="ref-thumb">
          <img src={view.ref} alt={view.refName} />
          <div>{view.refName}</div>
        </div>
      )}
      {view?.ref && s.refOverlay === "full" && <img className="ref-full" src={view.ref} alt={view.refName} />}

      {!s.pointerLocked && (
        <div className="hint">
          Click to fly · <b>WASD</b> move · <b>E/Space</b> up · <b>Q/C</b> down · <b>Shift</b> fast · wheel = speed · right-drag to look ·{" "}
          <b>Alt-click</b> inspect · <b>H</b> help
        </div>
      )}
      {s.pointerLocked && <div className="crosshair" />}
      {s.toast && <div className="toast">{s.toast}</div>}
      {s.help && <Help onClose={() => store.set({ help: false })} />}
    </>
  );
}

function Toggle({ on, label, k, onClick }: { on: boolean; label: string; k: string; onClick: () => void }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={onClick}>
      <span className="dot" />
      <span>{label}</span>
      <kbd>{k}</kbd>
    </button>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="help" onClick={onClose}>
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <h2>Flying around ChimpHouse</h2>
        <table>
          <tbody>
            <tr><td>Click the view</td><td>Capture the mouse to look around (Esc releases)</td></tr>
            <tr><td>Right-drag</td><td>Look around without capturing the mouse</td></tr>
            <tr><td>W A S D / arrows</td><td>Fly forward, left, back, right</td></tr>
            <tr><td>E or Space / Q or C</td><td>Up / down</td></tr>
            <tr><td>Shift / Alt (held)</td><td>Four times faster / slower</td></tr>
            <tr><td>Mouse wheel</td><td>Change base speed (zoom in plan views)</td></tr>
            <tr><td>1–9, 0, [ ]</td><td>Jump to viewpoints / previous / next</td></tr>
            <tr><td>N</td><td>Day / night</td></tr>
            <tr><td>R / U</td><td>Hide roofs / hide the upper level</td></tr>
            <tr><td>G</td><td>Floor-plan overlay (in plan views)</td></tr>
            <tr><td>O</td><td>Reference image: thumbnail → overlay → off</td></tr>
            <tr><td>Alt-click or I</td><td>Inspect: name the object under the cursor</td></tr>
            <tr><td>P</td><td>Copy viewpoint, camera and inspected object for a change request</td></tr>
          </tbody>
        </table>
        <p>To ask for a change, press P and paste the copied details along with what you'd like changed.</p>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
