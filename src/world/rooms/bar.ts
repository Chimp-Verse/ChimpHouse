// Canopy Bar & Lounge (upper level, rear-right) and the pool terrace around it.
// The bar runs along a solid stretch of the north wall: a back bar of
// cupboards and glass-door fridges under three lit niches and the CANOPY BAR
// sign, and a counter built on the same plan with a bartender's aisle behind
// it, curving back to the wall at the east end. Lounges, high tables and
// hanging egg chairs fill the canopy. Out on the terrace: a fire-pit lounge
// under festoon lights, a bench wrapped round the terrace trunk, a drinks
// ledge along the east railing, a cabana daybed, a towel trolley and floats
// in the pool.

import { Matrix, Vector3 } from "@babylonjs/core";
import { P2, offsetPath, pointInPolygon, resample, rng } from "../geometry/curves";
import { Geo, at, beam, box, cylinder, lathe, softBox, sphere, sweep, torus, tube, xf } from "../geometry/geo";
import { WorldCtx, Zone, zone } from "../context";
import { BAR, CABANA, CANOPY_BAR, LEVEL, POOL, RAIL_BAR, TREES, poolLoop, upperDeckLoop } from "../layout";
import { letteringCanvas } from "../materials/signs";
import { barNiche, bottle, ensureBarMats, eggChair, espressoMachine, jar, ledAlong, menuStand, offsetPlan, slattedSideTable, tapTower } from "../props/barware";
import { candle, floorPlanter, fruitBowl, hangingPlanter } from "../props/decor";
import { armchair, drumTable, pouf, roundRug, sofa, stool } from "../props/furniture";
import { wovenPendant } from "../props/lights";
import { Rand, pottedPlant, vine } from "../props/plants";
import { canvasMat } from "../props/tech";
import { trunkSpan } from "../structure/trunks";
import { arcDeg, faceToward, panel, roomLight } from "./common";
import type { PoolInfo } from "./pool";
import { rugs } from "./rugs";

const U = LEVEL.upper;
/** Underside of the bar canopy. */
const CEIL = LEVEL.upperCeil - 0.2;

/** World position of a point given in an object's local frame. */
const pt = (m: Matrix, x: number, y: number, z: number) => Vector3.TransformCoordinates(new Vector3(x, y, z), m);

function ensureMats(ctx: WorldCtx) {
  ensureBarMats(ctx);
  const add = (key: string, o: Parameters<typeof ctx.mats.pbr>[1]) => {
    if (!ctx.mats.has(key)) ctx.mats.pbr(key, o);
  };
  add("cocktailPink", { color: "#ff5f8a", rough: 0.1, emissive: "#ff3f6a", emissiveIntensity: 0.25 });
  add("cocktailBlue", { color: "#27c3d6", rough: 0.1, emissive: "#14a8c0", emissiveIntensity: 0.25 });
  add("coconut", { color: "#5a3a22", rough: 0.9 });
  add("coconutFlesh", { color: "#f4efe2", rough: 0.6 });
  add("lime", { color: "#6fbf3a", rough: 0.5 });
  add("pineapple", { color: "#d9a53a", rough: 0.8 });
  add("pineLeaf", { color: "#3f7a32", rough: 0.7 });
  add("floatPink", { color: "#ff8fb1", rough: 0.35, clearCoat: 0.6 });
  add("floatYellow", { color: "#f7d046", rough: 0.35, clearCoat: 0.6 });
  add("floatBrown", { color: "#6b4a2f", rough: 0.5 });
  add("floatDough", { color: "#e8b46e", rough: 0.35, clearCoat: 0.6 });
  add("lavaRock", { color: "#2a2624", rough: 0.95 });
  add("towelCream", { color: "#efe6d2", rough: 0.95 });
  add("towelTeal", { color: "#2f8f88", rough: 0.95 });
  add("towelCoral", { color: "#e9735f", rough: 0.95 });
  if (!ctx.mats.has("flame")) ctx.mats.unlit("flame", { color: "#ff9a3a", intensity: 2.2 });
  if (!ctx.mats.has("flameCore")) ctx.mats.unlit("flameCore", { color: "#ffe2a0", intensity: 2.6 });
}

// ------------------------------------------------------------------ bar & lounge

