// Clothes fitted to a chimp's body: a tee, a hoodie, shorts. Each is made from the
// body's own shapes (avatar/anatomy.ts), grown a little so it sits over the skin, cut
// at its neckline, hems and sleeves, and meshed (avatar/mesher.ts). Its vertices are
// weighted to the body's bones as the skin under them is, so it moves with the chimp,
// and it says which of the fur it hides, so no hair pokes through it: the fur stops
// under the cloth and spills out at the cuffs.
//
// Plain numbers and no Babylon: built in the model worker (avatar/build.worker.ts).

import type { Anatomy, PartName } from "./anatomy";
import type { ItemModel } from "./items";
import { decimate } from "./decimate";
import { meshField, settle } from "./mesher";
import { Field, Mode, Prim, type V3, add, norm, scale, smoothstep, sub } from "./sdf";

/** What a garment is made of: which of the body's shapes, grown how far, and where it is cut. */
interface Pattern {
  /** the trunk's shapes it covers, by tag */
  trunk: string[];
  /** the arm's and leg's shapes it covers, by tag, and how far along each limb's bones it reaches (0 at its root) */
  arm?: { tags: string[]; to: number };
  leg?: { tags: string[]; to: number };
  /** how far over the skin it sits, metres */
  ease: number;
  /** the hem: the lowest the trunk part reaches, as height above the hips' joint (metres); and the waist for bottoms */
  hem?: number;
  waist?: number;
  /** the neck's opening: none for bottoms */
  neck?: { drop: number; width: number };
  /** extra shapes: a hood rolled behind the neck, a pocket */
  extras?: (a: Anatomy, field: Field) => void;
  /** triangles once simplified */
  tris: number;
  /** a print on its chest: its middle's height above the chest's joint, and its half size (metres) */
  print?: { y: number; size: number };
}

const TORSO = ["pelvis", "belly", "ribs", "shoulders", "hump", "glute", "deltoid"];

const PATTERNS: Record<string, Pattern> = {
  tee: { trunk: TORSO.filter((t) => t !== "glute"), arm: { tags: ["upperArm", "biceps"], to: 0.26 }, ease: 0.0085, hem: 0.035, neck: { drop: 0.035, width: 1 }, tris: 5200, print: { y: 0.07, size: 0.07 } },
  hoodie: {
    trunk: TORSO.filter((t) => t !== "glute"),
    arm: { tags: ["upperArm", "biceps", "forearm", "forearmMuscle"], to: 0.93 },
    ease: 0.013,
    hem: -0.005,
    neck: { drop: -0.012, width: 0.86 },
    extras: hoodieExtras,
    tris: 7000,
  },
  shorts: { trunk: ["pelvis", "glute", "belly"], leg: { tags: ["thigh", "quads"], to: 0.4 }, ease: 0.011, waist: 0.095, tris: 3800 },
};

export const GARMENTS = Object.keys(PATTERNS);

