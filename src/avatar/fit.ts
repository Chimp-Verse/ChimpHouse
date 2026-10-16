// Fitting worn things to a chimp: where its skin is, read from its own shapes
// (avatar/anatomy.ts), and the pieces that follow it there. A strap, a collar, a
// chain or a watch's band is laid along a path found on the body of the chimp it is
// made for, so it fits every build, belly and head the DNA makes, rather than a
// circle sized to an average chimp.
//
// The pieces are made directly as meshes (a flat strap, a round tube, a chain's
// links), not meshed from shapes: they are thin and must stay crisp.
//
// Plain numbers and no Babylon: used in the model worker (avatar/build.worker.ts).

import type { Anatomy, Part } from "./anatomy";
import type { ItemMesh } from "./items";
import { Field as FieldCtor, type Field, type V3, add, cross, dot, len, norm, scale, sub } from "./sdf";

/**
 * How far from `from` (inside the shape) along `dir` its surface is: stepped out by
 * the field's own distance, then halved down to a tenth of a millimetre. `max` if it
 * never comes out (or `from` is outside: 0).
 */
export function surfaceAlong(field: Field, from: V3, dir: V3, max = 0.5): number {
  let t = 0;
  let d = field.at(from[0], from[1], from[2]);
  if (d >= 0) return 0;
  while (t < max) {
    const next = t + Math.max(0.0008, -d * 0.9);
    const nd = field.at(from[0] + dir[0] * next, from[1] + dir[1] * next, from[2] + dir[2] * next);
    if (nd >= 0) {
      // the surface is between t (inside) and next (outside)
      let lo = t;
      let hi = next;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (field.at(from[0] + dir[0] * mid, from[1] + dir[1] * mid, from[2] + dir[2] * mid) < 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    t = next;
    d = nd;
  }
  return max;
}

/** How high the shape's top is over (x, z): stepped down from `from` (outside) until it is met; `to` if it isn't. */
export function topAt(field: Field, x: number, z: number, from: number, to: number): number {
  let y = from;
  while (y > to) {
    const d = field.at(x, y, z);
    if (d <= 0.0002) return y;
    y -= Math.max(0.0006, d * 0.9);
  }
  return to;
}

/** The skin of several of the chimp's parts together (the body and head, for round the neck; the body and a hand, for the wrist). */
export function skinOf(anatomy: Anatomy, parts: string[] = ["body", "head"]): Field {
  const f = new FieldCtor();
  for (const name of parts) f.add(anatomy.parts.find((p) => p.name === name)!.field);
  return f;
}

/**
 * A flat disc facing `n` (a watch's dial), `r` across, with a picture laid on it: the
 * picture's right toward `right` (3 o'clock), its top toward `top` (12).
 */
export function disc(out: RawMesh, c: V3, n: V3, right: V3, top: V3, r: number, rings = 6, segs = 40): void {
  const base = out.positions.length / 3;
  out.positions.push(...c);
  out.normals.push(...n);
  out.open.push(1);
  out.uv.push(0.5, 0.5);
  for (let i = 1; i <= rings; i++)
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * (r * i) / rings;
      const y = Math.sin(a) * (r * i) / rings;
      out.positions.push(...add(c, add(scale(right, x), scale(top, y))));
      out.normals.push(...n);
      out.open.push(1);
      out.uv.push(0.5 + x / (2 * r), 0.5 + y / (2 * r));
    }
  for (let j = 0; j < segs; j++) out.indices.push(base, base + 1 + j, base + 1 + ((j + 1) % segs));
  for (let i = 1; i < rings; i++)
    for (let j = 0; j < segs; j++) {
      const a0 = base + 1 + (i - 1) * segs + j;
      const a1 = base + 1 + (i - 1) * segs + ((j + 1) % segs);
      const b0 = a0 + segs;
      const b1 = a1 + segs;
      out.indices.push(a0, b0, a1, a1, b0, b1);
    }
}

/** Where a ray from `from` (outside the shape) along `dir` meets its surface; null if it doesn't within `max`. */
export function hitAlong(field: Field, from: V3, dir: V3, max = 0.4): V3 | null {
  let t = 0;
  while (t < max) {
    const p = add(from, scale(dir, t));
    const d = field.at(p[0], p[1], p[2]);
    if (d <= 0.0002) return p;
    t += Math.max(0.0005, d * 0.9);
  }
  return null;
}

/**
 * A point on the skin lifted out over what is worn over it there (a tee under a bandana), along
 * the skin's normal `n`: the first way out of `worn` (the skin and the clothes together), never a
 * far one (a ray from inside the neck would carry on through a tee's shoulder).
 */
export function lifted(worn: Field, p: V3, n: V3): V3 {
  return worn.at(p[0], p[1], p[2]) >= 0 ? p : add(p, scale(n, surfaceAlong(worn, p, n, 0.08)));
}

/** The point of the skin nearest p (from just inside or outside it): stepped along the field's gradient. */
export function onSkin(field: Field, p: V3, steps = 6): V3 {
  let q = p;
  for (let i = 0; i < steps; i++) {
    const d = field.at(q[0], q[1], q[2]);
    if (Math.abs(d) < 0.0001) break;
    q = sub(q, scale(normalAt(field, q), d));
  }
  return q;
}

/** The field's outward normal at p (its gradient). */
export function normalAt(field: Field, p: V3, e = 0.0006): V3 {
  const [x, y, z] = p;
  return norm([field.at(x + e, y, z) - field.at(x - e, y, z), field.at(x, y + e, z) - field.at(x, y - e, z), field.at(x, y, z + e) - field.at(x, y, z - e)]);
}

/**
 * A ring round a part of the body: n points on its skin, each the way `dir(angle)`
 * points out from `centre` (inside the body), and the skin's normal there.
 */
export function ringOnSkin(field: Field, centre: V3, n: number, dir: (angle: number) => V3): { at: V3[]; normal: V3[] } {
  const at: V3[] = [];
  const normal: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = norm(dir(a));
    const p = add(centre, scale(d, surfaceAlong(field, centre, d)));
    at.push(p);
    normal.push(normalAt(field, p));
  }
  return { at, normal };
}

