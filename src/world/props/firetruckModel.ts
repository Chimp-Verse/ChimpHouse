// The showroom's firetruck: the model its creator built and shared ("HARBOR RESCUE 27",
// public/models/firetruck.glb, credited in public/models/CREDITS.md), shown on the display
// plinth at the old code-built truck's size. Its parts go into the room's merged meshes
// like any other piece, so the room's culling, lights, shadows and Blender export take it
// as they take the rest; its ~40 materials are folded into a few house materials, the
// base colours kept per vertex. Without the file (not fetched from Git LFS) the plinth
// keeps the code-built truck.

import { Color3, Matrix } from "@babylonjs/core";
import { Geo } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { makeCanvas, toTexture } from "../materials/canvas";
import { GlbMaterial, GlbModel, loadGlb } from "../models/glb";

/** The model's length on the display, before the plinth's scale: the code-built truck's, bumper to bumper. */
const LENGTH = 1.63;

let truck: { glb: GlbModel; images: HTMLCanvasElement[] } | null = null;

/** Fetch the firetruck model. Call before building; if it can't be read the plinth keeps the code-built truck. */
export async function loadFiretruckModel(): Promise<void> {
  try {
    const glb = await loadGlb(`${import.meta.env.BASE_URL}models/firetruck.glb`);
    const images = await Promise.all(
      glb.images.map(async (blob) => {
        const bmp = await createImageBitmap(blob);
        const { canvas, ctx } = makeCanvas(bmp.width, bmp.height);
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        return canvas;
      }),
    );
    truck = { glb, images };
  } catch (e) {
    console.warn("Firetruck model not loaded; the showroom shows the code-built truck.", e);
    truck = null;
  }
}

/** House material for one of the model's materials: its own for a textured one, else a shared one by kind. */
function houseKey(m: GlbMaterial, i: number): string {
  if (m.tex != null) return `firetruck:${i}`;
  if (m.emissive) return "firetruck:lights";
  if (m.blend) return m.color[0] + m.color[1] + m.color[2] > 1.5 ? "firetruck:lens" : "firetruck:glass";
  if (m.metal >= 0.75) return m.rough < 0.15 ? "firetruck:chrome" : "firetruck:metal";
  return m.rough < 0.35 ? "firetruck:gloss" : "firetruck:paint";
}

/** Make the truck's house materials (once), and the palette the lights read their colours from. */
function makeMaterials(ctx: WorldCtx, glb: GlbModel, images: HTMLCanvasElement[]): Map<number, { u: number; v: number }> {
  const mats = ctx.mats;
  const white = Color3.White();
  const glowing = glb.materials.map((m, i) => (m.emissive ? i : -1)).filter((i) => i >= 0);
  const slot = new Map<number, { u: number; v: number }>();
  glowing.forEach((i, k) => slot.set(i, { u: (k + 0.5) / glowing.length, v: 0.5 }));
  if (mats.has("firetruck:paint")) return slot;
  glb.materials.forEach((m, i) => {
    if (m.tex == null) return;
    const tex = toTexture(ctx.scene, `firetruck:${m.name}`, images[m.tex], { wrap: false });
    mats.pbr(`firetruck:${i}`, { color: new Color3(m.color[0], m.color[1], m.color[2]), tex, rough: m.rough, metal: m.metal, clearCoat: m.clearcoat || undefined });
  });
  // as rough as the house's own chrome: mirror-smooth, it shows the jungle's green from the reflections
  mats.pbr("firetruck:chrome", { color: white, rough: 0.16, metal: 1 });
  mats.pbr("firetruck:metal", { color: white, rough: 0.4, metal: 1 });
  mats.pbr("firetruck:gloss", { color: white, rough: 0.25, clearCoat: 0.6 });
  mats.pbr("firetruck:paint", { color: white, rough: 0.7, metal: 0 });
  mats.pbr("firetruck:lens", { color: white, rough: 0.02, alpha: 0.14, twoSided: true });
  mats.pbr("firetruck:glass", { color: white, rough: 0.03, alpha: 0.35, twoSided: true });
  // lights: one unlit material, each lamp colour a cell of a small palette (strength folded in, capped)
  const cell = 8;
  const { canvas, ctx: g } = makeCanvas(Math.max(1, glowing.length) * cell, cell);
  const srgb = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2));
  glowing.forEach((i, k) => {
    const m = glb.materials[i];
    const s = Math.min(m.emissiveStrength, 4) / 4;
    g.fillStyle = `rgb(${srgb(m.emissive![0] * s)}, ${srgb(m.emissive![1] * s)}, ${srgb(m.emissive![2] * s)})`;
    g.fillRect(k * cell, 0, cell, cell);
  });
  mats.unlit("firetruck:lights", { tex: toTexture(ctx.scene, "firetruck:lights", canvas, { wrap: false, mipmaps: false }), intensity: 3 });
  mats.glowing.add("firetruck:lights");
  return slot;
}

