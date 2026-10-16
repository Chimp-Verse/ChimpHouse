// Signed distance fields: the chimp is modelled as smooth shapes (spheres, ellipsoids,
// tapered capsules) blended together, the way a sculptor builds up clay, and
// avatar/mesher.ts turns the result into a mesh. A distance is negative inside the
// body, positive outside and zero on its skin.
//
// Plain numbers and no Babylon, so the same code can run in a worker.

export type V3 = [number, number, number];

/** The kinds of shape (plain numbers, not an enum: Node's type stripping can run this file as it is). */
const Kind = { Sphere: 0, Ellipsoid: 1, Cone: 2, Box: 3, Torus: 4 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

/**
 * One shape: where it is, which bone moves it, and what kind of surface it
 * makes. Shapes are evaluated millions of times while meshing, so each kind's
 * numbers are worked out once, here, and kept as plain fields.
 */
export class Prim {
  kind: Kind = Kind.Sphere as Kind;
  // centre (sphere, ellipsoid, box) or start (cone)
  cx = 0;
  cy = 0;
  cz = 0;
  // ellipsoid and box: local axes (unit), radii or half extents
  ux = 1;
  uy = 0;
  uz = 0;
  vx = 0;
  vy = 1;
  vz = 0;
  wx = 0;
  wy = 0;
  wz = 1;
  rx = 0;
  ry = 0;
  rz = 0;
  /** box: rounding radius; box: bend of its local x-y plane (y -= bend·x²) */
  round = 0;
  bend = 0;
  // cone: end, radii and the constants of IQ's round cone
  ex = 0;
  ey = 0;
  ez = 0;
  r1 = 0;
  r2 = 0;
  private bax = 0;
  private bay = 0;
  private baz = 0;
  private l2 = 1;
  private rr = 0;
  private a2 = 0;
  private il2 = 1;
  /** bounding sphere, for skipping shapes far from where the field is wanted */
  bx = 0;
  by = 0;
  bz = 0;
  br = 0;
  /** the bone this shape moves with (an index into the rig) */
  bone = 0;
  /** a name, for debugging and for region rules that ask which shape is nearest */
  tag = "";

  static sphere(c: V3, r: number, bone: number, tag = ""): Prim {
    const p = new Prim();
    p.kind = Kind.Sphere;
    [p.cx, p.cy, p.cz] = c;
    p.r1 = r;
    p.setBounds(c, r);
    p.bone = bone;
    p.tag = tag;
    return p;
  }

  /**
   * An ellipsoid with radii `r` along its axes. `forward` and `up` turn it: its
   * local z points along `forward`, its y as near `up` as is square to that.
   */
  static ellipsoid(c: V3, r: V3, bone: number, tag = "", forward: V3 = [0, 0, 1], up: V3 = [0, 1, 0]): Prim {
    const p = new Prim();
    p.kind = Kind.Ellipsoid;
    [p.cx, p.cy, p.cz] = c;
    p.setAxes(forward, up);
    [p.rx, p.ry, p.rz] = r;
    p.setBounds(c, Math.max(r[0], r[1], r[2]));
    p.bone = bone;
    p.tag = tag;
    return p;
  }

  /** A capsule from a (radius r1) to b (radius r2), tapering between: limbs, fingers, toes. */
  static cone(a: V3, b: V3, r1: number, r2: number, bone: number, tag = ""): Prim {
    const p = new Prim();
    p.kind = Kind.Cone;
    [p.cx, p.cy, p.cz] = a;
    [p.ex, p.ey, p.ez] = b;
    p.r1 = r1;
    p.r2 = r2;
    p.bax = b[0] - a[0];
    p.bay = b[1] - a[1];
    p.baz = b[2] - a[2];
    p.l2 = Math.max(1e-12, p.bax * p.bax + p.bay * p.bay + p.baz * p.baz);
    p.rr = r1 - r2;
    p.a2 = p.l2 - p.rr * p.rr;
    p.il2 = 1 / p.l2;
    const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    p.setBounds(mid, Math.sqrt(p.l2) / 2 + Math.max(r1, r2));
    p.bone = bone;
    p.tag = tag;
    return p;
  }

  /** A box with rounded edges, half extents `h`, turned as an ellipsoid is; `bend` curves it (a smile's line). */
  static box(c: V3, h: V3, round: number, bone: number, tag = "", forward: V3 = [0, 0, 1], up: V3 = [0, 1, 0], bend = 0): Prim {
    const p = new Prim();
    p.kind = Kind.Box;
    [p.cx, p.cy, p.cz] = c;
    p.setAxes(forward, up);
    [p.rx, p.ry, p.rz] = h;
    p.round = round;
    p.bend = bend;
    p.setBounds(c, Math.hypot(h[0], h[1] + Math.abs(bend) * h[0] * h[0], h[2]) + round);
    p.bone = bone;
    p.tag = tag;
    return p;
  }

  /**
   * A ring: centre c, lying square to `axis`, `R` from its middle to its tube's,
   * its tube `r` thick (as `rz`, how flat the tube is along the axis: 1 round).
   */
  static torus(c: V3, axis: V3, R: number, r: number, bone: number, tag = "", flat = 1): Prim {
    const p = new Prim();
    p.kind = Kind.Torus;
    [p.cx, p.cy, p.cz] = c;
    // its axis is the local y
    const a = norm(axis);
    p.setAxes(Math.abs(a[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0], a);
    [p.vx, p.vy, p.vz] = a;
    p.rx = R;
    p.r1 = r;
    p.rz = flat;
    p.setBounds(c, R + r);
    p.bone = bone;
    p.tag = tag;
    return p;
  }

  private setAxes(forward: V3, up: V3) {
    const f = norm(forward);
    // right = up × forward (left-handed, as Babylon), then up again square to both
    let r = cross(up, f);
    if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = cross([0, 0, 1], f);
    r = norm(r);
    const u = cross(f, r);
    [this.ux, this.uy, this.uz] = r;
    [this.vx, this.vy, this.vz] = u;
    [this.wx, this.wy, this.wz] = f;
  }

  private setBounds(c: V3, r: number) {
    [this.bx, this.by, this.bz] = c;
    this.br = r;
  }

  /** Signed distance from (x, y, z) to this shape's surface. */
  d(x: number, y: number, z: number): number {
    switch (this.kind) {
      case Kind.Sphere: {
        const dx = x - this.cx;
        const dy = y - this.cy;
        const dz = z - this.cz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) - this.r1;
      }
      case Kind.Ellipsoid: {
        const dx = x - this.cx;
        const dy = y - this.cy;
        const dz = z - this.cz;
        const lx = (dx * this.ux + dy * this.uy + dz * this.uz) / this.rx;
        const ly = (dx * this.vx + dy * this.vy + dz * this.vz) / this.ry;
        const lz = (dx * this.wx + dy * this.wy + dz * this.wz) / this.rz;
        const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
        const k1 = Math.sqrt((lx * lx) / (this.rx * this.rx) + (ly * ly) / (this.ry * this.ry) + (lz * lz) / (this.rz * this.rz));
        if (k1 < 1e-9) return -Math.min(this.rx, this.ry, this.rz);
        return (k0 * (k0 - 1)) / k1;
      }
      case Kind.Cone: {
        // Inigo Quilez's round cone: exact, one square root
        const pax = x - this.cx;
        const pay = y - this.cy;
        const paz = z - this.cz;
        const l2 = this.l2;
        const yy = pax * this.bax + pay * this.bay + paz * this.baz;
        const zz = yy - l2;
        const qx = pax * l2 - this.bax * yy;
        const qy = pay * l2 - this.bay * yy;
        const qz = paz * l2 - this.baz * yy;
        const x2 = qx * qx + qy * qy + qz * qz;
        const y2 = yy * yy * l2;
        const z2 = zz * zz * l2;
        const rr = this.rr;
        const k = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(zz) * this.a2 * z2 > k) return Math.sqrt(x2 + z2) * this.il2 - this.r2;
        if (Math.sign(yy) * this.a2 * y2 < k) return Math.sqrt(x2 + y2) * this.il2 - this.r1;
        return (Math.sqrt(x2 * this.a2 * this.il2) + yy * rr) * this.il2 - this.r1;
      }
      case Kind.Torus: {
        const dx = x - this.cx;
        const dy = y - this.cy;
        const dz = z - this.cz;
        // along the axis, and across the ring's plane
        const ay = dx * this.vx + dy * this.vy + dz * this.vz;
        const px = dx - ay * this.vx;
        const py = dy - ay * this.vy;
        const pz = dz - ay * this.vz;
        const q = Math.sqrt(px * px + py * py + pz * pz) - this.rx;
        return Math.sqrt(q * q + (ay * ay) / (this.rz * this.rz)) * Math.min(1, this.rz) - this.r1;
      }
      default: {
        const dx = x - this.cx;
        const dy = y - this.cy;
        const dz = z - this.cz;
        const lx = dx * this.ux + dy * this.uy + dz * this.uz;
        const ly = dx * this.vx + dy * this.vy + dz * this.vz - this.bend * lx * lx;
        const lz = dx * this.wx + dy * this.wy + dz * this.wz;
        const qx = Math.abs(lx) - this.rx;
        const qy = Math.abs(ly) - this.ry;
        const qz = Math.abs(lz) - this.rz;
        const ox = Math.max(qx, 0);
        const oy = Math.max(qy, 0);
        const oz = Math.max(qz, 0);
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - this.round;
      }
    }
  }

  /** The same shape grown by o all round (o < 0 shrinks it): clothes sit this far over the skin. */
  inflate(o: number): Prim {
    const c: V3 = [this.cx, this.cy, this.cz];
    const fwd: V3 = [this.wx, this.wy, this.wz];
    const up: V3 = [this.vx, this.vy, this.vz];
    switch (this.kind) {
      case Kind.Sphere:
        return Prim.sphere(c, Math.max(1e-4, this.r1 + o), this.bone, this.tag);
      case Kind.Ellipsoid:
        return Prim.ellipsoid(c, [Math.max(1e-4, this.rx + o), Math.max(1e-4, this.ry + o), Math.max(1e-4, this.rz + o)], this.bone, this.tag, fwd, up);
      case Kind.Cone:
        return Prim.cone(c, [this.ex, this.ey, this.ez], Math.max(1e-4, this.r1 + o), Math.max(1e-4, this.r2 + o), this.bone, this.tag);
      case Kind.Torus:
        return Prim.torus(c, up, this.rx, Math.max(1e-4, this.r1 + o), this.bone, this.tag, this.rz);
      default:
        return Prim.box(c, [this.rx, this.ry, this.rz], Math.max(0, this.round + o), this.bone, this.tag, fwd, up, this.bend);
    }
  }

  /** How far (x, y, z) is from this shape's bounding sphere: never more than its true distance. */
  far(x: number, y: number, z: number): number {
    return Math.hypot(x - this.bx, y - this.by, z - this.bz) - this.br;
  }
}

