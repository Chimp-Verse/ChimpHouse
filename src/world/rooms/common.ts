// Shared helpers for furnishing rooms.

import { Matrix, Vector3 } from "@babylonjs/core";
import { P2, arc } from "../geometry/curves";
import { box, plane, xf } from "../geometry/geo";
import { Level, WorldCtx, Zone, zone } from "../context";
import { archPath, rib } from "../structure/entrance";
import { SITE } from "../layout";

/**
 * Spread factor: how much larger the rooms are than the arrangement was first
 * designed for. Offsets between furniture groups are multiplied by K so the
 * arrangements fill the rooms; furniture keeps its real size.
 */
export const K = SITE.k;

/** Yaw that turns a local -Z-facing object toward direction (dx, dz). */
export function faceYaw(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Yaw that turns a local -Z-facing object at (x, z) to face the point (tx, tz). */
export function faceToward(x: number, z: number, tx: number, tz: number): number {
  return faceYaw(tx - x, tz - z);
}

/** Matrix for an object at (x, y, z) facing (dx, dz). */
export function at3(x: number, y: number, z: number, dx: number, dz: number): Matrix {
  return xf(x, y, z, faceYaw(dx, dz));
}

/** Textured wall panel (sign, poster, screen) centred at pos facing (dx, dz). */
export function panel(ctx: WorldCtx, z: Zone, mat: string, pos: Vector3, w: number, h: number, dx: number, dz: number, label: string, backing?: { mat: string; pad: number; depth: number }): void {
  const m = at3(pos.x, pos.y, pos.z, dx, dz);
  if (backing) ctx.g(z, backing.mat).add(box(w + backing.pad * 2, h + backing.pad * 2, backing.depth), xf(0, 0, backing.depth / 2 + 0.005).multiply(m), label);
  ctx.g(z, mat, { castShadow: false }).add(plane(w, h), m, label);
}

/** Warm room light (point). */
export function roomLight(ctx: WorldCtx, room: string, level: Level, pos: Vector3, day: number, night: number, range = 9, color = "#ffb766", extraRooms: string[] = []): void {
  ctx.lights.push({ pos, color, day, night, range, rooms: [room, ...extraRooms], level });
}

/** Interior glulam arch with a mint strip, between two floor points. */
export function interiorArch(ctx: WorldCtx, room: string, level: "lower" | "upper", a: P2, b: P2, y0: number, h: number, power = 0.5, w = 0.42, d = 0.4): void {
  const plan = [a, b];
  rib(ctx, room, archPath(plan, y0, h, power), w, d, "Glulam arch", "under", level);
}

/** Arc of plan points (degrees). */
export function arcDeg(cx: number, cz: number, r: number, a0: number, a1: number, n = 24): P2[] {
  return arc(cx, cz, r, (a0 * Math.PI) / 180, (a1 * Math.PI) / 180, n);
}

export { zone };
