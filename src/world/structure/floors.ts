// Floor slabs, interior floors, slab edge bands, ceilings/soffits and roofs.

import { Vector3 } from "@babylonjs/core";
import { P2, arc, ellipseArc, ensureCCW, offsetPath, pointInPolygon, resample, roundedRect } from "../geometry/curves";
import { at, beam, polygonFace, wallStrip, xf, lathe } from "../geometry/geo";
import { WorldCtx, zone } from "../context";
import {
  FRONT_ARC,
  POOL,
  HOUSE_TRUNKS,
  STAIR,
  poolFootprint,
  poolLoop,
  LEVEL,
  LIFT_SHAFT,
  atriumVoid,
  barLoop,
  core,
  galleryOuter,
  HALL_HALF,
  SHOWROOM,
  gameLoop,
  hall,
  loungeLoop,
  lowerDeckLoop,
  mixLoop,
  showroomLoop,
  theatreLoop,
  tradingLoop,
  upperDeckLoop,
} from "../layout";
import { downlights, gridInside, ledStrip } from "./elements";
import { Circle, carveTrunks, circle, trunkCollar, trunkSpan } from "./trunks";

/** Clearance between bark and the opening cut in a slab; the collars cover it. */
const SLAB_GAP = 0.05;

export function voidLoop(): P2[] {
  return ensureCCW(ellipseArc(atriumVoid.cx, atriumVoid.cz, atriumVoid.rx, atriumVoid.rz, 0, Math.PI * 2, 64).slice(0, 64));
}

/** Opening in the upper floor over the double-height stair hall. */
export const stairwell: P2[] = ensureCCW(roundedRect(STAIR.x0 - 0.05, STAIR.z0, STAIR.x1 + 0.05, STAIR.hallZ1, [0, 0, 0, 0]));

/** Opening in the upper slab and floor for the lift shaft, which the lift car rises through. */
export const liftHole: P2[] = ensureCCW(roundedRect(LIFT_SHAFT.x0, LIFT_SHAFT.z0, LIFT_SHAFT.x1, LIFT_SHAFT.z1, [0, 0, 0, 0]));

/** Slab with separate top/bottom/edge materials. */
function slabParts(
  ctx: WorldCtx,
  zTop: ReturnType<typeof zone>,
  loop: P2[],
  holes: P2[][],
  y0: number,
  y1: number,
  mats: { top: string; bottom: string; edge: string; holeEdge?: string },
  label: string,
  topOnlyHoles: P2[][] = [],
) {
  const top = ctx.g(zTop, mats.top);
  top.setLabel(`${label} surface`);
  // a hole that lies inside a top-only hole is already cut by it
  const inside = (h: P2[]) => topOnlyHoles.some((t) => h.every((p) => pointInPolygon(p, t)));
  top.add(polygonFace(loop, y1, true, [...holes.filter((h) => !inside(h)), ...topOnlyHoles]));
  const bottom = ctx.g(zTop, mats.bottom);
  bottom.setLabel(`${label} soffit`);
  bottom.add(polygonFace(loop, y0, false, holes));
  const edge = ctx.g(zTop, mats.edge);
  edge.setLabel(`${label} edge band`);
  edge.add(wallStrip(loop, y0, y1, true));
  const he = ctx.g(zTop, mats.holeEdge ?? mats.edge);
  for (const h of holes) he.add(wallStrip([...h].reverse(), y0, y1, true));
}

