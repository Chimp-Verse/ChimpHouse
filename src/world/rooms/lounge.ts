// Arrival Lounge (lower level, front-left). A café bar along the north wall
// with a proper bartender's aisle and lit back-bar niches either side of the
// chimp poster; a curved sofa group in the glazed west bay, as in the concept
// render; hanging egg chairs and a window counter facing the front glass; a
// chess nook; and an arch that lands inside the room. The north wall stops
// just past the bar, opening the corner by the west trunk toward the Trading
// Room door.

import { Vector3 } from "@babylonjs/core";
import { P2, resample, rng } from "../geometry/curves";
import { Geo, at, beam, box, cylinder, lathe, plane, sphere, sweep, tube, xf } from "../geometry/geo";
import { WorldCtx, Zone, zone } from "../context";
import { LEVEL, LOUNGE, TREES } from "../layout";
import { makeCanvas, toTexture } from "../materials/canvas";
import { armchair, drumTable, pouf, roundRug, sofa, stool } from "../props/furniture";
import { candle, decorTable, floorLamp, floorPlanter, fruitBowl, hangingPlanter } from "../props/decor";
import { wovenPendant } from "../props/lights";
import { Rand, pottedPlant, vine } from "../props/plants";
import { canvasMat, chartCanvas, screenMat } from "../props/tech";
import { trunkPlanter } from "../structure/trunks";
import { barNiche, bottle, cakeStand, eggChair, espressoMachine, jar, juiceGlass, ledAlong, menuStand, offsetPlan, slattedSideTable, tapTower } from "../props/barware";
import { arcDeg, faceToward, interiorArch, panel, roomLight } from "./common";
import { rugs } from "./rugs";

const F = LEVEL.lower + 0.012;
const C = LEVEL.lowerCeil;


/**
 * Where the lounge bar sits. The back bar runs along the north wall from bx0
 * to bx1 (front face at `front`); the counter's centre line runs west at z =
 * cz from ce, curving back to the wall at cw, leaving a 0.9 m bartender's aisle
 * between them. The north wall ends at wallEnd (facades.ts).
 */
export function loungeBar() {
  const pl = trunkPlanter(TREES.find((t) => t.id === "treeWestCentral")!);
  const clear = (rr: number, zz: number) => pl.x - Math.sqrt(Math.max(0, rr * rr - (zz - pl.z) ** 2));
  const backZ = LOUNGE.z1 - 0.03;
  const front = backZ - 0.55;
  const bx0 = LOUNGE.c.x - 0.25;
  const bx1 = clear(pl.R + 0.3, front);
  const cz = front - 0.92 - 0.6;
  return { bx0, bx1, backZ, front, cz, ce: clear(pl.R + 0.85, cz), cw: bx0 + 1.25, wallEnd: bx1 + 0.12, planter: pl };
}

function ensureMats(ctx: WorldCtx) {
  const m = ctx.mats;
  const add = (key: string, o: Parameters<typeof m.pbr>[1]) => {
    if (!m.has(key)) m.pbr(key, o);
  };
  add("bottleAmber", { color: "#9a4a12", rough: 0.08, alpha: 0.85 });
  add("bottleGreen", { color: "#2f5a2a", rough: 0.08, alpha: 0.85 });
  add("bottleClear", { color: "#d8e8e0", rough: 0.05, alpha: 0.5 });
  add("ceramicSage", { color: "#9fb39a", rough: 0.4 });
  add("orange", { color: "#f08a24", rough: 0.5 });
  add("juice", { color: "#ff9a2e", rough: 0.1, emissive: "#ff7a1a", emissiveIntensity: 0.2 });
  add("fridgeGlow", { color: "#e8f0f4", emissive: "#d8ecff", emissiveIntensity: 0.55, rough: 0.3 });
  add("cake", { color: "#f3dfc0", rough: 0.8 });
  add("cakeBerry", { color: "#a3283c", rough: 0.6 });
  add("cookie", { color: "#a86b32", rough: 0.9 });
  add("paper", { color: "#efe9dc", rough: 0.9 });
}