export function buildGarment(anatomy: Anatomy, furPositions: Partial<Record<PartName, Float32Array>>, id: string): ItemModel | null {
  const pat = PATTERNS[id];
  if (!pat) return null;
  const { rig } = anatomy;
  const body = anatomy.parts.find((p) => p.name === "body")!;
  const J = (n: string): V3 => rig.bones[rig.index[n]].head;
  const hips = J("hips");
  const field = new Field();
  /** the cuts that make the garment's edges, a band of the second colour along each: a sleeve's cut only counts near its arm */
  const edges: { cut: Prim; near?: (x: number, y: number, z: number) => boolean }[] = [];

  // the trunk: the body's own shapes, grown by the ease, in the body's order
  const trunk = new Field();
  for (const op of body.field.ops) {
    if (op.mode === Mode.Add && op.prim && pat.trunk.includes(op.prim.tag)) trunk.add(op.prim.inflate(pat.ease), op.k);
  }
  pat.extras?.(anatomy, trunk);
  field.add(trunk);
  if (pat.hem !== undefined) {
    // everything below the hem goes
    const y = hips[1] + pat.hem;
    edges.push({ cut: field.cut(Prim.box([0, y - 1, 0], [2, 1, 2], 0, 0, "hem"), 0.006) });
  }
  if (pat.waist !== undefined) {
    const y = hips[1] + pat.waist;
    edges.push({ cut: field.cut(Prim.box([0, y + 1, 0], [2, 1, 2], 0, 0, "waist"), 0.006) });
  }
  if (pat.neck) {
    // a round opening for the neck, lower in front
    const n = J("neck");
    const r = 0.078 * rig.marks.girth * pat.neck.width;
    edges.push({ cut: field.cut(Prim.ellipsoid(add(n, [0, 0.03 - pat.neck.drop, 0.022]), [r, 0.07, r * 1.05], 0, "neckline", [0, -0.35, 1]), 0.008) });
  }
  // the limbs: each trimmed where the sleeve or leg ends, then blended in as the body's limbs are
  field.fork();
  for (const op of body.field.ops) {
    if (op.mode !== Mode.Limb || !op.sub) continue;
    const prims = op.sub.prims();
    const isArm = prims.some((q) => q.tag === "upperArm");
    const spec = isArm ? pat.arm : pat.leg;
    if (!spec) continue;
    const limb = new Field();
    for (const q of prims) if (spec.tags.includes(q.tag)) limb.add(q.inflate(pat.ease), 0.024);
    if (!limb.ops.length) continue;
    // where it ends: a share of the way along the limb's two long bones
    const first = prims.find((q) => q.tag === (isArm ? "upperArm" : "thigh"))!;
    const second = prims.find((q) => q.tag === (isArm ? "forearm" : "shin"))!;
    const a: V3 = [first.cx, first.cy, first.cz];
    const m: V3 = [first.ex, first.ey, first.ez];
    const b: V3 = [second.ex, second.ey, second.ez];
    const l1 = Math.hypot(...sub(m, a));
    const l2 = Math.hypot(...sub(b, m));
    const at = spec.to * (l1 + l2);
    const [p, dir] = at <= l1 ? [add(a, scale(norm(sub(m, a)), at)), norm(sub(m, a))] : [add(m, scale(norm(sub(b, m)), at - l1)), norm(sub(b, m))];
    const cut = Prim.box(add(p, scale(dir, 0.5)), [0.5, 0.5, 0.5], 0, 0, "cuff", dir, Math.abs(dir[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]);
    limb.cut(cut, 0.006);
    // the cuff's band: only on the limb, within a hand's breadth of where it is cut
    const reach = (isArm ? 0.07 : 0.1) * rig.marks.girth;
    edges.push({ cut, near: (x, y, z) => Math.hypot(x - p[0], y - p[1], z - p[2]) < reach });
    field.limb(limb, isArm ? 0.03 : 0.045);
  }

  // mesh it, simplify it, settle it on its surface
  let lo: V3 = [Infinity, Infinity, Infinity];
  let hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const q of field.prims()) {
    if (q.tag === "hem" || q.tag === "waist" || q.tag === "cuff" || q.tag === "neckline") continue;
    lo = [Math.min(lo[0], q.bx - q.br), Math.min(lo[1], q.by - q.br), Math.min(lo[2], q.bz - q.br)];
    hi = [Math.max(hi[0], q.bx + q.br), Math.max(hi[1], q.by + q.br), Math.max(hi[2], q.bz + q.br)];
  }
  const h = 0.0068;
  lo = [lo[0] - 3 * h, lo[1] - 3 * h, lo[2] - 3 * h];
  hi = [hi[0] + 3 * h, hi[1] + 3 * h, hi[2] + 3 * h];
  const fine = meshField(field, lo, hi, h);
  if (!fine.indices.length) return null;
  const dec = decimate(fine.positions, fine.indices, pat.tris, 0.04);
  const positions = Float32Array.from(dec.positions);
  const normals = settle(field, positions, fine.near, h);
  const n = positions.length / 3;
  const bones = new Float32Array(n * 4);
  const weights = new Float32Array(n * 4);
  const cloth = new Float32Array(n * 4);
  const bi = new Int32Array(4);
  const bw = new Float32Array(4);
  const near: number[] = [];
  for (let v = 0; v < n; v++) {
    const p: V3 = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    // the bones that move the skin just under it
    body.field.near(p[0], p[1], p[2], 0.03, 0.03, near);
    anatomy.weigh(body, p, near, bi, bw);
    for (let k = 0; k < 4; k++) {
      bones[v * 4 + k] = bi[k];
      weights[v * 4 + k] = bw[k];
    }
    let band = 0;
    for (const e of edges) if (!e.near || e.near(p[0], p[1], p[2])) band = Math.max(band, 1 - smoothstep(0.018, 0.026, Math.abs(e.cut.d(p[0], p[1], p[2]))));
    cloth[v * 4] = band;
    cloth[v * 4 + 2] = occlusion(field, p, [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]], fine.near(p[0], p[1], p[2]));
  }

  // the fur it hides: whatever grows inside it, fading out just inside its edges so the fur spills out there
  const cover: Partial<Record<PartName, Float32Array>> = {};
  for (const [part, pos] of Object.entries(furPositions) as [PartName, Float32Array][]) {
    const c = new Float32Array(pos.length / 3);
    let any = false;
    for (let v = 0; v < c.length; v++) {
      const x = pos[v * 3];
      const y = pos[v * 3 + 1];
      const z = pos[v * 3 + 2];
      if (x < lo[0] || y < lo[1] || z < lo[2] || x > hi[0] || y > hi[1] || z > hi[2]) continue;
      const g = field.at(x, y, z);
      c[v] = smoothstep(0.004, -0.006, g);
      if (c[v] > 0) any = true;
    }
    if (any) cover[part] = c;
  }
  const chest = J("chest");
  const g = rig.marks.girth;
  return {
    id,
    meshes: [{ kind: "cloth", colour: 0, bone: null, positions, normals, indices: dec.indices, bones, weights, cloth }],
    cover,
    print: pat.print ? [0, chest[1] + pat.print.y, pat.print.size * g, pat.print.size * g] : undefined,
  };
}