export function buildFloors(ctx: WorldCtx): void {
  const lower = zone("structure", "lower");
  const upper = zone("structure", "upper");
  // each slab's opening follows the trunk where it passes that slab
  const opening = (y0: number, y1: number): Circle[] =>
    HOUSE_TRUNKS.map((t) => {
      const s = trunkSpan(t, y0, y1);
      return { x: s.x, z: s.z, R: s.R + SLAB_GAP };
    });
  const lowerOpen = opening(-0.55, LEVEL.lower);
  const upperOpen = opening(LEVEL.lowerCeil, LEVEL.upper);
  const trunkHoles = lowerOpen.map((c) => circle(c.x, c.z, c.R));

  // ------------------------------------------------ lower deck slab
  slabParts(ctx, lower, lowerDeckLoop, trunkHoles, -0.55, LEVEL.lower, { top: "deck", bottom: "timberDark", edge: "glulam" }, "Lower deck");
  // interior floors (glossy planks) on top of the deck
  const fy = LEVEL.lower + 0.012;
  const floors: [string, P2[]][] = [
    ["arrivalLounge", loungeLoop],
    ["gameRoom", gameLoop],
    ["tradingRoom", tradingLoop],
    ["mixchimp", mixLoop],
    ["core", roundedRect(core.x0, core.z0, core.x1, core.z1, [0, 0, 0, 0])],
  ];
  for (const [room, loop] of floors) {
    const g = ctx.g(zone(room, "lower"), "floor");
    g.setLabel("Timber floor");
    // the lift's pit: the car's floor stands in it, level with this floor, when it is down
    g.add(polygonFace(loop, fy, true, room === "core" ? [liftHole] : []));
  }
  const hallLoop = ensureCCW([
    ...resample([{ x: hall.x0, z: frontEndZ() }, { x: hall.x0, z: hall.z1 }], 1),
    ...resample([{ x: hall.x1, z: hall.z1 }, { x: hall.x1, z: frontEndZ() }], 1),
    ...arcFront(),
  ]);
  const hg = ctx.g(zone("entryHall", "lower"), "floor");
  hg.setLabel("Entry hall floor");
  hg.add(polygonFace(hallLoop, fy, true));

  // ------------------------------------------------ upper slab
  const upperHoles = [...upperOpen.map((c) => circle(c.x, c.z, c.R)), voidLoop(), stairwell, liftHole];
  const gallery = galleryFloorLoop();
  // the pool sits in an opening cut only in the deck surface; its own walls and floor line it.
  // The gallery's indoor floor is cut out of the decking too, so the two never overlap.
  slabParts(ctx, upper, upperDeckLoop, upperHoles, LEVEL.lowerCeil, LEVEL.upper, { top: "deck", bottom: "slats", edge: "glulam", holeEdge: "glulam" }, "Upper floor", [poolFootprint, gallery]);
  // interior upper floors
  const uy = LEVEL.upper + 0.012;
  const upFloors: [string, P2[]][] = [
    ["showroom", showroomLoop],
    ["theatre", theatreLoop],
    ["core", roundedRect(core.x0, core.z0, core.x1, core.z1, [0, 0, 0, 0])],
  ];
  for (const [room, loop] of upFloors) {
    const g = ctx.g(zone(room, "upper"), "floor");
    g.setLabel("Timber floor");
    const holes = room === "core" ? [stairwell, liftHole] : [];
    g.add(polygonFace(loop, uy, true, holes));
    // the floor's edge round the stair opening, down to the slab (closes the sliver under it)
    for (const h of holes) g.add(wallStrip([...h].reverse(), LEVEL.upper - 0.005, uy, true));
  }
  // the gallery and stair landing as one indoor floor, level with the core's and the showroom's
  // floors it runs into, set in the decking with a dark timber threshold where they meet
  const gg = ctx.g(zone("gallery", "upper"), "floor");
  gg.setLabel("Gallery floor");
  gg.add(polygonFace(gallery, uy, true, [voidLoop()]));
  gg.add(wallStrip([...gallery].reverse(), LEVEL.upper, uy, true));
  const edgeRun = (p: P2) => p.z < core.z0 - 0.01 && p.x > SHOWROOM.x1 + 0.03;
  for (const run of openRuns(gallery, edgeRun)) ctx.g(zone("gallery", "upper"), "timberDark").add(beam(at(run, LEVEL.upper + 0.009), 0.07, 0.018), undefined, "Floor threshold");

  // timber collars where the trunks pass each slab: on the floors and under the soffits
  HOUSE_TRUNKS.forEach((t, i) => {
    trunkCollar(ctx, lower, t, LEVEL.lower, lowerOpen[i], "up");
    trunkCollar(ctx, lower, t, -0.55, lowerOpen[i], "down");
    trunkCollar(ctx, upper, t, LEVEL.upper, upperOpen[i], "up");
    trunkCollar(ctx, upper, t, LEVEL.lowerCeil, upperOpen[i], "down");
  });

  // mint strip under the upper slab edge, warm strip on the lower deck edge
  // the strip stops where the pool's infinity edge spills down past the slab
  const nearPool = (p: P2) => pointInPolygon(p, offsetPath(poolLoop, POOL.wall + 0.6, true));
  for (const run of openRuns(offsetPath(resample(upperDeckLoop, 0.3, true), 0.02, true), (p) => !nearPool(p))) {
    ledStrip(ctx, upper, at(run, LEVEL.lowerCeil + 0.02), "mint", 0.04);
  }
  const lowEdge = at(resample(lowerDeckLoop, 0.3, true), LEVEL.lower - 0.08);
  lowEdge.push(lowEdge[0].clone());
  ledStrip(ctx, lower, offsetPath3(lowEdge, 0.02), "mint", 0.03);

  // lower ceilings: downlights in each room under the upper slab
  for (const [room, loop] of floors) {
    downlights(ctx, zone(room, "lower"), gridInside(loop, 2.2, 1.0, (p) => pointInPolygon(p, loop) && !pointInPolygon(p, stairwell)), LEVEL.lowerCeil);
  }
  // soffit downlights on lower decks (outside rooms)
  const deckPts = resample(offsetPath(lowerDeckLoop, -1.0, true), 2.4, true).filter((p) => pointInPolygon(p, upperDeckLoop));
  downlights(ctx, lower, deckPts, LEVEL.lowerCeil);
}

