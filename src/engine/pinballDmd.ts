// A pinball machine's dot-matrix display: 128 × 32 dots, each one of four
// brightnesses, drawn as round dots on a texture in the backbox. Frames are
// drawn with ordinary canvas text and shapes on a 128 × 32 canvas, then each
// pixel is rounded to a dot's brightness, as a real DMD's controller does.

import { DynamicTexture, Mesh, Scene, Texture } from "@babylonjs/core";
import { Materials } from "../world/materials/library";

export const DMD_W = 128;
export const DMD_H = 32;
/** texture pixels per dot */
const DOT = 4;

export type DmdCtx = CanvasRenderingContext2D;

export class Dmd {
  /** the 128 × 32 drawing surface: draw in white on black, then `present` */
  readonly ctx: DmdCtx;
  private small: HTMLCanvasElement;
  private big: HTMLCanvasElement;
  private bigCtx: CanvasRenderingContext2D;
  private img: ImageData;
  private tex: DynamicTexture;
  private rgb: [number, number, number];
  private last = "";
  private levels = new Uint8Array(DMD_W * DMD_H);

  constructor(mats: Materials, screen: Mesh, key: string, color: string) {
    const scene: Scene = mats.scene;
    this.small = document.createElement("canvas");
    this.small.width = DMD_W;
    this.small.height = DMD_H;
    this.ctx = this.small.getContext("2d", { willReadFrequently: true })!;
    this.big = document.createElement("canvas");
    this.big.width = DMD_W * DOT;
    this.big.height = DMD_H * DOT;
    this.bigCtx = this.big.getContext("2d")!;
    this.img = this.bigCtx.createImageData(this.big.width, this.big.height);
    this.rgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
    this.tex = new DynamicTexture(key, this.big, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    this.tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.tex.anisotropicFilteringLevel = 4;
    if (mats.has(key)) mats.remove(key);
    screen.material = mats.unlit(key, { tex: this.tex, intensity: 1.6 });
    this.clear();
    this.present();
  }

  clear(): void {
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, DMD_W, DMD_H);
  }

  /** Text in the display's own fonts: size in dots (5 small, 7 normal, 12 big, 20 huge). */
  text(s: string, x: number, y: number, size: number, o: { align?: CanvasTextAlign; shade?: number; bold?: boolean } = {}): void {
    const c = this.ctx;
    const v = Math.round(255 * (o.shade ?? 1));
    c.fillStyle = `rgb(${v},${v},${v})`;
    c.textAlign = o.align ?? "center";
    c.textBaseline = "middle";
    c.font = `${o.bold === false ? 600 : 800} ${size + 2}px ${size >= 12 ? "Nunito" : "Montserrat"}`;
    c.fillText(s, x, y);
  }

  /** Text that fits a width: shrinks from `size` until it does. */
  fit(s: string, x: number, y: number, size: number, maxW: number, o: { align?: CanvasTextAlign; shade?: number } = {}): void {
    let px = size;
    this.ctx.font = `800 ${px + 2}px ${px >= 12 ? "Nunito" : "Montserrat"}`;
    while (px > 5 && this.ctx.measureText(s).width > maxW) {
      px -= 1;
      this.ctx.font = `800 ${px + 2}px ${px >= 12 ? "Nunito" : "Montserrat"}`;
    }
    this.text(s, x, y, px, o);
  }

  /**
   * Show what was drawn: each pixel rounded to off, dim, mid or full, as dots.
   * Unchanged frames aren't sent to the GPU again.
   */
  present(): void {
    const src = this.ctx.getImageData(0, 0, DMD_W, DMD_H).data;
    let sig = "";
    const levels = this.levels;
    for (let i = 0; i < DMD_W * DMD_H; i++) {
      const v = Math.max(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
      levels[i] = v < 40 ? 0 : v < 110 ? 1 : v < 190 ? 2 : 3;
    }
    // a cheap signature: skip the upload when nothing changed
    for (let i = 0; i < levels.length; i += 7) sig += levels[i];
    sig += levels.reduce((a, b, i) => (a + b * (i % 251)) | 0, 0);
    if (sig === this.last) return;
    this.last = sig;
    const d = this.img.data;
    const W = DMD_W * DOT;
    const [r, g, b] = this.rgb;
    const k = [0.07, 0.38, 0.68, 1];
    for (let y = 0; y < DMD_H; y++)
      for (let x = 0; x < DMD_W; x++) {
        const f = k[levels[y * DMD_W + x]];
        for (let dy = 0; dy < DOT; dy++)
          for (let dx = 0; dx < DOT; dx++) {
            // a round dot: the cell's corners dark
            const edge = (dx === 0 || dx === DOT - 1) && (dy === 0 || dy === DOT - 1);
            const gap = dx === DOT - 1 || dy === DOT - 1;
            const m = edge ? 0 : gap ? 0.25 : 1;
            const o = ((y * DOT + dy) * W + x * DOT + dx) * 4;
            d[o] = r * f * m;
            d[o + 1] = g * f * m;
            d[o + 2] = b * f * m;
            d[o + 3] = 255;
          }
      }
    this.bigCtx.putImageData(this.img, 0, 0);
    this.tex.update(true);
  }

  dispose(): void {
    this.tex.dispose();
  }
}
