// Trading Room (lower level, rear-left). The simulated-market wall and curved
// command desk from the concept render, a pod of four trader desks around a
// planter, a lit built-in bookcase with world clocks above, a stock ticker, a
// coffee sideboard, a high table, a window lounge, and plenty of planting. The
// door is in the south wall beside the stair core, off the passage from the hall.

import { Matrix, Vector3 } from "@babylonjs/core";
import { P2, rng } from "../geometry/curves";
import { Geo, at, beam, box, cylinder, lathe, plane, softBox, sphere, sweep, torus, tube, xf } from "../geometry/geo";
import { WorldCtx, Zone, zone } from "../context";
import { LEVEL, TRADING, TRADING_DOOR } from "../layout";
import { makeCanvas } from "../materials/canvas";
import { roomSignCanvas } from "../materials/signs";
import { armchair, drumTable, rectRug, roundRug, sofa, stool } from "../props/furniture";
import { sconce, wovenPendant } from "../props/lights";
import { Rand, clump, planterBox, pottedPlant, vine } from "../props/plants";
import { floorLamp, floorPlanter, hangingPlanter } from "../props/decor";
import { Leaf } from "../materials/leaves";
import { canvasMat, chartCanvas, keyboard, monitor, screenMat, screenPanel, taskChair } from "../props/tech";
import { archPath } from "../structure/entrance";
import { K, arcDeg, faceToward, faceYaw, interiorArch, panel, roomLight } from "./common";
import { rugs } from "./rugs";

const F = LEVEL.lower + 0.012;
const C = LEVEL.lowerCeil;

/** World position of a point given in an object's local frame. */
const pt = (m: Matrix, x: number, y: number, z: number) => Vector3.TransformCoordinates(new Vector3(x, y, z), m);

function ensureMats(ctx: WorldCtx) {
  const m = ctx.mats;
  const add = (key: string, color: string, rough = 0.7, metal = 0) => {
    if (!m.has(key)) m.pbr(key, { color, rough, metal });
  };
  add("bookRed", "#8e3b2e");
  add("bookGreen", "#3f5d45");
  add("bookNavy", "#2c3a55");
  add("bookBrown", "#6b4a2f");
  add("bookCream", "#e6d8b8");
  add("bookOchre", "#c18c3a");
  add("chimpFur", "#3a2a20", 0.85);
  add("chimpFace", "#9b7a5e", 0.7);
  add("globeSea", "#2f6f74", 0.45);
  add("ceramicSage", "#9fb39a", 0.4);
  add("lampGreen", "#1f5e3c", 0.25);
  add("bananaYellow", "#f2c94c", 0.55);
  add("paper", "#efe9dc", 0.9);
}

