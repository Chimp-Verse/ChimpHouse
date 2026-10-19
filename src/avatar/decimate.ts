// Mesh simplification by quadric error (Garland and Heckbert, 1997): edges are
// collapsed cheapest first, where the cost is how far the merged vertex would sit
// from the planes of the faces round it. Flat and gently curved skin loses
// triangles; the brow, the lips, the knuckles keep theirs. A cap on edge length
// keeps enough rings round the joints for them to bend smoothly.
//
// It runs on every chimp built, so its inner loops allocate nothing: typed arrays,
// scratch buffers and a heap on parallel arrays.

export interface Decimated {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Simplify a closed triangle mesh to about `target` triangles, never making an
 * edge longer than `maxEdge`. Collapses that would flip a face or pinch the
 * surface (more than two shared neighbours) are skipped.
 */
export function decimate(positions: Float32Array, indices: Uint32Array, target: number, maxEdge: number): Decimated {
  const nv = positions.length / 3;
  const nf = indices.length / 3;
  if (nf <= target) return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
  const P = Float64Array.from(positions);
  const F = Int32Array.from(indices);
  const faceAlive = new Uint8Array(nf).fill(1);
  const vertAlive = new Uint8Array(nv).fill(1);
  const stamp = new Uint32Array(nv);
  // faces round each vertex: a flat list per vertex, grown as collapses hand faces over
  const vf: Int32Array[] = new Array(nv);
  const vfn = new Int32Array(nv);
  for (let f = 0; f < nf * 3; f++) vfn[F[f]]++;
  for (let v = 0; v < nv; v++) vf[v] = new Int32Array(Math.max(4, vfn[v] + 2));
  vfn.fill(0);
  for (let f = 0; f < nf; f++)
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      vf[v][vfn[v]++] = f;
    }
  const addFace = (v: number, f: number) => {
    if (vfn[v] === vf[v].length) {
      const grown = new Int32Array(vf[v].length * 2);
      grown.set(vf[v]);
      vf[v] = grown;
    }
    vf[v][vfn[v]++] = f;
  };
  // each vertex's quadric: the sum of its faces' plane quadrics (10 numbers, symmetric 4x4)
  const Q = new Float64Array(nv * 10);
  for (let f = 0; f < nf; f++) {
    const a = F[f * 3];
    const b = F[f * 3 + 1];
    const c = F[f * 3 + 2];
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-16) continue;
    nx /= l;
    ny /= l;
    nz /= l;
    const d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
    for (let k = 0; k < 3; k++) {
      const o = F[f * 3 + k] * 10;
      Q[o] += nx * nx;
      Q[o + 1] += nx * ny;
      Q[o + 2] += nx * nz;
      Q[o + 3] += nx * d;
      Q[o + 4] += ny * ny;
      Q[o + 5] += ny * nz;
      Q[o + 6] += ny * d;
      Q[o + 7] += nz * nz;
      Q[o + 8] += nz * d;
      Q[o + 9] += d * d;
    }
  }
  const maxEdge2 = maxEdge * maxEdge;
  const heap = new Heap(nf * 2);
  const best = new Float64Array(4);
  const pushEdge = (a: number, b: number) => {
    collapseCost(P, Q, a, b, best);
    heap.push(best[0], a, b, stamp[a], stamp[b], best[1], best[2], best[3]);
  };
  // every edge once
  for (let f = 0; f < nf; f++)
    for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k];
      const b = F[f * 3 + ((k + 1) % 3)];
      if (a < b) pushEdge(a, b);
    }

  // the neighbours of a vertex, gathered without allocating: marked in `mark` with a counter
  const mark = new Uint32Array(nv);
  let markId = 0;
  const nbA = new Int32Array(256);
  const nbB = new Int32Array(256);
  const gather = (v: number, out: Int32Array): number => {
    markId++;
    let n = 0;
    const faces = vf[v];
    for (let i = 0; i < vfn[v]; i++) {
      const f = faces[i];
      if (!faceAlive[f]) continue;
      for (let k = 0; k < 3; k++) {
        const w = F[f * 3 + k];
        if (w === v || mark[w] === markId) continue;
        mark[w] = markId;
        if (n < out.length) out[n++] = w;
      }
    }
    return n;
  };

  let alive = nf;
  const e = heap.top;
  while (alive > target && heap.size > 0) {
    heap.pop();
    const a = e.a;
    const b = e.b;
    if (!vertAlive[a] || !vertAlive[b] || stamp[a] !== e.sa || stamp[b] !== e.sb) continue;
    // the link condition: a manifold edge's ends share exactly two neighbours
    const na = gather(a, nbA);
    let hasB = false;
    for (let i = 0; i < na; i++) if (nbA[i] === b) hasB = true;
    if (!hasB) continue;
    const nb = gather(b, nbB);
    // nbB's members are now the marked ones: count nbA's among them
    let shared = 0;
    for (let i = 0; i < na; i++) if (mark[nbA[i]] === markId) shared++;
    if (shared !== 2) continue;
    // no edge out of the merged vertex longer than the cap
    let tooLong = false;
    for (let i = 0; i < na + nb && !tooLong; i++) {
      const v = i < na ? nbA[i] : nbB[i - na];
      if (v === a || v === b) continue;
      const dx = P[v * 3] - e.x;
      const dy = P[v * 3 + 1] - e.y;
      const dz = P[v * 3 + 2] - e.z;
      if (dx * dx + dy * dy + dz * dz > maxEdge2) tooLong = true;
    }
    if (tooLong) continue;
    // no face round either end may flip or fold
    if (flips(P, F, faceAlive, vf[a], vfn[a], a, b, e.x, e.y, e.z) || flips(P, F, faceAlive, vf[b], vfn[b], b, a, e.x, e.y, e.z)) continue;

    // collapse b into a, at the best point
    P[a * 3] = e.x;
    P[a * 3 + 1] = e.y;
    P[a * 3 + 2] = e.z;
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    const bf = vf[b];
    for (let i = 0; i < vfn[b]; i++) {
      const f = bf[i];
      if (!faceAlive[f]) continue;
      if (F[f * 3] === a || F[f * 3 + 1] === a || F[f * 3 + 2] === a) {
        faceAlive[f] = 0;
        alive--;
        continue;
      }
      for (let k = 0; k < 3; k++) if (F[f * 3 + k] === b) F[f * 3 + k] = a;
      addFace(a, f);
    }
    vertAlive[b] = 0;
    vfn[b] = 0;
    // drop a's dead faces
    const af = vf[a];
    let m = 0;
    for (let i = 0; i < vfn[a]; i++) if (faceAlive[af[i]]) af[m++] = af[i];
    vfn[a] = m;
    // the edges round the merged vertex, costed afresh (other edges' costs haven't changed;
    // whether they can still collapse is checked when they come up)
    stamp[a]++;
    const n = gather(a, nbA);
    for (let i = 0; i < n; i++) pushEdge(a, nbA[i]);
  }

  // compact what is left
  const remap = new Int32Array(nv).fill(-1);
  let count = 0;
  const idx = new Uint32Array(alive * 3);
  let w = 0;
  for (let f = 0; f < nf; f++) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      if (remap[v] < 0) remap[v] = count++;
      idx[w++] = remap[v];
    }
  }
  const out = new Float32Array(count * 3);
  for (let v = 0; v < nv; v++) {
    const r = remap[v];
    if (r < 0) continue;
    out[r * 3] = P[v * 3];
    out[r * 3 + 1] = P[v * 3 + 1];
    out[r * 3 + 2] = P[v * 3 + 2];
  }
  return { positions: out, indices: idx.subarray(0, w) };
}

