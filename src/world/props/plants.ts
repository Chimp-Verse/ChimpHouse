// Plant library: leaves are thin instances from the leaf atlas; stems and pots
// are regular geometry.

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import { P2, rng } from "../geometry/curves";
import { Geo, beam, box, cylinder, lathe, tube, xf, disc } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { Leaf } from "../materials/leaves";

export type Rand = () => number;

/**
 * Matrix for a leaf: stem at pos, axis along dir, length `size`. The leaf face
 * is turned toward `face` (default: sky) and then rolled by `jitter` radians.
 */
export function leafMatrix(pos: Vector3, dir: Vector3, size: number, jitter = 0, widthScale = 1, face: Vector3 = Vector3.Up()): Matrix {
  const d = dir.normalizeToNew();
  const up = Vector3.Up();
  let q: Quaternion;
  const dot = Vector3.Dot(up, d);
  if (dot > 0.9999) q = Quaternion.Identity();
  else if (dot < -0.9999) q = Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  else q = Quaternion.RotationAxis(Vector3.Cross(up, d).normalize(), Math.acos(dot));
  const X = Vector3.Right().rotateByQuaternionToRef(q, new Vector3());
  const Z = Vector3.Forward().rotateByQuaternionToRef(q, new Vector3());
  // the leaf tip curls toward local -Z, so its upper face is +Z: turn +Z toward `face`
  const roll = Math.atan2(Vector3.Dot(X, face), Vector3.Dot(Z, face)) + jitter;
  q = q.multiply(Quaternion.RotationAxis(Vector3.Up(), roll));
  return Matrix.Compose(new Vector3(size * widthScale, size, size), q, pos);
}

/** Rosette/clump of leaves radiating from a point and arching outward. */
export function clump(
  ctx: WorldCtx,
  z: Zone,
  pos: Vector3,
  o: { type: Leaf; count: number; size: [number, number]; tilt: [number, number]; r: Rand; spread?: number; stems?: boolean; stemScale?: number; stemWidth?: number; stemColor?: string; widthScale?: number; label?: string },
): void {
  const { type, count, size, tilt, r, spread = 0.1 } = o;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.8;
    const t = tilt[0] + r() * (tilt[1] - tilt[0]); // 0 = vertical, 1 = horizontal
    const dir = new Vector3(Math.cos(a) * Math.sin(t * 1.5), Math.cos(t * 1.5), Math.sin(a) * Math.sin(t * 1.5));
    const s = size[0] + r() * (size[1] - size[0]);
    const base = pos.add(new Vector3(Math.cos(a) * spread * r(), r() * 0.05, Math.sin(a) * spread * r()));
    let start = base;
    if (o.stems) {
      const stemLen = s * (0.5 + r() * 0.4) * (o.stemScale ?? 1);
      const end = base.add(dir.scale(stemLen * 0.6)).add(new Vector3(0, stemLen * 0.5, 0));
      ctx.g(z, o.stemColor ?? "stem", { castShadow: false }).add(tube([base, base.add(new Vector3(0, stemLen * 0.35, 0)).add(dir.scale(stemLen * 0.25)), end], (0.012 + s * 0.008) * (o.stemWidth ?? 1), 5), undefined, o.label ?? "Plant");
      start = end;
    }
    ctx.leaf(z, type, leafMatrix(start, dir, s, (r() - 0.5) * 0.9, o.widthScale ?? 1));
  }
}

export type PlantKind = "monstera" | "palm" | "fern" | "bromeliad" | "cordyline" | "banana" | "philodendron" | "calathea" | "croton" | "elephant" | "grass" | "mixed";

/**
 * A recognisable tropical plant at pos, scaled by s (~1 = 1 m tall). Its stems carry
 * `label`: a potted plant passes its pot's, so pot and plant are one item.
 */
