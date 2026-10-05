// Main entrance: glazed two-storey atrium front, sweeping glulam arches with
// mint strips, arched portal with the gabled CHIMPHOUSE sign, and the hall
// side arches into the lounge and arcade.

import { Vector3 } from "@babylonjs/core";
import { P2, arc, ensureCCW, ellipseArc, offsetPath, pathLength, pointAt, resample, rng, subPath, closestFraction } from "../geometry/curves";
import { Geo, at, beam, box, plane, polygonFace, ribbonWall, wallStrip, xf } from "../geometry/geo";
import { WorldCtx, zone } from "../context";
import { FRONT_ARC, HALL_HALF, LEVEL, M, TREES, atriumVoid, galleryOuter, lowerDeckLoop } from "../layout";
import { toTexture } from "../materials/canvas";
import { gableSignCanvas } from "../materials/signs";
import { glazing, ledStrip } from "./elements";
import { carveTrunks, trunkPlanter } from "./trunks";
import { leafMatrix, vine } from "../props/plants";
import { Leaf } from "../materials/leaves";


export function frontArc(n = 32): P2[] {
  return arc(FRONT_ARC.cx, FRONT_ARC.cz, FRONT_ARC.R, Math.PI * 1.5 - FRONT_ARC.half, Math.PI * 1.5 + FRONT_ARC.half, n);
}

/** z of the atrium front glass at x. */
export function frontZ(x: number): number {
  return FRONT_ARC.cz - Math.sqrt(Math.max(0, FRONT_ARC.R * FRONT_ARC.R - x * x));
}

/** Arch path: plan points supply x/z, elevation follows a flattened sine. */
export function archPath(plan: P2[], y0: number, h: number, power: number, n = 48): Vector3[] {
  const len = pathLength(plan);
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = pointAt(plan, t * len);
    out.push(new Vector3(p.x, y0 + h * Math.pow(Math.sin(Math.PI * t), power), p.z));
  }
  return out;
}

/** Glulam rib along a 3D path; the rib's width lies in the arch plane, depth across it. */
export function rib(ctx: WorldCtx, room: string, path: Vector3[], w: number, d: number, label: string, mintSide?: "under" | "inner", level: "lower" | "upper" = "lower") {
  const z = zone(room, level);
  // normal of the arch plane ~ horizontal perpendicular to the chord
  const chord = path[path.length - 1].subtract(path[0]);
  chord.y = 0;
  const side = new Vector3(-chord.z, 0, chord.x).normalize();
  const g = ctx.g(z, "glulam");
  g.setLabel(label);
  // profile x = across the plane (depth), y = in-plane (width) using up = side
  g.add(beam(path, w, d, { up: side }));
  if (mintSide) {
    // a strip along the underside/inside of the arch: offset toward the arch centre
    const centre = path[Math.floor(path.length / 2)].clone();
    centre.y = path[0].y;
    const inner = path.map((p, i) => {
      const tng = path[Math.min(path.length - 1, i + 1)].subtract(path[Math.max(0, i - 1)]).normalize();
      const nrm = Vector3.Cross(tng, side).normalize();
      // choose the normal pointing toward the arch interior (down-ish at the crown)
      const toward = nrm.y > 0 ? nrm.scale(-1) : nrm;
      return p.add(toward.scale(d / 2 + 0.01)).add(side.scale(mintSide === "inner" ? w * 0.25 : 0));
    });
    ledStrip(ctx, z, inner.slice(2, -2), "mint", 0.045, side);
  }
}

/**
 * Centre lines of the two sweeping arches across the lounge and arcade fronts,
 * following the lower deck just inside its edge. Their crowns stay under the
 * upper floor's soffit, clear of the slab and the pool above.
 */