export function buildTrading(ctx: WorldCtx): void {
  const z = zone("tradingRoom", "lower");
  const r = rng(41);
  ensureMats(ctx);
  const { c, x0, x1, z0 } = TRADING;

  tradingEntrance(ctx, z);

  // ---------------------------------------------------------------- market wall
  const wallX = x1 - 0.12;
  const dcz = z0 + 4.85; // display centre, clear of the curved north-east corner
  screenPanel(ctx, z, xf(wallX, 2.7, dcz, faceYaw(-1, 0)), 6.6, 2.81, screenMat(ctx, "trading-wall", 1.1), { bezel: 0.05, depth: 0.08, label: "Simulated market wall display" });
  // scrolling ticker on a slim dark rail above the display
  canvasMat(ctx, "tradingTicker", tickerCanvas(), 1.25);
  ctx.mats.glowing.add("tradingTicker");
  ctx.g(z, "black").add(box(0.06, 0.3, 6.8), xf(wallX + 0.02, 4.37, dcz), "Stock ticker");
  panel(ctx, z, "tradingTicker", new Vector3(wallX - 0.015, 4.37, dcz), 6.6, 0.226, -1, 0, "Stock ticker");

  // ---------------------------------------------------------------- command desk
  const R = 2.9 * Math.sqrt(K);
  const desk = arcDeg(wallX, dcz, R, 128, 232, 36);
  ctx.g(z, "timber").add(sweep([[0.4, -0.025], [0.4, 0.025], [-0.4, 0.025], [-0.4, -0.025]], at(desk, 0.75), { caps: true }), undefined, "Curved trading desk");
  ctx.g(z, "panelHoney").add(sweep([[0.38, -0.36], [0.38, 0.0], [0.3, 0.0], [0.3, -0.36]], at(desk, 0.72), { caps: true }), undefined, "Curved trading desk");
  ledStripPath(ctx, z, desk, -0.42, 0.7);
  for (const a of [151, 180, 209]) {
    const p = arcDeg(wallX, dcz, R - 0.05, a, a, 1)[0];
    const yaw = faceToward(p.x, p.z, wallX, dcz) + Math.PI;
    const m = xf(p.x, 0.775, p.z, yaw);
    pedestal(ctx, z, xf(p.x, 0, p.z, yaw).multiply(xf(0.45, 0, 0.02)));
    const kinds = ["candles", "lines", "map", "table"] as const;
    for (const [dx, rot] of [
      [-0.58, 0.3],
      [0, 0],
      [0.58, -0.3],
    ]) {
      const key = canvasMat(ctx, `chart:${a}:${dx}`, chartCanvas(Math.round(a * 10 + dx * 100 + 7), kinds[Math.floor(r() * kinds.length)]), 0.95);
      monitor(ctx, z, xf(dx, 0, 0.18, rot).multiply(m), 0.56, 0.34, key, "Trading monitor");
    }
    keyboard(ctx, z, xf(0, 0, -0.15).multiply(m));
    ctx.g(z, "black", { castShadow: false }).add(cylinder(0.04, 0.1, 10), xf(0.5, 0, -0.1).multiply(m), "Mug");
    ctx.g(z, "paper", { castShadow: false }).add(box(0.16, 0.012, 0.22), xf(-0.5, 0.006, -0.12, 0.2).multiply(m), "Notepad");
    const cp = arcDeg(wallX, dcz, R + 0.85, a, a, 1)[0];
    taskChair(ctx, z, xf(cp.x, F, cp.z, faceToward(cp.x, cp.z, wallX, dcz)), "sage");
  }
  // plants and a desk lamp at the desk ends
  for (const [a, kind] of [
    [131, "calathea"],
    [229, "fern"],
  ] as const) {
    const p = arcDeg(wallX, dcz, R - 0.05, a, a, 1)[0];
    pottedPlant(ctx, z, new Vector3(p.x, 0.775, p.z), kind, { pot: "terracotta", potR: 0.1, potH: 0.16, scale: 0.55, r });
  }
  bankerLamp(ctx, z, (() => {
    const p = arcDeg(wallX, dcz, R + 0.15, 137, 137, 1)[0];
    return xf(p.x, 0.775, p.z, faceToward(p.x, p.z, wallX, dcz) + Math.PI);
  })());

  // ---------------------------------------------------------------- trader pod
  const px = c.x - 1.2;
  const pz = z0 + 4.45;
  traderPod(ctx, z, px, pz, r);

  // ---------------------------------------------------------------- bookcase wall
  const bcW = 4.1;
  const bcX = (c.x + 0.2 + (TRADING_DOOR.x - TRADING_DOOR.w / 2 - 0.1)) / 2 - 0.05;
  const bcM = xf(bcX, 0, z0 + 0.21, Math.PI);
  bookcase(ctx, z, bcM, bcW, 2.75, r);
  // world clocks above it
  const clocks: [string, number, number][] = [
    ["NEW YORK", 10, 10],
    ["LONDON", 15, 10],
    ["TOKYO", 23, 10],
  ];
  clocks.forEach(([city, hh, mm], i) => wallClock(ctx, z, new Vector3(bcX + (i - 1) * 1.25, 3.5, z0 + 0.03), city, hh, mm));
  roomLight(ctx, "tradingRoom", "lower", new Vector3(bcX, 2.2, z0 + 1.3), 1, 4, 5, "#ffc98a");

  // ---------------------------------------------------------------- coffee sideboard (north-east)
  {
    const nc = { x: x1 - 3.3, z: TRADING.z1 - 3.3 }; // centre of the rounded north-east corner
    const a = (28 * Math.PI) / 180;
    const p = { x: nc.x + Math.cos(a) * 3.0, z: nc.z + Math.sin(a) * 3.0 };
    coffeeStation(ctx, z, xf(p.x, F, p.z, faceToward(p.x, p.z, nc.x, nc.z)), r);
    const b = (60 * Math.PI) / 180;
    floorPlanter(ctx, z, new Vector3(nc.x + Math.cos(b) * 2.8, F, nc.z + Math.sin(b) * 2.8), "banana", "potCharcoal", r);
  }

  // ---------------------------------------------------------------- window lounge (north-west)
  const sofaR = TRADING.r - 0.75;
  const mid = arcDeg(c.x, c.z, sofaR, 125, 125, 1)[0];
  const toC = { x: (c.x - mid.x) / sofaR, z: (c.z - mid.z) / sofaR };
  const lc = { x: mid.x + toC.x * 1.5, z: mid.z + toC.z * 1.5 };
  roundRug(ctx, z, new Vector3(lc.x, F, lc.z), 1.5, rugs.smallJute(ctx));
  sofa(ctx, z, arcDeg(c.x, c.z, sofaR, 100, 150, 14), { mat: "teal", r, pillows: ["mustard", "coral", "sage"], label: "Window sofa" });
  drumTable(ctx, z, new Vector3(lc.x, F, lc.z), 0.42, 0.42);
  ctx.g(z, "paper", { castShadow: false }).add(box(0.3, 0.01, 0.42), xf(lc.x - 0.05, 0.43, lc.z, 0.4), "Market newspaper");
  ctx.g(z, "black", { castShadow: false }).add(cylinder(0.04, 0.1, 10), xf(lc.x + 0.18, 0.425, lc.z - 0.1), "Mug");
  const ac = { x: lc.x + toC.x * 1.15, z: lc.z + toC.z * 1.15 };
  armchair(ctx, z, new Vector3(ac.x, F, ac.z), faceToward(ac.x, ac.z, lc.x, lc.z), "sage", "mustard");
  const fl = arcDeg(c.x, c.z, TRADING.r - 0.5, 158, 158, 1)[0];
  floorLamp(ctx, z, new Vector3(fl.x, F, fl.z));

  // ---------------------------------------------------------------- huddle table (south-west)
  const ht = { x: c.x - 1.9, z: z0 + 1.75 };
  highTable(ctx, z, new Vector3(ht.x, F, ht.z), r);
  for (const s of [-1, 1]) stool(ctx, z, new Vector3(ht.x + s * 0.62, F, ht.z), 0.74, "tealBright", "Bar stool");

  // ---------------------------------------------------------------- planting
  for (const [a, kind, mat] of [
    [168, "monstera", "potCream"],
    [189, "banana", "potCharcoal"],
    [222, "elephant", "potCream"],
  ] as const) {
    const p = arcDeg(c.x, c.z, TRADING.r - 0.55, a, a, 1)[0];
    floorPlanter(ctx, z, new Vector3(p.x, F, p.z), kind, mat, r);
  }
  for (const p of [
    { x: c.x - 3.7, z: c.z - 0.2 },
    { x: c.x + 0.8, z: TRADING.z1 - 0.8 },
    { x: c.x - 2.7, z: z0 + 2.4 },
    { x: x1 - 1.6, z: z0 + 1.6 },
  ])
    hangingPlanter(ctx, z, new Vector3(p.x, C, p.z), 1.6, r);

  // arch across the room with vines trailing from it
  const A = { x: x1 - 3.9, z: TRADING.z1 - 0.85 };
  const B = { x: x0 + 0.8, z: c.z - 1.4 * K };
  interiorArch(ctx, "tradingRoom", "lower", A, B, 0, C - 0.05, 0.36);
  const ap = archPath([A, B], 0, C - 0.05, 0.36);
  ap.forEach((p, i) => {
    if (p.y < 3.4 || i % 3 || r() > 0.75) return;
    vine(ctx, z, p.add(new Vector3(0, -0.22, 0)), 0.4 + r() * 1.3, r, { density: 11 });
  });

  // ---------------------------------------------------------------- lights
  for (const [dx, dz] of [
    [-1.6, -1.6],
    [-2.2, 0],
    [-1.6, 1.6],
  ])
    wovenPendant(ctx, z, new Vector3(wallX + dx * K, C, dcz + dz * K), 0.3, 1.1);
  for (const s of [-1, 1]) wovenPendant(ctx, z, new Vector3(px, C, pz + s * 0.8), 0.28, 1.25, { shape: "drum" });
  wovenPendant(ctx, z, new Vector3(lc.x, C, lc.z), 0.34, 1.0, { shape: "teardrop" });
  roomLight(ctx, "tradingRoom", "lower", new Vector3(c.x + 2.0, 3.4, c.z), 4, 14, 10);
  roomLight(ctx, "tradingRoom", "lower", new Vector3(px, 3.0, pz), 1.5, 6, 7);
  roomLight(ctx, "tradingRoom", "lower", new Vector3(wallX - 1.0, 2.6, dcz), 1.5, 5, 5, "#ffd6a0");
}

