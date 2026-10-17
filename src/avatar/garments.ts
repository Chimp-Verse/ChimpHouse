// Clothes fitted to a chimp's body: a tee, a hoodie, shorts. Each is made from the
// body's own shapes (avatar/anatomy.ts), grown a little so it sits over the skin (a
// top hangs looser from the chest and belly), cut at its neckline, hems and sleeves,
// and meshed (avatar/mesher.ts). Its ribbed trims (a tee's collar and cuffs, a
// hoodie's cuffs and waistband) are pieces of their own, a little proud of it. Its
// vertices are weighted to the body's bones as the skin under them is, so it moves
// with the chimp, and it says which of the fur it hides, so no hair pokes through it:
// the fur stops under the cloth and spills out at the cuffs.
//
// It is finished as a garment is sewn: what its cloth is (jersey, fleece, twill), its seams
// (a top's sides, shoulders and armholes; shorts' sides, inside legs, middle seam and fly),
// its hems turned up and stitched twice, and the folds it falls into (a top's drape from
// the chest, the creases round sleeves and legs, the gathers under a waistband), each
// worked out per vertex from the chimp's own shape for the cloth material to draw
// (avatar/materials.ts).
//
// Plain numbers and no Babylon: built in the model worker (avatar/build.worker.ts).

import type { Anatomy, PartName } from "./anatomy";
import type { Fabric, ItemMesh, ItemModel } from "./items";
import { decimate } from "./decimate";
import { meshField, settle } from "./mesher";
import { Field, Mode, Prim, type V3, add, cross, dot, norm, scale, smoothstep, sub } from "./sdf";
import { printAspect } from "./wordmark";

/** What a garment is made of: which of the body's shapes, grown how far, and where it is cut. */
interface Pattern {
  /** the trunk's shapes it covers, by tag */
  trunk: string[];
  /** the arm's and leg's shapes it covers, by tag, and how far along each limb's bones it reaches (0 at its root) */
  arm?: { tags: string[]; to: number };
  leg?: { tags: string[]; to: number };
  /** how far over the skin it sits, metres */
  ease: number;
  /** how much looser it hangs below the chest, metres: a top falls from the chest and belly to its hem rather than hugging the waist */
  drape?: number;
  /** the hem: the lowest the trunk part reaches, as height above the hips' joint (metres); and the waist for bottoms */
  hem?: number;
  waist?: number;
  /** the neck's opening: none for bottoms */
  neck?: { drop: number; width: number };
  /** extra shapes: a hood rolled behind the neck, a pocket */
  extras?: (a: Anatomy, field: Field) => void;
  /** triangles once simplified */
  tris: number;
  /** a print on its chest: its middle's height above the chest's joint, and its half height (metres); the ChimpVibe tree over the word */
  print?: { y: number; size: number };
  /**
   * Ribbed bands in the second colour (a darker shade of the first, for one-colour clothes), each
   * its own piece standing a little proud, their depths in metres: round the neck, at the ends of
   * the sleeves or legs, round the hem, round the waist.
   */
  trims?: { collar?: number; cuffs?: number; hem?: number; waist?: number };
  /** what it is made of (its trims are ribbed knit) */
  fabric: Fabric;
  /**
   * how deep it falls into folds (metres, as the shading takes them): its drape (a top's, from the
   * chest down; shorts' gathers under the waistband) and the creases round its sleeves or legs
   */
  folds: { drape: number; creases: number };
  /** its bottom edge (a top) or its legs' ends (shorts) turned up inside and stitched twice */
  hemmed?: boolean;
  /**
   * how its three seams are made (ItemMesh seamStyle): its sides and shoulders (a top) or sides and
   * inside legs (shorts); its armholes, or the middle seam front and back; a stitched outline (a
   * pocket's, a fly's)
   */
  seams: [number, number, number, number];
}

const TORSO = ["pelvis", "belly", "ribs", "shoulders", "hump", "glute", "deltoid"];

