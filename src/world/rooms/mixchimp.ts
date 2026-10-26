// MixChimp Studio (lower level, rear-right). Production desk under the
// backlit MIXCHIMP sign, a drum kit and backline before the north glass, a
// vocal booth in the round east end, a piano and listening lounge along the
// south wall, and the entrance on the rounded south-west corner with windows
// into the studio from the hall.

// ------------------------------------------------------------------ MixChimp studio

import { Matrix, Vector3 } from "@babylonjs/core";
import { P2, ensureCCW, rng } from "../geometry/curves";
import { Geo, at, beam, box, cylinder, plane, polygonFace, ribbonWall, softBox, sphere, sweep, torus, wallStrip, xf } from "../geometry/geo";
import { WorldCtx, Zone, zone } from "../context";
import { LEVEL, MIX, MIX_CORNER, MIX_DOOR, MIX_WINDOWS, core } from "../layout";
import { makeCanvas } from "../materials/canvas";
import { drawLeafEmblem } from "../materials/textures";
import { letteringCanvas, roomSignCanvas } from "../materials/signs";
import { glazing, ledStrip } from "../structure/elements";
import { mixEdge, runs } from "../structure/facades";
import { armchair, drumTable, rectRug, roundRug, sofa } from "../props/furniture";
import { candle, floorLamp, floorPlanter, hangingPlanter } from "../props/decor";
import { sconce, wovenPendant } from "../props/lights";
import { amp, boomMic, curvedMonitor, drumKit, guitar, headphoneStand, keys, midiKeys, popFilter, rackGear, studioConsole, studioMonitor } from "../props/music";
import { Rand, pottedPlant, vine } from "../props/plants";
import { canvasMat, screenMat, speaker, taskChair } from "../props/tech";
import { faceToward, faceYaw, interiorArch, panel, roomLight } from "./common";
import { rugs } from "./rugs";
import { seatAt } from "../props/seats";

const F = LEVEL.lower + 0.012;
const C = LEVEL.lowerCeil;

/** World position of a point given in an object's local frame. */
const pt = (m: Matrix, x: number, y: number, z: number) => Vector3.TransformCoordinates(new Vector3(x, y, z), m);

function ensureMats(ctx: WorldCtx) {
  const add = (key: string, o: Parameters<typeof ctx.mats.pbr>[1]) => {
    if (!ctx.mats.has(key)) ctx.mats.pbr(key, o);
  };
  add("chimpFur", { color: "#3a2a20", rough: 0.85 });
  add("chimpFace", { color: "#9b7a5e", rough: 0.7 });
  add("goldRecord", { color: "#d8b45a", rough: 0.2, metal: 1 });
  add("popMesh", { color: "#111111", rough: 0.9, alpha: 0.55 });
  add("fabricTeal", { color: "#2f6f6a", rough: 0.95 });
  add("fabricMustard", { color: "#c99a3a", rough: 0.95 });
  add("fabricRust", { color: "#a8543a", rough: 0.95 });
  add("paper", { color: "#efe9dc", rough: 0.9 });
}

