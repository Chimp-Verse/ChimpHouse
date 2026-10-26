// The lobby (engine/lobby.ts): the first thing every visitor sees. They choose a name and
// make their chimp their own, watching it change where it stands at the spawn point in the
// courtyard behind the panel, then go in. The look's controls are the wardrobe's own
// (ChimpControls), so the lobby offers whatever the wardrobe does.

import { type FormEvent, useState } from "react";
import { NAME_CHARS, nameProblem, savedName } from "../engine/lobby";
import type { PreviewController } from "../engine/preview";
import type { PreviewState } from "../engine/store";
import { ChimpControls } from "./Wardrobe";

export function Lobby({ ctl, s }: { ctl: PreviewController; s: PreviewState }) {
  const [name, setName] = useState(() => savedName(new URLSearchParams(location.search)));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  /** the server's word on the last name tried: taken, with one like it that is free */
  const [refused, setRefused] = useState<{ name: string; message: string; suggestion?: string } | null>(null);
  const problem = nameProblem(name);
  const length = name.trim().replace(/\s+/g, " ").length;
  const shown = refused && refused.name === name ? refused.message : touched ? problem : length > NAME_CHARS ? problem : null;

  const enter = async (as: string) => {
    setTouched(true);
    if (nameProblem(as) || busy) return;
    setBusy(true);
    try {
      const a = await ctl.enterHouse(as);
      if (a.ok) return;
      const message =
        a.why === "taken"
          ? `Someone called “${a.name}” is already in the house.${a.suggestion ? ` How about “${a.suggestion}”?` : ""}`
          : a.why === "long"
            ? `Names can be up to ${NAME_CHARS} letters.`
            : "Type a name for your chimp first.";
      setRefused({ name: as, message, suggestion: a.suggestion });
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void enter(name);
  };

  return (
    <div className="panel wardrobe lobby" role="dialog" aria-label="Welcome to ChimpHouse">
      <div className="lobby-title">Welcome to ChimpHouse</div>
      <form className="lobby-name" onSubmit={submit}>
        <label className="wardrobe-label" htmlFor="lobby-name">
          Your name
          <em className={length > NAME_CHARS ? "over" : ""}>
            {length} / {NAME_CHARS}
          </em>
        </label>
        <input
          id="lobby-name"
          type="text"
          autoFocus
          autoComplete="nickname"
          spellCheck={false}
          maxLength={40}
          placeholder="What should we call you?"
          value={name}
          aria-invalid={!!shown}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name && setTouched(true)}
        />
        {shown && (
          <div className="lobby-problem" role="alert">
            {shown}
            {refused?.suggestion && refused.name === name && (
              <button
                type="button"
                onClick={() => {
                  setName(refused.suggestion!);
                  void enter(refused.suggestion!);
                }}
              >
                Use “{refused.suggestion}”
              </button>
            )}
          </div>
        )}
      </form>
      <div className="wardrobe-head">
        <div className="section">Your chimp</div>
        {s.chimpBuilding && <div className="wardrobe-busy">Reshaping…</div>}
      </div>
      <ChimpControls ctl={ctl} />
      <button className="lobby-enter" disabled={busy} onClick={() => void enter(name)}>
        {busy ? "Checking your name…" : "Enter ChimpHouse"}
      </button>
      <div className="lobby-note">Your name and chimp are kept in this browser for next time. Inside, press C to change your chimp's look.</div>
    </div>
  );
}
