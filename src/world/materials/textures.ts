// Procedural canvas textures. Each returns albedo (and optionally a normal map)
// so the house needs no downloaded texture assets.

import { fbmTile, hash2, perlin2Tile } from "../geometry/noise";
import { rng } from "../geometry/curves";
import { Ctx, clamp255, hex, makeCanvas, mix3, normalFromHeight } from "./canvas";

export interface TexPair {
  albedo: HTMLCanvasElement;
  normal?: HTMLCanvasElement;
}

type RGB = [number, number, number];

// ---------------------------------------------------------------- timber

/**
 * Wood boards. `size` px covers one UV unit; boards run along v (texture y).
 * Used for floors (wide boards) and decks (narrow boards with gaps).
 */
export function boardsTexture(opts: {
  size?: number;
  boards: number; // boards across the tile
  lengths: [number, number]; // board length as fraction of tile
  base: RGB;
  vary: number;
  gap: number; // px
  gapColor: RGB;
  grain: number;
  seed: number;
  gloss?: boolean;
}): TexPair {
  const S = opts.size ?? 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  const r = rng(opts.seed);
  const bw = S / opts.boards;
  // per column: board breakpoints that tile vertically
  const cols: { tones: number[]; shifts: number[]; seg: Int16Array; dist: Float32Array }[] = [];
  for (let c = 0; c < opts.boards; c++) {
    const breaks: number[] = [];
    let y = r() * S;
    const start = y;
    while (y < start + S - opts.lengths[0] * S * 0.5) {
      breaks.push(y % S);
      y += (opts.lengths[0] + r() * (opts.lengths[1] - opts.lengths[0])) * S;
    }
    breaks.sort((a, b) => a - b);
    const tones = breaks.map(() => (r() - 0.5) * 2 * opts.vary);
    const shifts = breaks.map(() => r() * 100);
    const seg = new Int16Array(S);
    const dist = new Float32Array(S);
    for (let yy = 0; yy < S; yy++) {
      let sIdx = breaks.length - 1;
      let dmin = Infinity;
      for (let i = 0; i < breaks.length; i++) {
        if (yy >= breaks[i]) sIdx = i;
        const dd = Math.abs(yy - breaks[i]);
        dmin = Math.min(dmin, dd, S - dd);
      }
      seg[yy] = sIdx;
      dist[yy] = dmin;
    }
    cols.push({ tones, shifts, seg, dist });
  }
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = Math.floor(x / bw);
      const col = cols[c];
      const lx = x - c * bw;
      const seg = col.seg[y];
      const distToBreak = col.dist[y];
      const tone = col.tones[seg];
      const shift = col.shifts[seg];
      const u = x / S;
      const v = y / S;
      // grain: stretched noise along v
      const g1 = perlin2Tile(u * 64 + shift, v * 3, 64, 3);
      const g2 = perlin2Tile(u * 180 + shift * 2, v * 6, 180, 6);
      const rings = Math.sin((lx / bw) * 9 + g1 * 4 + shift) * 0.5 + 0.5;
      const blotch = fbmTile(u + shift * 0.01, v, 4, 3) * 0.5;
      let k = 1 + tone + g1 * 0.06 * opts.grain + g2 * 0.05 * opts.grain + (rings - 0.5) * 0.08 * opts.grain + blotch * 0.12;
      let col3: RGB = [opts.base[0] * k, opts.base[1] * k, opts.base[2] * k];
      let hgt = 0.6 + g2 * 0.04;
      const edge = Math.min(lx, bw - lx);
      if (edge < opts.gap || distToBreak < opts.gap * 0.7) {
        col3 = opts.gapColor;
        hgt = 0;
      } else if (edge < opts.gap + 1.5 || distToBreak < opts.gap + 1) {
        col3 = mix3(col3, opts.gapColor, 0.4);
        hgt = 0.35;
      }
      const i = y * S + x;
      height[i] = hgt;
      d[i * 4] = clamp255(col3[0]);
      d[i * 4 + 1] = clamp255(col3[1]);
      d[i * 4 + 2] = clamp255(col3[2]);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 4) };
}