export function buildMixChimp(ctx: WorldCtx): void {
  const z = zone("mixchimp", "lower");
  const r = rng(51);
  ensureMats(ctx);
  // the entrance first: its window band fences the plants placed after it
  mixEntrance(ctx, z);
  const { c, x0, z0 } = MIX;
  // the solid stretch of the west wall, between the window band and the north-west curve
  const westTop = Math.max(...MIX.loop.filter((p) => p.x < x0 + 0.005).map((p) => p.z));
  const zs = westTop - 0.15 - 1.65; // sign centre

  // ---------------------------------------------------------------- MIXCHIMP sign, flush on the west wall
  ctx.g(z, "acoustic").add(box(0.06, 1.8, 3.3), xf(x0 + 0.03, 3.0, zs), "Acoustic panel");
  const lettering = letteringCanvas(["MIXCHIMP"], { w: 1024, h: 420, font: "600 150px Montserrat", color: "#ffe3b0", emblem: { color: "#7ff0c4", size: 110, y: 120 }, glow: "rgba(255,190,110,0.9)" });
  canvasMat(ctx, "mixchimpSign", lettering, 1.6, true);
  ctx.mats.glowing.add("mixchimpSign");
  panel(ctx, z, "mixchimpSign", new Vector3(x0 + 0.065, 3.0, zs), 3.0, 1.23, 1, 0, "MIXCHIMP sign");
  for (const dy of [-0.89, 0.89]) ctx.g(z, "amberStrip", { castShadow: false }).add(box(0.02, 0.014, 3.2), xf(x0 + 0.07, 3.0 + dy, zs), "Sign light");

  // ---------------------------------------------------------------- shelf unit, 0.4 m south of the sign
  const shW = 1.25;
  const shZ = zs - 1.65 - 0.4 - shW / 2;
  studioShelf(ctx, z, xf(x0 + 0.19, F, shZ, faceYaw(1, 0)), shW, r);

  // ---------------------------------------------------------------- production desk facing the sign
  const deskM = xf(x0 + 0.6, F, zs, faceYaw(1, 0));
  productionDesk(ctx, z, deskM, r);
  rectRug(ctx, z, new Vector3(x0 + 1.75, F, zs), 2.6, 3.4, 0, rugs.knit(ctx), "Studio rug");

  // ---------------------------------------------------------------- drums and backline before the north glass
  const kit = { x: c.x - 5.25, z: MIX.z1 - 1.7 };
  rectRug(ctx, z, new Vector3(kit.x + 0.3, F, kit.z + 0.05), 3.6, 2.7, 0, rugs.persian(ctx), "Persian rug");
  drumKit(ctx, z, xf(kit.x, F, kit.z), "tealDeep");
  // overhead pair over the cymbals, kick mic at the front head
  for (const s of [-1, 1]) boomMic(ctx, z, new Vector3(kit.x + s * 1.15, F, kit.z - 0.95), 1.45, new Vector3(kit.x + s * 0.4, F + 1.95, kit.z - 0.25), new Vector3(kit.x + s * 0.25, F + 0.8, kit.z + 0.1), "condenser", "Drum overhead mic");
  boomMic(ctx, z, new Vector3(kit.x - 0.05, F, kit.z - 0.95), 0.22, new Vector3(kit.x, F + 0.3, kit.z - 0.6), new Vector3(kit.x, F + 0.29, kit.z - 0.3), "dynamic", "Kick drum mic");
  // amps with guitars on stands in front
  const ax = kit.x + 2.15;
  const az = MIX.z1 - 0.45;
  amp(ctx, z, xf(ax, F, az), 0.66, 0.54);
  amp(ctx, z, xf(ax + 0.85, F, az), 0.58, 0.66);
  boomMic(ctx, z, new Vector3(ax - 0.35, F, az - 0.55), 0.3, new Vector3(ax - 0.08, F + 0.32, az - 0.3), new Vector3(ax - 0.08, F + 0.32, az), "dynamic", "Amp mic");
  guitar(ctx, z, xf(ax - 0.75, F, az - 0.55, 0.25), "electric", "red");
  guitar(ctx, z, xf(ax + 0.45, F, az - 0.75), "electric", "black");
  guitar(ctx, z, xf(ax + 1.45, F, az - 0.6, -0.3), "acoustic");
  // synth on an X-stand
  keys(ctx, z, xf(ax + 2.75, F, az - 0.8, -0.35), 1.15, false);

  // ---------------------------------------------------------------- vocal booth in the round east end
  vocalBooth(ctx, z, { x0: c.x + 2.15, x1: c.x + 4.75, z0: c.z - 1.6, z1: c.z + 1.6 }, r);

  // ---------------------------------------------------------------- piano and listening lounge along the south wall
  const px = c.x - 4.6;
  keys(ctx, z, xf(px, F, z0 + 0.27, Math.PI), 1.4, true);
  ctx.g(z, "leatherBlack").add(softBox(0.9, 0.1, 0.36, 0.03, 0.02), xf(px, 0.52, z0 + 0.95), "Piano bench");
  ctx.g(z, "black").add(new Geo().add(box(0.06, 0.47, 0.3), xf(-0.38, 0.235, 0)).add(box(0.06, 0.47, 0.3), xf(0.38, 0.235, 0)), xf(px, F, z0 + 0.95), "Piano bench");
  seatAt(ctx, z, px, 0.57, z0 + 0.98, 0, { kind: "bench", height: 0.57 - F, recline: 0, legs: "down" }, "Piano bench");
  goldRecord(ctx, z, new Vector3(px, 1.75, z0 + 0.02), Math.PI);
  for (const [dx, mat] of [
    [-1.0, "fabricTeal"],
    [1.0, "fabricRust"],
  ] as [number, string][])
    ctx.g(z, mat).add(softBox(0.6, 1.0, 0.06, 0.02), xf(px + dx, 1.85, z0 + 0.04), "Acoustic panel");
  const lx = c.x - 1.85;
  sofa(ctx, z, [
    { x: lx - 1.1, z: z0 + 0.6 },
    { x: lx + 1.1, z: z0 + 0.6 },
  ], { mat: "sage", r, pillows: ["mustard", "rust", "tealBright"], label: "Lounge sofa", depth: 0.9 });
  for (const [i, kind, fin] of [
    [-1, "electric", "red"],
    [0, "acoustic", "timberPale"],
    [1, "electric", "tealBright"],
  ] as [number, "electric" | "acoustic", string][])
    guitar(ctx, z, xf(lx + i * 0.72, 1.25, z0 + 0.075, Math.PI), kind, fin, { stand: false, tilt: 0 });
  drumTable(ctx, z, new Vector3(lx, F, z0 + 1.75), 0.45, 0.4);
  candle(ctx, z, new Vector3(lx + 0.15, 0.41, z0 + 1.65));
  ctx.g(z, "black").add(box(0.31, 0.012, 0.31), xf(lx - 0.12, 0.416, z0 + 1.8, 0.3), "Vinyl sleeve");
  ctx.g(z, "album:1", { castShadow: false }).add(plane(0.3, 0.3), xf(lx - 0.12, 0.423, z0 + 1.8, 0.3, 1, 1, 1, Math.PI / 2), "Vinyl sleeve");
  const ac = { x: lx + 2.05, z: z0 + 1.85 };
  armchair(ctx, z, new Vector3(ac.x, F, ac.z), faceToward(ac.x, ac.z, lx, z0 + 1.6), "tealDeep", "mustard");
  floorLamp(ctx, z, new Vector3(lx + 1.45, F, z0 + 0.4));
  roundRug(ctx, z, new Vector3(lx + 0.3, F, z0 + 1.6), 1.45, rugs.smallJute(ctx));

  // ---------------------------------------------------------------- arch, planting, lights
  interiorArch(ctx, "mixchimp", "lower", { x: x0 + 1.0, z: MIX.z1 - 1.4 }, { x: c.x + 0.15, z: z0 + 0.5 }, 0, C - 0.05, 0.36);
  pottedPlant(ctx, z, new Vector3(x0 + 0.55, F, z0 + 2.4), "monstera", { pot: "cream", potR: 0.25, potH: 0.4, scale: 1.0, r });
  for (const [p, kind, mat] of [
    [{ x: x0 + 1.55, z: MIX.z1 - 1.75 }, "banana", "potCharcoal"],
    [{ x: c.x + 1.05, z: MIX.z1 - 1.6 }, "monstera", "potCream"],
    [{ x: c.x + 1.3, z: z0 + 1.9 }, "elephant", "potCream"],
  ] as [P2, "banana" | "monstera" | "elephant", string][])
    floorPlanter(ctx, z, new Vector3(p.x, F, p.z), kind, mat, r);
  for (const p of [
    { x: x0 + 3.2, z: MIX.z1 - 0.75 },
    { x: c.x - 0.3, z: MIX.z1 - 0.7 },
  ])
    hangingPlanter(ctx, z, new Vector3(p.x, C, p.z), 1.45, r);
  wovenPendant(ctx, z, new Vector3(lx, C, z0 + 1.7), 0.34, 1.1);
  wovenPendant(ctx, z, new Vector3(x0 + 2.6, C, zs - 0.6), 0.26, 1.4, { shape: "teardrop" });
  wovenPendant(ctx, z, new Vector3(x0 + 2.6, C, zs + 0.7), 0.24, 1.6, { shape: "teardrop" });
  const rail = new Geo().add(box(4.6, 0.04, 0.05), xf(kit.x + 1.2, C - 0.03, kit.z - 1.0));
  for (let i = 0; i < 5; i++) rail.add(cylinder(0.05, 0.16, 10), xf(kit.x - 0.8 + i * 1.0, C - 0.21, kit.z - 1.0));
  ctx.g(z, "black").add(rail, undefined, "Track lights");
  roomLight(ctx, "mixchimp", "lower", new Vector3(c.x - 3.5, 3.6, c.z), 4, 14, 12);
  roomLight(ctx, "mixchimp", "lower", new Vector3(x0 + 2.6, 2.6, zs), 1.5, 6, 5);
  roomLight(ctx, "mixchimp", "lower", new Vector3(kit.x + 0.8, 3.0, kit.z - 0.6), 1.5, 6, 6);
  roomLight(ctx, "mixchimp", "lower", new Vector3(lx, 2.6, z0 + 1.8), 1.5, 6, 6);
}