export function wingArchPaths(): [Vector3[], Vector3[]] {
  const deckIn = offsetPath(lowerDeckLoop, -0.4, true);
  const seg = (xa: number, xb: number) => {
    const fa = closestFraction(deckIn, { x: xa, z: xa < 0 ? 0.0 : -0.8 });
    const fb = closestFraction(deckIn, { x: xb, z: -0.3 });
    return subPath(deckIn, Math.min(fa, fb), Math.max(fa, fb), 0.25);
  };
  const crown = LEVEL.lowerCeil - 0.4; // centre line; the 0.5 m deep rib's top sits 0.15 m under the soffit
  return [
    archPath(seg(M(-16.6, 0).x, -(HALL_HALF + 0.7)), -0.5, crown + 0.5, 0.42),
    archPath(seg(HALL_HALF + 0.7, M(17.0, 0).x), -0.5, crown + 0.5, 0.42),
  ];
}

export function buildEntrance(ctx: WorldCtx): void {
  const zH = zone("entryHall", "lower");
  const zU = zone("gallery", "upper");
  const arcPts = frontArc(40);
  const doorHalf = 1.55;
  const left = arcPts.filter((p) => p.x <= -doorHalf + 0.01);
  const right = arcPts.filter((p) => p.x >= doorHalf - 0.01);
  const mid = arcPts.filter((p) => p.x >= -doorHalf - 0.01 && p.x <= doorHalf + 0.01);
  const topY = LEVEL.upperCeil + 0.55;
  const doorH = 3.6;
  glazing(ctx, zH, [...left, { x: -doorHalf, z: frontZ(-doorHalf) }], LEVEL.lower, topY, { label: "Atrium glazing", step: 1.25, transoms: [doorH, LEVEL.upper + 1.9] });
  glazing(ctx, zH, [{ x: doorHalf, z: frontZ(doorHalf) }, ...right], LEVEL.lower, topY, { label: "Atrium glazing", step: 1.25, transoms: [doorH, LEVEL.upper + 1.9] });
  glazing(ctx, zH, mid, doorH, topY, { label: "Atrium glazing", step: 1.05, transoms: [LEVEL.upper + 1.9] });

  // doors: two glass leaves swung open inward
  const frame = ctx.g(zH, "charcoal");
  frame.setLabel("Entrance doors");
  for (const sgn of [-1, 1]) {
    const hx = sgn * doorHalf;
    const hz = frontZ(hx);
    const yaw = sgn * 1.25; // open angle
    const m = xf(hx, 0, hz, yaw);
    const leaf = new Geo();
    const lw = doorHalf - 0.05;
    leaf.add(box(0.06, doorH - 0.05, 0.07), xf(-sgn * lw, (doorH - 0.05) / 2, 0));
    leaf.add(box(0.06, doorH - 0.05, 0.07), xf(-sgn * 0.04, (doorH - 0.05) / 2, 0));
    leaf.add(box(lw, 0.08, 0.07), xf((-sgn * lw) / 2, 0.04, 0));
    leaf.add(box(lw, 0.08, 0.07), xf((-sgn * lw) / 2, doorH - 0.09, 0));
    leaf.add(box(0.03, 1.2, 0.04), xf(-sgn * (lw - 0.15), 1.1, -0.06));
    frame.add(leaf, m);
    const glass = ribbonWall(
      [
        { x: -sgn * lw, z: 0 },
        { x: -sgn * 0.04, z: 0 },
      ],
      0.08,
      doorH - 0.1,
    );
    const g2 = ctx.g(zH, "glass", { castShadow: false, pickable: false });
    g2.add(glass, m);
    g2.add(ribbonWall([{ x: -sgn * 0.04, z: 0 }, { x: -sgn * lw, z: 0 }], 0.08, doorH - 0.1), m);
  }
  // threshold
  ctx.g(zH, "charcoal").add(box(doorHalf * 2, 0.03, 0.3), xf(0, 0.015, frontZ(0)), "Threshold");

  // cap over the atrium glazing reaching back to the crown ring
  const ring = ensureCCW(ellipseArc(galleryOuter.cx, galleryOuter.cz, galleryOuter.rx + 0.6, galleryOuter.rz + 0.5, 0, Math.PI * 2, 96).slice(0, 96));
  const fl = closestFraction(ring, { x: -HALL_HALF, z: frontZ(-HALL_HALF) });
  const fr = closestFraction(ring, { x: HALL_HALF, z: frontZ(HALL_HALF) });
  const back = subPath(ring, fr, fl, 0.3).reverse();
  const capLoop = carveTrunks(ensureCCW([...frontArc(24), ...back.reverse()]), topY, topY + 0.55).loop;
  const zR = zone("roofs", "roof");
  ctx.g(zR, "charcoal").add(polygonFace(capLoop, topY + 0.55, true), undefined, "Atrium front roof");
  ctx.g(zR, "slats").add(polygonFace(capLoop, topY, false), undefined, "Atrium front soffit");
  const fasc = offsetPath(frontArc(32), 0.02);
  ctx.g(zR, "glulam").add(wallStrip(fasc, topY, topY + 0.55), undefined, "Atrium fascia");
  ledStrip(ctx, zR, at(offsetPath(frontArc(32), 0.05), topY + 0.45), "mint", 0.05);

  // ------------------------------------------------ tall central arch framing the atrium bay
  const tall: Vector3[] = [];
  const W = HALL_HALF + 0.55;
  const H = LEVEL.roof + 0.6;
  for (let i = 0; i <= 64; i++) {
    const th = Math.PI - (i / 64) * Math.PI;
    const x = W * Math.cos(th);
    const y = H * Math.pow(Math.sin(th), 0.32);
    tall.push(new Vector3(x, y, frontZ(x) - 0.42));
  }
  rib(ctx, "entryHall", tall, 0.62, 0.5, "Great glulam arch", "under");

  // ------------------------------------------------ lower wing arches across the lounge and arcade fronts
  const [lounge, arcade] = wingArchPaths();
  rib(ctx, "arrivalLounge", lounge, 0.5, 0.42, "Lounge front arch", "under");
  rib(ctx, "gameRoom", arcade, 0.5, 0.42, "Arcade front arch", "under");

  // ------------------------------------------------ hall side arches (openings to lounge and arcade)
  // each arch lands just short of the trunk planter on its side
  for (const sx of [-HALL_HALF, HALL_HALF]) {
    const t = TREES.find((t) => t.id === (sx < 0 ? "treeWestCentral" : "treeEastCentral"))!;
    const pl = trunkPlanter(t);
    const clear = pl.R + 0.4;
    const end = pl.z - Math.sqrt(Math.max(0, clear * clear - (pl.x - sx) ** 2));
    const plan = resample([{ x: sx, z: 0.8 }, { x: sx, z: end }], 0.2);
    const path = archPath(plan, 0, LEVEL.lowerCeil - 0.02, 0.5);
    rib(ctx, "entryHall", path, 0.42, 0.4, sx < 0 ? "Arch to the Arrival Lounge" : "Arch to the Game Room", "under");
    archVines(ctx, path, rng(sx < 0 ? 17 : 29));
  }

  // ------------------------------------------------ portal arch and gable sign
  const pw = 1.95;
  const portal: Vector3[] = [new Vector3(-pw, 0, frontZ(-pw) - 0.2), new Vector3(-pw, 1.7, frontZ(-pw) - 0.2)];
  const springY = doorH - 0.15;
  for (let i = 0; i <= 32; i++) {
    const th = Math.PI - (i / 32) * Math.PI;
    const x = pw * Math.cos(th);
    portal.push(new Vector3(x, springY + 1.1 * Math.sin(th), frontZ(x) - 0.2));
  }
  portal.push(new Vector3(pw, 1.7, frontZ(pw) - 0.2), new Vector3(pw, 0, frontZ(pw) - 0.2));
  rib(ctx, "entryHall", portal, 0.3, 0.32, "Entrance portal", "under");

  const sign = gableSignCanvas("CHIMPHOUSE");
  const boardTex = toTexture(ctx.scene, "chimphouseSignBoard", sign.board, { wrap: false, hasAlpha: true });
  const glyphTex = toTexture(ctx.scene, "chimphouseSignGlyphs", sign.glyphs, { wrap: false, hasAlpha: true });
  ctx.mats.decal("signBoard", boardTex, { rough: 0.6, alphaTest: true });
  ctx.mats.unlit("signGlyphs", { tex: glyphTex, alphaTest: true, intensity: 1.4 });
  ctx.mats.glowing.add("signGlyphs");
  const sw = 3.7;
  const sh = (sw * 420) / 1024;
  const sz = frontZ(0) - 0.55;
  const sy = doorH + 1.05;
  ctx.g(zH, "signBoard").add(plane(sw, sh), xf(0, sy + sh / 2, sz), "CHIMPHOUSE sign");
  ctx.g(zH, "signGlyphs", { castShadow: false }).add(plane(sw, sh), xf(0, sy + sh / 2, sz - 0.015), "CHIMPHOUSE sign");
  ctx.g(zH, "timberDark").add(box(sw * 0.98, sh * 0.6, 0.12), xf(0, sy + sh * 0.3, sz + 0.08), "CHIMPHOUSE sign");

  // warm wash lights under the eaves (strongest at night)
  for (const [tx, tz, y] of [
    [-13.4, -1.25, LEVEL.lowerCeil - 0.4],
    [-7.2, -1.6, LEVEL.lowerCeil - 0.4],
    [7.2, -1.9, LEVEL.lowerCeil - 0.4],
    [13.4, -2.0, LEVEL.lowerCeil - 0.4],
    [0, -2.0, LEVEL.lowerCeil + 0.4],
  ]) {
    const { x, z: zz } = M(tx, tz);
    ctx.lights.push({ pos: new Vector3(x, y, zz), color: "#ffb260", day: 0.6, night: 7, range: 9, rooms: ["structure", "approach", "entryHall", "arrivalLounge", "gameRoom"], level: "lower" });
  }
  for (const [tx, tz] of [
    [-12.8, -0.75],
    [0, -0.5],
    [12.8, -1.5],
  ]) {
    const { x, z: zz } = M(tx, tz);
    ctx.lights.push({ pos: new Vector3(x, LEVEL.upperCeil - 0.3, zz), color: "#ffb260", day: 0.4, night: 6, range: 9, rooms: ["structure", "gallery", "showroom", "poolTerrace", "roofs"], level: "upper" });
  }

  // mint strip under the gallery void edge, seen from the hall
  const voidRing = ellipseArc(atriumVoid.cx, atriumVoid.cz, atriumVoid.rx + 0.05, atriumVoid.rz + 0.05, 0, Math.PI * 2, 96);
  ledStrip(ctx, zU, at(voidRing, LEVEL.lowerCeil + 0.03), "mint", 0.045);
}

