import { useEffect, useRef, useState } from "react";
import { PreviewState, VIEWER } from "../engine/store";
import { Theatre } from "../engine/theatre";
import { watchUrl } from "../engine/youtube";
import { FocusFrame } from "./FocusFrame";

/**
 * The theatre's player, and its frame while someone watches. The player
 * (YouTube's, or the test stand-in) is in the page while the theatre has a
 * video; engine/theatre.ts places it each frame: exactly over the screen as a
 * plain rectangle in watch mode, over it in perspective while the viewer moves
 * about the theatre, otherwise hidden and paused. In watch mode the frame round
 * it shows the title, a box to choose another video (for a remote's holder),
 * and Leave.
 */
export function TheatreOverlay({ s, theatre }: { s: PreviewState; theatre: Theatre }) {
  const id = s.theatre.videoId;
  const f = s.focus?.kind === "theatre" ? s.focus : null;
  const rect = f?.phase === "on" ? s.focusRect : null;
  const title = s.theatreVideo?.title || (id ? "YouTube video" : "Nothing showing yet");
  const byline = id ? `YouTube${s.theatreVideo?.channel ? ` · ${s.theatreVideo.channel}` : ""}${s.theatre.live ? " · LIVE" : ""}` : "ChimpHouse Theatre";
  return (
    <>
      {id && <Player key={id} theatre={theatre} title={title} />}
      {rect && (
        <FocusFrame rect={rect} title={title} byline={byline} onLeave={() => void theatre.leave()}>
          {s.theatre.remotes.includes(VIEWER) ? (
            <VideoPicker theatre={theatre} autoFocus={!id} />
          ) : (
            <span className="focus-hint">Pick up a remote from the stand under the screen to change what's showing.</span>
          )}
          {s.theatreError && (
            <span className="focus-error">
              {s.theatreError}
              {id && (
                <>
                  {" "}
                  <a href={watchUrl(id)} target="_blank" rel="noopener">
                    Watch on YouTube
                  </a>
                </>
              )}
            </span>
          )}
        </FocusFrame>
      )}
    </>
  );
}

/**
 * The player's frame, for one video: its address is fixed when it mounts, since
 * changing it reloads the player. The theatre places, shows and hides it.
 */
function Player({ theatre, title }: { theatre: Theatre; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [src] = useState(() => theatre.frameSrc());
  useEffect(() => {
    const frame = ref.current!;
    void theatre.attach(frame);
    return () => theatre.detach(frame);
  }, [theatre]);
  return <iframe ref={ref} className="theatre-player" src={src} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />;
}

/** A box to paste a YouTube link (or video ID) into, for a video or a live stream, and Show. */
export function VideoPicker({ theatre, autoFocus = false }: { theatre: Theatre; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="video-picker"
      onSubmit={(e) => {
        e.preventDefault();
        // the click (or Enter) that shows it is what lets the browser play it with sound
        const why = theatre.choose(text);
        setProblem(why);
        if (!why) setText("");
      }}
    >
      <input
        value={text}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder="Paste a YouTube link or video ID"
        aria-label="YouTube link or video ID"
        onChange={(e) => {
          setText(e.target.value);
          setProblem(null);
        }}
      />
      <button type="submit" disabled={!text.trim()}>
        Show
      </button>
      {problem && <span className="picker-problem">{problem}</span>}
    </form>
  );
}
