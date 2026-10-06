// Stairs: broad front entrance stair, interior core stair, exterior canopy stair.

import { Matrix, Vector3 } from "@babylonjs/core";
import { P2, ensureCCW, rng, roundedRect } from "../geometry/curves";
import { beam, box, polygonFace, slab, wallStrip, xf } from "../geometry/geo";
import { pottedPlant } from "../props/plants";
import { WorldCtx, zone } from "../context";
import { CANOPY_STAIR, FRONT_ARC, FRONT_STAIR, LEVEL, STAIR, deckWestX, lowerDeckLoop, upperDeckLoop } from "../layout";
import { ledStrip, railing } from "./elements";
import { lanternPost, wovenPendant } from "../props/lights";
import { terrainHeight } from "../environment/terrain";

/** Front edge of the entrance landing: 1.25 m in front of the glazed atrium front. */
export const FRONT_LANDING_Z = FRONT_ARC.cz - FRONT_ARC.R - 1.25;

/** z of the lower deck's front edge at x (the most forward crossing of the deck outline). */
function deckFrontZ(x: number): number {
  let best = Infinity;
  const loop = lowerDeckLoop;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
    const zc = a.z + ((b.z - a.z) * (x - a.x)) / (b.x - a.x);
    if (zc < best) best = zc;
  }
  return best;
}

export function buildStairs(ctx: WorldCtx): void {
  buildFrontStair(ctx);
  buildCoreStair(ctx);
  buildCanopyStair(ctx);
}

function buildFrontStair(ctx: WorldCtx) {
  const z = zone("approach", "lower");
  const { x0, x1, risers, riser, tread } = FRONT_STAIR;
  const w = x1 - x0;
  // landing in front of the doors: its top runs back to the deck's curved front edge and
  // stops there, so the two surfaces meet without overlapping (overlapping coplanar decking flickers)
  const lx0 = -(w + 1.2) / 2;
  const lx1 = (w + 1.2) / 2;
  const lz0 = FRONT_LANDING_Z - 0.05;
  const edge: P2[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = lx1 - ((lx1 - lx0) * i) / 24;
    edge.push({ x, z: deckFrontZ(x) });
  }
  const top = ensureCCW([{ x: lx0, z: lz0 }, { x: lx1, z: lz0 }, ...edge]);
  const land = ctx.g(z, "deck");
  land.setLabel("Entrance landing");
  land.add(polygonFace(top, LEVEL.lower, true));
  land.add(polygonFace(top, LEVEL.lower - 0.3, false));
  const sides = ctx.g(z, "deck");
  sides.add(wallStrip([{ x: lx0, z: edge[edge.length - 1].z }, { x: lx0, z: lz0 }, { x: lx1, z: lz0 }, { x: lx1, z: edge[0].z }], LEVEL.lower - 0.3, LEVEL.lower), undefined, "Entrance landing");
  const steps = ctx.g(z, "deck");
  steps.setLabel("Front timber stair");
  const riserG = ctx.g(z, "timberDark");
  for (let i = 1; i <= risers; i++) {
    const y = LEVEL.lower - i * riser;
    const zf = FRONT_LANDING_Z - i * tread;
    steps.add(box(w, 0.06, tread + 0.04), xf(0, y - 0.03, zf + tread / 2));
    riserG.add(box(w, riser, 0.04), xf(0, y + riser / 2 - 0.06, zf + tread + 0.0), "Front timber stair");
    if (i < risers) ledStrip(ctx, z, [new Vector3(x0 + 0.1, y - 0.07, zf + 0.03), new Vector3(x1 - 0.1, y - 0.07, zf + 0.03)], "amberStrip", 0.02);
  }
  // cheek walls with timber caps
  const bottomZ = FRONT_LANDING_Z - risers * tread;
  for (const sx of [x0 - 0.25, x1 + 0.25]) {
    const cheek = ctx.g(z, "glulam");
    cheek.setLabel("Stair cheek wall");
    const top = new Vector3(sx, LEVEL.lower + 0.55, FRONT_LANDING_Z + 0.2);
    const bot = new Vector3(sx, LEVEL.ground + 0.55, bottomZ);
    cheek.add(beam([top, bot], 0.4, 1.1, { offsetY: -0.3 }));
    lanternPost(ctx, z, new Vector3(sx, LEVEL.lower + 0.2, FRONT_LANDING_Z + 0.05), 1.15, { addLight: true });
    lanternPost(ctx, z, new Vector3(sx, LEVEL.ground + 0.2, bottomZ + 0.2), 1.15, { addLight: true });
    lanternPost(ctx, z, new Vector3(sx, (LEVEL.lower + LEVEL.ground) / 2 + 0.2, (FRONT_LANDING_Z + bottomZ) / 2), 0.9);
  }
}