/**
 * Vines trailing from the underside of a hall arch (rib 0.42 deep in its plane),
 * either side of its mint strip, ending well above head height.
 */
function archVines(ctx: WorldCtx, path: Vector3[], r: () => number) {
  const z = zone("entryHall", "lower");
  let acc = 0;
  for (let i = 1; i < path.length - 1; i++) {
    acc += Vector3.Distance(path[i], path[i - 1]);
    if (acc < 0.5) continue;
    acc = 0;
    if (r() > 0.8) continue;
    const t = path[i + 1].subtract(path[i - 1]).normalize();
    // in-plane normal pointing down from the rib's centre line
    let n = new Vector3(0, -t.z, t.y);
    if (n.y > 0) n = n.scale(-1);
    const under = path[i].add(n.scale(0.215));
    if (under.y < 2.9) continue;
    const side = r() > 0.5 ? 1 : -1;
    const top = under.add(new Vector3(side * (0.07 + r() * 0.08), 0, 0));
    const L = Math.min(0.5 + Math.pow(r(), 1.4) * 1.8, top.y - 2.3);
    if (L < 0.35) continue;
    vine(ctx, z, top, L, r, { density: 12 });
    for (let k = 0; k < 2; k++) {
      const a = r() * Math.PI * 2;
      ctx.leaf(z, Leaf.Pothos, leafMatrix(top.add(new Vector3(0, -0.04, (r() - 0.5) * 0.2)), new Vector3(Math.cos(a) * 0.6, -1, Math.sin(a) * 0.6), 0.12, (r() - 0.5) * 1.2));
    }
  }
}
