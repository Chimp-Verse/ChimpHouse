// Deck and gallery railings, trailing vines along edges, and the timber
// substructure (posts, beams, diagonal braces) under the house.

import { Vector3 } from "@babylonjs/core";
import { P2, ellipseArc, offsetPath, pointInPolygon, resample, rng } from "../geometry/curves";
import { at, beam, box, xf } from "../geometry/geo";
import { WorldCtx, zone } from "../context";
import { BRIDGE, CANOPY_STAIR, FRONT_STAIR, HALL_HALF, HOUSE_TRUNKS, LEVEL, SHOWROOM, atriumVoid, barLoop, lowerDeckLoop, poolLoop, showroomLoop, theatreLoop, upperDeckLoop, CORRIDOR, core, galleryOuter, THEATRE, BAR, POOL, LOUNGE, GAME, TRADING, MIX, RAIL_BAR, CABANA } from "../layout";
import { railing } from "./elements";
import { openRuns } from "./floors";
import { wingArchPaths } from "./entrance";
import { plant, planterBox, vine, vineCurtain } from "../props/plants";
import { terrainHeight } from "../environment/terrain";
import { Leaf } from "../materials/leaves";
import { trunkCentre, trunkNear } from "./trunks";

/** Split a closed loop into open runs where `keep` holds. */
function keepRuns(loop: P2[], keep: (p: P2) => boolean, step = 0.3): P2[][] {
  const pts = resample(loop, step, true);
  const n = pts.length;
  let start = 0;
  for (let i = 0; i < n; i++) if (!keep(pts[i])) {
    start = i;
    break;
  }
  const runs: P2[][] = [];
  let cur: P2[] = [];
  for (let k = 0; k <= n; k++) {
    const p = pts[(start + k) % n];
    if (keep(p)) cur.push(p);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  if (runs.length === 0 && pts.every(keep)) return [[...pts, pts[0]]];
  return runs.filter((r) => r.length > 1);
}

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

/** True under the roofed connecting spaces between the pavilions. */
function indoors(x: number, z: number): boolean {
  const inRect = (r: { x0: number; x1: number; z0: number; z1: number }, pad: number) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
  const gx = (x - galleryOuter.cx) / (galleryOuter.rx + 0.8);
  const gz = (z - galleryOuter.cz) / (galleryOuter.rz + 0.8);
  return inRect(CORRIDOR, 0.4) || inRect(core, 0.4) || gx * gx + gz * gz < 1 || (x > core.x0 - 0.4 && x < core.x1 + 0.6 && z > galleryOuter.cz && z < core.z0);
}

export function buildEdges(ctx: WorldCtx): void {
  const r = rng(777);
  // ------------------------------------------------ lower deck railing
  const zl = zone("structure", "lower");
  const lowerEdge = offsetPath(lowerDeckLoop, -0.1, true);
  const stairGap = FRONT_STAIR.x1 + 0.6;
  // gaps where the front stair and the west stair's bottom landing meet the deck
  const cs = CANOPY_STAIR;
  const lowerKeep = (p: P2) => !(Math.abs(p.x) < stairGap && p.z < 1.2) && !(p.x < cs.x + 5 && p.z > cs.zBottom - cs.landing + 0.1 && p.z < cs.zBottom - 0.1);
  for (const run of keepRuns(lowerEdge, lowerKeep)) {
    railing(ctx, zl, run, LEVEL.lower, { label: "Deck railing", infill: "glass" });
    ctx.wall(run, LEVEL.lower - 0.1, LEVEL.lower + 1.15);
  }

  // ------------------------------------------------ upper deck railing
  const zu = zone("structure", "upper");
  const upperEdge = offsetPath(upperDeckLoop, -0.1, true);
  const upperKeep = (p: P2) =>
    !(Math.abs(p.x) < HALL_HALF + 0.55 && p.z < 0.9) &&
    !(p.x < SHOWROOM.x0 - 0.4 && Math.abs(p.z - BRIDGE.start.z) < 1.1) &&
    !(p.x < cs.x + 3.5 && p.z > cs.zTop + 0.1 && p.z < cs.zTop + cs.landing - 0.1) &&
    !pointInPolygon(p, offsetPath(poolLoop, 0.6, true));
  for (const run of keepRuns(upperEdge, upperKeep)) {
    // terrace runs east of the atrium use cable rail, balconies glass
    const terrace = run.filter((p) => p.x > 4.5).length > run.length / 2;
    railing(ctx, terrace ? zone("poolTerrace", "upper") : zu, run, LEVEL.upper, { label: terrace ? "Terrace railing" : "Balcony railing", infill: terrace ? "cable" : "glass" });
    ctx.wall(run, LEVEL.upper - 0.1, LEVEL.upper + 1.15);
  }

  // ------------------------------------------------ gallery void railing
  const voidPts = ellipseArc(atriumVoid.cx, atriumVoid.cz, atriumVoid.rx - 0.08, atriumVoid.rz - 0.08, 0, Math.PI * 2, 72).slice(0, 72);
  railing(ctx, zone("gallery", "upper"), voidPts, LEVEL.upper, { label: "Gallery balustrade", infill: "glass", closed: true, postStep: 1.4 });

  // ------------------------------------------------ vines
  const zv = zone("structure", "upper");
  // each kept stretch is its own run so vines never hang across the entrance or the pool
  const nearPool = (p: P2) => pointInPolygon(p, offsetPath(poolLoop, POOL.wall + 0.7, true));
  for (const run of openRuns(offsetPath(resample(upperDeckLoop, 0.4, true), 0.05, true), (p) => !(Math.abs(p.x) < HALL_HALF + 0.55 && p.z < 1.0) && !nearPool(p)))
    vineCurtain(ctx, zv, at(run, LEVEL.lowerCeil - 0.02), r, { every: 0.45, len: [0.5, 3.4], chance: 0.8, density: 9, leaf: 0.17, hug: "under" });
  for (const run of openRuns(offsetPath(resample(lowerDeckLoop, 0.5, true), 0.04, true), (p) => !(Math.abs(p.x) < stairGap && p.z < 1.2)))
    vineCurtain(ctx, zl, at(run, -0.5), r, { every: 0.6, len: [0.4, 2.2], chance: 0.7, leaf: 0.16, density: 8, hug: "under" });

  // planter troughs just inside the deck railings, upper and lower. Each box is laid along
  // the edge's tangent and must stay 0.1 m clear of the railing glass and of the rooms' glass;
  // where a full box won't fit a short one is tried, else the spot is skipped. The plants are
  // fenced by the same lines, so no leaf reaches through the railing or into a room.
  const troughs = (loop: P2[], edge: P2[], y: number, keep: (p: P2) => boolean, z: ReturnType<typeof zone>) => {
    const pts = resample(offsetPath(loop, -0.45, true), 2.6, true);
    const kinds = ["bromeliad", "fern", "philodendron", "croton", "calathea", "cordyline", "monstera"] as const;
    const rooms = y > LEVEL.lower ? [SHOWROOM, THEATRE, BAR] : [LOUNGE, GAME, TRADING, MIX];
    const closed = (l: P2[]) => [...l, l[0]];
    const fence = [closed(edge), ...rooms.map((room) => closed(room.loop))];
    const D = 0.42;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!keep(p) || r() > 0.8) continue;
      if (y > LEVEL.lower && [THEATRE, BAR].some((room) => distToLoop(p, room.loop) < 1.6)) continue;
      // leave room for the terrace's drinks ledge and cabana
      if (y > LEVEL.lower && p.x > RAIL_BAR.xMin - 0.8 && p.z > RAIL_BAR.zMin - 1.0 && p.z < RAIL_BAR.zMax + 1.0) continue;
      if (y > LEVEL.lower && Math.hypot(p.x - CABANA.x, p.z - CABANA.z) < CABANA.r + 0.9) continue;
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[(i + 1) % pts.length];
      const ux0 = b.x - a.x;
      const uz0 = b.z - a.z;
      const ul = Math.hypot(ux0, uz0) || 1;
      const ux = ux0 / ul;
      const uz = uz0 / ul;
      const yaw = -Math.atan2(uz, ux);
      const fits = (len: number) =>
        [-1, 1].every((sl) =>
          [-1, 1].every((sd) => {
            const k = { x: p.x + ux * sl * (len / 2) - uz * sd * (D / 2), z: p.z + uz * sl * (len / 2) + ux * sd * (D / 2) };
            return pointInPolygon(k, edge) && distToLoop(k, edge) > 0.1 && rooms.every((room) => !pointInPolygon(k, room.loop) && distToLoop(k, room.loop) > 0.15);
          }),
        );
      const len = fits(1.3) ? 1.3 : fits(0.86) ? 0.86 : 0;
      if (!len) continue;
      const soil = y + planterBox(ctx, z, xf(p.x, y, p.z, yaw), len, 0.38, D, "timberDark", "Deck planter");
      // the deck side of the box (away from the railing)
      const n = { x: -uz, z: ux };
      const side = distToLoop({ x: p.x + n.x * 0.5, z: p.z + n.z * 0.5 }, edge) > distToLoop({ x: p.x - n.x * 0.5, z: p.z - n.z * 0.5 }, edge) ? 1 : -1;
      ctx.withFence(fence, () => {
        const count = len > 1 ? 3 : 2;
        for (let k = 0; k < count; k++) {
          const t = (k - (count - 1) / 2) * 0.42;
          plant(ctx, z, new Vector3(p.x + ux * t, soil, p.z + uz * t), kinds[Math.floor(r() * kinds.length)], 0.6 + r() * 0.4, r);
        }
        // a trailing plant spilling over the box's deck-side rim, down to just above the deck
        if (r() > 0.4) {
          const rim = new Vector3(p.x + n.x * side * (D / 2), y + 0.38, p.z + n.z * side * (D / 2));
          const out = new Vector3(n.x * side, 0, n.z * side);
          const lead = [rim.add(out.scale(-0.08)).add(new Vector3(0, -0.02, 0)), rim.add(new Vector3(0, 0.012, 0)), rim.add(out.scale(0.03)).add(new Vector3(0, -0.03, 0))];
          vine(ctx, z, rim.add(out.scale(0.04)).add(new Vector3(0, -0.07, 0)), 0.22, r, { leaf: 0.11, density: 18, lead, drift: out.scale(0.05) });
        }
      });
    }
  };
  // keep planters clear of where the wing arches come down to the lower deck
  const archFeet = wingArchPaths().flat().filter((v) => v.y < 2.0);
  const clearOfArches = (p: P2) => archFeet.every((v) => Math.hypot(v.x - p.x, v.z - p.z) > 1.1);
  troughs(lowerDeckLoop, lowerEdge, LEVEL.lower, (p) => lowerKeep(p) && !(Math.abs(p.x) < HALL_HALF + 0.85 && p.z < 1.5) && clearOfArches(p), zl);
  troughs(upperDeckLoop, upperEdge, LEVEL.upper, (p) => upperKeep(p) && !(Math.abs(p.x) < HALL_HALF + 1.25 && p.z < 1.4), zu);
  const zr = zone("roofs", "roof");
  for (const [loop, ov] of [
    [showroomLoop, 1.5],
    [theatreLoop, 1.2],
    [barLoop, 1.4],
  ] as [P2[], number][]) {
    // only eaves that are outdoors: skip stretches over the corridor, stair core, gallery and trunks,
    // treating each outdoor stretch as its own run so the vines never bridge a gap
    const eave = resample(offsetPath(loop, ov + 0.06, true), 0.45, true);
    for (const run of keepRuns(eave, (p) => !indoors(p.x, p.z) && !trunkNear(p, 0.3, LEVEL.upperCeil - 3.6, LEVEL.upperCeil), 0.45)) {
      vineCurtain(ctx, zr, at(run, LEVEL.upperCeil + 0.02), r, { every: 0.5, len: [0.5, 3.6], chance: 0.75, density: 9, leaf: 0.17, hug: "under" });
    }
  }
  // vines from the underside of the gallery slab, round the edge of the atrium
  const voidEdge = at(ellipseArc(atriumVoid.cx, atriumVoid.cz, atriumVoid.rx + 0.06, atriumVoid.rz + 0.06, 0, Math.PI * 2, 80), LEVEL.lowerCeil);
  vineCurtain(ctx, zone("gallery", "upper"), voidEdge, r, { every: 0.4, len: [0.6, 3.0], chance: 0.75, type: Leaf.Pothos, density: 12, hug: "under" });
  // vines draped over the gallery handrail (top at upper + 1.11, on the line rx - 0.08), hanging into the atrium
  const yRail = LEVEL.upper + 1.11;
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + (r() - 0.5) * 0.06;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p = new Vector3(atriumVoid.cx + ca * (atriumVoid.rx - 0.08), yRail, atriumVoid.cz + sa * (atriumVoid.rz - 0.08));
    if (p.z < atriumVoid.cz - atriumVoid.rz * 0.5 || r() > 0.55) continue;
    const nx = ca / atriumVoid.rx;
    const nz = sa / atriumVoid.rz;
    const nl = Math.hypot(nx, nz);
    const inw = new Vector3(-nx / nl, 0, -nz / nl);
    const tan = new Vector3(-inw.z, 0, inw.x);
    const lead = [p.add(inw.scale(-0.01)).add(new Vector3(0, 0.004, 0)), p.add(inw.scale(0.045)).add(new Vector3(0, -0.01, 0)), p.add(inw.scale(0.075)).add(new Vector3(0, -0.05, 0))];
    const top = p.add(inw.scale(0.09)).add(new Vector3(0, -0.11, 0));
    const drift = inw.scale(0.06).add(tan.scale((r() - 0.5) * 0.14));
    vine(ctx, zone("gallery", "upper"), top, 0.5 + Math.pow(r(), 1.4) * 1.6, r, { type: Leaf.Philodendron, leaf: 0.13, lead, drift });
  }

  // ------------------------------------------------ substructure
  // Perimeter ring beam, posts on a ~5 m rhythm that disappear into the
  // understorey canopy (see jungle.ts), paired diagonal braces between posts,
  // and raking struts from the central trunks out to the ring.
  const zs = zone("structure", "site");
  const ring = offsetPath(lowerDeckLoop, -1.3, true);
  const sb = ctx.g(zs, "glulam");
  sb.setLabel("Timber substructure");
  const beamPath = at(resample(ring, 0.5, true), -0.8);
  beamPath.push(beamPath[0].clone());
  sb.add(beam(beamPath, 0.32, 0.5));
  const top = -1.05;
  const postPts = resample(ring, 5.0, true);
  for (let i = 0; i < postPts.length; i++) {
    const p = postPts[i];
    const g = terrainHeight(p.x, p.z);
    if (g > top - 0.3) continue;
    const bottom = Math.max(g - 0.5, -18);
    sb.add(box(0.4, top - bottom, 0.4), xf(p.x, (top + bottom) / 2, p.z), "Timber post");
    if (top - g < 2.5) continue;
    // braces rising from the post toward the ring beam on both sides, along the ring
    const prev = postPts[(i - 1 + postPts.length) % postPts.length];
    const next = postPts[(i + 1) % postPts.length];
    const yb = Math.max(bottom + 0.5, top - 3.4);
    for (const q of [prev, next]) {
      const t = 0.45;
      const b = new Vector3(p.x + (q.x - p.x) * t, top - 0.15, p.z + (q.z - p.z) * t);
      sb.add(beam([new Vector3(p.x, yb, p.z), b], 0.22, 0.24), undefined, "Diagonal brace");
    }
  }
  // raking struts from the central trunks to the ring beam
  for (const t of HOUSE_TRUNKS) {
    const c = trunkCentre(t, -5.5);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + t.seed;
      const dir = { x: Math.cos(a), z: Math.sin(a) };
      const from = new Vector3(c.x + dir.x * t.r * 0.9, -5.5, c.z + dir.z * t.r * 0.9);
      const to = new Vector3(c.x + dir.x * 5.5, top - 0.2, c.z + dir.z * 5.5);
      if (!pointInPolygon({ x: to.x, z: to.z }, lowerDeckLoop)) continue;
      sb.add(beam([from, to], 0.26, 0.3), undefined, "Raking strut");
    }
  }
}
