// Real 3D lettering and logos. Text and artwork are drawn on a hidden canvas,
// their outlines traced (marching squares) and extruded into channel letters:
// a glowing face, dark metal returns and back. Used for the ChimpVibe sign and
// small neon words.

import { Matrix } from "@babylonjs/core";
import { P2, ensureCCW, pointInPolygon } from "../geometry/curves";
import { Geo, box, cylinder, polygonFace, sphere, wallStrip, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { makeCanvas, toTexture } from "../materials/canvas";

/** A filled region: its outline and any holes, in metres (x right, y up). */
export interface Shape {
  outer: P2[];
  holes: P2[][];
}

/** Signed area of a closed outline (x, z), positive counter-clockwise. */
function area(l: P2[]): number {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const p = l[i];
    const q = l[(i + 1) % l.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Ramer-Douglas-Peucker simplification of an open polyline. */
function rdp(pts: P2[], eps: number): P2[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1e-9;
  let best = -1;
  let bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * dz - (pts[i].z - a.z) * dx) / l;
    if (d > best) {
      best = d;
      bi = i;
    }
  }
  if (best <= eps) return [a, b];
  return [...rdp(pts.slice(0, bi + 1), eps).slice(0, -1), ...rdp(pts.slice(bi), eps)];
}

/**
 * Outlines of the filled parts of a canvas (alpha over one half), traced with
 * marching squares and simplified. Coordinates are metres with `px` metres per
 * pixel, the origin at the canvas centre, x right and y up (returned in P2's z).
 */
export function traceCanvas(canvas: HTMLCanvasElement, px: number, simplifyPx = 0.45): Shape[] {
  const W = canvas.width;
  const H = canvas.height;
  const data = canvas.getContext("2d")!.getImageData(0, 0, W, H).data;
  const v = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3] / 255);
  const T = 0.5;
  const pts = new Map<string, P2>();
  const adj = new Map<string, string[]>();
  const pt = (key: string, x: number, y: number) => {
    if (!pts.has(key)) pts.set(key, { x, z: y });
    return key;
  };
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  };
  const f = (a: number, b: number) => (T - a) / (b - a);
  for (let y = -1; y < H; y++)
    for (let x = -1; x < W; x++) {
      const tl = v(x, y);
      const tr = v(x + 1, y);
      const br = v(x + 1, y + 1);
      const bl = v(x, y + 1);
      const idx = (tl > T ? 8 : 0) | (tr > T ? 4 : 0) | (br > T ? 2 : 0) | (bl > T ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top = () => pt(`h${x},${y}`, x + f(tl, tr), y);
      const right = () => pt(`v${x + 1},${y}`, x + 1, y + f(tr, br));
      const bottom = () => pt(`h${x},${y + 1}`, x + f(bl, br), y + 1);
      const left = () => pt(`v${x},${y}`, x, y + f(tl, bl));
      const centre = (tl + tr + br + bl) / 4 > T;
      switch (idx) {
        case 1:
        case 14:
          link(left(), bottom());
          break;
        case 2:
        case 13:
          link(bottom(), right());
          break;
        case 3:
        case 12:
          link(left(), right());
          break;
        case 4:
        case 11:
          link(top(), right());
          break;
        case 6:
        case 9:
          link(top(), bottom());
          break;
        case 7:
        case 8:
          link(left(), top());
          break;
        case 5:
          if (centre) {
            link(left(), top());
            link(bottom(), right());
          } else {
            link(left(), bottom());
            link(top(), right());
          }
          break;
        case 10:
          if (centre) {
            link(top(), right());
            link(left(), bottom());
          } else {
            link(left(), top());
            link(bottom(), right());
          }
          break;
      }
    }
  // walk the loops
  const seen = new Set<string>();
  const loops: P2[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: P2[] = [];
    let prev = "";
    let cur = start;
    for (let guard = 0; guard < 1e6; guard++) {
      seen.add(cur);
      loop.push(pts.get(cur)!);
      const nb = adj.get(cur)!;
      const next = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = next;
      if (!cur || cur === start) break;
    }
    if (loop.length < 4) continue;
    // simplify as a closed loop: split at the point farthest from the first
    let far = 0;
    let fd = -1;
    for (let i = 0; i < loop.length; i++) {
      const d = Math.hypot(loop[i].x - loop[0].x, loop[i].z - loop[0].z);
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    const s1 = rdp(loop.slice(0, far + 1), simplifyPx);
    const s2 = rdp([...loop.slice(far), loop[0]], simplifyPx);
    const simple = [...s1.slice(0, -1), ...s2.slice(0, -1)];
    if (simple.length < 3) continue;
    loops.push(simple.map((p) => ({ x: (p.x - W / 2) * px, z: (H / 2 - p.z) * px })));
  }
  // nesting: loops inside an even number of others are outlines, odd ones are holes
  const info = loops.map((l) => ({ l, a: Math.abs(area(l)), depth: 0, parent: -1 }));
  info.forEach((o, i) => {
    let best = -1;
    info.forEach((p, j) => {
      if (i === j || p.a <= o.a || !pointInPolygon(o.l[0], p.l)) return;
      o.depth++;
      if (best < 0 || p.a < info[best].a) best = j;
    });
    o.parent = best;
  });
  const shapes = new Map<number, Shape>();
  info.forEach((o, i) => {
    if (o.depth % 2 === 0) shapes.set(i, { outer: ensureCCW(o.l), holes: [] });
  });
  info.forEach((o) => {
    if (o.depth % 2 === 1 && shapes.has(o.parent)) shapes.get(o.parent)!.holes.push([...ensureCCW(o.l)].reverse());
  });
  return [...shapes.values()];
}

/** Maps plan geometry (x, z, extruded up y) to wall geometry (x right, y up, extruded toward -Z). */
const TO_WALL = Matrix.FromValues(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

/**
 * Extrude shapes into solid letters standing on a wall: the face at z = -depth
 * (toward the viewer), the back at z = 0. Returns the face and the returns + back separately.
 */
export function extrude(shapes: Shape[], depth: number): { face: Geo; body: Geo } {
  const face = new Geo();
  const body = new Geo();
  for (const s of shapes) {
    face.add(polygonFace(s.outer, depth, true, s.holes), TO_WALL);
    body.add(polygonFace(s.outer, 0, false, s.holes), TO_WALL);
    body.add(wallStrip(s.outer, 0, depth, true), TO_WALL);
    for (const h of s.holes) body.add(wallStrip(h, 0, depth, true), TO_WALL);
  }
  return { face, body };
}

/** Glowing material for letter faces, and the dark metal for their returns. */
function letterMats(ctx: WorldCtx, key: string, color: string, intensity: number) {
  if (!ctx.mats.has(key)) {
    ctx.mats.unlit(key, { color, intensity });
    ctx.mats.glowing.add(key);
  }
  if (!ctx.mats.has("letterReturn")) ctx.mats.pbr("letterReturn", { color: "#2c2621", rough: 0.4, metal: 0.6 });
}

/** Canvas holding `text` in `font`, tightly sized, white on transparent, with its metrics. */
function textCanvas(text: string, font: string, pad = 12) {
  const probe = makeCanvas(8, 8).ctx;
  probe.font = font;
  const mt = probe.measureText(text);
  const asc = Math.ceil(mt.actualBoundingBoxAscent);
  const desc = Math.ceil(mt.actualBoundingBoxDescent);
  const left = Math.ceil(mt.actualBoundingBoxLeft);
  const W = Math.ceil(left + mt.actualBoundingBoxRight) + pad * 2;
  const H = asc + desc + pad * 2;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  const ox = pad + left;
  const baseline = pad + asc;
  ctx.fillText(text, ox, baseline);
  return { canvas, ctx, W, H, ox, baseline, measure: (s: string) => probe.measureText(s).width, probe };
}

/**
 * A word in 3D channel letters, centred at m (on the wall, facing -Z), `height`
 * metres tall from descender to ascender. Each "i" loses its dot; the centres
 * of where the dots were are returned (local metres) so they can be replaced.
 */
export function word3d(ctx: WorldCtx, z: Zone, m: Matrix, text: string, o: { font: string; height: number; depth: number; mat: string; color: string; intensity?: number; dotlessI?: boolean; label: string }): { width: number; dots: P2[] } {
  letterMats(ctx, o.mat, o.color, o.intensity ?? 1.5);
  const tc = textCanvas(text, o.font);
  const dots: P2[] = [];
  if (o.dotlessI) {
    const xh = tc.probe.measureText("x").actualBoundingBoxAscent;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "i") continue;
      const x0 = tc.ox + tc.measure(text.slice(0, i));
      const x1 = tc.ox + tc.measure(text.slice(0, i + 1));
      tc.ctx.clearRect(x0 - 2, 0, x1 - x0 + 4, tc.baseline - xh - 3);
      dots.push({ x: (x0 + x1) / 2, z: tc.baseline - xh * 1.34 });
    }
  }
  const px = o.height / tc.H;
  const shapes = traceCanvas(tc.canvas, px);
  const { face, body } = extrude(shapes, o.depth);
  ctx.g(z, o.mat, { castShadow: false }).add(face, m, o.label);
  ctx.g(z, "letterReturn").add(body, m, o.label);
  return { width: tc.W * px, dots: dots.map((d) => ({ x: (d.x - tc.W / 2) * px, z: (tc.H / 2 - d.z) * px })) };
}