export function buildLounge(ctx: WorldCtx): void {
  const z = zone("arrivalLounge", "lower");
  const r = rng(21);
  ensureMats(ctx);
  const { c, r: R, x1, z0 } = LOUNGE;
  const bar = loungeBar();

  buildBar(ctx, z, bar, r);

  // ---------------------------------------------------------------- sofa group in the west bay
  const G = { x: c.x - 2.2, z: c.z - 0.4 };
  roundRug(ctx, z, new Vector3(G.x + 0.55, F, G.z), 2.6, rugs.loungeJute(ctx), "Woven circular rug");
  sofa(ctx, z, arcDeg(G.x, G.z, 2.95, 112, 248, 30), { mat: "teal", r, pillows: ["mustard", "rust", "coral", "sage", "mustard"], label: "Curved teal sofa" });
  drumTable(ctx, z, new Vector3(G.x + 0.55, F, G.z + 0.75), 0.62, 0.4);
  drumTable(ctx, z, new Vector3(G.x + 0.8, F, G.z - 0.85), 0.5, 0.44);
  decorTable(ctx, z, new Vector3(G.x + 0.55, 0.41, G.z + 0.75), r);
  fruitBowl(ctx, z, new Vector3(G.x + 0.95, 0.45, G.z - 0.95), r);
  candle(ctx, z, new Vector3(G.x + 0.6, 0.45, G.z - 0.7));
  pouf(ctx, z, new Vector3(G.x + 2.05, F, G.z - 1.35), 0.42, 0.42, "rust");
  pouf(ctx, z, new Vector3(G.x + 2.1, F, G.z + 1.45), 0.38, 0.4, "rust");
  const fl = arcDeg(G.x, G.z, 3.35, 106, 106, 1)[0];
  floorLamp(ctx, z, new Vector3(fl.x, F, fl.z));

  // sage armchair and slatted side table by the trunk, as in the concept render
  const ac = { x: x1 - 3.3, z: bar.planter.z - 3.3 };
  armchair(ctx, z, new Vector3(ac.x, F, ac.z), faceToward(ac.x, ac.z, G.x, G.z), "sage", "teal");
  slattedSideTable(ctx, z, new Vector3(ac.x + 0.65, F, ac.z - 0.55));
  candle(ctx, z, new Vector3(ac.x + 0.65, 0.53, ac.z - 0.55));

  // ---------------------------------------------------------------- hanging egg chairs by the south-west glass
  const e1 = { x: c.x - 1.75, z: z0 + 1.45 };
  const e2 = { x: c.x - 0.1, z: z0 + 1.15 };
  for (const e of [e1, e2]) eggChair(ctx, z, new Vector3(e.x, F, e.z), faceToward(e.x, e.z, (e1.x + e2.x) / 2, z0 + 4.2), r, C);
  const st = { x: (e1.x + e2.x) / 2, z: (e1.z + e2.z) / 2 - 0.1 };
  drumTable(ctx, z, new Vector3(st.x, F, st.z), 0.24, 0.45, { label: "Side table" });
  pottedPlant(ctx, z, new Vector3(st.x, 0.46, st.z), "bromeliad", { pot: "terracotta", potR: 0.09, potH: 0.13, scale: 0.4, r });

  // ---------------------------------------------------------------- window counter along the front glass
  windowCounter(ctx, z, c.x + 1.1, x1 - 2.3, z0 + 0.52, r);

  // ---------------------------------------------------------------- chess nook, north-west
  chessNook(ctx, z, new Vector3(c.x - 2.6, F, bar.cz - 0.05), r);

  // ---------------------------------------------------------------- arch landing inside the glass
  const A = { x: x1 - 3.1, z: bar.planter.z - 1.7 };
  const B = { x: c.x - 3.6, z: z0 + 1.55 };
  interiorArch(ctx, "arrivalLounge", "lower", A, B, 0, C - 0.05, 0.32);

  // ---------------------------------------------------------------- planting
  // smaller pots along the glass behind the sofa
  const behind = ["monstera", "croton", "bromeliad", "palm"] as const;
  [160, 175, 190, 205].forEach((a, i) => {
    const p = arcDeg(c.x, c.z, R - 0.35, a, a, 1)[0];
    pottedPlant(ctx, z, new Vector3(p.x, F, p.z), behind[i], { pot: "cream", potR: 0.2, potH: 0.34, scale: 0.85 + r() * 0.3, r });
  });
  for (const [a, kind, mat] of [
    [140, "banana", "potCharcoal"],
    [226, "monstera", "potCream"],
  ] as const) {
    const p = arcDeg(c.x, c.z, R - 0.6, a, a, 1)[0];
    floorPlanter(ctx, z, new Vector3(p.x, F, p.z), kind, mat, r);
  }
  pottedPlant(ctx, z, new Vector3(x1 - 0.75, F, z0 + 4.4), "monstera", { pot: "cream", potR: 0.32, potH: 0.55, scale: 1.4, r });
  pottedPlant(ctx, z, new Vector3(x1 - 0.6, F, z0 + 5.3), "cordyline", { pot: "charcoal", potR: 0.24, potH: 0.5, scale: 1.3, r });
  for (const a of [168, 196]) {
    const p = arcDeg(c.x, c.z, R - 0.55, a, a, 1)[0];
    hangingPlanter(ctx, z, new Vector3(p.x, C, p.z), 1.5, r);
  }
  for (let i = 0; i < 7; i++) {
    const p = arcDeg(c.x, c.z, R - 0.5, 140 + i * 24, 140 + i * 24, 1)[0];
    vine(ctx, z, new Vector3(p.x, C - 0.05, p.z), 0.6 + r() * 1.6, r, { density: 12 });
  }

  // ---------------------------------------------------------------- lights
  wovenPendant(ctx, z, new Vector3(G.x + 0.6, C, G.z + 0.6), 0.36, 1.2);
  wovenPendant(ctx, z, new Vector3(G.x + 0.9, C, G.z - 0.9), 0.28, 1.5, { shape: "teardrop" });
  wovenPendant(ctx, z, new Vector3(c.x - 2.6, C, bar.cz - 0.05), 0.26, 1.6, { shape: "drum" });
  for (const x of [c.x + 2.4, x1 - 3.6]) wovenPendant(ctx, z, new Vector3(x, C, z0 + 0.75), 0.22, 1.6, { shape: "teardrop" });
  roomLight(ctx, "arrivalLounge", "lower", new Vector3(G.x + 1.0, 3.4, G.z), 4, 16, 10);
  roomLight(ctx, "arrivalLounge", "lower", new Vector3((bar.bx0 + bar.bx1) / 2, 3.0, bar.cz + 0.6), 3, 12, 7);
  roomLight(ctx, "arrivalLounge", "lower", new Vector3(c.x + 1.0, 2.8, z0 + 1.6), 1.5, 6, 7);
}

