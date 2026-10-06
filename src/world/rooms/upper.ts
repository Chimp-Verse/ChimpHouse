// Upper level interiors: Gallery, Community Builds Showroom, Theatre,
// Bar & Lounge, Pool Terrace, side-entrance corridor. Positions are relative
// to the room anchors in layout.ts.

import { Matrix, Vector3 } from "@babylonjs/core";
import { P2, ellipseArc, ensureCCW, offsetPath, pointInPolygon, resample, rng, roundedRect } from "../geometry/curves";
import { Geo, at, beam, box, cylinder, lathe, plane, polygonFace, ribbonWall, slab, softBox, sphere, tube, wallStrip, xf } from "../geometry/geo";
import { WorldCtx, Zone, zone } from "../context";
import { BAR, HALL_HALF, LEVEL, POOL, SHOWROOM, SHOWROOM_DOOR, THEATRE, THEATRE_DOOR, TREES, atriumVoid, core, galleryOuter, poolLoop, upperDeckLoop } from "../layout";
import { makeCanvas, toTexture } from "../materials/canvas";
import { gableSignCanvas, letteringCanvas, roomSignCanvas } from "../materials/signs";
import { drumTable, lounger, pouf, rectRug, roundRug, shelfDecor, shelves, sofa, stool } from "../props/furniture";
import { candle } from "../props/decor";
import { sodaCan } from "../props/barware";
import { lanternPost, sconce, wovenPendant } from "../props/lights";
import { alongY, firetruck } from "../props/music";
import { plant, planterAlong, planterBox, pottedPlant, vine } from "../props/plants";
import { canvasMat, monitor, projector, screenMat, screenPanel, speaker } from "../props/tech";
import { theatreCardCanvas } from "../props/theatreScreen";
import { ROLE } from "../roles";
import { downlights, glazing, ledStrip } from "../structure/elements";
import { runs } from "../structure/facades";
import { carveTrunks, trunkSpan } from "../structure/trunks";
import { K, arcDeg, at3, faceToward, faceYaw, interiorArch, panel, roomLight } from "./common";
import { rugs } from "./rugs";
import { buildPool } from "./pool";
import { buildCanopyBar, buildTerraceLounge } from "./bar";

const U = LEVEL.upper;
const UC = LEVEL.upperCeil;
const tree = (id: string) => TREES.find((t) => t.id === id)!;

export function buildUpperRooms(ctx: WorldCtx): void {
  buildGallery(ctx);
  buildShowroom(ctx);
  buildTheatre(ctx);
  buildCanopyBar(ctx);
  buildPoolTerrace(ctx);
  buildSideEntrance(ctx);
}

function sign(ctx: WorldCtx, key: string, text: string, z: Zone, pos: Vector3, w: number, dx: number, dz: number) {
  canvasMat(ctx, key, roomSignCanvas(text, { w: 1024, h: 200, font: "600 92px Montserrat" }), 1.0);
  panel(ctx, z, key, pos, w, (w * 200) / 1024, dx, dz, `Sign: ${text}`, { mat: "timberDark", pad: 0.03, depth: 0.05 });
}

// ------------------------------------------------------------------ gallery

function buildGallery(ctx: WorldCtx) {
  const z = zone("gallery", "upper");
  const r = rng(61);
  const vz = atriumVoid.cz;
  // glazed screen to the pool terrace with a wide opening
  const east = ellipseArc(galleryOuter.cx, galleryOuter.cz, galleryOuter.rx, galleryOuter.rz, -1.25, 1.2, 40);
  const south = east.filter((p) => p.z < vz - 1.4);
  const north = east.filter((p) => p.z > vz + 1.4 && p.x > 3.2);
  glazing(ctx, z, south, U, UC, { label: "Gallery glazing" });
  glazing(ctx, z, north, U, UC, { label: "Gallery glazing" });
  const op = east.filter((p) => p.z >= vz - 1.5 && p.z <= vz + 1.5);
  ctx.g(z, "glulam").add(beam(at(op, UC - 0.4), 0.3, 0.8), undefined, "Opening lintel");
  sign(ctx, "sign:poolbar", "POOL & BAR", z, new Vector3(galleryOuter.rx - 0.1, UC - 0.95, vz), 1.6, -1, 0);
  sign(ctx, "sign:community", "COMMUNITY BUILDS", z, new Vector3(SHOWROOM.x1 + 0.15, U + SHOWROOM_DOOR.h + 0.75, SHOWROOM_DOOR.z), 2.1, 1, 0);
  // a few planters along the railing on the front (south) side only, where no route
  // passes; the north half and the ways to the showroom, the terrace and the landing stay clear
  for (const deg of [212, 238, 302, 328]) {
    const a = (deg * Math.PI) / 180;
    const p = { x: atriumVoid.cx + Math.cos(a) * (atriumVoid.rx + 0.5), z: vz + Math.sin(a) * (atriumVoid.rz + 0.5) };
    const soil = U + planterBox(ctx, z, xf(p.x, U, p.z, faceToward(p.x, p.z, 0, vz)), 1.0, 0.32, 0.42, "timberDark", "Planter");
    const kinds = ["bromeliad", "fern", "calathea", "philodendron", "croton"] as const;
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * 0.3;
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      plant(ctx, z, new Vector3(p.x + tx * off, soil, p.z + tz * off), kinds[Math.floor(r() * kinds.length)], 0.65 + r() * 0.4, r);
    }
  }
  pottedPlant(ctx, z, new Vector3(HALL_HALF - 0.55, U, core.z0 - 0.5), "palm", { pot: "cream", potR: 0.3, potH: 0.5, scale: 1.2, r });

  // roof over the landing between the gallery crown and the stair core (closes the gap to the sky)
  const zr = zone("roofs", "roof");
  const lz0 = galleryOuter.cz + galleryOuter.rz - 0.3;
  const landing = carveTrunks(resample(ensureCCW(roundedRect(core.x0, lz0, core.x1 + 0.3, core.z0 + 0.1, [0, 0, 0, 0])), 0.3, true), UC, LEVEL.roof + 0.1).loop;
  ctx.g(zr, "slats").add(polygonFace(landing, UC - 0.004, false), undefined, "Landing ceiling");
  ctx.g(zr, "charcoal").add(polygonFace(landing, LEVEL.roof + 0.1, true), undefined, "Landing roof");
  downlights(ctx, zr, [{ x: core.x0 + 1.4, z: (lz0 + core.z0) / 2 }, { x: (core.x0 + core.x1) / 2, z: (lz0 + core.z0) / 2 }, { x: core.x1 - 1.0, z: (lz0 + core.z0) / 2 }], UC - 0.004);
}

// ------------------------------------------------------------------ showroom

const SUBMISSIONS = [
  ["sub-bhippi-editor", "sub-gorillatype"],
  ["sub-nova-phone", "sub-subtitles"],
  ["sub-bhippi-games", "sub-fixmap"],
];
const SUB_NAMES: Record<string, string> = {
  "sub-bhippi-editor": "Bhippi AI video editor",
  "sub-gorillatype": "GorillaType",
  "sub-nova-phone": "Nova phone assistant",
  "sub-subtitles": "Subtitle-generation app",
  "sub-bhippi-games": "Bhippi games website",
  "sub-fixmap": "FixMap",
};