// ------------------------------------------------------------------ desk

/**
 * Straight production desk, 2.8 m by 1.0 m. Local frame: the engineer sits at
 * -Z facing +Z. Rack pedestals at the ends, a MIDI keyboard at the front edge,
 * the mixing console behind it sloping up away from the chair, a riser along
 * the back with the curved monitor and two studio monitors toed in.
 */
function productionDesk(ctx: WorldCtx, z: Zone, m: Matrix, r: Rand) {
  const W = 2.8;
  const D = 1.0;
  const T = 0.76;
  ctx.g(z, "timber").add(box(W, 0.05, D), xf(0, T - 0.025, 0).multiply(m), "Production desk");
  ctx.g(z, "amberStrip", { castShadow: false }).add(box(W - 0.12, 0.012, 0.02), xf(0, T - 0.06, -D / 2 + 0.05).multiply(m), "Desk light");
  for (const s of [-1, 1]) rackGear(ctx, z, xf(s * (W / 2 - 0.31), 0, 0.03).multiply(m), 0.56, T - 0.05, 0.84, "Desk rack");
  ctx.g(z, "panelHoney").add(box(W - 1.24, 0.5, 0.03), xf(0, 0.45, D / 2 - 0.06).multiply(m), "Production desk");
  // riser along the back
  const rz = D / 2 - 0.14;
  ctx.g(z, "timber").add(box(W - 0.1, 0.04, 0.26), xf(0, T + 0.1, rz).multiply(m), "Desk riser");
  const sup = new Geo();
  for (const x of [-1.25, -0.45, 0.45, 1.25]) sup.add(box(0.05, 0.08, 0.22), xf(x, T + 0.04, rz));
  ctx.g(z, "timberDark").add(sup, m, "Desk riser");
  ctx.g(z, "amberStrip", { castShadow: false }).add(box(W - 0.3, 0.01, 0.015), xf(0, T + 0.074, rz - 0.125).multiply(m), "Desk light");
  midiKeys(ctx, z, xf(0.1, T, -D / 2 + 0.15).multiply(m), 0.95);
  studioConsole(ctx, z, xf(0, T, 0.0).multiply(m), 1.3, 0.44);
  curvedMonitor(ctx, z, xf(0, T + 0.12, D / 2 - 0.15).multiply(m), 1.5, 0.6, 1.4, screenMat(ctx, "mixchimp-ui", 1.1), "MixChimp display");
  for (const s of [-1, 1]) {
    const sx = s * 1.2;
    studioMonitor(ctx, z, xf(sx, T + 0.12, D / 2 - 0.15, faceToward(sx, D / 2 - 0.15, 0, -1.3)).multiply(m), 0.24, 0.36, 0.28);
  }
  rackGear(ctx, z, xf(-1.05, T, -0.1).multiply(m), 0.44, 0.17, 0.32, "Outboard gear");
  headphoneStand(ctx, z, xf(1.12, T, -0.05).multiply(m));
  ctx.g(z, "black", { castShadow: false }).add(cylinder(0.04, 0.1, 12), xf(1.22, T, -0.33).multiply(m), "Mug");
  ctx.g(z, "paper", { castShadow: false }).add(box(0.2, 0.012, 0.27), xf(0.82, T + 0.006, -0.36, 0.2).multiply(m), "Notebook");
  pottedPlant(ctx, z, pt(m, -1.18, T, -0.4), "philodendron", { pot: "terracotta", potR: 0.07, potH: 0.11, scale: 0.35, r });
  taskChair(ctx, z, xf(0.05, 0, -1.1, Math.PI + 0.12).multiply(m), "leatherBlack");
}

// ------------------------------------------------------------------ shelf unit