const PATTERNS: Record<string, Pattern> = {
  // a ringer tee: its collar and its sleeves' ends ribbed in the print's colour
  tee: {
    trunk: TORSO.filter((t) => t !== "glute"),
    arm: { tags: ["upperArm", "biceps"], to: 0.3 },
    ease: 0.009,
    drape: 0.012,
    hem: 0.03,
    neck: { drop: 0.03, width: 1 },
    tris: 6400,
    print: { y: 0.055, size: 0.058 },
    trims: { collar: 0.015, cuffs: 0.012 },
    fabric: "jersey",
    folds: { drape: 0.011, creases: 0.008 },
    hemmed: true,
    // plain seams at the sides and shoulders, and round the armholes
    seams: [1, 1, 0, 1],
  },
  hoodie: {
    trunk: TORSO.filter((t) => t !== "glute"),
    arm: { tags: ["upperArm", "biceps", "forearm", "forearmMuscle"], to: 0.93 },
    ease: 0.013,
    drape: 0.012,
    hem: -0.005,
    neck: { drop: -0.012, width: 0.86 },
    extras: hoodieExtras,
    tris: 8200,
    trims: { cuffs: 0.034, hem: 0.042 },
    fabric: "fleece",
    folds: { drape: 0.013, creases: 0.012 },
    // and the pocket stitched on round its edge
    seams: [1, 1, 2, 1],
  },
  shorts: {
    trunk: ["pelvis", "glute", "belly"],
    leg: { tags: ["thigh", "quads"], to: 0.4 },
    ease: 0.011,
    waist: 0.095,
    tris: 3800,
    trims: { waist: 0.026 },
    fabric: "twill",
    folds: { drape: 0.009, creases: 0.011 },
    hemmed: true,
    // plain seams at the sides and inside the legs; the middle seam stitched twice; the fly's curve stitched
    seams: [1, 3, 4, 0],
  },
};

export const GARMENTS = Object.keys(PATTERNS);

/** How far proud of the garment its ribbed trims stand. */
const PROUD = 0.0032;

/**
 * A garment's shape for this chimp: where it is cut (hem, waist, neck, each sleeve's or leg's end),
 * and the whole of it as a field, every shape grown `more` past the ease.
 */