/** Small apple, the dot over an "i" on the sign: a glowing body with a stalk and a leaf. Centre at m. */
function appleDot(ctx: WorldCtx, z: Zone, m: Matrix, r: number, mat: string) {
  ctx.g(z, mat, { castShadow: false }).add(sphere(r, 14, 10, 0.9), xf(0, 0, -r).multiply(m), "Apple");
  ctx.g(z, mat, { castShadow: false }).add(cylinder(r * 0.12, r * 0.55, 6), xf(0, r * 0.75, -r).multiply(m), "Apple");
  ctx.g(z, mat, { castShadow: false }).add(box(r * 0.55, r * 0.16, r * 0.3), xf(r * 0.35, r * 1.05, -r, 0, 1, 1, 1, 0, -0.5).multiply(m), "Apple");
}

/** The ChimpVibe tree, as drawn for tracing: canvases for the tree and the chimp, and where the apples hang (pixels). */
export interface TreeArt {
  W: number;
  H: number;
  tree: HTMLCanvasElement;
  chimp: HTMLCanvasElement;
  apples: { x: number; y: number; r: number }[];
}

/**
 * The ChimpVibe logo tree: a thick trunk on flared roots splitting into
 * curving, tapering limbs that spread into a broad dome, apples hanging from
 * the twig ends, and a chimp sitting on the low left limb (drawn separately,
 * with a thin gap cut round it in the tree).
 */