const q = new Float64Array(10);

/** The cost of merging a and b, and where the merged vertex goes (the quadric's best point, or the best of the ends and middle), into out: [cost, x, y, z]. */
function collapseCost(P: Float64Array, Q: Float64Array, a: number, b: number, out: Float64Array) {
  for (let i = 0; i < 10; i++) q[i] = Q[a * 10 + i] + Q[b * 10 + i];
  const ax = P[a * 3];
  const ay = P[a * 3 + 1];
  const az = P[a * 3 + 2];
  const bx = P[b * 3];
  const by = P[b * 3 + 1];
  const bz = P[b * 3 + 2];
  const len2 = (ax - bx) * (ax - bx) + (ay - by) * (ay - by) + (az - bz) * (az - bz);
  let cost = Infinity;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  // solve the 3x3 system for the point of least error
  const det = q[0] * (q[4] * q[7] - q[5] * q[5]) - q[1] * (q[1] * q[7] - q[5] * q[2]) + q[2] * (q[1] * q[5] - q[4] * q[2]);
  if (Math.abs(det) > 1e-14) {
    const x = (-q[3] * (q[4] * q[7] - q[5] * q[5]) + q[6] * (q[1] * q[7] - q[5] * q[2]) - q[8] * (q[1] * q[5] - q[4] * q[2])) / det;
    const y = (q[0] * (-q[6] * q[7] + q[8] * q[5]) - q[1] * (-q[3] * q[7] + q[8] * q[2]) + q[2] * (-q[3] * q[5] + q[6] * q[2])) / det;
    const z = (q[0] * (-q[4] * q[8] + q[5] * q[6]) - q[1] * (-q[1] * q[8] + q[5] * q[3]) + q[2] * (-q[1] * q[6] + q[4] * q[3])) / det;
    // only if it stays near the edge: far points are where nearly flat quadrics run off to
    const mx = (ax + bx) / 2 - x;
    const my = (ay + by) / 2 - y;
    const mz = (az + bz) / 2 - z;
    if (mx * mx + my * my + mz * mz < len2) {
      cost = err(x, y, z);
      cx = x;
      cy = y;
      cz = z;
    }
  }
  for (let t = 0; t <= 1; t += 0.5) {
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    const c = err(x, y, z);
    if (c < cost) {
      cost = c;
      cx = x;
      cy = y;
      cz = z;
    }
  }
  // a little for length, so flat skin still keeps even triangles
  out[0] = Math.max(0, cost) + len2 * 2e-4;
  out[1] = cx;
  out[2] = cy;
  out[3] = cz;
}

