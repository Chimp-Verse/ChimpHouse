import { ReactNode } from "react";
import { ScreenRect } from "../engine/store";

/**
 * The frame of UI round a screen in use (engine/focus.ts): a ring just outside
 * the screen, a bar above it saying what is showing, and a bar below with
 * `children` and a Leave button. None of it lies over the screen, where another
 * site's content is shown (YouTube's terms forbid covering any part of its
 * player), and the content sits above the ring. Keys typed into that content
 * never reach this page, so leaving is a click. `leaveLabel` renames Leave, and
 * `quit` adds a second way out beside it (a cabinet: Step back keeps the game
 * running, Quit ends it).
 */
export function FocusFrame({
  rect: r,
  title,
  byline,
  status,
  children,
  onLeave,
  leaveLabel = "Leave",
  quit,
}: {
  rect: ScreenRect;
  title: string;
  byline?: ReactNode;
  status?: string | null;
  children?: ReactNode;
  onLeave: () => void;
  leaveLabel?: string;
  quit?: { label: string; onClick: () => void };
}) {
  return (
    <div className="focus-layer">
      <div className="focus-ring" style={{ left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12 }} />
      <div className="focus-bar top" style={{ left: r.x - 6, top: r.y - 12, width: r.w + 12 }}>
        <span className="name">{title}</span>
        {byline && <span className="by">{byline}</span>}
        {status && <span className="status">{status}</span>}
      </div>
      <div className="focus-bar bottom" style={{ left: r.x - 6, top: r.y + r.h + 12, width: r.w + 12 }}>
        {children}
        <span className="focus-actions">
          <button className={quit ? "leave secondary" : "leave"} onClick={onLeave}>
            {leaveLabel}
          </button>
          {quit && (
            <button className="leave quit" onClick={quit.onClick}>
              {quit.label}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
