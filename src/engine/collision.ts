import { Mesh, Scene, Vector3, VertexBuffer } from "@babylonjs/core";
import { MeshMeta } from "../world/context";

/** Plan cell size of the triangle grid, in metres. */
const CELL = 0.5;
/** How far beyond the house and its approaches the terrain stays walkable. */
const MARGIN = 40;
/** Areas and materials a walker passes through: roofs overhead, the far jungle, foliage and plant stems. */
const SKIP_ROOMS = new Set(["jungle", "sky"]);
const SKIP_MATS = new Set(["stem", "bulb"]);
/** Standalone meshes that are solid: the terrain. Water, mist, caustics and fireflies are not. */
const SOLID_SPECIALS = new Set(["terrain"]);

interface Source {
  mesh: Mesh;
  pos: ArrayLike<number>;
  idx: ArrayLike<number>;
}

/**
 * What lies under a point, from `probe`: the highest surface flat enough to
 * stand on (sloping under ~53°), and the highest of any slope short of a
 * wall's (~78°) with its downhill direction. -Infinity where there is none.
 */
export interface Probe {
  walkY: number;
  anyY: number;
  /** triangle id of the `anyY` surface, for `face` */
  anyTri: number;
  downX: number;
  downZ: number;
}

export function emptyProbe(p: Probe = { walkY: 0, anyY: 0, anyTri: -1, downX: 0, downZ: 0 }): Probe {
  p.walkY = -Infinity;
  p.anyY = -Infinity;
  p.anyTri = -1;
  return p;
}

/**
 * The house's own render geometry as a static collision set: every solid
 * triangle, bucketed into a uniform plan grid so a walker only tests the few
 * hundred triangles around it. Vertex data is read in place from the meshes
 * (their world matrices are identity) rather than copied. Triangles of
 * disabled meshes (a hidden upper level) are ignored.
 */
export class CollisionWorld {
  private sources: Source[] = [];
  private triSrc: Uint16Array;
  /** each triangle's height range, so a cell's other storeys are skipped without loading them */
  private triY0: Float32Array;
  private triY1: Float32Array;
  private srcStart: Int32Array;
  private cellStart: Int32Array;
  private cellTris: Uint32Array;
  private stamp: Uint32Array;
  private gatherId = 0;
  private enabledAt: Uint32Array;
  private enabledVal: Uint8Array;
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly triangles: number;
  /**
   * The moving solids (kind "lift": the car and its doors): not in the grid, since they
   * move, but tested one by one in their places as of the last `syncMovers`. A mover's
   * triangle id is `triangles` + its index among the moving triangles.
   */
  private movers: Mesh[] = [];
  private moverStart = new Int32Array(1);
  private moverOn = new Uint8Array(0);
  private moverOwner = new Uint16Array(0);
  private moverFace = new Uint32Array(0);
  private moverLocal = new Float64Array(0);
  private moverWorld = new Float64Array(0);
  private moverTris = 0;

  /** Candidate triangles from the last `gather`: ids and vertex coordinates (9 per triangle). */
  count = 0;
  ids = new Uint32Array(1024);
  verts = new Float64Array(1024 * 9);

