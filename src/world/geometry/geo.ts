import { Matrix, Mesh, Quaternion, Scene, Vector3, VertexData } from "@babylonjs/core";
import earcut from "earcut";
import { P2, pathLength } from "./curves";

/**
 * Geometry accumulator. Primitive builders produce small local Geos with
 * normals; rooms append them (transformed) into one Geo per material so the
 * scene ends up with few draw calls. Faces carry labels so picking can name
 * the original object.
 *
 * Winding: triangle (a, b, c) is visible from the side of (c - a) x (b - a),
 * matching Babylon's own builders.
 */
export class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] | null = null;
  idx: number[] = [];
  labels: { face: number; label: string }[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get faceCount(): number {
    return this.idx.length / 3;
  }

  vert(x: number, y: number, z: number, u = 0, v = 0, nx = 0, ny = 0, nz = 0): number {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.nrm.push(nx, ny, nz);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  computeNormals(): this {
    const n: number[] = [];
    VertexData.ComputeNormals(this.pos, this.idx, n);
    this.nrm = n;
    return this;
  }

  flip(): this {
    for (let i = 0; i < this.idx.length; i += 3) {
      const t = this.idx[i + 1];
      this.idx[i + 1] = this.idx[i + 2];
      this.idx[i + 2] = t;
    }
    for (let i = 0; i < this.nrm.length; i++) this.nrm[i] = -this.nrm[i];
    return this;
  }

  setLabel(label: string): void {
    const face = this.faceCount;
    const last = this.labels[this.labels.length - 1];
    if (last && last.face === face) last.label = label;
    else if (!last || last.label !== label) this.labels.push({ face, label });
  }

  /** Paint every vertex with a colour (used for vertex-coloured meshes). */
  paint(r: number, g: number, b: number, a = 1): this {
    this.col = [];
    for (let i = 0; i < this.vertexCount; i++) this.col.push(r, g, b, a);
    return this;
  }

  /** Append another Geo, optionally transformed. */
  add(other: Geo, m?: Matrix, label?: string): this {
    if (label) this.setLabel(label);
    const base = this.vertexCount;
    const p = new Vector3();
    const nm = m ? m.clone().invert().transpose() : null;
    if (other.col && !this.col) {
      this.col = [];
      for (let i = 0; i < base; i++) this.col.push(1, 1, 1, 1);
    }
    for (let i = 0; i < other.pos.length; i += 3) {
      if (m) {
        Vector3.TransformCoordinatesFromFloatsToRef(other.pos[i], other.pos[i + 1], other.pos[i + 2], m, p);
        this.pos.push(p.x, p.y, p.z);
        Vector3.TransformNormalFromFloatsToRef(other.nrm[i], other.nrm[i + 1], other.nrm[i + 2], nm!, p);
        p.normalize();
        this.nrm.push(p.x, p.y, p.z);
      } else {
        this.pos.push(other.pos[i], other.pos[i + 1], other.pos[i + 2]);
        this.nrm.push(other.nrm[i], other.nrm[i + 1], other.nrm[i + 2]);
      }
    }
    for (const v of other.uv) this.uv.push(v);
    if (this.col) {
      if (other.col) for (const c of other.col) this.col.push(c);
      else for (let i = 0; i < other.vertexCount; i++) this.col.push(1, 1, 1, 1);
    }
    const faceBase = this.faceCount;
    for (const i of other.idx) this.idx.push(i + base);
    if (!label) for (const l of other.labels) this.labels.push({ face: l.face + faceBase, label: l.label });
    return this;
  }

  /** Scale UVs in place. */
  scaleUV(su: number, sv: number): this {
    for (let i = 0; i < this.uv.length; i += 2) {
      this.uv[i] *= su;
      this.uv[i + 1] *= sv;
    }
    return this;
  }

  /** Remap all UVs into a sub-rectangle of an atlas. */
  remapUV(u0: number, v0: number, u1: number, v1: number): this {
    for (let i = 0; i < this.uv.length; i += 2) {
      this.uv[i] = u0 + this.uv[i] * (u1 - u0);
      this.uv[i + 1] = v0 + this.uv[i + 1] * (v1 - v0);
    }
    return this;
  }

  toVertexData(): VertexData {
    const vd = new VertexData();
    vd.positions = new Float32Array(this.pos);
    vd.normals = new Float32Array(this.nrm);
    vd.uvs = new Float32Array(this.uv);
    vd.indices = new Uint32Array(this.idx);
    if (this.col) vd.colors = new Float32Array(this.col);
    return vd;
  }

  build(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    if (this.vertexCount > 0) this.toVertexData().applyToMesh(mesh, false);
    mesh.metadata = { ...(mesh.metadata ?? {}), labels: this.labels.length ? this.labels : [{ face: 0, label: name }] };
    return mesh;
  }
}

// ---------------------------------------------------------------- transforms

export function xf(
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
  sx = 1,
  sy = sx,
  sz = sx,
  rotX = 0,
  rotZ = 0,
): Matrix {
  const q = Quaternion.RotationYawPitchRoll(rotY, rotX, rotZ);
  return Matrix.Compose(new Vector3(sx, sy, sz), q, new Vector3(x, y, z));
}

export function xfq(pos: Vector3, rot: Quaternion, scale = Vector3.One()): Matrix {
  return Matrix.Compose(scale, rot, pos);
}

/** Matrix that maps local +Y onto direction `dir` (unit), placed at pos. */
export function alignY(pos: Vector3, dir: Vector3, scale = Vector3.One(), spin = 0): Matrix {
  const up = Vector3.Up();
  const d = dir.normalizeToNew();
  let q: Quaternion;
  const dot = Vector3.Dot(up, d);
  if (dot > 0.99999) q = Quaternion.Identity();
  else if (dot < -0.99999) q = Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  else {
    const axis = Vector3.Cross(up, d).normalize();
    q = Quaternion.RotationAxis(axis, Math.acos(dot));
  }
  if (spin) q = q.multiply(Quaternion.RotationAxis(Vector3.Up(), spin));
  return Matrix.Compose(scale, q, pos);
}

// ---------------------------------------------------------------- primitives

/** Axis-aligned box centred at the origin, UVs in metres (scaled by uvScale). */
export function box(w: number, h: number, d: number, uvScale = 1): Geo {
  const g = new Geo();
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const s = uvScale;
  const face = (n: [number, number, number], c: [number, number, number][], uw: number, vh: number) => {
    const a = g.vert(...c[0], 0, 0, ...n);
    const b = g.vert(...c[1], uw * s, 0, ...n);
    const cc = g.vert(...c[2], uw * s, vh * s, ...n);
    const e = g.vert(...c[3], 0, vh * s, ...n);
    g.quad(a, b, cc, e);
  };
  face([0, 0, -1], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz]], w, h);
  face([0, 0, 1], [[hx, -hy, hz], [-hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz]], w, h);
  face([-1, 0, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz]], d, h);
  face([1, 0, 0], [[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz]], d, h);
  face([0, 1, 0], [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]], w, d);
  face([0, -1, 0], [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]], w, d);
  return fixWinding(g);
}