function buildShowroom(ctx: WorldCtx) {
  const z = zone("showroom", "upper");
  const r = rng(71);
  const { c, x1, z0, z1 } = SHOWROOM;
  // submissions wall on a straight panel inside the north-west curve, facing the audience
  const sa = (138 * Math.PI) / 180;
  const sr = SHOWROOM.r - 0.75;
  const sp = { x: c.x + Math.cos(sa) * sr, z: c.z + Math.sin(sa) * sr };
  const sYaw = faceToward(sp.x, sp.z, c.x + 1.0, c.z - 0.6);
  const subM = xf(sp.x, U, sp.z, sYaw);
  ctx.g(z, "timberDark").add(box(3.4, 3.0, 0.08), xf(0, 1.6, 0.06).multiply(subM), "Submission wall");
  ctx.g(z, "amberStrip", { castShadow: false }).add(box(3.3, 0.02, 0.02), xf(0, 3.05, -0.05).multiply(subM), "Screen wall light");
  SUBMISSIONS.forEach((row, ri) =>
    row.forEach((id, ci) => {
      screenPanel(ctx, z, xf(-0.76 + ci * 1.52, 2.4 - ri * 0.84, -0.02).multiply(subM), 1.42, 0.77, screenMat(ctx, id, 1.05), { bezel: 0.03, depth: 0.05, label: `Submission: ${SUB_NAMES[id]}` });
    }),
  );
  canvasMat(ctx, "sign:submissions", roomSignCanvas("SUBMISSIONS", { w: 1024, h: 220, font: "600 110px Montserrat" }), 1.0);
  ctx.g(z, "sign:submissions", { castShadow: false }).add(plane(1.2, 0.26), xf(-0.85, 2.98, -0.05).multiply(subM), "Submissions label");
  const letters = letteringCanvas(["COMMUNITY BUILDS", "SHOWROOM"], { w: 1024, h: 512, font: "700 92px Cinzel", color: "#ffe6bd", lineGap: 112, emblem: { color: "#ffe6bd", size: 90, y: 110 }, glow: "rgba(255,190,110,0.85)" });
  canvasMat(ctx, "showroomLettering", letters, 1.5, true);
  ctx.g(z, "showroomLettering", { castShadow: false }).add(plane(1.9, 0.95), xf(0, 3.68, -0.03).multiply(subM), "Community Builds Showroom lettering");
  ctx.g(z, "timberDark").add(box(3.4, 1.3, 0.08), xf(0, 3.75, 0.06).multiply(subM));
  // featured build on the north wall
  const wz = z1 - 0.12;
  const fx = (c.x + x1) / 2 + 0.1;
  screenPanel(ctx, z, xf(fx, U + 2.0, wz - 0.06), 3.0, 1.69, screenMat(ctx, "featured-build", 1.1), { bezel: 0.06, depth: 0.08, label: "Featured build screen (Snoaper’s Targeted Modeling Skill)" });
  ctx.g(z, "amberStrip", { castShadow: false }).add(
    beam([new Vector3(fx - 1.6, U + 1.1, wz - 0.12), new Vector3(fx - 1.6, U + 2.9, wz - 0.12), new Vector3(fx + 1.6, U + 2.9, wz - 0.12), new Vector3(fx + 1.6, U + 1.1, wz - 0.12), new Vector3(fx - 1.6, U + 1.1, wz - 0.12)], 0.03, 0.03),
    undefined,
    "Screen light",
  );
  canvasMat(ctx, "sign:featured", roomSignCanvas("FEATURED BUILD", { w: 1024, h: 200, font: "700 104px Montserrat", color: "#ffe3a8", bg: "#2a1f17" }), 1.2);
  panel(ctx, z, "sign:featured", new Vector3(fx, U + 3.15, wz - 0.1), 1.7, 0.33, 0, -1, "Featured Build sign", { mat: "timberDark", pad: 0.04, depth: 0.05 });
  // display plinth with the firetruck, in front of the featured screen
  const px = fx - 0.7;
  const pz = z1 - 2.1 * Math.sqrt(K);
  ctx.g(z, "panelHoney").add(lathe([[1.0, 0], [1.0, 0.42], [0.001, 0.42]], 40, false, false, 7), xf(px, U, pz), "Display plinth");
  ctx.g(z, "amberStrip", { castShadow: false }).add(lathe([[1.01, 0.38], [1.01, 0.4]], 40), xf(px, U, pz));
  firetruck(ctx, z, xf(px, U + 0.43, pz - 0.05, faceYaw(0.5, -1) + Math.PI / 2), 0.9);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const rr = 0.7 + r() * 0.22;
    plant(ctx, z, new Vector3(px + Math.cos(a) * rr, U + 0.42, pz + Math.sin(a) * rr), r() > 0.5 ? "fern" : "bromeliad", 0.3, r);
  }
  // host desk: a straight counter left of the featured screen, in front of the north wall,
  // the presenter behind it facing the sofas across the rug
  const hd = { x: fx - 2.7, z: z1 - 1.2 };
  hostDesk(ctx, z, xf(hd.x, U, hd.z, faceToward(hd.x, hd.z, c.x + 0.6 * K, c.z - 0.4 * K)), r);
  wovenPendant(ctx, z, new Vector3(hd.x, UC, hd.z + 0.1), 0.24, 1.3, { shape: "teardrop" });
  showroomEntrance(ctx, z);
  // audience seating facing the featured screen and host
  const ac = { x: px - 0.3, z: pz - 0.2 };
  roundRug(ctx, z, new Vector3(c.x + 0.6 * K, U + 0.012, c.z - 0.4 * K), 2.2 * K, rugs.loungeJute(ctx));
  sofa(ctx, z, arcDeg(ac.x, ac.z, 4.3 * K, 205, 248, 16), { mat: "teal", r, pillows: ["mustard", "rust", "coral"], label: "Audience sofa", y: U });
  sofa(ctx, z, arcDeg(ac.x, ac.z, 4.3 * K, 256, 280, 10), { mat: "teal", r, pillows: ["mustard", "rust"], label: "Audience sofa", y: U });
  drumTable(ctx, z, new Vector3(c.x + 0.2 * K, U, c.z + 0.2 * K), 0.42, 0.42);
  drumTable(ctx, z, new Vector3(c.x + 1.6 * K, U, c.z - 1.0 * K), 0.4, 0.4);
  pouf(ctx, z, new Vector3(c.x + 1.8 * K, U, c.z + 0.9 * K), 0.42, 0.42, "rust");
  pouf(ctx, z, new Vector3(x1 - 2.6, U, z0 + 3.0), 0.34, 0.38, "tealBright");
  for (const [dx, dz, rr] of [
    [0.6, -0.2, 0.32],
    [2.4, 1.8, 0.26],
    [-1.4, -1.8, 0.28],
  ] as [number, number, number][])
    wovenPendant(ctx, z, new Vector3(c.x + dx, UC, c.z + dz), rr, 1.1);
  // arch along the gallery side, landing short of the trunk at the north-east corner
  const wt = trunkSpan(TREES.find((t) => t.id === "treeWestCentral")!, U, UC);
  interiorArch(ctx, "showroom", "upper", { x: x1 - 0.3, z: z0 + 0.6 }, { x: x1 - 0.3, z: Math.min(z1 - 0.4, wt.z - Math.sqrt(Math.max(0, (wt.R + 0.45) ** 2 - (x1 - 0.3 - wt.x) ** 2))) }, U, UC - U - 0.05, 0.4);
  for (const a of [175, 205, 235])
    pottedPlant(ctx, z, new Vector3(c.x + Math.cos((a * Math.PI) / 180) * (SHOWROOM.r - 0.4), U, c.z + Math.sin((a * Math.PI) / 180) * (SHOWROOM.r - 0.4)), "mixed", { pot: "cream", potR: 0.2, potH: 0.35, scale: 1.1, r });
  pottedPlant(ctx, z, new Vector3(wt.x - wt.R - 0.35, U, wt.z - 0.4), "monstera", { pot: "cream", potR: 0.28, potH: 0.5, scale: 1.2, r });
  pottedPlant(ctx, z, new Vector3(x1 - 0.45, U, z0 + 1.0), "palm", { pot: "cream", potR: 0.26, potH: 0.45, scale: 1.1, r });
  roomLight(ctx, "showroom", "upper", new Vector3(c.x + 1.0, U + 3.4, c.z), 4, 15, 11);
  roomLight(ctx, "showroom", "upper", new Vector3(px, U + 2.2, pz - 1.0), 1.5, 5, 6);
  void shelves;
  void shelfDecor;
}

/**
 * Straight presenter's counter, fluted front toward the audience at -Z: a
 * monitor and laptop facing the presenter, a broadcast mic on a desk boom arm,
 * a mug and a plant, and a high stool behind. Base at m.
 */
