// Extract flat screen textures from the reference renders with a 4-point
// homography (see tools/screens.json). Output: public/textures/screens/<id>.png
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const cfg = JSON.parse(await readFile("tools/screens.json", "utf8"));
const outDir = path.resolve("public/textures/screens");
await mkdir(outDir, { recursive: true });

/** Homography mapping unit square (u,v) -> quad. */
function squareToQuad([p0, p1, p2, p3]) {
  const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

const cache = new Map();
async function load(src) {
  if (!cache.has(src)) {
    const img = sharp(path.resolve("Reference Images", src)).removeAlpha().raw();
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    cache.set(src, { data, w: info.width, h: info.height });
  }
  return cache.get(src);
}

for (const s of cfg.screens) {
  const { data, w, h } = await load(s.src);
  const [W, H] = s.size;
  const map = squareToQuad(s.quad);
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [sx, sy] = map((x + 0.5) / W, (y + 0.5) / H);
      const fx = Math.min(w - 1.001, Math.max(0, sx - 0.5));
      const fy = Math.min(h - 1.001, Math.max(0, sy - 0.5));
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      for (let c = 0; c < 3; c++) {
        const p00 = data[(iy * w + ix) * 3 + c];
        const p10 = data[(iy * w + ix + 1) * 3 + c];
        const p01 = data[((iy + 1) * w + ix) * 3 + c];
        const p11 = data[((iy + 1) * w + ix + 1) * 3 + c];
        out[(y * W + x) * 3 + c] = (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
      }
    }
  }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).sharpen({ sigma: 0.8 }).png().toFile(path.join(outDir, `${s.id}.png`));
  console.log(`extracted ${s.id} (${W}x${H})`);
}
