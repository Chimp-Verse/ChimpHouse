// Builds a chimp's geometry from its DNA: each part of the anatomy meshed on a fine
// grid, simplified to its budget, settled exactly onto the surface, and given what
// each vertex needs to be drawn and moved (bone weights, the skin's paint, the shade
// of the creases round it); then each part's fur carrier, simplified further. The
// result is plain typed arrays, so it can be built in a worker and cached by the
// DNA's geometry key: chimps shaped alike share it.

import type { ChimpDna } from "./dna";
import { type Anatomy, type Paint, type Part, type PartName, buildAnatomy } from "./anatomy";
import { decimate } from "./decimate";
import { meshField, settle } from "./mesher";
import type { Rig } from "./rig";
import type { Field, V3 } from "./sdf";

export interface SkinArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** four bones and four weights per vertex */
  bones: Float32Array;
  weights: Float32Array;
  /** fur amount, fur length, palm colour, darker skin */
  paintA: Float32Array;
  /** grey beard, creases' shade (ambient occlusion), nail, mouth */
  paintB: Float32Array;
}

export interface FurArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  bones: Float32Array;
  weights: Float32Array;
  /** fur amount, fur length, grey beard, creases' shade */
  furA: Float32Array;
  /** the way the fur lies (xyz), unused w */
  flow: Float32Array;
}

export interface PartModel {
  name: PartName;
  skin: SkinArrays;
  fur: FurArrays | null;
}

export interface ChimpModel {
  rig: Rig;
  parts: PartModel[];
  /** milliseconds each step took, for tuning */
  timing: Record<string, number>;
}

export function buildModel(dna: ChimpDna, only?: PartName[]): ChimpModel {
  const timing: Record<string, number> = {};
  let t = now();
  const anatomy = buildAnatomy(dna);
  timing.anatomy = now() - t;
  const parts: PartModel[] = [];
  for (const part of anatomy.parts) {
    if (only && !only.includes(part.name)) continue;
    t = now();
    const fine = meshField(part.field, part.min, part.max, part.h);
    timing[`${part.name}.mesh`] = now() - t;
    t = now();
    const skinMesh = decimate(fine.positions, fine.indices, part.skin.tris, part.skin.edge);
    timing[`${part.name}.simplify`] = now() - t;
    t = now();
    const skin = skinOf(anatomy, part, skinMesh.positions, skinMesh.indices, fine.near);
    timing[`${part.name}.skin`] = now() - t;
    t = now();
    const carrier = decimate(skinMesh.positions, skinMesh.indices, part.fur.tris, part.fur.edge);
    const fur = furOf(anatomy, part, carrier.positions, carrier.indices, fine.near);
    timing[`${part.name}.fur`] = now() - t;
    parts.push({ name: part.name, skin, fur });
  }
  return { rig: anatomy.rig, parts, timing };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

type Near = (x: number, y: number, z: number) => number[];

function skinOf(anatomy: Anatomy, part: Part, positions: Float32Array, indices: Uint32Array, near: Near): SkinArrays {
  const pos = Float32Array.from(positions);
  const normals = settle(part.field, pos, near, part.h);
  const n = pos.length / 3;
  const bones = new Float32Array(n * 4);
  const weights = new Float32Array(n * 4);
  const paintA = new Float32Array(n * 4);
  const paintB = new Float32Array(n * 4);
  const bi = new Int32Array(4);
  const bw = new Float32Array(4);
  const paint = blankPaint();
  const p: V3 = [0, 0, 0];
  const nn: V3 = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    p[0] = pos[v * 3];
    p[1] = pos[v * 3 + 1];
    p[2] = pos[v * 3 + 2];
    nn[0] = normals[v * 3];
    nn[1] = normals[v * 3 + 1];
    nn[2] = normals[v * 3 + 2];
    anatomy.weigh(part, p, near(p[0], p[1], p[2]), bi, bw);
    for (let k = 0; k < 4; k++) {
      bones[v * 4 + k] = bi[k];
      weights[v * 4 + k] = bw[k];
    }
    anatomy.paint(part.name, p, nn, paint);
    paintA[v * 4] = paint.fur;
    paintA[v * 4 + 1] = paint.furLen;
    paintA[v * 4 + 2] = paint.palm;
    paintA[v * 4 + 3] = paint.dark;
    paintB[v * 4] = paint.grey;
    paintB[v * 4 + 1] = occlusion(part.field, p, nn, near(p[0], p[1], p[2]));
    paintB[v * 4 + 2] = paint.nail;
    paintB[v * 4 + 3] = paint.mouth;
  }
  return { positions: pos, normals, indices, bones, weights, paintA, paintB };
}

