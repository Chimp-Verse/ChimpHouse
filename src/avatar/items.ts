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
import { type RawMesh, disc, drape, hitAlong, normalAt, onSkin, pathDistance, rawMesh, ringOnSkin, rope, skinOf, smoothPath, strapProfile, surfaceAlong, sweep, toItemMesh, topAt, torusMesh, tubeProfile, weighOnBody } from "./fit";
import { buildGarment } from "./garments";
import { meshField, settle } from "./mesher";
import { type PrintArt, printAspect } from "./wordmark";
import { Field, Mode, Prim, type V3, add, cross, dot, len, lerp3, norm, scale, smoothstep, sub } from "./sdf";

export type PieceKind = "cloth" | "plastic" | "metal" | "glass" | "light" | "dial";

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
  /** per vertex: on a band (the second colour), how far the edge is (for stitching), creases' shade, how far along the edge (+10; 0 none) */
  cloth: Float32Array;
  /** a crown's panel seams: the axis they meet on (x, z), how many, their turn; or a knitted hat's ribs round it (avatar/materials.ts) */
  seams?: [number, number, number, number];
  /** knitted (ribs rather than a weave), for this piece rather than the whole item; yarn's fuzz */
  knit?: boolean;
  fuzz?: number;
  /** where its picture is laid (a watch's dial, avatar/materials.ts dialTexture) */
  uvs?: Float32Array;
}

export interface ItemModel {
  id: string;
  meshes: ItemMesh[];
  /** how much of each part's fur-carrier vertices it hides */
  cover: Partial<Record<PartName, Float32Array>>;
  /** a print on it, as the cloth material takes it: centre and half size in rest space (x, y, w, h) */
  print?: [number, number, number, number];
  /** what the print shows (the tree; the tree over the word), and which of the item's colours is its main ink (none: one that stands out from the cloth) */
  printArt?: PrintArt;
  printInk?: number;
  /** a printed pattern all over it, in its second colour (1: a bandana's paisley and border) */
  pattern?: number;
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
  /** shapes whose surface is the item's second colour (a cap's button) */
  bands?: Prim[];
  /** or a region of it in the second colour: 1 in it (a beanie's cuff) */
  bandAt?: (x: number, y: number, z: number) => number;
  /** panel seams (a cap's crown), knitting, fuzz: see ItemMesh */
  seams?: [number, number, number, number];
  knit?: boolean;
  fuzz?: number;
}

interface Plan {
  bone: string;
  pieces: Piece[];
  /** pieces made directly as meshes (avatar/fit.ts): a cap's peak, a strap */
  meshes?: ItemMesh[];
  /** weighted to the body's bones as the skin under it is (it moves with the neck, the shoulders), rather than carried by `bone` */
  skinned?: boolean;
  /** a printed pattern all over it (1: a bandana's) */
  pattern?: number;
  /** the fur it hides: > 0 inside */
  covers?: (x: number, y: number, z: number) => number;
  print?: [number, number, number, number];
  printArt?: PrintArt;
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
    if (m) meshes.push({ ...m, kind: piece.kind, colour: piece.colour, hex: piece.hex, bone: plan.bone, seams: piece.seams, knit: piece.knit, fuzz: piece.fuzz });
  }
  meshes.push(...(plan.meshes ?? []));
  if (plan.skinned) for (let i = 0; i < meshes.length; i++) meshes[i] = weighOnBody(anatomy, meshes[i]);
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
  return { id, meshes, cover, print: plan.print, printArt: plan.printArt, knit: plan.knit, pattern: plan.pattern };
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
    if (p.bandAt) band = Math.max(band, p.bandAt(x, y, z));
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

/** The skull's own shapes (avatar/anatomy.ts), grown by `lift`: what a hat is fitted to, whatever the head's size. */
function skull(a: Anatomy, lift: number): Field {
  const head = a.parts.find((p) => p.name === "head")!;
  const f = new Field();
  for (const op of head.field.ops)
    if (op.mode === Mode.Add && op.prim && (op.prim.tag === "cranium" || op.prim.tag === "occiput")) f.add(op.prim.inflate(lift), f.ops.length ? 0.03 : 0);
  return f;
}

/**
 * Where a hat's band goes round the head: `clear` over the top of the brow ridge in
 * front (found on the head itself, so a heavy brow raises it), and `back` (as a share
 * of the head's size) from the skull's middle behind, down toward the nape. A plane,
 * level side to side: its height at any depth, and the half-space above it.
 */
function hatBand(a: Anatomy, shell: Field, clear: number, back: number) {
  const { C, hk } = headFrame(a);
  const head = a.parts.find((p) => p.name === "head")!.field;
  // the brow ridge's top: the highest the head comes over the eyes, in front of the skull
  let brow = -Infinity;
  for (const x of [-0.045, -0.03, -0.015, 0, 0.015, 0.03, 0.045])
    for (const z of [0.076, 0.086, 0.096]) brow = Math.max(brow, topAt(head, C[0] + x * hk, C[2] + z * hk, C[1] + 0.14 * hk, C[1] - 0.02 * hk));
  const yF = brow + clear;
  const zF = C[2] + surfaceAlong(shell, [C[0], yF, C[2]], [0, 0, 1]);
  const yB = C[1] + back * hk;
  const zB = C[2] - 0.02 * hk - surfaceAlong(shell, [C[0], yB, C[2] - 0.02 * hk], [0, 0, -1]);
  const slope = (yF - yB) / (zF - zB);
  const y = (z: number) => yB + (z - zB) * slope;
  const up = norm([0, 1, -slope]);
  const along = norm([0, slope, 1]);
  const mid: V3 = [C[0], y((zF + zB) / 2), (zF + zB) / 2];
  const above = Prim.box(add(mid, scale(up, 0.5)), [1, 0.5, 1], 0, 0, "band", along, up);
  /** how far over the band's plane a point is (below it: negative) */
  const over = (yy: number, z: number) => (yy - y(z)) * up[1];
  return { y, above, over, mid, along, up, front: [C[0], yF, zF] as V3, back: [C[0], yB, zB] as V3, brow };
}

