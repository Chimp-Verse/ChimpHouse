import { DEV_TOOLS_ENABLED, FLY_IN_ENABLED } from "../engine/devFlags";
import { PreviewController } from "../engine/preview";
import { PreviewState, Quality, VIEWER } from "../engine/store";
import { store } from "../engine/store";
import { VIEWPOINTS, findView } from "../world/viewpoints";
import { ClawMachineHud } from "./ClawMachineHud";
import { PinballOverlay } from "./PinballOverlay";
import { PlushPanel, PlushPrompt } from "./PlushHud";
import { AirHockeyOverlay } from "./AirHockeyOverlay";
import { FoosballPanel } from "./FoosballPanel";
import { PlayOverlay } from "./PlayOverlay";
import { Wardrobe } from "./Wardrobe";
import { RemotePanel } from "./RemotePanel";
import { SnackPanel } from "./SnackPanel";
import { TheatreOverlay } from "./TheatreOverlay";
import { RemoteControls, TvOverlay } from "./TvOverlay";

export function Hud({ ctl, s }: { ctl: PreviewController; s: PreviewState }) {
  // while a screen is in use, only it and its frame show; the theatre's player and the
  // games running at cabinets stay in the page throughout (moving or remounting their
  // frames would reload them)
  return (
    <>
      <TheatreOverlay s={s} theatre={ctl.theatre} />
      <PlayOverlay s={s} arcade={ctl.arcade} />
      <TvOverlay s={s} tv={ctl.tv} />
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
        {ctl.tv.holdingRemote && (
          <div className="panel remote">
            <div className="section">TV remote · you choose the Game Room's game</div>
            <div className="tv-now">{s.tvFailed ? `${s.tv.game?.name ?? "The game"} failed to connect for you: turn the TV off` : s.tv.game ? `On the TV: ${s.tv.game.name}` : "The TV is off: choose a game"}</div>
            <RemoteControls s={s} tv={ctl.tv} />
          </div>
        )}
        <PlushPanel s={s} claw={ctl.claw} />
      </div>

      {s.wardrobe && <Wardrobe ctl={ctl} s={s} />}
      <div className="panel views" style={s.wardrobe ? { display: "none" } : undefined}>
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
        <div className="section">Game Room TV</div>
        <div className="tv-now">
          {s.tvFailed ? (
            <>
              {s.tv.game?.name} <em className="tv-failed">failed to connect for you</em>
            </>
          ) : s.tv.game ? (
            <>
              {s.tv.game.name}
              <em className="tv-count">
                {" "}
                · {s.tv.seats.filter(Boolean).length || "no"} player{s.tv.seats.filter(Boolean).length === 1 ? "" : "s"}
              </em>
            </>
          ) : (
            "Off"
          )}
        </div>
        {!ctl.tv.holdingRemote && <div className="theatre-hint">{s.tv.remote ? `${s.tv.remote.name} has the remote.` : "Pick up the remote on the coffee table to choose a game."}</div>}
        {/* this visitor's game plays on with the controller put down */}
        {s.tv.game && ctl.tv.mySeat !== null && ctl.tv.myController === null && (
          <div className="arcade-running">
            <span>
              {s.tv.game.name} <em>playing on · controller {ctl.tv.mySeat} down</em>
            </span>
            <button onClick={() => ctl.tv.quit()}>Quit</button>
          </div>
        )}
        {s.arcadeRunning.length > 0 && (
          <>
            <div className="section">Arcade</div>
            {s.arcadeRunning.map((g) => (
              <div key={g.slot} className="arcade-running">
                <span>
                  {g.name} <em>{g.quitsAt === null ? "running" : `left alone · quits in ${countdown(g.quitsAt)}`}</em>
                </span>
                <button onClick={() => void ctl.arcade.quit(g.slot)}>Quit</button>
              </div>
            ))}
          </>
        )}
        {/* the viewpoint tour and walk/fly are the fly-in camera's (engine/devFlags.ts) */}
        {FLY_IN_ENABLED && (
          <>
            <div className="section">Viewpoints</div>
            {VIEWPOINTS.map((v) => (
              <button key={v.id} className={s.viewId === v.id ? "active" : ""} onClick={() => ctl.goTo(v.id)}>
                <span>{v.label}</span>
                {v.key && <kbd>{v.key}</kbd>}
              </button>
            ))}
          </>
        )}
        <div className="section">Display</div>
        {FLY_IN_ENABLED && <Toggle on={s.walking} label="Walk mode" k="F" onClick={() => ctl.setWalking(!s.walking)} />}
        <Toggle on={s.walking && s.firstPerson} label="From your chimp's eyes" k="V" onClick={() => (s.walking ? ctl.toggleView() : ctl.setWalking(true))} />
        <Toggle on={s.wardrobe} label="Dress your chimp" k="C" onClick={() => ctl.setWardrobe(!s.wardrobe)} />
        {/* night and the cutaways are builder's tools (engine/devFlags.ts) */}
        {DEV_TOOLS_ENABLED && (
          <>
            <Toggle on={s.night} label="Night" k="N" onClick={() => ctl.setNight(!s.night)} />
            <Toggle on={s.roofHidden} label="Hide roofs" k="R" onClick={() => ctl.setRoofHidden(!s.roofHidden)} />
            <Toggle on={s.upperHidden} label="Hide upper level" k="U" onClick={() => ctl.setUpperHidden(!s.upperHidden)} />
          </>
        )}
        {/* the plan overlay and reference images go with the plan views and viewpoints */}
        {FLY_IN_ENABLED && (
          <>
            <Toggle on={s.planOverlay} label="Floor-plan overlay" k="G" onClick={() => ctl.setPlanOverlay(!s.planOverlay)} />
            <Toggle
              on={s.refOverlay !== "off"}
              label={`Reference: ${s.refOverlay}`}
              k="O"
              onClick={() => store.set({ refOverlay: s.refOverlay === "off" ? "thumb" : s.refOverlay === "thumb" ? "full" : "off" })}
            />
          </>
        )}
        {DEV_TOOLS_ENABLED && <Toggle on={s.inspectMode} label="Inspect on click" k="I" onClick={() => store.set({ inspectMode: !s.inspectMode })} />}
        <div className="quality">
          {(["low", "medium", "high"] as Quality[]).map((q) => (
            <button key={q} className={s.quality === q ? "active" : ""} onClick={() => ctl.setQuality(q)}>
              {q}
            </button>
          ))}
        </div>
        {/* change requests and the Blender export are builder's tools (engine/devFlags.ts) */}
        {DEV_TOOLS_ENABLED && (
          <>
            <button className="copy" onClick={() => void ctl.copyReport()}>
              Copy view details <kbd>P</kbd>
            </button>
            <button className="copy" onClick={() => void ctl.downloadRoom()}>
              Download this room (.glb)
            </button>
          </>
        )}
      </div>

      {s.picked && (
        <div className="panel picked">
          <div className="section">Inspected</div>
          <div className="label">{s.picked.label}</div>
          <div className="coords">({s.picked.point.map((v) => v.toFixed(2)).join(", ")})</div>
          <button onClick={() => store.set({ picked: null })}>Clear</button>
        </div>
      )}

      {view?.ref && s.refOverlay === "thumb" && !s.wardrobe && (
        <div className="ref-thumb">
          <img src={view.ref} alt={view.refName} />
          <div>{view.refName}</div>
        </div>
      )}
      {view?.ref && s.refOverlay === "full" && <img className="ref-full" src={view.ref} alt={view.refName} />}

      {FLY_IN_ENABLED && !s.pointerLocked && !s.walking && (
        <div className="hint">
          Click to fly · <b>WASD</b> move · <b>E/Space</b> up · <b>Q/C</b> down · <b>Shift</b> fast · wheel = speed · right-drag to look ·{" "}
          <b>F</b> walk · <b>Alt-click</b> inspect · <b>H</b> help
        </div>
      )}
      {!s.pointerLocked && s.walking && (
        <div className="hint">
          Click to look around · <b>WASD</b> walk · <b>Shift</b> run · right-drag to look · wheel to bring the camera in or out · <b>V</b> your chimp's eyes · <b>C</b> dress your chimp · <b>E</b> play a cabinet or a game-room machine, watch the screen, take a remote or controller, pick up a plush, use the lift or sit down ·{" "}
          {FLY_IN_ENABLED && (
            <>
              <b>F</b> fly ·{" "}
            </>
          )}
          {DEV_TOOLS_ENABLED && (
            <>
              <b>Alt-click</b> inspect ·{" "}
            </>
          )}
          <b>H</b> help
        </div>
      )}
      {s.pointerLocked && <div className="crosshair" />}
      {s.walking && s.arcadePrompt && (
        <div className="play-prompt">
          {s.arcadePrompt.outOfOrder ? (
            <>
              <kbd>E</kbd>Try {s.arcadePrompt.name} again
              <span>{s.arcadePrompt.full ? "it's full" : "it's out of order"}</span>
            </>
          ) : (
            <>
              <kbd>E</kbd>Play {s.arcadePrompt.name}
              <span>or click its screen</span>
            </>
          )}
        </div>
      )}
      {s.walking && s.remotePrompt && (
        <div className="play-prompt low">
          <kbd>E</kbd>
          {s.remotePrompt.action === "take" ? `Pick up remote ${s.remotePrompt.remote}` : "Put the remote down"}
          <span>{s.remotePrompt.action === "take" ? "to control the screen" : "on the stand"}</span>
        </div>
      )}
      {s.walking && s.tvPrompt && (
        <div className="play-prompt low">
          <kbd>E</kbd>
          {s.tvPrompt.item === "tv" ? `Watch ${s.tv.game?.name ?? "the TV"}` : s.tvPrompt.item === "controller" ? controllerPrompt(s, ctl.tv.mySeat, s.tvPrompt.n) : s.tvPrompt.action === "take" ? "Pick up the TV remote" : "Put the remote down"}
          <span>{s.tvPrompt.item === "tv" ? "see everyone's game, or click the TV" : s.tvPrompt.item === "controller" ? (s.tv.seats[s.tvPrompt.n - 1] ? "and sit down to play on" : "and sit down to play on the TV") : s.tvPrompt.action === "take" ? "to choose the game" : "on the coffee table"}</span>
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
      <PlushPrompt s={s} />
      {s.walking && s.seatPrompt && (
        <div className="play-prompt low">
          {s.seatPrompt.action === "taken" ? (
            <>
              {s.seatPrompt.who} is sitting there<span>one chimp to a seat</span>
            </>
          ) : s.seatPrompt.action === "sit" ? (
            <>
              <kbd>E</kbd>Sit down<span>on the {s.seatPrompt.label}</span>
            </>
          ) : (
            <>
              <kbd>E</kbd>Stand up<span>or walk, or Esc</span>
            </>
          )}
        </div>
      )}
      {s.walking && s.snackPrompt && !s.plushPrompt && s.seatPrompt?.action !== "sit" && (
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
        ChimpHouse {DEV_TOOLS_ENABLED && <span>preview</span>}
      </div>
      <div className="area">{s.area}</div>
      {/* where the camera is, the frame rate and what stops the walker: the builder's readout (engine/devFlags.ts) */}
      {DEV_TOOLS_ENABLED && (
        <>
          <div className="coords">
            x {s.pos[0]} · y {s.pos[1]} · z {s.pos[2]} · {s.heading}°
          </div>
          <div className="perf">
            {s.fps} fps · {s.drawCalls} draws · scale {s.renderScale === 1 ? "1.0" : s.renderScale}
            {s.renderScaleAuto ? " (auto)" : ""} · {s.walking ? "walking" : `speed ${s.speed}`}
          </div>
          {s.walking && s.blocked && <div className="bumped">Bumped into {s.blocked}</div>}
        </>
      )}
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
        <h2>{FLY_IN_ENABLED ? "Flying around ChimpHouse" : "Walking around ChimpHouse"}</h2>
        <table>
          <tbody>
            <tr><td>Click the view</td><td>Capture the mouse to look around (Esc releases)</td></tr>
            <tr><td>Right-drag</td><td>Look around without capturing the mouse</td></tr>
            {FLY_IN_ENABLED ? (
              <>
                <tr><td>W A S D / arrows</td><td>Fly forward, left, back, right</td></tr>
                <tr><td>E or Space / Q or C</td><td>Up / down</td></tr>
                <tr><td>Shift / Alt (held)</td><td>Four times faster / slower</td></tr>
                <tr><td>Mouse wheel</td><td>Change base speed (zoom in plan views)</td></tr>
                <tr><td>F</td><td>Walk as your chimp (walls, furniture, stairs and gravity) / fly</td></tr>
              </>
            ) : (
              <>
                <tr><td>W A S D / arrows</td><td>Walk your chimp forward, left, back, right (walls, furniture, stairs and gravity)</td></tr>
                <tr><td>Shift / Alt (held)</td><td>Run / walk slowly</td></tr>
              </>
            )}
            <tr><td>Wheel (walking)</td><td>Bring the camera in to your chimp, or further out behind it; all the way in is from its eyes</td></tr>
            <tr><td>V (walking)</td><td>See from your chimp's eyes, or from behind it</td></tr>
            <tr><td>C (walking)</td><td>Dress your chimp: its body, face, fur and clothes. Kept for your next visit, and everyone sees it</td></tr>
            <tr><td>E (walking)</td><td>Play the arcade cabinet in front of you, or click its screen; Step back under the game leaves it running, Quit ends it</td></tr>
            <tr><td>E (walking, theatre)</td><td>Watch the theatre screen: sit square onto it with YouTube's player over it; Leave walks on</td></tr>
            <tr><td>E (at the stand)</td><td>Pick up a theatre remote, or put yours down: its holder controls the screen</td></tr>
            <tr><td>E (Game Room coffee table)</td><td>Pick up a controller and sit down to play the TV's game, or the TV remote to choose the game for everyone with a controller</td></tr>
            <tr><td>E (facing the Game Room TV)</td><td>Watch everyone playing the TV's game</td></tr>
            <tr><td>E (at the claw machine)</td><td>Play the Chimp Claw: W A S D or arrows steer the claw (the way the view looks), Space drops it (and plays again), V or 1–4 change the view (panel, close up, left, right), Esc leaves</td></tr>
            <tr><td>E (at the claw's pickup door)</td><td>Pick up the plush you won; hold T and move the mouse to turn it and look at it, Q puts it down on the floor, E picks it up again</td></tr>
            <tr><td>E (at a pinball machine)</td><td>Play it: Shift or Z and / flip, hold Space or ↓ to pull the plunger, X . and the arrows nudge, C switches to the view from above and back, Enter starts a new game, Esc leaves</td></tr>
            <tr><td>E (at the air hockey table)</td><td>Play air hockey: your mallet follows the mouse; against the robot, or a visitor at the other end; Esc leaves</td></tr>
            <tr><td>E (walking, foosball table)</td><td>Play foosball from the side you're at: against the robot, or the visitor across the table</td></tr>
            <tr><td>Foosball: mouse up / down</td><td>Your men follow the cursor across the table</td></tr>
            <tr><td>Foosball: flick right, click or Space</td><td>Kick with the glowing rod (nearest the ball), harder the faster the flick; a click spins it right round</td></tr>
            <tr><td>Foosball: wheel or 1–4, right button or Shift, Esc</td><td>Pick another rod (goalie, defence, midfield, attack) / lift your men while held / leave the table</td></tr>
            <tr><td>K / J / L, B (with a remote)</td><td>Play or pause / back 10 s / forward 10 s, for everyone; put the remote back on the stand</td></tr>
            <tr><td>E (at a seat)</td><td>Sit down on the sofa, chair, stool, bench or lounger you look at, when nothing else there takes E; E again (or walking, or Esc) gets up. One chimp to a seat, and everyone sees you sitting</td></tr>
            <tr><td>E (at the snack machine)</td><td>Step up to it, or press the key you point at; type a code (A–E, then 1–6), then push the flap (click it, or Enter) to take your snack; E eats it</td></tr>
            {FLY_IN_ENABLED && <tr><td>1–9, 0, [ ]</td><td>Jump to viewpoints / previous / next</td></tr>}
            {DEV_TOOLS_ENABLED && <tr><td>N</td><td>Day / night</td></tr>}
            {DEV_TOOLS_ENABLED && <tr><td>R / U</td><td>Hide roofs / hide the upper level</td></tr>}
            {FLY_IN_ENABLED && (
              <>
                <tr><td>G</td><td>Floor-plan overlay (in plan views)</td></tr>
                <tr><td>O</td><td>Reference image: thumbnail → overlay → off</td></tr>
              </>
            )}
            {DEV_TOOLS_ENABLED && (
              <>
                <tr><td>Alt-click or I</td><td>Inspect: name the object under the cursor</td></tr>
                <tr><td>P</td><td>Copy viewpoint, camera and inspected object for a change request</td></tr>
              </>
            )}
          </tbody>
        </table>
        {DEV_TOOLS_ENABLED && <p>To ask for a change, press P and paste the copied details along with what you'd like changed.</p>}
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/** Time left until `at` (a Date.now() time), as m:ss. */
function countdown(at: number): string {
  const s = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What picking up TV controller n does: a fresh player, your own game again, or taking over the game left playing with it. */
function controllerPrompt(s: PreviewState, mySeat: number | null, n: number): string {
  const seat = s.tv.seats[n - 1];
  if (!seat) return `Pick up controller ${n}`;
  return mySeat === n ? `Pick up controller ${n} again` : `Take over ${seat.name}'s game`;
}