/**
 * Outline of the gallery's indoor floor: round the atrium (the gallery's
 * ellipse, kept clear of the showroom's wall) and on north as wide as the
 * hall to the stair core, where it meets the core's floor.
 */
export function galleryFloorLoop(): P2[] {
  const { cx, cz, rx, rz } = galleryOuter;
  const hx = HALL_HALF - 0.15;
  const t1 = Math.acos(hx / rx);
  const pts: P2[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - t1 + ((Math.PI + 2 * t1) * i) / n;
    pts.push({ x: Math.max(SHOWROOM.x1 + 0.01, cx + Math.cos(a) * rx), z: cz + Math.sin(a) * rz });
  }
  pts.push({ x: hx, z: core.z0 }, { x: -hx, z: core.z0 });
  return ensureCCW(pts);
}

function frontEndZ(): number {
  return FRONT_ARC.cz - Math.sqrt(FRONT_ARC.R * FRONT_ARC.R - hall.x1 * hall.x1);
}

function arcFront(): P2[] {
  return arc(FRONT_ARC.cx, FRONT_ARC.cz, FRONT_ARC.R, Math.PI * 1.5 + FRONT_ARC.half, Math.PI * 1.5 - FRONT_ARC.half, 16);
}

/** Push a closed 3D path outward (in plan) by d. */
function offsetPath3(path: ReturnType<typeof at>, d: number) {
  const plan = path.map((p) => ({ x: p.x, z: p.z }));
  const off = offsetPath(plan.slice(0, -1), d, true);
  const out = at(off, path[0].y);
  out.push(out[0].clone());
  return out;
}

// ------------------------------------------------------------------ roofs

