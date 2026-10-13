import { PreviewController } from "../engine/preview";
import { PreviewState, Quality, VIEWER } from "../engine/store";
import { store } from "../engine/store";
import { VIEWPOINTS, findView } from "../world/viewpoints";
import { ClawMachineHud } from "./ClawMachineHud";
import { PinballOverlay } from "./PinballOverlay";
import { AirHockeyOverlay } from "./AirHockeyOverlay";
import { FoosballPanel } from "./FoosballPanel";
import { PlayOverlay } from "./PlayOverlay";
import { RemotePanel } from "./RemotePanel";
import { SnackPanel } from "./SnackPanel";
import { TheatreOverlay } from "./TheatreOverlay";

export function Hud({ ctl, s }: { ctl: PreviewController; s: PreviewState }) {
  // while a screen is in use, only it and its frame show; the theatre's player stays in
  // the page throughout (moving or remounting its frame would reload it)
  return (
    <>
      <TheatreOverlay s={s} theatre={ctl.theatre} />
      {s.focus?.kind === "cabinet" && <PlayOverlay s={s} onLeave={() => void ctl.leaveCabinet()} />}
      {s.focus?.kind === "claw" && <ClawMachineHud s={s} claw={ctl.claw} />}
      {s.focus?.kind === "pinball" && <PinballOverlay s={s} onLeave={() => void ctl.pinball.leave()} onStart={() => ctl.pinball.start()} />}
      {s.focus?.kind === "airHockey" && <AirHockeyOverlay s={s} onLeave={() => void ctl.airHockey.leave()} onRematch={() => ctl.airHockey.askRematch()} />}
      {s.focus?.kind === "foosball" && <FoosballPanel s={s} foosball={ctl.foosball} />}
      {s.focus?.kind === "snack" && <SnackPanel s={s} onLeave={() => void ctl.snacks.leave()} />}
      {!s.focus && <Panels ctl={ctl} s={s} />}
      {s.toast && <div className="toast">{s.toast}</div>}
    </>
  );
}

