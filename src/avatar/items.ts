// What a chimp wears, made for its body (avatar/wardrobe.ts lists them). Every item
// is a few pieces, each made from shapes (avatar/sdf.ts) and meshed as the chimp is:
//
// - worn on a bone: a cap or beanie fitted over the skull and its fur, glasses
//   before the eyes, headphones over the ears, a bandana or a chain round the neck,
//   a pack on the back, a watch at the wrist. Meshed in the rest pose's space, then
//   carried by the bone (avatar/chimp.ts).
// - fitted to the body (a tee, a hoodie, shorts: avatar/garments.ts), weighted to its
//   bones as the skin under it is.
//
// Each piece is cloth, plastic, metal, glass or light, in the item's first or second
// colour; each item says which fur it hides, so no hair pokes through it.
//
// Plain numbers and no Babylon: built in the model worker (avatar/build.worker.ts).

import type { Anatomy, PartName } from "./anatomy";
import { decimate } from "./decimate";
import { buildGarment } from "./garments";
import { meshField, settle } from "./mesher";
import { Field, Mode, Prim, type V3, add, cross, len, lerp3, norm, scale, smoothstep, sub } from "./sdf";

export type PieceKind = "cloth" | "plastic" | "metal" | "glass" | "light";

export interface ItemMesh {
  kind: PieceKind;
  /** which of the item's colours: 0 its first, 1 its second (bands carry the second regardless) */
  colour: number;
  /** a colour of its own instead (a banana's yellow, clear glass) */
  hex?: string;
  /** worn on this bone (positions in rest space); null: fitted to the body and skinned */
  bone: string | null;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  bones?: Float32Array;
  weights?: Float32Array;
  /** per vertex: on a band (the second colour), unused, creases' shade, unused */
  cloth: Float32Array;
}

export interface ItemModel {
  id: string;
  meshes: ItemMesh[];
  /** how much of each part's fur-carrier vertices it hides */
  cover: Partial<Record<PartName, Float32Array>>;
  /** a print on it, as the cloth material takes it: centre and half size in rest space (x, y, w, h) */
  print?: [number, number, number, number];
  /** knitted (a beanie): ribs rather than a weave */
  knit?: boolean;
}

/** A piece of a worn item: its shapes, the grid it is meshed on, how many triangles it keeps. */
interface Piece {
  kind: PieceKind;
  colour: number;
  hex?: string;
  field: Field;
  h: number;
  tris: number;
  /** shapes whose surface is the item's second colour (a cap's brim, a beanie's cuff) */
  bands?: Prim[];
}

interface Plan {
  bone: string;
  pieces: Piece[];
  /** the fur it hides: > 0 inside */
  covers?: (x: number, y: number, z: number) => number;
  print?: [number, number, number, number];
  knit?: boolean;
}

/** Build an item for this chimp; null if there is no such item. */
export function buildItem(anatomy: Anatomy, furPositions: Partial<Record<PartName, Float32Array>>, id: string): ItemModel | null {
  const garment = buildGarment(anatomy, furPositions, id);
  if (garment) return garment;
  const plan = PLANS[id]?.(anatomy);
  if (!plan) return null;
  const meshes: ItemMesh[] = [];
  for (const piece of plan.pieces) {
    const m = meshPiece(piece);
    if (m) meshes.push({ ...m, kind: piece.kind, colour: piece.colour, hex: piece.hex, bone: plan.bone });
  }
  const cover: Partial<Record<PartName, Float32Array>> = {};
  if (plan.covers) {
    for (const [part, pos] of Object.entries(furPositions) as [PartName, Float32Array][]) {
      const c = new Float32Array(pos.length / 3);
      let any = false;
      for (let v = 0; v < c.length; v++) {
        c[v] = Math.max(0, Math.min(1, plan.covers(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])));
        if (c[v] > 0) any = true;
      }
      if (any) cover[part] = c;
    }
  }
  return { id, meshes, cover, print: plan.print, knit: plan.knit };
}