  constructor(scene: Scene) {
    let tris = 0;
    let bx0 = Infinity;
    let bx1 = -Infinity;
    let bz0 = Infinity;
    let bz1 = -Infinity;
    const moverMeshes: Mesh[] = [];
    for (const m of scene.meshes) {
      if (!(m instanceof Mesh)) continue;
      if (mover(m)) {
        moverMeshes.push(m);
        continue;
      }
      if (!solid(m)) continue;
      const idx = m.getIndices();
      let pos = m.getVerticesData(VertexBuffer.PositionKind);
      if (!idx || !pos || idx.length < 3) continue;
      const wm = m.computeWorldMatrix(true);
      if (!wm.isIdentity()) {
        const out = new Float32Array(pos.length);
        const v = new Vector3();
        for (let i = 0; i < pos.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], wm, v);
          out[i] = v.x;
          out[i + 1] = v.y;
          out[i + 2] = v.z;
        }
        pos = out;
      }
      this.sources.push({ mesh: m, pos, idx });
      tris += idx.length / 3;
      if (m.name !== "terrain") {
        const bb = m.getBoundingInfo().boundingBox;
        bx0 = Math.min(bx0, bb.minimumWorld.x);
        bx1 = Math.max(bx1, bb.maximumWorld.x);
        bz0 = Math.min(bz0, bb.minimumWorld.z);
        bz1 = Math.max(bz1, bb.maximumWorld.z);
      }
    }
    this.triangles = tris;
    this.x0 = Math.floor((bx0 - MARGIN) / CELL) * CELL;
    this.z0 = Math.floor((bz0 - MARGIN) / CELL) * CELL;
    this.nx = Math.ceil((bx1 + MARGIN - this.x0) / CELL);
    this.nz = Math.ceil((bz1 + MARGIN - this.z0) / CELL);

    this.triSrc = new Uint16Array(tris);
    this.triY0 = new Float32Array(tris);
    this.triY1 = new Float32Array(tris);
    this.srcStart = new Int32Array(this.sources.length + 1);
    this.stamp = new Uint32Array(tris);
    this.enabledAt = new Uint32Array(this.sources.length);
    this.enabledVal = new Uint8Array(this.sources.length);
    let t = 0;
    this.sources.forEach((s, i) => {
      this.srcStart[i] = t;
      this.triSrc.fill(i, t, t + s.idx.length / 3);
      t += s.idx.length / 3;
    });
    this.srcStart[this.sources.length] = t;

    // two passes over every triangle's plan bounds: count per cell, then fill
    const cells = this.nx * this.nz;
    const counts = new Int32Array(cells + 1);
    const span = new Int32Array(4);
    this.forEachSpan(span, () => {
      for (let j = span[2]; j <= span[3]; j++) for (let i = span[0]; i <= span[1]; i++) counts[j * this.nx + i]++;
    });
    this.cellStart = new Int32Array(cells + 1);
    for (let c = 0; c < cells; c++) this.cellStart[c + 1] = this.cellStart[c] + counts[c];
    this.cellTris = new Uint32Array(this.cellStart[cells]);
    const fill = this.cellStart.slice(0, cells);
    this.forEachSpan(span, (tri) => {
      for (let j = span[2]; j <= span[3]; j++) for (let i = span[0]; i <= span[1]; i++) this.cellTris[fill[j * this.nx + i]++] = tri;
    });
    this.setMovers(moverMeshes);
  }

  /** Keeps the moving solids' local vertices and sets their places from their meshes' transforms. */
  private setMovers(meshes: Mesh[]): void {
    this.movers = meshes;
    this.moverStart = new Int32Array(meshes.length + 1);
    const parts: Float64Array[] = [];
    let n = 0;
    meshes.forEach((m, i) => {
      this.moverStart[i] = n;
      const idx = m.getIndices();
      const pos = m.getVerticesData(VertexBuffer.PositionKind);
      const count = idx && pos ? idx.length / 3 : 0;
      const local = new Float64Array(count * 9);
      for (let k = 0; k < count; k++)
        for (let v = 0; v < 3; v++) {
          const p = idx![k * 3 + v] * 3;
          local[k * 9 + v * 3] = pos![p];
          local[k * 9 + v * 3 + 1] = pos![p + 1];
          local[k * 9 + v * 3 + 2] = pos![p + 2];
        }
      parts.push(local);
      n += count;
    });
    this.moverStart[meshes.length] = n;
    this.moverTris = n;
    this.moverLocal = new Float64Array(n * 9);
    this.moverWorld = new Float64Array(n * 9);
    this.moverOn = new Uint8Array(meshes.length);
    this.moverOwner = new Uint16Array(n);
    this.moverFace = new Uint32Array(n);
    let t = 0;
    meshes.forEach((_, i) => {
      const local = parts[i];
      this.moverLocal.set(local, t * 9);
      for (let k = 0; k < local.length / 9; k++) {
        this.moverOwner[t + k] = i;
        this.moverFace[t + k] = k;
      }
      t += local.length / 9;
    });
    this.syncMovers();
  }

  /**
   * Places the moving solids where their meshes are now: the lift car and its doors, moved
   * by engine/lift.ts. A part that is hidden or disabled isn't solid. The walker calls this
   * before each step, so it always collides with the car as it is that moment.
   */
  syncMovers(): void {
    const w = this.moverWorld;
    const l = this.moverLocal;
    for (let i = 0; i < this.movers.length; i++) {
      const m = this.movers[i];
      const on = m.isEnabled() ? 1 : 0;
      this.moverOn[i] = on;
      if (!on) continue;
      const a = m.computeWorldMatrix(true).m;
      for (let o = this.moverStart[i] * 9; o < this.moverStart[i + 1] * 9; o += 3) {
        const x = l[o];
        const y = l[o + 1];
        const z = l[o + 2];
        w[o] = x * a[0] + y * a[4] + z * a[8] + a[12];
        w[o + 1] = x * a[1] + y * a[5] + z * a[9] + a[13];
        w[o + 2] = x * a[2] + y * a[6] + z * a[10] + a[14];
      }
    }
  }

  /** Calls `fn` for each triangle inside the grid, with its cell span [i0, i1, j0, j1] in `span`. */
  private forEachSpan(span: Int32Array, fn: (tri: number) => void) {
    let tri = 0;
    for (const s of this.sources) {
      const { pos, idx } = s;
      for (let k = 0; k < idx.length; k += 3, tri++) {
        const a = idx[k] * 3;
        const b = idx[k + 1] * 3;
        const c = idx[k + 2] * 3;
        const i0 = Math.floor((Math.min(pos[a], pos[b], pos[c]) - this.x0) / CELL);
        const i1 = Math.floor((Math.max(pos[a], pos[b], pos[c]) - this.x0) / CELL);
        const j0 = Math.floor((Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) - this.z0) / CELL);
        const j1 = Math.floor((Math.max(pos[a + 2], pos[b + 2], pos[c + 2]) - this.z0) / CELL);
        if (i1 < 0 || j1 < 0 || i0 >= this.nx || j0 >= this.nz) continue;
        this.triY0[tri] = Math.min(pos[a + 1], pos[b + 1], pos[c + 1]);
        this.triY1[tri] = Math.max(pos[a + 1], pos[b + 1], pos[c + 1]);
        span[0] = Math.max(0, i0);
        span[1] = Math.min(this.nx - 1, i1);
        span[2] = Math.max(0, j0);
        span[3] = Math.min(this.nz - 1, j1);
        fn(tri);
      }
    }
  }

  /** True when (x, z) lies inside the grid. */
  inside(x: number, z: number): boolean {
    return x > this.x0 && z > this.z0 && x < this.x0 + this.nx * CELL && z < this.z0 + this.nz * CELL;
  }

  private enabled(src: number): boolean {
    if (this.enabledAt[src] !== this.gatherId) {
      this.enabledAt[src] = this.gatherId;
      this.enabledVal[src] = this.sources[src].mesh.isEnabled() ? 1 : 0;
    }
    return this.enabledVal[src] === 1;
  }

  /** Writes triangle `tri`'s vertices into `out` at `o`. */
  private load(tri: number, out: Float64Array, o: number) {
    const src = this.triSrc[tri];
    const { pos, idx } = this.sources[src];
    const k = (tri - this.srcStart[src]) * 3;
    for (let v = 0; v < 3; v++) {
      const p = idx[k + v] * 3;
      out[o + v * 3] = pos[p];
      out[o + v * 3 + 1] = pos[p + 1];
      out[o + v * 3 + 2] = pos[p + 2];
    }
  }

  /** Collects the enabled triangles whose bounds overlap the box into `ids` / `verts` / `count`. */
  gather(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    this.gatherId++;
    this.count = 0;
    const i0 = Math.max(0, Math.floor((x0 - this.x0) / CELL));
    const i1 = Math.min(this.nx - 1, Math.floor((x1 - this.x0) / CELL));
    const j0 = Math.max(0, Math.floor((z0 - this.z0) / CELL));
    const j1 = Math.min(this.nz - 1, Math.floor((z1 - this.z0) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = j * this.nx + i;
        for (let e = this.cellStart[c]; e < this.cellStart[c + 1]; e++) {
          const tri = this.cellTris[e];
          if (this.stamp[tri] === this.gatherId || this.triY1[tri] < y0 || this.triY0[tri] > y1) continue;
          this.stamp[tri] = this.gatherId;
          if (!this.enabled(this.triSrc[tri])) continue;
          if (this.count === this.ids.length) this.grow();
          const o = this.count * 9;
          this.load(tri, this.verts, o);
          // read from this.verts, not `v`: a grow above replaces the array
          const w = this.verts;
          if (Math.max(w[o], w[o + 3], w[o + 6]) < x0 || Math.min(w[o], w[o + 3], w[o + 6]) > x1) continue;
          if (Math.max(w[o + 2], w[o + 5], w[o + 8]) < z0 || Math.min(w[o + 2], w[o + 5], w[o + 8]) > z1) continue;
          this.ids[this.count++] = tri;
        }
      }
    // the moving solids: few, so each is checked in turn
    const mw = this.moverWorld;
    for (let t = 0; t < this.moverTris; t++) {
      if (!this.moverOn[this.moverOwner[t]]) continue;
      const m = t * 9;
      if (Math.max(mw[m + 1], mw[m + 4], mw[m + 7]) < y0 || Math.min(mw[m + 1], mw[m + 4], mw[m + 7]) > y1) continue;
      if (Math.max(mw[m], mw[m + 3], mw[m + 6]) < x0 || Math.min(mw[m], mw[m + 3], mw[m + 6]) > x1) continue;
      if (Math.max(mw[m + 2], mw[m + 5], mw[m + 8]) < z0 || Math.min(mw[m + 2], mw[m + 5], mw[m + 8]) > z1) continue;
      if (this.count === this.ids.length) this.grow();
      this.verts.set(mw.subarray(m, m + 9), this.count * 9);
      this.ids[this.count++] = this.triangles + t;
    }
  }

  private grow() {
    const ids = new Uint32Array(this.ids.length * 2);
    ids.set(this.ids);
    const verts = new Float64Array(ids.length * 9);
    verts.set(this.verts);
    this.ids = ids;
    this.verts = verts;
  }

  private tri = new Float64Array(9);

  /**
   * Surfaces directly under (x, z) between `yBottom` and `yTop`, merged into
   * `out`: a hit replaces what is there only when it is higher, so several
   * points can be probed into one result.
   */
  probe(x: number, z: number, yTop: number, yBottom: number, out: Probe): void {
    if (!this.inside(x, z)) return;
    this.gatherId++;
    const c = Math.floor((z - this.z0) / CELL) * this.nx + Math.floor((x - this.x0) / CELL);
    const t = this.tri;
    for (let e = this.cellStart[c]; e < this.cellStart[c + 1]; e++) {
      const tri = this.cellTris[e];
      if (this.triY1[tri] < yBottom || this.triY0[tri] > yTop || !this.enabled(this.triSrc[tri])) continue;
      this.load(tri, t, 0);
      this.probeTri(t, 0, tri, x, z, yTop, yBottom, out);
    }
    for (let k = 0; k < this.moverTris; k++) {
      if (!this.moverOn[this.moverOwner[k]]) continue;
      this.probeTri(this.moverWorld, k * 9, this.triangles + k, x, z, yTop, yBottom, out);
    }
  }

  /** One triangle's surfaces under (x, z), from the vertices at `v[o..o+8]`, merged into `out` (see `probe`). */
  private probeTri(v: ArrayLike<number>, o: number, tri: number, x: number, z: number, yTop: number, yBottom: number, out: Probe): void {
    const ax = v[o], ay = v[o + 1], az = v[o + 2];
    const bx = v[o + 3], by = v[o + 4], bz = v[o + 5];
    const cx = v[o + 6], cy = v[o + 7], cz = v[o + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-10) return;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) return;
    const py = l1 * ay + l2 * by + l3 * cy;
    if (py < yBottom || py > yTop || (py <= out.walkY && py <= out.anyY)) return;
    // the face normal's angle from vertical, either winding
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (Math.abs(ny) < 0.2 * len) return;
    if (Math.abs(ny) >= 0.6 * len && py > out.walkY) out.walkY = py;
    if (py > out.anyY) {
      if (ny < 0) (nx = -nx), (nz = -nz);
      const h = Math.hypot(nx, nz) || 1;
      out.anyY = py;
      out.anyTri = tri;
      out.downX = nx / h;
      out.downZ = nz / h;
    }
  }

  /**
   * How far a ray from (ox, oy, oz) along the unit direction (dx, dy, dz) goes
   * before it meets a solid surface, up to `max`: what keeps a camera behind the
   * chimp out of walls. The ray steps through the grid's cells along its plan,
   * nearest first, and stops once no farther cell can hold a nearer hit. The lift's
   * car and doors count, where they are now.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    this.gatherId++;
    let best = max;
    const t = this.tri;
    const hit = (v: ArrayLike<number>, o: number) => {
      const d = rayTriangle(ox, oy, oz, dx, dy, dz, v, o);
      if (d > 1e-4 && d < best) best = d;
    };
    let i = Math.floor((ox - this.x0) / CELL);
    let j = Math.floor((oz - this.z0) / CELL);
    const stepI = dx > 0 ? 1 : -1;
    const stepJ = dz > 0 ? 1 : -1;
    const deltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const deltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let maxX = dx > 0 ? (this.x0 + (i + 1) * CELL - ox) / dx : dx < 0 ? (this.x0 + i * CELL - ox) / dx : Infinity;
    let maxZ = dz > 0 ? (this.z0 + (j + 1) * CELL - oz) / dz : dz < 0 ? (this.z0 + j * CELL - oz) / dz : Infinity;
    let enter = 0;
    while (enter <= best) {
      const exit = Math.min(maxX, maxZ, best);
      if (i >= 0 && j >= 0 && i < this.nx && j < this.nz) {
        // only triangles reaching the heights the ray passes at in this cell
        const ya = oy + dy * enter;
        const yb = oy + dy * exit;
        const y0 = Math.min(ya, yb);
        const y1 = Math.max(ya, yb);
        const c = j * this.nx + i;
        for (let e = this.cellStart[c]; e < this.cellStart[c + 1]; e++) {
          const tri = this.cellTris[e];
          if (this.stamp[tri] === this.gatherId || this.triY1[tri] < y0 || this.triY0[tri] > y1) continue;
          this.stamp[tri] = this.gatherId;
          if (!this.enabled(this.triSrc[tri])) continue;
          this.load(tri, t, 0);
          hit(t, 0);
        }
      }
      // a hit inside this cell can't be beaten by a farther one
      if (best <= exit || (maxX === Infinity && maxZ === Infinity)) break;
      if (maxX < maxZ) {
        i += stepI;
        enter = maxX;
        maxX += deltaX;
      } else {
        j += stepJ;
        enter = maxZ;
        maxZ += deltaZ;
      }
    }
    for (let k = 0; k < this.moverTris; k++) if (this.moverOn[this.moverOwner[k]]) hit(this.moverWorld, k * 9);
    return best;
  }

  /** The mesh and face index of a triangle id, for labelling. */
  face(tri: number): { mesh: Mesh; face: number } {
    if (tri >= this.triangles) return { mesh: this.movers[this.moverOwner[tri - this.triangles]], face: this.moverFace[tri - this.triangles] };
    const src = this.triSrc[tri];
    return { mesh: this.sources[src].mesh, face: tri - this.srcStart[src] };
  }
}