function Panels({ ctl, s }: { ctl: PreviewController; s: PreviewState }) {
  const view = findView(s.viewId);
  const holding = s.theatre.remotes.includes(VIEWER);
  return (
    <>
      <div className="left-stack">
        <StatusPanel s={s} />
        {holding && <RemotePanel ctl={ctl} s={s} />}
      </div>

      <div className="panel views">
        <div className="section">Theatre</div>
        <div className="theatre-now" title={s.theatreVideo?.title}>
          {s.theatre.videoId ? (
            <>
              {s.theatre.live && <span className="live">LIVE</span>}
              {s.theatreVideo?.title || "YouTube video"}
            </>
          ) : (
            "Nothing showing"
          )}
        </div>
        {!holding && <div className="theatre-hint">Pick up a remote from the stand under the screen to choose or control what's showing.</div>}
        {s.theatreError && <div className="theatre-error">{s.theatreError}</div>}
        <div className="section">Viewpoints</div>
        {VIEWPOINTS.map((v) => (
          <button key={v.id} className={s.viewId === v.id ? "active" : ""} onClick={() => ctl.goTo(v.id)}>
            <span>{v.label}</span>
            {v.key && <kbd>{v.key}</kbd>}
          </button>
        ))}
        <div className="section">Display</div>
        <Toggle on={s.walking} label="Walk mode" k="F" onClick={() => ctl.setWalking(!s.walking)} />
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
        <button className="copy" onClick={() => void ctl.downloadRoom()}>
          Download this room (.glb)
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

      {!s.pointerLocked && !s.walking && (
        <div className="hint">
          Click to fly · <b>WASD</b> move · <b>E/Space</b> up · <b>Q/C</b> down · <b>Shift</b> fast · wheel = speed · right-drag to look ·{" "}
          <b>F</b> walk · <b>Alt-click</b> inspect · <b>H</b> help
        </div>
      )}
      {!s.pointerLocked && s.walking && (
        <div className="hint">
          Click to look around · <b>WASD</b> walk · <b>Shift</b> run · right-drag to look · <b>E</b> play a cabinet or a game-room machine, watch the screen, take a remote or use the lift · <b>F</b> fly · <b>Alt-click</b> inspect · <b>H</b> help
        </div>
      )}
      {s.pointerLocked && <div className="crosshair" />}
      {s.walking && s.arcadePrompt && (
        <div className="play-prompt">
          <kbd>E</kbd>Play {s.arcadePrompt.name}
          <span>or click its screen</span>
        </div>
      )}
      {s.walking && s.remotePrompt && (
        <div className="play-prompt low">
          <kbd>E</kbd>
          {s.remotePrompt.action === "take" ? `Pick up remote ${s.remotePrompt.remote}` : "Put the remote down"}
          <span>{s.remotePrompt.action === "take" ? "to control the screen" : "on the stand"}</span>
        </div>
      )}
      {s.walking && s.theatrePrompt && (
        <div className="play-prompt low">
          <kbd>E</kbd>Watch {s.theatre.videoId ? s.theatreVideo?.title || "the video" : "the theatre screen"}
          {/* with a video, the player lies over the screen and a free mouse's click is the player's */}
          {!s.theatre.videoId && <span>or click the screen</span>}
        </div>
      )}
      {s.walking && s.airHockeyPrompt && (
        <div className="play-prompt">
          {s.airHockeyPrompt.end ? (
            <>
              <kbd>E</kbd>Play air hockey
              <span>
                at the {s.airHockeyPrompt.end === 1 ? "red" : "blue"} end, against {s.airHockeyPrompt.opponent}
              </span>
            </>
          ) : (
            <>
              Air hockey<span>both ends are taken</span>
            </>
          )}
        </div>
      )}
      {s.walking && s.foosballPrompt && (
        <div className="play-prompt">
          {"side" in s.foosballPrompt ? (
            <>
              <kbd>E</kbd>Play foosball as {s.foosballPrompt.side}
              <span>against {s.foosballPrompt.against}</span>
            </>
          ) : (
            <>
              Foosball: {s.foosballPrompt.full}
              <span>both sides are taken</span>
            </>
          )}
        </div>
      )}
      {s.walking && s.liftPrompt && (
        <div className="play-prompt low">
          <kbd>E</kbd>
          {s.liftPrompt.label}
          <span>or click the button</span>
        </div>
      )}
      {s.walking && s.clawPrompt && (
        <div className="play-prompt low">
          {s.clawBusy ? (
            <>
              Chimp Claw in use<span>{s.clawBusy} is playing: watch their claw</span>
            </>
          ) : (
            <>
              <kbd>E</kbd>Play the Chimp Claw
              <span>steer the claw, drop it, win a plush</span>
            </>
          )}
        </div>
      )}
      {s.walking && s.pinballPrompt && (
        <div className="play-prompt low">
          <kbd>E</kbd>
          {s.pinballPrompt.busy ? `${s.pinballPrompt.busy} is playing ${s.pinballPrompt.name}` : `Play ${s.pinballPrompt.name}`}
          <span>{s.pinballPrompt.busy ? "one player at a time" : "pinball, 3 balls"}</span>
        </div>
      )}
      {s.walking && s.snackPrompt && (
        <div className="play-prompt low">
          <kbd>E</kbd>
          {s.snackPrompt.label}
          <span>{s.snackPrompt.action === "key" ? "or click it" : s.snackPrompt.action === "take" ? "or click the flap" : s.snackPrompt.action === "use" ? "or point at its keys" : "in your hand"}</span>
        </div>
      )}
      {s.help && <Help onClose={() => store.set({ help: false })} />}
    </>
  );
}

function StatusPanel({ s }: { s: PreviewState }) {
  return (
    <div className="panel status">
      <div className="title">
        ChimpHouse <span>preview</span>
      </div>
      <div className="area">{s.area}</div>
      <div className="coords">
        x {s.pos[0]} · y {s.pos[1]} · z {s.pos[2]} · {s.heading}°
      </div>
      <div className="perf">
        {s.fps} fps · {s.drawCalls} draws · {s.walking ? "walking" : `speed ${s.speed}`}
      </div>
      {s.walking && s.blocked && <div className="bumped">Bumped into {s.blocked}</div>}
    </div>
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
            <tr><td>F</td><td>Walk at avatar height (walls, furniture, stairs and gravity) / fly</td></tr>
            <tr><td>E (walking)</td><td>Play the arcade cabinet in front of you, or click its screen; Leave under the game walks on</td></tr>
            <tr><td>E (walking, theatre)</td><td>Watch the theatre screen: sit square onto it with YouTube's player over it; Leave walks on</td></tr>
            <tr><td>E (at the stand)</td><td>Pick up a theatre remote, or put yours down: its holder controls the screen</td></tr>
            <tr><td>E (at the claw machine)</td><td>Play the Chimp Claw: W A S D or arrows steer the claw, Space drops it (and plays again), Esc leaves</td></tr>
            <tr><td>E (at a pinball machine)</td><td>Play it: Shift or Z and / flip, hold Space or ↓ to pull the plunger, X . and the arrows nudge, C switches to the view from above and back, Enter starts a new game, Esc leaves</td></tr>
            <tr><td>E (at the air hockey table)</td><td>Play air hockey: your mallet follows the mouse; against the robot, or a visitor at the other end; Esc leaves</td></tr>
            <tr><td>E (walking, foosball table)</td><td>Play foosball from the side you're at: against the robot, or the visitor across the table</td></tr>
            <tr><td>Foosball: mouse up / down</td><td>Your men follow the cursor across the table</td></tr>
            <tr><td>Foosball: flick right, click or Space</td><td>Kick with the glowing rod (nearest the ball), harder the faster the flick; a click spins it right round</td></tr>
            <tr><td>Foosball: wheel or 1–4, right button or Shift, Esc</td><td>Pick another rod (goalie, defence, midfield, attack) / lift your men while held / leave the table</td></tr>
            <tr><td>K / J / L, B (with a remote)</td><td>Play or pause / back 10 s / forward 10 s, for everyone; put the remote back on the stand</td></tr>
            <tr><td>E (at the snack machine)</td><td>Step up to it, or press the key you point at; type a code (A–E, then 1–6), then push the flap (click it, or Enter) to take your snack; E eats it</td></tr>
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