// ------------------------------------------------------------------ entrance

/** Doorway in the south wall: glulam lining, a glazed door standing open, sign and lantern outside. */
function tradingEntrance(ctx: WorldCtx, z: Zone) {
  const { x: dx, w, h } = TRADING_DOOR;
  const zw = TRADING.z0; // inner face of the south wall
  const zo = zw - 0.18; // passage face
  const zc = (zw + zo) / 2;
  const e0 = dx - w / 2;
  const e1 = dx + w / 2;
  ctx.g(z, "panelHoney").add(box(w + 0.5, C - h, 0.18), xf(dx, (h + C) / 2, zc), "Trading Room entrance wall");
  const lining = ctx.g(z, "glulam");
  lining.setLabel("Trading Room doorway");
  const depth = 0.28;
  lining.add(box(0.2, h + 0.2, depth), xf(e0 - 0.1, (h + 0.2) / 2, zc));
  lining.add(box(0.2, h + 0.2, depth), xf(e1 + 0.1, (h + 0.2) / 2, zc));
  lining.add(box(w + 0.4, 0.2, depth), xf(dx, h + 0.1, zc));
  ctx.g(z, "timberDark").add(box(w, 0.02, depth), xf(dx, 0.01, zc), "Threshold");
  // glazed timber door hinged on the east jamb, standing open into the room
  const lw = w - 0.04;
  const leaf = new Geo();
  leaf.add(box(0.08, h - 0.03, 0.05), xf(-0.04, (h - 0.03) / 2, 0));
  leaf.add(box(0.08, h - 0.03, 0.05), xf(-lw + 0.04, (h - 0.03) / 2, 0));
  leaf.add(box(lw, 0.2, 0.05), xf(-lw / 2, 0.1, 0));
  leaf.add(box(lw, 0.09, 0.05), xf(-lw / 2, h - 0.075, 0));
  const dm = xf(e1 - 0.02, 0, zw + 0.03, (95 * Math.PI) / 180);
  ctx.g(z, "timberDark").add(leaf, dm, "Trading Room door");
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(box(lw - 0.16, h - 0.32, 0.012), xf(-lw / 2, 0.2 + (h - 0.32) / 2, 0).multiply(dm));
  for (const s of [-1, 1]) ctx.g(z, "brass").add(box(0.025, 0.55, 0.025), xf(-lw + 0.13, 1.05, s * 0.055).multiply(dm), "Door handle");
  // sign over the doorway and a lantern beside it, on the passage face
  canvasMat(ctx, "sign:trading", roomSignCanvas("TRADING ROOM", { w: 1024, h: 200, font: "600 92px Montserrat" }), 1.0);
  panel(ctx, z, "sign:trading", new Vector3(dx, h + 0.55, zo - 0.06), 1.7, (1.7 * 200) / 1024, 0, -1, "Sign: TRADING ROOM", { mat: "timberDark", pad: 0.03, depth: 0.05 });
  sconce(ctx, z, new Vector3(e0 - 0.5, 2.0, zo - 0.12), faceYaw(0, -1));
  ctx.lights.push({ pos: new Vector3(dx - 0.6, 3.0, zo - 0.65), color: "#ffb766", day: 2, night: 6, range: 6, rooms: ["tradingRoom", "arrivalLounge", "structure", "entryHall", "core"], level: "lower" });
  // doormat just inside
  rectRug(ctx, z, new Vector3(dx - 0.25, F, zw + 0.75), 1.2, 0.75, 0, rugs.knit(ctx), "Doormat");
}

// ------------------------------------------------------------------ desks

/** Drawer pedestal under a desk, three drawers with brass pulls. Base at m, fronts facing -Z. */
function pedestal(ctx: WorldCtx, z: Zone, m: Matrix) {
  ctx.g(z, "panelHoney").add(box(0.42, 0.7, 0.55), xf(0, 0.35, 0).multiply(m), "Desk pedestal");
  const pulls = new Geo();
  const fronts = new Geo();
  for (let i = 0; i < 3; i++) {
    const y = 0.13 + i * 0.22;
    fronts.add(box(0.38, 0.2, 0.012), xf(0, y, -0.28));
    pulls.add(box(0.14, 0.014, 0.018), xf(0, y + 0.05, -0.292));
  }
  ctx.g(z, "timber").add(fronts, m, "Desk pedestal");
  ctx.g(z, "brass").add(pulls, m);
}

