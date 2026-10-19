import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { endedText } from "../engine/embed";
import { GameTv, spareTvPart, tvParts } from "../engine/gameTv";
import { ME } from "../engine/room";
import { PreviewState, ScreenRect, TvFrame, TvPane } from "../engine/store";
import { playerColor } from "../world/props/tvScreen";
import { FocusFrame } from "./FocusFrame";

/**
 * The Game Room TV for a player sitting at it (engine/gameTv.ts): their game,
 * ChimpVibe's play page in an iframe over their part of the TV, the other
 * players' games watched in theirs (a split screen), and the frame of UI round
 * it with the game's name, who is playing, the remote's controls and "Put the
 * controller down". Someone standing who watches the TV gets every player's
 * game watched, and "Stop watching". Each part is tagged with its player. A
 * frame stays in the page while the same game runs (moving or remounting it
 * would reload the game), so frames are never reordered: where each shows is
 * set by engine/gameTv.ts.
 *
 * As at a cabinet (ui/PlayOverlay.tsx), the first key may not reach the game,
 * so a page that says it is ready (ChimpVibe's embed mode) gets "Press any key
 * to start" until it says the game is playing, or for START_PROMPT ms. A game
 * that fails to connect fails for this player only (engine/gameTv.ts): their
 * frame goes, and their TV shows static saying so until the TV is turned off.
 */
export function TvOverlay({ s, tv }: { s: PreviewState; tv: GameTv }) {
  const f = s.focus?.kind === "tv" ? s.focus : null;
  const rect = f?.phase === "on" ? s.focusRect : null;
  const [status, setStatus] = useState<{ key: string; prompt: "none" | "asking" | "done"; text: string | null } | null>(null);
  const frame = s.tvFrame;
  const mine = frame && status?.key === frame.key ? status : { key: frame?.key ?? "", prompt: "none" as const, text: null };
  const asking = !!rect && mine.prompt === "asking";
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setStatus((was) => was && { ...was, prompt: "done" }), START_PROMPT);
    return () => clearTimeout(t);
  }, [asking]);

  const game = s.tv.game;
  const players = tvPlayers(s);
  const watching = !!f?.watching;
  const parts = tvParts(players.length);
  return (
    <>
      {/* at the TV, it is black round the parts: under this visitor's game, which the surface (tags, the others' games) lies over */}
      {rect && game && !s.tvFailed && <div className="tv-backdrop" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
      <TvSurface s={s} tv={tv} players={players} parts={parts} seated={!!rect && !watching} />
      {/* after the surface: walking about, this visitor's game lies over its black, under the 3D view */}
      {frame && (
        <TvGameFrame
          key={frame.key}
          frame={frame}
          tv={tv}
          onMessage={(type, text) =>
            setStatus((was) => {
              const cur = was?.key === frame.key ? was : { key: frame.key, prompt: "none" as const, text: null };
              if (type === "ready") return { ...cur, prompt: cur.prompt === "none" ? "asking" : cur.prompt, text: null };
              if (type === "playing") return { ...cur, prompt: "done", text: null };
              return { ...cur, text };
            })
          }
        />
      )}
      {rect && (
        <FocusFrame
          rect={rect}
          title={game?.name ?? "ChimpVibe TV"}
          byline={
            <span className="tv-players">
              {players.map((p) => (
                <span key={p.n} className="tv-player" style={{ background: playerColor(p.n) }}>
                  {tagText(p)}
                </span>
              ))}
            </span>
          }
          status={s.tvFailed ? "Failed to connect" : watching ? null : mine.text}
          onLeave={() => (watching ? void tv.stopWatching() : tv.putDown("controller"))}
          leaveLabel={watching ? "Stop watching" : "Put the controller down"}
          // putting the controller down leaves the game playing (anyone can take it over); quitting ends it
          quit={game && (!watching || tv.mySeat !== null) ? { label: "Quit game", onClick: () => tv.quit() } : undefined}
        >
          {watching && !s.tvFailed ? (
            <span className="focus-hint">{!game ? "The TV is off." : players.length ? `Watching ${players.length === 1 ? players[0].name : `${players.length} players`}` : "Nobody is playing: pick up a controller to play."}</span>
          ) : s.tvFailed ? (
            <span className="focus-hint">{tv.holdingRemote ? "Turn the TV off to try again:" : "Whoever has the remote can turn the TV off to try again."}</span>
          ) : !game ? (
            <span className="focus-hint">{tv.holdingRemote ? "Choose a game for everyone at the TV:" : "Waiting for a game: whoever has the remote chooses one."}</span>
          ) : frame?.checking ? (
            <span className="focus-hint">Starting {game.name}…</span>
          ) : asking ? (
            <span className="focus-start">Press any key to start</span>
          ) : (
            <span className="focus-hint">Keys not reaching the game? Click it.</span>
          )}
          <RemoteControls s={s} tv={tv} compact />
        </FocusFrame>
      )}
    </>
  );
}