function shapeOf(anatomy: Anatomy, pat: Pattern) {
  const { rig } = anatomy;
  const body = anatomy.parts.find((p) => p.name === "body")!;
  const J = (n: string): V3 => rig.bones[rig.index[n]].head;
  const hips = J("hips");
  // the trunk: the body's own shapes, grown by the ease, in the body's order; `more` grows them further (a trim)
  const trunkOf = (more: number) => {
    const t = new Field();
    for (const op of body.field.ops) {
      if (op.mode === Mode.Add && op.prim && pat.trunk.includes(op.prim.tag)) t.add(op.prim.inflate(pat.ease + more), op.k);
    }
    if (pat.drape) {
      // falling from the chest and belly: a hull as wide and deep as the widest of them, from the chest to below the hem
      const tagged = (tag: string) => body.field.ops.find((op) => op.prim?.tag === tag)?.prim;
      const shapes = ["ribs", "belly", "pelvis"].map(tagged).filter((q): q is Prim => !!q);
      const rx = Math.max(...shapes.map((q) => q.rx)) + pat.ease + pat.drape + more;
      const rz = Math.max(...shapes.map((q) => q.rz)) + pat.ease + pat.drape * 0.6 + more;
      const ribs = tagged("ribs")!;
      const hemAt = hips[1] + (pat.hem ?? 0);
      const zc = shapes.reduce((s2, q) => s2 + q.cz, 0) / shapes.length;
      t.add(Prim.ellipsoid([0, hemAt + 0.06, zc], [rx, ribs.cy - hemAt + 0.02, rz], 0, "drape"), 0.05);
    }
    pat.extras?.(anatomy, t);
    return t;
  };
  // where it is cut: its hem or waist, its neck's opening (lower in front), each sleeve's or leg's end
  const hemY = pat.hem !== undefined ? hips[1] + pat.hem : null;
  const waistY = pat.waist !== undefined ? hips[1] + pat.waist : null;
  const neckline = pat.neck ? Prim.ellipsoid(add(J("neck"), [0, 0.03 - pat.neck.drop, 0.022]), [0.078 * rig.marks.girth * pat.neck.width, 0.07, 0.078 * rig.marks.girth * pat.neck.width * 1.05], 0, "neckline", [0, -0.35, 1]) : null;
  /** each sleeve or leg: its shapes, where it ends (p) and the way it runs there, and its joints (root, the elbow or knee, the far end) */
  const limbs: { prims: Prim[]; tags: string[]; isArm: boolean; p: V3; dir: V3; up: V3; root: V3; mid: V3; end: V3; l1: number; l2: number }[] = [];
  for (const op of body.field.ops) {
    if (op.mode !== Mode.Limb || !op.sub) continue;
    const prims = op.sub.prims();
    const isArm = prims.some((q) => q.tag === "upperArm");
    const spec = isArm ? pat.arm : pat.leg;
    if (!spec || !prims.some((q) => spec.tags.includes(q.tag))) continue;
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
    limbs.push({ prims, tags: spec.tags, isArm, p, dir, up: Math.abs(dir[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0], root: a, mid: m, end: b, l1, l2 });
  }
  /** a sleeve or leg alone, as it is grown (to tell which of the garment a point is on) */
  const limbField = (L: (typeof limbs)[number]) => {
    const f = new Field();
    for (const q of L.prims) if (L.tags.includes(q.tag)) f.add(q.inflate(pat.ease), 0.024);
    return f;
  };
  /** the whole garment, every shape grown `more` past the ease (its trims stand that proud of it), cut where it is cut */
  const garmentOf = (more: number) => {
    const f = new Field();
    f.add(trunkOf(more));
    if (hemY !== null) f.cut(Prim.box([0, hemY - 1, 0], [2, 1, 2], 0, 0, "hem"), 0.006);
    if (waistY !== null) f.cut(Prim.box([0, waistY + 1, 0], [2, 1, 2], 0, 0, "waist"), 0.006);
    if (neckline) f.cut(neckline, 0.008);
    // the limbs, each trimmed where it ends and blended in as the body's limbs are
    f.fork();
    for (const L of limbs) {
      const limb = new Field();
      for (const q of L.prims) if (L.tags.includes(q.tag)) limb.add(q.inflate(pat.ease + more), 0.024);
      limb.cut(Prim.box(add(L.p, scale(L.dir, 0.5)), [0.5, 0.5, 0.5], 0, 0, "cuff", L.dir, L.up), 0.006);
      f.limb(limb, L.isArm ? 0.03 : 0.045);
    }
    return f;
  };
  return { rig, body, J, hips, hemY, waistY, neckline, limbs, garmentOf, trunkOf, limbField };
}

type Shape = ReturnType<typeof shapeOf>;

/**
 * The outside of a garment as worn by this chimp (its trims included), for what is worn over
 * it: a bandana or a chain round the neck of a tee, a backpack's straps over a hoodie, a watch
 * on a hoodie's cuff (avatar/items.ts). Null if there is no such garment.
 */
export function garmentField(anatomy: Anatomy, id: string): Field | null {
  const pat = PATTERNS[id];
  return pat ? shapeOf(anatomy, pat).garmentOf(PROUD + 0.0012) : null;
}

export function buildGarment(anatomy: Anatomy, furPositions: Partial<Record<PartName, Float32Array>>, id: string): ItemModel | null {
  const pat = PATTERNS[id];
  if (!pat) return null;
  const shape = shapeOf(anatomy, pat);
  const { rig, J, hips, hemY, waistY, neckline, limbs, garmentOf, trunkOf } = shape;
  const field = garmentOf(0);
  // the middle of its depth at a height, for what goes round it there (a band's ribs, a hem's stitches)
  const trunk0 = trunkOf(0);
  const middle = (y: number) => middleAt(trunk0, y, hips[2]);
  /**
   * the trims: a field each (the garment a little proud, kept only round its edge), where to mesh
   * it, its triangles, and the ring it goes round (its ribs run across it)
   */
  const trims: { field: Field; lo: V3; hi: V3; tris: number; ring: { c: V3; axis: V3 } }[] = [];
  const trim = (region: Prim, lo: V3, hi: V3, tris: number, ring: { c: V3; axis: V3 }) => {
    const t = new Field();
    t.add(garmentOf(PROUD));
    t.meet(region, 0.002);
    trims.push({ field: t, lo, hi, tris, ring });
  };
  const W = 0.4;
  if (hemY !== null && pat.trims?.hem) {
    const w = pat.trims.hem;
    trim(Prim.box([0, hemY + w / 2, 0], [2, w / 2, 2], 0.004, 0, "hemBand"), [-W, hemY - 0.01, -W], [W, hemY + w + 0.01, W], 2600, { c: [0, hemY, middle(hemY)], axis: [0, 1, 0] });
  }
  if (waistY !== null && pat.trims?.waist) {
    const w = pat.trims.waist;
    trim(Prim.box([0, waistY - w / 2, 0], [2, w / 2, 2], 0.004, 0, "waistBand"), [-W, waistY - w - 0.01, -W], [W, waistY + 0.01, W], 2200, { c: [0, waistY, middle(waistY)], axis: [0, 1, 0] });
  }
  if (neckline && pat.trims?.collar) {
    // a ribbed crew collar round the opening (which leans forward, as the neckline does)
    const c: V3 = [neckline.cx, neckline.cy, neckline.cz];
    const r = Math.max(neckline.rx, neckline.ry, neckline.rz) + pat.trims.collar + 0.02;
    trim(neckline.inflate(pat.trims.collar), [c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r], 1400, { c, axis: norm([0, 0.944, 0.33]) });
  }
  if (pat.trims?.cuffs) {
    // each sleeve's (or leg's) end, ribbed
    const w = pat.trims.cuffs;
    for (const L of limbs) {
      const c = add(L.p, scale(L.dir, -w / 2));
      trim(Prim.box(c, [0.09, 0.09, w / 2], 0.003, 0, "cuffBand", L.dir, L.up), [c[0] - 0.12, c[1] - 0.12, c[2] - 0.12], [c[0] + 0.12, c[1] + 0.12, c[2] + 0.12], Math.round(600 + 26000 * w), { c: L.p, axis: L.dir });
    }
  }

  const g = rig.marks.girth;
  // a top moves with the trunk and arms, never the legs (or its hem twists as they step); shorts never with the arms
  const limbBones = (side: string) => rig.bones.map((bn, i) => (bn.name.includes(side) ? i : -1)).filter((i) => i >= 0);
  const legs = ["UpperLeg", "LowerLeg", "Foot", "Toes"].flatMap(limbBones);
  const arms = ["Shoulder", "UpperArm", "LowerArm", "Hand", "Thumb", "Index", "Middle", "Ring", "Little"].flatMap(limbBones);
  const drop = new Set(pat.leg ? arms : legs);
  const main = meshGarment(anatomy, field, pat.tris, 0.0068, 0, undefined, undefined, drop);
  if (!main) return null;
  sew(anatomy, pat, shape, middle, main.mesh);
  const meshes: ItemMesh[] = [main.mesh];
  for (const t of trims) {
    const m = meshGarment(anatomy, t.field, t.tris, 0.0034, 1, [t.lo, t.hi], main.mesh);
    if (!m) continue;
    // ribbed knit, its ribs running across the band, round its ring
    const P = m.mesh.positions;
    const frame = ringFrame(t.ring.axis);
    for (let v = 0; v < P.length / 3; v++) m.mesh.cloth[v * 4 + 3] = 10 + roundRing(frame, t.ring.c, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    m.mesh.fabric = "rib";
    meshes.push(m.mesh);
  }

  // the fur it hides: whatever grows inside it; just outside its edges the fur is pressed down, so a
  // collar or a cuff shows clean, and spills out further off
  const { lo, hi } = main;
  const cover: Partial<Record<PartName, Float32Array>> = {};
  for (const [part, pos] of Object.entries(furPositions) as [PartName, Float32Array][]) {
    const c = new Float32Array(pos.length / 3);
    let any = false;
    for (let v = 0; v < c.length; v++) {
      const x = pos[v * 3];
      const y = pos[v * 3 + 1];
      const z = pos[v * 3 + 2];
      if (x < lo[0] || y < lo[1] || z < lo[2] || x > hi[0] || y > hi[1] || z > hi[2]) continue;
      const d = field.at(x, y, z);
      c[v] = Math.max(smoothstep(0.004, -0.006, d), 0.65 * (1 - smoothstep(0.004, 0.022, d)));
      if (c[v] > 0) any = true;
    }
    if (any) cover[part] = c;
  }
  const chest = J("chest");
  return {
    id,
    meshes,
    cover,
    print: pat.print ? [0, chest[1] + pat.print.y, pat.print.size * g * printAspect("stacked"), pat.print.size * g] : undefined,
    printArt: pat.print ? "stacked" : undefined,
    // the tree and "vibe" in the print's colour (the item's second); "chimp" in an ink that stands out from the cloth
    printInk: pat.print ? 1 : undefined,
  };
}

/**
 * Mesh a garment's field (or a trim's): on its grid, simplified, settled on its surface,
 * weighted to the body's bones as the skin under it is. `band` 1 colours all of it in the
 * second colour (a trim), ribbed.
 */
function meshGarment(anatomy: Anatomy, field: Field, tris: number, h: number, band: number, bounds?: [V3, V3], under?: ItemMesh, drop?: Set<number>): { mesh: ItemMesh; lo: V3; hi: V3 } | null {
  const body = anatomy.parts.find((p) => p.name === "body")!;
  let lo: V3 = [Infinity, Infinity, Infinity];
  let hi: V3 = [-Infinity, -Infinity, -Infinity];
  if (bounds) [lo, hi] = bounds;
  else {
    const skip = new Set(["hem", "waist", "cuff", "neckline", "hemBand", "waistBand", "cuffBand"]);
    for (const q of field.prims()) {
      if (skip.has(q.tag)) continue;
      lo = [Math.min(lo[0], q.bx - q.br), Math.min(lo[1], q.by - q.br), Math.min(lo[2], q.bz - q.br)];
      hi = [Math.max(hi[0], q.bx + q.br), Math.max(hi[1], q.by + q.br), Math.max(hi[2], q.bz + q.br)];
    }
  }
  lo = [lo[0] - 3 * h, lo[1] - 3 * h, lo[2] - 3 * h];
  hi = [hi[0] + 3 * h, hi[1] + 3 * h, hi[2] + 3 * h];
  const nearest = under ? nearestVertex(under) : null;
  const fine = meshField(field, lo, hi, h);
  if (!fine.indices.length) return null;
  // no long edges, so the surface stays within a trim's few millimetres of where it should be
  const dec = decimate(fine.positions, fine.indices, tris, band ? 0.01 : 0.022);
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
    if (nearest && under) {
      // a trim moves exactly as the garment under it does
      const u = nearest(p);
      for (let k = 0; k < 4; k++) {
        bones[v * 4 + k] = under.bones![u * 4 + k];
        weights[v * 4 + k] = under.weights![u * 4 + k];
      }
    } else {
      // the bones that move the skin just under it, but for those it mustn't follow
      body.field.near(p[0], p[1], p[2], 0.03, 0.03, near);
      anatomy.weigh(body, p, near, bi, bw);
      let total = 0;
      for (let k = 0; k < 4; k++) {
        if (drop?.has(bi[k])) bw[k] = 0;
        total += bw[k];
      }
      for (let k = 0; k < 4; k++) {
        bones[v * 4 + k] = total > 0 ? bi[k] : k === 0 ? rig0(anatomy) : 0;
        weights[v * 4 + k] = total > 0 ? bw[k] / total : k === 0 ? 1 : 0;
      }
    }
    cloth[v * 4] = band;
    cloth[v * 4 + 2] = occlusion(field, p, [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]], fine.near(p[0], p[1], p[2]));
  }
  return { mesh: { kind: "cloth", colour: 0, bone: null, positions, normals, indices: dec.indices, bones, weights, cloth }, lo, hi };
}