// ------------------------------------------------------------------ bar

function buildBar(ctx: WorldCtx, z: Zone, b: ReturnType<typeof loungeBar>, r: Rand) {
  const { bx0, bx1, backZ, front, cz, ce, cw } = b;
  const depth = backZ - front;
  const bm = (bx0 + bx1) / 2;

  // back bar: cupboards under a stone top, a glass-door drinks fridge at the east end
  ctx.g(z, "panelHoney").add(box(bx1 - bx0, 0.88, depth), xf(bm, 0.44, front + depth / 2), "Back bar");
  ctx.g(z, "counterTop").add(box(bx1 - bx0 + 0.04, 0.04, depth + 0.03), xf(bm, 0.9, front + depth / 2 - 0.015), "Back bar");
  const fronts = new Geo();
  const pulls = new Geo();
  const fridgeW = 0.62;
  const doorsEnd = bx1 - fridgeW - 0.06;
  const nd = Math.max(2, Math.round((doorsEnd - bx0) / 0.6));
  const dw = (doorsEnd - bx0) / nd;
  for (let i = 0; i < nd; i++) {
    const x = bx0 + dw * (i + 0.5);
    fronts.add(box(dw - 0.02, 0.74, 0.02), xf(x, 0.46, front - 0.01));
    pulls.add(box(0.014, 0.14, 0.02), xf(x + (i % 2 ? -1 : 1) * (dw / 2 - 0.06), 0.68, front - 0.025));
  }
  ctx.g(z, "timber").add(fronts, undefined, "Back bar cupboards");
  ctx.g(z, "brass").add(pulls);
  const fx = bx1 - fridgeW / 2 - 0.03;
  ctx.g(z, "steel").add(new Geo().add(box(fridgeW, 0.06, 0.03), xf(0, 0.84, 0)).add(box(fridgeW, 0.06, 0.03), xf(0, 0.1, 0)).add(box(0.05, 0.8, 0.03), xf(-fridgeW / 2 + 0.025, 0.47, 0)).add(box(0.05, 0.8, 0.03), xf(fridgeW / 2 - 0.025, 0.47, 0)), xf(fx, 0, front - 0.015), "Drinks fridge");
  ctx.g(z, "fridgeGlow", { castShadow: false }).add(box(fridgeW - 0.1, 0.68, 0.01), xf(fx, 0.47, front + 0.02), "Drinks fridge");
  for (const y of [0.18, 0.5])
    for (let i = 0; i < 5; i++) bottle(ctx, z, xf(fx - 0.2 + i * 0.1, y, front + 0.0), ["bottleGreen", "bottleAmber", "bottleClear"][(i + (y > 0.3 ? 1 : 0)) % 3], 0.24, "Bottles");

  // on the back bar: espresso machine and grinder, juicer and oranges, cake under a dome, jars
  const top = 0.92;
  const ex = bm + 0.1;
  espressoMachine(ctx, z, xf(ex, top, front + 0.26));
  ctx.g(z, "black").add(new Geo().add(box(0.18, 0.32, 0.2), xf(0, 0.16, 0)), xf(ex - 0.62, top, front + 0.3), "Coffee grinder");
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(lathe([[0.04, 0], [0.11, 0.2], [0.11, 0.22]], 16), xf(ex - 0.62, top + 0.32, front + 0.3), "Coffee grinder");
  ctx.g(z, "orange").add(new Geo().add(cylinder(0.09, 0.28, 16)).add(lathe([[0.001, 0], [0.12, 0.02], [0.12, 0.05]], 16), xf(0, 0.28, 0)), xf(bx0 + 0.5, top, front + 0.28), "Citrus juicer");
  fruitBowl(ctx, z, new Vector3(bx0 + 0.95, top, front + 0.28), r);
  cakeStand(ctx, z, new Vector3(bx0 + 1.45, top, front + 0.28));
  for (let i = 0; i < 3; i++) jar(ctx, z, new Vector3(doorsEnd - 0.2 - i * 0.2, top, front + 0.32), 0.07 + (i % 2) * 0.015, 0.2 + i * 0.03, i % 2 ? "cookie" : "coffeeBean");

  // wall above: two lit niches of bottles, jars and plants either side of the chimp poster
  const nw = Math.min(1.75, (bx1 - bx0 - 1.25) / 2);
  barNiche(ctx, z, bx0 + 0.05 + nw / 2, backZ, nw, r, 0);
  barNiche(ctx, z, bx1 - 0.05 - nw / 2, backZ, nw, r, 1);
  panel(ctx, z, screenMat(ctx, "lounge-poster", 0.9), new Vector3(bm, 2.15, backZ - 0.04), 0.66, 0.92, 0, -1, "Framed chimp poster", { mat: "timberDark", pad: 0.06, depth: 0.04 });
  ctx.g(z, "brass").add(new Geo().add(box(0.05, 0.05, 0.16), xf(0, 0, 0.08)).add(cylinder(0.025, 0.42, 12), xf(0, 0, 0, 0, 1, 1, 1, 0, Math.PI / 2).multiply(xf(0.21, 0, 0))), xf(bm, 2.75, backZ - 0.18), "Picture light");
  ctx.g(z, "bulb", { castShadow: false }).add(box(0.38, 0.01, 0.03), xf(bm, 2.725, backZ - 0.18), "Picture light");

  // counter: fluted front, stone top with an overhang, the bartender's work shelf behind,
  // a brass foot rail in front; straight run, then a curve back to the wall at the west end
  const rr = 0.9;
  const plan: P2[] = [{ x: ce, z: cz }, { x: cw, z: cz }];
  for (let i = 1; i <= 12; i++) {
    const a = ((270 - (i / 12) * 90) * Math.PI) / 180;
    plan.push({ x: cw + Math.cos(a) * rr, z: cz + rr + Math.sin(a) * rr });
  }
  plan.push({ x: cw - rr, z: front - 0.01 });
  const path = at(resample(plan, 0.1), 0);
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
  ledAlong(ctx, z, plan, -0.42, 0.995, "amberStrip", "Bar light");
  ledAlong(ctx, z, plan, -0.32, 0.12, "mint", "Bar light");
  // foot rail on brackets
  const railPlan = offsetPlan(plan.slice(0, -1), -0.52);
  ctx.g(z, "brass").add(tube(at(resample(railPlan, 0.1), 0.22), 0.025, 10, true), undefined, "Foot rail");
  const brackets = new Geo();
  for (const p of resample(railPlan, 0.9)) brackets.add(box(0.03, 0.22, 0.03), xf(p.x, 0.11, p.z));
  ctx.g(z, "brass").add(brackets, undefined, "Foot rail");

  // on the counter: taps, menu, napkins, a plant, juice glasses, a candle
  const tx = (ce + cw) / 2 + 0.25;
  tapTower(ctx, z, xf(tx, 1.08, cz + 0.05));
  menuStand(ctx, z, xf(cw + 0.6, 1.08, cz - 0.18, 0.2));
  menuStand(ctx, z, xf(ce - 0.45, 1.08, cz - 0.18, -0.2));
  ctx.g(z, "steel").add(box(0.12, 0.1, 0.06), xf(tx - 0.75, 1.13, cz - 0.15), "Napkin holder");
  ctx.g(z, "paper", { castShadow: false }).add(box(0.1, 0.08, 0.04), xf(tx - 0.75, 1.15, cz - 0.15));
  pottedPlant(ctx, z, new Vector3(cw - 0.55, 1.08, cz + 0.42), "bromeliad", { pot: "terracotta", potR: 0.08, potH: 0.12, scale: 0.4, r });
  for (const [dx, dz] of [
    [-0.35, -0.2],
    [0.75, -0.24],
    [0.85, -0.12],
  ])
    juiceGlass(ctx, z, new Vector3(tx + dx, 1.08, cz + dz));
  candle(ctx, z, new Vector3(ce + 0.25, 1.08, cz - 0.1));
  // bartender's side: sink, cutting board with limes, a glass rack, shaker
  const wz = cz + 0.38;
  ctx.g(z, "steel").add(box(0.45, 0.01, 0.34), xf(tx - 0.3, 0.905, wz), "Bar sink");
  ctx.g(z, "chrome").add(beam([new Vector3(tx - 0.3, 0.9, wz + 0.2), new Vector3(tx - 0.3, 1.18, wz + 0.2), new Vector3(tx - 0.3, 1.18, wz + 0.06)], 0.02, 0.02), undefined, "Bar tap");
  ctx.g(z, "timber").add(box(0.36, 0.025, 0.24), xf(tx + 0.4, 0.913, wz), "Cutting board");
  for (let i = 0; i < 3; i++) ctx.g(z, "ceramicSage", { castShadow: false }).add(sphere(0.03, 10, 8), xf(tx + 0.32 + i * 0.07, 0.95, wz + (i % 2) * 0.05), "Limes");
  for (let i = 0; i < 8; i++) ctx.g(z, "glass", { castShadow: false, pickable: false }).add(cylinder(0.035, 0.12, 10, false), xf(cw + 0.2 + (i % 4) * 0.09, 0.9, wz - 0.05 + Math.floor(i / 4) * 0.09), "Glass rack");
  ctx.g(z, "chrome").add(lathe([[0.001, 0], [0.04, 0], [0.045, 0.16], [0.03, 0.2], [0.012, 0.24], [0.001, 0.24]], 14), xf(tx + 0.8, 0.9, wz + 0.05), "Cocktail shaker");

  // stools along the front and one at the curve (far enough out that a sitter's feet hang clear of the bar's front)
  const stools: P2[] = [];
  const n = Math.max(3, Math.floor((ce - cw - 0.3) / 0.7) + 1);
  for (let i = 0; i < n; i++) stools.push({ x: ce - 0.35 - i * ((ce - cw - 0.5) / (n - 1)), z: cz - 0.94 });
  const sa = (225 * Math.PI) / 180;
  stools.push({ x: cw + Math.cos(sa) * (rr + 0.94), z: cz + rr + Math.sin(sa) * (rr + 0.94) });
  for (const p of stools) stool(ctx, z, new Vector3(p.x, F, p.z), 0.75, "tealBright", "Bar stool");
  for (let i = 0; i < 3; i++) wovenPendant(ctx, z, new Vector3(cw + 0.4 + i * ((ce - cw - 0.8) / 2), C, cz - 0.05), 0.22, 1.7, { shape: "teardrop" });
}











