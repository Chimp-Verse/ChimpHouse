// The exact shape of a tree trunk, shared by the trunk mesh and by everything
// built around it. Openings in slabs and roofs, collars, wall ends and nearby
// furniture all read the trunk's real outline at their own height, so the
// trunk can keep its natural lean, sway, taper and bark relief.

import { Vector3 } from "@babylonjs/core";
import { P2, rng } from "../geometry/curves";
import { fbm2 } from "../geometry/noise";
import { TreeDef } from "../layout";
import { terrainHeight } from "./terrain";

export const TRUNK_SIDES = 44;

export interface TrunkShape {
  def: TreeDef;
  /** Centre line, bottom to top (the rounded cap above it is not included). */
  path: Vector3[];
  /** Arc-length fraction (0 bottom .. 1 top) of each path point. */
  pathT: number[];
  /** Bark vertices: one ring per path point plus the cap rings, TRUNK_SIDES + 1 per ring (seam repeated). */
  rings: Vector3[][];
  /** Texture v coordinate (metres along the trunk) per ring. */
  ringV: number[];
  /** Height where the trunk starts (bottom ring). */
  baseY: number;
  /** Bark outline at height y (empty outside the trunk). */
  section(y: number): P2[];
  /** Centre of the bark outline at height y. */
  centre(y: number): P2;
  /** Nearest bark to the centre at height y. */
  inner(y: number): number;
  /** Smallest circle (about the mid-height centre) holding the bark over [y0, y1]. */
  span(y0: number, y1: number): { x: number; z: number; R: number };
}

const cache = new Map<string, TrunkShape>();

/** The trunk of `def`, built once and cached. */
export function trunkShape(def: TreeDef): TrunkShape {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const s = buildShape(def);
  cache.set(def.id, s);
  return s;
}