/** `narrow` (0–1) stands the leaves up toward vertical, for a plant that has to keep out of the way. */
export function plant(ctx: WorldCtx, z: Zone, pos: Vector3, kind: PlantKind, s: number, r: Rand, label = "Plant", narrow = 1): void {
  switch (kind) {
    case "monstera":
      clump(ctx, z, pos, { type: Leaf.Monstera, count: 7 + Math.floor(r() * 4), size: [0.45 * s, 0.7 * s], tilt: [0.35 * narrow, 0.8 * narrow], r, stems: true, label });
      break;
    case "philodendron":
      clump(ctx, z, pos, { type: Leaf.Philodendron, count: 9, size: [0.35 * s, 0.55 * s], tilt: [0.3, 0.85], r, stems: true, label });
      break;
    case "elephant":
      clump(ctx, z, pos, { type: Leaf.ElephantEar, count: 6, size: [0.6 * s, 0.9 * s], tilt: [0.25, 0.6], r, stems: true, label });
      break;
    case "palm":
      clump(ctx, z, pos, { type: Leaf.Palm, count: 9, size: [0.9 * s, 1.4 * s], tilt: [0.25 * narrow, 0.75 * narrow], r, stems: true, stemScale: 0.4, stemWidth: 0.5, label });
      break;
    case "fern":
      clump(ctx, z, pos, { type: Leaf.Fern, count: 12, size: [0.5 * s, 0.8 * s], tilt: [0.45, 0.85], r, stems: true, stemScale: 0.22, label });
      break;
    case "bromeliad":
      clump(ctx, z, pos, { type: Leaf.Bromeliad, count: 14, size: [0.3 * s, 0.5 * s], tilt: [0.15, 0.7], r, widthScale: 1.6 });
      break;
    case "cordyline":
      clump(ctx, z, pos.add(new Vector3(0, 0.25 * s, 0)), { type: Leaf.Cordyline, count: 12, size: [0.35 * s, 0.55 * s], tilt: [0.1, 0.6], r, widthScale: 1.5 });
      ctx.g(z, "stem", { castShadow: false }).add(cylinder(0.02 * s, 0.3 * s, 6), xf(pos.x, pos.y, pos.z), label);
      break;
    case "banana":
      clump(ctx, z, pos.add(new Vector3(0, 0.6 * s, 0)), { type: Leaf.Banana, count: 7, size: [1.0 * s, 1.5 * s], tilt: [0.2, 0.55], r, widthScale: 1.2 });
      ctx.g(z, "stem", { castShadow: false }).add(cylinder(0.06 * s, 0.7 * s, 8, true, 0.045 * s), xf(pos.x, pos.y, pos.z), label);
      break;
    case "calathea":
      clump(ctx, z, pos, { type: Leaf.Calathea, count: 10, size: [0.3 * s, 0.45 * s], tilt: [0.2, 0.65], r, stems: true, label });
      break;
    case "croton":
      clump(ctx, z, pos, { type: Leaf.Croton, count: 14, size: [0.22 * s, 0.34 * s], tilt: [0.3, 0.9], r, widthScale: 1.3, stems: true, stemScale: 0.5, label });
      break;
    case "grass":
      clump(ctx, z, pos, { type: Leaf.Grass, count: 4, size: [0.35 * s, 0.5 * s], tilt: [0.0, 0.3], r });
      break;
    case "mixed": {
      const kinds: PlantKind[] = ["monstera", "fern", "philodendron", "bromeliad", "calathea", "elephant"];
      plant(ctx, z, pos, kinds[Math.floor(r() * kinds.length)], s, r, label);
      break;
    }
  }
}

/** Pot (lathe) with soil and a plant. */
export function pottedPlant(
  ctx: WorldCtx,
  z: Zone,
  pos: Vector3,
  kind: PlantKind,
  o: { pot?: "cream" | "charcoal" | "terracotta" | "woven"; potR?: number; potH?: number; scale?: number; narrow?: number; r: Rand; label?: string },
): void {
  const potR = o.potR ?? 0.22;
  const potH = o.potH ?? 0.42;
  const mat = o.pot === "charcoal" ? "potCharcoal" : o.pot === "terracotta" ? "terracotta" : o.pot === "woven" ? "jute" : "potCream";
  const g = ctx.g(z, mat);
  g.setLabel(o.label ?? "Potted plant");
  g.add(
    lathe(
      [
        [potR * 0.72, 0],
        [potR * 0.92, potH * 0.4],
        [potR, potH * 0.92],
        [potR * 1.04, potH],
        [potR * 0.94, potH],
        [potR * 0.9, potH * 0.9],
      ],
      20,
      false,
      true,
      2,
    ),
    xf(pos.x, pos.y, pos.z),
  );
  ctx.g(z, "soil", { castShadow: false }).add(disc(potR * 0.9, 16), xf(pos.x, pos.y + potH * 0.9, pos.z), o.label ?? "Potted plant");
  plant(ctx, z, pos.add(new Vector3(0, potH * 0.88, 0)), kind, o.scale ?? 1, o.r, o.label ?? "Potted plant", o.narrow ?? 1);
}