export function chimpVibeTreeArt(treeSeed = 11): TreeArt {
  const W = 800;
  const H = 720;
  const { canvas: tree, ctx: g } = makeCanvas(W, H);
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineCap = "round";
  g.lineJoin = "round";
  let seed = treeSeed;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // crown envelope: a dome wider than tall
  const C = { x: W / 2, y: 318 };
  const RX = 372;
  const RY = 290;
  const crown = (x: number, y: number) => ((x - C.x) / RX) ** 2 + ((y - C.y) / RY) ** 2;
  const inCrown = (x: number, y: number) => crown(x, y) < 1 && y < C.y + 120;
  // tapered limb along a quadratic curve, rounded at its tip
  const limb = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w0: number, w1: number) => {
    const n = 16;
    const L: [number, number][] = [];
    const R: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
      const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      const dx = 2 * u * (cx - x0) + 2 * t * (x1 - cx);
      const dy = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
      const l = Math.hypot(dx, dy) || 1;
      const w = (w0 + (w1 - w0) * Math.pow(t, 0.8)) / 2;
      L.push([x - (dy / l) * w, y + (dx / l) * w]);
      R.push([x + (dy / l) * w, y - (dx / l) * w]);
    }
    g.beginPath();
    g.moveTo(L[0][0], L[0][1]);
    for (const p of L.slice(1)) g.lineTo(p[0], p[1]);
    for (const p of R.reverse()) g.lineTo(p[0], p[1]);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(x1, y1, w1 / 2, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(x0, y0, w0 / 2, 0, Math.PI * 2);
    g.fill();
  };
  const tips: { x: number; y: number }[] = [];
  const spurs: { x: number; y: number }[] = [];
  // a branch from (x, y) heading `a`, forking until it reaches the edge of the crown
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    let l = len;
    let ex = x + Math.cos(a) * l;
    let ey = y + Math.sin(a) * l;
    for (let k = 0; k < 10 && !inCrown(ex, ey); k++) {
      l *= 0.82;
      ex = x + Math.cos(a) * l;
      ey = y + Math.sin(a) * l;
    }
    const bend = (rnd() - 0.5) * 0.45 * l;
    const cx = (x + ex) / 2 - Math.sin(a) * bend;
    const cy = (y + ey) / 2 + Math.cos(a) * bend;
    const w1 = Math.max(4.5, w * 0.68);
    limb(x, y, cx, cy, ex, ey, w, w1);
    // now and then a short fruiting twig off the side of a mid-sized limb
    if (w < 26 && w > 7 && rnd() < 0.55) {
      const t = 0.45 + rnd() * 0.3;
      const u = 1 - t;
      const px = u * u * x + 2 * u * t * cx + t * t * ex;
      const py = u * u * y + 2 * u * t * cy + t * t * ey;
      const sa = a + (rnd() < 0.5 ? 1 : -1) * (0.9 + rnd() * 0.4);
      const sl = 26 + rnd() * 22;
      const qx = px + Math.cos(sa) * sl;
      const qy = py + Math.sin(sa) * sl;
      if (inCrown(qx, qy)) {
        limb(px, py, (px + qx) / 2, (py + qy) / 2 - 4, qx, qy, 6, 4.5);
        spurs.push({ x: qx, y: qy });
      }
    }
    const out = crown(ex, ey) > 0.8;
    if (depth === 0 || out || l < 20) {
      tips.push({ x: ex, y: ey });
      return;
    }
    // children leave along the end tangent, spreading either side and leaning outward and up
    const ta = Math.atan2(ey - cy, ex - cx);
    const outward = Math.atan2(ey - (C.y + 160), ex - C.x);
    const base = ta + Math.atan2(Math.sin(outward - ta), Math.cos(outward - ta)) * 0.25;
    const spread = 0.32 + rnd() * 0.22;
    const kids = rnd() < 0.35 ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      const f = kids === 2 ? (k ? 1 : -1) : k - 1;
      const main = f === 0 || (kids === 2 && k === (rnd() < 0.5 ? 0 : 1));
      branch(ex, ey, base + f * spread + (rnd() - 0.5) * 0.15, len * (0.66 + rnd() * 0.14), w1 * (main ? 0.84 : 0.68), depth - 1);
    }
  };
  // trunk: flared roots, a gentle S, the fork at F
  const F = { x: W / 2 - 6, y: 452 };
  const ground = H - 18;
  g.beginPath();
  g.moveTo(W / 2 - 150, ground);
  g.bezierCurveTo(W / 2 - 90, ground - 8, W / 2 - 58, ground - 40, W / 2 - 50, ground - 110);
  g.bezierCurveTo(W / 2 - 44, ground - 170, W / 2 - 60, F.y + 60, F.x - 46, F.y);
  g.lineTo(F.x + 46, F.y - 6);
  g.bezierCurveTo(W / 2 + 34, F.y + 60, W / 2 + 46, ground - 160, W / 2 + 54, ground - 104);
  g.bezierCurveTo(W / 2 + 60, ground - 40, W / 2 + 96, ground - 10, W / 2 + 156, ground);
  g.quadraticCurveTo(W / 2 + 40, ground - 26, W / 2 + 4, ground - 10);
  g.quadraticCurveTo(W / 2 - 40, ground - 26, W / 2 - 150, ground);
  g.fill();
  // main limbs from the fork
  const mains: [number, number, number][] = [
    [-172, 250, 44], // low left, where the chimp sits
    [-142, 230, 46],
    [-112, 200, 50],
    [-80, 190, 50],
    [-48, 220, 46],
    [-12, 250, 42], // low right
  ];
  for (const [deg, len, w] of mains) branch(F.x, F.y, (deg * Math.PI) / 180, len * 0.9, w, 7);

  // the chimp, sitting on the low-left limb and facing the trunk
  const { canvas: chimp, ctx: c } = makeCanvas(W, H);
  const la = (-172 * Math.PI) / 180;
  const sx = F.x + Math.cos(la) * 150;
  const sy = F.y + Math.sin(la) * 150 - 20;
  c.fillStyle = "#fff";
  c.strokeStyle = "#fff";
  c.lineCap = "round";
  c.translate(sx, sy);
  c.scale(1.2, 1.2);
  const ell = (x: number, y: number, rx: number, ry: number, rot = 0) => {
    c.beginPath();
    c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    c.fill();
  };
  const stroke = (pts: [number, number][], w: number) => {
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) c.lineTo(p[0], p[1]);
    c.stroke();
  };
  ell(-8, -48, 22, 33, -0.3); // body, hunched forward
  ell(-16, -16, 20, 15); // rump on the branch
  ell(12, -88, 14, 14); // head
  ell(21, -96, 9, 5, 0.1); // brow
  ell(26, -82, 10, 8, 0.25); // muzzle
  ell(2, -90, 5, 6); // ear
  stroke([[4, -68], [20, -44], [26, -10]], 10); // long arm reaching down to the branch
  ell(27, -7, 7, 5); // hand
  stroke([[-10, -24], [20, -38]], 16); // thigh
  stroke([[20, -38], [17, -7]], 11); // shin
  ell(20, -4, 12, 5); // foot
  // cut a thin gap round the chimp in the tree
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.drawImage(chimp, Math.cos(a) * 6, Math.sin(a) * 6);
  }
  g.globalCompositeOperation = "source-over";

  // apples hanging from well-spread twig ends, mostly round the outside of the crown
  const apples: TreeArt["apples"] = [];
  const order = [...tips.map((t) => ({ t, k: crown(t.x, t.y) + rnd() * 0.5 })), ...spurs.map((t) => ({ t, k: 0.7 + rnd() * 0.5 }))].sort((a, b) => b.k - a.k);
  for (const { t } of order) {
    if (apples.length >= 34) break;
    const r = 13;
    const ax = t.x + (rnd() - 0.5) * 6;
    const ay = t.y + r + 9;
    if (Math.abs(ax - sx) < 70 && Math.abs(ay - sy + 40) < 70) continue;
    if (apples.some((p) => Math.hypot(p.x - ax, p.y - ay) < 40)) continue;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(t.x, t.y);
    g.lineTo(ax, ay - r + 1);
    g.stroke();
    apples.push({ x: ax, y: ay, r });
  }
  return { W, H, tree, chimp, apples };
}

