import { ClawMachine } from "../engine/clawMachine";
import { PreviewState } from "../engine/store";

/** E's prompt to pick up a won plush (engine/clawPlush.ts): at the claw's pickup door, or looking at one on the floor. */
export function PlushPrompt({ s }: { s: PreviewState }) {
  if (!s.walking || !s.plushPrompt) return null;
  return (
    <div className="play-prompt low">
      <kbd>E</kbd>
      {s.plushPrompt.label}
      <span>{s.plushPrompt.sub}</span>
    </div>
  );
}

/**
 * The plush carried (engine/clawPlush.ts), in the left column under the status: its name and
 * keys, with buttons for the mouse: Look (held down, it comes up to turn) and Put down.
 */
export function PlushPanel({ s, claw }: { s: PreviewState; claw: ClawMachine }) {
  const held = s.plushHeld;
  if (!held) return null;
  return (
    <div className={`panel plush ${held.turning ? "turning" : ""}`}>
      <div className="section">Carrying</div>
      <div className="plush-name">{held.name}</div>
      <div className="plush-keys">
        {held.turning ? (
          <>Move the mouse to turn it; let go of <kbd>T</kbd> to hold it again</>
        ) : (
          <>
            Hold <kbd>T</kbd> and move the mouse to look at it · <kbd>Q</kbd> puts it down
          </>
        )}
      </div>
      <div className="remote-buttons">
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            claw.plush.setTurning(true);
          }}
          onPointerUp={() => claw.plush.setTurning(false)}
          onPointerLeave={() => claw.plush.setTurning(false)}
        >
          Look <kbd>T</kbd>
        </button>
        <button className="main" disabled={!s.walking} onClick={() => claw.plush.putDown()}>
          Put down <kbd>Q</kbd>
        </button>
      </div>
    </div>
  );
}