function albumCovers(ctx: WorldCtx) {
  if (ctx.mats.has("album:0")) return;
  const looks: [string, string, string][] = [
    ["#1d4d4a", "#f2c14e", "JUNGLE BEATS"],
    ["#c4553a", "#fbe7c6", "CANOPY"],
    ["#2b2140", "#7ff0c4", "NIGHT VIBES"],
    ["#e8b04a", "#2a2018", "BANANA FM"],
  ];
  looks.forEach(([bg, fg, title], i) => {
    const { canvas, ctx: c } = makeCanvas(256, 256);
    c.fillStyle = bg;
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = fg;
    if (i === 0) drawLeafEmblem(c, 128, 150, 120, fg);
    else if (i === 1)
      for (let k = 0; k < 6; k++) {
        c.globalAlpha = 1 - k * 0.14;
        c.fillRect(0, 150 + k * 16, 256, 8);
      }
    else {
      c.beginPath();
      c.arc(128, 120, i === 2 ? 60 : 80, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.font = "700 26px Montserrat";
    c.textAlign = "center";
    c.fillStyle = fg;
    c.fillText(title, 128, 238);
    canvasMat(ctx, `album:${i}`, canvas, 0.8);
  });
}

/**
 * Built-in shelf unit standing against the wall: cupboard below, three lit
 * shelves above with album covers on display, a gold record, a chimp
 * figurine, plants and books. Local frame: front faces -Z, back on the wall.
 */
function studioShelf(ctx: WorldCtx, z: Zone, m: Matrix, W: number, r: Rand) {
  albumCovers(ctx);
  const D = 0.36;
  const H = 2.85;
  const base = 0.8;
  const car = new Geo();
  for (const s of [-1, 1]) car.add(box(0.04, H, D), xf(s * (W / 2 - 0.02), H / 2, 0));
  car.add(box(W, 0.05, D), xf(0, H - 0.025, 0));
  car.add(box(W, base, D - 0.02), xf(0, base / 2, 0.01));
  ctx.g(z, "timberDark").add(car, m, "Shelf unit");
  ctx.g(z, "panelDark").add(box(W - 0.08, H - base - 0.05, 0.02), xf(0, base + (H - base - 0.05) / 2, D / 2 - 0.01).multiply(m), "Shelf unit");
  const doors = new Geo();
  const pulls = new Geo();
  for (const s of [-1, 1]) {
    doors.add(box(W / 2 - 0.05, base - 0.1, 0.02), xf(s * (W / 4 - 0.005), base / 2, -D / 2));
    pulls.add(box(0.014, 0.14, 0.02), xf(s * 0.06, base * 0.7, -D / 2 - 0.02));
  }
  ctx.g(z, "panelHoney").add(doors, m, "Shelf unit");
  ctx.g(z, "brass").add(pulls, m);
  const ys = [base, base + 0.66, base + 1.32];
  const boards = new Geo();
  const strips = new Geo();
  for (const y of ys.slice(1)) boards.add(box(W - 0.08, 0.035, D - 0.04), xf(0, y - 0.0175, 0));
  for (const y of [...ys.slice(1), H - 0.05]) strips.add(box(W - 0.14, 0.012, 0.02), xf(0, y - 0.045, -D / 2 + 0.05));
  ctx.g(z, "timber").add(boards, m, "Shelf unit");
  ctx.g(z, "amberStrip", { castShadow: false }).add(strips, m, "Shelf light");
  const bookMats = ["rust", "teal", "mustard", "cream", "sage", "tealDeep", "coral"];
  // bottom shelf: two albums on display and a row of records
  [-0.33, 0.05].forEach((x, i) => {
    const am = xf(x, ys[0] + 0.16, 0.06, 0, 1, 1, 1, -0.12).multiply(m);
    ctx.g(z, "black").add(box(0.31, 0.31, 0.012), am, "Album on display");
    ctx.g(z, `album:${i * 2}`, { castShadow: false }).add(plane(0.3, 0.3), xf(0, 0, -0.007).multiply(am), "Album on display");
  });
  for (let i = 0; i < 14; i++) ctx.g(z, bookMats[i % bookMats.length], { castShadow: false }).add(box(0.012, 0.31, 0.3), xf(0.3 + i * 0.019, ys[0] + 0.155, 0.0).multiply(m), "Vinyl records");
  // middle shelf: gold record, chimp figurine, plant with trailing vines
  goldRecordFrame(ctx, z, xf(-0.3, ys[1] + 0.2, 0.08, 0, 1, 1, 1, -0.1).multiply(m));
  chimpFigurine(ctx, z, xf(0.1, ys[1], 0.02, Math.PI).multiply(m), 1.1, r);
  pottedPlant(ctx, z, pt(m, 0.4, ys[1], 0.0), "philodendron", { pot: "terracotta", potR: 0.08, potH: 0.12, scale: 0.34, r });
  for (let i = 0; i < 3; i++) vine(ctx, z, pt(m, 0.36 + i * 0.05, ys[1] + 0.12, -0.12), 0.35 + r() * 0.4, r, { leaf: 0.055, density: 22 });
  // top shelf: books, an album and a small speaker
  let bx = -W / 2 + 0.1;
  while (bx < -0.05) {
    const bw = 0.028 + r() * 0.025;
    const bh = 0.2 + r() * 0.1;
    ctx.g(z, bookMats[Math.floor(r() * bookMats.length)], { castShadow: false }).add(box(bw, bh, 0.2), xf(bx + bw / 2, ys[2] + bh / 2, 0.03).multiply(m), "Books");
    bx += bw + 0.004;
  }
  const am = xf(0.2, ys[2] + 0.16, 0.06, 0, 1, 1, 1, -0.12).multiply(m);
  ctx.g(z, "black").add(box(0.31, 0.31, 0.012), am, "Album on display");
  ctx.g(z, "album:3", { castShadow: false }).add(plane(0.3, 0.3), xf(0, 0, -0.007).multiply(am), "Album on display");
  pottedPlant(ctx, z, pt(m, 0.47, ys[2], 0.02), "fern", { pot: "cream", potR: 0.07, potH: 0.1, scale: 0.3, r });
}

/** Framed gold record with a plaque. Centre at m, facing -Z. */
function goldRecordFrame(ctx: WorldCtx, z: Zone, m: Matrix) {
  ctx.g(z, "black").add(box(0.3, 0.38, 0.02), m, "Gold record");
  ctx.g(z, "cream", { castShadow: false }).add(plane(0.27, 0.35), xf(0, 0, -0.011).multiply(m), "Gold record");
  ctx.g(z, "goldRecord").add(cylinder(0.105, 0.006, 32), xf(0, 0.04, -0.012, 0, 1, 1, 1, -Math.PI / 2).multiply(m), "Gold record");
  ctx.g(z, "black").add(cylinder(0.03, 0.007, 16), xf(0, 0.04, -0.013, 0, 1, 1, 1, -Math.PI / 2).multiply(m));
  ctx.g(z, "brass").add(box(0.12, 0.03, 0.004), xf(0, -0.13, -0.013).multiply(m));
}

/** Gold record hung on a wall at p, facing yaw. */
function goldRecord(ctx: WorldCtx, z: Zone, p: Vector3, yaw: number) {
  goldRecordFrame(ctx, z, Matrix.Scaling(1.6, 1.6, 1).multiply(xf(0, 0, -0.012)).multiply(xf(p.x, p.y, p.z, yaw)));
}

/** Small seated chimp figurine. Base at m, facing -Z. */
function chimpFigurine(ctx: WorldCtx, z: Zone, m: Matrix, s: number, r: Rand) {
  const fur = new Geo();
  fur.add(sphere(0.055 * s, 12, 10), xf(0, 0.06 * s, 0, 0, 1, 1.15, 0.85));
  fur.add(sphere(0.04 * s, 12, 10), xf(0, 0.15 * s, 0.01 * s));
  for (const sx of [-1, 1]) {
    fur.add(sphere(0.014 * s, 8, 6), xf(sx * 0.042 * s, 0.158 * s, 0.005 * s));
    fur.add(sphere(0.022 * s, 8, 6), xf(sx * 0.03 * s, 0.025 * s, -0.045 * s));
  }
  ctx.g(z, "chimpFur").add(fur, xf(0, 0, 0, (r() - 0.5) * 0.4).multiply(m), "Chimp figurine");
  ctx.g(z, "chimpFace").add(sphere(0.024 * s, 10, 8, 0.8), xf(0, 0.14 * s, -0.035 * s).multiply(m), "Chimp figurine");
}

// ------------------------------------------------------------------ vocal booth

/**
 * Vocal booth on a raised floor: solid slatted walls lined with acoustic
 * panels on three sides, a glazed front facing the studio with a glazed door
 * standing open, an ON AIR light over it, and a large-diaphragm mic with pop
 * filter, music stand, stool and headphones inside. Axis-aligned box; the
 * front is the west face (x0).
 */
function vocalBooth(ctx: WorldCtx, z: Zone, b: { x0: number; x1: number; z0: number; z1: number }, r: Rand) {
  const { x0, x1, z0, z1 } = b;
  const H = 2.6;
  const t = 0.1;
  const fl = 0.06;
  const xm = (x0 + x1) / 2;
  const zm = (z0 + z1) / 2;
  ctx.g(z, "timberDark").add(box(x1 - x0, fl, z1 - z0), xf(xm, F + fl / 2, zm), "Vocal booth floor");
  rectRug(ctx, z, new Vector3(xm + 0.15, F + fl, zm), x1 - x0 - 0.5, z1 - z0 - 0.5, 0, rugs.persian(ctx), "Booth rug");
  // solid walls: slats outside, acoustic panels inside
  const walls = new Geo();
  walls.add(box(x1 - x0, H, t), xf(xm, H / 2, z0 + t / 2));
  walls.add(box(x1 - x0, H, t), xf(xm, H / 2, z1 - t / 2));
  walls.add(box(t, H, z1 - z0 - 2 * t), xf(x1 - t / 2, H / 2, zm));
  ctx.g(z, "panelHoney").add(walls, xf(0, F, 0), "Vocal booth wall");
  const tiles = new Geo();
  const tile = (cx: number, cy: number, cz: number, alongX: boolean) => tiles.add(softBox(alongX ? 0.56 : 0.05, 0.56, alongX ? 0.05 : 0.56, 0.02, 0.03), xf(cx, cy, cz));
  for (let row = 0; row < 3; row++) {
    const y = F + 0.75 + row * 0.62;
    for (let x = x0 + 0.45; x < x1 - t - 0.3; x += 0.62) {
      tile(x, y, z0 + t + 0.03, true);
      tile(x, y, z1 - t - 0.03, true);
    }
    for (let zz = z0 + t + 0.4; zz < z1 - t - 0.3; zz += 0.62) tile(x1 - t - 0.03, y, zz, false);
  }
  ctx.g(z, "acoustic").add(tiles, undefined, "Acoustic panels");
  ctx.g(z, "timberDark").add(box(x1 - x0 + 0.12, 0.1, z1 - z0 + 0.12), xf(xm, F + H + 0.05, zm), "Vocal booth roof");
  ctx.g(z, "amberStrip", { castShadow: false }).add(box(0.02, 0.014, z1 - z0), xf(x0 - 0.05, F + H - 0.005, zm), "Booth light");
  // glazed front with the door at its north end
  const dw = 0.9;
  const dz0 = z1 - t - 0.08 - dw;
  const dz1 = dz0 + dw;
  const dh = 2.12;
  const frame = new Geo();
  for (const zz of [z0 + t, (z0 + t + dz0) / 2, dz0, dz1, z1 - t]) frame.add(box(0.07, H, 0.06), xf(x0 + 0.035, H / 2, zz));
  frame.add(box(0.07, 0.06, z1 - z0 - 2 * t), xf(x0 + 0.035, fl + 0.03, zm));
  frame.add(box(0.07, 0.06, dw), xf(x0 + 0.035, dh + 0.03, (dz0 + dz1) / 2));
  frame.add(box(0.07, 0.06, z1 - z0 - 2 * t), xf(x0 + 0.035, H - 0.03, zm));
  ctx.g(z, "charcoal").add(frame, xf(0, F, 0), "Booth window frame");
  const glass = ctx.g(z, "glassBooth", { castShadow: false, pickable: false });
  glass.setLabel("Booth glass");
  glass.add(box(0.012, H - fl - 0.06, dz0 - (z0 + t)), xf(x0 + 0.035, F + (fl + H) / 2, (z0 + t + dz0) / 2));
  glass.add(box(0.012, H - dh - 0.09, dw), xf(x0 + 0.035, F + (dh + 0.06 + H - 0.03) / 2, (dz0 + dz1) / 2));
  // glazed door hinged at its south jamb, standing open into the studio
  const open = (38 * Math.PI) / 180;
  const dir = { x: -Math.sin(open), z: Math.cos(open) };
  const dm = xf(x0 + 0.01, F + fl, dz0 + 0.03, Math.atan2(-dir.z, dir.x));
  const lw = dw - 0.06;
  const leaf = new Geo();
  leaf.add(box(0.07, dh - fl - 0.02, 0.05), xf(0.035, (dh - fl) / 2, 0));
  leaf.add(box(0.07, dh - fl - 0.02, 0.05), xf(lw - 0.035, (dh - fl) / 2, 0));
  leaf.add(box(lw, 0.18, 0.05), xf(lw / 2, 0.09, 0));
  leaf.add(box(lw, 0.1, 0.05), xf(lw / 2, dh - fl - 0.06, 0));
  ctx.g(z, "timberDark").add(leaf, dm, "Booth door");
  ctx.g(z, "glassBooth", { castShadow: false, pickable: false }).add(box(lw - 0.14, dh - fl - 0.3, 0.012), xf(lw / 2, 0.18 + (dh - fl - 0.3) / 2, 0).multiply(dm));
  ctx.g(z, "brass").add(new Geo().add(box(0.025, 0.45, 0.025), xf(lw - 0.12, 1.0, -0.06)).add(box(0.025, 0.45, 0.025), xf(lw - 0.12, 1.0, 0.06)), dm, "Door handle");
  // ON AIR light over the door
  ctx.g(z, "black").add(box(0.06, 0.13, 0.42), xf(x0 - 0.04, F + H + 0.05, (dz0 + dz1) / 2), "ON AIR light");
  panel(ctx, z, "onAir", new Vector3(x0 - 0.075, F + H + 0.05, (dz0 + dz1) / 2), 0.38, 0.11, -1, 0, "ON AIR light");
  // inside: vocal mic facing the window, pop filter, music stand, stool, headphones
  const tip = new Vector3(x0 + 0.95, F + fl + 1.6, zm - 0.2);
  const singer = new Vector3(x0 + 1.55, F + fl + 1.6, zm - 0.2);
  boomMic(ctx, z, new Vector3(x0 + 0.6, F + fl, zm + 0.25), 1.3, tip, singer, "vocal", "Vocal mic");
  popFilter(ctx, z, tip.add(new Vector3(0.14, 0, 0)), new Vector3(1, 0, 0));
  const ms = new Vector3(x0 + 1.25, F + fl, zm - 0.85);
  ctx.g(z, "black").add(new Geo().add(cylinder(0.01, 1.05, 6)).add(box(0.42, 0.3, 0.012), xf(0, 1.15, 0, faceYaw(singer.x - ms.x, singer.z - ms.z), 1, 1, 1, -0.45)), xf(ms.x, ms.y, ms.z), "Music stand");
  ctx.g(z, "paper", { castShadow: false }).add(box(0.38, 0.27, 0.004), xf(0, 1.152, -0.009, faceYaw(singer.x - ms.x, singer.z - ms.z), 1, 1, 1, -0.45).multiply(xf(ms.x, ms.y, ms.z)), "Lyric sheet");
  ctx.g(z, "timberDark").add(new Geo().add(cylinder(0.17, 0.04, 16), xf(0, 0.7, 0)).add(cylinder(0.02, 0.7, 6)).add(torus(0.13, 0.01, 16, 4), xf(0, 0.25, 0)), xf(x1 - 0.5, F + fl, z0 + 0.45), "Stool");
  seatAt(ctx, z, x1 - 0.5, F + fl + 0.74, z0 + 0.45, 0, { kind: "stool", height: 0.74, recline: 0, legs: "down", footrest: 0.26, turn: true }, "Vocal booth stool");
  headphoneStand(ctx, z, xf(x1 - 0.45, F + fl + 0.75, z0 + 0.45));
  wovenPendant(ctx, z, new Vector3(xm + 0.2, F + H, zm), 0.16, 0.35);
  roomLight(ctx, "mixchimp", "lower", new Vector3(xm, F + 2.2, zm), 1, 4, 3.5);
  void r;
}

/** Point offset sideways from a plan path: + is outward (right of travel), as in enclose(). */
function offsetOut(path: P2[], d: number): P2[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    return { x: p.x + (tz / l) * d, z: p.z - (tx / l) * d };
  });
}