function err(x: number, y: number, z: number): number {
  return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
}

/** Whether moving v to (x, y, z) flips or nearly folds a face round it (other than those it shares with `other`). */
function flips(P: Float64Array, F: Int32Array, alive: Uint8Array, faces: Int32Array, n: number, v: number, other: number, x: number, y: number, z: number): boolean {
  for (let i = 0; i < n; i++) {
    const f = faces[i];
    if (!alive[f]) continue;
    const i0 = F[f * 3];
    const i1 = F[f * 3 + 1];
    const i2 = F[f * 3 + 2];
    if (i0 === other || i1 === other || i2 === other) continue;
    // the face's normal before, and with v moved
    const ax = P[i0 * 3], ay = P[i0 * 3 + 1], az = P[i0 * 3 + 2];
    const bx = P[i1 * 3], by = P[i1 * 3 + 1], bz = P[i1 * 3 + 2];
    const cx = P[i2 * 3], cy = P[i2 * 3 + 1], cz = P[i2 * 3 + 2];
    const n0x = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const n0y = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const n0z = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const Ax = i0 === v ? x : ax, Ay = i0 === v ? y : ay, Az = i0 === v ? z : az;
    const Bx = i1 === v ? x : bx, By = i1 === v ? y : by, Bz = i1 === v ? z : bz;
    const Cx = i2 === v ? x : cx, Cy = i2 === v ? y : cy, Cz = i2 === v ? z : cz;
    const n1x = (By - Ay) * (Cz - Az) - (Bz - Az) * (Cy - Ay);
    const n1y = (Bz - Az) * (Cx - Ax) - (Bx - Ax) * (Cz - Az);
    const n1z = (Bx - Ax) * (Cy - Ay) - (By - Ay) * (Cx - Ax);
    const l0 = n0x * n0x + n0y * n0y + n0z * n0z;
    const l1 = n1x * n1x + n1y * n1y + n1z * n1z;
    if (l0 < 1e-36 || l1 < 1e-36) return true;
    // the angle between them under about 75 degrees
    const dot = n0x * n1x + n0y * n1y + n0z * n1z;
    if (dot < 0.25 * Math.sqrt(l0 * l1)) return true;
  }
  return false;
}

