// Leaf atlas: 4x4 cells of hand-drawn tropical leaves on transparent ground.
// Each leaf's stem sits at the bottom centre of its cell, tip pointing up.

import { rng } from "../geometry/curves";
import { Ctx, makeCanvas } from "./canvas";

export const ATLAS_GRID = 4;
export const CELL = 512;

export enum Leaf {
  Monstera = 0,
  Banana = 1,
  Philodendron = 2,
  Pothos = 3,
  Fern = 4,
  Palm = 5,
  Bromeliad = 6,
  Cordyline = 7,
  Calathea = 8,
  Twig = 9,
  CanopyA = 10,
  CanopyB = 11,
  Grass = 12,
  ElephantEar = 13,
  Croton = 14,
  SmallRound = 15,
}

/** width / length ratio of each leaf drawing (used to size quads). */
export const LEAF_ASPECT: Record<Leaf, number> = {
  [Leaf.Monstera]: 0.9,
  [Leaf.Banana]: 0.36,
  [Leaf.Philodendron]: 0.72,
  [Leaf.Pothos]: 0.75,
  [Leaf.Fern]: 0.42,
  [Leaf.Palm]: 0.5,
  [Leaf.Bromeliad]: 0.14,
  [Leaf.Cordyline]: 0.2,
  [Leaf.Calathea]: 0.5,
  [Leaf.Twig]: 0.8,
  [Leaf.CanopyA]: 1,
  [Leaf.CanopyB]: 1,
  [Leaf.Grass]: 0.7,
  [Leaf.ElephantEar]: 0.8,
  [Leaf.Croton]: 0.36,
  [Leaf.SmallRound]: 0.8,
};

export function leafUV(l: Leaf): [number, number, number, number] {
  const col = l % ATLAS_GRID;
  const row = Math.floor(l / ATLAS_GRID);
  const pad = 2 / (CELL * ATLAS_GRID);
  return [col / ATLAS_GRID + pad, 1 - (row + 1) / ATLAS_GRID + pad, (col + 1) / ATLAS_GRID - pad, 1 - row / ATLAS_GRID - pad];
}

type Shape = (ctx: Ctx, L: number, W: number) => void;

function leafPath(ctx: Ctx, L: number, W: number, tipSharp = 0.75, baseRound = 0.3) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(W * 0.5, -L * baseRound, W * 0.55, -L * tipSharp, 0, -L);
  ctx.bezierCurveTo(-W * 0.55, -L * tipSharp, -W * 0.5, -L * baseRound, 0, 0);
  ctx.closePath();
}

function heartPath(ctx: Ctx, L: number, W: number) {
  ctx.beginPath();
  ctx.moveTo(0, -L * 0.12);
  ctx.bezierCurveTo(W * 0.25, L * 0.02, W * 0.62, -L * 0.1, W * 0.5, -L * 0.42);
  ctx.bezierCurveTo(W * 0.4, -L * 0.7, W * 0.12, -L * 0.88, 0, -L);
  ctx.bezierCurveTo(-W * 0.12, -L * 0.88, -W * 0.4, -L * 0.7, -W * 0.5, -L * 0.42);
  ctx.bezierCurveTo(-W * 0.62, -L * 0.1, -W * 0.25, L * 0.02, 0, -L * 0.12);
  ctx.closePath();
}

function gradientFill(ctx: Ctx, L: number, c0: string, c1: string, c2?: string) {
  const g = ctx.createLinearGradient(0, 0, 0, -L);
  g.addColorStop(0, c0);
  g.addColorStop(0.55, c1);
  g.addColorStop(1, c2 ?? c1);
  ctx.fillStyle = g;
}

function midrib(ctx: Ctx, L: number, color: string, w: number, from = 0, to = 0.95) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(0, -L * from);
  ctx.lineTo(0, -L * to);
  ctx.stroke();
}

function veins(ctx: Ctx, L: number, W: number, n: number, color: string, w: number, angle = 0.9, reach = 0.45) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  for (let i = 1; i <= n; i++) {
    const y = -L * (0.08 + (i / (n + 1)) * 0.85);
    const len = W * reach * Math.sin((i / (n + 1)) * Math.PI) + W * 0.05;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(s * len * 0.5, y - len * angle * 0.3, s * len, y - len * angle * 0.6);
      ctx.stroke();
    }
  }
}

