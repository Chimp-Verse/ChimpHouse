// Light fittings: woven rattan pendants, halo rings, sconces, lantern posts,
// hanging tree lanterns. Each can register a room light.

import { Vector3 } from "@babylonjs/core";
import { Geo, box, cylinder, lathe, sphere, torus, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";

/** Woven globe pendant: cord, brass cap, lattice shade, glowing core. */
export function wovenPendant(ctx: WorldCtx, z: Zone, pos: Vector3, r: number, drop: number, o: { shape?: "globe" | "teardrop" | "drum"; label?: string } = {}): void {
  const label = o.label ?? "Woven rattan pendant";
  ctx.g(z, "black", { castShadow: false }).add(cylinder(0.006, drop, 4, false), xf(pos.x, pos.y - drop, pos.z), label);
  ctx.g(z, "brass", { castShadow: false }).add(cylinder(0.05, 0.06, 12), xf(pos.x, pos.y - drop - 0.03, pos.z), label);
  const cy = pos.y - drop - r * 0.95;
  const prof: [number, number][] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI;
    let rr = Math.cos(a) * r;
    let y = Math.sin(a) * r;
    if (o.shape === "teardrop") {
      rr *= 1 - 0.25 * Math.max(0, Math.sin(a));
      y *= 1.15;
    } else if (o.shape === "drum") {
      rr = r * (Math.abs(a) < 1.2 ? 1 : Math.cos(a) / Math.cos(1.2));
    }
    prof.push([Math.max(0.03, rr), y]);
  }
  ctx.g(z, "lattice", { castShadow: false }).add(lathe(prof, 28, false, false, 2), xf(pos.x, cy, pos.z), label);
  ctx.g(z, "bulb", { castShadow: false }).add(sphere(r * 0.42, 12, 8), xf(pos.x, cy, pos.z), label);
}

/** Halo ring pendant (game room). */
export function ringPendant(ctx: WorldCtx, z: Zone, pos: Vector3, R: number, drop: number): void {
  const g = ctx.g(z, "black", { castShadow: false });
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    g.add(cylinder(0.004, drop, 3, false), xf(pos.x + Math.cos(a) * R, pos.y - drop, pos.z + Math.sin(a) * R), "Halo pendant");
  }
  ctx.g(z, "charcoal", { castShadow: false }).add(torus(R, 0.03, 48, 6), xf(pos.x, pos.y - drop, pos.z), "Halo pendant");
  ctx.g(z, "amberStrip", { castShadow: false }).add(torus(R, 0.022, 48, 6), xf(pos.x, pos.y - drop - 0.02, pos.z), "Halo pendant");
}

/** Wall sconce: open-framed lantern with a glowing core on a short arm. yaw faces the lantern's front. */
export function sconce(ctx: WorldCtx, z: Zone, pos: Vector3, yaw: number): void {
  const m = xf(pos.x, pos.y, pos.z, yaw);
  const g = new Geo();
  g.add(box(0.18, 0.03, 0.18), xf(0, 0.17, 0));
  g.add(lathe([[0.1, 0], [0.03, 0.06], [0.001, 0.07]], 4), xf(0, 0.185, 0, Math.PI / 4));
  g.add(box(0.16, 0.03, 0.16), xf(0, -0.17, 0));
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    g.add(box(0.018, 0.32, 0.018), xf(sx * 0.072, 0, sz * 0.072));
  g.add(box(0.04, 0.04, 0.12), xf(0, 0.08, 0.12));
  ctx.g(z, "charcoal", { castShadow: false }).add(g, m, "Wall lantern");
  ctx.g(z, "bulb", { castShadow: false }).add(box(0.12, 0.3, 0.12), m, "Wall lantern");
}

/** Timber lantern post (front stair, decks, bridge). */
export function lanternPost(ctx: WorldCtx, z: Zone, base: Vector3, h = 1.1, o: { lightRange?: number; addLight?: boolean } = {}): void {
  ctx.g(z, "timberDark").add(box(0.16, h, 0.16), xf(base.x, base.y + h / 2, base.z), "Lantern post");
  ctx.g(z, "charcoal", { castShadow: false }).add(box(0.24, 0.05, 0.24), xf(base.x, base.y + h + 0.3, base.z), "Lantern post");
  ctx.g(z, "charcoal", { castShadow: false }).add(box(0.22, 0.04, 0.22), xf(base.x, base.y + h, base.z));
  ctx.g(z, "bulb", { castShadow: false }).add(box(0.17, 0.25, 0.17), xf(base.x, base.y + h + 0.15, base.z), "Lantern");
  for (const [dx, dz] of [
    [-0.1, -0.1],
    [0.1, -0.1],
    [0.1, 0.1],
    [-0.1, 0.1],
  ])
    ctx.g(z, "charcoal", { castShadow: false }).add(box(0.025, 0.27, 0.025), xf(base.x + dx, base.y + h + 0.15, base.z + dz));
  if (o.addLight) ctx.lights.push({ pos: base.add(new Vector3(0, h + 0.2, 0)), color: "#ffb35e", day: 0, night: 3, range: o.lightRange ?? 5, rooms: [z.room, "approach", "structure", "exterior"], level: z.level });
}

/** Big woven globe lantern hanging on a rope (from tree limbs). */
export function hangingLantern(ctx: WorldCtx, z: Zone, top: Vector3, r: number, rope: number): void {
  ctx.g(z, "rope", { castShadow: false }).add(cylinder(0.012, rope, 4, false), xf(top.x, top.y - rope, top.z), "Hanging lantern");
  const c = top.add(new Vector3(0, -rope - r, 0));
  ctx.g(z, "brass", { castShadow: false }).add(cylinder(0.08, 0.08, 10), xf(c.x, c.y + r * 0.95, c.z));
  ctx.g(z, "brass", { castShadow: false }).add(cylinder(0.02, 0.18, 6), xf(c.x, c.y - r - 0.16, c.z));
  ctx.g(z, "lattice", { castShadow: false }).add(sphere(r, 20, 12, 1.12), xf(c.x, c.y, c.z), "Hanging lantern");
  ctx.g(z, "bulb", { castShadow: false }).add(sphere(r * 0.55, 12, 8), xf(c.x, c.y, c.z), "Hanging lantern");
}
