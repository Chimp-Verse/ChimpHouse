// A chimp's DNA: everything that makes one chimp look different from another, as one
// small JSON object. It is what a visitor customises, what is kept between their visits
// and what other visitors are sent, so it holds settings, never geometry.
//
// Each setting is a row in a table (SHAPES, COLOURS): the wardrobe panel draws its
// controls from the tables, and avatar/anatomy.ts reads the values. Adding a setting
// is a new row and the code that uses it; old DNA without it takes the default.

/** Bump when a setting changes meaning; `sanitize` brings older DNA up to date. */
export const DNA_VERSION = 1;

/** Where clothing and accessories go. One item per slot. */
export type Slot = "head" | "eyes" | "neck" | "top" | "bottom" | "back" | "wrist";
export const SLOTS: { slot: Slot; label: string }[] = [
  { slot: "head", label: "Head" },
  { slot: "eyes", label: "Eyes" },
  { slot: "neck", label: "Neck" },
  { slot: "top", label: "Top" },
  { slot: "bottom", label: "Bottom" },
  { slot: "back", label: "Back" },
  { slot: "wrist", label: "Wrist" },
];

/** An item worn in a slot: which item (avatar/wardrobe.ts), and its colours, in the item's order. */
export interface Worn {
  id: string;
  colors: string[];
}

export type ShapeKey = "height" | "build" | "belly" | "arms" | "legs" | "head" | "muzzle" | "brow" | "ears" | "eyes" | "furLength" | "beard";
export type ColorKey = "fur" | "furTips" | "skin" | "palms" | "eyeColor";

export interface ChimpDna {
  v: number;
  shape: Record<ShapeKey, number>;
  colors: Record<ColorKey, string>;
  outfit: Partial<Record<Slot, Worn>>;
}

export interface ShapeParam {
  key: ShapeKey;
  group: "Body" | "Face" | "Fur";
  label: string;
  min: number;
  max: number;
  def: number;
  step: number;
  /** what each end of the slider means */
  ends?: [string, string];
  /** shown after the value (height is in metres; the rest are 0 to 1) */
  unit?: string;
  /** changes the body's geometry (a rebuild), rather than only its materials or scale */
  geometry: boolean;
}

export const SHAPES: ShapeParam[] = [
  { key: "height", group: "Body", label: "Height", min: 1.3, max: 1.8, def: 1.5, step: 0.01, unit: "m", geometry: false },
  { key: "build", group: "Body", label: "Build", min: 0, max: 1, def: 0.5, step: 0.01, ends: ["Wiry", "Burly"], geometry: true },
  { key: "belly", group: "Body", label: "Belly", min: 0, max: 1, def: 0.4, step: 0.01, ends: ["Trim", "Round"], geometry: true },
  { key: "arms", group: "Body", label: "Arms", min: 0, max: 1, def: 0.5, step: 0.01, ends: ["Shorter", "Longer"], geometry: true },
  { key: "legs", group: "Body", label: "Legs", min: 0, max: 1, def: 0.5, step: 0.01, ends: ["Shorter", "Longer"], geometry: true },
  { key: "head", group: "Face", label: "Head size", min: 0, max: 1, def: 0.5, step: 0.01, ends: ["Small", "Big"], geometry: true },
  { key: "muzzle", group: "Face", label: "Muzzle", min: 0, max: 1, def: 0.5, step: 0.01, ends: ["Short", "Long"], geometry: true },
  { key: "brow", group: "Face", label: "Brow", min: 0, max: 1, def: 0.5, step: 0.01, ends: ["Soft", "Heavy"], geometry: true },
  { key: "ears", group: "Face", label: "Ears", min: 0, max: 1, def: 0.5, step: 0.01, ends: ["Small", "Big"], geometry: true },
  { key: "eyes", group: "Face", label: "Eyes", min: 0, max: 1, def: 0.5, step: 0.01, ends: ["Small", "Big"], geometry: true },
  { key: "furLength", group: "Fur", label: "Fur", min: 0, max: 1, def: 0.5, step: 0.01, ends: ["Sleek", "Shaggy"], geometry: false },
  { key: "beard", group: "Fur", label: "Grey beard", min: 0, max: 1, def: 0.25, step: 0.01, ends: ["None", "Full"], geometry: false },
];

export interface ColorParam {
  key: ColorKey;
  group: "Fur" | "Face";
  label: string;
  def: string;
  /** suggestions shown as swatches; any colour can be picked */
  swatches: string[];
}

export const COLOURS: ColorParam[] = [
  { key: "fur", group: "Fur", label: "Fur", def: "#3a2a20", swatches: ["#1b1716", "#3a2a20", "#3f2c22", "#5a3d2b", "#7a5236", "#a87b52", "#8c8a86", "#d9d2c5"] },
  { key: "furTips", group: "Fur", label: "Fur tips", def: "#76563e", swatches: ["#4a3a33", "#76563e", "#8f6a4c", "#b08a62", "#c9b9a2", "#9aa3a8", "#78d8aa"] },
  { key: "skin", group: "Face", label: "Face", def: "#d2a286", swatches: ["#ecc3ad", "#d2a286", "#c08a6a", "#a4785e", "#7d5a49", "#5b453b", "#3b302b"] },
  { key: "palms", group: "Face", label: "Hands & feet", def: "#7a6156", swatches: ["#b28d7b", "#9a7766", "#7a6156", "#5d4b44", "#3f3532", "#2a2422"] },
  { key: "eyeColor", group: "Face", label: "Eyes", def: "#6a3e1d", swatches: ["#3b2312", "#6a3e1d", "#9a6125", "#b8862f", "#5d7c3b", "#3d6f86", "#78d8aa"] },
];