/** The fur's carrier: the simplified carrier mesh settled and painted, keeping only its furred triangles. */
function furOf(anatomy: Anatomy, part: Part, positions: Float32Array, indices: Uint32Array, near: Near): FurArrays | null {
  const pos = Float32Array.from(positions);
  const normals = settle(part.field, pos, near, part.h);
  const n = pos.length / 3;
  const paint = blankPaint();
  const p: V3 = [0, 0, 0];
  const nn: V3 = [0, 0, 0];
  const paints: Paint[] = new Array(n);
  for (let v = 0; v < n; v++) {
    p[0] = pos[v * 3];
    p[1] = pos[v * 3 + 1];
    p[2] = pos[v * 3 + 2];
    nn[0] = normals[v * 3];
    nn[1] = normals[v * 3 + 1];
    nn[2] = normals[v * 3 + 2];
    anatomy.paint(part.name, p, nn, paint);
    paints[v] = { ...paint, flow: [paint.flow[0], paint.flow[1], paint.flow[2]] };
  }
  // the furred triangles, and their vertices renumbered
  const remap = new Int32Array(n).fill(-1);
  const idx: number[] = [];
  let count = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    if (Math.max(paints[a].fur, paints[b].fur, paints[c].fur) < 0.03) continue;
    for (const v of [a, b, c]) {
      if (remap[v] < 0) remap[v] = count++;
      idx.push(remap[v]);
    }
  }
  if (!count) return null;
  const out: FurArrays = {
    positions: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    indices: new Uint32Array(idx),
    bones: new Float32Array(count * 4),
    weights: new Float32Array(count * 4),
    furA: new Float32Array(count * 4),
    flow: new Float32Array(count * 4),
  };
  const bi = new Int32Array(4);
  const bw = new Float32Array(4);
  for (let v = 0; v < n; v++) {
    const r = remap[v];
    if (r < 0) continue;
    for (let k = 0; k < 3; k++) {
      out.positions[r * 3 + k] = pos[v * 3 + k];
      out.normals[r * 3 + k] = normals[v * 3 + k];
      p[k] = pos[v * 3 + k];
      nn[k] = normals[v * 3 + k];
    }
    const list = near(p[0], p[1], p[2]);
    anatomy.weigh(part, p, list, bi, bw);
    for (let k = 0; k < 4; k++) {
      out.bones[r * 4 + k] = bi[k];
      out.weights[r * 4 + k] = bw[k];
    }
    const pv = paints[v];
    out.furA[r * 4] = pv.fur;
    out.furA[r * 4 + 1] = pv.furLen;
    out.furA[r * 4 + 2] = pv.grey;
    out.furA[r * 4 + 3] = occlusion(part.field, p, nn, list);
    out.flow[r * 4] = pv.flow[0];
    out.flow[r * 4 + 1] = pv.flow[1];
    out.flow[r * 4 + 2] = pv.flow[2];
  }
  return out;
}

function blankPaint(): Paint {
  return { fur: 0, furLen: 1, palm: 0, dark: 0, grey: 0, nail: 0, mouth: 0, flow: [0, -1, 0] };
}

/**
 * How shut in a point is by the shapes round it (1 open, toward 0 in a deep
 * crease): the field sampled out along the normal, as in Inigo Quilez's
 * distance-field occlusion. It shades armpits, eye sockets, ear cups and the
 * gaps between fingers as light would.
 */
function occlusion(field: Field, p: V3, n: V3, list: number[]): number {
  let occ = 0;
  let w = 1;
  for (const s of [0.004, 0.009, 0.017, 0.03]) {
    const d = field.at(p[0] + n[0] * s, p[1] + n[1] * s, p[2] + n[2] * s, list);
    occ += (Math.max(0, s - d) / s) * w;
    w *= 0.7;
  }
  return Math.max(0, Math.min(1, 1 - occ * 0.42));
}