function hostDesk(ctx: WorldCtx, z: Zone, m: Matrix, r: () => number) {
  const L = 1.9;
  const D = 0.65;
  const H = 0.98;
  const body = new Geo();
  body.add(box(L, H - 0.05, 0.05), xf(0, (H - 0.05) / 2, -D / 2 + 0.025));
  for (const s of [-1, 1]) body.add(box(0.05, H - 0.05, D), xf(s * (L / 2 - 0.025), (H - 0.05) / 2, 0));
  body.add(box(L - 0.1, 0.03, D - 0.1), xf(0, 0.35, 0.02));
  ctx.g(z, "panelHoney").add(body, m, "Host desk");
  ctx.g(z, "timber").add(box(L + 0.06, 0.05, D + 0.08), xf(0, H - 0.025, 0.02).multiply(m), "Host desk");
  ctx.g(z, "amberStrip", { castShadow: false }).add(box(L - 0.04, 0.014, 0.02), xf(0, H - 0.065, -D / 2 - 0.01).multiply(m), "Desk light");
  ctx.g(z, "amberStrip", { castShadow: false }).add(box(L - 0.04, 0.014, 0.02), xf(0, 0.04, -D / 2 - 0.01).multiply(m), "Desk light");
  // monitor at the right-hand end and an open laptop, both facing the presenter at +Z
  monitor(ctx, z, xf(0.6, H, 0.0, Math.PI).multiply(m), 0.56, 0.34, screenMat(ctx, "featured-build"), "Host monitor");
  const lm = xf(-0.05, H, 0.08, Math.PI).multiply(m);
  ctx.g(z, "steel").add(box(0.34, 0.014, 0.24), xf(0, 0.007, 0).multiply(lm), "Laptop");
  ctx.g(z, "steel").add(box(0.34, 0.22, 0.012), xf(0, 0.11, 0.12, 0, 1, 1, 1, -0.28).multiply(lm), "Laptop");
  ctx.g(z, screenMat(ctx, "sub-fixmap", 0.95), { castShadow: false }).add(plane(0.3, 0.19), xf(0, 0.11, 0.113, 0, 1, 1, 1, -0.28).multiply(lm), "Laptop");
  ctx.g(z, "black").add(box(0.24, 0.012, 0.17), xf(0.25, H + 0.006, 0.2, 0.3).multiply(m), "Tablet");
  ctx.g(z, "cream", { castShadow: false }).add(cylinder(0.04, 0.1, 12), xf(-0.75, H, 0.1).multiply(m), "Mug");
  pottedPlant(ctx, z, Vector3.TransformCoordinates(new Vector3(-0.78, H, -0.17), m), "calathea", { pot: "terracotta", potR: 0.08, potH: 0.12, scale: 0.38, r });
  // broadcast mic on a boom arm clamped to the back edge, reaching to the presenter
  const P = (x: number, y: number, zz: number) => Vector3.TransformCoordinates(new Vector3(x, y, zz), m);
  const clamp = P(-0.55, H, D / 2 + 0.02);
  const elbow = P(-0.5, H + 0.38, D / 2 - 0.05);
  const head = P(-0.22, H + 0.44, D / 2 + 0.12);
  const mouth = P(-0.05, H + 0.48, D / 2 + 0.55);
  const arm = new Geo();
  arm.add(box(0.05, 0.08, 0.06), xf(clamp.x, clamp.y - 0.02, clamp.z));
  arm.add(tube([clamp, elbow], 0.012, 8));
  arm.add(tube([elbow, head], 0.011, 8));
  ctx.g(z, "black").add(arm, undefined, "Boom arm");
  const mm = alongY(head, mouth.subtract(head));
  ctx.g(z, "black").add(lathe([[0.001, -0.02], [0.03, -0.02], [0.034, 0.08], [0.034, 0.16], [0.001, 0.17]], 16), mm, "Broadcast mic");
  ctx.g(z, "charcoal").add(cylinder(0.036, 0.06, 16), xf(0, 0.12, 0).multiply(mm), "Broadcast mic");
  stool(ctx, z, P(0.0, 0, 0.75), 0.76, "tealBright", "Presenter stool");
}

/**
 * Entrance on the showroom's east glazing, facing the gallery: a glulam portal,
 * a slatted panel above it carrying the COMMUNITY BUILDS sign, glazed double
 * doors standing open into the room, lanterns on the jambs.
 */
function showroomEntrance(ctx: WorldCtx, z: Zone) {
  const { z: dz, w, h } = SHOWROOM_DOOR;
  const x = SHOWROOM.x1;
  const e0 = dz - w / 2;
  const e1 = dz + w / 2;
  const portal = new Geo();
  for (const ez of [e0 - 0.11, e1 + 0.11]) portal.add(box(0.3, h + 0.22, 0.22), xf(x, U + (h + 0.22) / 2, ez));
  portal.add(box(0.3, 0.22, w + 0.44), xf(x, U + h + 0.11, dz));
  ctx.g(z, "glulam").add(portal, undefined, "Showroom entrance");
  ctx.g(z, "panelHoney").add(box(0.18, UC - (U + h + 0.22), w + 0.44), xf(x, (U + h + 0.22 + UC) / 2, dz), "Showroom entrance");
  ctx.g(z, "timberDark").add(box(0.3, 0.02, w), xf(x, U + 0.01, dz), "Threshold");
  ledStrip(ctx, z, [new Vector3(x + 0.16, U + h - 0.02, e0 + 0.02), new Vector3(x + 0.16, U + h - 0.02, e1 - 0.02)], "amberStrip", 0.025);
  // glazed doors hinged at the jambs, standing open into the showroom
  const lw = w / 2 - 0.02;
  const open = (100 * Math.PI) / 180;
  for (const [hz, sz] of [
    [e0 + 0.01, 1],
    [e1 - 0.01, -1],
  ] as [number, number][]) {
    const dir = { x: -Math.sin(open), z: sz * Math.cos(open) };
    const dm = xf(x - 0.05, U, hz, Math.atan2(-dir.z, dir.x));
    const leaf = new Geo();
    leaf.add(box(0.07, h - 0.03, 0.05), xf(0.035, (h - 0.03) / 2, 0));
    leaf.add(box(0.07, h - 0.03, 0.05), xf(lw - 0.035, (h - 0.03) / 2, 0));
    leaf.add(box(lw, 0.16, 0.05), xf(lw / 2, 0.08, 0));
    leaf.add(box(lw, 0.09, 0.05), xf(lw / 2, h - 0.075, 0));
    ctx.g(z, "timberDark").add(leaf, dm, "Showroom door");
    ctx.g(z, "glass", { castShadow: false, pickable: false }).add(box(lw - 0.14, h - 0.28, 0.012), xf(lw / 2, 0.16 + (h - 0.28) / 2, 0).multiply(dm));
    for (const s of [-1, 1]) ctx.g(z, "brass").add(box(0.025, 0.6, 0.025), xf(lw - 0.12, 1.05, s * 0.06).multiply(dm), "Door handle");
  }
  for (const ez of [e0 - 0.11, e1 + 0.11]) sconce(ctx, zone("gallery", "upper"), new Vector3(x + 0.24, U + 2.0, ez), faceYaw(1, 0));
  ctx.lights.push({ pos: new Vector3(x + 1.2, U + 3.0, dz), color: "#ffb766", day: 1.5, night: 6, range: 6, rooms: ["showroom", "gallery"], level: "upper" });
}

/**
 * Where a corridor wall along z = zLine, running from fromX in direction dirX,
 * first stands clear of a room's walls, so its glass butts against the room
 * rather than running through the wall.
 */
function clearOfRoom(loop: P2[], zLine: number, fromX: number, dirX: number): number {
  const dist = (p: P2) => {
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
  };
  for (let k = 0; k < 400; k++) {
    const p = { x: fromX + dirX * k * 0.02, z: zLine };
    if (!pointInPolygon(p, loop) && dist(p) > 0.2) return p.x;
  }
  return fromX;
}

// ------------------------------------------------------------------ theatre

/**
 * Theatre: screen on the east wall inside a glulam proscenium with curtains,
 * two gently curved rows of sofas well back from the screen (the rear row on
 * a raised curved platform), a cross-arch behind the seating, and a snack
 * counter along the curved glazing at the back.
 */
/** The theatre screen's and lightbox's picture until engine/theatre.ts takes them over: the idle card. */
function theatreIdleMat(ctx: WorldCtx): string {
  return canvasMat(ctx, "screen:theatre-idle", theatreCardCanvas({ kind: "idle" }), 1.05);
}