export function buildRoofs(ctx: WorldCtx): void {
  const z = zone("roofs", "roof");
  const roofOf = (loop: P2[], overhang: number, y0: number, y1: number, label: string, soffit = "slats") => {
    const outer = offsetPath(loop, overhang, true);
    // trunks rising through the roof get a hole, or a notch where they cross its edge
    const { loop: smooth, holes, holed } = carveTrunks(resample(outer, 0.3, true), y0, y1);
    const top = ctx.g(z, "charcoal");
    top.setLabel(`${label} roof`);
    top.add(polygonFace(smooth, y1, true, holes));
    const bot = ctx.g(z, soffit);
    bot.setLabel(`${label} ceiling`);
    bot.add(polygonFace(smooth, y0, false, holes));
    const band = ctx.g(z, "glulam");
    band.setLabel(`${label} fascia`);
    band.add(wallStrip(smooth, y0, y1 - 0.08, true));
    for (const h of holes) band.add(wallStrip([...h].reverse(), y0, y1, true));
    for (const { t, hole } of holed) trunkCollar(ctx, z, t, y1, hole, "up", "charcoal", 0.12);
    const cap = ctx.g(z, "charcoal");
    cap.add(wallStrip(offsetPath(smooth, 0.02, true), y1 - 0.1, y1 + 0.04, true), undefined, `${label} roof`);
    const p3 = at(offsetPath(smooth, 0.03, true), y0 + 0.03);
    p3.push(p3[0].clone());
    ledStrip(ctx, z, p3, "amberStrip", 0.03);
    return smooth;
  };
  const sr = roofOf(showroomLoop, 1.5, LEVEL.upperCeil, LEVEL.roof, "Showroom");
  downlights(ctx, z, resample(offsetPath(sr, -0.75, true), 1.3, true), LEVEL.upperCeil);
  downlights(ctx, z, gridInside(showroomLoop, 2.2, 1.0, (p) => pointInPolygon(p, showroomLoop)), LEVEL.upperCeil);
  const th = roofOf(theatreLoop, 1.2, LEVEL.upperCeil, LEVEL.roof, "Theatre");
  downlights(ctx, z, resample(offsetPath(th, -0.6, true), 1.4, true), LEVEL.upperCeil);
  const bar = roofOf(barLoop, 1.4, LEVEL.upperCeil - 0.2, LEVEL.roof - 0.3, "Bar canopy");
  downlights(ctx, z, gridInside(barLoop, 2.0, 1.2, (p) => pointInPolygon(p, barLoop)), LEVEL.upperCeil - 0.2);
  // mint edge on the bar canopy
  const bp = at(offsetPath(bar, 0.05, true), LEVEL.upperCeil - 0.12);
  bp.push(bp[0].clone());
  ledStrip(ctx, z, bp, "mint", 0.04);

  // core roof
  const coreLoop = roundedRect(core.x0 - 0.2, core.z0 - 0.2, core.x1 + 0.2, core.z1 + 0.3, [0, 0, 0, 0]);
  const ct = ctx.g(z, "charcoal");
  ct.setLabel("Core roof");
  ct.add(polygonFace(coreLoop, LEVEL.roof + 0.3, true));
  const cb = ctx.g(z, "slats");
  cb.add(polygonFace(coreLoop, LEVEL.upperCeil, false), undefined, "Core ceiling");
  const cf = ctx.g(z, "panelHoney");
  cf.setLabel("Core fascia");
  cf.add(wallStrip(coreLoop, LEVEL.upperCeil, LEVEL.roof + 0.3, true));

  buildDome(ctx);
}