/** Box with its base at y = 0. */
export function boxOnFloor(w: number, h: number, d: number, uvScale = 1): Geo {
  return new Geo().add(box(w, h, d, uvScale), xf(0, h / 2, 0));
}

/** Flat quad in the XY plane facing -Z (towards a viewer in front), UV 0..1. */
export function plane(w: number, h: number, doubleSided = false): Geo {
  const g = new Geo();
  const a = g.vert(-w / 2, -h / 2, 0, 0, 0, 0, 0, -1);
  const b = g.vert(w / 2, -h / 2, 0, 1, 0, 0, 0, -1);
  const c = g.vert(w / 2, h / 2, 0, 1, 1, 0, 0, -1);
  const d = g.vert(-w / 2, h / 2, 0, 0, 1, 0, 0, -1);
  g.tri(a, b, c);
  g.tri(a, c, d);
  if (doubleSided) {
    const a2 = g.vert(-w / 2, -h / 2, 0, 1, 0, 0, 0, 1);
    const b2 = g.vert(w / 2, -h / 2, 0, 0, 0, 0, 0, 1);
    const c2 = g.vert(w / 2, h / 2, 0, 0, 1, 0, 0, 1);
    const d2 = g.vert(-w / 2, h / 2, 0, 1, 1, 0, 0, 1);
    g.tri(a2, c2, b2);
    g.tri(a2, d2, c2);
  }
  return g;
}