/**
 * Hanging vine strand from `top`, length L: a thin stem with leaves and leafy
 * sprigs along it, so strands read as full cascades from a distance and never
 * as loose leaves. `lead` is an optional run of points before `top` (e.g. the
 * stem draping over a handrail) that the stem follows first.
 */
export function vine(ctx: WorldCtx, z: Zone, top: Vector3, L: number, r: Rand, o: { type?: Leaf; density?: number; leaf?: number; drift?: Vector3; lead?: Vector3[]; label?: string } = {}): void {
  const type = o.type ?? Leaf.Pothos;
  const density = o.density ?? 9; // leaves per metre
  const leaf = o.leaf ?? 0.11;
  const drift = o.drift ?? new Vector3((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3);
  const n = Math.max(2, Math.round(L * density));
  const phase = r() * Math.PI * 2;
  const along = (t: number) => top.add(new Vector3(drift.x * t * L + Math.sin(phase + t * 5) * 0.04 - Math.sin(phase) * 0.04, -t * L, drift.z * t * L + Math.cos(phase + t * 4) * 0.04 - Math.cos(phase) * 0.04));
  // stem: through the lead, then down the strand, tapering
  const m = Math.max(3, Math.ceil(L / 0.12));
  const stem = [...(o.lead ?? []), ...Array.from({ length: m + 1 }, (_, i) => along(i / m))];
  const sr = Math.max(0.0028, leaf * 0.04);
  ctx.g(z, "stem", { castShadow: false }).add(tube(stem, (t) => sr * (1 - 0.45 * t), 4), undefined, o.label ?? "Vine");
  for (const p of o.lead ?? []) {
    const a = r() * Math.PI * 2;
    ctx.leaf(z, type, leafMatrix(p, new Vector3(Math.cos(a), 0.1, Math.sin(a)), leaf * 1.05, (r() - 0.5) * 1.2));
  }
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const p = along(t);
    const a = r() * Math.PI * 2;
    const taper = 1 - t * 0.35;
    if (r() < 0.4) {
      // sprig hanging down and slightly outward
      const dir = new Vector3(Math.cos(a) * 0.45, -1, Math.sin(a) * 0.45);
      ctx.leaf(z, Leaf.Twig, leafMatrix(p, dir, leaf * (2.6 + r() * 1.4) * taper, (r() - 0.5) * 1.6, 1, new Vector3(Math.cos(a), 0.3, Math.sin(a))));
    } else {
      const dir = new Vector3(Math.cos(a) * 0.9, -0.15 - r() * 0.5, Math.sin(a) * 0.9);
      ctx.leaf(z, type, leafMatrix(p, dir, leaf * (0.75 + r() * 0.5) * taper, (r() - 0.5) * 1.6, 1, dir.add(new Vector3(0, 0.6, 0))));
    }
  }
}

/**
 * Curtain of vines along an edge path (3D points), e.g. slab edges and railings.
 * `hug` adds a few leaves where each strand attaches: "over" sits them on top of
 * the edge (a ledge or a rail), "under" tucks them just below it (a soffit), false leaves none.
 */
