// The wardrobe: where a visitor makes their chimp their own. Its controls come from
// the DNA's tables (avatar/dna.ts SHAPES and COLOURS) and the wardrobe's items
// (avatar/wardrobe.ts), so a new setting or item shows up here with no more work.
//
// Shape sliders that change the body's geometry rebuild the chimp (a second or two,
// in a worker) when let go; height, colours and clothes change at once.

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { COLOURS, type ChimpDna, PRESETS, SHAPES, SLOTS, type ShapeParam, type Slot, defaultDna, presetDna, randomDna } from "../avatar/dna";
import { ITEMS, type ItemDef, itemColours } from "../avatar/wardrobe";
import type { PreviewController } from "../engine/preview";
import type { PreviewState } from "../engine/store";

type Tab = "Body" | "Face" | "Fur" | "Clothes";
const TABS: Tab[] = ["Body", "Face", "Fur", "Clothes"];

export function Wardrobe({ ctl, s }: { ctl: PreviewController; s: PreviewState }) {
  return (
    <div className="panel wardrobe">
      <div className="wardrobe-head">
        <div className="section">Your chimp</div>
        {s.chimpBuilding && <div className="wardrobe-busy">Reshaping…</div>}
      </div>
      <ChimpControls ctl={ctl}>
        <button className="done" onClick={() => ctl.setWardrobe(false)}>
          Done <kbd>C</kbd>
        </button>
      </ChimpControls>
    </div>
  );
}

/**
 * The wardrobe's controls: its tabs, their settings, and Surprise me and Start again, then
 * `children` (the wardrobe's Done, the lobby's nothing). The wardrobe and the lobby (ui/Lobby.tsx)
 * both use them, so the two always offer the same.
 */
export function ChimpControls({ ctl, children }: { ctl: PreviewController; children?: ReactNode }) {
  const [dna, setDna] = useState<ChimpDna>(() => ctl.avatars.dna);
  const [tab, setTab] = useState<Tab>("Body");
  // keep up with changes made elsewhere (a test, another tab of the house) while open
  useEffect(() => setDna(ctl.avatars.dna), [ctl]);
  const apply = (next: ChimpDna) => {
    setDna(next);
    ctl.setChimp(next);
  };
  const shape = (key: ShapeParam["key"], v: number) => ({ ...dna, shape: { ...dna.shape, [key]: v } });

  return (
    <>
      <div className="wardrobe-tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="wardrobe-body">
        {tab === "Body" && (
          <div className="wardrobe-row">
            <span className="wardrobe-label">Start from</span>
            <div className="chips">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => apply(presetDna(p.name, dna.outfit))} title={`The ${p.name.toLowerCase()} chimp, in the same clothes`}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {tab !== "Clothes" &&
          SHAPES.filter((p) => p.group === tab).map((p) => (
            <ShapeSlider key={p.key} p={p} value={dna.shape[p.key]} onLive={(v) => !p.geometry && apply(shape(p.key, v))} onCommit={(v) => apply(shape(p.key, v))} />
          ))}
        {tab !== "Clothes" &&
          tab !== "Body" &&
          COLOURS.filter((c) => c.group === tab).map((c) => (
            <ColourRow key={c.key} label={c.label} value={dna.colors[c.key]} swatches={c.swatches} onPick={(hex) => apply({ ...dna, colors: { ...dna.colors, [c.key]: hex } })} />
          ))}
        {tab === "Clothes" && SLOTS.map(({ slot, label }) => <SlotRow key={slot} slot={slot} label={label} dna={dna} apply={apply} />)}
      </div>
      <div className="wardrobe-foot">
        <button onClick={() => apply({ ...randomDna(), outfit: dna.outfit })} title="A new chimp, in the same clothes">
          Surprise me
        </button>
        <button onClick={() => apply(defaultDna())} title="The chimp everyone starts as">
          Start again
        </button>
        {children}
      </div>
    </>
  );
}

/** A slider for one of the DNA's numbers: shows its value as it moves, and applies it when let go (or as it moves, for what needs no rebuild). */
function ShapeSlider({ p, value, onLive, onCommit }: { p: ShapeParam; value: number; onLive: (v: number) => void; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const shown = p.unit === "m" ? `${v.toFixed(2)} m` : p.ends ? (v < 0.35 ? p.ends[0] : v > 0.65 ? p.ends[1] : "") : v.toFixed(2);
  return (
    <label className="wardrobe-row">
      <span className="wardrobe-label">
        {p.label}
        <em>{shown}</em>
      </span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={v}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          onLive(n);
        }}
        onPointerUp={() => onCommit(v)}
        onKeyUp={() => onCommit(v)}
        onBlur={() => v !== value && onCommit(v)}
      />
    </label>
  );
}

/** A colour: its suggested swatches, and any colour from the picker. */
function ColourRow({ label, value, swatches, onPick }: { label: string; value: string; swatches: string[]; onPick: (hex: string) => void }) {
  return (
    <div className="wardrobe-row">
      <span className="wardrobe-label">{label}</span>
      <div className="swatches">
        {swatches.map((hex) => (
          <button key={hex} className={`swatch ${hex.toLowerCase() === value.toLowerCase() ? "on" : ""}`} style={{ background: hex }} onClick={() => onPick(hex)} title={hex} />
        ))}
        <input className="picker" type="color" value={value} onChange={(e) => onPick(e.target.value)} title="Any colour" />
      </div>
    </div>
  );
}

/** One slot's choices (nothing, or one of its items) and, for what is worn, its colours. */
function SlotRow({ slot, label, dna, apply }: { slot: Slot; label: string; dna: ChimpDna; apply: (d: ChimpDna) => void }) {
  const items = useMemo(() => ITEMS.filter((i) => i.slot === slot), [slot]);
  const worn = dna.outfit[slot];
  const def = worn ? items.find((i) => i.id === worn.id) : undefined;
  const put = (i: ItemDef | null) => {
    const outfit = { ...dna.outfit };
    if (i) outfit[slot] = { id: i.id, colors: itemColours(i, worn?.id === i.id ? worn.colors : undefined) };
    else delete outfit[slot];
    apply({ ...dna, outfit });
  };
  const colour = (n: number, hex: string) => {
    if (!def || !worn) return;
    const colors = itemColours(def, worn.colors);
    colors[n] = hex;
    apply({ ...dna, outfit: { ...dna.outfit, [slot]: { id: def.id, colors } } });
  };
  return (
    <div className="wardrobe-slot">
      <span className="wardrobe-label">{label}</span>
      <div className="chips">
        <button className={!worn ? "on" : ""} onClick={() => put(null)}>
          None
        </button>
        {items.map((i) => (
          <button key={i.id} className={worn?.id === i.id ? "on" : ""} onClick={() => put(i)}>
            {i.name}
          </button>
        ))}
      </div>
      {def &&
        worn &&
        def.colours.map((c, n) => (
          <ColourRow key={c.label} label={c.label} value={itemColours(def, worn.colors)[n]} swatches={c.swatches} onPick={(hex) => colour(n, hex)} />
        ))}
    </div>
  );
}