/** Horizontal quad facing +Y, UV 0..1 (u along x, v along z). */
export function floorQuad(w: number, d: number): Geo {
  const g = new Geo();
  const a = g.vert(-w / 2, 0, -d / 2, 0, 0, 0, 1, 0);
  const b = g.vert(w / 2, 0, -d / 2, 1, 0, 0, 1, 0);
  const c = g.vert(w / 2, 0, d / 2, 1, 1, 0, 1, 0);
  const e = g.vert(-w / 2, 0, d / 2, 0, 1, 0, 1, 0);
  g.tri(a, e, c);
  g.tri(a, c, b);
  return fixWinding(g);
}

/** Disc facing +Y with radial UVs centred at 0.5. */
export function disc(r: number, segments = 48): Geo {
  const g = new Geo();
  const c = g.vert(0, 0, 0, 0.5, 0.5, 0, 1, 0);
  const first = g.vertexCount;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    g.vert(Math.cos(a) * r, 0, Math.sin(a) * r, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, 0, 1, 0);
  }
  for (let i = 0; i < segments; i++) g.tri(c, first + i, first + i + 1);
  return fixWinding(g);
}

/**
 * Surface of revolution around Y. Profile points are (radius, y) from bottom
 * to top. UV u wraps around (0..uRepeat), v follows the profile length.
 */
export function lathe(profile: [number, number][], segments = 32, capTop = false, capBottom = false, uRepeat = 1): Geo {
  const g = new Geo();
  const vs: number[] = [0];
  for (let j = 1; j < profile.length; j++) {
    vs.push(vs[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  }
  const rows: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const row: number[] = [];
    for (let j = 0; j < profile.length; j++) {
      const [r, y] = profile[j];
      row.push(g.vert(ca * r, y, sa * r, (i / segments) * uRepeat, vs[j]));
    }
    rows.push(row);
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < profile.length - 1; j++) {
      g.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
    }
  }
  g.computeNormals();
  // seam fix: average normals of the duplicated first/last column
  for (let j = 0; j < profile.length; j++) {
    const a = rows[0][j] * 3;
    const b = rows[segments][j] * 3;
    for (let k = 0; k < 3; k++) {
      const m = (g.nrm[a + k] + g.nrm[b + k]) / 2;
      g.nrm[a + k] = m;
      g.nrm[b + k] = m;
    }
  }
  if (capTop) {
    const [r, y] = profile[profile.length - 1];
    if (r > 1e-4) g.add(new Geo().add(disc(r, segments), xf(0, y, 0)));
  }
  if (capBottom) {
    const [r, y] = profile[0];
    if (r > 1e-4) g.add(disc(r, segments).flip(), xf(0, y, 0));
  }
  return g;
}

export function cylinder(r: number, h: number, segments = 24, caps = true, rTop = r): Geo {
  return lathe(
    [
      [r, 0],
      [rTop, h],
    ],
    segments,
    caps,
    caps,
  );
}

export function sphere(r: number, segments = 16, rings = 12, squashY = 1): Geo {
  const prof: [number, number][] = [];
  for (let j = 0; j <= rings; j++) {
    const a = -Math.PI / 2 + (j / rings) * Math.PI;
    prof.push([Math.cos(a) * r + 1e-5, Math.sin(a) * r * squashY]);
  }
  return lathe(prof, segments);
}