function buildTheatre(ctx: WorldCtx) {
  const z = zone("theatre", "upper");
  const r = rng(81);
  const { c, x0, x1, z0 } = THEATRE;
  const wx = x1 - 0.1; // screen wall face
  const cz = c.z;

  // ---- screen wall: slats, screen with warm backlight, proscenium, curtains.
  // The room's north-east corner is rounded, so at the wall it reaches only 2.4 m north of
  // the seats' centre line (4.7 m south). Everything stays centred on the seats: the screen
  // stands a little off the slats, and the proscenium frame, curtains and speakers stand
  // forward of the wall, where the room is wide enough for them on both sides.
  const [slat0, slat1] = zSpanAt(THEATRE.loop, wx);
  ctx.g(z, "panelHoney").add(box(0.1, UC - U, slat1 - slat0 - 0.06), xf(wx + 0.05, U + (UC - U) / 2, (slat0 + slat1) / 2), "Screen wall (timber slats)");
  const sw = 5.0;
  const sh = 2.81;
  const sy = U + 2.75;
  const sx = wx - 0.2; // screen plane
  // the screen is found by its role: engine/theatre.ts shows the chosen video there
  screenPanel(ctx, z, xf(sx, sy, cz, faceYaw(-1, 0)), sw, sh, theatreIdleMat(ctx), { bezel: 0.07, depth: 0.08, label: "Theatre screen", role: ROLE.theatreScreen });
  const glow = [
    [cz - sw / 2 - 0.12, sy - sh / 2 - 0.12],
    [cz - sw / 2 - 0.12, sy + sh / 2 + 0.12],
    [cz + sw / 2 + 0.12, sy + sh / 2 + 0.12],
    [cz + sw / 2 + 0.12, sy - sh / 2 - 0.12],
  ].map(([zz, y]) => new Vector3(sx + 0.03, y, zz));
  ledStrip(ctx, z, [...glow, glow[0]], "amberStrip", 0.025, new Vector3(1, 0, 0));
  // proscenium: a glulam frame of pilasters and head standing forward of the wall, with
  // mint strips on its inner faces; the curtains hang just behind it, the speakers in front
  const px = wx - 0.85; // frame centre plane (0.3 m deep)
  const pz = 3.4; // pilaster centres from the centre line
  const pro = ctx.g(z, "glulam");
  pro.setLabel("Screen proscenium");
  for (const s of [-1, 1]) {
    pro.add(box(0.3, UC - U, 0.32), xf(px, U + (UC - U) / 2, cz + s * pz));
    ledStrip(ctx, z, [new Vector3(px - 0.12, U + 0.05, cz + s * (pz - 0.17)), new Vector3(px - 0.12, UC - 0.45, cz + s * (pz - 0.17))], "mint", 0.035, new Vector3(1, 0, 0));
  }
  pro.add(box(0.32, 0.4, pz * 2 + 0.32), xf(px, UC - 0.2, cz), "Screen proscenium");
  ledStrip(ctx, z, [new Vector3(px - 0.17, UC - 0.42, cz - pz + 0.1), new Vector3(px - 0.17, UC - 0.42, cz + pz - 0.1)], "mint", 0.035);
  if (!ctx.mats.has("velvet")) ctx.mats.pbr("velvet", { color: "#7a261b", tex: ctx.mats.textures.fabric, rough: 0.95 });
  for (const s of [-1, 1]) curtain(ctx, z, wx - 0.6, cz + s * 2.62, cz + s * 3.2, U + 0.02, UC - 0.4);
  for (const s of [-1, 1]) speaker(ctx, z, xf(wx - 0.95, U, cz + s * 2.85, faceYaw(-1, 0)), 0.44, 1.8, 0.42);
  // media console with under-glow, centre speaker, small plants and lanterns
  ctx.g(z, "panelHoney").add(box(0.5, 0.48, 5.2), xf(wx - 0.35, U + 0.24, cz), "Media console");
  ctx.g(z, "timber").add(box(0.54, 0.04, 5.24), xf(wx - 0.35, U + 0.5, cz), "Media console");
  ledStrip(ctx, z, [new Vector3(wx - 0.62, U + 0.04, cz - 2.55), new Vector3(wx - 0.62, U + 0.04, cz + 2.55)], "amberStrip", 0.025);
  ctx.g(z, "black").add(box(0.3, 0.1, 0.42), xf(wx - 0.4, U + 0.57, cz - 0.9), "AV receiver");
  ctx.g(z, "black").add(box(0.3, 0.08, 0.36), xf(wx - 0.4, U + 0.56, cz + 0.9), "Game console");
  // the two remotes' spots on the console top, beside the receiver and the game console: a
  // remote's holder controls the screen (engine/remotes.ts), and stands a metre in front to take it
  for (const [n, s] of [[1, -1], [2, 1]])
    ctx.slot(z, ROLE.theatreRemoteSpot, n, xf(wx - 0.45, U + 0.52, cz + s * 1.25, faceYaw(-1, 0)), new Vector3(0, -0.52, -1.0), `Remote spot ${n}`);
  ctx.g(z, "black").add(box(0.3, 0.16, 0.9), xf(wx - 0.4, U + 0.6, cz), "Centre speaker");
  ctx.g(z, "black").add(box(0.45, 0.45, 0.45), xf(wx - 0.95, U + 0.225, cz + 2.2), "Subwoofer");
  for (const s of [-1, 1]) {
    pottedPlant(ctx, z, new Vector3(wx - 0.38, U + 0.52, cz + s * 2.2), "fern", { pot: "terracotta", potR: 0.12, potH: 0.18, scale: 0.55, r });
    candle(ctx, z, new Vector3(wx - 0.4, U + 0.52, cz + s * 1.6));
  }

  // ---- seating: two curved rows centred on a point behind the screen
  const S = { x: wx + 3.0, z: cz };
  const arc = (R: number, a0: number, a1: number) => arcDeg(S.x, S.z, R, 180 - a0, 180 - a1, 28);
  const toDeg = (v: number) => (v * 180) / Math.PI;
  const pt = (R: number, deg: number) => arcDeg(S.x, S.z, R, 180 - deg, 180 - deg, 1)[0];
  const row = (R: number, half: number, y: number, label: string, pillows: string[]) => {
    const th = toDeg(Math.asin(half / R));
    const g = toDeg(Math.asin(0.36 / R)); // gap for the side table between the two sofas
    sofa(ctx, z, arc(R, th, g), { mat: "teal", r, pillows, label, y });
    sofa(ctx, z, arc(R, -g, -th), { mat: "teal", r, pillows, label, y });
    // side tables: one between the sofas, one at each end
    for (const deg of [0, th + toDeg(Math.asin(0.5 / R)), -th - toDeg(Math.asin(0.5 / R))]) {
      const p = pt(R + 0.1, deg);
      const top = y + 0.52;
      if (deg === 0) {
        // between the sofas: a wider table with popcorn and two sodas
        drumTable(ctx, z, new Vector3(p.x, y, p.z), 0.3, 0.52, { label: "Side table" });
        popcorn(ctx, z, new Vector3(p.x + 0.07, top, p.z));
        sodaCan(ctx, z, new Vector3(p.x - 0.13, top, p.z - 0.12), r);
        sodaCan(ctx, z, new Vector3(p.x - 0.13, top, p.z + 0.12), r);
      } else {
        drumTable(ctx, z, new Vector3(p.x, y, p.z), 0.24, 0.52, { label: "Side table" });
        sodaCan(ctx, z, new Vector3(p.x - 0.06, top, p.z - 0.06), r);
        sodaCan(ctx, z, new Vector3(p.x + 0.07, top, p.z + 0.05), r);
      }
    }
    return th;
  };
  // front row ~4.7 m from the screen
  const Rf = S.x - (wx - 4.7);
  const thF = row(Rf, 2.95, U, "Front row sofa", ["mustard", "rust", "mustard", "coral"]);
  rectRug(ctx, z, new Vector3(wx - 3.9, U, cz), 3.6, 7.2, 0, rugs.knit(ctx), "Chunky knit rug");
  for (const deg of [-9, 9]) {
    const p = pt(Rf - 1.1, deg);
    pouf(ctx, z, new Vector3(p.x, U, p.z), 0.38, 0.4, "mustard", "Mustard ottoman");
  }
  throwBlanket(ctx, z, S, Rf, thF, U, "juteTeal");

  // rear row on a raised curved platform behind a 0.9 m aisle
  const ry = 0.38;
  const R1 = Rf + 0.48 + 0.9; // platform front edge
  const R2 = R1 + 2.0;
  const phi = toDeg(Math.asin(3.6 / R1));
  const plat = ensureCCW([...arc(R1, phi, -phi), ...arc(R2, -phi, phi)]);
  ctx.g(z, "deck").add(slab(plat, U, U + ry), undefined, "Raised rear row platform");
  ledStrip(ctx, z, at(arc(R1 - 0.01, phi - 0.4, -phi + 0.4), U + ry - 0.04), "amberStrip", 0.025);
  const Rr = R1 + 1.05;
  const thR = row(Rr, 3.15, U + ry, "Rear row sofa", ["mustard", "coral", "mustard", "rust"]);
  throwBlanket(ctx, z, S, Rr, -thR, U + ry, "sage");
  // a step at each end of the platform
  for (const s of [-1, 1]) {
    const Rm = (R1 + R2) / 2;
    const p = pt(Rm, s * (phi + toDeg(Math.asin(0.24 / Rm))));
    const u = { x: p.x - S.x, z: p.z - S.z };
    ctx.g(z, "deck").add(box(1.1, ry / 2, 0.42), xf(p.x, U + ry / 4, p.z, -Math.atan2(u.z, u.x)), "Platform step");
  }
  projector(ctx, z, new Vector3((wx - 4.7 + S.x - R1) / 2, UC, cz), faceYaw(1, 0));

  // ---- cross-arch behind the seating, clear of the curved glazing
  const xa = S.x - R2 - 0.6;
  const halfAt = (x: number) => Math.sqrt(Math.max(0, THEATRE.r * THEATRE.r - (x - c.x) * (x - c.x)));
  const foot = Math.min(halfAt(xa - 0.25), halfAt(xa + 0.25)) - 0.65;
  interiorArch(ctx, "theatre", "upper", { x: xa, z: cz - foot }, { x: xa, z: cz + foot }, U, UC - U - 0.05, 0.4);
  // ceiling light lines belong with the ceiling (hidden with the roofs)
  for (const dz of [-2.0, 2.0]) ledStrip(ctx, zone("roofs", "roof"), [new Vector3(xa + 0.5, UC - 0.02, cz + dz), new Vector3(wx - 0.5, UC - 0.02, cz + dz)], "amberStrip", 0.03);

  // ---- planted alcove at the back, framed by the arch (snacks are in the corridor, by the doors)
  backPlanter(ctx, z, r);

  // ---- south wall: fabric acoustic panels, sconces, aisle lights from the doors
  // the wall is straight and solid from where the rounded west end starts (c.x) to the door lining
  const wallW = THEATRE_DOOR.x - THEATRE_DOOR.w / 2 - 0.22 - (c.x + 0.1) - 0.15;
  const pw = Math.min(0.95, (wallW - 2 * 0.32) / 3);
  const panelXs = [0, 1, 2].map((i) => c.x + 0.1 + pw / 2 + 0.03 + i * (pw + 0.32));
  panelXs.forEach((x, i) => {
    ctx.g(z, "glulam").add(box(pw + 0.06, 2.46, 0.06), xf(x, U + 1.95, z0 + 0.03), "Acoustic panel frame");
    ctx.g(z, i % 2 ? "rust" : "tealDeep").add(softBox(pw - 0.04, 2.36, 0.08, 0.03, 0.01), xf(x, U + 1.95, z0 + 0.07), "Acoustic panel");
    if (i < panelXs.length - 1) sconce(ctx, z, new Vector3(x + (pw + 0.32) / 2, U + 2.3, z0 + 0.2), faceYaw(0, 1));
  });
  for (let x = THEATRE_DOOR.x - THEATRE_DOOR.w / 2 - 0.3; x > S.x - R2; x -= 1.0) {
    ctx.g(z, "bulb", { castShadow: false }).add(cylinder(0.045, 0.012, 12), xf(x, U + 0.012, z0 + 0.35), "Aisle light");
  }

  // ---- roller shades lowered over the upper part of the glazing
  for (const run of runs(THEATRE.loop, (p) => (p.x > x1 - 0.35 ? "wall" : p.z < z0 + 0.45 && p.x > c.x - 0.3 ? "wall" : "glass"))) {
    if (run.kind !== "glass") continue;
    const inner = offsetPath(run.path, -0.12);
    const shade = ctx.g(z, "darkPanel", { castShadow: false });
    shade.add(ribbonWall([...inner].reverse(), U + 2.65, UC - 0.15), undefined, "Charcoal roller shade");
    shade.add(ribbonWall(inner, U + 2.65, UC - 0.15));
    ctx.g(z, "charcoal").add(beam(at(inner, UC - 0.12), 0.1, 0.1), undefined, "Shade roller");
    ctx.g(z, "charcoal").add(beam(at(inner, U + 2.62), 0.03, 0.04));
  }

  // ---- pendants, plants
  // either side of the screen, clear of the rounded north-east glazing
  for (const s of [-1, 1]) wovenPendant(ctx, z, new Vector3(x1 - 1.4, UC, cz + s * 3.8), 0.24, 1.4);
  for (const deg of [132, 228]) {
    const p = arcDeg(c.x, c.z, THEATRE.r - 0.55, deg, deg, 1)[0];
    pottedPlant(ctx, z, new Vector3(p.x, U, p.z), deg < 180 ? "monstera" : "palm", { pot: "cream", potR: 0.28, potH: 0.5, scale: 1.3, r });
  }

  theatreEntrance(ctx);
  concessionStand(ctx, r);
  roomLight(ctx, "theatre", "upper", new Vector3(S.x - Rf - 1.5, U + 3.6, cz), 2.2, 8, 11);
  roomLight(ctx, "theatre", "upper", new Vector3(wx - 1.2, U + 1.5, cz), 1.2, 4, 6, "#c8d8ff");
  roomLight(ctx, "theatre", "upper", new Vector3(x0 + 1.8, U + 2.4, cz), 1.5, 5, 6);
}