// ------------------------------------------------------------------ lounge pieces



/** Slim high counter along the front glass with stools facing the view. */
function windowCounter(ctx: WorldCtx, z: Zone, xa: number, xb: number, zc: number, r: Rand) {
  const x0 = Math.min(xa, xb);
  const x1 = Math.max(xa, xb);
  const w = x1 - x0;
  const xm = (x0 + x1) / 2;
  ctx.g(z, "timber").add(box(w, 0.05, 0.42), xf(xm, 1.05, zc), "Window counter");
  const legs = new Geo();
  for (const x of [x0 + 0.15, xm, x1 - 0.15]) legs.add(box(0.05, 1.03, 0.05), xf(x, 0.515, zc - 0.05));
  ctx.g(z, "black").add(legs, undefined, "Window counter");
  ctx.g(z, "brass").add(tube([new Vector3(x0 + 0.1, 0.25, zc + 0.02), new Vector3(x1 - 0.1, 0.25, zc + 0.02)], 0.018, 8, true), undefined, "Foot rail");
  ctx.g(z, "amberStrip", { castShadow: false }).add(box(w - 0.1, 0.012, 0.02), xf(xm, 1.02, zc + 0.19), "Counter light");
  const n = Math.max(2, Math.floor(w / 0.85));
  for (let i = 0; i < n; i++) {
    const x = x0 + (w / n) * (i + 0.5);
    stool(ctx, z, new Vector3(x, F, zc + 0.62), 0.75, i % 2 ? "mustard" : "tealBright", "Counter stool");
  }
  const t = 1.075;
  ctx.g(z, "cream", { castShadow: false }).add(cylinder(0.04, 0.09, 10), xf(x0 + 0.5, t, zc + 0.05), "Mug");
  juiceGlass(ctx, z, new Vector3(x0 + 1.4, t, zc + 0.06));
  pottedPlant(ctx, z, new Vector3(xm, t, zc - 0.05), "calathea", { pot: "terracotta", potR: 0.08, potH: 0.12, scale: 0.35, r });
  // binoculars for spotting wildlife
  const bin = new Geo().add(cylinder(0.025, 0.12, 12), xf(-0.03, 0, 0, 0, 1, 1, 1, Math.PI / 2)).add(cylinder(0.025, 0.12, 12), xf(0.03, 0, 0, 0, 1, 1, 1, Math.PI / 2));
  ctx.g(z, "black").add(bin, xf(x1 - 0.9, t + 0.03, zc - 0.02, 0.4), "Binoculars");
  // a laptop left open on the counter
  const lm = xf(x1 - 0.35, t, zc, 0.15);
  ctx.g(z, "steel").add(box(0.32, 0.012, 0.22), xf(0, 0.006, 0).multiply(lm), "Laptop");
  ctx.g(z, "steel").add(box(0.32, 0.21, 0.01), xf(0, 0.105, 0.11, 0, 1, 1, 1, -0.25).multiply(lm), "Laptop");
  ctx.g(z, canvasMat(ctx, "chart:loungeLaptop", chartCanvas(733, "lines"), 0.9), { castShadow: false }).add(plane(0.28, 0.17), xf(0, 0.105, 0.103, 0, 1, 1, 1, -0.25).multiply(lm), "Laptop");
}