/** The hips' bone: what a garment's point follows when every bone near it is one it mustn't. */
function rig0(anatomy: Anatomy): number {
  return anatomy.rig.index.hips;
}

/** The nearest of a mesh's vertices to a point, from a grid of them (cells 2 cm across). */
function nearestVertex(m: ItemMesh): (p: V3) => number {
  const C = 0.02;
  const cells = new Map<string, number[]>();
  const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
  const P = m.positions;
  for (let v = 0; v < P.length / 3; v++) {
    const k = key(Math.floor(P[v * 3] / C), Math.floor(P[v * 3 + 1] / C), Math.floor(P[v * 3 + 2] / C));
    const list = cells.get(k);
    if (list) list.push(v);
    else cells.set(k, [v]);
  }
  return (p) => {
    const ci = Math.floor(p[0] / C);
    const cj = Math.floor(p[1] / C);
    const ck = Math.floor(p[2] / C);
    let best = 0;
    let bd = Infinity;
    for (let r = 1; r <= 3 && bd === Infinity; r++)
      for (let i = ci - r; i <= ci + r; i++)
        for (let j = cj - r; j <= cj + r; j++)
          for (let k = ck - r; k <= ck + r; k++)
            for (const v of cells.get(key(i, j, k)) ?? []) {
              const d = (P[v * 3] - p[0]) ** 2 + (P[v * 3 + 1] - p[1]) ** 2 + (P[v * 3 + 2] - p[2]) ** 2;
              if (d < bd) {
                bd = d;
                best = v;
              }
            }
    return best;
  };
}