/**
 * Trader desk, 1.5 m by 0.75 m. Local frame: desk centred at the origin, the
 * trader sits on the -Z side and the monitors face them from the +Z side.
 */
function traderDesk(ctx: WorldCtx, z: Zone, m: Matrix, seed: number, r: Rand, o: { lamp?: boolean; plant?: boolean; three?: boolean }) {
  const top = 0.75;
  ctx.g(z, "timber").add(box(1.5, 0.04, 0.75), xf(0, top - 0.02, 0).multiply(m), "Trader desk");
  const body = new Geo();
  for (const s of [-1, 1]) body.add(box(0.04, top - 0.04, 0.7), xf(s * 0.72, (top - 0.04) / 2, 0));
  body.add(box(1.4, 0.38, 0.02), xf(0, 0.45, 0.33));
  ctx.g(z, "panelHoney").add(body, m, "Trader desk");
  pedestal(ctx, z, xf(0.45, 0, 0.04).multiply(m));
  ctx.g(z, "mint", { castShadow: false }).add(box(1.4, 0.014, 0.02), xf(0, top - 0.05, -0.37).multiply(m), "Desk light");
  const kinds = ["candles", "lines", "map", "table"] as const;
  const mons: [number, number][] = o.three
    ? [
        [-0.5, 0.32],
        [0, 0],
        [0.5, -0.32],
      ]
    : [
        [-0.3, 0.16],
        [0.3, -0.16],
      ];
  mons.forEach(([dx, rot], i) => {
    const key = canvasMat(ctx, `chart:pod:${seed}:${i}`, chartCanvas(seed * 31 + i * 7 + 3, kinds[(seed + i) % kinds.length]), 0.95);
    monitor(ctx, z, xf(dx, top, 0.2, rot).multiply(m), o.three ? 0.48 : 0.6, o.three ? 0.3 : 0.36, key, "Trading monitor");
  });
  keyboard(ctx, z, xf(-0.05, top, -0.12).multiply(m));
  ctx.g(z, r() > 0.5 ? "cream" : "tealBright", { castShadow: false }).add(cylinder(0.04, 0.1, 10), xf(0.5, top, -0.18).multiply(m), "Mug");
  ctx.g(z, "paper", { castShadow: false }).add(box(0.16, 0.012, 0.22), xf(-0.55, top + 0.006, -0.15, 0.25).multiply(m), "Notepad");
  ctx.g(z, "black", { castShadow: false }).add(box(0.075, 0.009, 0.15), xf(0.3, top + 0.005, -0.25, -0.3).multiply(m), "Phone");
  if (o.lamp) bankerLamp(ctx, z, xf(-0.6, top, 0.18).multiply(m));
  if (o.plant) pottedPlant(ctx, z, pt(m, 0.62, top, 0.2), r() > 0.5 ? "calathea" : "philodendron", { pot: "terracotta", potR: 0.07, potH: 0.12, scale: 0.4, r });
  taskChair(ctx, z, xf(0, F, -0.82, Math.PI).multiply(m), "sage");
}

/** Four trader desks back to back around a planter, on a rug. */
function traderPod(ctx: WorldCtx, z: Zone, px: number, pz: number, r: Rand) {
  rectRug(ctx, z, new Vector3(px, F, pz), 4.4, 3.4, 0, rugs.knitTeal(ctx), "Trading floor rug");
  // planter running down the middle, rising just above the desks, planted with
  // upright snake plants that stand clear of the monitors either side
  const len = 3.04;
  const soil = planterBox(ctx, z, xf(px, F, pz, Math.PI / 2), len, 1.0, 0.34, "timberDark", "Desk planter");
  const n = 6;
  for (let i = 0; i < n; i++) {
    const zz = pz - len / 2 + 0.3 + (i * (len - 0.6)) / (n - 1);
    clump(ctx, z, new Vector3(px, F + soil, zz), { type: Leaf.Cordyline, count: 8, size: [0.42, 0.64], tilt: [0.0, 0.1], r, spread: 0.05, widthScale: 0.8 });
  }
  // low moss over the soil between them
  for (let i = 0; i < 8; i++) clump(ctx, z, new Vector3(px, F + soil, pz - len / 2 + 0.2 + (i * (len - 0.4)) / 7), { type: Leaf.Fern, count: 5, size: [0.1, 0.16], tilt: [0.7, 0.9], r, spread: 0.04 });
  // desks: the west pair faces east toward the market wall, the east pair faces west
  let seed = 1;
  for (const side of [-1, 1]) {
    for (const s of [-1, 1]) {
      const m = xf(px + side * 0.575, 0, pz + s * 0.76, side < 0 ? Math.PI / 2 : -Math.PI / 2);
      traderDesk(ctx, z, m, seed, r, { lamp: seed === 2 || seed === 3, three: seed === 1 });
      seed++;
    }
  }
}

/** Banker's lamp: brass base and stem, green glass shade, warm glow. Base at m. */
function bankerLamp(ctx: WorldCtx, z: Zone, m: Matrix) {
  ctx.g(z, "brass", { castShadow: false }).add(new Geo().add(cylinder(0.07, 0.02, 16)).add(cylinder(0.012, 0.3, 8), xf(0, 0.02, 0.04)).add(box(0.012, 0.012, 0.06), xf(0, 0.31, 0.01)), m, "Desk lamp");
  const shade = lathe([[0.001, -0.03], [0.05, -0.03], [0.055, 0.03], [0.001, 0.035]], 16);
  ctx.g(z, "lampGreen", { castShadow: false }).add(shade, xf(0, 0.3, -0.02, 0, 1, 1, 1, 0, Math.PI / 2).multiply(xf(0, 0, 0, 0, 1, 1, 3.4)).multiply(m), "Desk lamp");
  ctx.g(z, "bulb", { castShadow: false }).add(box(0.18, 0.008, 0.06), xf(0, 0.262, -0.02).multiply(m));
}

