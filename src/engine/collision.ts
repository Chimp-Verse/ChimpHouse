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
    for (const m of scene.meshes) {
      if (!(m instanceof Mesh) || !solid(m)) continue;
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
    const v = this.verts;
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
          if (Math.max(v[o], v[o + 3], v[o + 6]) < x0 || Math.min(v[o], v[o + 3], v[o + 6]) > x1) continue;
          if (Math.max(v[o + 2], v[o + 5], v[o + 8]) < z0 || Math.min(v[o + 2], v[o + 5], v[o + 8]) > z1) continue;
          this.ids[this.count++] = tri;
        }
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
      const ax = t[0], ay = t[1], az = t[2];
      const bx = t[3], by = t[4], bz = t[5];
      const cx = t[6], cy = t[7], cz = t[8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-10) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * ay + l2 * by + l3 * cy;
      if (y < yBottom || y > yTop || (y <= out.walkY && y <= out.anyY)) continue;
      // the face normal's angle from vertical, either winding
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (Math.abs(ny) < 0.2 * len) continue;
      if (Math.abs(ny) >= 0.6 * len && y > out.walkY) out.walkY = y;
      if (y > out.anyY) {
        if (ny < 0) (nx = -nx), (nz = -nz);
        const h = Math.hypot(nx, nz) || 1;
        out.anyY = y;
        out.anyTri = tri;
        out.downX = nx / h;
        out.downZ = nz / h;
      }
    }
  }

  /** The mesh and face index of a triangle id, for labelling. */
  face(tri: number): { mesh: Mesh; face: number } {
    const src = this.triSrc[tri];
    return { mesh: this.sources[src].mesh, face: tri - this.srcStart[src] };
  }
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