function shading(ctx: Ctx, L: number, W: number) {
  // side-to-side shading to fake a folded leaf
  const g = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
  g.addColorStop(0, "rgba(0,0,0,0.18)");
  g.addColorStop(0.48, "rgba(255,255,230,0.10)");
  g.addColorStop(0.52, "rgba(0,0,0,0.06)");
  g.addColorStop(1, "rgba(255,255,220,0.06)");
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = g;
  ctx.fillRect(-W, -L * 1.05, W * 2, L * 1.1);
  ctx.globalCompositeOperation = "source-over";
}

const shapes: Record<Leaf, Shape> = {
  [Leaf.Monstera]: (ctx, L, W) => {
    heartPath(ctx, L, W);
    gradientFill(ctx, L, "#1f5a2a", "#2f7a34", "#3f8d3a");
    ctx.fill();
    // fenestration splits
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 6; i++) {
      const y = -L * (0.2 + i * 0.12);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * W * 0.12, y);
        ctx.lineTo(s * W * 0.7, y - L * 0.06);
        ctx.lineTo(s * W * 0.7, y - L * 0.09);
        ctx.lineTo(s * W * 0.18, y - L * 0.02);
        ctx.closePath();
        ctx.fill();
      }
      if (i < 4) {
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(s * W * 0.18, y - L * 0.05, W * 0.03, L * 0.025, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = "source-over";
    midrib(ctx, L, "#8fbf6a", L * 0.012, 0.1, 0.92);
    shading(ctx, L, W);
  },
  [Leaf.Banana]: (ctx, L, W) => {
    leafPath(ctx, L, W, 0.85, 0.15);
    gradientFill(ctx, L, "#3b7d2b", "#5da03a", "#79b444");
    ctx.fill();
    ctx.strokeStyle = "rgba(30,70,20,0.35)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 40; i++) {
      const y = -L * (0.04 + i * 0.023);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s * W * 0.6, y - L * 0.03);
        ctx.stroke();
      }
    }
    // tears
    ctx.globalCompositeOperation = "destination-out";
    const r = rng(4);
    for (let i = 0; i < 7; i++) {
      const y = -L * (0.25 + r() * 0.6);
      const s = r() > 0.5 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(s * W * 0.05, y);
      ctx.lineTo(s * W * 0.7, y - L * 0.04);
      ctx.lineTo(s * W * 0.7, y - L * 0.045);
      ctx.closePath();
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    midrib(ctx, L, "#c9dc8c", L * 0.014);
    shading(ctx, L, W);
  },
  [Leaf.Philodendron]: (ctx, L, W) => {
    heartPath(ctx, L, W);
    gradientFill(ctx, L, "#1d5426", "#2c7431", "#3a8a3a");
    ctx.fill();
    midrib(ctx, L, "#7fb05b", L * 0.012, 0.12, 0.92);
    veins(ctx, L, W, 6, "rgba(120,175,90,0.6)", L * 0.006, 1.2, 0.42);
    shading(ctx, L, W);
  },
  [Leaf.Pothos]: (ctx, L, W) => {
    heartPath(ctx, L, W);
    gradientFill(ctx, L, "#4f8f2f", "#6aa83a", "#86bf45");
    ctx.fill();
    // golden variegation streaks
    ctx.globalCompositeOperation = "source-atop";
    const r = rng(7);
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = `rgba(222,214,110,${0.25 + r() * 0.3})`;
      ctx.lineWidth = 3 + r() * 6;
      ctx.beginPath();
      const x0 = (r() - 0.5) * W * 0.6;
      ctx.moveTo(x0, -L * (0.1 + r() * 0.3));
      ctx.quadraticCurveTo(x0 * 1.4, -L * 0.6, (r() - 0.5) * W * 0.3, -L * (0.7 + r() * 0.2));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    midrib(ctx, L, "#b9d77a", L * 0.012, 0.12, 0.92);
    shading(ctx, L, W);
  },
  [Leaf.Fern]: (ctx, L, W) => {
    ctx.strokeStyle = "#4c7d2a";
    ctx.lineWidth = L * 0.012;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -L);
    ctx.stroke();
    const n = 26;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const y = -L * t;
      const len = W * 0.5 * Math.sin(Math.min(1, t * 1.15) * Math.PI) * (1 - t * 0.2);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(0, y);
        ctx.rotate(s * (1.15 - t * 0.3));
        leafPath(ctx, len, len * 0.32, 0.8, 0.25);
        ctx.fillStyle = i % 2 ? "#4f9a34" : "#5ca83b";
        ctx.fill();
        ctx.restore();
      }
    }
  },
  [Leaf.Palm]: (ctx, L, W) => {
    ctx.strokeStyle = "#6b7d35";
    ctx.lineWidth = L * 0.014;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(W * 0.05, -L * 0.5, 0, -L);
    ctx.stroke();
    const n = 34;
    for (let i = 2; i < n; i++) {
      const t = i / n;
      const y = -L * t;
      const len = W * 0.55 * Math.sin(Math.min(1, t * 1.05) * Math.PI * 0.9 + 0.2);
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(0, y);
        ctx.rotate(s * (0.95 - t * 0.35));
        leafPath(ctx, len, len * 0.13, 0.9, 0.2);
        ctx.fillStyle = i % 3 ? "#3f8a30" : "#52a03a";
        ctx.fill();
        ctx.restore();
      }
    }
  },
  [Leaf.Bromeliad]: (ctx, L, W) => {
    leafPath(ctx, L, W, 0.92, 0.1);
    const g = ctx.createLinearGradient(0, 0, 0, -L);
    g.addColorStop(0, "#3d6b2a");
    g.addColorStop(0.35, "#b0283a");
    g.addColorStop(1, "#e2364a");
    ctx.fillStyle = g;
    ctx.fill();
    midrib(ctx, L, "rgba(255,170,170,0.5)", L * 0.006);
    shading(ctx, L, W);
  },
  [Leaf.Cordyline]: (ctx, L, W) => {
    leafPath(ctx, L, W, 0.8, 0.25);
    const g = ctx.createLinearGradient(0, 0, 0, -L);
    g.addColorStop(0, "#4a1f2c");
    g.addColorStop(0.5, "#8c2240");
    g.addColorStop(1, "#c8325a");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalCompositeOperation = "source-atop";
    ctx.strokeStyle = "rgba(240,90,120,0.6)";
    ctx.lineWidth = W * 0.06;
    ctx.beginPath();
    ctx.moveTo(-W * 0.45, -L * 0.2);
    ctx.lineTo(-W * 0.3, -L * 0.9);
    ctx.moveTo(W * 0.45, -L * 0.2);
    ctx.lineTo(W * 0.3, -L * 0.9);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    midrib(ctx, L, "rgba(255,150,170,0.7)", L * 0.008);
  },
  [Leaf.Calathea]: (ctx, L, W) => {
    leafPath(ctx, L, W, 0.7, 0.35);
    gradientFill(ctx, L, "#2d5a2a", "#3b7234");
    ctx.fill();
    ctx.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 9; i++) {
      const y = -L * (0.12 + i * 0.09);
      for (const s of [-1, 1]) {
        ctx.fillStyle = "rgba(160,200,120,0.55)";
        ctx.beginPath();
        ctx.ellipse(s * W * 0.18, y, W * 0.16, L * 0.022, s * -0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    midrib(ctx, L, "#a8cf7a", L * 0.01);
    shading(ctx, L, W);
  },
  [Leaf.Twig]: (ctx, L, W) => {
    ctx.strokeStyle = "#5a4a2a";
    ctx.lineWidth = L * 0.012;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(W * 0.1, -L * 0.5, 0, -L * 0.95);
    ctx.stroke();
    const r = rng(9);
    for (let i = 0; i < 16; i++) {
      const t = 0.15 + (i / 16) * 0.82;
      const s = i % 2 ? 1 : -1;
      ctx.save();
      ctx.translate(W * 0.05 * Math.sin(t * 3), -L * t);
      ctx.rotate(s * (0.7 + r() * 0.5));
      const l = L * (0.22 - t * 0.06);
      leafPath(ctx, l, l * 0.5, 0.75, 0.3);
      const tone = r();
      ctx.fillStyle = tone > 0.5 ? "#4f8f2e" : tone > 0.2 ? "#3d7a28" : "#76ab3c";
      ctx.fill();
      ctx.restore();
    }
  },
  [Leaf.CanopyA]: (ctx, L, W) => canopy(ctx, L, W, ["#3f7f2a", "#4f9431", "#62a83a", "#7dbb45", "#a6cf55"], 3),
  [Leaf.CanopyB]: (ctx, L, W) => canopy(ctx, L, W, ["#2b5e24", "#356f29", "#447f2f", "#558f33", "#6aa33a"], 5),
  [Leaf.Grass]: (ctx, L, W) => {
    const r = rng(12);
    for (let i = 0; i < 22; i++) {
      ctx.save();
      const a = (r() - 0.5) * 1.1;
      ctx.rotate(a);
      const l = L * (0.55 + r() * 0.45);
      leafPath(ctx, l, W * 0.06, 0.95, 0.1);
      ctx.fillStyle = r() > 0.5 ? "#4f8f2e" : "#6aa83a";
      ctx.fill();
      ctx.restore();
    }
  },
  [Leaf.ElephantEar]: (ctx, L, W) => {
    heartPath(ctx, L, W);
    gradientFill(ctx, L, "#3f7f2c", "#5c9c38", "#79b244");
    ctx.fill();
    midrib(ctx, L, "#c3dd8a", L * 0.012, 0.12, 0.92);
    veins(ctx, L, W, 7, "rgba(200,225,140,0.55)", L * 0.005, 0.8, 0.46);
    shading(ctx, L, W);
  },
  [Leaf.Croton]: (ctx, L, W) => {
    leafPath(ctx, L, W, 0.75, 0.3);
    const g = ctx.createLinearGradient(0, 0, 0, -L);
    g.addColorStop(0, "#c2402a");
    g.addColorStop(0.4, "#d8a032");
    g.addColorStop(1, "#5a8a2e");
    ctx.fillStyle = g;
    ctx.fill();
    veins(ctx, L, W, 6, "rgba(250,220,90,0.8)", L * 0.008, 1, 0.42);
    midrib(ctx, L, "#f2d26a", L * 0.012);
  },
  [Leaf.SmallRound]: (ctx, L, W) => {
    const r = rng(15);
    ctx.strokeStyle = "#4a6a2a";
    ctx.lineWidth = L * 0.01;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(W * 0.2, -L * 0.5, -W * 0.05, -L * 0.98);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const t = 0.08 + (i / 12) * 0.88;
      const x = W * 0.2 * Math.sin(t * Math.PI) - W * 0.05 * t;
      const s = i % 2 ? 1 : -1;
      ctx.save();
      ctx.translate(x, -L * t);
      ctx.rotate(s * 1.0);
      heartPath(ctx, L * 0.16, L * 0.15);
      ctx.fillStyle = r() > 0.5 ? "#5c9a34" : "#78b442";
      ctx.fill();
      ctx.restore();
    }
  },
};

