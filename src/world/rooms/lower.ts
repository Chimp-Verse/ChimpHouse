// Lower level interiors: the Entry Hall here; the Arrival Lounge (lounge.ts),
// ChimpVibe Game Room (gameroom.ts), Trading Room (trading.ts) and MixChimp Studio (mixchimp.ts).
// Positions are relative to the room anchors in layout.ts so the rooms follow any layout change.

import { Vector3 } from "@babylonjs/core";
import { rng } from "../geometry/curves";
import { Geo, box, lathe, xf } from "../geometry/geo";
import { WorldCtx, zone } from "../context";
import { HALL_HALF, HALL_SCALE, LEVEL, TREES, atriumVoid, core } from "../layout";
import { makeCanvas, toTexture } from "../materials/canvas";
import { drawLeafEmblem } from "../materials/textures";
import { roundRug } from "../props/furniture";
import { sconce, wovenPendant } from "../props/lights";
import { plant, pottedPlant } from "../props/plants";
import { canvasMat } from "../props/tech";
import { faceYaw, panel, roomLight } from "./common";
import { rugs } from "./rugs";
import { buildTrading } from "./trading";
import { buildLounge } from "./lounge";
import { buildMixChimp } from "./mixchimp";
import { buildGameRoom } from "./gameroom";
import { trunkPlanter, trunkSpan } from "../structure/trunks";
import { trunkShape } from "../environment/trunkShape";

const C = LEVEL.lowerCeil;
const F = LEVEL.lower + 0.012;
const tree = (id: string) => TREES.find((t) => t.id === id)!;

export function buildLowerRooms(ctx: WorldCtx): void {
  buildEntryHall(ctx);
  buildLounge(ctx);
  buildGameRoom(ctx);
  buildTrading(ctx);
  buildMixChimp(ctx);
}

// ------------------------------------------------------------------ entry hall