/** The z range a closed plan outline covers along the line at x. */
function zSpanAt(loop: P2[], x: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
    const zz = a.z + ((x - a.x) / (b.x - a.x)) * (b.z - a.z);
    lo = Math.min(lo, zz);
    hi = Math.max(hi, zz);
  }
  return [lo, hi];
}

/** Gathered stage curtain hanging in the plane x = x, between z = za and z = zb. */
function curtain(ctx: WorldCtx, z: Zone, x: number, za: number, zb: number, y0: number, y1: number) {
  const g = new Geo();
  const n = 48;
  const rows: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const zz = za + (zb - za) * t;
    const fold = Math.sin(t * Math.PI * 9) * 0.07;
    rows.push([g.vert(x + fold, y0, zz, t * 3, 0), g.vert(x + fold * 0.6, y1, zz, t * 3, (y1 - y0) / 0.8)]);
  }
  for (let i = 0; i < n; i++) g.quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
  g.computeNormals();
  ctx.g(z, "velvet").add(g, undefined, "Stage curtain");
  ctx.g(z, "velvet").add(new Geo().add(g).flip(), undefined, "Stage curtain");
}

/** Knit throw draped over the sofa arm at angle `deg` (degrees) on an arc of radius R around S. */
function throwBlanket(ctx: WorldCtx, z: Zone, S: { x: number; z: number }, R: number, deg: number, y: number, mat: string) {
  const a = ((180 - deg) * Math.PI) / 180;
  const p = { x: S.x + Math.cos(a) * R, z: S.z + Math.sin(a) * R };
  const t = { x: -Math.sin(a), z: Math.cos(a) }; // along the row
  const out = deg > 0 ? -1 : 1; // the arm's outer side along t
  const yaw = -Math.atan2(t.z, t.x);
  const m = xf(p.x, y, p.z, yaw);
  const g = new Geo();
  g.add(softBox(0.34, 0.04, 0.7, 0.015, 0.01), xf(0, 0.64, 0.05));
  g.add(softBox(0.04, 0.48, 0.62, 0.015, 0.01), xf(out * 0.15, 0.4, 0.05));
  ctx.g(z, mat).add(g, m, "Throw blanket");
}

/** Soda can: metallic coloured body, silver lid and ring-pull. */

/** Curved planter of tropical plants along the back glazing, behind the rear row. */
function backPlanter(ctx: WorldCtx, z: Zone, r: () => number) {
  const { c } = THEATRE;
  const R = THEATRE.r - 0.6;
  const path = arcDeg(c.x, c.z, R, 208, 152, 28);
  const soil = U + planterAlong(ctx, z, path, U, 0.52, 0.45, "timberDark", "Back planter");
  ledStrip(ctx, z, at(offsetPath(path, -0.27), U + 0.04), "amberStrip", 0.02);
  const kinds = ["monstera", "banana", "philodendron", "bromeliad", "palm", "calathea", "croton"] as const;
  for (let deg = 156; deg <= 204; deg += 6) {
    const p = arcDeg(c.x, c.z, R, deg, deg, 1)[0];
    plant(ctx, z, new Vector3(p.x, soil, p.z), kinds[Math.floor(r() * kinds.length)], 0.9 + r() * 0.8, r);
  }
  for (const deg of [172, 188]) {
    const p = arcDeg(c.x, c.z, R - 1.0, deg, deg, 1)[0];
    wovenPendant(ctx, z, new Vector3(p.x, UC, p.z), 0.26, 1.3, { shape: "teardrop" });
  }
}

/**
 * Concession stand in the corridor opposite the theatre doors, against the
 * showroom's north wall: popcorn machine, drinks fridge, candy jars, menu board.
 */