export function torus(R: number, r: number, segments = 32, tube = 10): Geo {
  const g = new Geo();
  const rows: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const row: number[] = [];
    for (let j = 0; j <= tube; j++) {
      const b = (j / tube) * Math.PI * 2;
      const rr = R + Math.cos(b) * r;
      const nx = Math.cos(b) * Math.cos(a);
      const nz = Math.cos(b) * Math.sin(a);
      const ny = Math.sin(b);
      row.push(g.vert(Math.cos(a) * rr, Math.sin(b) * r, Math.sin(a) * rr, i / segments, j / tube, nx, ny, nz));
    }
    rows.push(row);
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < tube; j++) g.quad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]);
  return g;
}

/**
 * Rounded "soft" box (cushions, poufs, upholstery). r = edge radius,
 * bulge pushes face centres outward like a stuffed cushion.
 */
export function softBox(w: number, h: number, d: number, r: number, bulge = 0, m = 3): Geo {
  const g = new Geo();
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  r = Math.min(r, hx * 0.999, hy * 0.999, hz * 0.999);
  const ix = hx - r;
  const iy = hy - r;
  const iz = hz - r;
  const coords = (hh: number, ii: number) => {
    const c: number[] = [];
    for (let k = 0; k <= m; k++) c.push(-hh + (k / m) * (hh - ii));
    c.push(-ii * 0.33, ii * 0.33);
    for (let k = 0; k <= m; k++) c.push(ii + (k / m) * (hh - ii));
    return c;
  };
  const cx = coords(hx, ix);
  const cy = coords(hy, iy);
  const cz = coords(hz, iz);
  const emit = (fx: (a: number, b: number) => [number, number, number], ca: number[], cb: number[], ha: number, hb: number) => {
    const grid: number[][] = [];
    for (let i = 0; i < ca.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < cb.length; j++) {
        const [px, py, pz] = fx(ca[i], cb[j]);
        const qx = Math.max(-ix, Math.min(ix, px));
        const qy = Math.max(-iy, Math.min(iy, py));
        const qz = Math.max(-iz, Math.min(iz, pz));
        let nx = px - qx;
        let ny = py - qy;
        let nz = pz - qz;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const s = ca[i] / ha;
        const t = cb[j] / hb;
        const bl = bulge * Math.max(0, 1 - s * s) * Math.max(0, 1 - t * t);
        row.push(
          g.vert(qx + nx * (r + bl), qy + ny * (r + bl), qz + nz * (r + bl), (ca[i] + ha) / (2 * ha), (cb[j] + hb) / (2 * hb), nx, ny, nz),
        );
      }
      grid.push(row);
    }
    for (let i = 0; i < ca.length - 1; i++)
      for (let j = 0; j < cb.length - 1; j++) g.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
  };
  // each face: first param axis a, second b, chosen so quads face outward
  emit((a, b) => [a, b, -hz], cx, cy, hx, hy); // -Z
  emit((a, b) => [b, a, hz], cy, cx, hy, hx); // +Z
  emit((a, b) => [-hx, a, b], cy, cz, hy, hz); // -X
  emit((a, b) => [hx, b, a], cz, cy, hz, hy); // +X
  emit((a, b) => [b, hy, a], cz, cx, hz, hx); // +Y
  emit((a, b) => [a, -hy, b], cx, cz, hx, hz); // -Y
  fixWinding(g);
  return g;
}

/** Make every triangle face the direction of its vertex normals. */
export function fixWinding(g: Geo): Geo {
  const P = g.pos;
  const N = g.nrm;
  for (let i = 0; i < g.idx.length; i += 3) {
    const a = g.idx[i];
    const b = g.idx[i + 1];
    const c = g.idx[i + 2];
    const e1x = P[c * 3] - P[a * 3];
    const e1y = P[c * 3 + 1] - P[a * 3 + 1];
    const e1z = P[c * 3 + 2] - P[a * 3 + 2];
    const e2x = P[b * 3] - P[a * 3];
    const e2y = P[b * 3 + 1] - P[a * 3 + 1];
    const e2z = P[b * 3 + 2] - P[a * 3 + 2];
    const fx = e1y * e2z - e1z * e2y;
    const fy = e1z * e2x - e1x * e2z;
    const fz = e1x * e2y - e1y * e2x;
    const nx = N[a * 3] + N[b * 3] + N[c * 3];
    const ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
    const nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz < 0) {
      g.idx[i + 1] = c;
      g.idx[i + 2] = b;
    }
  }
  return g;
}

