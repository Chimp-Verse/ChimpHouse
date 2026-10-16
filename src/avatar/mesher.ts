// Turns a distance field (avatar/sdf.ts) into a mesh with surface nets: a grid of
// samples, a vertex in each cell the surface passes through, and a quad across
// each grid edge it crosses. Only blocks of the grid near the surface are sampled,
// and each block only asks the shapes that can matter there, so a body takes tens
// of milliseconds rather than seconds. Each vertex is then moved onto the true
// surface and given the field's own normal, so curves stay smooth at any grid size.

import type { Field, V3 } from "./sdf";

export interface Meshed {
  positions: Float32Array;
  indices: Uint32Array;
  /** the operations that matter near a point inside the meshed box (an index into the field's ops) */
  near(x: number, y: number, z: number): number[];
}

const EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * Mesh the field inside the box min–max with grid spacing h: vertices where the
 * cells' edges cross the surface, not yet moved onto it (see `settle`). Corners
 * are numbered by bits: 1 = +x, 2 = +y, 4 = +z.
 */
export function meshField(field: Field, min: V3, max: V3, h: number, block = 8): Meshed {
  const B = block;
  const nbx = Math.max(1, Math.ceil((max[0] - min[0]) / h / B));
  const nby = Math.max(1, Math.ceil((max[1] - min[1]) / h / B));
  const nbz = Math.max(1, Math.ceil((max[2] - min[2]) / h / B));
  const NX = nbx * B + 1;
  const NY = nby * B + 1;
  const NZ = nbz * B + 1;
  const sxy = NX * NY;
  const vals = new Float32Array(NX * NY * NZ).fill(NaN);
  const blockList = new Int32Array(nbx * nby * nbz).fill(-1);
  const lists: number[][] = [];
  const near: number[] = [];
  const half = (B * h * Math.sqrt(3)) / 2;
  const band = 2 * h;
  // the approximate fields (ellipsoids, smooth unions) can read up to about half again
  // too far, so a block is only skipped well clear of the surface
  const SAFE = 1.6;

  for (let bk = 0; bk < nbz; bk++)
    for (let bj = 0; bj < nby; bj++)
      for (let bi = 0; bi < nbx; bi++) {
        const cx = min[0] + (bi * B + B / 2) * h;
        const cy = min[1] + (bj * B + B / 2) * h;
        const cz = min[2] + (bk * B + B / 2) * h;
        field.near(cx, cy, cz, half, band, near);
        if (!near.length) continue;
        const f = field.at(cx, cy, cz, near);
        if (Math.abs(f) > half * SAFE + band) continue;
        const list = near.slice();
        blockList[bi + bj * nbx + bk * nbx * nby] = lists.length;
        lists.push(list);
        // the block's eight sub-blocks: only those the surface may pass through are sampled
        // (a cell in a skipped one has no surface, and never asks for its corners)
        const S = B / 2;
        const subHalf = (S * h * Math.sqrt(3)) / 2;
        for (let sk = 0; sk < 2; sk++)
          for (let sj = 0; sj < 2; sj++)
            for (let si = 0; si < 2; si++) {
              const sx = min[0] + (bi * B + si * S + S / 2) * h;
              const sy = min[1] + (bj * B + sj * S + S / 2) * h;
              const sz = min[2] + (bk * B + sk * S + S / 2) * h;
              if (Math.abs(field.at(sx, sy, sz, list)) > subHalf * SAFE + band) continue;
              for (let k = sk * S; k <= sk * S + S; k++)
                for (let j = sj * S; j <= sj * S + S; j++)
                  for (let i = si * S; i <= si * S + S; i++) {
                    const gi = bi * B + i;
                    const gj = bj * B + j;
                    const gk = bk * B + k;
                    const n = gi + gj * NX + gk * sxy;
                    if (vals[n] === vals[n]) continue; // already sampled
                    vals[n] = field.at(min[0] + gi * h, min[1] + gj * h, min[2] + gk * h, list);
                  }
            }
      }

  // a vertex in every cell the surface crosses: the average of where it crosses the cell's edges
  const cellVert = new Int32Array(NX * NY * NZ).fill(-1);
  const pos: number[] = [];
  const corner = new Float64Array(8);
  for (let bk = 0; bk < nbz; bk++)
    for (let bj = 0; bj < nby; bj++)
      for (let bi = 0; bi < nbx; bi++) {
        const li = blockList[bi + bj * nbx + bk * nbx * nby];
        if (li < 0) continue;
        for (let k = bk * B; k < bk * B + B; k++)
          for (let j = bj * B; j < bj * B + B; j++)
            for (let i = bi * B; i < bi * B + B; i++) {
              const n = i + j * NX + k * sxy;
              let mask = 0;
              let bad = false;
              for (let c = 0; c < 8; c++) {
                const v = vals[n + (c & 1) + ((c >> 1) & 1) * NX + ((c >> 2) & 1) * sxy];
                if (v !== v) {
                  bad = true;
                  break;
                }
                corner[c] = v;
                if (v < 0) mask |= 1 << c;
              }
              if (bad || mask === 0 || mask === 255) continue;
              let ax = 0;
              let ay = 0;
              let az = 0;
              let m = 0;
              for (const [c0, c1] of EDGES) {
                const v0 = corner[c0];
                const v1 = corner[c1];
                if (v0 < 0 === v1 < 0) continue;
                const t = v0 / (v0 - v1);
                ax += (c0 & 1) + ((c1 & 1) - (c0 & 1)) * t;
                ay += ((c0 >> 1) & 1) + (((c1 >> 1) & 1) - ((c0 >> 1) & 1)) * t;
                az += ((c0 >> 2) & 1) + (((c1 >> 2) & 1) - ((c0 >> 2) & 1)) * t;
                m++;
              }
              cellVert[n] = pos.length / 3;
              pos.push(min[0] + (i + ax / m) * h, min[1] + (j + ay / m) * h, min[2] + (k + az / m) * h);
            }
      }

  // a quad across each grid edge the surface crosses, joining the four cells round the edge
  const idx: number[] = [];
  const axes = [
    [1, NX, sxy],
    [NX, sxy, 1],
    [sxy, 1, NX],
  ];
  for (let n = 0; n < cellVert.length; n++) {
    if (cellVert[n] < 0) continue;
    const v0 = vals[n];
    for (let a = 0; a < 3; a++) {
      const [step, du, dv] = axes[a];
      const v1 = vals[n + step];
      if (v1 !== v1 || v0 < 0 === v1 < 0) continue;
      const q0 = cellVert[n];
      const q1 = cellVert[n - du];
      const q2 = cellVert[n - du - dv];
      const q3 = cellVert[n - dv];
      if (q1 < 0 || q2 < 0 || q3 < 0 || n - du - dv < 0) continue;
      // inside at the edge's start: the surface faces along the axis
      quad(idx, pos, q0, q1, q2, q3, a, v0 < 0 ? 1 : -1);
    }
  }

  const nearAt = (x: number, y: number, z: number): number[] => {
    const bi = Math.min(nbx - 1, Math.max(0, Math.floor((x - min[0]) / h / B)));
    const bj = Math.min(nby - 1, Math.max(0, Math.floor((y - min[1]) / h / B)));
    const bk = Math.min(nbz - 1, Math.max(0, Math.floor((z - min[2]) / h / B)));
    const li = blockList[bi + bj * nbx + bk * nbx * nby];
    if (li >= 0) return lists[li];
    // a vertex moved by simplification into a block with no surface: ask round it
    const out: number[] = [];
    field.near(x, y, z, half, band * 4, out);
    return out;
  };
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), near: nearAt };
}