/** Parallel slats with dark gaps; slats run along u (texture x). */
export function slatsTexture(opts: { size?: number; slats: number; gapFrac: number; base: RGB; vary: number; gapColor: RGB; seed: number; vertical?: boolean }): TexPair {
  const S = opts.size ?? 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const r = rng(opts.seed);
  const tones = Array.from({ length: opts.slats }, () => (r() - 0.5) * 2 * opts.vary);
  const shifts = Array.from({ length: opts.slats }, () => r() * 50);
  const pitch = S / opts.slats;
  const gap = pitch * opts.gapFrac;
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const across = opts.vertical ? x : y;
      const along = opts.vertical ? y : x;
      const si = Math.floor(across / pitch);
      const l = across - si * pitch;
      const u = along / S;
      const g = perlin2Tile(u * 6 + shifts[si], (l / pitch) * 2 + si, 6, 64);
      const g2 = perlin2Tile(u * 24 + shifts[si], (l / pitch) * 6, 24, 64);
      const k = 1 + tones[si] + g * 0.07 + g2 * 0.05;
      let c: RGB = [opts.base[0] * k, opts.base[1] * k, opts.base[2] * k];
      let h = 1;
      if (l < gap) {
        c = opts.gapColor;
        h = 0;
      } else {
        // rounded slat edges
        const e = Math.min(l - gap, pitch - l) / Math.max(1, pitch * 0.12);
        if (e < 1) {
          c = mix3(c, [c[0] * 0.75, c[1] * 0.72, c[2] * 0.7], 1 - e);
          h = 0.6 + e * 0.4;
        }
      }
      const i = y * S + x;
      height[i] = h;
      d[i * 4] = clamp255(c[0]);
      d[i * 4 + 1] = clamp255(c[1]);
      d[i * 4 + 2] = clamp255(c[2]);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 5) };
}

/** Glue-laminated timber: thin laminations stacked along v, grain along u. */
export function glulamTexture(seed = 5): TexPair {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const r = rng(seed);
  const lam = 16;
  const tones = Array.from({ length: lam }, () => (r() - 0.5) * 0.16);
  const base: RGB = [214, 150, 82];
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const li = Math.floor((y / S) * lam);
    const ly = (y / S) * lam - li;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const g = perlin2Tile(u * 4 + li * 7, ly * 3 + li, 4, 64);
      const g2 = perlin2Tile(u * 40 + li * 3, ly * 8, 40, 64);
      const k = 1 + tones[li] + g * 0.08 + g2 * 0.04;
      let c: RGB = [base[0] * k, base[1] * k, base[2] * k];
      if (ly < 0.035) c = mix3(c, [120, 70, 35], 0.55);
      const i = y * S + x;
      height[i] = ly < 0.035 ? 0.7 : 1;
      d[i * 4] = clamp255(c[0]);
      d[i * 4 + 1] = clamp255(c[1]);
      d[i * 4 + 2] = clamp255(c[2]);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 1.5) };
}

/** Plain fine wood grain (furniture, tables, desks). */
export function woodGrainTexture(base: RGB, seed = 9): TexPair {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const warp = perlin2Tile(u * 2 + seed, v * 2, 2, 2) * 0.6;
      const rings = Math.sin((v * 22 + warp * 3) * Math.PI * 2) * 0.5 + 0.5;
      const g = perlin2Tile(u * 3 + seed, v * 64, 3, 64);
      const k = 0.92 + rings * 0.1 + g * 0.06;
      const i = y * S + x;
      height[i] = rings * 0.3;
      d[i * 4] = clamp255(base[0] * k);
      d[i * 4 + 1] = clamp255(base[1] * k);
      d[i * 4 + 2] = clamp255(base[2] * k);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 1) };
}

// ---------------------------------------------------------------- bark, stone