/** Ledge strip following a plan path, offset sideways. */
function ledStripPath(ctx: WorldCtx, z: Zone, plan: P2[], offset: number, y: number) {
  const pts = plan.map((p, i) => {
    const a = plan[Math.max(0, i - 1)];
    const b = plan[Math.min(plan.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    return new Vector3(p.x + (tz / l) * offset, y, p.z - (tx / l) * offset);
  });
  ctx.g(z, "mint", { castShadow: false }).add(beam(pts, 0.025, 0.02), undefined, "Mint desk light");
}

// ------------------------------------------------------------------ bookcase

/**
 * Built-in bookcase: cupboards below, three lit bays of open shelving above
 * with a dark back, filled with books, plants, figurines and keepsakes.
 * Local frame: centred on x, standing on y = 0, front facing -Z.
 */
function bookcase(ctx: WorldCtx, z: Zone, m: Matrix, W: number, H: number, r: Rand) {
  const D = 0.4;
  const base = 0.8;
  const bays = 3;
  const inner = W - 0.1;
  const bw = inner / bays;
  const bayX = (b: number) => -inner / 2 + bw * (b + 0.5);
  const rows = 4;
  const rowH = (H - 0.07 - base) / rows;

  const carcass = new Geo();
  carcass.add(box(W - 0.06, 0.08, D - 0.08), xf(0, 0.04, 0.03));
  carcass.add(box(W, base - 0.12, D - 0.02), xf(0, 0.08 + (base - 0.12) / 2, 0.01));
  for (const s of [-1, 1]) carcass.add(box(0.05, H - base, D), xf(s * (W / 2 - 0.025), base + (H - base) / 2, 0));
  carcass.add(box(W + 0.06, 0.07, D + 0.03), xf(0, H - 0.035, -0.015));
  for (let b = 1; b < bays; b++) carcass.add(box(0.04, H - base - 0.07, D - 0.02), xf(-inner / 2 + b * bw, base + (H - base - 0.07) / 2, 0.01));
  ctx.g(z, "timberDark").add(carcass, m, "Built-in bookcase");
  ctx.g(z, "panelDark").add(box(inner, H - base - 0.07, 0.02), xf(0, base + (H - base - 0.07) / 2, D / 2 - 0.02).multiply(m), "Built-in bookcase");
  const boards = new Geo();
  boards.add(box(W + 0.04, 0.045, D + 0.04), xf(0, base - 0.0225, -0.01));
  for (let k = 1; k < rows; k++) for (let b = 0; b < bays; b++) boards.add(box(bw - 0.04, 0.035, D - 0.05), xf(bayX(b), base + k * rowH - 0.0175, -0.005));
  ctx.g(z, "timber").add(boards, m, "Bookcase shelves");
  // cupboard doors with brass pulls
  const doors = new Geo();
  const pulls = new Geo();
  const nd = 4;
  const dw = (W - 0.06) / nd;
  for (let i = 0; i < nd; i++) {
    const cx = -W / 2 + 0.03 + dw * (i + 0.5);
    doors.add(box(dw - 0.02, base - 0.17, 0.025), xf(cx, 0.09 + (base - 0.17) / 2, -D / 2 - 0.0125));
    pulls.add(box(0.014, 0.16, 0.02), xf(cx + (i % 2 ? -1 : 1) * (dw / 2 - 0.07), 0.09 + (base - 0.17) * 0.72, -D / 2 - 0.035));
  }
  ctx.g(z, "panelHoney").add(doors, m, "Bookcase cupboards");
  ctx.g(z, "brass").add(pulls, m);
  // warm light under each shelf front
  const strips = new Geo();
  for (let k = 1; k <= rows; k++) for (let b = 0; b < bays; b++) strips.add(box(bw - 0.12, 0.012, 0.02), xf(bayX(b), base + k * rowH - (k === rows ? 0.0 : 0.035) - 0.012, -D / 2 + 0.05));
  ctx.g(z, "amberStrip", { castShadow: false }).add(strips, m, "Shelf light");

  // what goes on each shelf, bay by bay (bottom row first)
  type Item = "books" | "stack" | "plant" | "figurine" | "frame" | "lantern" | "trophy" | "globe" | "vases";
  const recipes: Item[][][] = [
    [["books", "stack"], ["frame", "lantern", "vases"], ["books", "trophy"]],
    [["plant", "books"], ["books", "figurine", "books"], ["globe", "stack", "books"]],
    [["stack", "figurine", "books"], ["books", "frame"], ["books", "plant"]],
    [["vases", "plant"], ["books", "lantern"], ["books", "stack"]],
  ];
  const fixed: Record<Exclude<Item, "books">, number> = { stack: 0.3, plant: 0.2, figurine: 0.17, frame: 0.3, lantern: 0.17, trophy: 0.22, globe: 0.24, vases: 0.3 };
  const deco = new Decor(ctx, z, m, r);
  for (let k = 0; k < rows; k++) {
    const y = base + k * rowH + (k ? 0 : 0.0);
    for (let b = 0; b < bays; b++) {
      const recipe = recipes[k][b];
      const fixedW = recipe.reduce((s, it) => s + (it === "books" ? 0 : fixed[it]), 0);
      const nBooks = recipe.filter((it) => it === "books").length;
      const gap = 0.05;
      const span = bw - 0.1;
      const bookW = nBooks ? (span - fixedW - gap * (recipe.length - 1)) / nBooks : 0;
      let x = bayX(b) - span / 2;
      for (const it of recipe) {
        const w = it === "books" ? bookW : fixed[it];
        deco.item(it, x, x + w, y, rowH - 0.06);
        x += w + gap;
      }
    }
  }
  // trailing plants on top, spilling down the front
  for (const s of [-1, 1]) {
    const p = pt(m, s * (W / 2 - 0.4), H, 0.02);
    pottedPlant(ctx, z, p, "philodendron", { pot: "terracotta", potR: 0.11, potH: 0.16, scale: 0.45, r });
    for (let i = 0; i < 4; i++) vine(ctx, z, pt(m, s * (W / 2 - 0.4) + (i - 1.5) * 0.08, H + 0.12, -0.12), 0.5 + r() * 0.8, r, { leaf: 0.07, density: 16 });
  }
}

/** Small objects placed along a shelf, in the shelf's local frame. */
class Decor {
  private readonly bookMats = ["bookRed", "bookGreen", "bookNavy", "bookBrown", "bookCream", "bookOchre", "teal", "sage", "rust", "mustard"];
  constructor(
    private ctx: WorldCtx,
    private z: Zone,
    private m: Matrix,
    private r: Rand,
  ) {}

  private add(mat: string, g: Geo, local: Matrix, label: string, shadow = false) {
    this.ctx.g(this.z, mat, { castShadow: shadow }).add(g, local.multiply(this.m), label);
  }

  item(kind: string, x0: number, x1: number, y: number, maxH: number) {
    const cx = (x0 + x1) / 2;
    const r = this.r;
    switch (kind) {
      case "books": {
        let x = x0;
        while (x < x1 - 0.035) {
          const bw = 0.026 + r() * 0.03;
          if (x + bw > x1) break;
          const bh = Math.min(maxH - 0.04, 0.2 + r() * 0.13);
          const bd = 0.19 + r() * 0.06;
          const zc = 0.16 - bd / 2;
          const mat = this.bookMats[Math.floor(r() * this.bookMats.length)];
          this.add(mat, box(bw, bh, bd), xf(x + bw / 2, y + bh / 2, zc), "Books");
          if (r() < 0.35) this.add(r() < 0.5 ? "brass" : "bookCream", box(bw + 0.002, 0.012, 0.004), xf(x + bw / 2, y + bh * 0.82, zc - bd / 2 - 0.001), "Books");
          x += bw + 0.003;
        }
        // one book leaning on the end of the row
        if (x < x1 - 0.06) {
          const bh = 0.24;
          this.add(this.bookMats[Math.floor(r() * this.bookMats.length)], box(0.035, bh, 0.21), xf(x + 0.06, y + bh / 2 * Math.cos(0.3), 0.055, 0, 1, 1, 1, 0, -0.3), "Books");
        }
        break;
      }
      case "stack": {
        let yy = y;
        const n = 3 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) {
          const h = 0.03 + r() * 0.02;
          this.add(this.bookMats[Math.floor(r() * this.bookMats.length)], box(0.22 + r() * 0.06, h, 0.16 + r() * 0.04), xf(cx, yy + h / 2, 0.03, (r() - 0.5) * 0.25), "Books");
          yy += h;
        }
        if (r() < 0.6) this.figurine(cx, yy, 0.6);
        else this.add("ceramicSage", lathe([[0.04, 0], [0.05, 0.06], [0.03, 0.12], [0.02, 0.13]], 14), xf(cx, yy, 0.03), "Vase");
        break;
      }
      case "plant": {
        const p = pt(this.m, cx, y, 0.02);
        pottedPlant(this.ctx, this.z, p, r() > 0.5 ? "philodendron" : "fern", { pot: r() > 0.5 ? "terracotta" : "cream", potR: 0.075, potH: 0.12, scale: 0.32, r });
        for (let i = 0; i < 2; i++) vine(this.ctx, this.z, pt(this.m, cx + (i - 0.5) * 0.08, y + 0.12, -0.08), 0.25 + r() * 0.35, r, { leaf: 0.055, density: 22 });
        break;
      }
      case "figurine":
        this.figurine(cx, y, 1);
        break;
      case "frame": {
        const fm = xf(cx, y + 0.17, 0.08, 0, 1, 1, 1, -0.12);
        this.add("brass", box(0.26, 0.32, 0.018), fm, "Picture frame", true);
        this.add(screenMat(this.ctx, "lounge-poster", 0.85), plane(0.21, 0.27), xf(0, 0, -0.011).multiply(fm), "Framed chimp print");
        this.add("timberDark", box(0.02, 0.2, 0.012), xf(cx, y + 0.1, 0.17, 0, 1, 1, 1, 0.35), "Picture frame");
        break;
      }
      case "lantern": {
        const g = new Geo().add(box(0.13, 0.02, 0.13), xf(0, 0.01, 0)).add(box(0.13, 0.02, 0.13), xf(0, 0.2, 0));
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ])
          g.add(box(0.012, 0.18, 0.012), xf(sx * 0.058, 0.11, sz * 0.058));
        g.add(lathe([[0.08, 0], [0.02, 0.07], [0.001, 0.08]], 4), xf(0, 0.21, 0, Math.PI / 4));
        g.add(torus(0.03, 0.004, 16, 4), xf(0, 0.31, 0, 0, 1, 1, 1, Math.PI / 2));
        this.add("brass", g, xf(cx, y, 0.03), "Brass lantern", true);
        this.add("bulb", box(0.09, 0.15, 0.09), xf(cx, y + 0.11, 0.03), "Brass lantern");
        break;
      }
      case "trophy": {
        this.add("black", box(0.16, 0.05, 0.09), xf(cx, y + 0.025, 0.04), "Golden banana trophy", true);
        const pts: Vector3[] = [];
        for (let i = 0; i <= 10; i++) {
          const a = -0.9 + (i / 10) * 1.8;
          pts.push(new Vector3(Math.sin(a) * 0.12, 0.05 + 0.13 - Math.cos(a) * 0.13 + 0.02, 0));
        }
        this.add("brass", tube(pts, (t) => 0.022 * Math.sin(Math.PI * (0.15 + t * 0.7)) + 0.004, 10), xf(cx, y + 0.03, 0.04, 0, 1, 1, 1, 0, 0), "Golden banana trophy", true);
        break;
      }
      case "globe": {
        this.add("brass", new Geo().add(cylinder(0.07, 0.02, 16)).add(cylinder(0.01, 0.06, 8), xf(0, 0.02, 0)), xf(cx, y, 0.03), "Globe", true);
        this.add("globeSea", sphere(0.09, 20, 14), xf(cx, y + 0.17, 0.03, 0, 1, 1, 1, 0, 0.4), "Globe", true);
        this.add("brass", torus(0.1, 0.006, 32, 4), xf(cx, y + 0.17, 0.03, Math.PI / 2, 1, 1, 1, 0, 0.4).multiply(xf(0, 0, 0, 0, 1, 1, 1, Math.PI / 2)), "Globe");
        break;
      }
      case "vases": {
        const prof = (h: number, w: number): [number, number][] => [
          [w * 0.6, 0],
          [w, h * 0.35],
          [w * 0.8, h * 0.75],
          [w * 0.45, h * 0.9],
          [w * 0.5, h],
        ];
        this.add("ceramicSage", lathe(prof(0.24, 0.055), 16), xf(cx - 0.08, y, 0.04), "Ceramic vase", true);
        this.add("potCream", lathe(prof(0.16, 0.05), 16), xf(cx + 0.03, y, 0.06), "Ceramic vase", true);
        this.add("terracotta", lathe(prof(0.11, 0.04), 16), xf(cx + 0.1, y, 0.0), "Ceramic vase", true);
        break;
      }
    }
  }

  /** Small seated chimp figurine at (x, y) in the shelf frame. */
  figurine(x: number, y: number, s: number) {
    const fur = new Geo();
    fur.add(sphere(0.055 * s, 12, 10), xf(0, 0.06 * s, 0, 0, 1, 1.15, 0.85));
    fur.add(sphere(0.04 * s, 12, 10), xf(0, 0.15 * s, -0.01 * s));
    for (const sx of [-1, 1]) {
      fur.add(sphere(0.014 * s, 8, 6), xf(sx * 0.042 * s, 0.158 * s, -0.005 * s));
      fur.add(sphere(0.022 * s, 8, 6), xf(sx * 0.03 * s, 0.025 * s, -0.045 * s));
    }
    this.add("chimpFur", fur, xf(x, y, 0.03, Math.PI + (this.r() - 0.5) * 0.6), "Chimp figurine", true);
    this.add("chimpFace", sphere(0.024 * s, 10, 8, 0.8), xf(x, y + 0.14 * s, 0.03 - 0.04 * s), "Chimp figurine");
  }
}