/** Soft box sitting on the floor (base at y = 0). */
export function softBoxOnFloor(w: number, h: number, d: number, r: number, bulge = 0): Geo {
  return new Geo().add(softBox(w, h, d, r, bulge), xf(0, h / 2, 0));
}

// ---------------------------------------------------------------- plan-based

/** Triangulated horizontal face from a CCW loop (with optional holes). UVs = world xz * uvScale. */
export function polygonFace(loop: P2[], y: number, up = true, holes: P2[][] = [], uvScale = 1): Geo {
  const g = new Geo();
  const flat: number[] = [];
  const holeIdx: number[] = [];
  const all: P2[] = [];
  for (const p of loop) {
    flat.push(p.x, p.z);
    all.push(p);
  }
  for (const h of holes) {
    holeIdx.push(all.length);
    for (const p of h) {
      flat.push(p.x, p.z);
      all.push(p);
    }
  }
  const tris = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);
  const ny = up ? 1 : -1;
  for (const p of all) g.vert(p.x, y, p.z, p.x * uvScale, p.z * uvScale, 0, ny, 0);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i];
    const b = tris[i + 1];
    const c = tris[i + 2];
    const A = all[a];
    const B = all[b];
    const C = all[c];
    // normal y of (c-a)x(b-a) = (cz-az)(bx-ax) - (cx-ax)(bz-az)
    const fy = (C.z - A.z) * (B.x - A.x) - (C.x - A.x) * (B.z - A.z);
    if ((fy > 0) === up) g.tri(a, b, c);
    else g.tri(a, c, b);
  }
  return g;
}

/** Extruded slab between y0 and y1 from a CCW loop with optional holes. */
export function slab(loop: P2[], y0: number, y1: number, holes: P2[][] = [], uvScale = 1): Geo {
  const g = new Geo();
  g.add(polygonFace(loop, y1, true, holes, uvScale));
  g.add(polygonFace(loop, y0, false, holes, uvScale));
  g.add(wallStrip(loop, y0, y1, true, uvScale));
  for (const h of holes) g.add(wallStrip([...h].reverse(), y0, y1, true, uvScale));
  return g;
}

/** Vertical strip following a path; faces to the right of travel (outward for CCW). */
export function wallStrip(path: P2[], y0: number, y1: number, closed = false, uvScale = 1, flat = true): Geo {
  const g = new Geo();
  const n = path.length;
  const segs = closed ? n : n - 1;
  let s = 0;
  for (let i = 0; i < segs; i++) {
    const p = path[i];
    const q = path[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 1e-6) continue;
    const nx = (q.z - p.z) / len;
    const nz = -(q.x - p.x) / len;
    if (flat) {
      const a = g.vert(p.x, y0, p.z, s * uvScale, y0 * uvScale, nx, 0, nz);
      const b = g.vert(q.x, y0, q.z, (s + len) * uvScale, y0 * uvScale, nx, 0, nz);
      const c = g.vert(q.x, y1, q.z, (s + len) * uvScale, y1 * uvScale, nx, 0, nz);
      const d = g.vert(p.x, y1, p.z, s * uvScale, y1 * uvScale, nx, 0, nz);
      g.tri(a, b, c);
      g.tri(a, c, d);
    }
    s += len;
  }
  if (!flat) g.computeNormals();
  return g;
}