/** Mesh a piece: on its grid, simplified, settled on its surface; its bands and creases worked out. */
function meshPiece(p: Piece): Omit<ItemMesh, "kind" | "colour" | "bone"> | null {
  const [lo, hi] = addedBounds(p.field);
  const pad = 3 * p.h;
  const fine = meshField(p.field, [lo[0] - pad, lo[1] - pad, lo[2] - pad], [hi[0] + pad, hi[1] + pad, hi[2] + pad], p.h);
  if (!fine.indices.length) return null;
  const dec = decimate(fine.positions, fine.indices, p.tris, 1);
  const positions = Float32Array.from(dec.positions);
  const normals = settle(p.field, positions, fine.near, p.h);
  const n = positions.length / 3;
  const cloth = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    let band = 0;
    // on a band's surface (not merely inside it)
    for (const b of p.bands ?? []) band = Math.max(band, 1 - smoothstep(0.0015, 0.004, Math.abs(b.d(x, y, z))));
    cloth[v * 4] = band;
    let occ = 0;
    let w = 1;
    for (const s of [0.004, 0.01, 0.02]) {
      const d = p.field.at(x + normals[v * 3] * s, y + normals[v * 3 + 1] * s, z + normals[v * 3 + 2] * s);
      occ += (Math.max(0, s - d) / s) * w;
      w *= 0.7;
    }
    cloth[v * 4 + 2] = Math.max(0, Math.min(1, 1 - occ * 0.4));
  }
  return { positions, normals, indices: dec.indices, cloth };
}

/**
 * The box round what a field adds (its added shapes, and theirs within any part
 * added whole): what is cut away or kept by a meet (often a huge half-space box)
 * can't make the item any bigger.
 */
function addedBounds(f: Field, lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity]): [V3, V3] {
  for (const op of f.ops) {
    if (op.mode !== Mode.Add && op.mode !== Mode.Limb) continue;
    if (op.sub) {
      addedBounds(op.sub, lo, hi);
      continue;
    }
    for (let i = 0; i < 3; i++) {
      const c = [op.bx, op.by, op.bz][i];
      lo[i] = Math.min(lo[i], c - op.br);
      hi[i] = Math.max(hi[i], c + op.br);
    }
  }
  return [lo, hi];
}

/** Distance helpers for what an item covers. */
const inside = (d: number, soft = 0.004) => smoothstep(soft, -soft, d);

/** The head's frame: the skull's middle and radii, the eyes, the ears and the way they face, scaled with the head. */
function headFrame(a: Anatomy) {
  const m = a.rig.marks;
  const C = m.cranium;
  const R = m.craniumR;
  const hk = R[0] / 0.088;
  return { C, R, hk, m, P: (x: number, y: number, z: number): V3 => add(C, [x * hk, y * hk, z * hk]) };
}

/** A dome fitted over the skull and its fur, cut level with the brow in front and lower behind. */
function dome(a: Anatomy, lift: number, front: number, back: number) {
  const { C, R, P } = headFrame(a);
  const shell = Prim.ellipsoid(add(C, [0, 0.004, -0.014]), [R[0] + lift, R[1] + lift, R[2] + lift], 0, "crown");
  // the rim's plane: through `front` above the skull's middle at its front, and `back` behind
  const f: V3 = P(0, front, 0.1);
  const b: V3 = P(0, back, -0.1);
  const along = norm(sub(f, b));
  const up = norm(cross(along, [1, 0, 0]));
  const mid = lerp3(f, b, 0.5);
  const above = Prim.box(add(mid, scale(up, 0.5 * (up[1] > 0 ? 1 : -1))), [1, 0.5, 1], 0, 0, "rim", along, up[1] > 0 ? up : scale(up, -1));
  return { shell, above, rimPoint: mid, rimUp: up[1] > 0 ? up : scale(up, -1) };
}

