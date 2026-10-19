import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Arcade } from "../engine/arcade";
import { Focus, PreviewState, RunningGame } from "../engine/store";
import { endedText } from "../engine/embed";
import { FocusFrame } from "./FocusFrame";

/**
 * The games running at cabinets: each one's play page in an iframe, in the
 * page from the first time it is played until Quit (moving or remounting the
 * frame would reload the game). engine/arcade.ts places each frame every frame:
 * exactly over its cabinet's screen while it is played, over the screen in
 * perspective while the visitor walks about with it in view, otherwise hidden,
 * still running. While it is played, a frame of UI round it gives its name, a
 * hint, Step back (it keeps running) and Quit. ChimpHouse can't see keys typed
 * into the game, so both are clicks.
 *
 * The first key after the game's frame takes the keyboard may never reach the
 * game: focus passes from ChimpHouse to the play page to the game in steps, and
 * ChimpVibe found the first key landing on the play page (when it comes within
 * ~20 ms of the hand-off). So the frame asks for any key to start, which is all
 * that key is for. It asks only a play page that says it is ready (ChimpVibe's
 * planned embed mode, which joins without the name box), until the page says the
 * game is playing (its first input), or for START_PROMPT ms if it never says; a
 * page that sends no messages gets the usual hint. An "ended" message (disconnected)
 * shows above the game, which stays open; an "error" puts the
 * cabinet out of order.
 */
export function PlayOverlay({ s, arcade }: { s: PreviewState; arcade: Arcade }) {
  const f = s.focus?.kind === "cabinet" ? s.focus : null;
  return (
    <>
      {s.arcadeRunning.map((g) => (
        <CabinetGame key={`${g.slot}:${g.gameId}`} game={g} arcade={arcade} focus={f?.slot === g.slot ? f : null} rect={f?.slot === g.slot && f.phase === "on" ? s.focusRect : null} />
      ))}
    </>
  );
}

const START_PROMPT = 12_000;

function CabinetGame({ game, arcade, focus, rect }: { game: RunningGame; arcade: Arcade; focus: Focus | null; rect: PreviewState["focusRect"] }) {
  const frame = useRef<HTMLIFrameElement>(null);
  // the address is fixed when the frame mounts: changing it would reload the game
  const [src] = useState(game.url);
  const [status, setStatus] = useState<string | null>(null);
  /** the start prompt: not asked for, showing, or done with */
  const [prompt, setPrompt] = useState<"none" | "asking" | "done">("none");

  useEffect(() => {
    const el = frame.current!;
    arcade.attach(game.slot, el);
    return () => arcade.detach(game.slot, el);
  }, [arcade, game.slot]);

  // the play page's messages in ChimpVibe's embed mode (engine/embed.ts), only from this
  // frame and the game's origin; listened for as the frame mounts, before its page can
  // load and say it is ready. An error is the arcade's to handle (out of order).
  useLayoutEffect(() => {
    const origin = new URL(src, location.href).origin;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== origin) return;
      const msg = arcade.receive(game.slot, e.data);
      if (msg?.type === "ready") {
        setStatus(null);
        setPrompt((was) => (was === "none" ? "asking" : was));
        arcade.giveKeys(game.slot);
      } else if (msg?.type === "playing") {
        setStatus(null);
        setPrompt("done");
      } else if (msg?.type === "ended") setStatus(endedText(msg.reason));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [src, arcade, game.slot]);

  const asking = !!rect && prompt === "asking";
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setPrompt("done"), START_PROMPT);
    return () => clearTimeout(t);
  }, [asking]);

  return (
    <>
      <iframe ref={frame} className="play-frame" src={src} title={game.name} allow="autoplay; fullscreen; gamepad; clipboard-write" onLoad={() => arcade.giveKeys(game.slot)} />
      {rect && focus?.phase === "on" && (
        <FocusFrame
          rect={rect}
          title={game.name}
          byline={game.author ? `by ${game.author}` : undefined}
          status={status}
          onLeave={() => void arcade.stepBack()}
          leaveLabel="Step back"
          quit={{ label: "Quit", onClick: () => void arcade.quit(game.slot) }}
        >
          {game.checking ? (
            <span className="focus-hint">Starting {game.name}…</span>
          ) : asking ? (
            <span className="focus-start">Press any key to start</span>
          ) : (
            <span className="focus-hint">Keys not reaching the game? Click it. Step back to walk about: it keeps running.</span>
          )}
        </FocusFrame>
      )}
    </>
  );
}
