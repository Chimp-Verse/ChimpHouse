// Small furnishing pieces shared between rooms: candles, table styling, fruit,
// floor lamps, big floor planters and hanging planters.

import { Vector3 } from "@babylonjs/core";
import { Geo, beam, box, cylinder, lathe, sphere, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { Rand, plant, pottedPlant, vine } from "./plants";

/** Candle in a glass holder, glowing. Base at p. */
export function candle(ctx: WorldCtx, z: Zone, p: Vector3): void {
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(cylinder(0.06, 0.13, 12, false), xf(p.x, p.y, p.z));
  ctx.g(z, "bulb", { castShadow: false }).add(cylinder(0.03, 0.06, 10), xf(p.x, p.y, p.z), "Candle");
  ctx.g(z, "brass", { castShadow: false }).add(cylinder(0.065, 0.01, 12), xf(p.x, p.y, p.z));
}

/** A stack of books, a small plant and a candle styling a coffee table top. */
export function decorTable(ctx: WorldCtx, z: Zone, top: Vector3, r: () => number) {
  ctx.g(z, r() > 0.5 ? "mustard" : "teal", { castShadow: false }).add(box(0.3, 0.04, 0.22), xf(top.x - 0.15, top.y + 0.02, top.z + 0.1, r()), "Books");
  ctx.g(z, "cream", { castShadow: false }).add(box(0.28, 0.035, 0.2), xf(top.x - 0.15, top.y + 0.058, top.z + 0.1, r()), "Books");
  pottedPlant(ctx, z, new Vector3(top.x + 0.12, top.y, top.z - 0.08), "fern", { pot: "terracotta", potR: 0.08, potH: 0.12, scale: 0.4, r });
  candle(ctx, z, new Vector3(top.x + 0.2, top.y, top.z + 0.2));
}

/** Shallow timber bowl of oranges. */
export function fruitBowl(ctx: WorldCtx, z: Zone, p: Vector3, r: () => number) {
  ctx.g(z, "timber").add(lathe([[0.001, 0], [0.12, 0.01], [0.2, 0.08], [0.21, 0.09]], 20), xf(p.x, p.y, p.z), "Fruit bowl");
  if (!ctx.mats.has("orange")) ctx.mats.pbr("orange", { color: "#f08a24", rough: 0.5 });
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    ctx.g(z, "orange", { castShadow: false }).add(sphere(0.045, 10, 8), xf(p.x + Math.cos(a) * 0.08, p.y + 0.07 + (i > 3 ? 0.06 : 0), p.z + Math.sin(a) * 0.08));
  }
}

/** Floor lamp: slim brass pole and a woven drum shade. */
export function floorLamp(ctx: WorldCtx, z: Zone, p: Vector3) {
  ctx.g(z, "brass").add(new Geo().add(cylinder(0.16, 0.025, 20)).add(cylinder(0.014, 1.5, 8), xf(0, 0.025, 0)), xf(p.x, p.y, p.z), "Floor lamp");
  ctx.g(z, "lattice", { castShadow: false }).add(lathe([[0.2, 0], [0.17, 0.3]], 24, false, false, 3), xf(p.x, p.y + 1.42, p.z), "Floor lamp");
  ctx.g(z, "bulb", { castShadow: false }).add(sphere(0.07, 12, 8), xf(p.x, p.y + 1.55, p.z), "Floor lamp");
}

/** Big floor planter: ribbed pot, a main plant and low underplanting so the soil never shows bare. */
export function floorPlanter(ctx: WorldCtx, z: Zone, p: Vector3, kind: "monstera" | "banana" | "elephant" | "palm", mat: string, r: Rand) {
  const R = 0.32;
  const H = 0.62;
  const prof: [number, number][] = [
    [R * 0.78, 0],
    [R * 0.95, H * 0.3],
    [R, H * 0.9],
    [R * 1.05, H],
    [R * 0.95, H],
    [R * 0.92, H * 0.92],
  ];
  ctx.g(z, mat).add(lathe(prof, 28, false, true, 3), xf(p.x, p.y, p.z), "Floor planter");
  const ribs = new Geo();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ribs.add(box(0.02, H * 0.8, 0.02), xf(Math.cos(a) * R * 0.94, H * 0.45, Math.sin(a) * R * 0.94, -a));
  }
  ctx.g(z, mat).add(ribs, xf(p.x, p.y, p.z), "Floor planter");
  const soilY = p.y + H * 0.88;
  ctx.g(z, "soil", { castShadow: false }).add(cylinder(R * 0.9, 0.01, 24), xf(p.x, soilY - 0.01, p.z), "Floor planter");
  plant(ctx, z, new Vector3(p.x, soilY, p.z), kind, kind === "banana" ? 1.1 : 1.35, r, "Floor planter");
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r();
    plant(ctx, z, new Vector3(p.x + Math.cos(a) * R * 0.55, soilY, p.z + Math.sin(a) * R * 0.55), i % 2 ? "fern" : "calathea", 0.4, r, "Floor planter");
  }
}

/** Planter hanging from the ceiling on three cords, trailing vines. `top` is the ceiling point. */
export function hangingPlanter(ctx: WorldCtx, z: Zone, top: Vector3, drop: number, r: Rand) {
  const y = top.y - drop;
  const R = 0.2;
  const cords = new Geo();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    cords.add(beam([new Vector3(top.x, top.y, top.z), new Vector3(top.x + Math.cos(a) * R * 0.9, y + 0.16, top.z + Math.sin(a) * R * 0.9)], 0.008, 0.008));
  }
  ctx.g(z, "rope", { castShadow: false }).add(cords, undefined, "Hanging planter");
  ctx.g(z, "jute").add(lathe([[0.001, 0], [R * 0.6, 0.01], [R, 0.1], [R * 1.02, 0.18], [R * 0.95, 0.18], [R * 0.9, 0.16]], 20, false, false, 3), xf(top.x, y, top.z), "Hanging planter");
  ctx.g(z, "soil", { castShadow: false }).add(cylinder(R * 0.88, 0.01, 16), xf(top.x, y + 0.15, top.z), "Hanging planter");
  plant(ctx, z, new Vector3(top.x, y + 0.16, top.z), "philodendron", 0.45, r, "Hanging planter");
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.4;
    vine(ctx, z, new Vector3(top.x + Math.cos(a) * R * 0.95, y + 0.17, top.z + Math.sin(a) * R * 0.95), 0.5 + r() * 1.2, r, { leaf: 0.08, density: 14, drift: new Vector3(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12), label: "Hanging planter" });
  }
}
