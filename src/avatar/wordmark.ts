// The ChimpVibe wordmark, drawn on a canvas for what chimps wear: "chimpvibe" in
// ChimpVibe's own drawn letters, each i dotted with an apple, under the tree mark.
// The letters are ChimpVibe's (shared/wordmark.mjs in the ChimpVibe repo, style E,
// chosen 2026-09-23): one family from five numbers, in units where the ascender's top
// is y=0, the baseline y=100 and the descender y=134. Kept as SVG path data, so a
// browser draws them as crisply as the site does, with no font to load.

const S = 21; // stroke
const X = 30; // x-height's top
const W = 60; // letter width
const R = 15; // bowl corner
const GAP = 13; // between letters
const h = S / 2;
const T = X + h;
const B = 100 - h;
const L = h;
const RT = W - h;
const M_W = 90;
const M_MID = M_W / 2;
const M_RT = M_W - h;
const M_R = 11;

const bowl = `M${L} ${T + R} A${R} ${R} 0 0 1 ${L + R} ${T} L${RT - R} ${T} A${R} ${R} 0 0 1 ${RT} ${T + R} L${RT} ${B - R} A${R} ${R} 0 0 1 ${RT - R} ${B} L${L} ${B}`;
const arch = (a: number, b: number, r: number) => `M${a} ${T + r} A${r} ${r} 0 0 1 ${a + r} ${T} L${b - r} ${T} A${r} ${r} 0 0 1 ${b} ${T + r} L${b} 100`;

interface Glyph {
  w: number;
  /** stroked S wide, butt ends, round joins */
  strokes: string[];
  /** filled */
  solids: string[];
  /** filled rectangles: x, y, w, h */
  blocks: [number, number, number, number][];
  /** an apple over it (the i's) */
  fruit?: boolean;
}

const GLYPHS: Record<string, Glyph> = {
  c: { w: W - 8, strokes: [`M${W - 8} ${T} L${L + R} ${T} A${R} ${R} 0 0 0 ${L} ${T + R} L${L} ${B - R} A${R} ${R} 0 0 0 ${L + R} ${B} L${W - 8} ${B}`], solids: [], blocks: [] },
  h: { w: W, strokes: [`M${L} 0 L${L} 100`, arch(L, RT, R)], solids: [], blocks: [] },
  i: { w: S, strokes: [`M${L} ${X} L${L} 100`], solids: [], blocks: [], fruit: true },
  m: { w: M_W, strokes: [`M${L} ${X} L${L} 100`, arch(L, M_MID, M_R), arch(M_MID, M_RT, M_R)], solids: [], blocks: [] },
  p: { w: W, strokes: [`M${L} ${X} L${L} 134`, bowl], solids: [], blocks: [] },
  v: { w: W, strokes: [], solids: [`M0 ${X} L${S + 1} ${X} L${W / 2} ${X + (100 - X) * 0.56} L${W - S - 1} ${X} L${W} ${X} L${W / 2 + h} 100 L${W / 2 - h} 100 Z`], blocks: [] },
  b: { w: W, strokes: [`M${L} 0 L${L} 100`, bowl], solids: [], blocks: [] },
  // the e: its bowl without the bar, then a lighter bar so both counters stay open
  e: { w: W, strokes: [`M${RT} 66 L${RT} ${T + R} A${R} ${R} 0 0 0 ${RT - R} ${T} L${L + R} ${T} A${R} ${R} 0 0 0 ${L} ${T + R} L${L} ${B - R} A${R} ${R} 0 0 0 ${L + R} ${B} L${W - 8} ${B}`], solids: [], blocks: [[0, 58, W, 10]] },
};

// the i's fruit (stem, leaf, apple), sitting just clear of the stem
const APPLE = "M0 -5.5 C-1.5 -8.5 -8.5 -8.5 -8.5 -1 C-8.5 6 -4 9.5 0 8 C4 9.5 8.5 6 8.5 -1 C8.5 -8.5 1.5 -8.5 0 -5.5 Z";
const LEAF = "M0 0 C4 -5 12 -5 16 0 C12 5 4 5 0 0 Z";
const FRUIT_K = 1.25;
const FRUIT_Y = X - 6 - 9.5 * 1.45 * FRUIT_K;

/** How wide "chimpvibe" is, in wordmark units. */
export function wordWidth(word = "chimpvibe"): number {
  let x = 0;
  for (const ch of word) x += GLYPHS[ch].w + GAP;
  return x - GAP;
}

/**
 * Draw `word` with its baseline's left end at (x, y), `k` pixels per unit: the letters
 * of `first` characters in `inkA`, the rest (and every apple) in `inkB`.
 */
export function drawWord(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, word: string, first: number, inkA: string, inkB: string): void {
  let at = 0;
  [...word].forEach((ch, i) => {
    const g = GLYPHS[ch];
    const ink = i < first ? inkA : inkB;
    ctx.save();
    ctx.translate(x + at * k, y - 100 * k);
    ctx.scale(k, k);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = S;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    for (const d of g.strokes) ctx.stroke(new Path2D(d));
    for (const d of g.solids) ctx.fill(new Path2D(d));
    for (const [bx, by, bw, bh] of g.blocks) ctx.fillRect(bx, by, bw, bh);
    if (g.fruit) {
      ctx.translate(L, FRUIT_Y);
      ctx.scale(FRUIT_K, FRUIT_K);
      ctx.strokeStyle = inkB;
      ctx.fillStyle = inkB;
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.stroke(new Path2D("M0 -7 C0 -11 2 -13 3.5 -14.5"));
      ctx.save();
      ctx.translate(1.5, -11);
      ctx.rotate((-35 * Math.PI) / 180);
      ctx.scale(0.55, 0.55);
      ctx.fill(new Path2D(LEAF));
      ctx.restore();
      ctx.scale(1.45, 1.45);
      ctx.fill(new Path2D(APPLE));
    }
    ctx.restore();
    at += g.w + GAP;
  });
}

/** A print's artwork: the tree mark alone (a cap's front), or the tree over "chimpvibe" (a tee's chest). */
export type PrintArt = "mark" | "stacked";

/** How wide a print's artwork is for its height. */
export function printAspect(art: PrintArt): number {
  const b = STACKED.box;
  return art === "mark" ? (0.87 - 0.13) / (0.855 - 0.14) : (b.right - b.x) / (b.bottom - b.y);
}

/**
 * The stacked lockup's proportions (ChimpVibe's "stacked-plain"): the tree's square
 * `size` units across over the word, the word's cap line 0.9 of the square down and
 * centred under it. The tree's own ink sits 13% to 87% across its square, 14% to 85.5%
 * down. Returns the box round the ink, in units, with the tree's square at the origin.
 */
export const STACKED = (() => {
  const size = 100 / 0.22;
  const word = wordWidth();
  const cap = 0.9 * size;
  const textX = size / 2 - word / 2;
  const box = { x: Math.min(0.13 * size, textX), y: 0.14 * size, right: Math.max(0.87 * size, textX + word), bottom: cap + 134 };
  return { size, word, cap, textX, box };
})();