/** The chimp everyone starts as: the dark-furred, pale-faced chimp of the concept art. */
export function defaultDna(): ChimpDna {
  const shape = {} as Record<ShapeKey, number>;
  for (const p of SHAPES) shape[p.key] = p.def;
  const colors = {} as Record<ColorKey, string>;
  for (const c of COLOURS) colors[c.key] = c.def;
  return { v: DNA_VERSION, shape, colors, outfit: {} };
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * DNA made safe to build from, whatever it came from (another visitor, an old
 * save): numbers clamped into range, colours checked, unknown keys dropped and
 * anything missing taken from the default. `known` says which outfit items exist.
 */
export function sanitize(raw: unknown, known: (slot: Slot, id: string) => boolean = () => true): ChimpDna {
  const dna = defaultDna();
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ChimpDna>;
  const shape = (r.shape && typeof r.shape === "object" ? r.shape : {}) as Record<string, unknown>;
  for (const p of SHAPES) {
    const v = shape[p.key];
    if (typeof v === "number" && Number.isFinite(v)) dna.shape[p.key] = Math.min(p.max, Math.max(p.min, v));
  }
  const colors = (r.colors && typeof r.colors === "object" ? r.colors : {}) as Record<string, unknown>;
  for (const c of COLOURS) {
    const v = colors[c.key];
    if (typeof v === "string" && HEX.test(v)) dna.colors[c.key] = v.toLowerCase();
  }
  const outfit = (r.outfit && typeof r.outfit === "object" ? r.outfit : {}) as Record<string, unknown>;
  for (const { slot } of SLOTS) {
    const w = outfit[slot] as Partial<Worn> | undefined;
    if (!w || typeof w.id !== "string" || !known(slot, w.id)) continue;
    const cols = Array.isArray(w.colors) ? w.colors.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, 4) : [];
    dna.outfit[slot] = { id: w.id, colors: cols.map((c) => c.toLowerCase()) };
  }
  return dna;
}

/** A key for everything that shapes the body's geometry: chimps with the same key share their meshes. */
export function geometryKey(dna: ChimpDna): string {
  return SHAPES.filter((p) => p.geometry)
    .map((p) => Math.round(dna.shape[p.key] * 100))
    .join(",");
}

/**
 * Chimps to start from in the wardrobe: each is DNA like any other, only the
 * settings that make it so (the rest are the default chimp's).
 */
export const PRESETS: { name: string; shape: Partial<Record<ShapeKey, number>>; colors: Partial<Record<ColorKey, string>> }[] = [
  { name: "Classic", shape: {}, colors: {} },
  {
    name: "Youngster",
    shape: { height: 1.34, build: 0.32, belly: 0.3, head: 0.88, muzzle: 0.22, brow: 0.2, ears: 0.78, eyes: 0.9, furLength: 0.62, beard: 0 },
    colors: { fur: "#2b2120", furTips: "#5d4636", skin: "#ecc3ad", palms: "#b28d7b", eyeColor: "#6a3e1d" },
  },
  {
    name: "Elder",
    shape: { height: 1.52, build: 0.68, belly: 0.72, head: 0.55, muzzle: 0.7, brow: 0.85, ears: 0.55, eyes: 0.38, furLength: 0.42, beard: 1 },
    colors: { fur: "#33302d", furTips: "#9aa3a8", skin: "#a4785e", palms: "#5d4b44", eyeColor: "#5a3a22" },
  },
  {
    name: "Golden",
    shape: { build: 0.45, furLength: 0.58, beard: 0.1 },
    colors: { fur: "#7a5236", furTips: "#c9a06a", skin: "#c08a6a", palms: "#7a6156", eyeColor: "#9a6125" },
  },
  {
    name: "Mint",
    shape: { head: 0.62, eyes: 0.7, ears: 0.62, furLength: 0.45, beard: 0 },
    // ChimpVibe's own colours: the Review Chimp's face, the tree mark's mint
    colors: { fur: "#2f8a62", furTips: "#78d8aa", skin: "#c8fce3", palms: "#78d8aa", eyeColor: "#0a0d12" },
  },
];

/** A preset's DNA, wearing what `outfit` says. */
export function presetDna(name: string, outfit: ChimpDna["outfit"]): ChimpDna {
  const p = PRESETS.find((x) => x.name === name) ?? PRESETS[0];
  const dna = defaultDna();
  Object.assign(dna.shape, p.shape);
  Object.assign(dna.colors, p.colors);
  dna.outfit = { ...outfit };
  return dna;
}

/** A random chimp, for trying the wardrobe out (and for visitors who haven't made theirs yet). */
export function randomDna(rand: () => number = Math.random): ChimpDna {
  const dna = defaultDna();
  const around = (p: ShapeParam, spread: number) => Math.min(p.max, Math.max(p.min, p.def + (rand() * 2 - 1) * spread * (p.max - p.min)));
  for (const p of SHAPES) dna.shape[p.key] = Math.round(around(p, p.key === "height" ? 0.3 : 0.45) / p.step) * p.step;
  for (const c of COLOURS) {
    // natural colours mostly: the first swatches are the chimp-like ones
    const pick = c.swatches.slice(0, Math.max(3, c.swatches.length - 2));
    dna.colors[c.key] = pick[Math.floor(rand() * pick.length)];
  }
  return dna;
}

export function sameDna(a: ChimpDna, b: ChimpDna): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