function concessionStand(ctx: WorldCtx, r: () => number) {
  const z = zone("sideEntrance", "upper");
  const zw = SHOWROOM.z1 + 0.18; // corridor face of the showroom wall
  const xc = THEATRE_DOOR.x - 1.7;
  const L = 3.0;
  const d = 0.6;
  const zc = zw + d / 2;
  const top = U + 0.98;
  ctx.g(z, "panelHoney").add(box(L, 0.95, d), xf(xc, U + 0.475, zc), "Snack bar");
  ctx.g(z, "counterTop").add(box(L + 0.06, 0.05, d + 0.08), xf(xc, U + 0.975, zc + 0.03), "Snack bar");
  ledStrip(ctx, z, [new Vector3(xc - L / 2, U + 0.9, zw + d + 0.08), new Vector3(xc + L / 2, U + 0.9, zw + d + 0.08)], "amberStrip", 0.02);
  // popcorn machine, facing the theatre doors
  const m = xf(xc - 0.55, top, zc, faceYaw(0, 1));
  ctx.g(z, "red").add(box(0.56, 0.14, 0.42), xf(0, 0.07, 0).multiply(m), "Popcorn machine");
  ctx.g(z, "red").add(box(0.6, 0.12, 0.46), xf(0, 0.78, 0).multiply(m), "Popcorn machine");
  for (const sx of [-0.27, 0.27]) for (const sz of [-0.19, 0.19]) ctx.g(z, "brass").add(box(0.03, 0.58, 0.03), xf(sx, 0.43, sz).multiply(m));
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(box(0.52, 0.56, 0.38), xf(0, 0.43, 0).multiply(m), "Popcorn machine");
  if (!ctx.mats.has("popcorn")) ctx.mats.pbr("popcorn", { color: "#f4e2b0", rough: 0.8 });
  ctx.g(z, "popcorn", { castShadow: false }).add(sphere(0.24, 12, 8, 0.4), xf(0, 0.18, 0).multiply(m), "Popcorn");
  ctx.g(z, "steel").add(cylinder(0.08, 0.1, 12), xf(0, 0.6, 0).multiply(m), "Popcorn kettle");
  ctx.g(z, "bulb", { castShadow: false }).add(sphere(0.04, 8, 6), xf(0, 0.7, 0).multiply(m));
  canvasMat(ctx, "sign:popcorn", roomSignCanvas("POPCORN", { w: 512, h: 128, font: "800 80px Nunito", color: "#ffe9a8", bg: "#b8231b", border: "#ffd36b" }), 1.3);
  ctx.g(z, "sign:popcorn", { castShadow: false }).add(plane(0.5, 0.125), xf(0, 0.92, -0.017).multiply(m), "Popcorn sign");
  ctx.g(z, "red").add(box(0.52, 0.15, 0.03), xf(0, 0.92, 0.005).multiply(m));
  // popcorn tubs, candy jars and sodas along the counter
  for (let k = 0; k < 4; k++) ctx.g(z, k % 2 ? "cream" : "red", { castShadow: false }).add(cylinder(0.05, 0.16, 10, true, 0.06), xf(xc - 1.2 + k * 0.12, top, zc + 0.12), "Popcorn tubs");
  const sweets = ["mustard", "rust", "tealBright"];
  sweets.forEach((mat, i) => {
    const x = xc + 0.2 + i * 0.24;
    ctx.g(z, "glass", { castShadow: false, pickable: false }).add(cylinder(0.09, 0.26, 14, false), xf(x, top, zc - 0.05), "Candy jar");
    ctx.g(z, "brass").add(cylinder(0.092, 0.03, 14), xf(x, top + 0.26, zc - 0.05));
    for (let k = 0; k < 9; k++) ctx.g(z, mat, { castShadow: false }).add(sphere(0.03, 6, 4), xf(x + (r() - 0.5) * 0.1, top + 0.03 + Math.floor(k / 3) * 0.05, zc - 0.05 + (r() - 0.5) * 0.1));
  });
  for (let k = 0; k < 5; k++) sodaCan(ctx, z, new Vector3(xc + 0.95 + (k % 3) * 0.09, top, zc + 0.08 - Math.floor(k / 3) * 0.1), r);
  // glass-door drinks fridge at the east end: steel shell, lit back panel, shelves of cans
  const fx = xc + L / 2 + 0.38;
  const fh = 1.9;
  const shell = ctx.g(z, "steel");
  shell.setLabel("Drinks fridge");
  shell.add(box(0.04, fh, d), xf(fx - 0.31, U + fh / 2, zc));
  shell.add(box(0.04, fh, d), xf(fx + 0.31, U + fh / 2, zc));
  shell.add(box(0.66, 0.08, d), xf(fx, U + 0.04, zc));
  shell.add(box(0.66, 0.2, d), xf(fx, U + fh - 0.1, zc));
  shell.add(box(0.66, fh, 0.04), xf(fx, U + fh / 2, zw + 0.02));
  ctx.g(z, "white", { castShadow: false }).add(box(0.58, fh - 0.3, 0.01), xf(fx, U + 0.08 + (fh - 0.3) / 2, zw + 0.045), "Drinks fridge");
  for (let row = 0; row < 4; row++) {
    const y = U + 0.12 + row * 0.38;
    ctx.g(z, "chrome", { castShadow: false }).add(box(0.58, 0.015, d - 0.1), xf(fx, y, zc - 0.02));
    for (let k = 0; k < 4; k++) sodaCan(ctx, z, new Vector3(fx - 0.2 + k * 0.13, y + 0.008, zc + 0.04 - (k % 2) * 0.12), r);
  }
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(box(0.6, fh - 0.3, 0.02), xf(fx, U + 0.08 + (fh - 0.3) / 2, zw + d - 0.01), "Drinks fridge door");
  ctx.g(z, "charcoal").add(box(0.03, 0.6, 0.04), xf(fx - 0.24, U + 1.0, zw + d + 0.02), "Fridge handle");
  canvasMat(ctx, "sign:coldDrinks", roomSignCanvas("COLD DRINKS", { w: 512, h: 96, font: "800 58px Nunito", color: "#e8fbff", bg: "#1a6f8a", border: "#9be7ff" }), 1.2);
  ctx.g(z, "sign:coldDrinks", { castShadow: false }).add(plane(0.6, 0.11), xf(fx, U + fh - 0.1, zw + d + 0.003, Math.PI), "Cold drinks sign");
  ctx.lights.push({ pos: new Vector3(fx, U + 1.0, zc), color: "#eaf6ff", day: 0.6, night: 2.5, range: 2.5, rooms: ["sideEntrance"], level: "upper" });
  // menu board and shelves on the wall above
  const menu = makeCanvas(1024, 512);
  const mc = menu.ctx;
  mc.fillStyle = "#1d1712";
  mc.fillRect(0, 0, 1024, 512);
  mc.strokeStyle = "#c9a36a";
  mc.lineWidth = 10;
  mc.strokeRect(14, 14, 996, 484);
  mc.fillStyle = "#ffe3a8";
  mc.font = "800 92px Nunito";
  mc.textAlign = "center";
  mc.fillText("SNACK BAR", 512, 120);
  mc.font = "600 54px Montserrat";
  mc.textAlign = "left";
  const items: [string, string][] = [["Popcorn", "3 bananas"], ["Soda", "2 bananas"], ["Candy scoop", "1 banana"], ["Movie night combo", "5 bananas"]];
  items.forEach(([name, price], i) => {
    mc.fillStyle = "#f4e6cc";
    mc.fillText(name, 80, 220 + i * 70);
    mc.fillStyle = "#7ff0c4";
    mc.textAlign = "right";
    mc.fillText(price, 944, 220 + i * 70);
    mc.textAlign = "left";
  });
  canvasMat(ctx, "sign:snackMenu", menu.canvas, 1.15);
  ctx.g(z, "glulam").add(box(2.0, 1.06, 0.06), xf(xc - 0.2, U + 2.45, zw + 0.03), "Snack menu");
  ctx.g(z, "sign:snackMenu", { castShadow: false }).add(plane(1.9, 0.95), xf(xc - 0.2, U + 2.45, zw + 0.065, Math.PI), "Snack menu");
  wovenPendant(ctx, z, new Vector3(xc - 0.7, UC, zc + 0.3), 0.24, 1.6, { shape: "teardrop" });
  wovenPendant(ctx, z, new Vector3(xc + 0.7, UC, zc + 0.3), 0.24, 1.6, { shape: "teardrop" });
  ctx.lights.push({ pos: new Vector3(xc, U + 2.6, zc + 1.0), color: "#ffb766", day: 1.5, night: 6, range: 6, rooms: ["sideEntrance"], level: "upper" });
}