/**
 * How a shape joins what came before it: added (a smooth union), cut away, or
 * kept only where they meet. A fork marks the field so far as a trunk; each limb
 * after it blends smoothly with the trunk but meets the other limbs with a hard
 * edge, so fingers grow out of a palm without webbing to each other.
 */
export const Mode = { Add: 0, Cut: 1, Meet: 2, Fork: 3, Limb: 4 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export interface Op {
  mode: Mode;
  /** the shape, or for a limb of several shapes, `sub` */
  prim: Prim | null;
  sub: Field | null;
  /** blend width in metres: 0 is a hard join, a few centimetres a soft fleshy one */
  k: number;
  /** bounding sphere of the shape or limb (a fork has none: it is always kept) */
  bx: number;
  by: number;
  bz: number;
  br: number;
}

/** Smooth minimum (polynomial): a union whose seam is rounded over width k. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * A field built from shapes in order: each added, cut away or intersected with
 * the result so far. Order matters, as a sculptor's does: an ear added after
 * the mouth is cut isn't cut by it.
 */
export class Field {
  readonly ops: Op[] = [];

  add<S extends Prim | Field>(shape: S, k = 0): S {
    this.pushShape(Mode.Add, shape, k);
    return shape;
  }

  cut<S extends Prim | Field>(shape: S, k = 0): S {
    this.pushShape(Mode.Cut, shape, k);
    return shape;
  }

  meet<S extends Prim | Field>(shape: S, k = 0): S {
    this.pushShape(Mode.Meet, shape, k);
    return shape;
  }

  private pushShape(mode: Mode, shape: Prim | Field, k: number) {
    if (shape instanceof Prim) this.push(mode, shape, null, k);
    else this.push(mode, null, shape, k);
  }

  /** From here on, limbs blend with the field as it stands now, not with each other. */
  fork(): void {
    this.ops.push({ mode: Mode.Fork, prim: null, sub: null, k: 0, bx: 0, by: 0, bz: 0, br: Infinity });
  }

  /** A limb (a shape, or several blended among themselves) blended with the trunk over k. */
  limb(shape: Prim | Field, k: number): void {
    this.pushShape(Mode.Limb, shape, k);
  }

  private push(mode: Mode, prim: Prim | null, sub: Field | null, k: number) {
    let bx: number, by: number, bz: number, br: number;
    if (prim) [bx, by, bz, br] = [prim.bx, prim.by, prim.bz, prim.br];
    else {
      // a sphere round every shape of the limb
      const ps = sub!.prims();
      bx = ps.reduce((a, q) => a + q.bx, 0) / ps.length;
      by = ps.reduce((a, q) => a + q.by, 0) / ps.length;
      bz = ps.reduce((a, q) => a + q.bz, 0) / ps.length;
      br = Math.max(...ps.map((q) => Math.hypot(q.bx - bx, q.by - by, q.bz - bz) + q.br));
    }
    this.ops.push({ mode, prim, sub, k, bx, by, bz, br });
  }

  /** Every shape in the field, limbs' shapes included. */
  prims(): Prim[] {
    const out: Prim[] = [];
    for (const op of this.ops) {
      if (op.prim) out.push(op.prim);
      else if (op.sub) out.push(...op.sub.prims());
    }
    return out;
  }

  /** The field at (x, y, z), from every operation, or only those listed in `only` (indices into ops). */
  at(x: number, y: number, z: number, only?: ArrayLike<number>, count = only ? only.length : this.ops.length): number {
    let d = 1e9;
    let trunk = 1e9;
    for (let n = 0; n < count; n++) {
      const op = this.ops[only ? only[n] : n];
      if (op.mode === Mode.Fork) {
        trunk = d;
        continue;
      }
      // an added shape (or limb) whose bounds are already further than what is here, by
      // more than its blend, can't change the field: skip it without working it out
      if (op.mode === Mode.Add || op.mode === Mode.Limb) {
        const bx = x - op.bx;
        const by = y - op.by;
        const bz = z - op.bz;
        const reach = Math.sqrt(bx * bx + by * by + bz * bz) - op.br;
        if (reach > d + op.k && (op.mode === Mode.Add || reach > trunk + op.k)) continue;
      }
      const e = op.prim ? op.prim.d(x, y, z) : op.sub!.at(x, y, z);
      if (op.mode === Mode.Add) d = smin(d, e, op.k);
      else if (op.mode === Mode.Cut) d = -smin(-d, e, op.k);
      else if (op.mode === Mode.Meet) d = -smin(-d, -e, op.k);
      else {
        const l = smin(trunk, e, op.k);
        if (l < d) d = l;
      }
    }
    return d;
  }

  /**
   * The operations that can matter within `half` of a point (a block's centre
   * and half diagonal): those whose shape comes within the band round the
   * surface, plus their blend width. Others leave the field's sign, and its
   * value near the surface, unchanged there.
   */
  near(cx: number, cy: number, cz: number, half: number, band: number, out: number[]): number[] {
    out.length = 0;
    for (let i = 0; i < this.ops.length; i++) {
      const op = this.ops[i];
      if (Math.hypot(cx - op.bx, cy - op.by, cz - op.bz) - op.br < half + band + op.k) out.push(i);
    }
    return out;
  }

  /** The shapes of the listed operations (limbs' shapes included), for asking which is nearest. */
  primsOf(list: ArrayLike<number>, out: Prim[]): Prim[] {
    out.length = 0;
    for (let n = 0; n < list.length; n++) {
      const op = this.ops[list[n]];
      if (op.prim) out.push(op.prim);
      else if (op.sub) for (const q of op.sub.prims()) out.push(q);
    }
    return out;
  }
}

export function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function len(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Distance from p to the segment a–b, and how far along it (0 to 1) the nearest point is. */
export function segment(px: number, py: number, pz: number, a: V3, b: V3): { d: number; t: number } {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const l2 = bx * bx + by * by + bz * bz || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * bx + (py - a[1]) * by + (pz - a[2]) * bz) / l2));
  return { d: Math.hypot(px - a[0] - bx * t, py - a[1] - by * t, pz - a[2] - bz * t), t };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