const PLANS: Record<string, (a: Anatomy) => Plan> = {
  cap(a) {
    const { C, R, hk } = headFrame(a);
    const { shell, above } = dome(a, 0.013, 0.036, -0.03);
    const crown = new Field();
    crown.add(shell);
    crown.meet(above, 0.004);
    // the brim: a curved peak out over the face from the crown's front, and a button on top
    const front = C[2] - 0.014 + R[2] + 0.013;
    const brimC: V3 = [C[0], C[1] + 0.034 * hk, front - 0.012];
    const brim = Prim.ellipsoid(brimC, [0.08 * hk, 0.0042, 0.084 * hk], 0, "brim", [0, -0.22, 1], [0, 1, 0.22]);
    const brimF = new Field();
    brimF.add(brim);
    // only what stands out in front of the crown
    brimF.meet(Prim.box([C[0], C[1], front - 0.03 + 0.5], [1, 1, 0.5], 0, 0, "front"), 0.002);
    crown.add(brimF, 0.006);
    const button = crown.add(Prim.sphere(add(C, [0, R[1] + 0.017, -0.01]), 0.0075, 0, "button"), 0.003);
    const under = shell.inflate(0.006);
    return {
      bone: "head",
      pieces: [{ kind: "cloth", colour: 0, field: crown, h: 0.0022, tris: 5000, bands: [brim, button] }],
      // the fur under the crown, down to just below its rim
      covers: (x, y, z) => inside(under.d(x, y, z)) * inside(above.d(x, y, z) - 0.008, 0.006),
      print: [C[0], C[1] + 0.06 * hk, 0.02 * hk, 0.02 * hk],
    };
  },

  beanie(a) {
    const { C, R } = headFrame(a);
    const { shell, above, rimPoint, rimUp } = dome(a, 0.016, 0.026, -0.05);
    const f = new Field();
    f.add(shell);
    f.meet(above, 0.005);
    // the turned-up cuff: a thicker ring just above the rim
    const cuffShell = Prim.ellipsoid(add(C, [0, 0.004, -0.014]), [R[0] + 0.024, R[1] + 0.024, R[2] + 0.024], 0, "cuff");
    const cuff = new Field();
    cuff.add(cuffShell);
    cuff.meet(Prim.box(add(rimPoint, scale(rimUp, 0.02)), [1, 0.02, 1], 0.004, 0, "cuffBand", norm(cross(rimUp, [1, 0, 0])), rimUp), 0.004);
    f.add(cuff, 0.004);
    // a bobble on top
    f.add(Prim.sphere(add(C, [0, R[1] + 0.04, -0.02]), 0.03, 0, "bobble"), 0.01);
    const under = shell.inflate(0.008);
    return {
      bone: "head",
      pieces: [{ kind: "cloth", colour: 0, field: f, h: 0.0028, tris: 5200, bands: [cuffShell] }],
      covers: (x, y, z) => inside(under.d(x, y, z)) * inside(above.d(x, y, z) - 0.008, 0.006),
      knit: true,
    };
  },

  headphones(a) {
    const { C, R, m } = headFrame(a);
    const band = new Field();
    // an arc over the skull, ear to ear, clear of the fur
    const outer = Prim.ellipsoid(add(C, [0, -0.006, -0.012]), [R[0] + 0.04, R[1] + 0.034, 0.011], 0, "band");
    const innerE = Prim.ellipsoid(add(C, [0, -0.006, -0.012]), [R[0] + 0.029, R[1] + 0.023, 0.03], 0, "bandIn");
    band.add(outer);
    band.cut(innerE, 0.002);
    band.meet(Prim.box(add(C, [0, 0.5 + 0.005, 0]), [1, 0.5, 1], 0, 0, "top"), 0.003);
    const cups = new Field();
    const cushions = new Field();
    for (const [ear, s] of [
      [m.earL, -1],
      [m.earR, 1],
    ] as [V3, number][]) {
      const n = norm([s, 0.12, 0.85]);
      const side = norm([s, 0, 0.25]);
      const c = add(add(ear, scale(n, 0.026)), [s * 0.012, 0, 0]);
      // a round puck over the ear, its cushion against the head
      cups.add(Prim.ellipsoid(c, [0.042, 0.046, 0.017], 0, "cup", side, [0, 1, 0]));
      cups.add(Prim.ellipsoid(add(c, scale(side, 0.012)), [0.028, 0.031, 0.008], 0, "cap", side, [0, 1, 0]), 0.004);
      cushions.add(Prim.torus(add(c, scale(side, -0.015)), side, 0.03, 0.0095, 0, "cushion", 0.75));
      // the arm from the band down to the cup
      cups.add(Prim.cone(add(C, [s * (R[0] + 0.034), 0.0, -0.012]), add(c, [0, 0.045, 0]), 0.0055, 0.006, 0, "arm"), 0.006);
    }
    return {
      bone: "head",
      pieces: [
        { kind: "plastic", colour: 0, field: band, h: 0.0022, tris: 2400 },
        { kind: "plastic", colour: 1, field: cups, h: 0.0025, tris: 3000 },
        { kind: "cloth", colour: 0, field: cushions, h: 0.0022, tris: 1600, bands: [] },
      ],
    };
  },

  shades: (a) => glasses(a, true),
  specs: (a) => glasses(a, false),

  bandana(a) {
    const neck = a.rig.bones[a.rig.index.neck].head;
    const g = a.rig.marks.girth;
    const f = new Field();
    const ringC = add(neck, [0, 0.012, 0.004]);
    const axis = norm([0, 1, 0.22]);
    // a rolled kerchief round the neck, knotted behind, its point hanging over the chest
    f.add(Prim.torus(ringC, axis, 0.086 * g + 0.014, 0.017, 0, "roll", 0.7));
    f.add(Prim.sphere(add(ringC, [0, 0.0, -(0.086 * g + 0.03)]), 0.022, 0, "knot"), 0.01);
    const flapC = add(ringC, [0, -0.055, 0.086 * g + 0.012]);
    const flap = new Field();
    flap.add(Prim.ellipsoid(flapC, [0.07, 0.07, 0.007], 0, "flap", [0, -0.35, 1]));
    // cut to a point: two slanting cuts below
    flap.cut(Prim.box(add(flapC, [0.5 + 0.0, -0.5 - 0.0, 0]), [0.5, 0.5, 0.5], 0, 0, "v1", [0, 0, 1], norm([1, 1, 0])), 0.002);
    flap.cut(Prim.box(add(flapC, [-0.5, -0.5, 0]), [0.5, 0.5, 0.5], 0, 0, "v2", [0, 0, 1], norm([-1, 1, 0])), 0.002);
    flap.meet(Prim.box(add(flapC, [0, -0.5 + 0.035, 0]), [1, 0.5, 1], 0, 0, "top"), 0.002);
    f.add(flap, 0.01);
    const roll = Prim.torus(ringC, axis, 0.086 * g + 0.014, 0.024, 0, "rollCover", 0.7);
    return {
      bone: "neck",
      pieces: [{ kind: "cloth", colour: 0, field: f, h: 0.0035, tris: 3400 }],
      covers: (x, y, z) => inside(roll.d(x, y, z), 0.006),
    };
  },

  chain(a) {
    const up = a.rig.bones[a.rig.index.upperChest].head;
    const g = a.rig.marks.girth;
    const chain = new Field();
    // a loop resting on the shoulders and chest, lower in front
    const c = add(up, [0, 0.105, 0.012]);
    const axis = norm([0, 1, 0.6]);
    const R = 0.105 * g;
    chain.add(Prim.torus(c, axis, R, 0.0042, 0, "chain", 1));
    const under = Prim.torus(c, axis, R, 0.011, 0, "", 1);
    // the pendant: a banana hanging from the front of the loop
    const top = add(c, [0, -R * 0.49, R * 0.86 + 0.01]);
    const banana = new Field();
    const p0 = add(top, [-0.012, -0.012, 0.004]);
    const p1 = add(top, [-0.002, -0.034, 0.008]);
    const p2 = add(top, [0.016, -0.05, 0.007]);
    const p3 = add(top, [0.032, -0.056, 0.004]);
    banana.add(Prim.cone(p0, p1, 0.0045, 0.0075, 0, "banana"));
    banana.add(Prim.cone(p1, p2, 0.0075, 0.0072, 0, "banana"), 0.004);
    banana.add(Prim.cone(p2, p3, 0.0072, 0.003, 0, "banana"), 0.004);
    const link = new Field();
    link.add(Prim.torus(top, [1, 0, 0], 0.006, 0.0018, 0, "link"));
    link.add(Prim.cone(top, p0, 0.002, 0.0028, 0, "stalk"), 0.002);
    return {
      bone: "upperChest",
      pieces: [
        { kind: "metal", colour: 0, field: chain, h: 0.0016, tris: 2600 },
        { kind: "metal", colour: 0, field: link, h: 0.0012, tris: 500 },
        { kind: "plastic", colour: 0, hex: "#ffd23f", field: banana, h: 0.0016, tris: 1000 },
      ],
      covers: (x, y, z) => inside(under.d(x, y, z), 0.004),
    };
  },

  backpack(a) {
    const r = a.rig;
    const up = r.bones[r.index.upperChest].head;
    const chest = r.bones[r.index.chest].head;
    const g = r.marks.girth;
    const back = -(r.marks.chestZ + 0.02);
    // the pack, on the upper back, leaning back a touch
    const packC = add(lerp3(up, chest, 0.4), [0, 0, back - 0.07 * g]);
    const pack = new Field();
    const body = Prim.box(packC, [0.105 * g, 0.135, 0.042], 0.05, 0, "pack", [0, -0.1, -1], [0, 1, -0.1]);
    pack.add(body);
    // a rounded top, as a rucksack's is
    pack.add(Prim.ellipsoid(add(packC, [0, 0.12, -0.005]), [0.13 * g, 0.075, 0.075], 0, "packTop", [0, 0, -1]), 0.04);
    const packUnder = body.inflate(0.012);
    // a pocket on its back, and a loop on top to hang it by
    const pocket = Prim.box(add(packC, [0, -0.055, -0.07]), [0.08 * g, 0.06, 0.016], 0.018, 0, "pocket", [0, 0, -1]);
    pack.add(pocket, 0.008);
    pack.add(Prim.torus(add(packC, [0, 0.205, -0.005]), [0, 0, 1], 0.024, 0.0055, 0, "loop", 1), 0.004);
    const straps = new Field();
    for (const s of [-1, 1]) {
      const sh = r.bones[r.index[s < 0 ? "leftUpperArm" : "rightUpperArm"]].head;
      const topBack = add(packC, [s * 0.07 * g, 0.13, 0.03]);
      const over = add(sh, [-s * 0.07, 0.07, -0.01]);
      const front = add(sh, [-s * 0.055, -0.08, 0.13 * g]);
      const pit = add(sh, [-s * 0.035, -0.16, 0.04]);
      const under = add(packC, [s * 0.11 * g, -0.12, 0.04]);
      // a flat strap: tapered capsules from the pack, over the shoulder, down the chest and back under the arm
      for (const [p, q] of [
        [topBack, over],
        [over, front],
        [front, pit],
        [pit, under],
      ] as [V3, V3][])
        straps.add(Prim.cone(p, q, 0.012, 0.012, 0, "strap"), 0.01);
    }
    return {
      bone: "upperChest",
      pieces: [
        { kind: "cloth", colour: 0, field: pack, h: 0.0045, tris: 4800, bands: [pocket] },
        { kind: "cloth", colour: 1, field: straps, h: 0.004, tris: 2400, bands: [] },
      ],
      covers: (x, y, z) => Math.max(inside(packUnder.d(x, y, z), 0.008), inside(straps.at(x, y, z) - 0.012, 0.006)),
    };
  },

  watch(a) {
    const r = a.rig;
    const el = r.bones[r.index.leftLowerArm].head;
    const wr = r.bones[r.index.leftHand].head;
    const dir = norm(sub(wr, el));
    const g = r.marks.girth;
    const at = add(wr, scale(dir, -0.03));
    // the forearm's own girth there, and a little over it
    const rad = 0.034 * g + 0.0012;
    const strap = new Field();
    strap.add(Prim.torus(at, dir, rad, 0.008, 0, "strap", 0.4));
    const under = Prim.torus(at, dir, rad, 0.016, 0, "", 0.55);
    // the case on the back of the wrist, its screen glowing ChimpVibe mint
    const palm = r.marks.hands[0].palm;
    const outward = scale(palm, -1);
    const caseC = add(at, scale(outward, rad + 0.006));
    const box = new Field();
    box.add(Prim.box(caseC, [0.018, 0.006, 0.021], 0.004, 0, "case", dir, outward));
    const screen = new Field();
    screen.add(Prim.box(add(caseC, scale(outward, 0.0062)), [0.0135, 0.0012, 0.0165], 0.002, 0, "screen", dir, outward));
    return {
      bone: "leftLowerArm",
      pieces: [
        { kind: "cloth", colour: 0, field: strap, h: 0.0022, tris: 1600 },
        { kind: "metal", colour: 1, field: box, h: 0.0015, tris: 900 },
        { kind: "light", colour: 0, field: screen, h: 0.0012, tris: 300 },
      ],
      covers: (x, y, z) => inside(under.d(x, y, z), 0.005),
    };
  },
};