export function buildCanopyBar(ctx: WorldCtx): void {
  const z = zone("barLounge", "upper");
  const r = rng(91);
  ensureMats(ctx);
  const { c, x0, z0, z1 } = BAR;
  const { x0: bx0, x1: bx1 } = CANOPY_BAR;
  const backZ = z1 - 0.02;
  const depth = 0.6;
  const front = backZ - depth;
  const bm = (bx0 + bx1) / 2;

  // ---------------------------------------------------------------- back bar
  backBar(ctx, z, bx0, bx1, front, depth, r);
  // three lit niches on the solid wall, the CANOPY BAR sign above the middle one
  const gap = 0.12;
  const nw = (bx1 - bx0 - 2 * gap) / 3;
  for (let i = 0; i < 3; i++) barNiche(ctx, z, bx0 + nw / 2 + i * (nw + gap), z1, nw, r, i, { floor: U, y0: 1.3, h: 1.75 });
  const lettering = letteringCanvas(["CANOPY BAR"], { w: 1024, h: 400, font: "600 132px Montserrat", color: "#ffe3b0", emblem: { color: "#7ff0c4", size: 105, y: 115 }, glow: "rgba(255,190,110,0.9)" });
  canvasMat(ctx, "canopyBarSign", lettering, 1.6, true);
  ctx.mats.glowing.add("canopyBarSign");
  ctx.g(z, "darkPanel").add(box(3.2, 1.3, 0.05), xf(bm, U + 3.75, z1 - 0.025), "CANOPY BAR sign");
  panel(ctx, z, "canopyBarSign", new Vector3(bm, U + 3.75, z1 - 0.055), 3.0, 1.17, 0, -1, "CANOPY BAR sign");
  for (const dy of [-0.66, 0.66]) ctx.g(z, "amberStrip", { castShadow: false }).add(box(3.1, 0.014, 0.02), xf(bm, U + 3.75 + dy, z1 - 0.06), "Sign light");
  // trailing plants along the top of the niches
  for (let i = 0; i < 9; i++) vine(ctx, z, new Vector3(bx0 + 0.3 + (i * (bx1 - bx0 - 0.6)) / 8, U + 3.07, z1 - 0.14), 0.4 + r() * 0.9, r, { leaf: 0.08, density: 14 });

  // ---------------------------------------------------------------- counter
  // the plan runs from the wall at the east end, round the curve and west along the
  // front, so the sweep's +lateral side is the bartender's side throughout
  const rr = 0.85;
  const xe = bx1 - 0.2;
  const xs = bx0 + 0.9;
  const cz = front - 0.9 - 0.6;
  const plan: P2[] = [{ x: xe + rr, z: backZ - 0.01 }, { x: xe + rr, z: cz + rr }];
  for (let i = 1; i <= 12; i++) {
    const a = -(i / 12) * (Math.PI / 2);
    plan.push({ x: xe + Math.cos(a) * rr, z: cz + rr + Math.sin(a) * rr });
  }
  plan.push({ x: xs, z: cz });
  const path = at(resample(plan, 0.1), U);
  const sec = (l0: number, l1: number, y0: number, y1: number): [number, number][] => [
    [l1, y0],
    [l1, y1],
    [l0, y1],
    [l0, y0],
  ];
  ctx.g(z, "panelHoney").add(sweep(sec(-0.3, 0.15, 0, 1.02), path, { caps: true }), undefined, "Bar counter");
  ctx.g(z, "counterTop").add(sweep(sec(-0.46, 0.22, 1.02, 1.08), path, { caps: true }), undefined, "Bar counter");
  ctx.g(z, "timberDark").add(sweep(sec(0.15, 0.6, 0, 0.86), path, { caps: true }), undefined, "Bar work shelf");
  ctx.g(z, "counterTop").add(sweep(sec(0.15, 0.62, 0.86, 0.9), path, { caps: true }), undefined, "Bar work shelf");
  ctx.g(z, "black").add(sweep(sec(-0.31, -0.26, 0, 0.1), path, { caps: true }), undefined, "Bar counter");
  ledAlong(ctx, z, plan, -0.42, U + 0.995, "amberStrip", "Bar light");
  ledAlong(ctx, z, plan, -0.32, U + 0.12, "mint", "Bar light");
  const railPlan = offsetPlan(plan.slice(1), -0.52);
  ctx.g(z, "brass").add(tube(at(resample(railPlan, 0.1), U + 0.22), 0.025, 10, true), undefined, "Foot rail");
  const brackets = new Geo();
  for (const p of resample(railPlan, 0.9)) brackets.add(box(0.03, 0.22, 0.03), xf(p.x, U + 0.11, p.z));
  ctx.g(z, "brass").add(brackets, undefined, "Foot rail");

  // on the counter: taps, menus, coconut drinks and cocktails, a pineapple, limes, candles
  const top = U + 1.08;
  const tx = (xs + xe) / 2 + 0.3;
  tapTower(ctx, z, xf(tx, top, cz + 0.05));
  for (const x of [xs + 0.6, xe - 0.5]) menuStand(ctx, z, xf(x, top, cz - 0.18, 0.15));
  const drinks: [number, number, number][] = [
    [xs + 1.0, -0.2, 0],
    [xs + 1.12, -0.12, 1],
    [tx - 1.1, -0.22, 2],
    [tx + 0.85, -0.2, 1],
    [tx + 1.0, -0.12, 0],
    [xe - 1.0, -0.2, 2],
  ];
  for (const [x, dz, k] of drinks) cocktail(ctx, z, new Vector3(x, top, cz + dz), k, r);
  pineapple(ctx, z, new Vector3(tx - 0.55, top, cz + 0.08));
  ctx.g(z, "timber").add(lathe([[0.001, 0], [0.09, 0.01], [0.13, 0.06]], 18), xf(xs + 1.6, top, cz + 0.05), "Bowl of limes");
  for (let i = 0; i < 5; i++) ctx.g(z, "lime", { castShadow: false }).add(sphere(0.032, 10, 8), xf(xs + 1.6 + Math.cos(i * 1.3) * 0.05, top + 0.05 + (i > 3 ? 0.03 : 0), cz + 0.05 + Math.sin(i * 1.3) * 0.05));
  for (const x of [xs + 2.3, xe - 1.6]) candle(ctx, z, new Vector3(x, top, cz - 0.08));
  // bartender's side: sink, ice well, glass racks, shaker, cutting board, speed rail
  const wz = cz + 0.38;
  const wy = U + 0.9;
  ctx.g(z, "steel").add(box(0.45, 0.01, 0.34), xf(tx - 0.3, wy + 0.005, wz), "Bar sink");
  ctx.g(z, "chrome").add(beam([new Vector3(tx - 0.3, wy, wz + 0.2), new Vector3(tx - 0.3, wy + 0.28, wz + 0.2), new Vector3(tx - 0.3, wy + 0.28, wz + 0.06)], 0.02, 0.02), undefined, "Bar tap");
  ctx.g(z, "steel").add(box(0.6, 0.012, 0.34), xf(tx + 0.5, wy + 0.006, wz), "Ice well");
  ctx.g(z, "white", { castShadow: false }).add(box(0.56, 0.01, 0.3), xf(tx + 0.5, wy + 0.012, wz), "Ice");
  ctx.g(z, "timber").add(box(0.36, 0.025, 0.24), xf(xs + 0.9, wy + 0.0125, wz), "Cutting board");
  for (let i = 0; i < 3; i++) ctx.g(z, "lime", { castShadow: false }).add(sphere(0.03, 10, 8), xf(xs + 0.82 + i * 0.07, wy + 0.05, wz + (i % 2) * 0.05), "Limes");
  for (let i = 0; i < 8; i++) ctx.g(z, "glass", { castShadow: false, pickable: false }).add(cylinder(0.035, 0.12, 10, false), xf(xe - 1.2 + (i % 4) * 0.09, wy, wz - 0.05 + Math.floor(i / 4) * 0.09), "Glass rack");
  ctx.g(z, "chrome").add(lathe([[0.001, 0], [0.04, 0], [0.045, 0.16], [0.03, 0.2], [0.012, 0.24], [0.001, 0.24]], 14), xf(tx + 1.1, wy, wz + 0.05), "Cocktail shaker");
  const mats = ["bottleAmber", "bottleGreen", "bottleClear"];
  for (let i = 0; i < 7; i++) bottle(ctx, z, xf(tx - 1.3 + i * 0.09, wy, cz + 0.55), mats[i % 3], 0.28, "Bottles");

  // stools along the front and at the curve
  const n = Math.floor((xe - xs - 0.35) / 0.65) + 1;
  for (let i = 0; i < n; i++) stool(ctx, z, new Vector3(xs + 0.35 + (i * (xe - xs - 0.35)) / Math.max(1, n - 1), U, cz - 0.86), 0.78, "tealBright", "Bar stool");
  const sa = -Math.PI / 4;
  stool(ctx, z, new Vector3(xe + Math.cos(sa) * (rr + 0.86), U, cz + rr + Math.sin(sa) * (rr + 0.86)), 0.78, "tealBright", "Bar stool");
  for (let i = 0; i < 4; i++) wovenPendant(ctx, z, new Vector3(xs + 0.5 + (i * (xe - xs - 1.0)) / 3, CEIL, cz - 0.05), 0.24, 2.0, { shape: "teardrop" });
  floorPlanter(ctx, z, new Vector3(bx0 - 0.5, U, z1 - 0.55), "palm", "potCream", r);
  floorPlanter(ctx, z, new Vector3(xe + rr + 1.25, U, z1 - 0.85), "monstera", "potCharcoal", r);

  // ---------------------------------------------------------------- lounge by the gallery side
  const s1 = { x: x0 + 4.4 * 1.375, z: z0 + 1.65 };
  roundRug(ctx, z, new Vector3(s1.x + 0.35, U, s1.z), 1.95, rugs.smallJute(ctx));
  sofa(ctx, z, arcDeg(s1.x, s1.z, 1.9, 118, 242, 22), { mat: "teal", r, pillows: ["coral", "mustard", "rust", "tealBright"], label: "Lounge sofa", y: U });
  drumTable(ctx, z, new Vector3(s1.x + 0.2, U, s1.z + 0.35), 0.45, 0.42);
  drumTable(ctx, z, new Vector3(s1.x + 0.45, U, s1.z - 0.65), 0.34, 0.46);
  fruitBowl(ctx, z, new Vector3(s1.x + 0.15, U + 0.42, s1.z + 0.45), r);
  for (const [dx, dz, k] of [
    [0.4, 0.15, 0],
    [0.35, -0.55, 2],
    [0.55, -0.75, 1],
  ] as [number, number, number][])
    cocktail(ctx, z, new Vector3(s1.x + dx, U + (dz < 0 ? 0.46 : 0.42), s1.z + dz), k, r);
  candle(ctx, z, new Vector3(s1.x + 0.0, U + 0.42, s1.z + 0.15));
  pouf(ctx, z, new Vector3(s1.x + 1.55, U, s1.z + 0.8), 0.34, 0.4, "juteCream", "Woven pouf");
  pouf(ctx, z, new Vector3(s1.x + 1.6, U, s1.z - 0.75), 0.36, 0.38, "juteTeal", "Woven pouf");

  // ---------------------------------------------------------------- lounge in the middle, facing the terrace
  const s2 = { x: c.x - 1.3, z: z0 + 4.1 };
  roundRug(ctx, z, new Vector3(s2.x, U, s2.z - 0.3), 2.3, rugs.loungeJute(ctx));
  sofa(ctx, z, arcDeg(s2.x, s2.z, 1.75, 28, 152, 24), { mat: "tealDeep", r, pillows: ["mustard", "coral", "rust", "mustard"], label: "Lounge sofa", y: U });
  pouf(ctx, z, new Vector3(s2.x, U, s2.z - 0.15), 0.55, 0.4, "mustard", "Mustard ottoman");
  ctx.g(z, "timber").add(box(0.5, 0.03, 0.34), xf(s2.x, U + 0.415, s2.z - 0.15, 0.3), "Serving tray");
  for (const [dx, dz, k] of [
    [-0.12, -0.2, 0],
    [0.1, -0.08, 1],
  ] as [number, number, number][])
    cocktail(ctx, z, new Vector3(s2.x + dx, U + 0.43, s2.z + dz), k, r);
  for (const a of [242, 298]) {
    const p = arcDeg(s2.x, s2.z, 1.95, a, a, 1)[0];
    armchair(ctx, z, new Vector3(p.x, U, p.z), faceToward(p.x, p.z, s2.x, s2.z), a < 270 ? "rust" : "sage", "mustard");
  }
  for (const s of [-1, 1]) {
    const p = arcDeg(s2.x, s2.z, 2.15, 90 + s * 75, 90 + s * 75, 1)[0];
    drumTable(ctx, z, new Vector3(p.x, U, p.z), 0.24, 0.48, { label: "Side table" });
    pottedPlant(ctx, z, new Vector3(p.x, U + 0.48, p.z), s < 0 ? "bromeliad" : "calathea", { pot: "terracotta", potR: 0.08, potH: 0.12, scale: 0.38, r });
  }

  // ---------------------------------------------------------------- high tables by the west glass
  for (const p of [
    { x: x0 + 2.2, z: z0 + 4.8 },
    { x: x0 + 2.3, z: z0 + 7.1 },
  ]) {
    highTable(ctx, z, new Vector3(p.x, U, p.z));
    for (const a of [20, 140, 260]) {
      const q = arcDeg(p.x, p.z, 0.62, a, a, 1)[0];
      stool(ctx, z, new Vector3(q.x, U, q.z), 0.76, a === 140 ? "mustard" : "tealBright", "Bar stool");
    }
    cocktail(ctx, z, new Vector3(p.x + 0.12, U + 1.06, p.z - 0.05), Math.floor(r() * 3), r);
    candle(ctx, z, new Vector3(p.x - 0.1, U + 1.06, p.z + 0.08));
  }

  // ---------------------------------------------------------------- hanging egg chairs in the open curve
  const eggs = [12, 42].map((a) => arcDeg(c.x, c.z, 4.6, a, a, 1)[0]);
  for (const e of eggs) eggChair(ctx, z, new Vector3(e.x, U, e.z), faceToward(e.x, e.z, c.x, c.z), r, CEIL);
  const st = arcDeg(c.x, c.z, 4.95, 27, 27, 1)[0];
  slattedSideTable(ctx, z, new Vector3(st.x, U, st.z));
  cocktail(ctx, z, new Vector3(st.x, U + 0.52, st.z), 2, r);
  const fp = arcDeg(c.x, c.z, 5.0, 64, 64, 1)[0];
  floorPlanter(ctx, z, new Vector3(fp.x, U, fp.z), "banana", "potCream", r);

  // ---------------------------------------------------------------- planting and light
  // in the rounded north-west corner, inside the glass
  {
    const R = 3.0 * 1.1;
    const a = (135 * Math.PI) / 180;
    pottedPlant(ctx, z, new Vector3(x0 + R + Math.cos(a) * (R - 0.85), U, z1 - R + Math.sin(a) * (R - 0.85)), "palm", { pot: "cream", potR: 0.28, potH: 0.5, scale: 1.1, r });
  }
  for (const p of [
    { x: s1.x - 0.9, z: s1.z + 1.9 },
    { x: s2.x - 2.2, z: s2.z + 2.2 },
    { x: s2.x + 2.4, z: s2.z + 1.6 },
  ])
    hangingPlanter(ctx, z, new Vector3(p.x, CEIL, p.z), 1.6, r);
  wovenPendant(ctx, z, new Vector3(s1.x + 0.3, CEIL, s1.z), 0.36, 1.9);
  wovenPendant(ctx, z, new Vector3(s2.x, CEIL, s2.z - 0.2), 0.4, 1.8);
  roomLight(ctx, "barLounge", "upper", new Vector3(bm, U + 3.0, cz + 0.4), 3.5, 14, 10, "#ffb766", ["poolTerrace"]);
  roomLight(ctx, "barLounge", "upper", new Vector3(s2.x, U + 3.0, s2.z), 2, 9, 9, "#ffb766", ["poolTerrace"]);
  roomLight(ctx, "barLounge", "upper", new Vector3(s1.x + 0.5, U + 3.0, s1.z), 2, 8, 8, "#ffb766", ["poolTerrace"]);
}