function buildEntryHall(ctx: WorldCtx) {
  const z = zone("entryHall", "lower");
  const r = rng(11);
  roundRug(ctx, z, new Vector3(0, F, atriumVoid.cz - 1.2), 2.3 * HALL_SCALE, rugs.mosaic(ctx), "Botanical mosaic rug");

  // trunk planters: the soil runs into the bark so no gap shows around the trunk
  // trunk planters: a rim round a bed of soil heaped up against the trunk, with bark mulch,
  // ground cover and the planting set into it
  const ring = (t: ReturnType<typeof tree>, mat: string, h: number, label: string) => {
    const { x, z: pz, R } = trunkPlanter(t);
    const sh = trunkShape(t);
    const c = sh.centre(h);
    const off = Math.hypot(c.x - x, c.z - pz);
    const bark = trunkSpan(t, 0, h).R;
    const ri = Math.max(0.05, sh.inner(h - 0.02) * 0.92 - off);
    const wall = R - 0.21;
    ctx.g(z, mat).add(lathe([[R, 0], [R + 0.05, h * 0.9], [R, h], [R - 0.22, h], [R - 0.25, 0.02]], 48, false, false, 6), xf(x, 0, pz), label);
    // soil height at distance rr from the planter's centre: low at the rim, heaped against the bark
    const soilY = (rr: number) => {
      const u = Math.max(0, Math.min(1, (rr - bark) / (wall - bark)));
      return h - 0.085 + 0.07 * Math.pow(1 - u, 1.6);
    };
    const prof: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const rr = wall - ((wall - (bark + 0.02)) * i) / 8;
      prof.push([rr, soilY(rr)]);
    }
    prof.push([ri, h + 0.01]);
    // listed outer to inner so the surface faces up; a little unevenness round the ring
    const soil = lathe(prof, 64, false, false, 3);
    for (let i = 0; i < soil.pos.length; i += 3) {
      const a = Math.atan2(soil.pos[i + 2], soil.pos[i]);
      const rr = Math.hypot(soil.pos[i], soil.pos[i + 2]);
      soil.pos[i + 1] += 0.012 * Math.sin(a * 5 + rr * 9) * Math.min(1, (wall - rr) * 8);
    }
    soil.computeNormals();
    ctx.g(z, bedSoil(ctx), { castShadow: false }).add(soil, xf(x, 0, pz), "Planter soil");
    const at = (a: number, rr: number) => ({ x: x + Math.cos(a) * rr, z: pz + Math.sin(a) * rr });
    // bark mulch scattered over the soil
    const chips = new Geo();
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      const rr = bark + 0.06 + r() * (wall - bark - 0.1);
      const p = at(a, rr);
      chips.add(box(0.035 + r() * 0.03, 0.006, 0.018 + r() * 0.015), xf(p.x, soilY(rr) + 0.006, p.z, r() * Math.PI, 1, 1, 1, (r() - 0.5) * 0.15));
    }
    ctx.g(z, "timberDark", { castShadow: false }).add(chips, undefined, "Bark mulch");
    // the main planting, set into the soil
    const kinds = ["bromeliad", "fern", "philodendron", "calathea", "monstera", "croton", "bromeliad"] as const;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + r() * 0.3;
      const rr = (bark + wall) / 2 + (r() - 0.5) * 0.1;
      const p = at(a, rr);
      plant(ctx, z, new Vector3(p.x, soilY(rr) - 0.015, p.z), kinds[Math.floor(r() * kinds.length)], 0.7 + r() * 0.6, r);
    }
    // low ground cover filling the gaps
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.17 + r() * 0.2;
      const rr = bark + 0.1 + r() * (wall - bark - 0.18);
      const p = at(a, rr);
      plant(ctx, z, new Vector3(p.x, soilY(rr) - 0.01, p.z), i % 3 === 0 ? "grass" : "fern", 0.28 + r() * 0.15, r);
    }
  };
  ring(tree("treeEastCentral"), "stoneWhite", 0.5, "White stone tree planter");
  ring(tree("treeWestCentral"), "timberDark", 0.35, "Tree planter");

  // lift wall: leaf emblem and sconces
  const lx = (core.lift.x0 + core.lift.x1) / 2;
  const emb = makeCanvas(256, 256);
  drawLeafEmblem(emb.ctx, 128, 220, 190, "#f1dfbd");
  canvasMat(ctx, "emblemCream", emb.canvas, 1.2, true);
  panel(ctx, z, "emblemCream", new Vector3(lx, 3.35, core.lift.z0 - 0.11), 0.9, 0.9, 0, -1, "Leaf emblem");
  sconce(ctx, z, new Vector3(lx - 1.05, 2.0, core.lift.z0 - 0.14), 0);
  sconce(ctx, z, new Vector3(lx + 1.05, 2.0, core.lift.z0 - 0.14), 0);
  sconce(ctx, z, new Vector3(core.x0 + 0.14, 2.3, core.stair.z0 + 0.6), faceYaw(1, 0));

  // big potted plants flanking the stair and doors
  // the two either side of the lift are kept smaller and upright, so their leaves stay out of its way
  pottedPlant(ctx, z, new Vector3(core.stair.x1 + 0.45, 0, core.stair.z0 + 0.5), "monstera", { pot: "cream", potR: 0.28, potH: 0.5, scale: 1.05, narrow: 0.6, r });
  // beside the lift, clear of the way to the MixChimp door
  pottedPlant(ctx, z, new Vector3(core.lift.x1 + 0.5, 0, core.z0 + 0.55), "palm", { pot: "cream", potR: 0.26, potH: 0.45, scale: 0.85, narrow: 0.6, r });
  pottedPlant(ctx, z, new Vector3(-(HALL_HALF - 0.55), 0, 1.0), "philodendron", { pot: "charcoal", potR: 0.28, potH: 0.5, scale: 1.2, r });
  pottedPlant(ctx, z, new Vector3(HALL_HALF - 0.55, 0, 1.0), "bromeliad", { pot: "charcoal", potR: 0.28, potH: 0.45, scale: 1.3, r });

  // atrium pendants hanging from the dome
  const vc = atriumVoid.cz;
  const pend: [number, number, number, number][] = [
    [0, vc + 0.3, 0.55, 1.6],
    [-1.6, vc - 0.9, 0.42, 2.4],
    [1.5, vc - 1.0, 0.4, 2.2],
    [-1.2, vc + 1.6, 0.38, 2.9],
    [1.3, vc + 1.5, 0.45, 2.0],
  ];
  for (const [x, zz, rad, drop] of pend) wovenPendant(ctx, zone("gallery", "upper"), new Vector3(x, LEVEL.domeSpring + 0.8, zz), rad, drop, { label: "Atrium woven pendant" });
  for (const [x, zz] of [
    [-3.0, 1.6],
    [3.0, 1.6],
    [-3.0, 7.2],
    [3.0, 7.2],
  ])
    wovenPendant(ctx, z, new Vector3(x, C, zz), 0.24, 0.9);

  roomLight(ctx, "entryHall", "lower", new Vector3(0, 3.2, vc), 8, 28, 16, "#ffbb70", ["core"]);
  // lights the stair core's upper floor too, so the floor reads as one surface across the doorway
  roomLight(ctx, "gallery", "upper", new Vector3(0, 8.6, vc), 6, 26, 16, "#ffbb70", ["entryHall", "roofs", "core"]);
  roomLight(ctx, "core", "lower", new Vector3(0, 2.6, core.z0 + 1.5), 4, 12, 9, "#ffb766", ["entryHall"]);
}

/** Loamy planting soil: dark brown with darker clods, lighter grit and a few pebbles. */
function bedSoil(ctx: WorldCtx): string {
  const key = "bedSoil";
  if (ctx.mats.has(key)) return key;
  const { canvas, ctx: g } = makeCanvas(512, 512);
  g.fillStyle = "#4d3626";
  g.fillRect(0, 0, 512, 512);
  let seed = 5;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const blot = (n: number, r0: number, r1: number, cols: string[], alpha: number) => {
    g.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.beginPath();
      g.ellipse(rnd() * 512, rnd() * 512, r0 + rnd() * (r1 - r0), r0 + rnd() * (r1 - r0), rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  };
  blot(220, 8, 26, ["#3a281c", "#2f2016", "#5a4030"], 0.5);
  blot(1600, 1, 3, ["#6e5640", "#7d6550", "#2a1c12", "#8a7660"], 0.8);
  blot(40, 3, 6, ["#8f8578", "#a39a8c", "#6f665a"], 0.95);
  g.globalAlpha = 1;
  ctx.mats.pbr(key, { tex: toTexture(ctx.scene, key, canvas), rough: 1 });
  return key;
}