/** Smooth-shaded vertical ribbon (curved glass, curved walls). Faces right of travel. */
export function ribbonWall(path: P2[], y0: number, y1: number, closed = false, uvScale = 1): Geo {
  const g = new Geo();
  const n = path.length;
  const cnt = closed ? n + 1 : n;
  let s = 0;
  const bot: number[] = [];
  const top: number[] = [];
  for (let i = 0; i < cnt; i++) {
    const p = path[i % n];
    if (i > 0) s += Math.hypot(p.x - path[(i - 1) % n].x, p.z - path[(i - 1) % n].z);
    const prev = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const l = Math.hypot(tx, tz) || 1;
    const nx = tz / l;
    const nz = -tx / l;
    bot.push(g.vert(p.x, y0, p.z, s * uvScale, y0 * uvScale, nx, 0, nz));
    top.push(g.vert(p.x, y1, p.z, s * uvScale, y1 * uvScale, nx, 0, nz));
  }
  for (let i = 0; i < cnt - 1; i++) {
    g.tri(bot[i], bot[i + 1], top[i + 1]);
    g.tri(bot[i], top[i + 1], top[i]);
  }
  return g;
}

/**
 * Sweep a 2D profile along a 3D path. Profile x = right of travel, y = along
 * the reference "up" (projected perpendicular to the tangent). Profile should
 * be counter-clockwise for outward faces. UV u = distance along path * uvScale,
 * v = distance around profile * uvScale.
 */