/**
 * Theatre entrance off the corridor: a glulam-lined opening in the south wall
 * (cut in facades.ts), double doors standing open into the theatre, the sign
 * above on the corridor side, and lanterns either side.
 */
function theatreEntrance(ctx: WorldCtx) {
  const z = zone("theatre", "upper");
  const { x: dx, w, h } = THEATRE_DOOR;
  const zw = THEATRE.z0; // inner face of the south wall
  const zo = zw - 0.18; // outer (corridor) face
  const zc = (zw + zo) / 2;
  const e0 = dx - w / 2;
  const e1 = dx + w / 2;
  // wall above the opening, slats outside and dark acoustic panel inside
  ctx.g(z, "panelHoney").add(box(w + 0.5, UC - (U + h), 0.18), xf(dx, (U + h + UC) / 2, zc), "Theatre entrance wall");
  ctx.g(z, "panelDark").add(box(w + 0.5, UC - (U + h), 0.012), xf(dx, (U + h + UC) / 2, zw + 0.007));
  // glulam lining: jambs and head, slightly proud of both faces
  const lining = ctx.g(z, "glulam");
  lining.setLabel("Theatre doorway");
  const depth = 0.18 + 0.1;
  lining.add(box(0.22, h + 0.22, depth), xf(e0 - 0.11, U + (h + 0.22) / 2, zc));
  lining.add(box(0.22, h + 0.22, depth), xf(e1 + 0.11, U + (h + 0.22) / 2, zc));
  lining.add(box(w + 0.44, 0.22, depth), xf(dx, U + h + 0.11, zc));
  ledStrip(ctx, z, [new Vector3(e0 + 0.02, U + h - 0.03, zo - 0.03), new Vector3(e1 - 0.02, U + h - 0.03, zo - 0.03)], "amberStrip", 0.025);
  ctx.g(z, "timberDark").add(box(w, 0.02, depth), xf(dx, U + 0.01, zc), "Threshold");
  // double doors standing open into the theatre
  const lw = w / 2 - 0.02;
  const leaf = (sign: 1 | -1) => {
    const g = new Geo();
    g.add(box(lw, h - 0.03, 0.05), xf((sign * lw) / 2, (h - 0.03) / 2, 0));
    for (const side of [-1, 1]) g.add(box(0.03, 0.9, 0.03), xf(sign * (lw - 0.12), 1.05, side * 0.05));
    return g;
  };
  const open = (100 * Math.PI) / 180;
  ctx.g(z, "timberDark").add(leaf(1), xf(e0 + 0.02, U, zw - 0.02, -open), "Theatre door");
  ctx.g(z, "timberDark").add(leaf(-1), xf(e1 - 0.02, U, zw - 0.02, open), "Theatre door");
  // sign over the doors and lanterns either side, on the corridor face
  sign(ctx, "sign:theatre", "THEATRE", z, new Vector3(dx, U + h + 0.75, zo - 0.06), 1.8, 0, -1);
  sconce(ctx, z, new Vector3(e0 - 0.55, U + 2.1, zo - 0.2), faceYaw(0, -1));
  sconce(ctx, z, new Vector3(e1 + 0.5, U + 2.1, zo - 0.2), faceYaw(0, -1));
  ctx.lights.push({ pos: new Vector3(dx, U + 3.0, zo - 1.4), color: "#ffb766", day: 2, night: 7, range: 7, rooms: ["theatre", "sideEntrance", "core"], level: "upper" });
  // "Now Showing" lightbox on the corridor wall west of the doors
  const px = e0 - 1.55;
  const pw = 1.1;
  const ph = pw * (9 / 16);
  ctx.g(z, "glulam").add(box(pw + 0.12, ph + 0.4, 0.08), xf(px, U + 1.75, zo - 0.04), "Now Showing lightbox");
  // the picture shows what's on the theatre screen (engine/theatre.ts finds it by its role)
  ctx.screen(z, ROLE.theatreLightbox, xf(px, U + 1.65, zo - 0.085), pw, ph, theatreIdleMat(ctx), "Now Showing picture");
  canvasMat(ctx, "sign:nowShowing", roomSignCanvas("NOW SHOWING", { w: 1024, h: 160, font: "700 84px Montserrat", color: "#ffe3a8", bg: "#1d1712", border: "#c9a36a" }), 1.2);
  ctx.g(z, "sign:nowShowing", { castShadow: false }).add(plane(pw, pw * (160 / 1024)), xf(px, U + 1.65 + ph / 2 + 0.11, zo - 0.085), "Now Showing lightbox");
}

function popcorn(ctx: WorldCtx, z: Zone, p: Vector3) {
  if (!ctx.mats.has("popcorn")) ctx.mats.pbr("popcorn", { color: "#f4e2b0", rough: 0.8 });
  ctx.g(z, "timber").add(lathe([[0.001, 0], [0.09, 0.01], [0.15, 0.08]], 16), xf(p.x, p.y, p.z), "Popcorn bowl");
  ctx.g(z, "popcorn", { castShadow: false }).add(sphere(0.13, 10, 6, 0.35), xf(p.x, p.y + 0.07, p.z), "Popcorn");
}

// ------------------------------------------------------------------ bar & lounge

// ------------------------------------------------------------------ pool terrace

function buildPoolTerrace(ctx: WorldCtx) {
  const z = zone("poolTerrace", "upper");
  const r = rng(101);
  const pool = buildPool(ctx);
  const { pc, minX, maxX, maxZ } = pool;
  buildTerraceLounge(ctx, pool);

  // sun loungers in two pairs along the north side, feet toward the pool and the view
  const rowZ = maxZ + POOL.wall + 1.35 + 1.0;
  const x0 = pc.x - 0.6;
  const towels = ["tealBright", "coral", undefined, "mustard"];
  [x0, x0 + 1.15, x0 + 3.25, x0 + 4.4].forEach((x, i) => lounger(ctx, z, new Vector3(x, U, rowZ), 0, { towel: towels[i] }));
  for (const x of [x0 + 0.575, x0 + 3.825]) {
    drumTable(ctx, z, new Vector3(x, U, rowZ + 0.3), 0.2, 0.42, { label: "Side table" });
    sodaCan(ctx, z, new Vector3(x - 0.06, U + 0.42, rowZ + 0.26), r);
    sodaCan(ctx, z, new Vector3(x + 0.07, U + 0.42, rowZ + 0.36), r);
  }
  pottedPlant(ctx, z, new Vector3(x0 + 2.2, U, rowZ + 0.4), "palm", { pot: "cream", potR: 0.3, potH: 0.5, scale: 1.3, r });

  // planters around the terrace
  for (const [x, zz, k] of [
    [maxX - 0.4, rowZ + 1.0, "palm"],
    [maxX - 1.0, rowZ + 3.8, "banana"],
    [pc.x - 2.4, rowZ + 1.4, "monstera"],
    [minX - 1.0, pc.z + 0.8, "cordyline"],
  ] as [number, number, "palm" | "banana" | "monstera" | "cordyline"][])
    pottedPlant(ctx, z, new Vector3(x, U, zz), k, { pot: "cream", potR: 0.32, potH: 0.55, scale: 1.4, r });

  // shade sail between the bar canopy, the sail tree and a post
  const st = tree("treeEast");
  const A = new Vector3(BAR.c.x + 1.2, UC + 0.1, BAR.z1 - 1.4);
  const B = new Vector3(st.x - 0.4, U + 5.0, st.z - 0.2);
  const P = new Vector3(maxX - 1.2, U + 4.0, maxZ + 5.2);
  ctx.g(z, "charcoal").add(cylinder(0.09, P.y - U + 0.4, 10), xf(P.x, U, P.z), "Shade sail post");
  ctx.g(z, "rope").add(beam([P.add(new Vector3(0, 0.35, 0)), new Vector3(P.x + 1.4, U, P.z - 1.0)], 0.015, 0.015), undefined, "Guy line");
  const sail = new Geo();
  const N = 14;
  const idx: number[][] = [];
  for (let i = 0; i <= N; i++) {
    const row: number[] = [];
    for (let j = 0; j <= N - i; j++) {
      const u = i / N;
      const v = j / N;
      const w = 1 - u - v;
      const p = A.scale(w).add(B.scale(u)).add(P.scale(v));
      const sag = 0.9 * 27 * u * v * w;
      row.push(sail.vert(p.x, p.y - sag, p.z, u, v));
    }
    idx.push(row);
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N - i; j++) {
      sail.tri(idx[i][j], idx[i + 1][j], idx[i][j + 1]);
      if (j < N - i - 1) sail.tri(idx[i + 1][j], idx[i + 1][j + 1], idx[i][j + 1]);
    }
  sail.computeNormals();
  ctx.g(z, "canvas").add(sail, undefined, "Cream shade sail");
  ctx.g(z, "canvas").add(new Geo().add(sail).flip(), undefined, "Cream shade sail");
  // lanterns: at the two pool corners where the coping meets the infinity edge, and by the loungers
  const spots: P2[] = [{ x: 5.5, z: 0.3 }, { x: x0 - 0.9, z: rowZ + 0.3 }];
  for (const c of pool.corners) {
    const d = Math.hypot(c.x - pc.x, c.z - pc.z) || 1;
    spots.push({ x: c.x + ((c.x - pc.x) / d) * 0.25 + 0.0, z: c.z + ((c.z - pc.z) / d) * 0.25 + 0.7 });
  }
  for (const p of spots) if (pointInPolygon(p, upperDeckLoop) && !pointInPolygon(p, offsetPath(poolLoop, POOL.wall + 0.2, true))) lanternPost(ctx, z, new Vector3(p.x, U, p.z), 0.7, { addLight: true, lightRange: 6 });
}