/** Fibrous fig/ceiba bark with deep vertical fissures and moss. Tiles in both directions. */
export function barkTexture(seed = 3): TexPair {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const light: RGB = [214, 196, 168];
  const mid: RGB = [168, 148, 122];
  const dark: RGB = [96, 78, 60];
  const moss: RGB = [118, 132, 70];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const warp = fbmTile(u, v, 3, 3) * 0.08;
      const f1 = perlin2Tile((u + warp) * 28 + seed, v * 3, 28, 3);
      const f2 = perlin2Tile((u + warp) * 70 + seed * 2, v * 6, 70, 6);
      const ridge = 1 - Math.abs(f1);
      const fiss = Math.pow(ridge, 3);
      const h = fiss * 0.75 + (1 - Math.abs(f2)) * 0.25;
      let c = mix3(dark, mid, Math.min(1, h * 1.4));
      c = mix3(c, light, Math.max(0, h - 0.55) * 1.6);
      const m = fbmTile(u + 0.3, v, 4, 3);
      if (m > 0.18) c = mix3(c, moss, Math.min(0.75, (m - 0.18) * 3) * (0.4 + h * 0.6));
      const n = hash2(x, y) * 14 - 7;
      const i = y * S + x;
      height[i] = h;
      d[i * 4] = clamp255(c[0] + n);
      d[i * 4 + 1] = clamp255(c[1] + n);
      d[i * 4 + 2] = clamp255(c[2] + n);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 9) };
}

export function stoneTexture(base: RGB, mossAmount: number, seed = 7): TexPair {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const moss: RGB = [92, 112, 52];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbmTile(u + seed, v, 6, 5);
      const n2 = fbmTile(u, v + seed, 24, 3);
      const k = 0.85 + n * 0.25 + n2 * 0.12;
      let c: RGB = [base[0] * k, base[1] * k, base[2] * k];
      const m = fbmTile(u + 0.5, v + 0.2, 3, 4);
      if (m > 0.25 - mossAmount) c = mix3(c, moss, Math.min(0.85, (m - 0.25 + mossAmount) * 3));
      const sp = hash2(x, y);
      if (sp > 0.985) c = mix3(c, [40, 38, 35], 0.5);
      const i = y * S + x;
      height[i] = n * 0.6 + n2 * 0.4;
      d[i * 4] = clamp255(c[0]);
      d[i * 4 + 1] = clamp255(c[1]);
      d[i * 4 + 2] = clamp255(c[2]);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 6) };
}

// ---------------------------------------------------------------- textiles

/** Neutral woven upholstery (tinted per material). */
export function fabricTexture(seed = 1, coarse = 1): TexPair {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const period = Math.round(4 * coarse);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wx = Math.floor(x / period);
      const wy = Math.floor(y / period);
      const over = (wx + wy) % 2 === 0;
      const lx = (x % period) / period;
      const ly = (y % period) / period;
      const thread = over ? Math.sin(ly * Math.PI) : Math.sin(lx * Math.PI);
      const slub = perlin2Tile((x / S) * 16 + seed, (y / S) * 64, 16, 64) * 0.5 + perlin2Tile((x / S) * 64, (y / S) * 16 + seed, 64, 16) * 0.5;
      const h = 0.5 + thread * 0.35 + slub * 0.15;
      const k = 200 + thread * 40 + slub * 25 + (hash2(x, y) - 0.5) * 18;
      const i = y * S + x;
      height[i] = h;
      d[i * 4] = clamp255(k);
      d[i * 4 + 1] = clamp255(k);
      d[i * 4 + 2] = clamp255(k);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 1.6) };
}

