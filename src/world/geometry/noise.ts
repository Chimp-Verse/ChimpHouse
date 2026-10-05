// Small deterministic value/gradient noise used by textures, terrain and organic meshes.

const PERM = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

const G2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
];

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 2D Perlin noise in roughly [-1, 1]. */
export function perlin2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X = xi & 255;
  const Y = yi & 255;
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const h = PERM[ix + PERM[iy]] & 7;
    return G2[h][0] * dx + G2[h][1] * dy;
  };
  const u = fade(xf);
  const v = fade(yf);
  const n00 = g(X, Y, xf, yf);
  const n10 = g(X + 1, Y, xf - 1, yf);
  const n01 = g(X, Y + 1, xf, yf - 1);
  const n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return (nx0 + v * (nx1 - nx0)) * 1.2;
}

/** Tileable 2D Perlin noise with integer period. */
export function perlin2Tile(x: number, y: number, px: number, py: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (v: number, p: number) => (((v % p) + p) % p) & 255;
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const h = PERM[wrap(ix, px) + PERM[wrap(iy, py)]] & 7;
    return G2[h][0] * dx + G2[h][1] * dy;
  };
  const u = fade(xf);
  const v = fade(yf);
  const n00 = g(xi, yi, xf, yf);
  const n10 = g(xi + 1, yi, xf - 1, yf);
  const n01 = g(xi, yi + 1, xf, yf - 1);
  const n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return (nx0 + v * (nx1 - nx0)) * 1.2;
}

export function fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let a = 1;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += perlin2(x * f, y * f) * a;
    norm += a;
    a *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/** Tileable fBm over a unit square sampled at (u, v) in [0,1). */
export function fbmTile(u: number, v: number, basePeriod: number, octaves = 4, gain = 0.5): number {
  let a = 1;
  let p = basePeriod;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += perlin2Tile(u * p, v * p, p, p) * a;
    norm += a;
    a *= gain;
    p *= 2;
  }
  return sum / norm;
}

/** Ridged multifractal, useful for mountain crests. */
export function ridged2(x: number, y: number, octaves = 5): number {
  let a = 0.5;
  let f = 1;
  let sum = 0;
  let prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(perlin2(x * f, y * f));
    n *= n;
    sum += n * a * prev;
    prev = n;
    a *= 0.5;
    f *= 2.03;
  }
  return sum;
}

/** Cheap hash in [0,1). */
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