// ------------------------------------------------------------------ side entrance + corridor

function buildSideEntrance(ctx: WorldCtx) {
  const z = zone("sideEntrance", "upper");
  const r = rng(111);
  const cz0 = SHOWROOM.z1;
  const cz1 = THEATRE.z0;
  const ex = SHOWROOM.x0 + 0.3;
  const mid = (cz0 + cz1) / 2;
  const corridor: P2[] = [
    { x: ex, z: cz0 },
    { x: core.x0, z: cz0 },
    { x: core.x0, z: cz1 },
    { x: ex, z: cz1 },
  ];
  ctx.g(z, "floor").add(polygonFace([...corridor].reverse(), U + 0.012, true), undefined, "Corridor floor");
  // glazed corridor walls where the curved pavilions fall away
  // each glass wall stops where it meets the curved room wall beside it
  glazing(ctx, z, [{ x: ex, z: cz0 }, { x: clearOfRoom(SHOWROOM.loop, cz0, SHOWROOM.c.x, -1), z: cz0 }], U, UC, { label: "Corridor glazing" });
  glazing(ctx, z, [{ x: clearOfRoom(THEATRE.loop, cz1, THEATRE.c.x, -1), z: cz1 }, { x: ex, z: cz1 }], U, UC, { label: "Corridor glazing" });
  // notched where the west central trunk rises past the corridor's east end
  const roof: P2[] = carveTrunks(
    resample(
      [
        { x: ex - 1.9, z: cz0 - 0.25 },
        { x: core.x0, z: cz0 - 0.25 },
        { x: core.x0, z: cz1 + 0.25 },
        { x: ex - 1.9, z: cz1 + 0.25 },
      ],
      0.3,
      true,
    ),
    UC,
    LEVEL.roof - 0.2,
  ).loop;
  const zr = zone("roofs", "roof");
  ctx.g(zr, "charcoal").add(polygonFace([...roof].reverse(), LEVEL.roof - 0.2, true), undefined, "Corridor roof");
  ctx.g(zr, "slats").add(polygonFace(roof, UC, false), undefined, "Corridor ceiling");
  // fascia facing outward all round (the outline runs counter-clockwise)
  ctx.g(zr, "glulam").add(wallStrip(ensureCCW(roof), UC, LEVEL.roof - 0.2, true), undefined, "Corridor fascia");
  // glazed side entrance: fixed lights either side, open doors in the middle, transom above
  glazing(ctx, z, [{ x: ex, z: cz0 }, { x: ex, z: mid - 0.8 }], U, UC, { label: "Side entrance glazing" });
  glazing(ctx, z, [{ x: ex, z: mid + 0.8 }, { x: ex, z: cz1 }], U, UC, { label: "Side entrance glazing" });
  glazing(ctx, z, [{ x: ex, z: mid - 0.8 }, { x: ex, z: mid + 0.8 }], U + 2.6, UC, { label: "Side entrance glazing" });
  for (const s of [-1, 1]) {
    const hz = mid + s * 0.8;
    const m = xf(ex, U, hz, s * 1.2);
    ctx.g(z, "charcoal").add(new Geo().add(box(0.05, 2.55, 0.05), xf(0, 1.28, -s * 0.0)).add(box(0.05, 2.55, 0.05), xf(0, 1.28, -s * 0.78)).add(box(0.05, 0.06, 0.8), xf(0, 2.52, -s * 0.39)).add(box(0.05, 0.06, 0.8), xf(0, 0.04, -s * 0.39)), m, "Side entrance door");
    ctx.g(z, "glass", { castShadow: false, pickable: false }).add(box(0.012, 2.45, 0.74), xf(0, 1.28, -s * 0.39).multiply(m));
  }
  // timber porch roof with the gabled sign
  const px = ex - 1.8;
  // timber deck with its edges facing outward, a glulam band round its three open sides and a dark cap
  const canopy = ensureCCW([{ x: px, z: cz0 - 0.2 }, { x: ex, z: cz0 - 0.2 }, { x: ex, z: cz1 + 0.2 }, { x: px, z: cz1 + 0.2 }]);
  ctx.g(z, "timber").add(slab(canopy, UC - 0.9, UC - 0.7), undefined, "Entrance canopy");
  const band = [{ x: ex, z: cz1 + 0.22 }, { x: px - 0.02, z: cz1 + 0.22 }, { x: px - 0.02, z: cz0 - 0.22 }, { x: ex, z: cz0 - 0.22 }];
  ctx.g(z, "glulam").add(wallStrip(band, UC - 0.92, UC - 0.68), undefined, "Entrance canopy");
  ctx.g(z, "charcoal").add(slab(ensureCCW([{ x: px - 0.04, z: cz0 - 0.24 }, { x: ex, z: cz0 - 0.24 }, { x: ex, z: cz1 + 0.24 }, { x: px - 0.04, z: cz1 + 0.24 }]), UC - 0.68, UC - 0.65), undefined, "Entrance canopy");
  ledStrip(ctx, z, [new Vector3(px + 0.02, UC - 0.93, cz0 - 0.1), new Vector3(px + 0.02, UC - 0.93, cz1 + 0.1)], "amberStrip", 0.025);
  for (const zz of [cz0 - 0.1, cz1 + 0.1]) ctx.g(z, "glulam").add(box(0.22, UC - 0.9 - U, 0.22), xf(px + 0.15, U + (UC - 0.9 - U) / 2, zz), "Canopy post");
  const sign = gableSignCanvas("CHIMPHOUSE");
  if (!ctx.mats.has("sideSignBoard")) {
    ctx.mats.decal("sideSignBoard", toTexture(ctx.scene, "sideSignBoard", sign.board, { wrap: false, hasAlpha: true }), { rough: 0.6, alphaTest: true });
    ctx.mats.unlit("sideSignGlyphs", { tex: toTexture(ctx.scene, "sideSignGlyphs", sign.glyphs, { wrap: false, hasAlpha: true }), alphaTest: true, intensity: 1.4 });
    ctx.mats.glowing.add("sideSignGlyphs");
  }
  const sw = 2.4;
  const sh = (sw * 420) / 1024;
  ctx.g(z, "sideSignBoard").add(plane(sw, sh), at3(px - 0.07, UC - 0.66 + sh / 2, mid, -1, 0), "CHIMPHOUSE sign (side entrance)");
  ctx.g(z, "sideSignGlyphs", { castShadow: false }).add(plane(sw, sh), at3(px - 0.09, UC - 0.66 + sh / 2, mid, -1, 0), "CHIMPHOUSE sign (side entrance)");
  sconce(ctx, z, new Vector3(ex - 0.12, U + 2.2, mid - 1.0), faceYaw(-1, 0));
  sconce(ctx, z, new Vector3(ex - 0.12, U + 2.2, mid + 1.0), faceYaw(-1, 0));
  for (let i = 0; i < 5; i++) vine(ctx, z, new Vector3(px, UC - 0.75, cz0 + i * 0.6), 0.6 + r() * 1.8, r);
  roomLight(ctx, "sideEntrance", "upper", new Vector3((ex + core.x0) / 2, U + 3.2, mid), 2, 8, 9, "#ffb766", ["showroom", "theatre"]);
}