/** Chunky woven jute/knit (poufs, rugs) — tinted. */
export function knitTexture(seed = 2): TexPair {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const cell = 16;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cy = Math.floor(y / cell);
      const lx = ((x + (cy % 2) * cell * 0.5) % cell) / cell;
      const ly = (y % cell) / cell;
      // V-shaped stitches
      const vshape = Math.abs(lx - 0.5) * 2;
      const st = Math.sin(Math.min(1, Math.abs(ly - vshape * 0.5) * 2.2) * Math.PI);
      const n = perlin2Tile((x / S) * 32 + seed, (y / S) * 32, 32, 32);
      const h = Math.max(0, st) * 0.8 + n * 0.2;
      const k = 150 + h * 90 + (hash2(x, y) - 0.5) * 20;
      const i = y * S + x;
      height[i] = h;
      d[i * 4] = clamp255(k);
      d[i * 4 + 1] = clamp255(k);
      d[i * 4 + 2] = clamp255(k);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 3) };
}

/** Round braided jute rug with patterned bands. `bands` = list of [r0, r1, colour, pattern]. */
export function roundRugTexture(opts: { base: RGB; bands: { r0: number; r1: number; color: RGB; pattern: "solid" | "zigzag" | "dots" | "diamonds" | "stripes" }[]; seed: number }): TexPair {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2);
      const dy = (y - S / 2) / (S / 2);
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const i = y * S + x;
      if (r > 1) {
        d[i * 4 + 3] = 0;
        continue;
      }
      // braided coil rows
      const row = r * 46;
      const fr = row - Math.floor(row);
      const braid = Math.sin((a * 46 * r + Math.floor(row) * 1.7) * 3) * 0.5 + 0.5;
      const h = Math.sin(fr * Math.PI) * (0.7 + braid * 0.3);
      let c: RGB = [opts.base[0] * (0.78 + h * 0.3), opts.base[1] * (0.78 + h * 0.3), opts.base[2] * (0.78 + h * 0.3)];
      for (const b of opts.bands) {
        if (r >= b.r0 && r <= b.r1) {
          const t = (r - b.r0) / (b.r1 - b.r0);
          let on = true;
          const seg = (a / (Math.PI * 2) + 0.5) * Math.round(60 * r + 6);
          if (b.pattern === "zigzag") on = Math.abs(((seg % 1) - 0.5) * 2 - (t * 2 - 1)) < 0.35;
          else if (b.pattern === "dots") on = Math.hypot((seg % 1) - 0.5, t - 0.5) < 0.3;
          else if (b.pattern === "diamonds") on = Math.abs((seg % 1) - 0.5) + Math.abs(t - 0.5) < 0.42;
          else if (b.pattern === "stripes") on = Math.floor(seg * 2) % 2 === 0;
          if (on) c = mix3(c, [b.color[0] * (0.8 + h * 0.3), b.color[1] * (0.8 + h * 0.3), b.color[2] * (0.8 + h * 0.3)], 0.92);
        }
      }
      const edgeFade = r > 0.985 ? 0 : 255;
      height[i] = h;
      const n = (hash2(x, y) - 0.5) * 16;
      d[i * 4] = clamp255(c[0] + n);
      d[i * 4 + 1] = clamp255(c[1] + n);
      d[i * 4 + 2] = clamp255(c[2] + n);
      d[i * 4 + 3] = edgeFade;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 3) };
}

/** Rectangular chunky knit rug (theatre, trading). */
export function rectRugTexture(base: RGB, border: RGB | null, seed = 4): TexPair {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const lx = (x % 12) / 12;
      const ly = (y % 18) / 18;
      const st = Math.sin(lx * Math.PI) * (0.6 + 0.4 * Math.sin(ly * Math.PI * 2 + (Math.floor(x / 12) % 2) * Math.PI));
      const n = perlin2Tile((x / S) * 16 + seed, (y / S) * 16, 16, 16) * 0.15;
      const h = st + n;
      let c: RGB = [base[0] * (0.75 + h * 0.35), base[1] * (0.75 + h * 0.35), base[2] * (0.75 + h * 0.35)];
      const e = Math.min(x, y, S - x, S - y);
      if (border && e > 14 && e < 30) c = mix3(c, border, 0.8);
      const i = y * S + x;
      height[i] = h;
      d[i * 4] = clamp255(c[0]);
      d[i * 4 + 1] = clamp255(c[1]);
      d[i * 4 + 2] = clamp255(c[2]);
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 3) };
}