/** Smooth a path in place (each point toward its neighbours'), `rounds` times; a closed path wraps round. */
export function smoothPath(path: V3[], rounds: number, closed: boolean, keep = 0.5): V3[] {
  let p = path;
  for (let r = 0; r < rounds; r++) {
    p = p.map((q, i) => {
      if (!closed && (i === 0 || i === p.length - 1)) return q;
      const a = p[(i - 1 + p.length) % p.length];
      const b = p[(i + 1) % p.length];
      return add(scale(q, keep), scale(add(a, b), (1 - keep) / 2));
    });
  }
  return p;
}

/** A piece made directly as a mesh: its positions, normals and triangles, and per vertex how shut in it is (0 to 1, 1 open). */
export interface RawMesh {
  positions: number[];
  normals: number[];
  indices: number[];
  /** per vertex: 1 open to the light, less in a crease or against the body */
  open: number[];
  /** per vertex, for stitching along an edge (a cap's peak): how far the edge is, and how far along it (metres); none if empty */
  edge: number[];
  along: number[];
  /** per vertex, where a picture (a watch's dial) is laid on it; none if empty */
  uv: number[];
}

export function rawMesh(): RawMesh {
  return { positions: [], normals: [], indices: [], open: [], edge: [], along: [], uv: [] };
}

/**
 * Sweep a cross-section along a path: a strap (a flat, round-edged rectangle) or a
 * tube (a circle). At each point the section lies square to the path, its "up" the
 * way `up[i]` points (the skin's normal, for a strap lying on it). `profile` gives the
 * section's points and their normals in (across, up) terms. Closed paths join round;
 * open ones are capped.
 */