const START_PROMPT = 12_000;

/** A player in the TV's game (engine/gameTv.ts): their controller, the page their game runs in, their name in the game, and who holds the controller now. */
type TvPlayer = { n: number; id: string; name: string; holder: string | null };

/** The players in the TV's game, in controller order. */
function tvPlayers(s: PreviewState): TvPlayer[] {
  return s.tv.seats.flatMap((st, i) => (st ? [{ n: i + 1, id: st.host, name: st.name, holder: s.tv.controllers[i]?.name ?? null }] : []));
}

/** A player's tag: "P1 Ann", "P1 Bo (as Ann)" once Bo took over Ann's game, "P1 Ann · controller down". */
function tagText(p: TvPlayer): string {
  const who = p.holder && p.holder !== p.name ? `${p.holder} (as ${p.name})` : p.name;
  return `P${p.n} ${who}${p.id === ME.id ? " (you)" : ""}${p.holder ? "" : " · controller down"}`;
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const partStyle = (r: ScreenRect) => ({ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });

/**
 * The TV's picture of the other players' games, watched (engine/gameTv.ts
 * places it): square on over the TV while at it, in perspective under the 3D
 * view as the visitor walks about the Game Room. Each player's part, in
 * controller order, holds their game and is tagged with their name; a part
 * whose game isn't showing says why. A seated player's own game is a frame of
 * its own, laid over their part.
 */
function TvSurface({ s, tv, players, parts, seated }: { s: PreviewState; tv: GameTv; players: TvPlayer[]; parts: ScreenRect[]; seated: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    tv.attachSurface(ref.current);
    return () => tv.attachSurface(null);
  }, [tv]);
  const game = s.tv.game;
  const spare = spareTvPart(players.length);
  return (
    // split between players, the TV is black round their parts (for a seated player, the backdrop under their game is)
    <div ref={ref} className="tv-surface">
      {s.tvPanes.map((p) => {
        const r = parts[players.findIndex((x) => x.n === p.controller)];
        return <TvPaneFrame key={p.key} pane={p} tv={tv} style={r ? { ...partStyle(r), visibility: p.shown ? "inherit" : "hidden" } : { visibility: "hidden" }} />;
      })}
      {game &&
        !s.tvFailed &&
        players.map((p, i) => {
          const r = parts[i];
          const me = p.id === ME.id;
          if (!r) return null;
          const pane = s.tvPanes.find((x) => x.controller === p.n);
          // what a part whose game isn't showing is doing
          // (a part that shows says itself when its player is away: ChimpVibe's spectator view does)
          const note = me && !pane ? (s.tvFrame?.checking ? `Starting ${game.name}…` : null) : pane?.shown ? null : !pane || pane.state === "loading" ? "Connecting…" : pane.state === "failed" ? `Failed to connect: ${pane.note}` : pane.note;
          return (
            <div key={`${p.n}:${p.id}`} className="tv-part" style={partStyle(r)}>
              {note && <span className={pane?.state === "failed" && !me ? "tv-part-note failed" : "tv-part-note"}>{note}</span>}
              {(players.length > 1 || !seated) && (
                <span className="tv-part-tag" style={{ background: playerColor(p.n) }}>
                  {tagText(p)}
                </span>
              )}
            </div>
          );
        })}
      {/* with three players, the quarter no one plays in shows the game's card, as a console's split screen does */}
      {game && !s.tvFailed && spare && (
        <div className="tv-part spare" style={partStyle(spare)}>
          {game.art && <img src={game.art} alt="" />}
          <span className="tv-spare-name">{game.name}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Another player's game, watched: ChimpVibe's spectator mode following them,
 * without sound. It never takes the keyboard, and clicks pass through it.
 */
function TvPaneFrame({ pane, tv, style }: { pane: TvPane; tv: GameTv; style: CSSProperties }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [src] = useState(pane.src);
  useLayoutEffect(() => {
    const el = ref.current!;
    tv.attachPane(pane.key, el);
    const origin = new URL(src, location.href).origin;
    const listen = (e: MessageEvent) => {
      if (e.source === el.contentWindow && e.origin === origin) tv.receivePane(pane.key, e.data);
    };
    window.addEventListener("message", listen);
    return () => {
      window.removeEventListener("message", listen);
      tv.detachPane(pane.key, el);
    };
  }, [tv, pane.key, src]);
  return <iframe ref={ref} className="tv-watch" src={src} title={`${pane.name} playing`} tabIndex={-1} allow="autoplay; fullscreen" style={style} />;
}

/** The player's game: its address is fixed when it mounts, since changing it reloads the game. */
function TvGameFrame({ frame, tv, onMessage }: { frame: TvFrame; tv: GameTv; onMessage: (type: "ready" | "playing" | "status", text: string | null) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [src] = useState(frame.src);
  useEffect(() => {
    const el = ref.current!;
    tv.attach(frame.key, el);
    return () => tv.detach(el);
  }, [tv, frame.key]);
  // ChimpVibe's embed-mode messages, only from this frame and the game's origin; listened
  // for as the frame mounts, before its page can load and say it is ready
  const report = useRef(onMessage);
  report.current = onMessage;
  useLayoutEffect(() => {
    const origin = new URL(src, location.href).origin;
    const listen = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || e.origin !== origin) return;
      const msg = tv.receive(frame.key, e.data);
      if (msg?.type === "ready") {
        report.current("ready", null);
        tv.giveKeys();
      } else if (msg?.type === "playing") report.current("playing", null);
      else if (msg?.type === "ended") report.current("status", endedText(msg.reason));
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [src, tv, frame.key]);
  return <iframe ref={ref} className="tv-frame" src={src} title={frame.title} allow="autoplay; fullscreen; gamepad; clipboard-write" onLoad={() => tv.giveKeys()} />;
}

/**
 * The TV's remote, for whoever holds it: choose a game from the catalogue
 * (loaded for everyone holding a controller), turn the TV off, put the remote
 * down. Without it: pick it up from the table if it's there, or who has it.
 */
export function RemoteControls({ s, tv, compact = false }: { s: PreviewState; tv: GameTv; compact?: boolean }) {
  const [problem, setProblem] = useState<string | null>(null);
  const games = s.tvCatalog?.games ?? [];
  const [pick, setPick] = useState("");
  const chosen = pick || s.tv.game?.gameId || games[0]?.gameId || "";
  if (!tv.holdingRemote) {
    if (!compact) return null;
    return s.tv.remote ? (
      <span className="focus-hint">{s.tv.remote.name} has the remote.</span>
    ) : (
      <button className="leave secondary" onClick={() => setProblem(tv.take("remote"))}>
        Pick up the remote
      </button>
    );
  }
  return (
    <span className={compact ? "tv-remote compact" : "tv-remote"}>
      <select value={chosen} onChange={(e) => setPick(e.target.value)} aria-label="Game" disabled={!games.length}>
        {!games.length && <option value="">Loading games…</option>}
        {games.map((g) => (
          <option key={g.gameId} value={g.gameId}>
            {g.name}
            {g.author ? ` · ${g.author}` : ""}
          </option>
        ))}
      </select>
      <button className="main" disabled={!chosen || !!s.tvFailed} title={s.tvFailed ? "Turn the TV off first" : undefined} onClick={() => setProblem(tv.choose(chosen))}>
        {s.tv.game?.gameId === chosen ? "Restart" : "Play"}
      </button>
      <button className={s.tvFailed ? "main" : undefined} disabled={!s.tv.game} onClick={() => setProblem(tv.turnOff())}>
        Turn off
      </button>
      <button onClick={() => tv.putDown("remote")}>Put the remote down{!compact && <kbd>B</kbd>}</button>
      {problem && <span className="picker-problem">{problem}</span>}
    </span>
  );
}