/**
 * Where a ray meets a triangle (vertices at `v[o..o+8]`), as a distance along its
 * unit direction, either face (Moller and Trumbore); -1 when it misses.
 */
function rayTriangle(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, v: ArrayLike<number>, o: number): number {
  const ax = v[o], ay = v[o + 1], az = v[o + 2];
  const e1x = v[o + 3] - ax, e1y = v[o + 4] - ay, e1z = v[o + 5] - az;
  const e2x = v[o + 6] - ax, e2y = v[o + 7] - ay, e2z = v[o + 8] - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const w = (dx * qx + dy * qy + dz * qz) * inv;
  if (w < 0 || u + w > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/** A part of the lift that moves (see MeshMeta.kind): solid, but tested in its place, not in the grid. */
function mover(m: Mesh): boolean {
  return (m.metadata as MeshMeta | undefined)?.kind === "lift" && !m.hasThinInstances;
}

function solid(m: Mesh): boolean {
  const md = m.metadata as MeshMeta | undefined;
  if (!md || m.hasThinInstances) return false;
  if (md.kind === "special") return SOLID_SPECIALS.has(m.name);
  return (!md.kind || md.kind === "dynamic") && md.level !== "roof" && !SKIP_ROOMS.has(md.room) && !SKIP_MATS.has(md.matKey);
}

/**
 * Closest point on triangle (a, b, c) to p, written to `out` (Ericson,
 * Real-Time Collision Detection 5.1.5). Vertices come from `v` at offset `o`.
 */
export function closestOnTriangle(px: number, py: number, pz: number, v: Float64Array, o: number, out: Float64Array): void {
  const ax = v[o], ay = v[o + 1], az = v[o + 2];
  const bx = v[o + 3], by = v[o + 4], bz = v[o + 5];
  const cx = v[o + 6], cy = v[o + 7], cz = v[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return set(out, ax, ay, az);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set(out, bx, by, bz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return set(out, ax + abx * t, ay + aby * t, az + abz * t);
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set(out, cx, cy, cz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return set(out, ax + acx * t, ay + acy * t, az + acz * t);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return set(out, bx + (cx - bx) * t, by + (cy - by) * t, bz + (cz - bz) * t);
  }
  const k = 1 / (va + vb + vc);
  const s = vb * k;
  const t = vc * k;
  set(out, ax + abx * s + acx * t, ay + aby * s + acy * t, az + abz * s + acz * t);
}

function set(out: Float64Array, x: number, y: number, z: number) {
  out[0] = x;
  out[1] = y;
  out[2] = z;
}