/**
 * Back bar from bx0 to bx1, its front at `front`: cupboards with brass pulls,
 * two glass-door drinks fridges at the east end, a stone top with the
 * espresso machine, blender, citrus press, fruit and jars.
 */
function backBar(ctx: WorldCtx, z: Zone, bx0: number, bx1: number, front: number, depth: number, r: Rand) {
  const bm = (bx0 + bx1) / 2;
  ctx.g(z, "panelHoney").add(box(bx1 - bx0, 0.88, depth), xf(bm, U + 0.44, front + depth / 2), "Back bar");
  ctx.g(z, "counterTop").add(box(bx1 - bx0 + 0.04, 0.04, depth + 0.03), xf(bm, U + 0.9, front + depth / 2 - 0.015), "Back bar");
  const fw = 0.62;
  const doorsEnd = bx1 - 2 * fw - 0.06;
  const nd = Math.max(2, Math.round((doorsEnd - bx0) / 0.6));
  const dw = (doorsEnd - bx0) / nd;
  const fronts = new Geo();
  const pulls = new Geo();
  for (let i = 0; i < nd; i++) {
    const x = bx0 + dw * (i + 0.5);
    fronts.add(box(dw - 0.02, 0.74, 0.02), xf(x, U + 0.46, front - 0.01));
    pulls.add(box(0.014, 0.14, 0.02), xf(x + (i % 2 ? -1 : 1) * (dw / 2 - 0.06), U + 0.68, front - 0.025));
  }
  ctx.g(z, "timber").add(fronts, undefined, "Back bar cupboards");
  ctx.g(z, "brass").add(pulls);
  const mats = ["bottleGreen", "bottleAmber", "bottleClear"];
  for (let k = 0; k < 2; k++) {
    const fx = bx1 - fw / 2 - 0.03 - k * fw;
    ctx.g(z, "steel").add(new Geo().add(box(fw, 0.06, 0.03), xf(0, 0.84, 0)).add(box(fw, 0.06, 0.03), xf(0, 0.1, 0)).add(box(0.05, 0.8, 0.03), xf(-fw / 2 + 0.025, 0.47, 0)).add(box(0.05, 0.8, 0.03), xf(fw / 2 - 0.025, 0.47, 0)), xf(fx, U, front - 0.015), "Drinks fridge");
    ctx.g(z, "fridgeGlow", { castShadow: false }).add(box(fw - 0.1, 0.68, 0.01), xf(fx, U + 0.47, front + 0.02), "Drinks fridge");
    for (const y of [0.18, 0.5]) for (let i = 0; i < 5; i++) bottle(ctx, z, xf(fx - 0.2 + i * 0.1, U + y, front), mats[(i + k + (y > 0.3 ? 1 : 0)) % 3], 0.24, "Bottles");
  }
  const top = U + 0.92;
  espressoMachine(ctx, z, xf(bx0 + 1.0, top, front + 0.27));
  // blender and citrus press
  ctx.g(z, "black").add(box(0.18, 0.12, 0.18), xf(bx0 + 1.9, top + 0.06, front + 0.3), "Blender");
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(lathe([[0.06, 0], [0.09, 0.24], [0.09, 0.26]], 14), xf(bx0 + 1.9, top + 0.12, front + 0.3), "Blender");
  ctx.g(z, "juice", { castShadow: false }).add(lathe([[0.001, 0], [0.058, 0], [0.072, 0.1], [0.001, 0.1]], 14), xf(bx0 + 1.9, top + 0.125, front + 0.3), "Blender");
  ctx.g(z, "black").add(cylinder(0.065, 0.02, 12), xf(bx0 + 1.9, top + 0.38, front + 0.3), "Blender");
  ctx.g(z, "orange").add(new Geo().add(cylinder(0.09, 0.28, 16)).add(lathe([[0.001, 0], [0.12, 0.02], [0.12, 0.05]], 16), xf(0, 0.28, 0)), xf(bx0 + 2.4, top, front + 0.28), "Citrus press");
  fruitBowl(ctx, z, new Vector3(bx0 + 2.95, top, front + 0.28), r);
  for (let i = 0; i < 3; i++) {
    const cx = bx0 + 3.5 + i * 0.13;
    ctx.g(z, "coconut").add(sphere(0.07, 12, 10, 0.75), xf(cx, top + 0.05, front + 0.3 + (i % 2) * 0.06), "Coconuts");
  }
  for (let i = 0; i < 3; i++) jar(ctx, z, new Vector3(bx0 + 4.15 + i * 0.2, top, front + 0.32), 0.07 + (i % 2) * 0.015, 0.2 + i * 0.03, i % 2 ? "cookie" : "coffeeBean");
}