// ------------------------------------------------------------------ the ChimpVibe mark

let markImage: HTMLImageElement | null = null;

/**
 * Load the ChimpVibe brand mark (public/brand/chimpvibe-mark.svg, the logo's
 * vector file) so the sign can trace the real artwork. Call before building;
 * if it fails the sign falls back to a drawn tree.
 */
export async function loadChimpVibeMark(): Promise<void> {
  try {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}brand/chimpvibe-mark.svg`;
    await img.decode();
    markImage = img;
  } catch {
    markImage = null;
  }
}

/** The mark's colours: background, tree (mint), highlighted apples (pale). */
const MARK = { bg: [10, 13, 18], tree: [120, 213, 168], apple: [199, 251, 225] } as const;

/**
 * The brand mark split into masks for tracing: the tree (with the chimp, cut
 * out of it by a thin gap, and the mint apples) and the pale apples, cropped
 * to the artwork. `chimp` is where the chimp sits, in mask pixels.
 */
function markArt(): { W: number; H: number; tree: HTMLCanvasElement; apples: HTMLCanvasElement; chimp: P2 } | null {
  if (!markImage) return null;
  const N = 1800;
  const { canvas: src, ctx: g } = makeCanvas(N, N);
  g.drawImage(markImage, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data;
  // each pixel goes to the nearest of the mark's colours (the edges are blended)
  const cls = new Uint8Array(N * N);
  let x0 = N;
  let y0 = N;
  let x1 = 0;
  let y1 = 0;
  const d2 = (i: number, c: readonly number[]) => (px[i] - c[0]) ** 2 + (px[i + 1] - c[1]) ** 2 + (px[i + 2] - c[2]) ** 2;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const b = d2(i, MARK.bg);
      const t = d2(i, MARK.tree);
      const a = d2(i, MARK.apple);
      const k = b <= t && b <= a ? 0 : t <= a ? 1 : 2;
      cls[y * N + x] = k;
      if (k) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  if (x1 <= x0) return null;
  const pad = 8;
  const W = x1 - x0 + 1 + pad * 2;
  const H = y1 - y0 + 1 + pad * 2;
  const mask = (k: number) => {
    const { canvas, ctx } = makeCanvas(W, H);
    const im = ctx.createImageData(W, H);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (cls[y * N + x] !== k) continue;
        const o = ((y - y0 + pad) * W + (x - x0 + pad)) * 4;
        im.data[o] = im.data[o + 1] = im.data[o + 2] = im.data[o + 3] = 255;
      }
    ctx.putImageData(im, 0, 0);
    return canvas;
  };
  void src;
  // the chimp sits on the low left limb, about here in the full mark (fractions of its size)
  const chimp = { x: 0.365 * N - x0 + pad, z: 0.56 * N - y0 + pad };
  return { W, H, tree: mask(1), apples: mask(2), chimp };
}

/**
 * The ChimpVibe sign as it appears in the concept art: a dark timber plank
 * board with warm light along its edges, "chimp" in warm white 3D channel
 * letters, the glowing mint ChimpVibe tree (with the chimp sitting in it and
 * pale apples hanging from its twigs), and "vibe" in mint; apples dot the i's, and a soft halo glows on the boards
 * behind the letters. m: centre of the board's back, on the wall, facing -Z.
 */
export function chimpVibeSign(ctx: WorldCtx, z: Zone, m: Matrix, w: number, h: number): void {
  const label = "ChimpVibe sign";
  // board: dark planks with shadow gaps on a black backing, warm strips top and bottom
  const D = 0.05;
  ctx.g(z, "black").add(box(w, h, 0.02), xf(0, 0, -0.01).multiply(m), label);
  const planks = new Geo();
  const n = 5;
  const ph = (h - 0.02) / n;
  for (let i = 0; i < n; i++) planks.add(box(w, ph - 0.012, D - 0.02), xf(0, -h / 2 + 0.01 + ph * (i + 0.5), -0.02 - (D - 0.02) / 2 + (i % 2 ? 0.002 : 0)));
  ctx.g(z, "timberDark").add(planks, m, label);
  for (const s of [-1, 1]) ctx.g(z, "amberStrip", { castShadow: false }).add(box(w - 0.06, 0.02, 0.02), xf(0, s * (h / 2 - 0.03), -D - 0.012).multiply(m), "Sign light");
  const front = -D;

  // layout across the board: "chimp", the tree, "vibe"
  const font = "800 200px Nunito";
  const letterH = h * 0.5;
  const depth = 0.06;
  const stand = 0.03;
  const at = (x: number, y: number) => xf(x, y, front - stand).multiply(m);
  const chimpProbe = textCanvas("chimp", font);
  const vibeProbe = textCanvas("vibe", font);
  const pxPer = letterH / chimpProbe.H;
  const wChimp = chimpProbe.W * pxPer;
  const wVibe = vibeProbe.W * pxPer;
  const treeH = h * 0.97;
  const mark = markArt();
  const art = mark ?? chimpVibeTreeArt();
  const wTree = (treeH * art.W) / art.H;
  const gap = 0.11;
  const total = wChimp + wTree + wVibe + gap * 2;
  const k = Math.min(1, (w * 0.92) / total);
  const x0 = -(total * k) / 2;
  const cxChimp = x0 + (wChimp * k) / 2;
  const cxTree = x0 + (wChimp + gap + wTree / 2) * k;
  const cxVibe = x0 + (wChimp + gap * 2 + wTree + wVibe / 2) * k;
  const yWords = -h * 0.08;

  const chimp = word3d(ctx, z, at(cxChimp, yWords), "chimp", { font, height: letterH * k, depth, mat: "signWarm", color: "#ffe9c9", intensity: 1.7, dotlessI: true, label });
  for (const d of chimp.dots) appleDot(ctx, z, at(cxChimp + d.x, yWords + d.z), 0.05 * k, "signWarm");
  const vibe = word3d(ctx, z, at(cxVibe, yWords), "vibe", { font, height: letterH * k, depth, mat: "signMint", color: "#6ff0bf", intensity: 1.7, dotlessI: true, label });
  for (const d of vibe.dots) appleDot(ctx, z, at(cxVibe + d.x, yWords + d.z), 0.05 * k, "signMint");
  // the tree, the chimp sitting in it (standing a little proud), and the pale apples
  const tpx = (treeH * k) / art.H;
  const treeM = at(cxTree, 0);
  // the tree glows a little softer than the words so its branches stay distinct
  if (!ctx.mats.has("signTree")) {
    ctx.mats.unlit("signTree", { color: "#6ff0bf", intensity: 1.15 });
    ctx.mats.glowing.add("signTree");
  }
  if (!ctx.mats.has("signApple")) {
    ctx.mats.unlit("signApple", { color: "#d2f8e2", intensity: 1.35 });
    ctx.mats.glowing.add("signApple");
  }
  const put = (shapes: Shape[], d: number, mat: string, lbl: string) => {
    const e = extrude(shapes, d);
    ctx.g(z, mat, { castShadow: false }).add(e.face, treeM, lbl);
    ctx.g(z, "letterReturn").add(e.body, treeM, lbl);
  };
  if (mark) {
    // traced from the brand mark itself
    const shapes = traceCanvas(mark.tree, tpx, 0.5);
    const cx = (mark.chimp.x - mark.W / 2) * tpx;
    const cy = (mark.H / 2 - mark.chimp.z) * tpx;
    const total = shapes.reduce((sum, sh) => sum + Math.abs(area(sh.outer)), 0);
    const isChimp = (sh: Shape) => Math.abs(area(sh.outer)) < total * 0.05 && pointInPolygon({ x: cx, z: cy }, sh.outer);
    put(shapes.filter((sh) => !isChimp(sh)), depth * 0.8, "signTree", label);
    put(shapes.filter(isChimp), depth * 1.1, "signTree", "Chimp in the tree");
    put(traceCanvas(mark.apples, tpx, 0.5), depth * 1.0, "signApple", "Apple");
  } else {
    const fallback = art as TreeArt;
    put(traceCanvas(fallback.tree, tpx, 0.6), depth * 0.8, "signTree", label);
    put(traceCanvas(fallback.chimp, tpx, 0.5), depth * 1.1, "signTree", "Chimp in the tree");
    for (const ap of fallback.apples) {
      const x = (ap.x - fallback.W / 2) * tpx;
      const y = (fallback.H / 2 - ap.y) * tpx;
      const r = ap.r * tpx * 1.05;
      ctx.g(z, "signApple", { castShadow: false }).add(sphere(r, 14, 10, 0.92), xf(x, y, -depth * 0.8 - r * 0.2).multiply(treeM), "Apple");
    }
  }

  // soft halo on the boards behind the letters and the tree
  const key = "chimpvibeHalo";
  if (!ctx.mats.has(key)) {
    const HW = 1024;
    const HH = Math.round((HW * h) / w);
    const hc = makeCanvas(HW, HH);
    const g = hc.ctx;
    const toPx = (x: number, y: number): [number, number] => [((x + w / 2) / w) * HW, ((h / 2 - y) / h) * HH];
    g.filter = "blur(22px)";
    const blob = (x: number, y: number, bw: number, bh: number, col: string) => {
      const [px, py] = toPx(x, y);
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(px, py, ((bw / 2) * HW) / w, ((bh / 2) * HH) / h, 0, 0, Math.PI * 2);
      g.fill();
    };
    blob(cxChimp, yWords, wChimp * k * 1.02, letterH * k * 0.8, "rgba(255,190,120,0.55)");
    blob(cxTree, -h * 0.02, wTree * k * 0.95, treeH * k * 0.9, "rgba(90,240,180,0.5)");
    blob(cxVibe, yWords, wVibe * k * 1.02, letterH * k * 0.8, "rgba(90,240,180,0.5)");
    ctx.mats.unlit(key, { tex: toTexture(ctx.scene, key, hc.canvas, { wrap: false, hasAlpha: true }), alpha: 1, intensity: 1.0 });
  }
  const halo = new Geo();
  const a = halo.vert(-w / 2, -h / 2, 0, 0, 0, 0, 0, -1);
  const b = halo.vert(w / 2, -h / 2, 0, 1, 0, 0, 0, -1);
  const c = halo.vert(w / 2, h / 2, 0, 1, 1, 0, 0, -1);
  const d = halo.vert(-w / 2, h / 2, 0, 0, 1, 0, 0, -1);
  // facing -Z, into the room
  halo.tri(a, b, c);
  halo.tri(a, c, d);
  ctx.g(z, key, { castShadow: false, pickable: false }).add(halo, xf(0, 0, front - 0.004).multiply(m), label);
}

/** Width in metres of a neon word `height` metres tall (as neonWord would build it). */
export function neonWordWidth(text: string, height: number, font = "800 200px Nunito"): number {
  const tc = textCanvas(text, font);
  return (tc.W * height) / tc.H;
}

/**
 * Neon word in 3D channel letters with a glowing face (e.g. "GAME ON"), centred
 * at m on a wall facing -Z, `height` metres tall.
 */
export function neonWord(ctx: WorldCtx, z: Zone, m: Matrix, text: string, height: number, color: string, key: string, font = "800 200px Nunito"): number {
  return word3d(ctx, z, xf(0, 0, -0.03).multiply(m), text, { font, height, depth: 0.04, mat: key, color, intensity: 1.9, label: `Neon sign: ${text}` }).width;
}