/** Red Persian-style rug (MixChimp drum area). */
export function persianRugTexture(): TexPair {
  const W = 1024;
  const H = 768;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = "#8e2219";
  ctx.fillRect(0, 0, W, H);
  const bands: [number, string][] = [
    [0, "#2b1b24"],
    [18, "#c9a35c"],
    [28, "#1f2d4a"],
    [74, "#c9a35c"],
    [84, "#7a1c16"],
  ];
  for (const [inset, col] of bands) {
    ctx.fillStyle = col;
    ctx.fillRect(inset, inset, W - inset * 2, H - inset * 2);
  }
  ctx.fillStyle = "#9b2a1e";
  ctx.fillRect(96, 96, W - 192, H - 192);
  // border motifs
  ctx.fillStyle = "#e0c27a";
  for (let x = 40; x < W - 40; x += 34) {
    diamond(ctx, x, 50, 10, 14);
    diamond(ctx, x, H - 50, 10, 14);
  }
  for (let y = 40; y < H - 40; y += 34) {
    diamond(ctx, 50, y, 14, 10);
    diamond(ctx, W - 50, y, 14, 10);
  }
  // field pattern
  const r = rng(3);
  for (let y = 130; y < H - 120; y += 46) {
    for (let x = 130; x < W - 120; x += 46) {
      ctx.fillStyle = r() > 0.5 ? "#d7b46a" : "#23365a";
      diamond(ctx, x, y, 9, 9);
      ctx.fillStyle = "#5b1712";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }
  // central medallion
  ctx.save();
  ctx.translate(W / 2, H / 2);
  for (const [s, col] of [
    [190, "#1f2d4a"],
    [160, "#c9a35c"],
    [130, "#7a1c16"],
    [90, "#e0c27a"],
    [50, "#1f2d4a"],
  ] as [number, string][]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = s * (i % 2 ? 0.72 : 1);
      ctx.lineTo(Math.cos(a) * rr * 1.25, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  wearNoise(ctx, W, H, 26);
  return { albedo: canvas };
}

function diamond(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - ry);
  ctx.lineTo(x + rx, y);
  ctx.lineTo(x, y + ry);
  ctx.lineTo(x - rx, y);
  ctx.closePath();
  ctx.fill();
}

function wearNoise(ctx: Ctx, w: number, h: number, amt: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = (hash2(x * 1.3, y * 0.7) - 0.5) * amt + perlin2Tile(x / 64, y / 64, 64, 64) * amt * 0.5;
      d[i] = clamp255(d[i] + n);
      d[i + 1] = clamp255(d[i + 1] + n);
      d[i + 2] = clamp255(d[i + 2] + n);
    }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- ChimpHouse emblem & mosaic rug

/** The botanical leaf emblem (five leaves rising from a point). */
export function drawLeafEmblem(ctx: Ctx, cx: number, cy: number, size: number, fill: string, stroke?: string) {
  const leaves: [number, number, number][] = [
    [0, 1.0, 0.24],
    [-0.42, 0.82, 0.22],
    [0.42, 0.82, 0.22],
    [-0.95, 0.6, 0.2],
    [0.95, 0.6, 0.2],
  ];
  ctx.save();
  ctx.translate(cx, cy);
  for (const [ang, len, wid] of leaves) {
    ctx.save();
    ctx.rotate(ang);
    const L = size * len;
    const Wd = size * wid;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(Wd, -L * 0.3, Wd * 0.9, -L * 0.75, 0, -L);
    ctx.bezierCurveTo(-Wd * 0.9, -L * 0.75, -Wd, -L * 0.3, 0, 0);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = size * 0.02;
      ctx.beginPath();
      ctx.moveTo(0, -L * 0.05);
      ctx.lineTo(0, -L * 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Circular mosaic rug in the entry hall with the leaf emblem at its centre. */
export function mosaicRugTexture(): TexPair {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  const c = S / 2;
  const ring = (r0: number, r1: number, col: string) => {
    ctx.beginPath();
    ctx.arc(c, c, r1, 0, Math.PI * 2);
    ctx.arc(c, c, r0, 0, Math.PI * 2, true);
    ctx.fillStyle = col;
    ctx.fill("evenodd");
  };
  ctx.clearRect(0, 0, S, S);
  ring(0, 510, "#e9dcc2");
  ring(470, 510, "#2f6f6a");
  ring(452, 468, "#8a6a45");
  // patterned band: alternating triangles
  const band = (r0: number, r1: number, n: number, a: string, b: string) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a0) * r0, c + Math.sin(a0) * r0);
      ctx.lineTo(c + Math.cos(am) * r1, c + Math.sin(am) * r1);
      ctx.lineTo(c + Math.cos(a1) * r0, c + Math.sin(a1) * r0);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? a : b;
      ctx.fill();
    }
  };
  ring(380, 450, "#d8c7a3");
  band(385, 445, 72, "#3d7f77", "#6b4b30");
  ring(372, 380, "#2f6f6a");
  ring(300, 372, "#ebe0c8");
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ctx.fillStyle = i % 2 ? "#9a7a50" : "#4f8f86";
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * 336, c + Math.sin(a) * 336, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  ring(292, 300, "#6b4b30");
  ring(0, 292, "#efe5cf");
  drawLeafEmblem(ctx, c, c + 120, 300, "#3f8a73");
  drawLeafEmblem(ctx, c, c + 120, 250, "#5aa88a");
  // mosaic tesserae grid + grout
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      // polar tesserae
      const tr = r / 12;
      const ta = (a * r) / 12;
      const fr = tr - Math.floor(tr);
      const fa = ta - Math.floor(ta);
      const grout = fr < 0.12 || fa < 0.12;
      const jitter = (hash2(Math.floor(tr), Math.floor(ta)) - 0.5) * 22;
      if (r > 510) {
        d[i * 4 + 3] = 0;
        continue;
      }
      if (grout) {
        d[i * 4] = clamp255(d[i * 4] * 0.78);
        d[i * 4 + 1] = clamp255(d[i * 4 + 1] * 0.76);
        d[i * 4 + 2] = clamp255(d[i * 4 + 2] * 0.72);
        height[i] = 0;
      } else {
        d[i * 4] = clamp255(d[i * 4] + jitter);
        d[i * 4 + 1] = clamp255(d[i * 4 + 1] + jitter);
        d[i * 4 + 2] = clamp255(d[i * 4 + 2] + jitter);
        height[i] = 1;
      }
    }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 2) };
}