/**
 * Put the firetruck model at m (as the code-built truck: centred, length along local X with
 * the cab at +X, wheels on y = 0), scaled by `scale`. False when the model isn't loaded.
 */
export function placeFiretruckModel(ctx: WorldCtx, z: Zone, m: Matrix, scale = 1): boolean {
  if (!truck) return false;
  const { glb, images } = truck;
  const slot = makeMaterials(ctx, glb, images);
  // the file: glTF, +Y up, front at +Z, its left at +X. Here: front at +X, left at +Z, the
  // same truck turned (not mirrored) into the house's left-handed space, so triangles keep
  // their order. Centred along its length, wheels at 0, scaled to LENGTH.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of glb.parts)
    for (const q of p.prims)
      for (let k = 0; k < q.pos.length; k += 3) {
        x0 = Math.min(x0, q.pos[k]);
        x1 = Math.max(x1, q.pos[k]);
        y0 = Math.min(y0, q.pos[k + 1]);
        z0 = Math.min(z0, q.pos[k + 2]);
        z1 = Math.max(z1, q.pos[k + 2]);
      }
  const k = LENGTH / (z1 - z0);
  const cz = (z0 + z1) / 2;
  const cx = (x0 + x1) / 2;
  const at = Matrix.Scaling(scale, scale, scale).multiply(m);
  for (const part of glb.parts) {
    const label = part.name.startsWith("FF01") ? "Firetruck windscreen" : part.name.startsWith("FG02") ? "Light bar" : "Firetruck model";
    const byKey = new Map<string, Geo>();
    for (const q of part.prims) {
      const mat = glb.materials[q.material];
      if (!mat) continue;
      const key = houseKey(mat, q.material);
      let geo = byKey.get(key);
      if (!geo) byKey.set(key, (geo = new Geo()));
      const base = geo.vertexCount;
      const painted = mat.tex == null && !mat.emissive;
      if (painted && !geo.col) geo.col = [];
      const light = slot.get(q.material);
      for (let i = 0; i < q.pos.length / 3; i++) {
        const u = light ? light.u : (q.uv?.[i * 2] ?? 0);
        const v = light ? light.v : 1 - (q.uv?.[i * 2 + 1] ?? 0); // glTF images start at the top
        geo.vert((q.pos[i * 3 + 2] - cz) * k, (q.pos[i * 3 + 1] - y0) * k, (q.pos[i * 3] - cx) * k, u, v, q.nrm[i * 3 + 2], q.nrm[i * 3 + 1], q.nrm[i * 3]);
        if (painted) geo.col!.push(mat.color[0], mat.color[1], mat.color[2], 1);
      }
      for (const i of q.idx) geo.idx.push(base + i);
    }
    for (const [key, geo] of byKey) {
      const see = key === "firetruck:lens" || key === "firetruck:glass" || key === "firetruck:lights";
      ctx.g(z, key, see ? { castShadow: false } : {}).add(geo, at, label);
    }
  }
  return true;
}