/** Round high table on a pedestal. Base at p. */
function highTable(ctx: WorldCtx, z: Zone, p: Vector3) {
  ctx.g(z, "black").add(new Geo().add(cylinder(0.26, 0.03, 24)).add(cylinder(0.04, 1.0, 10), xf(0, 0.03, 0)), xf(p.x, p.y, p.z), "High table");
  ctx.g(z, "timber").add(cylinder(0.38, 0.04, 32), xf(p.x, p.y + 1.02, p.z), "High table");
}

/**
 * Drink at p (base on a table): 0 a pink highball with a straw and lime
 * wheel, 1 a blue coupe with an orange slice, 2 a coconut with a paper umbrella.
 */
function cocktail(ctx: WorldCtx, z: Zone, p: Vector3, kind: number, r: Rand) {
  const lbl = "Cocktail";
  if (kind === 2) {
    ctx.g(z, "coconut", { castShadow: false }).add(lathe([[0.001, 0], [0.05, 0.005], [0.075, 0.04], [0.078, 0.08], [0.07, 0.11]], 16), xf(p.x, p.y, p.z), lbl);
    ctx.g(z, "coconutFlesh", { castShadow: false }).add(cylinder(0.069, 0.004, 16), xf(p.x, p.y + 0.105, p.z), lbl);
    const ang = r() * Math.PI * 2;
    const tip = new Vector3(p.x + Math.cos(ang) * 0.06, p.y + 0.3, p.z + Math.sin(ang) * 0.06);
    ctx.g(z, "timberPale", { castShadow: false }).add(tube([new Vector3(p.x, p.y + 0.08, p.z), tip], 0.003, 4), undefined, lbl);
    ctx.g(z, r() > 0.5 ? "floatPink" : "cocktailBlue", { castShadow: false }).add(lathe([[0.001, 0.035], [0.09, 0], [0.09, -0.004], [0.001, 0.03]], 10), xf(tip.x, tip.y - 0.02, tip.z, 0, 1, 1, 1, 0.25), "Paper umbrella");
    ctx.g(z, "lime", { castShadow: false }).add(tube([new Vector3(p.x - 0.03, p.y + 0.1, p.z), new Vector3(p.x + 0.02, p.y + 0.25, p.z + 0.02)], 0.004, 4), undefined, lbl);
    return;
  }
  if (kind === 0) {
    ctx.g(z, "cocktailPink", { castShadow: false }).add(cylinder(0.031, 0.12, 12), xf(p.x, p.y + 0.004, p.z), lbl);
    ctx.g(z, "glass", { castShadow: false, pickable: false }).add(cylinder(0.035, 0.15, 14, false), xf(p.x, p.y, p.z), lbl);
    ctx.g(z, "black", { castShadow: false }).add(tube([new Vector3(p.x + 0.005, p.y + 0.02, p.z), new Vector3(p.x + 0.025, p.y + 0.21, p.z + 0.01)], 0.004, 4), undefined, "Straw");
    ctx.g(z, "lime", { castShadow: false }).add(cylinder(0.028, 0.006, 14), xf(-0.004, -0.014, 0).multiply(xf(p.x - 0.035, p.y + 0.14, p.z, 0, 1, 1, 1, 0, Math.PI / 2)), "Lime wheel");
    return;
  }
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(lathe([[0.03, 0], [0.03, 0.008], [0.004, 0.012], [0.004, 0.09], [0.055, 0.12], [0.06, 0.15]], 16, false, false), xf(p.x, p.y, p.z), lbl);
  ctx.g(z, "cocktailBlue", { castShadow: false }).add(lathe([[0.001, 0.095], [0.04, 0.11], [0.052, 0.135], [0.001, 0.135]], 16), xf(p.x, p.y, p.z), lbl);
  ctx.g(z, "orange", { castShadow: false }).add(cylinder(0.03, 0.006, 14), xf(-0.003, -0.015, 0).multiply(xf(p.x + 0.05, p.y + 0.145, p.z, 0, 1, 1, 1, 0, Math.PI / 2)), "Orange slice");
}