// ---------------------------------------------------------------- misc surfaces

/** Glass mosaic pool tiles: `tiles` across the texture, colours varied between `a` and `b`. */
export function poolTileTexture(a: RGB = [40, 190, 200], b: RGB = [90, 225, 220], grout: RGB = [196, 228, 226], tiles = 32): TexPair {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const t = S / tiles;
  const gw = Math.max(1, Math.round(t * 0.11));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const tx = Math.floor(x / t);
      const ty = Math.floor(y / t);
      const lx = x - tx * t;
      const ly = y - ty * t;
      const g = lx < gw || ly < gw;
      const h = hash2(tx, ty);
      // glossy glass: a soft highlight toward each tile's upper-left
      const sheen = 1 + 0.08 * Math.max(0, 1 - Math.hypot(lx / t - 0.35, ly / t - 0.35) * 2.2);
      const c: RGB = g ? grout : (mix3(a, b, h).map((v) => v * sheen) as RGB);
      const i = y * S + x;
      height[i] = g ? 0 : 1;
      d[i * 4] = clamp255(c[0]);
      d[i * 4 + 1] = clamp255(c[1]);
      d[i * 4 + 2] = clamp255(c[2]);
      d[i * 4 + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 2) };
}

/** Tileable underwater caustics: bright wavy lines along the edges of a warped cell pattern. */
export function causticsTexture(seed = 5): HTMLCanvasElement {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const r = rng(seed);
  const pts = Array.from({ length: 18 }, () => [r(), r()] as [number, number]);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u0 = x / S;
      const v0 = y / S;
      const u = u0 + perlin2Tile(u0 * 4, v0 * 4, 4, 4) * 0.035;
      const v = v0 + perlin2Tile(u0 * 4 + 7, v0 * 4 + 3, 4, 4) * 0.035;
      let f1 = 9;
      let f2 = 9;
      for (const [px, py] of pts) {
        let dx = Math.abs(u - px);
        let dy = Math.abs(v - py);
        dx = Math.min(dx, 1 - dx);
        dy = Math.min(dy, 1 - dy);
        const dd = Math.hypot(dx, dy);
        if (dd < f1) {
          f2 = f1;
          f1 = dd;
        } else if (dd < f2) f2 = dd;
      }
      const e = f2 - f1;
      const line = Math.pow(Math.max(0, 1 - e / 0.05), 2.2);
      const k = clamp255(line * 255);
      const i = (y * S + x) * 4;
      d[i] = k;
      d[i + 1] = k;
      d[i + 2] = k;
      d[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Tileable water ripple normal map. */
export function waterNormalTexture(): HTMLCanvasElement {
  const S = 512;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) h[y * S + x] = fbmTile(x / S, y / S, 8, 4) * 0.7 + fbmTile(x / S + 0.37, y / S, 24, 2) * 0.3;
  return normalFromHeight(h, S, S, 6);
}

/** Woven rattan lattice for pendant shades; alpha = strands. */
export function latticeTexture(): HTMLCanvasElement {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const cells = 10;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x / S) * cells;
      const v = (y / S) * cells * 0.6;
      const a = Math.abs(((u + v) % 1) - 0.5);
      const b = Math.abs(((u - v + 100) % 1) - 0.5);
      const strand = Math.max(0, 1 - Math.min(a, b) / 0.11);
      const i = (y * S + x) * 4;
      const k = 0.65 + strand * 0.35;
      d[i] = clamp255(196 * k);
      d[i + 1] = clamp255(140 * k);
      d[i + 2] = clamp255(78 * k);
      d[i + 3] = strand > 0.15 ? 255 : 0;
    }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Brushed steel (lift doors, appliances). */