/** The hoodie's hood, down, in a roll behind the neck; and its pocket across the belly. */
function hoodieExtras(a: Anatomy, f: Field) {
  const { rig } = a;
  const neck = rig.bones[rig.index.neck].head;
  const g = rig.marks.girth;
  f.add(Prim.ellipsoid(add(neck, [0, 0.035, -0.074]), [0.085 * g, 0.042, 0.05], 0, "hood", [0, 0.5, -1]), 0.03);
  for (const s of [-1, 1]) f.add(Prim.ellipsoid(add(neck, [s * 0.07 * g, 0.022, -0.035]), [0.04, 0.036, 0.055], 0, "hood", [s, 0.3, -0.4]), 0.03);
  const spine = rig.bones[rig.index.spine].head;
  f.add(Prim.ellipsoid(add(spine, [0, -0.01, 0.112 * g]), [0.1 * g, 0.055, 0.02], 0, "pocket", [0, 0, 1]), 0.012);
}

/**
 * A trapezoid's signed distance (after Inigo Quilez), in its plane: its middle at the origin, `r1`
 * half as wide at its foot as it is, `r2` at its top, `he` half as tall.
 */
function trapezoid(x: number, y: number, r1: number, r2: number, he: number): number {
  const k2x = r2 - r1;
  const k2y = 2 * he;
  const ax = Math.abs(x);
  const cax = ax - Math.min(ax, y < 0 ? r1 : r2);
  const cay = Math.abs(y) - he;
  const t = Math.max(0, Math.min(1, ((r2 - ax) * k2x + (he - y) * k2y) / (k2x * k2x + k2y * k2y)));
  const cbx = ax - r2 + k2x * t;
  const cby = y - he + k2y * t;
  const s = cbx < 0 && cay < 0 ? -1 : 1;
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
}