/** The hoodie's hood, down, in a roll behind the neck; and its pocket across the belly. */
function hoodieExtras(a: Anatomy, f: Field) {
  const { rig } = a;
  const neck = rig.bones[rig.index.neck].head;
  const spine = rig.bones[rig.index.spine].head;
  const g = rig.marks.girth;
  f.add(Prim.ellipsoid(add(neck, [0, 0.035, -0.074]), [0.085 * g, 0.042, 0.05], 0, "hood", [0, 0.5, -1]), 0.03);
  for (const s of [-1, 1]) f.add(Prim.ellipsoid(add(neck, [s * 0.07 * g, 0.022, -0.035]), [0.04, 0.036, 0.055], 0, "hood", [s, 0.3, -0.4]), 0.03);
  f.add(Prim.ellipsoid(add(spine, [0, -0.01, 0.112 * g]), [0.1 * g, 0.055, 0.02], 0, "pocket", [0, 0, 1]), 0.012);
}

/** How shut in a point of cloth is (folds under the arms, the hood's roll): as the skin's is worked out. */
function occlusion(field: Field, p: V3, n: V3, list: number[]): number {
  let occ = 0;
  let w = 1;
  for (const s of [0.006, 0.014, 0.026]) {
    const d = field.at(p[0] + n[0] * s, p[1] + n[1] * s, p[2] + n[2] * s, list);
    occ += (Math.max(0, s - d) / s) * w;
    w *= 0.7;
  }
  return Math.max(0, Math.min(1, 1 - occ * 0.45));
}