// ------------------------------------------------------------------ wall pieces

/** Wall clock with a city name on the dial, showing hh:mm. Centre at p on the south wall, facing +Z. */
function wallClock(ctx: WorldCtx, z: Zone, p: Vector3, city: string, hh: number, mm: number) {
  const key = `clock:${city}`;
  if (!ctx.mats.has(key)) {
    const { canvas, ctx: c } = makeCanvas(256, 256);
    c.fillStyle = "#f1ece0";
    c.beginPath();
    c.arc(128, 128, 126, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#20262b";
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const major = i % 5 === 0;
      c.lineWidth = major ? 6 : 2;
      c.beginPath();
      c.moveTo(128 + Math.cos(a) * (major ? 96 : 104), 128 + Math.sin(a) * (major ? 96 : 104));
      c.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112);
      c.stroke();
    }
    c.fillStyle = "#20262b";
    c.font = "600 22px Montserrat";
    c.textAlign = "center";
    c.fillText(city, 128, 180);
    const ha = (((hh % 12) + mm / 60) / 12) * Math.PI * 2 - Math.PI / 2;
    const ma = (mm / 60) * Math.PI * 2 - Math.PI / 2;
    c.lineCap = "round";
    c.lineWidth = 9;
    c.beginPath();
    c.moveTo(128, 128);
    c.lineTo(128 + Math.cos(ha) * 56, 128 + Math.sin(ha) * 56);
    c.stroke();
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(128, 128);
    c.lineTo(128 + Math.cos(ma) * 88, 128 + Math.sin(ma) * 88);
    c.stroke();
    c.fillStyle = "#2fbf8f";
    c.beginPath();
    c.arc(128, 128, 9, 0, Math.PI * 2);
    c.fill();
    canvasMat(ctx, key, canvas, 0.75, true);
  }
  ctx.g(z, "brass").add(torus(0.23, 0.022, 48, 8), xf(p.x, p.y, p.z + 0.02, 0, 1, 1, 1, Math.PI / 2), `Wall clock (${city})`);
  ctx.g(z, "mint", { castShadow: false }).add(torus(0.255, 0.008, 48, 6), xf(p.x, p.y, p.z + 0.01, 0, 1, 1, 1, Math.PI / 2));
  panel(ctx, z, key, new Vector3(p.x, p.y, p.z + 0.03), 0.44, 0.44, 0, 1, `Wall clock (${city})`);
}