/**
 * Two triangles for the quad q0–q3, split along its shorter diagonal and wound
 * so they face `sign` along `axis` (Babylon's front faces wind so that the plain
 * cross product points away from the viewer, as the house's geometry does).
 */
function quad(idx: number[], p: number[], q0: number, q1: number, q2: number, q3: number, axis: number, sign: number) {
  const d02 = dist2(p, q0, q2);
  const d13 = dist2(p, q1, q3);
  const tris = d02 <= d13 ? [q0, q1, q2, q0, q2, q3] : [q0, q1, q3, q1, q2, q3];
  // which way the first triangle's cross product points along the axis
  const [a, b, c] = tris;
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const cr = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx][axis];
  if (cr * sign < 0) idx.push(...tris);
  else idx.push(tris[0], tris[2], tris[1], tris[3], tris[5], tris[4]);
}

function dist2(p: number[], a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3];
  const dy = p[a * 3 + 1] - p[b * 3 + 1];
  const dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Move each vertex onto the surface (Newton steps along the field's gradient,
 * never more than `h` in all) and return the normals: the gradient there.
 */
export function settle(field: Field, pos: Float32Array, near: (x: number, y: number, z: number) => number[], h: number): Float32Array {
  const nrm = new Float32Array(pos.length);
  const e = h * 0.2;
  for (let v = 0; v < pos.length / 3; v++) {
    let x = pos[v * 3];
    let y = pos[v * 3 + 1];
    let z = pos[v * 3 + 2];
    const list = near(x, y, z);
    const x0 = x;
    const y0 = y;
    const z0 = z;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let it = 0; it < 4; it++) {
      gx = field.at(x + e, y, z, list) - field.at(x - e, y, z, list);
      gy = field.at(x, y + e, z, list) - field.at(x, y - e, z, list);
      gz = field.at(x, y, z + e, list) - field.at(x, y, z - e, list);
      const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e);
      if (it === 3 || g2 < 1e-8) break;
      const d = field.at(x, y, z, list);
      if (Math.abs(d) < h * 0.002) break;
      const k = d / g2 / (2 * e);
      x -= gx * k;
      y -= gy * k;
      z -= gz * k;
      // a step that would leave the cell's neighbourhood is a bad gradient: stay put
      if (Math.abs(x - x0) > h || Math.abs(y - y0) > h || Math.abs(z - z0) > h) {
        x = x0;
        y = y0;
        z = z0;
        break;
      }
    }
    if (gx === 0 && gy === 0 && gz === 0) {
      gx = field.at(x + e, y, z, list) - field.at(x - e, y, z, list);
      gy = field.at(x, y + e, z, list) - field.at(x, y - e, z, list);
      gz = field.at(x, y, z + e, list) - field.at(x, y, z - e, list);
    }
    const gl = Math.hypot(gx, gy, gz) || 1;
    pos[v * 3] = x;
    pos[v * 3 + 1] = y;
    pos[v * 3 + 2] = z;
    nrm[v * 3] = gx / gl;
    nrm[v * 3 + 1] = gy / gl;
    nrm[v * 3 + 2] = gz / gl;
  }
  return nrm;
}
