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
import { type RawMesh, rawMesh, surfaceAlong, toItemMesh, topAt } from "./fit";
import { buildGarment } from "./garments";
import { meshField, settle } from "./mesher";
import { type PrintArt, printAspect } from "./wordmark";
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
  /** per vertex: on a band (the second colour), how far the edge is (for stitching), creases' shade, how far along the edge (+10; 0 none) */
  cloth: Float32Array;
  /** a crown's panel seams: the axis they meet on (x, z), how many, their turn; or a knitted hat's ribs round it (avatar/materials.ts) */
  seams?: [number, number, number, number];
  /** knitted (ribs rather than a weave), for this piece rather than the whole item; yarn's fuzz */
  knit?: boolean;
  fuzz?: number;
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
  return { id, meshes, cover, print: plan.print, printArt: plan.printArt, knit: plan.knit };
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