/** The middle of a garment's depth at a height: halfway between its front and back where x is 0 (the centre of what goes round it there). */
function middleAt(f: Field, y: number, zc: number): number {
  const find = (from: number, step: number) => {
    let z = from;
    for (let i = 0; i < 60 && f.at(0, y, z) > 0; i++) z += step;
    return z;
  };
  const front = find(zc + 0.4, -0.008);
  const back = find(zc - 0.4, 0.008);
  return back < front ? (front + back) / 2 : zc;
}

/** Two directions square to an axis, the first toward the front: for going round a ring about it. */
function ringFrame(axis: V3): { e1: V3; e2: V3 } {
  let e1 = sub([0, 0, 1], scale(axis, axis[2]));
  if (Math.hypot(...e1) < 1e-4) e1 = [1, 0, 0];
  e1 = norm(e1);
  return { e1, e2: norm(cross(axis, e1)) };
}

/** How far round a ring about `c` a point is (metres along it, from its front; it wraps at the back). */
function roundRing(frame: { e1: V3; e2: V3 }, c: V3, p: V3): number {
  const v = sub(p, c);
  const x = dot(v, frame.e1);
  const y = dot(v, frame.e2);
  return Math.atan2(y, x) * Math.hypot(x, y);
}

/**
 * Sew a garment: per vertex, the folds it falls into, its seams (signed distances to each), and its
 * hem's stitching (how far the edge is, how far round it), for the cloth material to draw.
 */
