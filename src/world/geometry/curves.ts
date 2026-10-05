// 2D plan curves (x = east, z = north). Closed footprints are counter-clockwise
// when viewed from above, so the right-hand side of travel is the outside.

export type P2 = { x: number; z: number };

export const p2 = (x: number, z: number): P2 => ({ x, z });

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist2(a: P2, b: P2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Points on a circular arc, angles in radians from +x toward +z, inclusive of both ends. */
export function arc(cx: number, cz: number, r: number, a0: number, a1: number, segments?: number): P2[] {
  const n = segments ?? Math.max(4, Math.ceil((Math.abs(a1 - a0) * r) / 0.4));
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n);
    pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return pts;
}

/** Points on an elliptical arc. */
export function ellipseArc(cx: number, cz: number, rx: number, rz: number, a0: number, a1: number, segments = 48): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = lerp(a0, a1, i / segments);
    pts.push({ x: cx + Math.cos(a) * rx, z: cz + Math.sin(a) * rz });
  }
  return pts;
}

/**
 * Closed counter-clockwise rounded rectangle. Radii are given for the
 * south-west, south-east, north-east and north-west corners.
 */
export function roundedRect(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  radii: [number, number, number, number],
  step = 0.35,
): P2[] {
  const [rSW, rSE, rNE, rNW] = radii;
  const pts: P2[] = [];
  const corner = (cx: number, cz: number, r: number, a0: number) => {
    const n = Math.max(2, Math.ceil(((Math.PI / 2) * r) / step));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (Math.PI / 2) * (i / n);
      pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
    }
  };
  // SW corner: from 180° to 270°
  if (rSW > 1e-3) corner(x0 + rSW, z0 + rSW, rSW, Math.PI);
  else pts.push({ x: x0, z: z0 });
  if (rSE > 1e-3) corner(x1 - rSE, z0 + rSE, rSE, -Math.PI / 2);
  else pts.push({ x: x1, z: z0 });
  if (rNE > 1e-3) corner(x1 - rNE, z1 - rNE, rNE, 0);
  else pts.push({ x: x1, z: z1 });
  if (rNW > 1e-3) corner(x0 + rNW, z1 - rNW, rNW, Math.PI / 2);
  else pts.push({ x: x0, z: z1 });
  return dedupe(pts, true);
}

export function dedupe(pts: P2[], closed: boolean, eps = 1e-4): P2[] {
  const out: P2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > eps || Math.abs(last.z - p.z) > eps) out.push(p);
  }
  if (closed && out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < eps && Math.abs(a.z - b.z) < eps) out.pop();
  }
  return out;
}

export function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function ensureCCW(pts: P2[]): P2[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts;
}

export function pointInPolygon(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function pathLength(pts: P2[], closed = false): number {
  let len = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) len += dist2(pts[i], pts[(i + 1) % pts.length]);
  return len;
}

/** Resample a polyline to roughly uniform spacing. */
export function resample(pts: P2[], step: number, closed = false): P2[] {
  const src = closed ? [...pts, pts[0]] : pts;
  const total = pathLength(src);
  const n = Math.max(1, Math.round(total / step));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    if (closed && i === n) break;
    out.push(pointAt(src, (i / n) * total));
  }
  return out;
}

/** Point at distance s along an open polyline. */
export function pointAt(pts: P2[], s: number): P2 {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = dist2(pts[i], pts[i + 1]);
    if (acc + d >= s || i === pts.length - 2) {
      const t = d > 0 ? clamp((s - acc) / d, 0, 1) : 0;
      return { x: lerp(pts[i].x, pts[i + 1].x, t), z: lerp(pts[i].z, pts[i + 1].z, t) };
    }
    acc += d;
  }
  return pts[pts.length - 1];
}

/** Unit tangent at index i of a polyline. */
export function tangentAt(pts: P2[], i: number, closed = false): P2 {
  const n = pts.length;
  const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
  const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
  const dx = next.x - prev.x;
  const dz = next.z - prev.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

/** Right-hand normal of a direction (outward for CCW loops). */
export function rightOf(t: P2): P2 {
  return { x: t.z, z: -t.x };
}

/** Offset a polyline to its right side by d (negative = left), mitred. */
export function offsetPath(pts: P2[], d: number, closed = false): P2[] {
  const n = pts.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    const p = pts[i];
    let nx = 0;
    let nz = 0;
    let n1: P2 | null = null;
    let n2: P2 | null = null;
    if (hasPrev) {
      const a = pts[(i - 1 + n) % n];
      const l = dist2(a, p) || 1;
      n1 = rightOf({ x: (p.x - a.x) / l, z: (p.z - a.z) / l });
    }
    if (hasNext) {
      const b = pts[(i + 1) % n];
      const l = dist2(p, b) || 1;
      n2 = rightOf({ x: (b.x - p.x) / l, z: (b.z - p.z) / l });
    }
    if (n1 && n2) {
      nx = n1.x + n2.x;
      nz = n1.z + n2.z;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      const cos = nx * n1.x + nz * n1.z;
      const m = 1 / Math.max(0.35, cos);
      out.push({ x: p.x + nx * d * m, z: p.z + nz * d * m });
    } else {
      const nn = (n1 ?? n2)!;
      out.push({ x: p.x + nn.x * d, z: p.z + nn.z * d });
    }
  }
  return out;
}

/** Sub-path of a closed loop between two arc-length fractions (wrapping). */
export function subPath(loop: P2[], f0: number, f1: number, step = 0.3): P2[] {
  const closed = [...loop, loop[0]];
  const total = pathLength(closed);
  let a = f0 * total;
  let b = f1 * total;
  if (b < a) b += total;
  const n = Math.max(2, Math.ceil((b - a) / step));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const s = lerp(a, b, i / n) % total;
    out.push(pointAt(closed, s));
  }
  return out;
}

/** Arc-length fraction of the closest point on a closed loop to p. */
export function closestFraction(loop: P2[], p: P2): number {
  const closed = [...loop, loop[0]];
  const total = pathLength(closed);
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const a = closed[i];
    const b = closed[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1);
    const q = { x: a.x + dx * t, z: a.z + dz * t };
    const d = dist2(p, q);
    if (d < best) {
      best = d;
      bestS = acc + Math.sqrt(l2) * t;
    }
    acc += Math.sqrt(l2);
  }
  return bestS / total;
}

/** Catmull-Rom smoothing of a control polygon. */
export function smoothPath(ctrl: P2[], perSegment = 8, closed = false): P2[] {
  const n = ctrl.length;
  const out: P2[] = [];
  const get = (i: number) => (closed ? ctrl[(i + n) % n] : ctrl[clamp(i, 0, n - 1)]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2v = get(i + 1);
    const p3 = get(i + 2);
    for (let j = 0; j < perSegment; j++) {
      const t = j / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2v.x, p3.x), z: f(p0.z, p1.z, p2v.z, p3.z) });
    }
  }
  if (!closed) out.push(ctrl[n - 1]);
  return out;
}

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