/** Round glasses: dark lenses and a frame for shades, clear lenses for glasses. */
function glasses(a: Anatomy, dark: boolean): Plan {
  const { m } = headFrame(a);
  const frame = new Field();
  const lenses = new Field();
  const r = 0.021 * (m.eyeRadius / 0.0128) ** 0.5;
  const thick = dark ? 0.0028 : 0.0019;
  const ends: V3[] = [];
  for (const e of [m.eyeL, m.eyeR]) {
    const s = e[0] < m.cranium[0] ? -1 : 1;
    // just before the eye, over the brow's shadow, clear of the nose
    const c = add(e, [s * 0.003, 0.002, m.eyeRadius + 0.024]);
    frame.add(Prim.torus(c, [s * 0.08, 0, 1], r, thick, 0, "rim", 1));
    lenses.add(Prim.ellipsoid(c, [r * 0.98, r * 0.98, 0.0018], 0, "lens", norm([s * 0.08, 0, 1])));
    ends.push(add(c, [s * r, 0.002, -0.002]));
    // the arm back to the ear, along the side of the head
    const ear = s < 0 ? m.earL : m.earR;
    const hinge = add(c, [s * (r + 0.002), 0.003, -0.004]);
    const back = add(ear, [-s * 0.012, 0.006, 0.004]);
    frame.add(Prim.cone(hinge, back, thick * 0.9, thick * 0.8, 0, "arm"), 0.002);
  }
  // the bridge over the nose
  const l = add(m.eyeL, [0.003 + r - 0.002, 0.004, m.eyeRadius + 0.024]);
  const rr = add(m.eyeR, [-0.003 - r + 0.002, 0.004, m.eyeRadius + 0.024]);
  const mid = add(lerp3(l, rr, 0.5), [0, 0.006, 0.004]);
  frame.add(Prim.cone(l, mid, thick * 0.9, thick * 0.9, 0, "bridge"), 0.002);
  frame.add(Prim.cone(mid, rr, thick * 0.9, thick * 0.9, 0, "bridge"), 0.002);
  void ends;
  void len;
  return {
    bone: "head",
    pieces: [
      { kind: dark ? "plastic" : "metal", colour: 0, field: frame, h: 0.0011, tris: 2600 },
      { kind: "glass", colour: 1, hex: dark ? undefined : "#e8f4f2", field: lenses, h: 0.0012, tris: 900 },
    ],
  };
}