/**
 * A cap's peak: a stiff bill out over the brow, as wide as the crown's front. Its inner
 * edge follows the crown round the band (found on the crown itself); it tilts down a
 * little, its sides curve down more, as a worn-in cap's do, and its edge is rounded.
 */
function capPeak(crown: Field, C: V3, hk: number, bandY: (z: number) => number): RawMesh {
  const out = rawMesh();
  const SPAN = 1.22;
  const N = 27;
  const L0 = 0.074 * hk;
  const T = 0.0048;
  const r = T / 2;
  const TOP = 7;
  const EDGE = 6;
  const loops: { p: V3; n: V3; open: number; e: number }[][] = [];
  const rims: V3[] = [];
  for (let i = 0; i < N; i++) {
    const u = -1 + (2 * i) / (N - 1);
    const phi = u * SPAN;
    const d: V3 = [Math.sin(phi), 0, Math.cos(phi)];
    // the crown's face along d, at the band's height there (which hangs on how far forward that is)
    let q: V3 = add(C, scale(d, 0.09 * hk));
    for (let k = 0; k < 3; k++) {
      const o: V3 = [C[0], bandY(q[2]) + 0.0035, C[2]];
      q = add(o, scale(d, surfaceAlong(crown, o, d)));
    }
    const tilt = 0.13 + 0.5 * u * u;
    const side: V3 = [Math.cos(phi), 0, -Math.sin(phi)];
    const f = norm(add(scale(d, Math.cos(tilt)), [0, -Math.sin(tilt), 0]));
    let n = norm(cross(f, side));
    if (n[1] < 0) n = scale(n, -1);
    const L = Math.max(0.005, L0 * Math.pow(Math.max(0, 1 - u * u), 0.55));
    const at = (v: number, w: number): V3 => add(q, add(scale(f, v), scale(n, w)));
    const dir = (cv: number, cw: number): V3 => norm(add(scale(f, cv), scale(n, cw)));
    const loop: { p: V3; n: V3; open: number; e: number }[] = [];
    // over the top from inside the crown to the edge, round the edge, back under; e is how far in from the edge
    for (let k = 0; k < TOP; k++) {
      const v = -0.004 + ((L - r + 0.004) * k) / (TOP - 1);
      loop.push({ p: at(v, r), n: n, open: 1, e: L - v });
    }
    for (let k = 1; k < EDGE; k++) {
      const ang = Math.PI / 2 - (Math.PI * k) / EDGE;
      loop.push({ p: at(L - r + r * Math.cos(ang), r * Math.sin(ang)), n: dir(Math.cos(ang), Math.sin(ang)), open: 0.9, e: 0 });
    }
    for (let k = TOP - 1; k >= 0; k--) {
      const v = -0.004 + ((L - r + 0.004) * k) / (TOP - 1);
      loop.push({ p: at(v, -r), n: scale(n, -1), open: 0.55 + 0.25 * (k / (TOP - 1)), e: L - v });
    }
    loops.push(loop);
    rims.push(at(L, 0));
  }
  const m = loops[0].length;
  let along = 0;
  loops.forEach((loop, i) => {
    if (i > 0) along += len(sub(rims[i], rims[i - 1]));
    for (const v of loop) {
      out.positions.push(...v.p);
      out.normals.push(...v.n);
      out.open.push(v.open);
      out.edge.push(v.e);
      out.along.push(along);
    }
  });
  for (let i = 0; i < N - 1; i++)
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const a0 = i * m + k;
      const a1 = i * m + k2;
      const b0 = (i + 1) * m + k;
      const b1 = (i + 1) * m + k2;
      out.indices.push(a0, b0, a1, a1, b0, b1);
    }
  // the two narrow ends, closed
  for (const i of [0, N - 1]) {
    const mid = out.positions.length / 3;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const v of loops[i]) {
      cx += v.p[0] / m;
      cy += v.p[1] / m;
      cz += v.p[2] / m;
    }
    const sideN = i === 0 ? norm(sub(loops[0][0].p, loops[1][0].p)) : norm(sub(loops[N - 1][0].p, loops[N - 2][0].p));
    out.positions.push(cx, cy, cz);
    out.normals.push(...sideN);
    out.open.push(0.8);
    out.edge.push(0.05);
    out.along.push(i === 0 ? 0 : along);
    for (let k = 0; k < m; k++) out.indices.push(mid, i * m + k, i * m + ((k + 1) % m));
  }
  return out;
}