function pineapple(ctx: WorldCtx, z: Zone, p: Vector3) {
  ctx.g(z, "pineapple").add(sphere(0.075, 14, 12, 1.45), xf(p.x, p.y + 0.105, p.z), "Pineapple");
  const leaves = new Geo();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const tilt = 0.25 + (i % 3) * 0.15;
    leaves.add(box(0.025, 0.16, 0.006), xf(0, 0.08, 0, a, 1, 1, 1, tilt).multiply(xf(0, 0.2, 0)));
  }
  ctx.g(z, "pineLeaf", { castShadow: false }).add(leaves, xf(p.x, p.y, p.z), "Pineapple");
}

// ------------------------------------------------------------------ terrace

export function buildTerraceLounge(ctx: WorldCtx, pool: PoolInfo): void {
  const z = zone("poolTerrace", "upper");
  const r = rng(131);
  ensureMats(ctx);

  // ---------------------------------------------------------------- fire-pit lounge
  const FP = { x: 11.4, z: 9.9 };
  roundRug(ctx, z, new Vector3(FP.x, U, FP.z), 2.45, rugs.loungeJute(ctx), "Outdoor rug");
  firePit(ctx, z, new Vector3(FP.x, U, FP.z), r);
  sofa(ctx, z, arcDeg(FP.x, FP.z, 1.85, 30, 150, 24), { mat: "tealDeep", r, pillows: ["mustard", "coral", "rust", "mustard"], label: "Fire-pit sofa", y: U });
  for (const a of [242, 298]) {
    const p = arcDeg(FP.x, FP.z, 1.95, a, a, 1)[0];
    armchair(ctx, z, new Vector3(p.x, U, p.z), faceToward(p.x, p.z, FP.x, FP.z), "rust", "tealBright");
  }
  for (const a of [215, 325]) {
    const p = arcDeg(FP.x, FP.z, 1.75, a, a, 1)[0];
    drumTable(ctx, z, new Vector3(p.x, U, p.z), 0.2, 0.42, { label: "Side table" });
    cocktail(ctx, z, new Vector3(p.x, U + 0.42, p.z), a < 270 ? 0 : 2, r);
  }

  // ---------------------------------------------------------------- festoon lights over the fire pit and loungers
  const fasc = BAR.z0 - 1.4 + 0.03;
  const Y = LEVEL.upperCeil - 0.15;
  const P1 = new Vector3(8.7, U + 3.3, 7.4);
  // north-east of the pool steps, clear of the way to them and the walk round them
  const P2 = new Vector3(15.6, U + 3.3, 7.6);
  for (const p of [P1, P2]) festoonPole(ctx, z, p);
  const sail = new Vector3(pool.maxX - 1.2, U + 3.9, pool.maxZ + 5.2);
  for (const [a, b, sag] of [
    [P1, new Vector3(9.6, Y, fasc), 0.45],
    [P1, new Vector3(12.6, Y, fasc), 0.55],
    [P2, new Vector3(12.6, Y, fasc), 0.45],
    [P2, new Vector3(15.3, Y, fasc), 0.45],
    [P1, P2, 0.4],
    [P2, sail, 0.6],
  ] as [Vector3, Vector3, number][])
    festoon(ctx, z, a, b, sag);
  ctx.lights.push({ pos: new Vector3(11.5, U + 2.6, 9.5), color: "#ffc27a", day: 0, night: 3.5, range: 9, rooms: ["poolTerrace", "barLounge"], level: "upper" });

  // ---------------------------------------------------------------- bench wrapped round the terrace trunk
  const tt = TREES.find((t) => t.id === "treeTerrace")!;
  treeBench(ctx, z, trunkSpan(tt, U, U + 0.5), r);

  // ---------------------------------------------------------------- drinks ledge along the east railing
  railLedge(ctx, z, r);

  // ---------------------------------------------------------------- cabana daybed between the gallery and the pool
  cabana(ctx, z, xf(CABANA.x, U, CABANA.z, -Math.PI / 2), r);

  // ---------------------------------------------------------------- towel trolley by the loungers
  towelTrolley(ctx, z, xf(pool.pc.x + 5.0, U, pool.maxZ + POOL.wall + 2.15, Math.PI / 2));

  // ---------------------------------------------------------------- floats in the pool
  const inner = offsetPath(poolLoop, -0.85, true);
  const spots = [
    { x: pool.pc.x - 2.4, z: pool.pc.z + 1.2, a: 0.4 },
    { x: pool.pc.x + 2.2, z: pool.pc.z - 0.6, a: -0.5 },
  ].filter((s) => pointInPolygon(s, inner));
  if (spots[0]) donutFloat(ctx, z, new Vector3(spots[0].x, POOL.water, spots[0].z), spots[0].a);
  if (spots[1]) bananaFloat(ctx, z, new Vector3(spots[1].x, POOL.water, spots[1].z), spots[1].a);
}