export function sweep(out: RawMesh, path: V3[], up: V3[], profile: { p: [number, number]; n: [number, number] }[], closed: boolean, shade?: (i: number, k: number) => number): void {
  const n = path.length;
  const base = out.positions.length / 3;
  const m = profile.length;
  const frames: { t: V3; u: V3; b: V3 }[] = [];
  for (let i = 0; i < n; i++) {
    const prev = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const t = norm(sub(next, prev));
    // up square to the path
    let u = sub(up[i], scale(t, dot(up[i], t)));
    if (len(u) < 1e-6) u = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    u = norm(u);
    frames.push({ t, u, b: norm(cross(u, t)) });
  }
  for (let i = 0; i < n; i++) {
    const { u, b } = frames[i];
    for (let k = 0; k < m; k++) {
      const { p, n: pn } = profile[k];
      const q = add(path[i], add(scale(b, p[0]), scale(u, p[1])));
      out.positions.push(q[0], q[1], q[2]);
      const nn = norm(add(scale(b, pn[0]), scale(u, pn[1])));
      out.normals.push(nn[0], nn[1], nn[2]);
      out.open.push(shade ? shade(i, k) : 1);
    }
  }
  const rows = closed ? n : n - 1;
  for (let i = 0; i < rows; i++) {
    const a = base + i * m;
    const c = base + ((i + 1) % n) * m;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      out.indices.push(a + k, c + k, a + k2, a + k2, c + k, c + k2);
    }
  }
  if (!closed) {
    // the two ends, each a fan round its middle
    for (const [i, s] of [
      [0, -1],
      [n - 1, 1],
    ] as [number, number][]) {
      const mid = out.positions.length / 3;
      const { t } = frames[i];
      out.positions.push(path[i][0], path[i][1], path[i][2]);
      out.normals.push(t[0] * s, t[1] * s, t[2] * s);
      out.open.push(shade ? shade(i, 0) : 1);
      const ring = out.positions.length / 3;
      for (let k = 0; k < m; k++) {
        const v = base + i * m + k;
        out.positions.push(out.positions[v * 3], out.positions[v * 3 + 1], out.positions[v * 3 + 2]);
        out.normals.push(t[0] * s, t[1] * s, t[2] * s);
        out.open.push(out.open[v]);
      }
      for (let k = 0; k < m; k++) {
        const k2 = (k + 1) % m;
        if (s < 0) out.indices.push(mid, ring + k2, ring + k);
        else out.indices.push(mid, ring + k, ring + k2);
      }
    }
  }
}

/** A flat strap's section: `width` across, `thick` through, its edges rounded. */
export function strapProfile(width: number, thick: number): { p: [number, number]; n: [number, number] }[] {
  const r = Math.min(thick / 2, width / 2);
  const hw = width / 2 - r;
  const out: { p: [number, number]; n: [number, number] }[] = [];
  // round each end of the section (a stadium): the right end, then the left, going round
  for (const [cx, a0] of [
    [hw, -Math.PI / 2],
    [-hw, Math.PI / 2],
  ] as [number, number][]) {
    for (let j = 0; j <= 4; j++) {
      const a = a0 + (j / 4) * Math.PI;
      out.push({ p: [cx + r * Math.cos(a), r * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] });
    }
  }
  return out;
}

/** A round tube's section, `r` across. */
export function tubeProfile(r: number, sides = 10): { p: [number, number]; n: [number, number] }[] {
  const out: { p: [number, number]; n: [number, number] }[] = [];
  for (let j = 0; j < sides; j++) {
    const a = (j / sides) * Math.PI * 2;
    out.push({ p: [r * Math.cos(a), r * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] });
  }
  return out;
}

/**
 * A rope (a rolled kerchief): a round tube along a closed path, `radius(i)` thick at
 * each point, its surface twisted in a spiral as rolled cloth is.
 */
export function rope(out: RawMesh, path: V3[], up: V3[], radius: (i: number) => number, twist = 0, sides = 14): void {
  const n = path.length;
  const base = out.positions.length / 3;
  let along = 0;
  for (let i = 0; i < n; i++) {
    const prev = path[(i - 1 + n) % n];
    const next = path[(i + 1) % n];
    const t = norm(sub(next, prev));
    let u = sub(up[i], scale(t, dot(up[i], t)));
    u = len(u) < 1e-6 ? (Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]) : norm(u);
    const b = norm(cross(u, t));
    if (i > 0) along += len(sub(path[i], path[i - 1]));
    for (let k = 0; k < sides; k++) {
      const ph = (k / sides) * Math.PI * 2;
      const dir = norm(add(scale(b, Math.cos(ph)), scale(u, Math.sin(ph))));
      // the spiral of the roll: the radius swells and dips twice round, turning along the path
      const r = radius(i) * (1 + (twist ? 0.11 * Math.sin(2 * ph + along * twist) : 0));
      const p = add(path[i], scale(dir, r));
      out.positions.push(p[0], p[1], p[2]);
      out.normals.push(dir[0], dir[1], dir[2]);
      // the side against the body sees little light
      out.open.push(0.55 + 0.45 * (0.5 + 0.5 * Math.sin(ph)));
    }
  }
  for (let i = 0; i < n; i++) {
    const a = base + i * sides;
    const c = base + ((i + 1) % n) * sides;
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      out.indices.push(a + k, c + k, a + k2, a + k2, c + k, c + k2);
    }
  }
}