/**
 * U-shaped main stair (see STAIR in layout.ts). Flight A rises north from the
 * entry hall to the half-landing; flight B rises south from the landing and
 * arrives on the upper floor at the gallery. A slatted spine wall separates
 * the flights and guards flight B's inner edge.
 */
function buildCoreStair(ctx: WorldCtx) {
  const z = zone("core", "lower");
  const zu = zone("core", "upper");
  const { x0: X0, x1: X1, z0: zS, flight: w, tread: t, risers: n, landingZ: zL, landingDepth: Ld } = STAIR;
  const rise = LEVEL.upper / n;
  const per = n / 2;
  const yL = per * rise;
  const ax0 = X0;
  const ax1 = X0 + w;
  const bx0 = X1 - w;
  const bx1 = X1;
  const treads = ctx.g(z, "timber");
  treads.setLabel("Main stair");
  const nosing = (xa: number, xb: number, y: number, zz: number) =>
    ledStrip(ctx, z, [new Vector3(xa + 0.08, y - 0.075, zz), new Vector3(xb - 0.08, y - 0.075, zz)], "amberStrip", 0.018);

  // flight A: rises north
  for (let i = 1; i < per; i++) {
    const y = i * rise;
    const za = zS + (i - 1) * t;
    treads.add(box(w, 0.06, t + 0.03), xf((ax0 + ax1) / 2, y - 0.03, za + t / 2));
    treads.add(box(w, rise - 0.02, 0.03), xf((ax0 + ax1) / 2, y - rise / 2 - 0.03, za + 0.015));
    nosing(ax0, ax1, y, za + 0.03);
  }
  // the top riser stands just proud of the half-landing's front, so the two faces never coincide
  treads.add(box(w, rise - 0.02, 0.03), xf((ax0 + ax1) / 2, yL - rise / 2 - 0.03, zL - 0.02));

  // flight B: rises south from the landing to the upper floor
  for (let j = 1; j < per; j++) {
    const y = yL + j * rise;
    const za = zL - (j - 1) * t; // riser line (north edge of tread j)
    treads.add(box(w, 0.06, t + 0.03), xf((bx0 + bx1) / 2, y - 0.03, za - t / 2));
    treads.add(box(w, rise - 0.02, 0.03), xf((bx0 + bx1) / 2, y - rise / 2 - 0.03, za - 0.015));
    nosing(bx0, bx1, y, za - 0.03);
  }
  // likewise just proud of the edge of the upper floor's stair opening
  treads.add(box(w, rise - 0.02, 0.03), xf((bx0 + bx1) / 2, LEVEL.upper - rise / 2 - 0.03, zS + 0.02));

  // sloped soffits under both flights
  const soffit = ctx.g(z, "timberDark");
  soffit.setLabel("Stair soffit");
  soffit.add(beam([new Vector3((ax0 + ax1) / 2, rise, zS), new Vector3((ax0 + ax1) / 2, yL, zL)], w, 0.16, { offsetY: -0.32 }));
  soffit.add(beam([new Vector3((bx0 + bx1) / 2, yL + rise, zL), new Vector3((bx0 + bx1) / 2, LEVEL.upper, zS)], w, 0.16, { offsetY: -0.32 }));

  // half-landing
  const land = ctx.g(z, "timberDark");
  land.setLabel("Stair half-landing");
  // the landing block stops just under its floor boards (coincident faces flicker)
  land.add(box(X1 - X0, 0.24, Ld), xf((X0 + X1) / 2, yL - 0.008 - 0.12, zL + Ld / 2));
  ctx.g(z, "floor").add(polygonFace(ensureCCW(roundedRect(X0, zL, X1, zL + Ld, [0, 0, 0, 0])), yL + 0.002, true), undefined, "Stair half-landing");
  nosing(X0, X1, yL, zL + 0.03);
  railing(ctx, z, [{ x: X0, z: zL + Ld - 0.05 }, { x: X1, z: zL + Ld - 0.05 }], yL, { label: "Landing balustrade" });

  // spine wall between the flights, its top following flight B's handrail
  const yB = (zz: number) => yL + ((zL - zz) / t) * rise;
  const profile = ensureCCW([
    { x: zS, z: 0 },
    { x: zL, z: 0 },
    { x: zL, z: yB(zL) + 1.0 },
    { x: zS, z: yB(zS) + 1.0 },
  ]);
  const perm = Matrix.FromValues(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  ctx.g(z, "panelHoney").add(slab(profile, ax1, bx0), perm, "Stair spine wall");
  const rail = ctx.g(z, "timber");
  rail.setLabel("Stair handrail");
  rail.add(beam([new Vector3((ax1 + bx0) / 2, yB(zL) + 1.04, zL), new Vector3((ax1 + bx0) / 2, yB(zS) + 1.04, zS)], 0.2, 0.06));
  // handrails for flight A on the wall and the spine
  for (const hx of [ax0 + 0.06, ax1 - 0.05]) rail.add(beam([new Vector3(hx, rise + 0.9, zS + 0.1), new Vector3(hx, yL + 0.9, zL)], 0.06, 0.06));

  // flight B's open outer edge: sloped glass balustrade and stringer
  const stringer = ctx.g(z, "charcoal");
  stringer.setLabel("Stair stringer");
  stringer.add(beam([new Vector3(bx1 - 0.04, yL - 0.1, zL), new Vector3(bx1 - 0.04, LEVEL.upper - 0.1, zS)], 0.08, 0.4, { offsetY: -0.1 }));
  rail.add(beam([new Vector3(bx1 + 0.02, yL + 1.0, zL + 0.2), new Vector3(bx1 + 0.02, LEVEL.upper + 1.0, zS)], 0.08, 0.06));
  const glass = ctx.g(z, "glassRail", { castShadow: false, pickable: false });
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const za = zL - ((zL - zS) * i) / steps;
    const zb = zL - ((zL - zS) * (i + 1)) / steps;
    glass.add(box(0.02, 0.92, za - zb - 0.02), xf(bx1 + 0.02, yB(za) + 0.55, (za + zb) / 2));
    stringer.add(box(0.05, 1.05, 0.05), xf(bx1 + 0.02, yB(za) + 0.55, za));
  }

  // upper floor guards around the stair hall opening (flight B arrives at its south-east corner)
  railing(ctx, zu, [{ x: X0 - 0.05, z: zS + 0.05 }, { x: ax1 + 0.02, z: zS + 0.05 }], LEVEL.upper, { label: "Stair hall balustrade" });
  railing(ctx, zu, [{ x: X1 + 0.12, z: zS + 0.05 }, { x: X1 + 0.12, z: STAIR.hallZ1 }], LEVEL.upper, { label: "Stair hall balustrade" });

  // the double-height hall: pendants over the landing, tall plants behind it
  const r = rng(515);
  for (const [dx, drop, rad] of [
    [0.3, 2.4, 0.42],
    [0.7, 3.4, 0.32],
  ] as [number, number, number][])
    wovenPendant(ctx, zu, new Vector3(X0 + (X1 - X0) * dx, LEVEL.upperCeil, zL + Ld + 1.2), rad, drop, { label: "Stair hall pendant" });
  pottedPlant(ctx, z, new Vector3(X0 + 0.9, 0, STAIR.hallZ1 - 1.0), "banana", { pot: "cream", potR: 0.42, potH: 0.7, scale: 2.4, r, label: "Stair hall plant" });
  pottedPlant(ctx, z, new Vector3(X1 - 0.8, 0, STAIR.hallZ1 - 1.6), "monstera", { pot: "cream", potR: 0.36, potH: 0.6, scale: 1.8, r, label: "Stair hall plant" });
  ctx.lights.push({ pos: new Vector3((X0 + X1) / 2, yL + 2.2, zL + 0.5), color: "#ffb766", day: 2.5, night: 9, range: 9, rooms: ["core"], level: "lower" });
  ctx.lights.push({ pos: new Vector3((X0 + X1) / 2, LEVEL.upper + 2.4, zS + 1.5), color: "#ffb766", day: 2, night: 7, range: 8, rooms: ["core", "gallery"], level: "upper" });
}