/** Chess table with two armchairs, a game in progress. Base at p. */
function chessNook(ctx: WorldCtx, z: Zone, p: Vector3, r: Rand) {
  if (!ctx.mats.has("chessBoard")) {
    const { canvas, ctx: g } = makeCanvas(512, 512);
    g.fillStyle = "#3b2a1c";
    g.fillRect(0, 0, 512, 512);
    const s = 56;
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++) {
        g.fillStyle = (i + j) % 2 ? "#5a3a22" : "#e9d8b4";
        g.fillRect(32 + i * s, 32 + j * s, s, s);
      }
    ctx.mats.pbr("chessBoard", { tex: toTexture(ctx.scene, "chessBoard", canvas, { wrap: false }), rough: 0.35 });
  }
  ctx.g(z, "timberDark").add(new Geo().add(cylinder(0.25, 0.03, 20)).add(cylinder(0.05, 0.68, 12), xf(0, 0.03, 0)), xf(p.x, p.y, p.z), "Chess table");
  ctx.g(z, "timber").add(box(0.72, 0.04, 0.72), xf(p.x, p.y + 0.72, p.z), "Chess table");
  ctx.g(z, "chessBoard", { castShadow: false }).add(plane(0.62, 0.62), xf(p.x, p.y + 0.742, p.z, 0, 1, 1, 1, Math.PI / 2), "Chess board");
  const sq = 0.62 / 9.14;
  const piece = (i: number, j: number, white: boolean, tall: number) => {
    const h = 0.035 + tall * 0.03;
    const prof: [number, number][] = [
      [0.001, 0],
      [0.016, 0],
      [0.016, 0.006],
      [0.009, 0.014],
      [0.007, h * 0.75],
      [0.011, h * 0.82],
      [0.009 + tall * 0.002, h],
      [0.001, h + 0.004],
    ];
    ctx.g(z, white ? "cream" : "black", { castShadow: false }).add(lathe(prof, 12), xf(p.x + (i - 3.5) * sq, p.y + 0.742, p.z + (j - 3.5) * sq), "Chess piece");
  };
  for (let i = 0; i < 8; i++) {
    if (r() > 0.25) piece(i, i === 3 ? 3 : 1, true, 0);
    if (r() > 0.25) piece(i, i === 4 ? 4 : 6, false, 0);
  }
  for (const [i, j, w, t] of [
    [4, 0, true, 2],
    [3, 0, true, 1.6],
    [0, 0, true, 1],
    [6, 2, true, 1.2],
    [4, 7, false, 2],
    [3, 7, false, 1.6],
    [7, 7, false, 1],
    [2, 5, false, 1.2],
  ] as [number, number, boolean, number][])
    piece(i, j, w, t);
  for (const s of [-1, 1]) {
    const cx = p.x + s * 0.95;
    armchair(ctx, z, new Vector3(cx, p.y, p.z), faceToward(cx, p.z, p.x, p.z), s < 0 ? "mustard" : "teal", s < 0 ? "teal" : "mustard");
  }
}