/** Stock ticker texture: symbols, prices and coloured moves on a dark band. */
function tickerCanvas(): HTMLCanvasElement {
  const W = 4096;
  const H = 140;
  const { canvas, ctx: c } = makeCanvas(W, H);
  c.fillStyle = "#06090c";
  c.fillRect(0, 0, W, H);
  const items: [string, number, number][] = [
    ["CHIMPX", 108.37, 2.14],
    ["BANANA", 12.84, 1.36],
    ["JUNGLE", 54.2, 0.72],
    ["TREE", 33.18, 1.91],
    ["VIBE", 7.62, 0.48],
    ["APESIM", 21.05, -2.31],
    ["GREEN", 88.4, 0.93],
    ["MOON", 3.21, -1.06],
    ["RIVER", 46.9, 0.62],
    ["CANOPY", 71.3, -0.41],
    ["VINE", 15.77, 1.12],
  ];
  c.font = "600 66px Montserrat";
  c.textBaseline = "middle";
  let x = 30;
  for (let i = 0; x < W; i++) {
    const [sym, price, move] = items[i % items.length];
    const up = move >= 0;
    const parts: [string, string, number][] = [
      [sym, "#ece6d6", 20],
      [price.toFixed(2), "#b9c2c9", 16],
      [`${up ? "▲" : "▼"} ${Math.abs(move).toFixed(2)}%`, up ? "#36d987" : "#ff5b5b", 36],
      ["•", "#c98f3a", 40],
    ];
    for (const [t, col, gap] of parts) {
      c.fillStyle = col;
      c.fillText(t, x, H / 2 + 2);
      x += c.measureText(t).width + gap;
    }
  }
  return canvas;
}