function buildCanopyStair(ctx: WorldCtx) {
  const z = zone("bridge", "upper");
  const { x, zBottom, zTop, width, landing } = CANOPY_STAIR;
  const n = 26;
  const rise = LEVEL.upper / n;
  const dir = Math.sign(zTop - zBottom);
  const run = Math.abs(zTop - zBottom) / n;
  const zAt = (i: number) => zBottom + dir * i * run;
  const yAt = (zz: number) => (Math.abs(zz - zBottom) / Math.abs(zTop - zBottom)) * LEVEL.upper;
  const t = ctx.g(z, "deck");
  t.setLabel("Canopy stair");
  for (let i = 0; i < n; i++) {
    const y = (i + 1) * rise;
    const zz = zAt(i + 0.5);
    t.add(box(width, 0.06, run + 0.04), xf(x, y - 0.03, zz));
  }
  // landings at both ends: from just west of the stair east to the deck's edge, meeting it
  // without overlapping (overlapping decking flickers), with railings round the open sides
  const xw = x - width / 2 - 0.55;
  const landingPad = (loop: P2[], z0: number, z1: number, y: number, label: string) => {
    const edge: P2[] = [];
    for (let i = 0; i <= 12; i++) {
      const zz = z0 + ((z1 - z0) * i) / 12;
      edge.push({ x: deckWestX(loop, zz), z: zz });
    }
    const outline = ensureCCW([{ x: xw, z: z0 }, ...edge, { x: xw, z: z1 }]);
    const pad = ctx.g(z, "deck");
    pad.setLabel(label);
    pad.add(polygonFace(outline, y, true));
    pad.add(polygonFace(outline, y - 0.25, false));
    // edge band on the three open sides (the east side meets the deck)
    ctx.g(z, "glulam").add(wallStrip([edge[0], { x: xw, z: z0 }, { x: xw, z: z1 }, edge[edge.length - 1]].reverse(), y - 0.25, y), undefined, label);
    return edge;
  };
  const sxW = x - width / 2 - 0.05;
  const sxE = x + width / 2 + 0.05;
  const inset = 0.06;
  const yTop = LEVEL.upper;
  // bottom landing, the stair rising north from its north side
  const bz0 = zBottom - dir * landing;
  const bEdge = landingPad(lowerDeckLoop, Math.min(bz0, zBottom), Math.max(bz0, zBottom), LEVEL.lower, "Stair landing");
  railing(ctx, z, [{ x: sxW, z: zBottom - inset }, { x: xw + inset, z: zBottom - inset }, { x: xw + inset, z: bz0 + inset }, { x: deckWestX(lowerDeckLoop, bz0 + inset) - 0.02, z: bz0 + inset }], LEVEL.lower, { infill: "cable", label: "Stair landing railing" });
  railing(ctx, z, [{ x: sxE, z: zBottom - inset }, { x: deckWestX(lowerDeckLoop, zBottom - inset) - 0.02, z: zBottom - inset }], LEVEL.lower, { infill: "cable", label: "Stair landing railing" });
  // top landing, the stair arriving from its south side
  const tz1 = zTop + dir * landing;
  const tEdge = landingPad(upperDeckLoop, Math.min(zTop, tz1), Math.max(zTop, tz1), yTop, "Stair landing");
  railing(ctx, z, [{ x: sxW, z: zTop + inset }, { x: xw + inset, z: zTop + inset }, { x: xw + inset, z: tz1 - inset }, { x: deckWestX(upperDeckLoop, tz1 - inset) - 0.02, z: tz1 - inset }], yTop, { infill: "cable", label: "Stair landing railing" });
  railing(ctx, z, [{ x: sxE, z: zTop + inset }, { x: deckWestX(upperDeckLoop, zTop + inset) - 0.02, z: zTop + inset }], yTop, { infill: "cable", label: "Stair landing railing" });
  void bEdge;
  void tEdge;
  const s = ctx.g(z, "glulam");
  for (const sx of [sxW, sxE]) {
    s.add(beam([new Vector3(sx, -0.1, zBottom), new Vector3(sx, LEVEL.upper - 0.1, zTop)], 0.1, 0.32, { offsetY: -0.05 }));
  }
  // posts down to the ground under the stair and the landings' outer corners
  const posts: [number, number, number][] = [];
  for (const f of [0.1, 0.5, 0.9]) {
    const zz = zBottom + (zTop - zBottom) * f;
    posts.push([x - width / 2 - 0.1, zz, yAt(zz) - 0.2]);
  }
  for (const zz of [bz0 + 0.12, zBottom - 0.12]) posts.push([xw + 0.12, zz, LEVEL.lower - 0.25]);
  for (const zz of [zTop + 0.12, tz1 - 0.12]) posts.push([xw + 0.12, zz, yTop - 0.25]);
  for (const [px, pz, top] of posts) {
    const g = terrainHeight(px, pz);
    s.add(box(0.22, top - g, 0.22), xf(px, (top + g) / 2, pz), "Stair post");
  }
  // rope-and-timber rails
  for (const sx of [sxW, sxE]) {
    ctx.g(z, "rope").add(beam([new Vector3(sx, 1.0, zBottom), new Vector3(sx, LEVEL.upper + 1.0, zTop)], 0.07, 0.07), undefined, "Canopy stair handrail");
    for (let i = 0; i <= 6; i++) {
      const zz = zBottom + ((zTop - zBottom) * i) / 6;
      ctx.g(z, "charcoal").add(box(0.06, 1.0, 0.06), xf(sx, yAt(zz) + 0.5, zz), "Canopy stair handrail");
    }
  }
}