function sew(anatomy: Anatomy, pat: Pattern, shape: Shape, middle: (y: number) => number, mesh: ItemMesh): void {
  const { J, hips, hemY, waistY, limbs, trunkOf, limbField } = shape;
  const g = anatomy.rig.marks.girth;
  const P = mesh.positions;
  const N = mesh.normals;
  const n = P.length / 3;
  const folds = new Float32Array(n * 4);
  const seams = new Float32Array(n * 4);
  const trunk = trunkOf(0);
  const limbF = limbs.map(limbField);
  const chestY = J("chest")[1];
  const top = !!pat.arm;
  // the top of a hem band (a hoodie's), the foot of a waistband (shorts')
  const bandTop = hemY !== null && pat.trims?.hem ? hemY + pat.trims.hem : null;
  const bandFoot = waistY !== null ? waistY - (pat.trims?.waist ?? 0) : null;
  const hemRing = ringFrame([0, 1, 0]);
  const hemMiddle: V3 = [0, hemY ?? 0, hemY !== null ? middle(hemY) : 0];
  const limbRings = limbs.map((L) => ringFrame(L.dir));
  // the fly (shorts'): from under the waistband to just above the crotch, its foot curving in to the middle
  const flyW = 0.03 * g;
  const flyTop = bandFoot ?? 0;
  const flyFoot = hips[1] - 0.015;
  const flyR = Math.min(0.85 * flyW, (flyW + 0.004) / 2 - 0.001, (flyTop - flyFoot) / 2 - 0.001);
  // the hoodie's pocket, sewn on across the belly from the hem band up: narrower at its top, its slanting
  // sides the openings for the hands
  const pocket = pat.extras && bandTop !== null ? { y0: bandTop + 0.002, y1: bandTop + 0.55 * (chestY - bandTop), r1: 0.115 * g, r2: 0.078 * g } : null;
  for (let v = 0; v < n; v++) {
    const p: V3 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const dT = trunk.at(p[0], p[1], p[2]);
    let li = -1;
    let dL = Infinity;
    limbF.forEach((f, i) => {
      const d = f.at(p[0], p[1], p[2]);
      if (d < dL) {
        dL = d;
        li = i;
      }
    });
    const L = li >= 0 ? limbs[li] : null;
    // on a sleeve or leg rather than the trunk; and how far from where they join (folds fade there)
    const onLimb = !!L && dL < dT;
    const join = L ? smoothstep(0.003, 0.02, Math.abs(dT - dL)) : 1;
    // how far along the limb from its root, and the way it runs there
    let along = 0;
    let axis: V3 = [0, 1, 0];
    if (L) {
      const u1 = norm(sub(L.mid, L.root));
      const u2 = norm(sub(L.end, L.mid));
      const t1 = Math.max(0, Math.min(L.l1, dot(sub(p, L.root), u1)));
      const t2 = Math.max(0, Math.min(L.l2, dot(sub(p, L.mid), u2)));
      const d1 = Math.hypot(...sub(p, add(L.root, scale(u1, t1))));
      const d2 = Math.hypot(...sub(p, add(L.mid, scale(u2, t2))));
      along = d2 < d1 && t2 > 0 ? L.l1 + t2 : t1;
      const k = smoothstep(L.l1 - 0.03, L.l1 + 0.03, along);
      axis = norm(add(scale(u1, 1 - k), scale(u2, k)));
    }
    // a top's armhole: where its sleeve meets its body, halfway between the two (> 0 on the sleeve)
    const armhole = top && L ? (dT - dL) / 2 : -1;

    // the folds: a sleeve's or leg's creases round it, most at the elbow and the armpit, or the crotch;
    // a top's drape falling from the chest, bunched over a hem band; shorts' gathers under the waistband
    let depth: number;
    let mode = 1;
    if (onLimb && L) {
      mode = -1;
      if (top) {
        const elbow = Math.exp(-(((along - L.l1) / 0.06) ** 2));
        const pit = 1 - smoothstep(0, 0.09, along);
        depth = pat.folds.creases * (0.45 + 0.8 * elbow + 0.5 * pit) * smoothstep(0.004, 0.025, armhole);
      } else depth = pat.folds.creases * (0.55 + 0.7 * (1 - smoothstep(0, 0.12, along))) * join;
    } else {
      axis = [0, 1, 0];
      if (top) {
        const fall = smoothstep(chestY + 0.01, (hemY ?? hips[1]) + 0.05, p[1]);
        const blouse = bandTop !== null ? 1 - smoothstep(bandTop + 0.005, bandTop + 0.07, p[1]) : 0;
        depth = pat.folds.drape * (0.15 + fall + 0.7 * blouse) * smoothstep(0.004, 0.025, -armhole);
      } else {
        const gather = bandFoot !== null ? 1 - smoothstep(bandFoot - 0.004, bandFoot - 0.05, p[1]) : 0;
        depth = pat.folds.drape * (0.25 + 1.1 * gather) * join;
      }
    }
    folds.set([axis[0] * depth, axis[1] * depth, axis[2] * depth, mode], v * 4);

    // the seams. 1: where the front meets the back, as the cloth turns from facing forward to facing
    // back (a top's sides and over its shoulders; shorts' sides, then down each leg its outside and its
    // inside, and under the crotch): the normal's forward part, by about how round the body is there
    const s1 = N[v * 3 + 2] * 0.09 * g;
    // 2: a top's armholes; shorts' middle seam, front and back
    const s2 = top ? armhole : p[0];
    // 3: a pocket's outline (> 0 on the pocket); the fly's curve; far off elsewhere
    let s3 = top ? -0.05 : 0.05;
    let run = p[1];
    if (pocket && !onLimb && N[v * 3 + 2] > 0.3) {
      // its outline on the belly, its corners rounded
      s3 = -(trapezoid(p[0], p[1] - (pocket.y0 + pocket.y1) / 2, pocket.r1 - 0.008, pocket.r2 - 0.008, (pocket.y1 - pocket.y0) / 2 - 0.008) - 0.008);
      run = 0.8 * p[0] + p[1];
    } else if (!top && N[v * 3 + 2] > 0.25 && bandFoot !== null) {
      // on the wearer's left: a box from just past the middle out to the curve, its foot rounded
      const qx = Math.abs(-p[0] - (flyW - 0.004) / 2) - (flyW + 0.004) / 2 + flyR;
      const qy = Math.abs(p[1] - (flyTop + flyFoot) / 2) - (flyTop - flyFoot) / 2 + flyR;
      s3 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - flyR;
    }
    seams.set([s1, s2, s3, run], v * 4);

    // the hem: turned up and stitched twice, at a top's foot or a leg's end: how far the edge is, how far round
    if (pat.hemmed) {
      let edge = 1;
      let round = 0;
      if (top && !onLimb && hemY !== null) {
        edge = p[1] - hemY;
        round = roundRing(hemRing, hemMiddle, p);
      } else if (!top && onLimb && L) {
        edge = dot(sub(L.p, p), L.dir);
        round = roundRing(limbRings[li], L.p, p);
      }
      mesh.cloth[v * 4 + 1] = edge;
      mesh.cloth[v * 4 + 3] = 10 + round;
    }
  }
  mesh.fabric = pat.fabric;
  mesh.folds = folds;
  mesh.seamLines = seams;
  mesh.seamStyle = pat.seams;
  if (pat.hemmed) {
    // two rows, 9 and 15.5 mm in from the edge; the hem turned up 2.2 cm inside
    mesh.stitch = [0.009, 0.0065, 2, 0.003];
    mesh.hem = 0.022;
  }
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