function canopy(ctx: Ctx, L: number, W: number, palette: string[], seed: number) {
  // dense sunlit cluster of small leaves filling a rounded blob
  const r = rng(seed);
  const cx = 0;
  const cy = -L * 0.5;
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * 0.46;
    const x = cx + Math.cos(a) * rr * W;
    const y = cy + Math.sin(a) * rr * L;
    // lighter toward the top-left (sun)
    const lit = Math.max(0, Math.min(1, 0.5 - (y - cy) / L - (x - cx) / W * 0.4 + (r() - 0.5) * 0.5));
    const idx = Math.min(palette.length - 1, Math.floor(lit * palette.length));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI * 2);
    const l = L * (0.07 + r() * 0.06);
    leafPath(ctx, l, l * 0.55, 0.75, 0.3);
    ctx.fillStyle = palette[idx];
    ctx.fill();
    ctx.restore();
  }
}

/** RGBA pixels (non-premultiplied, colour bled into transparent texels), top row first. */
export function leafAtlasData(): { data: Uint8Array; size: number } {
  const S = CELL * ATLAS_GRID;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 16; i++) {
    const l = i as Leaf;
    const col = i % ATLAS_GRID;
    const row = Math.floor(i / ATLAS_GRID);
    const aspect = LEAF_ASPECT[l];
    const L = CELL * 0.96;
    const W = L * aspect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(col * CELL, row * CELL, CELL, CELL);
    ctx.clip();
    ctx.translate(col * CELL + CELL / 2, row * CELL + CELL - CELL * 0.02);
    // shapes are drawn with W relative to the full cell width when aspect is 1
    shapes[l](ctx, L, Math.min(W, CELL * 0.98));
    ctx.restore();
  }
  // bleed colour into transparent pixels to avoid dark fringes when mipmapped
  void canvas;
  return { data: dilate(ctx, S), size: S };
}

function dilate(ctx: Ctx, S: number): Uint8Array {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const out = new Uint8ClampedArray(d);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? d : new Uint8ClampedArray(out);
    for (let y = 1; y < S - 1; y++)
      for (let x = 1; x < S - 1; x++) {
        const i = (y * S + x) * 4;
        if (src[i + 3] > 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const j = ((y + dy) * S + (x + dx)) * 4;
          if (src[j + 3] > 0 || (pass > 0 && src[j] + src[j + 1] + src[j + 2] > 0)) {
            r += src[j];
            g += src[j + 1];
            b += src[j + 2];
            n++;
          }
        }
        if (n) {
          out[i] = r / n;
          out[i + 1] = g / n;
          out[i + 2] = b / n;
          out[i + 3] = 0;
        }
      }
  }
  return new Uint8Array(out.buffer);
}
