import { DynamicTexture, Scene, Texture } from "@babylonjs/core";

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h = w): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return { canvas, ctx };
}

export function toTexture(
  scene: Scene,
  name: string,
  canvas: HTMLCanvasElement,
  opts: { wrap?: boolean; linear?: boolean; mipmaps?: boolean; aniso?: number; hasAlpha?: boolean } = {},
): Texture {
  const { wrap = true, linear = false, mipmaps = true, aniso = 8, hasAlpha = false } = opts;
  const tex = new DynamicTexture(name, canvas, scene, mipmaps, Texture.TRILINEAR_SAMPLINGMODE);
  tex.update(true);
  tex.wrapU = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = aniso;
  tex.hasAlpha = hasAlpha;
  if (linear) tex.gammaSpace = false;
  return tex;
}

/** Pixel-level painter: fn(x, y) -> [r, g, b, a] in 0..255. */
export function paintPixels(ctx: Ctx, w: number, h: number, fn: (x: number, y: number) => [number, number, number, number?]): void {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = c[3] ?? 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Normal map canvas from a height field (wrapping), strength ~ 1..8. */
export function normalFromHeight(height: Float32Array, w: number, h: number, strength = 3): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const H = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy; // OpenGL-style green: Babylon flips via invertNormalMapY if needed
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Height field from a canvas' luminance. */
export function heightFromCanvas(ctx: Ctx, w: number, h: number): Float32Array {
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  return out;
}

export function hex(c: string): [number, number, number] {
  const v = parseInt(c.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Wait for webfonts so canvas text uses them. */
export async function fontsReady(families: string[]): Promise<void> {
  try {
    await Promise.all(families.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  } catch {
    /* fall back to system fonts */
  }
}