/**
 * A triangle of cloth draped on the skin (a kerchief's point, its knot's ends): its top
 * edge along `top(s)` (s from -1 to 1), narrowing to `tip`. Each point is found on the
 * skin looking in toward the body's middle line (at x, z = `axis`), or toward the point
 * `toward` (for skin that faces up more than out, as the top of the back does), stood `gap` off it,
 * plus a `bulge` in the middle and soft `folds` toward the tip. A thin sheet `thick`
 * through; `edge` per vertex is how far its side edges are (for a printed border).
 * Returns the mesh and the sheet's points (for the fur under it).
 */
export function drape(skin: Field, top: (s: number) => V3, tip: V3, axis: [number, number], o: { cols: number; rows: number; gap: number; bulge: number; folds: number; thick: number; toward?: V3; border?: boolean }): { raw: RawMesh; points: V3[] } {
  const { cols, rows } = o;
  const grid: V3[][] = [];
  const nrm: V3[][] = [];
  for (let j = 0; j < rows; j++) {
    const v = j / (rows - 1);
    const row: V3[] = [];
    const nrow: V3[] = [];
    for (let i = 0; i < cols; i++) {
      const s = -1 + (2 * i) / (cols - 1);
      const T = add(scale(top(s), 1 - v), scale(tip, v));
      const out = o.toward ? norm(sub(T, o.toward)) : norm([T[0] - axis[0], 0, T[2] - axis[1]]);
      const hit = hitAlong(skin, add(T, scale(out, 0.08)), scale(out, -1), 0.2) ?? T;
      const n = normalAt(skin, hit);
      const off = o.gap + o.bulge * (1 - Math.abs(s)) * Math.sin(Math.PI * Math.min(1, v * 1.15)) + o.folds * Math.sin(s * Math.PI * 3) * v;
      row.push(add(hit, scale(n, off)));
      nrow.push(n);
    }
    grid.push(row);
    nrm.push(nrow);
  }
  const raw = rawMesh();
  const halfW = len(sub(top(1), top(-1))) / 2;
  for (const side of [1, -1]) {
    const base = raw.positions.length / 3;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const p = add(grid[j][i], scale(nrm[j][i], side > 0 ? 0 : -o.thick));
        raw.positions.push(...p);
        raw.normals.push(...scale(nrm[j][i], side));
        raw.open.push(side > 0 ? 1 : 0.5);
        // how far the side edges are, for a printed border (none: as if they were far off)
        raw.edge.push(o.border === false ? 1 : (1 - Math.abs(-1 + (2 * i) / (cols - 1))) * halfW * (1 - j / (rows - 1)) * 0.92);
        raw.along.push(0);
      }
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < cols - 1; i++) {
        const q = base + j * cols + i;
        raw.indices.push(q, q + cols, q + 1, q + 1, q + cols, q + cols + 1);
      }
  }
  // the side edges: the two faces joined
  const half = rows * cols;
  for (const i of [0, cols - 1])
    for (let j = 0; j < rows - 1; j++) {
      const a0 = j * cols + i;
      const a1 = (j + 1) * cols + i;
      raw.indices.push(a0, a1, a0 + half, a0 + half, a1, a1 + half);
    }
  return { raw, points: grid.flat() };
}

