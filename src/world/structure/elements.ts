// Reusable architectural elements: glazing runs, walls, railings, LED strips.

import { Vector3 } from "@babylonjs/core";
import { P2, pathLength, pointAt, resample, tangentAt } from "../geometry/curves";
import { Geo, at, beam, box, cylinder, ribbonWall, sweep, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { trunkNear } from "./trunks";

/** Rotation (yaw) so that local +X runs along tangent t. */
export function yawAlong(t: P2): number {
  return -Math.atan2(t.z, t.x);
}

/**
 * Floor-to-ceiling glazing along an open plan path: glass ribbon, charcoal
 * mullions, sill and head rails.
 */
export function glazing(
  ctx: WorldCtx,
  z: Zone,
  path: P2[],
  y0: number,
  y1: number,
  o: { step?: number; label?: string; mullionW?: number; transoms?: number[]; head?: boolean; sill?: boolean } = {},
): void {
  const { step = 1.55, label = "Curved glazing", mullionW = 0.075, transoms = [], head = true, sill = true } = o;
  if (path.length < 2) return;
  const len = pathLength(path);
  if (len < 0.05) return;
  const glass = ctx.g(z, "glass", { castShadow: false, pickable: false });
  glass.setLabel(label);
  glass.add(ribbonWall(path, y0, y1, false));
  glass.add(ribbonWall([...path].reverse(), y0, y1, false));
  const frame = ctx.g(z, "charcoal");
  frame.setLabel(`${label} frame`);
  const n = Math.max(1, Math.round(len / step));
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * len;
    const p = pointAt(path, s);
    const q = pointAt(path, Math.min(len, s + 0.05));
    const r = pointAt(path, Math.max(0, s - 0.05));
    const t = { x: q.x - r.x, z: q.z - r.z };
    frame.add(box(mullionW, y1 - y0, 0.11), xf(p.x, (y0 + y1) / 2, p.z, yawAlong(t)));
  }
  const path3 = (y: number) => at(resample(path, 0.3), y);
  if (sill) frame.add(beam(path3(y0 + 0.04), 0.13, 0.08));
  if (head) frame.add(beam(path3(y1 - 0.05), 0.13, 0.1));
  for (const ty of transoms) frame.add(beam(path3(ty), 0.12, 0.07));
}

/** Solid wall along a path (centre line), thickness t. */
export function wall(ctx: WorldCtx, z: Zone, path: P2[], y0: number, y1: number, t: number, mat: string, label = "Wall"): void {
  const g = ctx.g(z, mat);
  g.setLabel(label);
  g.add(beam(at(path, (y0 + y1) / 2), t, y1 - y0));
}

/** Thin emissive strip along a 3D path (mint or amber LED). */
export function ledStrip(ctx: WorldCtx, z: Zone, path: Vector3[], mat: "mint" | "amberStrip", size = 0.035, up?: Vector3): void {
  const g = ctx.g(z, mat, { castShadow: false });
  g.setLabel(mat === "mint" ? "Mint light strip" : "Warm light strip");
  g.add(sweep(
    [
      [size / 2, -size / 2],
      [size / 2, size / 2],
      [-size / 2, size / 2],
      [-size / 2, -size / 2],
    ],
    path,
    { up: up ?? Vector3.Up(), caps: true },
  ));
}

/**
 * Railing along a path: posts, timber handrail, infill (glass panels,
 * horizontal cables or nothing).
 */
export function railing(
  ctx: WorldCtx,
  z: Zone,
  path: P2[],
  y: number,
  o: { height?: number; infill?: "glass" | "cable" | "none"; postStep?: number; label?: string; closed?: boolean; handrail?: "timber" | "charcoal" } = {},
): void {
  const { height = 1.05, infill = "glass", postStep = 1.6, label = "Railing", closed = false, handrail = "timber" } = o;
  const pts = closed ? [...path, path[0]] : path;
  const len = pathLength(pts);
  if (len < 0.2) return;
  const posts = ctx.g(z, "charcoal");
  posts.setLabel(`${label} posts`);
  const n = Math.max(1, Math.round(len / postStep));
  for (let i = 0; i <= n; i++) {
    if (closed && i === n) break;
    const p = pointAt(pts, (i / n) * len);
    const tt = tangentAt(resample(pts, 0.2), Math.min(Math.round(((i / n) * len) / 0.2), Math.round(len / 0.2) - 1));
    posts.add(box(0.06, height, 0.06), xf(p.x, y + height / 2, p.z, yawAlong(tt)));
  }
  const smooth = resample(pts, 0.25);
  const rail = ctx.g(z, handrail === "timber" ? "timber" : "charcoal");
  rail.setLabel(`${label} handrail`);
  rail.add(beam(at(smooth, y + height + 0.03), 0.09, 0.06));
  if (infill === "glass") {
    const g = ctx.g(z, "glassRail", { castShadow: false, pickable: false });
    g.setLabel(`${label} glass`);
    g.add(ribbonWall(smooth, y + 0.08, y + height - 0.04, false));
    g.add(ribbonWall([...smooth].reverse(), y + 0.08, y + height - 0.04, false));
    posts.add(beam(at(smooth, y + 0.05), 0.05, 0.05));
  } else if (infill === "cable") {
    for (let k = 1; k <= 6; k++) {
      posts.add(sweep(cableProfile, at(smooth, y + (k / 7) * height), { caps: false }));
    }
  }
}

const cableProfile: [number, number][] = [
  [0.006, 0],
  [0, 0.006],
  [-0.006, 0],
  [0, -0.006],
];

/** Downlights: small emissive discs in a ceiling at height y inside a loop (none beside a trunk). */
export function downlights(ctx: WorldCtx, z: Zone, pts: P2[], y: number): void {
  const g = ctx.g(z, "bulb", { castShadow: false });
  g.setLabel("Recessed downlight");
  const trim = ctx.g(z, "charcoal", { castShadow: false });
  for (const p of pts) {
    if (trunkNear(p, 0.35, y - 0.4, y)) continue;
    g.add(cylinder(0.055, 0.01, 12), xf(p.x, y - 0.012, p.z));
    trim.add(cylinder(0.075, 0.008, 12), xf(p.x, y - 0.006, p.z));
  }
}

export function gridInside(loop: P2[], spacing: number, inset: number, test: (p: P2) => boolean): P2[] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of loop) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  const out: P2[] = [];
  for (let x = x0 + inset; x <= x1 - inset; x += spacing)
    for (let zz = z0 + inset; zz <= z1 - inset; zz += spacing) if (test({ x, z: zz })) out.push({ x, z: zz });
  return out;
}

export { Geo };
