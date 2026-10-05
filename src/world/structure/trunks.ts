// Where the living trunks pass through the house: openings cut around them in
// slabs and roofs, timber collars that close the gap at each floor, and tests
// that keep walls, lights and furniture clear of the bark. Everything reads the
// trunk's real outline at its own height (see environment/trunkShape.ts), so the
// trunks keep their natural lean and sway.

import { lathe, xf } from "../geometry/geo";
import { P2, pointInPolygon, resample } from "../geometry/curves";
import { WorldCtx, Zone } from "../context";
import { HOUSE_TRUNKS, TreeDef } from "../layout";
import { trunkShape } from "../environment/trunkShape";

/** A circle in plan: centre and radius. */
export interface Circle {
  x: number;
  z: number;
  R: number;
}

/** Distance from p to the edges of a closed outline. */
function distToLoop(p: P2, loop: P2[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}

/** Circle holding a trunk's bark between heights y0 and y1. */
export function trunkSpan(t: TreeDef, y0: number, y1: number): Circle {
  return trunkShape(t).span(y0, y1);
}

/** Centre of a trunk at height y. */
export function trunkCentre(t: TreeDef, y: number): P2 {
  return trunkShape(t).centre(y);
}

/** The house trunk whose bark (between y0 and y1) comes within `pad` of p, if any. */
export function trunkNear(p: P2, pad: number, y0: number, y1: number): TreeDef | undefined {
  return HOUSE_TRUNKS.find((t) => {
    const s = trunkSpan(t, y0, y1);
    return Math.hypot(p.x - s.x, p.z - s.z) < s.R + pad;
  });
}

/**
 * Whether p stays well inside a trunk (within `f` of its nearest bark) at every
 * height from y0 to y1, so a wall or pane can stop there unseen.
 */
export function insideTrunk(p: P2, y0: number, y1: number, f = 0.85): boolean {
  return HOUSE_TRUNKS.some((t) => {
    const s = trunkShape(t);
    const step = Math.max(0.2, (y1 - y0) / 12);
    for (let y = y0; y <= y1 + 1e-6; y += step) {
      const c = s.centre(y);
      if (Math.hypot(p.x - c.x, p.z - c.z) >= s.inner(y) * f) return false;
    }
    return true;
  });
}

/** Ring planter around a trunk on the lower floor: centre and outer radius (rim excluded). */
export function trunkPlanter(t: TreeDef): Circle {
  const s = trunkSpan(t, 0, 0.6);
  return { x: s.x, z: s.z, R: s.R + 0.45 };
}

/** Arc of the circle (c, R) from A to B, taking the side whose middle lies inside `loop`. */
function arcInside(A: P2, B: P2, c: P2, R: number, loop: P2[]): P2[] {
  const a0 = Math.atan2(A.z - c.z, A.x - c.x);
  const a1 = Math.atan2(B.z - c.z, B.x - c.x);
  let d = (((a1 - a0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const mid = { x: c.x + Math.cos(a0 + d / 2) * R, z: c.z + Math.sin(a0 + d / 2) * R };
  if (!pointInPolygon(mid, loop)) d -= Math.PI * 2;
  const n = Math.max(2, Math.ceil((Math.abs(d) * R) / 0.12));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (d * i) / n;
    out.push({ x: c.x + Math.cos(a) * R, z: c.z + Math.sin(a) * R });
  }
  return out;
}

/** Closed outline minus a circle that crosses its edge (a notch that wraps the circle). */
function notch(loop: P2[], c: P2, R: number): P2[] {
  const pts = resample(loop, 0.1, true);
  const n = pts.length;
  const inside = pts.map((p) => Math.hypot(p.x - c.x, p.z - c.z) < R);
  const start = inside.findIndex((v) => !v);
  if (start < 0 || !inside.some(Boolean)) return loop;
  // where the segment from an outside point a to an inside point b meets the circle
  const meet = (a: P2, b: P2): P2 => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const fx = a.x - c.x;
    const fz = a.z - c.z;
    const A = dx * dx + dz * dz;
    const B = 2 * (fx * dx + fz * dz);
    const C = fx * fx + fz * fz - R * R;
    const t = (-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
    return { x: a.x + dx * t, z: a.z + dz * t };
  };
  const out: P2[] = [];
  let k = 0;
  while (k < n) {
    const i = (start + k) % n;
    if (!inside[i]) {
      out.push(pts[i]);
      k++;
      continue;
    }
    let j = k;
    while (j < n && inside[(start + j) % n]) j++;
    const first = pts[i];
    const last = pts[(start + j - 1) % n];
    const before = pts[(i - 1 + n) % n];
    const after = pts[(start + j) % n];
    out.push(...arcInside(meet(before, first), meet(after, last), c, R, loop));
    k = j;
  }
  return out;
}

export interface Carved {
  /** The outline, notched where a trunk crosses its edge. */
  loop: P2[];
  /** Round holes for trunks that stand well inside the outline. */
  holes: P2[][];
  /** The trunks that got a hole, with the hole. */
  holed: { t: TreeDef; hole: Circle }[];
}

/**
 * Cut the house trunks out of a closed outline (roof, canopy, slab) spanning
 * heights y0..y1. A trunk well inside gets a round hole; one near or across the
 * edge gets a notch so the edge (and the fascia built along it) wraps around the
 * bark. `gap` is the clearance between bark and cut.
 */
export function carveTrunks(loop: P2[], y0: number, y1: number, gap = 0.1): Carved {
  let out = loop;
  const holes: P2[][] = [];
  const holed: Carved["holed"] = [];
  for (const t of HOUSE_TRUNKS) {
    const s = trunkSpan(t, y0, y1);
    const R = s.R + gap;
    const d = distToLoop(s, out);
    const inside = pointInPolygon(s, out);
    if (inside && d > R + 0.3) {
      holes.push(circle(s.x, s.z, R));
      holed.push({ t, hole: { x: s.x, z: s.z, R } });
    } else if (d < R) {
      out = notch(out, s, R);
    } else if (inside) {
      // too close to the edge for a clean hole: open it into a notch instead of leaving a sliver
      out = notch(out, s, d + 0.15);
    }
  }
  return { loop: out, holes, holed };
}

/** Counter-clockwise circle outline. */
export function circle(cx: number, cz: number, r: number, n = 40): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return out;
}

/**
 * Timber collar closing the gap between a trunk and the opening `hole` around
 * it. "up" sits on a floor or roof at y; "down" hangs under a ceiling at y. The
 * collar is centred on the trunk at y; its inner edge tucks inside the bark and
 * its outer edge laps past the opening all round.
 */
export function trunkCollar(ctx: WorldCtx, z: Zone, t: TreeDef, y: number, hole: Circle, face: "up" | "down", mat = "timberDark", h = 0.06): void {
  const s = trunkShape(t);
  const yIn = face === "up" ? y + h : y - h;
  const c = s.centre(yIn);
  const ri = Math.min(s.inner(y), s.inner(yIn)) * 0.9;
  const ro = Math.hypot(hole.x - c.x, hole.z - c.z) + hole.R + 0.15;
  const prof: [number, number][] =
    face === "up"
      ? [
          [ro, 0],
          [ro, h * 0.55],
          [ro - 0.035, h],
          [ri, h],
        ]
      : [
          [ri, -h],
          [ro - 0.035, -h],
          [ro, -h * 0.55],
          [ro, 0],
        ];
  ctx.g(z, mat).add(lathe(prof, 56), xf(c.x, y, c.z), "Trunk collar");
}