/** Round stone fire table with lava rocks and flames. Base at p. */
function firePit(ctx: WorldCtx, z: Zone, p: Vector3, r: Rand) {
  ctx.g(z, "stoneWhite").add(lathe([[0.64, 0], [0.64, 0.36], [0.61, 0.39], [0.44, 0.39], [0.44, 0.31], [0.001, 0.31]], 48), xf(p.x, p.y, p.z), "Fire table");
  ctx.g(z, "black").add(torus(0.44, 0.012, 40, 4), xf(p.x, p.y + 0.385, p.z), "Fire table");
  const rocks = new Geo();
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * 0.4;
    rocks.add(sphere(0.035 + r() * 0.025, 7, 5, 0.7), xf(Math.cos(a) * rr, 0.33, Math.sin(a) * rr, r() * 3));
  }
  ctx.g(z, "lavaRock").add(rocks, xf(p.x, p.y, p.z), "Lava rocks");
  const flame = (h: number, w: number): [number, number][] => [
    [0.001, 0],
    [w, h * 0.12],
    [w * 0.85, h * 0.4],
    [w * 0.4, h * 0.75],
    [0.001, h],
  ];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.4;
    const rr = i === 0 ? 0 : 0.14 + r() * 0.12;
    const h = 0.22 + r() * 0.2;
    const fx = p.x + Math.cos(a) * rr;
    const fz = p.z + Math.sin(a) * rr;
    ctx.g(z, "flame", { castShadow: false, pickable: false }).add(lathe(flame(h, 0.06 + r() * 0.03), 10), xf(fx, p.y + 0.34, fz, 0, 1, 1, 1, (r() - 0.5) * 0.2, (r() - 0.5) * 0.2), "Fire");
    ctx.g(z, "flameCore", { castShadow: false, pickable: false }).add(lathe(flame(h * 0.55, 0.035), 8), xf(fx, p.y + 0.34, fz), "Fire");
  }
  ctx.lights.push({ pos: new Vector3(p.x, p.y + 0.8, p.z), color: "#ff9a4a", day: 0.6, night: 5, range: 6, rooms: ["poolTerrace", "barLounge"], level: "upper" });
}

/** Timber pole that carries the festoon lights. p is the top. */
function festoonPole(ctx: WorldCtx, z: Zone, p: Vector3) {
  const h = p.y - U;
  ctx.g(z, "timberDark").add(new Geo().add(box(0.11, h + 0.15, 0.11), xf(0, (h + 0.15) / 2, 0)).add(box(0.18, 0.04, 0.18), xf(0, h + 0.17, 0)), xf(p.x, U, p.z), "Festoon pole");
  ctx.g(z, "charcoal").add(new Geo().add(box(0.3, 0.02, 0.3), xf(0, 0.01, 0)).add(box(0.16, 0.2, 0.16), xf(0, 0.12, 0)), xf(p.x, U, p.z), "Festoon pole");
}