/** Box-section strip swept along a plan path: lateral l0..l1 (+ outward), heights y0..y1. */
function strip(path: P2[], l0: number, l1: number, y0: number, y1: number): Geo {
  return sweep(
    [
      [l1, y0],
      [l1, y1],
      [l0, y1],
      [l0, y0],
    ],
    at(path, 0),
    { caps: true },
  );
}

/** Piece of studio wall along a plan path between heights: dark acoustic inside, slats outside. */
function studioWall(ctx: WorldCtx, z: Zone, path: P2[], y0: number, y1: number, label: string) {
  ctx.g(z, "panelDark").add(ribbonWall([...path].reverse(), y0, y1, false), undefined, label);
  const out = offsetOut(path, 0.18);
  ctx.g(z, "panelHoney").add(ribbonWall(out, y0, y1, false), undefined, label);
  ctx.g(z, "timberDark").add(new Geo().add(wallStrip([path[0], out[0]], y0, y1)).add(wallStrip([out[out.length - 1], path[path.length - 1]], y0, y1)), undefined, label);
}

/** Panel bent along a circle (centre k, radius R) from angle a0 to a1, facing outward. */
function arcPanel(k: P2, R: number, a0: number, a1: number, y0: number, y1: number): Geo {
  const g = new Geo();
  const n = 20;
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const c = Math.cos(a);
    const s = Math.sin(a);
    lo.push(g.vert(k.x + c * R, y0, k.z + s * R, i / n, 0, c, 0, s));
    hi.push(g.vert(k.x + c * R, y1, k.z + s * R, i / n, 1, c, 0, s));
  }
  for (let i = 0; i < n; i++) g.quad(lo[i], lo[i + 1], hi[i + 1], hi[i]);
  return g;
}