/** A binary min-heap of edge collapses on parallel arrays; `pop` leaves the popped entry in `top`. */
class Heap {
  size = 0;
  readonly top = { cost: 0, a: 0, b: 0, sa: 0, sb: 0, x: 0, y: 0, z: 0 };
  private cost: Float64Array;
  private a: Int32Array;
  private b: Int32Array;
  private sa: Uint32Array;
  private sb: Uint32Array;
  private xyz: Float64Array;

  constructor(n: number) {
    this.cost = new Float64Array(n);
    this.a = new Int32Array(n);
    this.b = new Int32Array(n);
    this.sa = new Uint32Array(n);
    this.sb = new Uint32Array(n);
    this.xyz = new Float64Array(n * 3);
  }

  push(cost: number, a: number, b: number, sa: number, sb: number, x: number, y: number, z: number) {
    if (this.size === this.cost.length) this.grow();
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= cost) break;
      this.move(p, i);
      i = p;
    }
    this.set(i, cost, a, b, sa, sb, x, y, z);
  }

  pop(): void {
    const t = this.top;
    t.cost = this.cost[0];
    t.a = this.a[0];
    t.b = this.b[0];
    t.sa = this.sa[0];
    t.sb = this.sb[0];
    t.x = this.xyz[0];
    t.y = this.xyz[1];
    t.z = this.xyz[2];
    const last = --this.size;
    if (last <= 0) return;
    const c = this.cost[last];
    const a = this.a[last];
    const b = this.b[last];
    const sa = this.sa[last];
    const sb = this.sb[last];
    const x = this.xyz[last * 3];
    const y = this.xyz[last * 3 + 1];
    const z = this.xyz[last * 3 + 2];
    let i = 0;
    for (;;) {
      let m = i * 2 + 1;
      if (m >= last) break;
      if (m + 1 < last && this.cost[m + 1] < this.cost[m]) m++;
      if (this.cost[m] >= c) break;
      this.move(m, i);
      i = m;
    }
    this.set(i, c, a, b, sa, sb, x, y, z);
  }

  private set(i: number, cost: number, a: number, b: number, sa: number, sb: number, x: number, y: number, z: number) {
    this.cost[i] = cost;
    this.a[i] = a;
    this.b[i] = b;
    this.sa[i] = sa;
    this.sb[i] = sb;
    this.xyz[i * 3] = x;
    this.xyz[i * 3 + 1] = y;
    this.xyz[i * 3 + 2] = z;
  }

  private move(from: number, to: number) {
    this.cost[to] = this.cost[from];
    this.a[to] = this.a[from];
    this.b[to] = this.b[from];
    this.sa[to] = this.sa[from];
    this.sb[to] = this.sb[from];
    this.xyz[to * 3] = this.xyz[from * 3];
    this.xyz[to * 3 + 1] = this.xyz[from * 3 + 1];
    this.xyz[to * 3 + 2] = this.xyz[from * 3 + 2];
  }

  private grow() {
    const n = this.cost.length * 2;
    const g = <T extends Float64Array | Int32Array | Uint32Array>(arr: T, make: (k: number) => T, k = 1): T => {
      const out = make(n * k);
      out.set(arr);
      return out;
    };
    this.cost = g(this.cost, (k) => new Float64Array(k));
    this.a = g(this.a, (k) => new Int32Array(k));
    this.b = g(this.b, (k) => new Int32Array(k));
    this.sa = g(this.sa, (k) => new Uint32Array(k));
    this.sb = g(this.sb, (k) => new Uint32Array(k));
    this.xyz = g(this.xyz, (k) => new Float64Array(k), 3);
  }
}