/** String of festoon lights from a to b sagging by `sag`, bulbs every ~0.5 m. */
function festoon(ctx: WorldCtx, z: Zone, a: Vector3, b: Vector3, sag: number) {
  const L = Vector3.Distance(a, b);
  const n = Math.max(8, Math.ceil(L / 0.15));
  const pts: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = Vector3.Lerp(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  ctx.g(z, "black", { castShadow: false }).add(tube(pts, 0.006, 5), undefined, "Festoon lights");
  const sockets = new Geo();
  const bulbs = new Geo();
  const nb = Math.max(2, Math.round(L / 0.5));
  for (let i = 1; i < nb; i++) {
    const t = i / nb;
    const p = Vector3.Lerp(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    sockets.add(cylinder(0.014, 0.04, 8), xf(p.x, p.y - 0.045, p.z));
    bulbs.add(sphere(0.038, 10, 8, 1.15), xf(p.x, p.y - 0.085, p.z));
  }
  ctx.g(z, "black", { castShadow: false }).add(sockets, undefined, "Festoon lights");
  ctx.g(z, "bulb", { castShadow: false }).add(bulbs, undefined, "Festoon lights");
}

/** Round bench wrapped round a trunk (span = the trunk at seat height), with cushions and pillows. */
function treeBench(ctx: WorldCtx, z: Zone, span: { x: number; z: number; R: number }, r: Rand) {
  const Ri = span.R + 0.1;
  const Ro = Ri + 0.52;
  const H = 0.38;
  ctx.g(z, "panelHoney").add(lathe([[Ro, 0], [Ro, H], [Ri, H], [Ri, 0]], 64, false, false, 8), xf(span.x, U, span.z), "Tree bench");
  ctx.g(z, "timber").add(lathe([[Ro + 0.03, H], [Ro + 0.03, H + 0.04], [Ri, H + 0.04]], 64), xf(span.x, U, span.z), "Tree bench");
  ctx.g(z, "tealBright").add(lathe([[Ro - 0.02, H + 0.04], [Ro - 0.02, H + 0.1], [Ro - 0.05, H + 0.12], [Ri + 0.06, H + 0.12], [Ri + 0.04, H + 0.04]], 64), xf(span.x, U, span.z), "Bench cushion");
  ctx.g(z, "amberStrip", { castShadow: false }).add(torus(Ro + 0.005, 0.01, 64, 4), xf(span.x, U + 0.05, span.z), "Bench light");
  const pill = ["mustard", "coral", "rust", "tealDeep", "mustard", "coral"];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const rr = Ri + 0.13;
    ctx.g(z, pill[i]).add(softBox(0.42, 0.4, 0.13, 0.06, 0.05), xf(span.x + Math.cos(a) * rr, U + H + 0.32, span.z + Math.sin(a) * rr, Math.atan2(-Math.cos(a), -Math.sin(a)) + Math.PI, 1, 1, 1, -0.25), "Cushion");
  }
  void r;
}

/** Drinks ledge along the east railing with high stools facing the view. */
function railLedge(ctx: WorldCtx, z: Zone, r: Rand) {
  const keep = (p: P2) => p.x > RAIL_BAR.xMin && p.z > RAIL_BAR.zMin && p.z < RAIL_BAR.zMax;
  const line = resample(offsetPath(upperDeckLoop, -0.5, true), 0.1, true).filter(keep);
  if (line.length < 4) return;
  line.sort((a, b) => a.z - b.z);
  const path = at(line, U);
  ctx.g(z, "timber").add(sweep([[0.18, 1.02], [0.18, 1.07], [-0.18, 1.07], [-0.18, 1.02]], path, { caps: true }), undefined, "Drinks ledge");
  ctx.g(z, "amberStrip", { castShadow: false }).add(beam(at(offsetPath(line, 0.0), U + 1.005), 0.015, 0.012), undefined, "Ledge light");
  const legs = new Geo();
  for (const p of resample(line, 1.1)) legs.add(box(0.05, 1.02, 0.05), xf(p.x, U + 0.51, p.z));
  ctx.g(z, "black").add(legs, undefined, "Drinks ledge");
  // stools on the deck side (the line runs north, so the deck is to its left)
  const seats = resample(offsetPath(line, -0.55), 0.85).slice(1, -1);
  seats.forEach((p, i) => {
    stool(ctx, z, new Vector3(p.x, U, p.z), 0.76, i % 2 ? "mustard" : "tealBright", "Bar stool");
    if (i % 2 === 0) {
      const q = line.reduce((best, c) => (Math.hypot(c.x - p.x, c.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? c : best));
      cocktail(ctx, z, new Vector3(q.x, U + 1.07, q.z), (i / 2) % 3, r);
    }
  });
}

/**
 * Cabana daybed: timber frame with a slatted roof, curtains tied back at the
 * posts, a deep mattress with pillows and a tray of drinks. Local frame: the
 * open front faces -Z. Base at m.
 */
function cabana(ctx: WorldCtx, z: Zone, m: Matrix, r: Rand) {
  const W = 2.3;
  const D = 2.0;
  const H = 2.45;
  const frame = new Geo();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.add(box(0.1, H, 0.1), xf(sx * (W / 2 - 0.05), H / 2, sz * (D / 2 - 0.05)));
  for (const sz of [-1, 1]) frame.add(box(W, 0.12, 0.1), xf(0, H - 0.06, sz * (D / 2 - 0.05)));
  for (const sx of [-1, 1]) frame.add(box(0.1, 0.12, D), xf(sx * (W / 2 - 0.05), H - 0.06, 0));
  ctx.g(z, "timberDark").add(frame, m, "Cabana");
  const slats = new Geo();
  for (let i = 0; i < 11; i++) slats.add(box(W - 0.1, 0.03, 0.09), xf(0, H + 0.015, -D / 2 + 0.1 + (i * (D - 0.2)) / 10));
  ctx.g(z, "timber").add(slats, m, "Cabana roof");
  // base, mattress, pillows
  ctx.g(z, "timber").add(box(W - 0.15, 0.3, D - 0.15), xf(0, 0.15, 0).multiply(m), "Daybed");
  ctx.g(z, "cream").add(softBox(W - 0.25, 0.22, D - 0.25, 0.08, 0.03), xf(0, 0.41, 0).multiply(m), "Daybed mattress");
  const pill = ["tealBright", "mustard", "coral", "tealDeep", "mustard"];
  for (let i = 0; i < 5; i++) ctx.g(z, pill[i]).add(softBox(0.45, 0.42, 0.14, 0.06, 0.05), xf(-W / 2 + 0.4 + i * 0.37, 0.72, D / 2 - 0.3, (r() - 0.5) * 0.2, 1, 1, 1, -0.3).multiply(m), "Cushion");
  ctx.g(z, "timber").add(box(0.5, 0.03, 0.34), xf(0.35, 0.535, -0.35, 0.2).multiply(m), "Serving tray");
  cocktail(ctx, z, pt(m, 0.25, 0.55, -0.38), 2, r);
  cocktail(ctx, z, pt(m, 0.45, 0.55, -0.3), 0, r);
  // curtains gathered and tied at each post
  const curt = new Geo();
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx * (W / 2 - 0.16);
      const cz = sz * (D / 2 - 0.16);
      curt.add(lathe([[0.1, 0], [0.06, 1.1], [0.05, 1.2], [0.08, 1.35], [0.13, H - 0.15], [0.13, H - 0.12]], 14), xf(cx, 0, cz));
    }
  ctx.g(z, "canvas").add(curt, m, "Cabana curtains");
  const ties = new Geo();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ties.add(torus(0.058, 0.012, 14, 4), xf(sx * (W / 2 - 0.16), 1.2, sz * (D / 2 - 0.16)));
  ctx.g(z, "rope").add(ties, m, "Cabana curtains");
  ctx.g(z, "bulb", { castShadow: false }).add(sphere(0.06, 10, 8), xf(0, H - 0.25, 0).multiply(m), "Cabana lantern");
  ctx.g(z, "lattice", { castShadow: false }).add(sphere(0.14, 14, 10), xf(0, H - 0.25, 0).multiply(m), "Cabana lantern");
}

/** Teak towel trolley with rolled towels. Base at m. */
function towelTrolley(ctx: WorldCtx, z: Zone, m: Matrix) {
  const W = 0.9;
  const D = 0.45;
  const fr = new Geo();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) fr.add(box(0.04, 0.9, 0.04), xf(sx * (W / 2 - 0.02), 0.45, sz * (D / 2 - 0.02)));
  for (const y of [0.15, 0.5, 0.88]) fr.add(box(W, 0.025, D), xf(0, y, 0));
  ctx.g(z, "timber").add(fr, m, "Towel trolley");
  const cols = ["towelCream", "towelTeal", "towelCoral"];
  for (const [y, row] of [
    [0.1625, 0],
    [0.5125, 1],
  ] as [number, number][])
    for (let i = 0; i < 6; i++) ctx.g(z, cols[(i + row) % 3]).add(cylinder(0.07, D - 0.06, 14), xf(-W / 2 + 0.1 + i * 0.14, y + 0.07, -(D - 0.06) / 2, 0, 1, 1, 1, Math.PI / 2).multiply(m), "Rolled towels");
  ctx.g(z, "towelCream").add(softBox(0.5, 0.08, 0.35, 0.03), xf(-0.15, 0.93, 0).multiply(m), "Folded towels");
  ctx.g(z, "towelTeal").add(softBox(0.46, 0.07, 0.33, 0.03), xf(-0.15, 1.005, 0, 0.1).multiply(m), "Folded towels");
}