export function vineCurtain(ctx: WorldCtx, z: Zone, path: Vector3[], r: Rand, o: { every?: number; len?: [number, number]; type?: Leaf; density?: number; leaf?: number; chance?: number; hug?: "over" | "under" | false } = {}): void {
  const every = o.every ?? 0.5;
  const [l0, l1] = o.len ?? [0.6, 2.4];
  const hug = o.hug ?? "over";
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const d = Vector3.Distance(a, b);
    acc += d;
    while (acc >= every) {
      acc -= every;
      if (o.chance !== undefined && r() > o.chance) continue;
      const t = 1 - acc / Math.max(d, 1e-6);
      const p = Vector3.Lerp(a, b, Math.max(0, Math.min(1, t)));
      const L = l0 + Math.pow(r(), 1.6) * (l1 - l0);
      vine(ctx, z, p, L, r, { type: o.type, density: o.density, leaf: o.leaf });
      if (!hug) continue;
      // a few leaves clustered where the strand attaches, along the edge rather than across it
      const tx = (b.x - a.x) / Math.max(d, 1e-6);
      const tz = (b.z - a.z) / Math.max(d, 1e-6);
      for (let k = 0; k < 3; k++) {
        const s = (r() - 0.5) * 0.3;
        const q = p.add(new Vector3(tx * s, hug === "over" ? 0.02 : -0.05, tz * s));
        const aa = r() * Math.PI * 2;
        const dir = hug === "over" ? new Vector3(Math.cos(aa), 0.2, Math.sin(aa)) : new Vector3(Math.cos(aa) * 0.6, -1, Math.sin(aa) * 0.6);
        ctx.leaf(z, o.type ?? Leaf.Pothos, leafMatrix(q, dir, (o.leaf ?? 0.11) * 1.1, (r() - 0.5) * 1.2));
      }
    }
  }
}

/** Scatter plants over plan points (beds, ground cover). */
export function bed(ctx: WorldCtx, z: Zone, pts: P2[], y: number | ((p: P2) => number), r: Rand, kinds: PlantKind[], scale: [number, number]): void {
  for (const p of pts) {
    const k = kinds[Math.floor(r() * kinds.length)];
    const s = scale[0] + r() * (scale[1] - scale[0]);
    plant(ctx, z, new Vector3(p.x, typeof y === "number" ? y : y(p), p.z), k, s, r);
  }
}

export { rng, Geo };

const PLANTER_WALL = 0.035;
/** How far the soil sits below a planter's rim. */
const SOIL_DROP = 0.05;

/**
 * Open-topped timber planter box, base at y = 0 of `m`, with the soil set
 * below the rim (never level with it, which makes the two surfaces flicker).
 * Returns the soil's height, where plants are placed.
 */
export function planterBox(ctx: WorldCtx, z: Zone, m: Matrix, w: number, h: number, d: number, mat = "timberDark", label = "Planter"): number {
  const t = PLANTER_WALL;
  const g = new Geo();
  g.add(box(w, h, t), xf(0, h / 2, -(d - t) / 2));
  g.add(box(w, h, t), xf(0, h / 2, (d - t) / 2));
  g.add(box(t, h, d - 2 * t), xf(-(w - t) / 2, h / 2, 0));
  g.add(box(t, h, d - 2 * t), xf((w - t) / 2, h / 2, 0));
  ctx.g(z, mat).add(g, m, label);
  const soil = h - SOIL_DROP;
  ctx.g(z, "soil", { castShadow: false }).add(box(w - 2 * t - 0.004, soil, d - 2 * t - 0.004), xf(0, soil / 2, 0).multiply(m), label);
  return soil;
}

/**
 * Open-topped planter following a plan path (curved), `width` across, with the
 * soil set below the rim. Returns the soil's height above `y`.
 */
export function planterAlong(ctx: WorldCtx, z: Zone, path: P2[], y: number, width: number, h: number, mat = "timberDark", label = "Planter"): number {
  const t = PLANTER_WALL;
  const line = path.map((p) => new Vector3(p.x, y, p.z));
  const g = ctx.g(z, mat);
  g.setLabel(label);
  for (const s of [-1, 1]) g.add(beam(line, t, h, { offsetX: s * (width - t) / 2, offsetY: h / 2 }));
  const soil = h - SOIL_DROP;
  ctx.g(z, "soil", { castShadow: false }).add(beam(line, width - 2 * t - 0.004, soil, { offsetY: soil / 2, caps: false }), undefined, label);
  // end boards close the box
  for (const [a, b] of [
    [line[0], line[1]],
    [line[line.length - 1], line[line.length - 2]],
  ]) {
    const dir = b.subtract(a).normalize();
    const yaw = -Math.atan2(dir.z, dir.x) + Math.PI / 2;
    g.add(box(width, h, t), xf(a.x + dir.x * (t / 2), y + h / 2, a.z + dir.z * (t / 2), yaw));
  }
  return soil;
}