const PLANS: Record<string, (a: Anatomy) => Plan> = {
  cap(a) {
    const { C, hk } = headFrame(a);
    // the crown: the skull grown a centimetre (the hair pressed flat under it), above the band
    const shell = skull(a, 0.011);
    const band = hatBand(a, shell, 0.012, -0.035);
    const crown = new Field();
    crown.add(shell);
    crown.meet(band.above, 0.003);
    // the snapback behind: an arch cut over a strap 1.4 cm deep
    const strapTop = band.back[1] + 0.014;
    const archR = 0.024 * hk;
    const arch = new Field();
    arch.add(Prim.cone([C[0], strapTop + archR * 0.3, C[2] - 0.03 * hk], [C[0], strapTop + archR * 0.3, C[2] - 0.3], archR, archR, 0, "arch"));
    arch.meet(Prim.box([C[0], strapTop + 0.5, C[2]], [1, 0.5, 1], 0, 0, "overStrap"));
    crown.cut(arch, 0.002);
    // the button on top, where the six panels meet
    const top = topAt(crown, C[0], C[2] - 0.012 * hk, C[1] + 0.25, C[1]);
    const button = crown.add(Prim.sphere([C[0], top + 0.0025, C[2] - 0.012 * hk], 0.0068, 0, "button"), 0.002);
    // the print on the front panel: low on it, where it faces forward
    const panel = top - band.front[1];
    const printH = 0.28 * panel;
    const peak = capPeak(crown, C, hk, band.y);
    const under = shell.prims().map((q) => q.inflate(0.01));
    const inSkull = (x: number, y: number, z: number) => Math.min(...under.map((q) => q.d(x, y, z)));
    return {
      bone: "head",
      // six panels, the front one whole (its seams either side of it)
      pieces: [{ kind: "cloth", colour: 0, field: crown, h: 0.0022, tris: 5200, bands: [button], seams: [C[0], C[2] - 0.012 * hk, 6, Math.PI / 6] }],
      meshes: [toItemMesh(peak, "cloth", 1, "head", 0)],
      covers: (x, y, z) => {
        const over = band.over(y, z);
        const skullIn = inside(inSkull(x, y, z), 0.004);
        // none under the crown; pressed flat in the snapback's opening and in a strip below the band
        const crowned = skullIn * inside(-over, 0.002);
        const opening = arch.at(x, y, z) < 0.004 ? 1 : 0;
        const below = skullIn * (1 - smoothstep(0, 0.016, -over)) * 0.6;
        // the brow under the peak: pressed down so it stays under it
        const brow = smoothstep(band.brow - 0.03, band.brow - 0.012, y) * smoothstep(band.front[2] - 0.03, band.front[2] - 0.005, z) * (1 - smoothstep(0.055 * hk, 0.08 * hk, Math.abs(x - C[0]))) * (over < 0 ? 0.78 : 0);
        return Math.max(crowned * (1 - opening), opening * 0.7 * skullIn, below, brow);
      },
      print: [C[0], band.front[1] + 0.36 * panel, printH * printAspect("mark"), printH],
      printArt: "mark",
    };
  },

  beanie(a) {
    const { C, hk } = headFrame(a);
    // knitted, a little looser than a cap and with a little body over the crown; pulled down to just over the brow
    const shell = skull(a, 0.014);
    const band = hatBand(a, shell, 0.005, -0.05);
    const f = new Field();
    f.add(shell);
    f.add(Prim.ellipsoid(add(C, [0, 0.045 * hk, -0.03 * hk]), [0.07 * hk, 0.058 * hk, 0.076 * hk], 0, "slouch"), 0.05);
    f.meet(band.above, 0.004);
    // the cuff turned up round the bottom: 2.4 cm deep, standing a little proud
    const CUFF = 0.024;
    const cuff = new Field();
    cuff.add(skull(a, 0.021));
    cuff.meet(Prim.box(add(band.mid, scale(band.up, CUFF / 2)), [1, CUFF / 2, 1], 0.004, 0, "cuff", band.along, band.up));
    f.add(cuff, 0.003);
    // the bobble on top: a ball of yarn ends, its own piece (fuzzy, not ribbed)
    const top = topAt(f, C[0], C[2] - 0.02 * hk, C[1] + 0.25, C[1]);
    const bob: V3 = [C[0], top + 0.024, C[2] - 0.02 * hk];
    const bobble = new Field();
    bobble.add(Prim.sphere(bob, 0.025, 0, "bobble"));
    for (let i = 0; i < 34; i++) {
      // tufts all over it (a golden-angle spiral), a little uneven
      const yy = 1 - (2 * (i + 0.5)) / 34;
      const rr = Math.sqrt(1 - yy * yy);
      const th = i * 2.39996;
      const out = 0.023 + 0.003 * Math.sin(i * 7.31);
      bobble.add(Prim.sphere(add(bob, scale([rr * Math.cos(th), yy, rr * Math.sin(th)], out)), 0.0068 + 0.0016 * Math.cos(i * 3.7), 0, "tuft"), 0.003);
    }
    // its base pulled into the crown
    bobble.add(Prim.cone(add(bob, [0, -0.012, 0]), [bob[0], top - 0.004, bob[2]], 0.012, 0.009, 0, "tie"), 0.006);
    const under = shell.prims().map((q) => q.inflate(0.01));
    const inSkull = (x: number, y: number, z: number) => Math.min(...under.map((q) => q.d(x, y, z)));
    return {
      bone: "head",
      pieces: [
        {
          kind: "cloth",
          colour: 0,
          field: f,
          h: 0.0026,
          tris: 6000,
          // the cuff in the second colour; ribs round the hat, 84 of them
          bandAt: (_x, y, z) => 1 - smoothstep(CUFF - 0.002, CUFF + 0.002, band.over(y, z)),
          seams: [C[0], C[2] - 0.02 * hk, -84, 0],
          knit: true,
        },
        { kind: "cloth", colour: 1, field: bobble, h: 0.0015, tris: 3400, fuzz: 1 },
      ],
      covers: (x, y, z) => {
        const over = band.over(y, z);
        const skullIn = inside(inSkull(x, y, z), 0.004);
        return Math.max(skullIn * inside(-over, 0.002), skullIn * (1 - smoothstep(0, 0.016, -over)) * 0.6);
      },
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
    const r = a.rig;
    const g = r.marks.girth;
    const skin = skinOf(a);
    const J = (n: string): V3 => r.bones[r.index[n]].head;
    // the roll: round the neck above the shoulders, lower in front and higher behind, on the skin
    const neckBase = add(J("upperChest"), [0, 0.07, -0.006]);
    const neckTop = add(J("head"), [0, 0.045, 0.004]);
    const O = lerp3(neckBase, neckTop, 0.48);
    const tilt = 0.4;
    const X: V3 = [1, 0, 0];
    const F: V3 = [0, -Math.sin(tilt), Math.cos(tilt)];
    const N = 56;
    const ring = ringOnSkin(skin, O, N, (t) => add(scale(X, Math.cos(t)), scale(F, Math.sin(t))));
    // fatter in front, where the folded cloth bunches, and at the knot behind
    const front = (i: number) => Math.cos((i / N) * Math.PI * 2 - Math.PI / 2);
    const rollR = (i: number) => (0.0085 + 0.0035 * Math.max(0, front(i)) + 0.0015 * Math.max(0, -front(i))) * Math.sqrt(g);
    const GAP = 0.003;
    let path = ring.at.map((p, i) => add(p, scale(ring.normal[i], rollR(i) + GAP)));
    path = smoothPath(path, 4, true);
    const roll = rawMesh();
    rope(roll, path, ring.normal, rollR, 260);

    // the triangle: hung from under the roll in front, draped over the chest to a point
    const SPAN = 0.95;
    const L = 0.13 * Math.sqrt(g);
    const THICK = 0.0018;
    const topAtS = (sv: number): V3 => {
      // the roll's point at this angle round the front, a little under it
      const ang = Math.PI / 2 + sv * SPAN;
      const f = (ang / (Math.PI * 2)) * N;
      const i0 = Math.floor(f);
      const t = f - i0;
      const p = lerp3(path[i0 % N], path[(i0 + 1) % N], t);
      const nn = norm(lerp3(ring.normal[i0 % N], ring.normal[(i0 + 1) % N], t));
      return add(p, add(scale(nn, -rollR(i0) * 0.5), [0, -rollR(i0) * 0.6, 0]));
    };
    const axisZ = J("chest")[2];
    const flap = drape(skin, topAtS, add(topAtS(0), [0, -L, 0]), [O[0], axisZ], { cols: 15, rows: 13, gap: GAP + 0.0012, bulge: 0.0045, folds: 0.0022, thick: THICK });

    // the knot behind, and its two ends hanging from it, draped on the back
    const back = Math.round(N * 0.75);
    const kn = add(path[back], scale(ring.normal[back], 0.005));
    const kN = ring.normal[back];
    const knot = new Field();
    knot.add(Prim.ellipsoid(kn, [0.015 * Math.sqrt(g), 0.013, 0.012], 0, "knot", kN, [0, 1, 0]));
    for (const s of [-1, 1]) knot.add(Prim.ellipsoid(add(kn, [s * 0.013, 0.004, -0.002]), [0.011, 0.009, 0.008], 0, "knotEar", kN, [0, 1, 0]), 0.005);
    // each end a short, broad triangle of the cloth, hanging down and out from under the knot
    const ends = [-1, 1].map((s) =>
      drape(skin, (t) => add(kn, [s * (0.003 + 0.017 * (t + 1)), -0.007 - 0.004 * (t + 1), 0]), add(kn, [s * 0.03, -0.052 * Math.sqrt(g), 0]), [O[0], axisZ], {
        cols: 9,
        rows: 9,
        gap: GAP + 0.0025,
        bulge: 0.0025,
        folds: 0.0012,
        thick: THICK,
        toward: O,
        // too small for the border to read as one
        border: false,
      }),
    );

    // the fur under it goes; round it, pressed down
    const sheetPts = [...flap.points, ...ends.flatMap((e) => e.points)];
    return {
      bone: "neck",
      pieces: [{ kind: "cloth", colour: 0, field: knot, h: 0.0016, tris: 2600 }],
      meshes: [toItemMesh(roll, "cloth", 0, null), toItemMesh(flap.raw, "cloth", 0, null), ...ends.map((e) => toItemMesh(e.raw, "cloth", 0, null))],
      skinned: true,
      pattern: 1,
      covers: (x, y, z) => {
        const p: V3 = [x, y, z];
        const dRoll = pathDistance(path, true, p) - 0.012 * Math.sqrt(g);
        let best = Infinity;
        for (const q of sheetPts) best = Math.min(best, (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2);
        const dFlap = Math.sqrt(best);
        const dKnot = len(sub(kn, p)) - 0.022;
        const under = Math.max(inside(dRoll, 0.003), dFlap < 0.011 ? 1 : 0, inside(dKnot, 0.004));
        const near = Math.max(1 - smoothstep(0.0, 0.022, dRoll), 1 - smoothstep(0.011, 0.024, dFlap), 1 - smoothstep(0, 0.02, dKnot)) * 0.75;
        return Math.max(under, near);
      },
    };
  },

  chain(a) {
    const r = a.rig;
    const g = r.marks.girth;
    const skin = skinOf(a);
    const J = (n: string): V3 => r.bones[r.index[n]].head;
    // the loop: round the base of the neck, over the shoulders' slope and down onto the chest in
    // front, where the pendant's weight pulls it into a V; found on the skin all the way round
    const neckBase = add(J("upperChest"), [0, 0.07, -0.006]);
    const neckTop = add(J("head"), [0, 0.045, 0.004]);
    // traced round the neck a little out from it, then each point dropped onto the nearest skin: over
    // the hump behind, on the shoulders' slope just beside the neck, down the chest in front
    const O = lerp3(neckBase, neckTop, 0.5);
    const U = J("upperChest")[1];
    const neckR = 0.09 * g;
    const N = 72;
    const at0: V3[] = [];
    const nrm0: V3[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const front = Math.max(0, Math.sin(t));
      const back = Math.max(0, -Math.sin(t));
      const rho = (neckR + 0.02) * (1 + 0.3 * front);
      const p = onSkin(skin, [O[0] + rho * Math.cos(t), U + 0.165 - 0.04 * front - 0.075 * front ** 4 + 0.02 * back, O[2] - 0.01 + rho * Math.sin(t)]);
      at0.push(p);
      nrm0.push(normalAt(skin, p));
    }
    const ring = { at: at0, normal: nrm0 };
    const LINK_R = 0.0036;
    const WIRE = 0.00135;
    const GAP = 0.004;
    let path = ring.at.map((p, i) => add(p, scale(ring.normal[i], GAP + WIRE * 2.2)));
    path = smoothPath(path, 6, true);
    // links along it, a link every 8 mm, each turned a quarter from the last (a cable chain)
    const chain = rawMesh();
    const lengths = [0];
    for (let i = 1; i <= N; i++) lengths.push(lengths[i - 1] + len(sub(path[i % N], path[i - 1])));
    const total = lengths[N];
    const count = Math.round(total / 0.0079 / 2) * 2;
    const pointAt = (d: number): { p: V3; t: V3; n: V3 } => {
      let i = 0;
      while (i < N - 1 && lengths[i + 1] < d) i++;
      const f = (d - lengths[i]) / Math.max(1e-9, lengths[i + 1] - lengths[i]);
      const p = lerp3(path[i], path[(i + 1) % N], f);
      return { p, t: norm(sub(path[(i + 1) % N], path[i])), n: norm(lerp3(ring.normal[i], ring.normal[(i + 1) % N], f)) };
    };
    for (let k = 0; k < count; k++) {
      const { p, t, n } = pointAt((k / count) * total);
      // flat on the chest, then standing up
      const axis = k % 2 === 0 ? n : norm(cross(t, n));
      torusMesh(chain, p, axis, t, LINK_R, WIRE, 1.45, 14, 7);
    }
    // the pendant: from the loop's lowest point in front, a bail, then a banana hanging on the chest
    let low = 0;
    for (let i = 1; i < N; i++) if (path[i][1] < path[low][1]) low = i;
    const at = path[low];
    const nOut = ring.normal[low];
    const side = norm(cross([0, 1, 0], nOut));
    const bail = rawMesh();
    torusMesh(bail, add(at, [0, -0.007, 0]), side, [0, 1, 0], 0.0045, 0.0013, 1.2, 14, 7);
    // the banana: a crescent hanging down and curving to one side, its stalk up in the bail
    const banana = new Field();
    const stalk = new Field();
    const top = add(add(at, [0, -0.014, 0]), scale(nOut, 0.002));
    const onChest = (p: V3): V3 => {
      // each point of the banana stood off the chest by its thickness, so it lies on the coat
      const out = norm([p[0] - O[0], 0, p[2] - J("chest")[2]]);
      const hit = hitAlong(skin, add(p, scale(out, 0.06)), scale(out, -1), 0.15) ?? p;
      return add(hit, scale(normalAt(skin, hit), GAP + 0.0085));
    };
    const arc: V3[] = [];
    const SEGS = 7;
    const LEN = 0.058 * Math.sqrt(g);
    for (let k = 0; k <= SEGS; k++) {
      const u = k / SEGS;
      // down the chest, curving out to the side and back in at the tip
      arc.push(onChest(add(top, add(scale(side, 0.016 * Math.sin(Math.PI * u * 0.9)), [0, -LEN * u, 0]))));
    }
    for (let k = 0; k < SEGS; k++) {
      const u0 = k / SEGS;
      const u1 = (k + 1) / SEGS;
      // fattest a third of the way down, narrowing to the stalk and to the tip
      const rad = (u: number) => 0.0028 + 0.0058 * Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.7;
      banana.add(Prim.cone(arc[k], arc[k + 1], rad(u0), rad(u1), 0, "banana"), 0.004);
    }
    stalk.add(Prim.cone(add(top, [0, 0.004, 0]), arc[0], 0.0019, 0.0026, 0, "stalk"));
    stalk.add(Prim.sphere(arc[SEGS], 0.0024, 0, "tip"), 0.001);
    const pendant = [...arc];
    return {
      bone: "upperChest",
      pieces: [
        { kind: "plastic", colour: 0, hex: "#f7c934", field: banana, h: 0.0011, tris: 2400 },
        { kind: "plastic", colour: 0, hex: "#4a3218", field: stalk, h: 0.0009, tris: 600 },
      ],
      meshes: [toItemMesh(chain, "metal", 0, null), toItemMesh(bail, "metal", 0, null)],
      skinned: true,
      // the fur under the chain goes; along it, pressed flat so the chain lies on the coat
      covers: (x, y, z) => {
        const p: V3 = [x, y, z];
        const d = pathDistance(path, true, p);
        let dp = Infinity;
        for (const q of pendant) dp = Math.min(dp, len(sub(q, p)));
        return Math.max(d < 0.006 ? 1 : 0.82 * (1 - smoothstep(0.006, 0.026, d)), dp < 0.012 ? 0.85 : 0.82 * (1 - smoothstep(0.012, 0.028, dp)));
      },
    };
  },

  backpack(a) {
    const r = a.rig;
    const g = r.marks.girth;
    const skin = skinOf(a);
    const J = (n: string): V3 => r.bones[r.index[n]].head;
    const U = J("upperChest");
    const Ch = J("chest");
    const shX = r.marks.shoulderX;
    const GAP = 0.007;
    // the back where the pack rests: its surface down the middle, found from inside the body
    const backAt = (x: number, y: number): V3 => {
      const from: V3 = [x, y, Ch[2]];
      return add(from, scale([0, 0, -1], surfaceAlong(skin, from, [0, 0, -1])));
    };
    // on the back below the hump, leaning as the back does
    const midY = Ch[1] + 0.02;
    const topB = backAt(0, midY + 0.1);
    const botB = backAt(0, midY - 0.1);
    const up = norm(sub(topB, botB));
    const out = norm(cross(up, [1, 0, 0]));
    const away: V3 = out[2] < 0 ? out : scale(out, -1);
    const right = norm(cross(away, up));
    const HW = 0.105 * g;
    const HH = 0.13;
    const HD = 0.052;
    // the pack: a rounded body, fuller toward its front and top, a pocket low on its front
    const packAt = (C: V3) => {
      const P = (x: number, y: number, z: number): V3 => add(C, add(add(scale(right, x), scale(up, y)), scale(away, z)));
      const f = new Field();
      f.add(Prim.box(C, [HW, HH, HD], 0.036, 0, "pack", away, up));
      f.add(Prim.ellipsoid(P(0, 0.02, 0.028), [HW * 0.86, HH * 0.9, HD * 0.75], 0, "front", away, up), 0.05);
      f.add(Prim.ellipsoid(P(0, HH - 0.03, 0.0), [HW * 0.95, 0.045, HD * 0.95], 0, "crown", away, up), 0.04);
      const pocket = Prim.box(P(0, -0.06, HD + 0.011), [HW * 0.7, 0.05, 0.019], 0.019, 0, "pocket", away, up);
      f.add(pocket, 0.008);
      return { f, pocket, P };
    };
    // first against the back's middle, then pushed out until no point of its back half is closer
    // to the skin than the fur pressed under it (the hump, the shoulder blades)
    let C = add(lerp3(topB, botB, 0.5), scale(away, GAP + HD));
    for (let round = 0; round < 3; round++) {
      const { f } = packAt(C);
      let push = 0;
      for (let u = -1; u <= 1.001; u += 0.25)
        for (let v = -1; v <= 1.001; v += 0.25) {
          const d = norm(add(add(scale(right, u * HW), scale(up, v * HH)), scale(away, -HD)));
          const q = add(C, scale(d, surfaceAlong(f, C, d)));
          push = Math.max(push, GAP - skin.at(q[0], q[1], q[2]));
        }
      if (push <= 0.0005) break;
      C = add(C, scale(away, push));
    }
    const { f: pack, pocket, P } = packAt(C);
    const panel = add(C, scale(away, -HD));
    // its zips: one over the top and down the sides, one along the pocket's top; a pull on each
    const zips = rawMesh();
    const zipPath: V3[] = [];
    for (let k = 0; k <= 28; k++) {
      const t = -Math.PI * 0.42 + (k / 28) * Math.PI * 0.84;
      const d = norm(add(scale(right, Math.sin(t)), scale(up, Math.cos(t))));
      const o = P(0, 0, 0.012);
      zipPath.push(add(o, scale(d, surfaceAlong(pack, o, d) + 0.0012)));
    }
    sweep(zips, zipPath, zipPath.map(() => away), tubeProfile(0.0024, 8), false);
    const pocketZip: V3[] = [];
    for (let k = 0; k <= 12; k++) {
      const x = (-0.62 + (1.24 * k) / 12) * HW;
      const o = P(x, -0.06 + 0.042, 0.0);
      pocketZip.push(add(o, scale(away, surfaceAlong(pack, o, away) + 0.0012)));
    }
    sweep(zips, pocketZip, pocketZip.map(() => up), tubeProfile(0.0022, 8), false);
    const pulls = new Field();
    for (const end of [zipPath[3], zipPath[zipPath.length - 4], pocketZip[2]]) pulls.add(Prim.box(add(end, scale(away, 0.004)), [0.0045, 0.011, 0.0018], 0.0015, 0, "pull", away, up));
    // the handle on top
    const handle = new Field();
    handle.add(Prim.torus(P(0, HH + 0.006, -0.01), away, 0.024, 0.0055, 0, "handle", 1));
    handle.meet(Prim.box(P(0, HH + 0.006 + 0.5, 0), [1, 0.5, 1], 0, 0, "topHalf", away, up));

    // the straps: from the pack's top, over each shoulder beside the neck, down the chest, round
    // under the arm and back to the pack's foot; each point laid on the skin, the fur pressed under it
    const WIDTH = 0.034 * Math.sqrt(g);
    const THICK = 0.0055;
    const straps = rawMesh();
    const strapPaths: V3[][] = [];
    const buckles = new Field();
    const chestY = U[1] - 0.06;
    const chestPts: V3[] = [];
    for (const s of [-1, 1]) {
      const ctrl: V3[] = [
        add(P(s * HW * 0.55, HH * 0.82, -HD), scale(away, -0.01)),
        [s * shX * 0.55, U[1] + 0.13, U[2] - 0.04],
        [s * shX * 0.52, U[1] + 0.09, U[2] + 0.1],
        [s * shX * 0.5, U[1] - 0.04, U[2] + 0.15],
        [s * shX * 0.62, Ch[1] - 0.04, Ch[2] + 0.1],
        [s * shX * 0.82, Ch[1] - 0.06, Ch[2] - 0.03],
        add(P(s * HW * 0.82, -HH * 0.8, -HD), scale(away, -0.01)),
      ];
      // a smooth curve through them (Catmull-Rom), dense, each point on the skin and stood off it
      const dense: V3[] = [];
      for (let i = 0; i < ctrl.length - 1; i++) {
        const p0 = ctrl[Math.max(0, i - 1)];
        const p1 = ctrl[i];
        const p2 = ctrl[i + 1];
        const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
        for (let k = 0; k < 10; k++) {
          const t = k / 10;
          const t2 = t * t;
          const t3 = t2 * t;
          dense.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)) as V3);
        }
      }
      dense.push(ctrl[ctrl.length - 1]);
      const onBody = dense.map((q) => onSkin(skin, q));
      const normals = onBody.map((q) => normalAt(skin, q));
      let path = onBody.map((q, i) => add(q, scale(normals[i], GAP * 0.6 + THICK / 2)));
      path = smoothPath(path, 3, false);
      // its underside, against the body, sees less light
      const prof = strapProfile(WIDTH, THICK);
      sweep(straps, path, normals, prof, false, (_i, k) => (prof[k].p[1] < 0 ? 0.55 : 1));
      strapPaths.push(path);
      // a slider on the strap low on the chest, where its length is set
      const at = Math.round(dense.length * 0.52);
      const tangent = norm(sub(path[at + 1], path[at - 1]));
      buckles.add(Prim.box(add(path[at], scale(normals[at], THICK * 0.6)), [WIDTH * 0.62, 0.009, 0.0035], 0.002, 0, "slider", normals[at], tangent));
      // where the chest strap crosses
      let best = 0;
      for (let i = 0; i < path.length; i++) if (Math.abs(path[i][1] - chestY) < Math.abs(path[best][1] - chestY) && path[i][2] > U[2]) best = i;
      chestPts.push(path[best]);
    }
    // the chest strap, across between them, clipped in the middle
    const across: V3[] = [];
    for (let k = 0; k <= 16; k++) across.push(onSkin(skin, lerp3(chestPts[0], chestPts[1], k / 16)));
    const acrossN = across.map((q) => normalAt(skin, q));
    const chestPath = smoothPath(
      across.map((q, i) => add(q, scale(acrossN[i], GAP * 0.6 + THICK * 1.4))),
      2,
      false,
    );
    sweep(straps, chestPath, acrossN, strapProfile(WIDTH * 0.45, THICK * 0.8), false);
    const mid = chestPath[8];
    buckles.add(Prim.box(add(mid, scale(acrossN[8], 0.003)), [0.014, 0.009, 0.004], 0.003, 0, "clip", acrossN[8], [0, 1, 0]));
    strapPaths.push(chestPath);

    const packPts: V3[] = [];
    for (const u of [-1, -0.5, 0, 0.5, 1]) for (const v of [-1, -0.5, 0, 0.5, 1]) packPts.push(P(u * HW, v * HH, -HD));
    return {
      bone: "upperChest",
      pieces: [
        { kind: "cloth", colour: 0, field: pack, h: 0.004, tris: 5200, bands: [pocket] },
        { kind: "cloth", colour: 1, field: handle, h: 0.0018, tris: 700 },
        { kind: "plastic", colour: 0, hex: "#1d1f22", field: pulls, h: 0.0012, tris: 500 },
        { kind: "plastic", colour: 0, hex: "#1d1f22", field: buckles, h: 0.0012, tris: 900 },
      ],
      meshes: [weighOnBody(a, toItemMesh(straps, "cloth", 1, null)), toItemMesh(zips, "plastic", 0, "upperChest", 0, "#2a2c30")],
      covers: (x, y, z) => {
        const p: V3 = [x, y, z];
        // under the pack's back: what lies within its outline, behind the body
        const rel = sub(p, panel);
        const inPack = Math.abs(dot(rel, right)) < HW && Math.abs(dot(rel, up)) < HH && dot(rel, away) > -0.05 ? 1 : 0;
        let d = Infinity;
        for (const path of strapPaths) d = Math.min(d, pathDistance(path, false, p));
        const under = Math.max(inPack * 0.9, d < WIDTH * 0.55 ? 1 : 0);
        return Math.max(under, 0.75 * (1 - smoothstep(WIDTH * 0.55, WIDTH * 0.55 + 0.02, d)));
      },
    };
  },

  watch(a) {
    const r = a.rig;
    const g = r.marks.girth;
    const el = r.bones[r.index.leftLowerArm].head;
    const wr = r.bones[r.index.leftHand].head;
    // up the forearm toward the hand: the watch's 3 o'clock
    const dir = norm(sub(wr, el));
    const skin = skinOf(a, ["body", "handL"]);
    // a little up the forearm from the wrist's joint, the strap round it on its skin
    const at = add(wr, scale(dir, -0.036));
    const palm = r.marks.hands[0].palm;
    const across = norm(sub(palm, scale(dir, dot(palm, dir))));
    const side = norm(cross(dir, across));
    const N = 44;
    const ring = ringOnSkin(skin, at, N, (t) => add(scale(across, Math.cos(t)), scale(side, Math.sin(t))));
    const WIDTH = 0.018 * Math.pow(g, 0.3);
    const THICK = 0.003;
    let path = smoothPath(
      ring.at.map((p, i) => add(p, scale(ring.normal[i], 0.0012 + THICK / 2))),
      3,
      true,
    );
    // the case on the back of the wrist (away from the palm), on the strap
    const back = N / 2;
    const n = ring.normal[back];
    const e3 = norm(sub(dir, scale(n, dot(dir, n))));
    // 12 o'clock: square to 3 and to the face, as it reads from in front
    const e12 = norm(cross(e3, n));
    const R = 0.0175;
    const H = 0.0085;
    const c = add(path[back], scale(n, THICK / 2 + H / 2 - 0.0005));
    // the strap runs flat under the case out to its lugs, then bends round the wrist
    const under = add(c, scale(n, -H / 2 + THICK / 2 + 0.0003));
    path = path.map((p) => {
      const t = Math.abs(dot(sub(p, c), e12));
      const lift = dot(sub(under, p), n);
      const k = 1 - smoothstep(R + 0.002, R + 0.014, t);
      return lift > 0 && dot(sub(p, c), n) > -0.03 ? add(p, scale(n, lift * k)) : p;
    });
    const strap = rawMesh();
    const prof = strapProfile(WIDTH, THICK);
    sweep(strap, path, ring.normal, prof, true, (_i, k) => (prof[k].p[1] < 0 ? 0.5 : 1));
    const top = add(c, scale(n, H / 2));
    // a flat cylinder (a rounded cone cut to a slab: a round cone is capped with half-spheres), its top
    // hollowed for the dial and its edges softened; the bezel round the glass a little proud
    const slab = (at: V3, half: number) => Prim.box(at, [R * 2, half, R * 2], 0, 0, "slab", e3, n);
    const kase = new Field();
    kase.add(Prim.cone(add(c, scale(n, -H)), add(c, scale(n, H)), R, R, 0, "case"));
    kase.meet(slab(c, H / 2), 0.0014);
    const recess = new Field();
    recess.add(Prim.cone(add(c, scale(n, -H)), add(c, scale(n, H * 2)), R - 0.0028, R - 0.0028, 0, "recess"));
    recess.meet(slab(add(top, scale(n, 0.0072)), 0.01));
    kase.cut(recess, 0.0004);
    kase.add(Prim.torus(add(top, scale(n, -0.0004)), n, R - 0.0014, 0.0016, 0, "bezel", 1), 0.0008);
    // lugs at 12 and 6 holding the strap; the crown at 3
    for (const s12 of [-1, 1])
      for (const s3 of [-1, 1]) kase.add(Prim.box(add(add(c, scale(e12, s12 * (R + 0.0022))), add(scale(e3, s3 * 0.0068), scale(n, -0.0016))), [0.0015, 0.0036, 0.0022], 0.0008, 0, "lug", n, e12), 0.0014);
    kase.add(Prim.cone(add(c, scale(e3, R - 0.001)), add(c, scale(e3, R + 0.0042)), 0.0022, 0.0021, 0, "crown"), 0.0006);
    // the glass, a shallow dome over the hollow; the dial at the hollow's floor under it
    const crystal = new Field();
    crystal.add(Prim.ellipsoid(add(top, scale(n, -0.0006)), [R - 0.0022, 0.0013, R - 0.0022], 0, "crystal", e3, n));
    const dial = rawMesh();
    disc(dial, add(top, scale(n, -0.0026)), n, e3, e12, R - 0.0029);
    // the buckle on the inside of the wrist: a frame across the strap, and its tongue
    const buckle = rawMesh();
    const bn = ring.normal[0];
    torusMesh(buckle, add(path[0], scale(bn, THICK / 2 + 0.0011)), bn, dir, 0.0042, 0.0011, (WIDTH * 0.62) / 0.0042, 18, 7);
    return {
      bone: "leftLowerArm",
      pieces: [
        { kind: "metal", colour: 1, field: kase, h: 0.0006, tris: 3000 },
        { kind: "glass", colour: 0, hex: "#e8f4f2", field: crystal, h: 0.0006, tris: 700 },
      ],
      meshes: [toItemMesh(strap, "cloth", 0, "leftLowerArm"), toItemMesh(dial, "dial", 0, "leftLowerArm"), toItemMesh(buckle, "metal", 1, "leftLowerArm")],
      // the fur under the strap and the case goes; round them, pressed flat so the watch sits on the arm
      covers: (x, y, z) => {
        const p: V3 = [x, y, z];
        const d = Math.min(pathDistance(path, true, p) - WIDTH * 0.55, len(sub(p, c)) - R - 0.004);
        return Math.max(d < 0 ? 1 : 0, 0.82 * (1 - smoothstep(0, 0.024, d)));
      },
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