// ------------------------------------------------------------------ furniture and planting

/** Coffee sideboard: cupboard with a stone top, espresso machine, mugs, bananas. Base at m, front facing -Z. */
function coffeeStation(ctx: WorldCtx, z: Zone, m: Matrix, r: Rand) {
  ctx.g(z, "panelHoney").add(box(1.15, 0.86, 0.48), xf(0, 0.43, 0).multiply(m), "Coffee sideboard");
  ctx.g(z, "counterTop").add(box(1.2, 0.04, 0.52), xf(0, 0.88, 0).multiply(m), "Coffee sideboard");
  const fronts = new Geo();
  const pulls = new Geo();
  for (const s of [-1, 1]) {
    fronts.add(box(0.55, 0.7, 0.012), xf(s * 0.285, 0.43, -0.245));
    pulls.add(box(0.014, 0.14, 0.018), xf(s * 0.05, 0.6, -0.256));
  }
  ctx.g(z, "timber").add(fronts, m, "Coffee sideboard");
  ctx.g(z, "brass").add(pulls, m);
  ctx.g(z, "steel").add(softBox(0.36, 0.4, 0.34, 0.03), xf(-0.3, 0.9 + 0.2, 0.02).multiply(m), "Espresso machine");
  ctx.g(z, "black").add(box(0.26, 0.05, 0.1), xf(-0.3, 1.0, -0.17).multiply(m));
  for (let i = 0; i < 4; i++) ctx.g(z, i % 2 ? "cream" : "tealBright", { castShadow: false }).add(cylinder(0.04, 0.09, 10), xf(0.02 + i * 0.1, 0.9, -0.12 + (i % 2) * 0.1).multiply(m), "Mugs");
  // bowl of bananas
  ctx.g(z, "timber").add(lathe([[0.001, 0], [0.1, 0.01], [0.17, 0.07], [0.18, 0.08]], 20), xf(0.38, 0.9, 0.06).multiply(m), "Banana bowl");
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r() * 0.5;
    const pts: Vector3[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = -0.8 + (k / 8) * 1.6;
      pts.push(new Vector3(Math.sin(t) * 0.09, -Math.cos(t) * 0.09 + 0.09, 0));
    }
    ctx.g(z, "bananaYellow", { castShadow: false }).add(tube(pts, (t) => 0.018 * Math.sin(Math.PI * (0.1 + t * 0.8)) + 0.004, 8), xf(0.38 + Math.cos(a) * 0.05, 0.94, 0.06 + Math.sin(a) * 0.05, a, 1, 1, 1, 0, 0.3).multiply(m), "Bananas");
  }
  pottedPlant(ctx, z, pt(m, 0.35, 0.9, 0.17), "fern", { pot: "terracotta", potR: 0.07, potH: 0.11, scale: 0.35, r });
}

/** Round high table with a laptop and a fruit plate. */
function highTable(ctx: WorldCtx, z: Zone, p: Vector3, r: Rand) {
  ctx.g(z, "black").add(new Geo().add(cylinder(0.26, 0.03, 24)).add(cylinder(0.04, 1.02, 10), xf(0, 0.03, 0)), xf(p.x, p.y, p.z), "High table");
  ctx.g(z, "timber").add(cylinder(0.42, 0.04, 32), xf(p.x, p.y + 1.04, p.z), "High table");
  const t = p.y + 1.08;
  ctx.g(z, "steel").add(box(0.34, 0.012, 0.24), xf(p.x - 0.05, t + 0.006, p.z, 0.3), "Laptop");
  const lid = xf(p.x - 0.05, t, p.z, 0.3).multiply(Matrix.Identity());
  ctx.g(z, "steel").add(box(0.34, 0.22, 0.01), xf(0, 0.11, 0.12, 0, 1, 1, 1, -0.25).multiply(lid), "Laptop");
  ctx.g(z, canvasMat(ctx, "chart:laptop", chartCanvas(919, "candles"), 0.9), { castShadow: false }).add(plane(0.3, 0.18), xf(0, 0.11, 0.113, 0, 1, 1, 1, -0.25).multiply(xf(0, 0, -0.008)).multiply(lid), "Laptop");
  ctx.g(z, "black", { castShadow: false }).add(cylinder(0.04, 0.1, 10), xf(p.x + 0.22, t, p.z + 0.12), "Mug");
  pottedPlant(ctx, z, new Vector3(p.x + 0.18, t, p.z - 0.16), "calathea", { pot: "cream", potR: 0.07, potH: 0.11, scale: 0.35, r });
}