export function brushedTexture(): HTMLCanvasElement {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = perlin2Tile((x / S) * 2, (y / S) * 128, 2, 128) * 22 + (hash2(x * 0.01, y) - 0.5) * 10;
      const i = (y * S + x) * 4;
      d[i] = clamp255(178 + n);
      d[i + 1] = clamp255(176 + n);
      d[i + 2] = clamp255(170 + n);
      d[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Forest-floor / soil detail (tinted by terrain vertex colours). */
export function groundTexture(): TexPair {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const height = new Float32Array(S * S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbmTile(u, v, 8, 5);
      const leaf = fbmTile(u + 0.21, v + 0.6, 32, 2);
      const k = 0.78 + n * 0.3 + (leaf > 0.2 ? 0.18 : 0) + (hash2(x, y) - 0.5) * 0.12;
      const i = y * S + x;
      height[i] = n + (leaf > 0.2 ? 0.3 : 0);
      d[i * 4] = clamp255(200 * k);
      d[i * 4 + 1] = clamp255(196 * k);
      d[i * 4 + 2] = clamp255(186 * k);
      d[i * 4 + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 3) };
}

/** Soft cloud puff for sky billboards (alpha). */
export function cloudTexture(seed = 1): HTMLCanvasElement {
  const W = 512;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const r = rng(seed);
  for (let i = 0; i < 46; i++) {
    const x = W * (0.15 + r() * 0.7);
    const y = H * (0.45 + r() * 0.3) - Math.sin(((x / W) - 0.15) / 0.7 * Math.PI) * H * 0.25 * r();
    const rad = 30 + r() * 60;
    const g = ctx.createRadialGradient(x, y - rad * 0.3, rad * 0.1, x, y, rad);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.6, "rgba(250,248,245,0.25)");
    g.addColorStop(1, "rgba(240,240,245,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

export function starsTexture(): HTMLCanvasElement {
  const W = 2048;
  const H = 1024;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#030716");
  g.addColorStop(0.45, "#0a1534");
  g.addColorStop(0.5, "#162a52");
  g.addColorStop(1, "#0b1530");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = rng(99);
  for (let i = 0; i < 2600; i++) {
    const y = Math.pow(r(), 1.4) * H * 0.5;
    const x = r() * W;
    const b = r();
    ctx.fillStyle = `rgba(255,${230 + b * 25},${210 + b * 45},${0.35 + b * 0.65})`;
    const s = b > 0.97 ? 2.2 : b > 0.85 ? 1.5 : 1;
    ctx.fillRect(x, y, s, s);
  }
  return canvas;
}

/** Waterfall sheet: vertical streaks (alpha), scrolled in the shader via UV offset. */
export function waterfallTexture(): HTMLCanvasElement {
  const W = 256;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = perlin2Tile((x / W) * 24, (y / H) * 3, 24, 3) * 0.6 + perlin2Tile((x / W) * 64, (y / H) * 8, 64, 8) * 0.4;
      const edge = Math.min(x, W - x) / (W * 0.18);
      const a = Math.max(0, Math.min(1, 0.55 + n * 0.8)) * Math.min(1, edge);
      const i = (y * W + x) * 4;
      const k = 225 + n * 30;
      d[i] = clamp255(k);
      d[i + 1] = clamp255(k + 8);
      d[i + 2] = clamp255(k + 12);
      d[i + 3] = clamp255(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export { hex };

/** Opaque, tileable leafy canopy (distant tree crowns). */
export function canopyTexture(seed = 13): TexPair {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = "#1f4a1c";
  ctx.fillRect(0, 0, S, S);
  const r = rng(seed);
  const palette = ["#24521f", "#2f6526", "#3b7a2c", "#4c8f33", "#62a43c", "#7fbb46", "#a6cf55"];
  for (let i = 0; i < 2600; i++) {
    const x = r() * S;
    const y = r() * S;
    const t = Math.min(1, Math.max(0, r() * 0.7 + (1 - y / S) * 0.3));
    const col = palette[Math.floor(t * (palette.length - 1) + r() * 1.2) % palette.length];
    const len = 8 + r() * 14;
    const a = r() * Math.PI * 2;
    for (const [ox, oy] of [
      [0, 0],
      [S, 0],
      [-S, 0],
      [0, S],
      [0, -S],
    ]) {
      ctx.save();
      ctx.translate(x + ox, y + oy);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, len * 0.32, len * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
    }
  }
  const img = ctx.getImageData(0, 0, S, S);
  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) height[i] = img.data[i * 4 + 1] / 255;
  return { albedo: canvas, normal: normalFromHeight(height, S, S, 3) };
}

/** Thin sheet of water spilling over an edge: separate streaks with clear gaps (alpha), tileable. */
export function spillTexture(): HTMLCanvasElement {
  const W = 256;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const streak = perlin2Tile(u * 48, v * 2, 48, 2) * 0.7 + perlin2Tile(u * 96, v * 5, 96, 5) * 0.3;
      const ripple = perlin2Tile(u * 12, v * 16, 12, 16) * 0.25;
      const a = Math.max(0, Math.min(1, (streak + ripple + 0.05) * 2.4));
      const k = 225 + streak * 30;
      const i = (y * W + x) * 4;
      d[i] = clamp255(k);
      d[i + 1] = clamp255(k + 10);
      d[i + 2] = clamp255(k + 12);
      d[i + 3] = clamp255(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
