// Canvas painters for signage and procedural screens.

import { makeCanvas } from "./canvas";
import { drawLeafEmblem } from "./textures";

export function gableSignCanvas(text: string): { board: HTMLCanvasElement; glyphs: HTMLCanvasElement } {
  const W = 1024;
  const H = 420;
  const peak = 130;
  const shape = (ctx: CanvasRenderingContext2D, inset: number) => {
    ctx.beginPath();
    ctx.moveTo(inset, H - inset);
    ctx.lineTo(inset, peak + inset * 0.6);
    ctx.lineTo(W / 2, inset);
    ctx.lineTo(W - inset, peak + inset * 0.6);
    ctx.lineTo(W - inset, H - inset);
    ctx.closePath();
  };
  const b = makeCanvas(W, H);
  const bc = b.ctx;
  shape(bc, 0);
  bc.fillStyle = "#3b2414";
  bc.fill();
  shape(bc, 14);
  const g = bc.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#6b4126");
  g.addColorStop(1, "#4a2c18");
  bc.fillStyle = g;
  bc.fill();
  // subtle grain lines
  bc.globalAlpha = 0.18;
  for (let y = 20; y < H; y += 7) {
    bc.strokeStyle = y % 14 ? "#2a170b" : "#7a4d2e";
    bc.beginPath();
    bc.moveTo(0, y + Math.sin(y) * 2);
    bc.lineTo(W, y + Math.cos(y) * 2);
    bc.stroke();
  }
  bc.globalAlpha = 1;
  shape(bc, 22);
  bc.strokeStyle = "#c9a36a";
  bc.lineWidth = 4;
  bc.stroke();

  const t = makeCanvas(W, H);
  const tc = t.ctx;
  tc.clearRect(0, 0, W, H);
  drawLeafEmblem(tc, W / 2, peak + 60, 72, "#7ff0c4");
  tc.font = "700 128px Cinzel";
  tc.textAlign = "center";
  tc.textBaseline = "middle";
  tc.fillStyle = "#f7e7c6";
  tc.fillText(text, W / 2, peak + 170, W - 90);
  return { board: b.canvas, glyphs: t.canvas };
}

/** Simple room/destination sign: dark board with light lettering. */
export function roomSignCanvas(text: string, o: { w?: number; h?: number; font?: string; color?: string; bg?: string; border?: string; emblem?: boolean } = {}): HTMLCanvasElement {
  const W = o.w ?? 1024;
  const H = o.h ?? 220;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = o.bg ?? "#2a2018";
  roundRect(ctx, 0, 0, W, H, 26);
  ctx.fill();
  ctx.strokeStyle = o.border ?? "#b98f5a";
  ctx.lineWidth = 6;
  roundRect(ctx, 10, 10, W - 20, H - 20, 20);
  ctx.stroke();
  ctx.font = o.font ?? "600 96px Montserrat";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = o.color ?? "#f4e6cc";
  const x = o.emblem ? W / 2 + 40 : W / 2;
  ctx.fillText(text, x, H / 2 + 4, W - 120);
  if (o.emblem) drawLeafEmblem(ctx, 90, H / 2 + 40, 70, "#7ff0c4");
  return canvas;
}

/** Lettering only (transparent background) for backlit wall signs. */
export function letteringCanvas(lines: string[], o: { w?: number; h?: number; font: string; color: string; emblem?: { color: string; size: number; y: number }; lineGap?: number; glow?: string }): HTMLCanvasElement {
  const W = o.w ?? 1024;
  const H = o.h ?? 512;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  if (o.emblem) drawLeafEmblem(ctx, W / 2, o.emblem.y, o.emblem.size, o.emblem.color);
  ctx.font = o.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const gap = o.lineGap ?? 120;
  const y0 = H / 2 - ((lines.length - 1) * gap) / 2 + (o.emblem ? o.emblem.size * 0.6 : 0);
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = 24;
  }
  ctx.fillStyle = o.color;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * gap, W - 40));
  return canvas;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