export function sweep(
  profile: [number, number][],
  path: Vector3[],
  opts: { closedPath?: boolean; closedProfile?: boolean; up?: Vector3 | ((i: number, t: Vector3) => Vector3); uvScale?: number; caps?: boolean; scale?: (i: number) => number; smooth?: boolean } = {},
): Geo {
  const { closedPath = false, closedProfile = true, uvScale = 1, caps = true, scale, smooth = false } = opts;
  const upOpt = opts.up ?? Vector3.Up();
  const g = new Geo();
  const n = path.length;
  const cnt = closedPath ? n + 1 : n;
  const prof = closedProfile ? [...profile, profile[0]] : profile;
  const pv: number[] = [0];
  for (let j = 1; j < prof.length; j++) pv.push(pv[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]));
  const rings: number[][] = [];
  const frames: { X: Vector3; Y: Vector3; P: Vector3 }[] = [];
  let s = 0;
  for (let i = 0; i < cnt; i++) {
    const P = path[i % n];
    if (i > 0) s += Vector3.Distance(P, path[(i - 1) % n]);
    const prev = path[closedPath ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = path[closedPath ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const T = next.subtract(prev).normalize();
    const R = typeof upOpt === "function" ? upOpt(i % n, T) : upOpt;
    const Y = R.subtract(T.scale(Vector3.Dot(R, T))).normalize();
    const X = Vector3.Cross(Y, T).normalize();
    const k = scale ? scale(i % n) : 1;
    frames.push({ X, Y, P });
    const ring: number[] = [];
    for (let j = 0; j < prof.length; j++) {
      const [px, py] = prof[j];
      const w = P.add(X.scale(px * k)).add(Y.scale(py * k));
      ring.push(g.vert(w.x, w.y, w.z, s * uvScale, pv[j] * uvScale));
    }
    rings.push(ring);
  }
  for (let i = 0; i < cnt - 1; i++)
    for (let j = 0; j < prof.length - 1; j++) {
      const A = rings[i][j];
      const B = rings[i][j + 1];
      const C = rings[i + 1][j + 1];
      const D = rings[i + 1][j];
      g.tri(A, C, B);
      g.tri(A, D, C);
    }
  if (smooth) g.computeNormals();
  else {
    // flat-ish shading: compute normals then keep as is (profile corners duplicated if needed)
    g.computeNormals();
  }
  if (caps && !closedPath && closedProfile) {
    const flatProf: number[] = [];
    for (const p of profile) flatProf.push(p[0], p[1]);
    const tris = earcut(flatProf);
    for (const [fi, dirSign] of [
      [0, -1],
      [cnt - 1, 1],
    ] as const) {
      const { X, Y, P } = frames[fi];
      const T = Vector3.Cross(X, Y);
      const nrm = T.scale(dirSign);
      const k = scale ? scale(fi % n) : 1;
      const base = g.vertexCount;
      for (const p of profile) {
        const w = P.add(X.scale(p[0] * k)).add(Y.scale(p[1] * k));
        g.vert(w.x, w.y, w.z, p[0] * uvScale, p[1] * uvScale, nrm.x, nrm.y, nrm.z);
      }
      for (let t = 0; t < tris.length; t += 3) {
        const a = base + tris[t];
        const b = base + tris[t + 1];
        const c = base + tris[t + 2];
        const pa = new Vector3(g.pos[a * 3], g.pos[a * 3 + 1], g.pos[a * 3 + 2]);
        const pb = new Vector3(g.pos[b * 3], g.pos[b * 3 + 1], g.pos[b * 3 + 2]);
        const pc = new Vector3(g.pos[c * 3], g.pos[c * 3 + 1], g.pos[c * 3 + 2]);
        const f = Vector3.Cross(pc.subtract(pa), pb.subtract(pa));
        if (Vector3.Dot(f, nrm) >= 0) g.tri(a, b, c);
        else g.tri(a, c, b);
      }
    }
  }
  return g;
}

/** Profile with duplicated corner vertices gives crisp edges for rectangles. */
export function rectProfile(w: number, h: number, cx = 0, cy = 0): [number, number][] {
  return [
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
    [cx - w / 2, cy - h / 2],
  ];
}

export function circleProfile(r: number, n = 12): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Sweep of a rectangle along a path with hard edges (each side separate). */
export function beam(path: Vector3[], w: number, h: number, opts: { closedPath?: boolean; up?: Vector3 | ((i: number, t: Vector3) => Vector3); uvScale?: number; caps?: boolean; offsetX?: number; offsetY?: number } = {}): Geo {
  const { offsetX = 0, offsetY = 0 } = opts;
  const g = new Geo();
  const x0 = offsetX - w / 2;
  const x1 = offsetX + w / 2;
  const y0 = offsetY - h / 2;
  const y1 = offsetY + h / 2;
  const sides: [number, number][][] = [
    [[x1, y0], [x1, y1]],
    [[x1, y1], [x0, y1]],
    [[x0, y1], [x0, y0]],
    [[x0, y0], [x1, y0]],
  ];
  for (const side of sides) g.add(sweep(side, path, { ...opts, closedProfile: false, caps: false }));
  if (opts.caps !== false && !opts.closedPath) {
    g.add(sweep(rectProfile(w, h, offsetX, offsetY), [path[0], path[0].add(path[1].subtract(path[0]).normalize().scale(1e-4))], { up: opts.up, caps: true }));
    const n = path.length;
    g.add(sweep(rectProfile(w, h, offsetX, offsetY), [path[n - 1].subtract(path[n - 1].subtract(path[n - 2]).normalize().scale(1e-4)), path[n - 1]], { up: opts.up, caps: true }));
  }
  return g;
}

/** Tube along a 3D path with radius per point. */
export function tube(path: Vector3[], radius: number | ((t: number) => number), sides = 10, caps = false, uvScale = 1): Geo {
  const n = path.length;
  const total = path.reduce((acc, p, i) => (i ? acc + Vector3.Distance(p, path[i - 1]) : 0), 0);
  let acc = 0;
  const radii = path.map((p, i) => {
    if (i) acc += Vector3.Distance(p, path[i - 1]);
    return typeof radius === "number" ? radius : radius(total ? acc / total : 0);
  });
  // choose a reference that is not parallel to the path
  const d = path[n - 1].subtract(path[0]).normalize();
  const ref = Math.abs(d.y) > 0.9 ? new Vector3(1, 0, 0) : Vector3.Up();
  return sweep(circleProfile(1, sides), path, { up: ref, caps, scale: (i) => radii[i], smooth: true, uvScale });
}

/** Map a plan path into 3D at height y. */
export function at(path: P2[], y: number | ((i: number) => number)): Vector3[] {
  return path.map((p, i) => new Vector3(p.x, typeof y === "number" ? y : y(i), p.z));
}

export { pathLength };