/** A ring (a chain's link, a buckle's frame): round `axis`, `R` to the middle of its tube, the tube `r` thick, stretched `long` along `along`. */
export function torusMesh(out: RawMesh, c: V3, axis: V3, along: V3, R: number, r: number, long = 1, segs = 14, sides = 8): void {
  const a = norm(axis);
  const u = norm(sub(along, scale(a, dot(along, a))));
  const v = cross(a, u);
  const base = out.positions.length / 3;
  for (let i = 0; i < segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    // the link's middle line: a rounded oblong, longer along `along`
    const dir = norm(add(scale(u, Math.cos(th)), scale(v, Math.sin(th))));
    const mid = add(c, add(scale(u, Math.cos(th) * R * long), scale(v, Math.sin(th) * R)));
    for (let j = 0; j < sides; j++) {
      const ph = (j / sides) * Math.PI * 2;
      const nrm = norm(add(scale(dir, Math.cos(ph)), scale(a, Math.sin(ph))));
      const p = add(mid, scale(nrm, r));
      out.positions.push(p[0], p[1], p[2]);
      out.normals.push(nrm[0], nrm[1], nrm[2]);
      // the inside of the ring sees less light
      out.open.push(0.65 + 0.35 * (0.5 + 0.5 * Math.cos(ph)));
    }
  }
  for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % segs;
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const a0 = base + i * sides + j;
      const a1 = base + i * sides + j2;
      const b0 = base + i2 * sides + j;
      const b1 = base + i2 * sides + j2;
      out.indices.push(a0, a1, b0, a1, b1, b0);
    }
  }
}

/**
 * Wind every triangle as Babylon draws front faces (the plain cross product of its
 * edges points away from whoever sees it), judged from its vertices' normals.
 */
export function orient(raw: RawMesh): void {
  const P = raw.positions;
  const N = raw.normals;
  const I = raw.indices;
  for (let i = 0; i < I.length; i += 3) {
    const [a, b, c] = [I[i], I[i + 1], I[i + 2]];
    const e1: V3 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2: V3 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const cr = cross(e1, e2);
    const nx = N[a * 3] + N[b * 3] + N[c * 3];
    const ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
    const nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (cr[0] * nx + cr[1] * ny + cr[2] * nz > 0) [I[i + 1], I[i + 2]] = [I[i + 2], I[i + 1]];
  }
}

/** A mesh piece as an item carries it: its cloth attribute from how open each vertex is (and `band` for the whole of it). */
export function toItemMesh(raw: RawMesh, kind: ItemMesh["kind"], colour: number, bone: string | null, band = 0, hex?: string): ItemMesh {
  orient(raw);
  const n = raw.positions.length / 3;
  const cloth = new Float32Array(n * 4);
  const stitched = raw.along.length === n;
  for (let v = 0; v < n; v++) {
    cloth[v * 4] = band;
    cloth[v * 4 + 1] = stitched ? raw.edge[v] : 0;
    cloth[v * 4 + 2] = raw.open[v];
    cloth[v * 4 + 3] = stitched ? 10 + raw.along[v] : 0;
  }
  return { kind, colour, hex, bone, positions: Float32Array.from(raw.positions), normals: Float32Array.from(raw.normals), indices: Uint32Array.from(raw.indices), cloth, uvs: raw.uv.length === n * 2 ? Float32Array.from(raw.uv) : undefined };
}

/**
 * Weight a piece to the body's bones as the skin under it is, so it moves with the
 * chimp (a strap over a shoulder goes with the arm): the piece is then skinned, not
 * carried by one bone.
 */
export function weighOnBody(anatomy: Anatomy, m: ItemMesh): ItemMesh {
  const body = anatomy.parts.find((p) => p.name === "body") as Part;
  const n = m.positions.length / 3;
  const bones = new Float32Array(n * 4);
  const weights = new Float32Array(n * 4);
  const bi = new Int32Array(4);
  const bw = new Float32Array(4);
  const near: number[] = [];
  for (let v = 0; v < n; v++) {
    const p: V3 = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
    body.field.near(p[0], p[1], p[2], 0.04, 0.04, near);
    anatomy.weigh(body, p, near, bi, bw);
    for (let k = 0; k < 4; k++) {
      bones[v * 4 + k] = bi[k];
      weights[v * 4 + k] = bw[k];
    }
  }
  return { ...m, bone: null, bones, weights };
}

/** Distance from p to a path's nearest segment (for the fur a strap or chain presses down). */
export function pathDistance(path: V3[], closed: boolean, p: V3): number {
  let best = Infinity;
  const n = path.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = path[i];
    const b = path[(i + 1) % n];
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-12, dot(ab, ab))));
    best = Math.min(best, len(sub(p, add(a, scale(ab, t)))));
  }
  return best;
}
