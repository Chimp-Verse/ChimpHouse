import { PreviewState } from "../engine/store";

/**
 * At the snack machine (engine/snackMachine.ts): how to use it, and Leave. The machine itself
 * is the rest: its keys light up under the mouse, and its display says what's happening.
 */
export function SnackPanel({ s, onLeave }: { s: PreviewState; onLeave: () => void }) {
  if (s.focus?.kind !== "snack" || s.focus.phase !== "on") return null;
  return (
    <div className="snack-panel">
      <div className="snack-title">Chimp Chomp</div>
      <div className="snack-help">
        Type a code, a letter <kbd>A</kbd>–<kbd>E</kbd> then a number <kbd>1</kbd>–<kbd>6</kbd>, or click the keys. <kbd>⌫</kbd> clears.
        <br />
        When your snack drops, click the <b>PUSH</b> flap or press <kbd>Enter</kbd> to take it.
      </div>
      <button onClick={onLeave}>
        Leave <kbd>Esc</kbd>
      </button>
    </div>
  );
}