/** Inflatable frosted donut: a dough ring, pink icing over its top half and sprinkles. p is on the water. */
function donutFloat(ctx: WorldCtx, z: Zone, p: Vector3, yaw: number) {
  const R = 0.42;
  const m = xf(p.x, p.y, p.z, yaw);
  ctx.g(z, "floatDough").add(torus(R, 0.16, 40, 16), xf(0, 0.03, 0, 0, 1, 0.8, 1).multiply(m), "Donut pool float");
  // the icing ring is a little fatter and flatter, so it covers the top and laps over the sides
  const ir = 0.166;
  const iy = 0.1;
  const ih = 0.45;
  ctx.g(z, "floatPink").add(torus(R, ir, 40, 16), xf(0, iy, 0, 0, 1, ih, 1).multiply(m), "Donut pool float");
  // sprinkles in colours already on the terrace (towels, the banana), so they add no meshes
  const cols = ["towelCream", "floatYellow", "towelTeal", "towelCoral"];
  for (let i = 0; i < 36; i++) {
    const a = i * 2.39996;
    const d = (((i * 0.618034) % 1) - 0.5) * 0.17;
    const y = iy + ir * ih * Math.sqrt(1 - (d / ir) ** 2) - 0.003;
    ctx.g(z, cols[i % cols.length]).add(box(0.034, 0.01, 0.01), xf(Math.cos(a) * (R + d), y, Math.sin(a) * (R + d), i * 1.7).multiply(m), "Donut pool float");
  }
}

function bananaFloat(ctx: WorldCtx, z: Zone, p: Vector3, yaw: number) {
  const pts: Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = -0.85 + (i / 40) * 1.7;
    pts.push(new Vector3(Math.sin(t) * 0.95, 0, -Math.cos(t) * 0.95 + 0.95));
  }
  const m = xf(p.x, p.y + 0.12, p.z, yaw);
  // rounds off to a closed tip at each end, where the brown stem and flower end sit
  ctx.g(z, "floatYellow").add(tube(pts, (t) => 0.21 * Math.sqrt(Math.sin(Math.PI * t)) + 0.004, 20, true), m, "Banana pool float");
  for (const e of [pts[0], pts[pts.length - 1]]) ctx.g(z, "floatBrown").add(sphere(0.035, 8, 6), xf(e.x, e.y, e.z).multiply(m), "Banana pool float");
}