/**
 * Entrance on MixChimp's rounded south-west corner, facing the hall: a
 * glulam-lined doorway with quilted studio doors standing open, the studio sign
 * bent along the curve with the ON AIR light above it, lanterns either side,
 * and a band of windows wrapping the corner so the studio can be seen from the
 * hall. The openings are the exact runs the facade leaves open (mixEdge).
 */
function mixEntrance(ctx: WorldCtx, z: Zone) {
  const k = MIX_CORNER;
  const { h } = MIX_DOOR;
  const open = runs(MIX.loop, mixEdge).filter((r) => r.kind === "open").map((r) => r.path);
  const nearest = (q: P2) => open.reduce((best, p) => (Math.min(...p.map((v) => Math.hypot(v.x - q.x, v.z - q.z))) < Math.min(...best.map((v) => Math.hypot(v.x - q.x, v.z - q.z))) ? p : best));
  const door = nearest(MIX_DOOR);
  const wins = open.filter((p) => p !== door);
  const dirOut = { x: Math.cos(MIX_DOOR.angle), z: Math.sin(MIX_DOOR.angle) };
  const mid = { x: k.x + dirOut.x * k.R, z: k.z + dirOut.z * k.R };

  // ---------------------------------------------------------------- doorway
  studioWall(ctx, z, door, h, C, "MixChimp entrance wall");
  const lining = ctx.g(z, "glulam");
  lining.setLabel("MixChimp doorway");
  lining.add(strip(door, -0.05, 0.23, h, h + 0.2));
  const tan = (a: P2, b: P2) => {
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  };
  const t0 = tan(door[0], door[1]);
  const t1 = tan(door[door.length - 2], door[door.length - 1]);
  for (const [p, t] of [
    [door[0], t0],
    [door[door.length - 1], t1],
  ] as [P2, P2][]) {
    lining.add(box(0.2, h + 0.2, 0.28), xf(p.x + t.z * 0.09, (h + 0.2) / 2, p.z - t.x * 0.09, Math.atan2(-t.z, t.x)));
  }
  ctx.g(z, "timberDark").add(strip(door, -0.05, 0.23, 0, 0.02), undefined, "Threshold");
  ledStrip(ctx, z, at(offsetOut(door, 0.22), h - 0.03), "amberStrip", 0.025);
  // quilted studio doors with porthole windows, hinged at the jambs and standing open
  const inward = (t: P2) => ({ x: -t.z, z: t.x });
  const A = { x: door[0].x + t0.x * 0.1 + inward(t0).x * 0.02, z: door[0].z + t0.z * 0.1 + inward(t0).z * 0.02 };
  const e = door[door.length - 1];
  const B = { x: e.x - t1.x * 0.1 + inward(t1).x * 0.02, z: e.z - t1.z * 0.1 + inward(t1).z * 0.02 };
  const u = tan(A, B);
  const inn = inward(u);
  const lw = Math.hypot(B.x - A.x, B.z - A.z) / 2 - 0.015;
  const swing = (100 * Math.PI) / 180;
  for (const [hinge, along] of [
    [A, u],
    [B, { x: -u.x, z: -u.z }],
  ] as [P2, P2][]) {
    const d = { x: along.x * Math.cos(swing) + inn.x * Math.sin(swing), z: along.z * Math.cos(swing) + inn.z * Math.sin(swing) };
    const m = xf(hinge.x, 0, hinge.z, Math.atan2(-d.z, d.x));
    ctx.g(z, "timberDark").add(box(lw, h - 0.03, 0.06), xf(lw / 2, (h - 0.03) / 2, 0).multiply(m), "Studio door");
    const quilt = new Geo();
    for (let row = 0; row < 3; row++) for (const s of [-1, 1]) quilt.add(softBox(lw - 0.16, 0.5, 0.03, 0.04, 0.03), xf(lw / 2, 0.35 + row * 0.55, s * 0.035));
    ctx.g(z, "leatherBlack").add(quilt, m, "Studio door");
    ctx.g(z, "brass").add(new Geo().add(cylinder(0.12, 0.08, 24, false)).add(cylinder(0.105, 0.08, 24, false).flip()), xf(lw / 2, 1.95, -0.04, 0, 1, 1, 1, Math.PI / 2).multiply(m), "Porthole window");
    ctx.g(z, "glass", { castShadow: false, pickable: false }).add(cylinder(0.105, 0.01, 24), xf(lw / 2, 1.95, -0.005, 0, 1, 1, 1, Math.PI / 2).multiply(m));
    for (const s of [-1, 1]) ctx.g(z, "brass").add(box(0.025, 0.5, 0.025), xf(lw - 0.1, 1.05, s * 0.06).multiply(m), "Door handle");
  }

  // ---------------------------------------------------------------- sign, ON AIR light, lanterns
  canvasMat(ctx, "sign:mixchimp", roomSignCanvas("MIXCHIMP STUDIO", { w: 1024, h: 200, font: "600 88px Montserrat" }), 1.0);
  const sw = 1.9;
  const sh = (sw * 200) / 1024;
  const sy = h + 0.62;
  const span = sw / (k.R + 0.235);
  const a0 = MIX_DOOR.angle - span / 2;
  const a1 = MIX_DOOR.angle + span / 2;
  const back: P2[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = a0 - 0.02 + ((a1 - a0 + 0.04) * i) / 20;
    back.push({ x: k.x + Math.cos(a) * (k.R + 0.205), z: k.z + Math.sin(a) * (k.R + 0.205) });
  }
  ctx.g(z, "timberDark").add(strip(back, -0.025, 0.025, sy - sh / 2 - 0.03, sy + sh / 2 + 0.03), undefined, "Sign: MIXCHIMP STUDIO");
  ctx.g(z, "sign:mixchimp", { castShadow: false }).add(arcPanel(k, k.R + 0.235, a0, a1, sy - sh / 2, sy + sh / 2), undefined, "Sign: MIXCHIMP STUDIO");
  if (!ctx.mats.has("onAir")) {
    const { canvas, ctx: g } = makeCanvas(512, 160);
    g.fillStyle = "#2a0606";
    g.fillRect(0, 0, 512, 160);
    g.fillStyle = "#ff3b30";
    g.font = "700 96px Montserrat";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(255,60,40,0.9)";
    g.shadowBlur = 24;
    g.fillText("ON AIR", 256, 84);
    canvasMat(ctx, "onAir", canvas, 1.4);
    ctx.mats.glowing.add("onAir");
  }
  const oa = { x: k.x + dirOut.x * (k.R + 0.25), z: k.z + dirOut.z * (k.R + 0.25) };
  ctx.g(z, "black").add(box(0.62, 0.22, 0.08), xf(oa.x, h + 1.05, oa.z, faceYaw(dirOut.x, dirOut.z)), "ON AIR light");
  panel(ctx, z, "onAir", new Vector3(oa.x + dirOut.x * 0.045, h + 1.05, oa.z + dirOut.z * 0.045), 0.56, 0.175, dirOut.x, dirOut.z, "ON AIR light");
  for (const deg of [201.5, 248.5]) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    sconce(ctx, z, new Vector3(k.x + c * (k.R + 0.3), 2.0, k.z + sn * (k.R + 0.3)), faceYaw(c, sn));
  }
  ctx.lights.push({ pos: new Vector3(mid.x + dirOut.x * 1.2, 3.0, mid.z + dirOut.z * 1.2), color: "#ffb766", day: 1.5, night: 6, range: 6, rooms: ["mixchimp", "entryHall", "core"], level: "lower" });
  rectRug(ctx, z, new Vector3(mid.x - dirOut.x * 0.75, F, mid.z - dirOut.z * 0.75), 1.3, 0.8, Math.atan2(-u.z, u.x), rugs.knit(ctx), "Doormat");

  // ---------------------------------------------------------------- window band
  const { sill, head } = MIX_WINDOWS;
  for (const win of wins) {
    ctx.wall(win, LEVEL.lower - 0.1, C);
    studioWall(ctx, z, win, 0, sill, "MixChimp window wall");
    studioWall(ctx, z, win, head, C, "MixChimp window wall");
    ctx.g(z, "timber").add(strip(win, -0.08, 0.26, sill, sill + 0.04), undefined, "Window sill");
    ctx.g(z, "timber").add(strip(win, -0.03, 0.21, head - 0.04, head), undefined, "Window head");
    glazing(ctx, z, offsetOut(win, 0.09), sill + 0.04, head - 0.04, { step: 1.05, label: "Studio window", sill: false, head: false });
    ledStrip(ctx, z, at(offsetOut(win, -0.06), sill + 0.05), "amberStrip", 0.02);
  }

  // record cabinet and turntable under the windows, inside
  const rx0 = k.x + 0.35;
  const rx1 = MIX_WINDOWS.x1 - 0.35;
  const rz = MIX.z0 + 0.26;
  const rm = (rx0 + rx1) / 2;
  ctx.g(z, "timberDark").add(box(rx1 - rx0, 0.6, 0.42), xf(rm, 0.3, rz), "Record cabinet");
  ctx.g(z, "timber").add(box(rx1 - rx0 + 0.04, 0.03, 0.46), xf(rm, 0.615, rz), "Record cabinet");
  const recCols = ["rust", "teal", "mustard", "coral", "sage", "cream", "black", "tealBright"];
  for (let i = 0; i < 26; i++) ctx.g(z, recCols[i % recCols.length], { castShadow: false }).add(box(0.012, 0.31, 0.31), xf(rx0 + 0.15 + i * 0.022, 0.2, rz - 0.03, 0, 1, 1, 1, 0, (i % 5) * 0.03), "Vinyl records");
  const tt = xf(rm + 0.2, 0.63, rz);
  ctx.g(z, "timber").add(box(0.46, 0.09, 0.36), xf(0, 0.045, 0).multiply(tt), "Turntable");
  ctx.g(z, "black").add(cylinder(0.15, 0.012, 32), xf(-0.05, 0.09, 0).multiply(tt), "Turntable");
  ctx.g(z, "rust", { castShadow: false }).add(cylinder(0.045, 0.004, 20), xf(-0.05, 0.103, 0).multiply(tt));
  ctx.g(z, "chrome").add(beam([new Vector3(0.18, 0.12, -0.12), new Vector3(0.16, 0.12, 0.06), new Vector3(0.04, 0.11, 0.05)].map((v) => Vector3.TransformCoordinates(v, tt)), 0.012, 0.012), undefined, "Tonearm");
  for (const s of [-1, 1]) speaker(ctx, z, xf(rm + 0.2 + s * 0.55, 0.63, rz, Math.PI), 0.2, 0.3, 0.2);
  pottedPlant(ctx, z, new Vector3(rx0 + 0.25, 0.63, rz), "philodendron", { pot: "terracotta", potR: 0.09, potH: 0.14, scale: 0.4, r: rng(57) });

  // floor for the nook the curve leaves between the studio and the stair core
  const nook: P2[] = [{ x: core.x1, z: MIX.z0 }, { x: k.x, z: MIX.z0 }];
  for (let i = 1; i < 16; i++) {
    const a = ((270 - (i / 16) * 90) * Math.PI) / 180;
    nook.push({ x: k.x + Math.cos(a) * k.R, z: k.z + Math.sin(a) * k.R });
  }
  nook.push({ x: MIX.x0, z: k.z }, { x: MIX.x0, z: MIX_WINDOWS.coreZ }, { x: core.x1, z: MIX_WINDOWS.coreZ });
  ctx.g(zone("entryHall", "lower"), "floor").add(polygonFace(ensureCCW(nook), F, true), undefined, "Entry hall floor");
}