function buildShape(def: TreeDef): TrunkShape {
  const groundY = Math.min(def.base, terrainHeight(def.x, def.z));
  const H = def.top - groundY;
  // centre line: lean that grows with height plus a gentle S-curve
  const path: Vector3[] = [];
  const steps = Math.max(10, Math.round(H / 0.6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = groundY - 1.5 + t * (H + 1.5);
    const sx = def.lean * t * t * H * 0.35 + Math.sin(t * 3.2 + def.seed) * 0.35 * t;
    const sz = Math.cos(t * 2.6 + def.seed) * 0.3 * t;
    path.push(new Vector3(def.x + sx, y, def.z + sz));
  }
  // radius: buttressed foot, steady taper, slow swelling, and a closing taper into the crown
  const seedR = rng(def.seed * 7 + 3);
  const swellPhase = seedR() * Math.PI * 2;
  const radius = (t: number, y: number) => {
    const foot = t < 0.06 ? 1 + (0.06 - t) * 4 : 1;
    const swell = 1 + 0.045 * Math.sin(y * 0.55 + swellPhase) + 0.025 * Math.sin(y * 1.3 + swellPhase * 2);
    const u = Math.max(0, (t - 0.86) / 0.14);
    const close = 1 - 0.38 * u * u;
    return def.r * (1.15 - 0.35 * t) * foot * swell * close;
  };

  // rotation-minimising frames, so the rings never flip or twist where the trunk bends
  const n = path.length;
  const tangents = path.map((_, i) => path[Math.min(n - 1, i + 1)].subtract(path[Math.max(0, i - 1)]).normalize());
  const frames: { X: Vector3; Y: Vector3 }[] = [];
  {
    const T0 = tangents[0];
    const ref = Math.abs(T0.x) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    let X = Vector3.Cross(ref, T0).normalize();
    for (let i = 0; i < n; i++) {
      const T = tangents[i];
      X = X.subtract(T.scale(Vector3.Dot(X, T))).normalize();
      frames.push({ X, Y: Vector3.Cross(T, X).normalize() });
    }
  }

  const r = rng(def.seed);
  const lobes = Array.from({ length: 6 }, (_, i) => ({ a: (i / 6) * Math.PI * 2 + r() * 0.6, amp: 0.5 + r() * 0.7 }));
  const lengths = [0];
  for (let i = 1; i < n; i++) lengths.push(lengths[i - 1] + Vector3.Distance(path[i], path[i - 1]));
  const total = lengths[n - 1];
  const pathT = lengths.map((l) => l / total);
  const baseY = path[0].y;
  const rings: Vector3[][] = [];
  const ringV: number[] = [];
  const ring = (P: Vector3, X: Vector3, Y: Vector3, R: number, k: number) => {
    const flare = Math.exp(-(P.y - baseY) / 2.2);
    const row: Vector3[] = [];
    for (let j = 0; j <= TRUNK_SIDES; j++) {
      const a = (j / TRUNK_SIDES) * Math.PI * 2;
      let rr = R;
      for (const l of lobes) rr += R * l.amp * flare * Math.pow(Math.max(0, Math.cos(a - l.a)), 10) * 1.2;
      rr += k * R * 0.07 * fbm2(Math.cos(a) * 2 + def.seed, P.y * 0.35 + Math.sin(a) * 2, 3);
      rr += k * R * 0.035 * Math.sin(a * 13 + P.y * 0.8);
      row.push(P.add(X.scale(Math.cos(a) * rr)).add(Y.scale(Math.sin(a) * rr)));
    }
    return row;
  };
  for (let i = 0; i < n; i++) {
    rings.push(ring(path[i], frames[i].X, frames[i].Y, radius(pathT[i], path[i].y), 1));
    ringV.push(lengths[i]);
  }
  // rounded cap: a few shrinking rings that close the top instead of leaving a cut end
  const topR = radius(1, path[n - 1].y);
  const Tt = tangents[n - 1];
  const caps = [
    [0.35, 0.86],
    [0.62, 0.55],
    [0.78, 0.2],
    [0.82, 0.0],
  ];
  for (const [rise, k] of caps) {
    const P = path[n - 1].add(Tt.scale(topR * rise));
    rings.push(ring(P, frames[n - 1].X, frames[n - 1].Y, Math.max(0.002, topR * k), k));
    ringV.push(total + topR * rise);
  }

  // horizontal cut through the bark at height y, one point per column of vertices
  const section = (y: number): P2[] => {
    const out: P2[] = [];
    for (let j = 0; j < TRUNK_SIDES; j++) {
      for (let i = 0; i < rings.length - 1; i++) {
        const a = rings[i][j];
        const b = rings[i + 1][j];
        if ((a.y <= y && b.y >= y) || (a.y >= y && b.y <= y)) {
          const f = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
          out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
          break;
        }
      }
    }
    return out.length === TRUNK_SIDES ? out : [];
  };
  // fallback centre from the centre line, for heights the bark does not fully cover
  const lineCentre = (y: number): P2 => {
    if (y <= path[0].y) return { x: path[0].x, z: path[0].z };
    for (let i = 0; i < n - 1; i++) {
      if (path[i + 1].y >= y) {
        const f = (y - path[i].y) / (path[i + 1].y - path[i].y);
        return { x: path[i].x + (path[i + 1].x - path[i].x) * f, z: path[i].z + (path[i + 1].z - path[i].z) * f };
      }
    }
    return { x: path[n - 1].x, z: path[n - 1].z };
  };
  const centre = (y: number): P2 => {
    const s = section(y);
    if (!s.length) return lineCentre(y);
    let x = 0;
    let z = 0;
    for (const p of s) {
      x += p.x;
      z += p.z;
    }
    return { x: x / s.length, z: z / s.length };
  };
  const inner = (y: number): number => {
    const s = section(y);
    const c = centre(y);
    return s.length ? Math.min(...s.map((p) => Math.hypot(p.x - c.x, p.z - c.z))) : 0;
  };
  const span = (y0: number, y1: number) => {
    const c = centre((y0 + y1) / 2);
    let R = 0;
    const m = Math.max(1, Math.ceil((y1 - y0) / 0.1));
    for (let k = 0; k <= m; k++) {
      for (const p of section(y0 + ((y1 - y0) * k) / m)) R = Math.max(R, Math.hypot(p.x - c.x, p.z - c.z));
    }
    return { x: c.x, z: c.z, R };
  };
  return { def, path, pathT, rings, ringV, baseY, section, centre, inner, span };
}