/** Atrium crown: ring roof over the gallery and a radial slatted dome. */
function buildDome(ctx: WorldCtx) {
  const z = zone("roofs", "roof");
  const { cx, cz, rx, rz } = galleryOuter;
  // the central trunks graze the crown ring, so it is notched around them
  const ringOuter = carveTrunks(ensureCCW(ellipseArc(cx, cz, rx + 0.6, rz + 0.5, 0, Math.PI * 2, 96).slice(0, 96)), LEVEL.upperCeil, LEVEL.roof + 0.2).loop;
  const ringInner = ensureCCW(ellipseArc(cx, cz, rx - 0.9, rz - 0.9, 0, Math.PI * 2, 96).slice(0, 96));
  const y0 = LEVEL.upperCeil;
  const y1 = LEVEL.domeSpring;
  const ring = ctx.g(z, "slats");
  ring.setLabel("Gallery ceiling");
  ring.add(polygonFace(ringOuter, y0, false, [ringInner]));
  const top = ctx.g(z, "charcoal");
  top.add(polygonFace(ringOuter, LEVEL.roof + 0.2, true, [ringInner]), undefined, "Atrium crown roof");
  const band = ctx.g(z, "glulam");
  band.setLabel("Atrium crown fascia");
  band.add(wallStrip(ringOuter, y0, LEVEL.roof + 0.2, true));
  const inner = ctx.g(z, "glulam");
  inner.add(wallStrip([...ringInner].reverse(), y0, y1, true), undefined, "Atrium crown fascia");
  const mintPath = at(offsetPath(ringOuter, 0.03, true), LEVEL.roof + 0.05);
  mintPath.push(mintPath[0].clone());
  ledStrip(ctx, z, mintPath, "mint", 0.05);
  const warm = at(offsetPath(ringOuter, 0.03, true), y0 + 0.03);
  warm.push(warm[0].clone());
  ledStrip(ctx, z, warm, "amberStrip", 0.03);
  downlights(ctx, z, resample(offsetPath(ringOuter, -0.6, true), 1.3, true), y0);

  // dome: lathe scaled to the ellipse; radial slats inside, charcoal shell outside
  const rIn = 1;
  const prof: [number, number][] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = Math.cos((t * Math.PI) / 2) * rIn;
    prof.push([Math.max(0.06, r), Math.sin((t * Math.PI) / 2)]);
  }
  const H = LEVEL.domeApex - y1;
  const sx = rx - 0.9;
  const sz = rz - 0.9;
  const slatsIn = lathe(prof, 64, false, false, 34).flip();
  const di = ctx.g(z, "panelHoney");
  di.setLabel("Atrium dome (radial slats)");
  di.add(slatsIn, xf(cx, y1, cz, 0, sx, H, sz));
  const shell = lathe(prof.map(([r, y]) => [r * 1.02, y + 0.04] as [number, number]), 64);
  const ds = ctx.g(z, "charcoal");
  ds.setLabel("Atrium dome roof");
  ds.add(shell, xf(cx, y1, cz, 0, sx, H, sz));
  // radial glulam ribs inside the dome
  const ribs = ctx.g(z, "glulam");
  ribs.setLabel("Dome rib");
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const pts = prof.map(([r, y]) => new Vector3(cx + Math.cos(a) * r * sx * 0.985, y1 + y * H - 0.06, cz + Math.sin(a) * r * sz * 0.985));
    const inward = new Vector3(-Math.cos(a), 0, -Math.sin(a));
    ribs.add(beam(pts.slice(0, -2), 0.14, 0.22, { up: inward }));
  }
  // oculus ring at the apex
  const ocul = ctx.g(z, "glulam");
  ocul.add(lathe([[0.75, -0.25], [0.75, 0.05], [0.55, 0.05], [0.55, -0.25]], 40), xf(cx, LEVEL.domeApex - 0.15, cz));
}

/**
 * Open runs of a closed loop where `keep` holds. Each run stays separate, so
 * strips and vines built along them never bridge a gap.
 */
export function openRuns(loop: P2[], keep: (p: P2) => boolean): P2[][] {
  const n = loop.length;
  const start = loop.findIndex((p) => !keep(p));
  if (start < 0) return [[...loop, loop[0]]];
  const runs: P2[][] = [];
  let cur: P2[] = [];
  for (let k = 1; k <= n; k++) {
    const p = loop[(start + k) % n];
    if (keep(p)) cur.push(p);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}
