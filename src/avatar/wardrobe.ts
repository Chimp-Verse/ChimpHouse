// The wardrobe: everything a chimp can wear, by slot. An item is data (its name,
// its slot, what its colours are for) and a way of making it: worn on a bone
// (a cap on the head, glasses before the eyes, a watch at the wrist), or fitted
// to the body and moving with it as the skin does (a tee, a hoodie, shorts).
// Adding an item is a new entry here and its builder (avatar/outfits.ts).
//
// DNA only names items (avatar/dna.ts `outfit`), so a chimp that wears something
// another visitor's page doesn't know simply arrives without it.

import type { Slot } from "./dna";

export interface ItemColour {
  label: string;
  def: string;
  swatches: string[];
}

export interface ItemDef {
  id: string;
  slot: Slot;
  name: string;
  colours: ItemColour[];
  /** the slots whose clothes it is worn over (a bandana over a tee's neck): it is fitted to them as well as to the chimp */
  over?: Slot[];
}

const FABRIC = ["#24272b", "#efe4cc", "#1f6f6c", "#2f8a62", "#d8a133", "#c4552e", "#6a3d7e", "#24365a", "#b8312f", "#78d8aa"];
const LEATHER = ["#6a4128", "#3b2a20", "#c49a64", "#1b1a1a"];
const METAL = ["#ffc94d", "#c9c9c4", "#c8a15a", "#24272b"];

/** Every item, in the order the wardrobe shows them. */
export const ITEMS: ItemDef[] = [
  { id: "cap", slot: "head", name: "Cap", colours: [{ label: "Crown", def: "#1f6f6c", swatches: FABRIC }, { label: "Brim", def: "#24272b", swatches: FABRIC }] },
  { id: "beanie", slot: "head", name: "Beanie", colours: [{ label: "Knit", def: "#d8a133", swatches: FABRIC }, { label: "Cuff", def: "#c4552e", swatches: FABRIC }] },
  { id: "headphones", slot: "head", name: "Headphones", colours: [{ label: "Band", def: "#24272b", swatches: ["#24272b", "#efe4cc", "#78d8aa", ...METAL] }, { label: "Cups", def: "#78d8aa", swatches: ["#78d8aa", "#24272b", "#efe4cc", "#c4552e", "#d8a133"] }] },
  { id: "shades", slot: "eyes", name: "Shades", colours: [{ label: "Frame", def: "#24272b", swatches: ["#24272b", ...METAL, "#c4552e", "#78d8aa"] }, { label: "Lenses", def: "#1d3b3a", swatches: ["#1d3b3a", "#2a2a2a", "#5a3a1a", "#2f8a62", "#7a2a5a"] }] },
  { id: "specs", slot: "eyes", name: "Glasses", colours: [{ label: "Frame", def: "#6a4128", swatches: ["#6a4128", "#24272b", ...METAL, "#c4552e"] }] },
  { id: "bandana", slot: "neck", name: "Bandana", colours: [{ label: "Cloth", def: "#b8312f", swatches: FABRIC }, { label: "Pattern", def: "#f3ead8", swatches: ["#f3ead8", "#24272b", "#78d8aa", "#ffc94d", "#24365a"] }], over: ["top"] },
  { id: "chain", slot: "neck", name: "Banana chain", colours: [{ label: "Chain", def: "#ffc94d", swatches: METAL }], over: ["top"] },
  { id: "tee", slot: "top", name: "ChimpVibe tee", colours: [{ label: "Shirt", def: "#24272b", swatches: FABRIC }, { label: "Print", def: "#78d8aa", swatches: ["#78d8aa", "#c8fce3", "#ffc94d", "#efe4cc", "#24272b"] }] },
  { id: "hoodie", slot: "top", name: "Hoodie", colours: [{ label: "Body", def: "#2f8a62", swatches: FABRIC }, { label: "Cuffs", def: "#24272b", swatches: FABRIC }] },
  { id: "shorts", slot: "bottom", name: "Shorts", colours: [{ label: "Shorts", def: "#24365a", swatches: FABRIC }] },
  { id: "backpack", slot: "back", name: "Backpack", colours: [{ label: "Pack", def: "#6d8c58", swatches: ["#6d8c58", "#d8a133", "#1f6f6c", "#c4552e", "#24272b", "#efe4cc"] }, { label: "Straps", def: "#6a4128", swatches: LEATHER }], over: ["top"] },
  { id: "watch", slot: "wrist", name: "Watch", colours: [{ label: "Strap", def: "#24272b", swatches: [...LEATHER, "#78d8aa", "#efe4cc"] }, { label: "Case", def: "#c9c9c4", swatches: METAL }], over: ["top"] },
];

const byId = new Map(ITEMS.map((i) => [i.id, i]));

export function item(id: string): ItemDef | undefined {
  return byId.get(id);
}

/** Whether an item exists and goes in that slot (for checking DNA from elsewhere). */
export function knownItem(slot: Slot, id: string): boolean {
  return byId.get(id)?.slot === slot;
}

/**
 * What an item is worn over, as an outfit has it: the ids of the clothes in the slots it goes
 * over (a bandana over the tee worn), so it is made to fit them. Empty for most.
 */
export function wornOver(def: ItemDef, outfit: Partial<Record<Slot, { id: string }>>): string[] {
  return (def.over ?? []).map((s) => outfit[s]?.id).filter((id): id is string => !!id && !!byId.get(id));
}

/** An item's colours as worn: the ones given, then its defaults for any not given. */
export function itemColours(def: ItemDef, given: string[] | undefined): string[] {
  return def.colours.map((c, i) => given?.[i] ?? c.def);
}
