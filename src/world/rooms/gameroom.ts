// ChimpVibe Game Room (lower level, front-right). Two rows of arcade
// cabinet slots, one along the north wall under the 3D ChimpVibe sign and one
// along the south glass, filled at run time with the cabinets of the games
// admitted to ChimpHouse (engine/arcade.ts); a console lounge facing the big TV in the round east end
// with bean bags in front; air hockey and foosball on the open floor; pinball
// machines in the north-east curve; a claw machine and a snack machine in the
// south-east curve; a GAME ON neon over the north wall's west end.

import { Vector3 } from "@babylonjs/core";
import { rng } from "../geometry/curves";
import { Geo, box, cylinder, lathe, softBox, sphere, torus, tube, xf } from "../geometry/geo";
import { WorldCtx, zone } from "../context";
import { GAME, LEVEL, TREES } from "../layout";
import { beanBag, pinball } from "../props/arcade";
import { airHockey } from "../props/airHockey";
import { clawMachine, plushChimp } from "../props/clawMachine";
import { foosball } from "../props/foosball";
import { sodaCan } from "../props/barware";
import { drumTable, lowStool, roundRug, sofa } from "../props/furniture";
import { chimpVibeSign, neonWord, neonWordWidth } from "../props/lettering3d";
import { ringPendant, wovenPendant } from "../props/lights";
import { pottedPlant } from "../props/plants";
import { snackMachine } from "../props/snackMachine";
import { screenMat, tvConsole } from "../props/tech";
import { ROLE } from "../roles";
import { trunkPlanter } from "../structure/trunks";
import { K, arcDeg, at3, faceToward, faceYaw, interiorArch, roomLight } from "./common";
import { rugs } from "./rugs";

const C = LEVEL.lowerCeil;
const F = LEVEL.lower + 0.012;
const tree = (id: string) => TREES.find((t) => t.id === id)!;

/** How far in front of a cabinet a visitor stands to play: behind its stool, with the whole cabinet in view. */
const STAND = 1.55;

/**
 * A cabinet slot: an admitted ChimpVibe game's cabinet is put here at run time
 * (engine/arcade.ts). Base at (x, z) on the floor, facing (dx, dz).
 */
function cabinetSlot(ctx: WorldCtx, z: ReturnType<typeof zone>, n: number, x: number, zz: number, dx: number, dz: number) {
  ctx.slot(z, ROLE.cabinetSlot, n, xf(x, F, zz, faceYaw(dx, dz)), new Vector3(0, 0, -STAND), `Cabinet slot ${n}`);
}

export function buildGameRoom(ctx: WorldCtx): void {
  const z = zone("gameRoom", "lower");
  const r = rng(31);
  const { c, x0, x1, z1 } = GAME;
  // ChimpVibe sign on the east end of the north wall's solid stretch, beside the window, where
  // it faces the way in from the hall; the left row of cabinets stands against it. The west end,
  // by the trunk planter, carries the GAME ON neon and a palm.
  const boardZ = z1 - 0.12;
  const rowZ = boardZ - 0.78;
  const pitch = 0.9;
  const pl = trunkPlanter(tree("treeEastCentral"));
  const past = (clear: number, zz: number) => pl.x + Math.sqrt(Math.max(0, clear * clear - (zz - pl.z) ** 2));
  const wallEnd = c.x - 0.3; // where the north wall's glazing begins
  const lastX = wallEnd - 0.65;
  const rowX0 = lastX - 3 * pitch;
  const bx0 = rowX0 - 0.5;
  const bx1 = lastX + 0.5;
  const bw = bx1 - bx0;
  const bx = (bx0 + bx1) / 2;
  // the sign in 3D: plank board flush on the wall, channel letters and the tree standing off it
  chimpVibeSign(ctx, z, xf(bx, 3.3, z1), bw, 1.3);
  // plant shelf fixed to the wall under the sign, on brackets
  const shelfZ = z1 - 0.18;
  const shelfM = at3(bx, 2.28, shelfZ, 0, -1);
  ctx.g(z, "timber").add(box(bw, 0.05, 0.36), shelfM, "Plant shelf");
  const brackets = new Geo();
  for (const dx of [-bw / 2 + 0.25, 0, bw / 2 - 0.25]) brackets.add(box(0.04, 0.22, 0.3), xf(dx, -0.135, 0.02));
  ctx.g(z, "black").add(brackets, shelfM, "Plant shelf");
  ctx.g(z, "amberStrip", { castShadow: false }).add(box(bw - 0.2, 0.015, 0.02), xf(0, -0.04, -0.15).multiply(shelfM));
  const nPots = Math.floor((bw - 0.3) / 0.66) + 1;
  for (let i = 0; i < nPots; i++) pottedPlant(ctx, z, new Vector3(bx + (i - (nPots - 1) / 2) * 0.66, 2.31, shelfZ), i % 2 ? "fern" : "philodendron", { pot: i % 3 ? "cream" : "terracotta", potR: 0.09, potH: 0.16, scale: 0.45, r });

  const stools = ["tealDeep", "plum", "tealDeep", "rust"];
  for (let i = 0; i < 4; i++) {
    const x = rowX0 + i * pitch;
    cabinetSlot(ctx, z, 1 + i, x, rowZ, 0, -1);
    lowStool(ctx, z, new Vector3(x + 0.05, F, rowZ - 0.95), stools[i]);
  }
  // right row in front of the south glazing (slot 5 furthest from the hall)
  const stools2 = ["tealDeep", "mustard", "tealDeep", "rust"];
  for (let i = 0; i < 4; i++) {
    const x = c.x - 0.6 * K - i * 0.95;
    const zz = 0.75 + (3 - i) * 0.08;
    cabinetSlot(ctx, z, 5 + i, x, zz, -0.35, 1);
    lowStool(ctx, z, new Vector3(x - 0.3, F, zz + 1.0), stools2[i]);
  }
  // console lounge: TV before the east window, curved sofa, table, rug, pouf
  const tvx = x1 - 0.75;
  tvConsole(ctx, z, xf(tvx, F, c.z, faceYaw(-1, 0)), 2.3, 1.3, screenMat(ctx, "game-tv", 1.15), 2.8);
  const tx = c.x + 0.7 * K;
  roundRug(ctx, z, new Vector3(tx - 0.2, F, c.z), 2.8 * K, rugs.gameJute(ctx), "Woven rug");
  sofa(ctx, z, arcDeg(tx, c.z, 1.95 * K, 112, 248, 32), { mat: "tealDeep", r, pillows: ["mustard", "rust", "mustard", "coral"], label: "Curved console sofa" });
  drumTable(ctx, z, new Vector3(tx, F, c.z), 0.85, 0.38);
  for (const [dx, dz] of [
    [-0.25, 0.2],
    [0.1, -0.3],
  ])
    ctx.g(z, "black", { castShadow: false }).add(softBox(0.16, 0.05, 0.1, 0.02), xf(tx + dx, 0.41, c.z + dz, r()), "Game controller");
  pottedPlant(ctx, z, new Vector3(tx + 0.15, 0.39, c.z + 0.15 * K), "fern", { pot: "terracotta", potR: 0.1, potH: 0.14, scale: 0.5, r });
  // gaming bits on the coffee table: cans, a headset, a stack of game cases, a bowl of snacks
  sodaCan(ctx, z, new Vector3(tx - 0.42, 0.38, c.z - 0.1), r);
  sodaCan(ctx, z, new Vector3(tx - 0.35, 0.38, c.z + 0.05), r);
  headset(ctx, z, new Vector3(tx + 0.4, 0.38, c.z - 0.25));
  const cases = ["tealDeep", "rust", "mustard", "navy"];
  cases.forEach((mat, i) => ctx.g(z, mat, { castShadow: false }).add(box(0.14, 0.015, 0.19), xf(tx + 0.3, 0.388 + i * 0.016, c.z + 0.35, 0.2 + i * 0.12), "Game cases"));
  ctx.g(z, "timber").add(lathe([[0.001, 0], [0.08, 0.01], [0.13, 0.06]], 18), xf(tx - 0.15, 0.38, c.z - 0.42), "Snack bowl");
  for (let i = 0; i < 9; i++) ctx.g(z, "mustard", { castShadow: false }).add(sphere(0.022, 6, 5), xf(tx - 0.15 + Math.cos(i * 2.4) * 0.06, 0.42 + (i % 3) * 0.012, c.z - 0.42 + Math.sin(i * 2.4) * 0.06), "Snacks");
  // bean bags in front of the TV for the players
  for (const [dz, mat] of [
    [-1.15, "rust"],
    [1.15, "tealBright"],
  ] as [number, string][]) {
    const p = { x: tvx - 2.6, z: c.z + dz };
    beanBag(ctx, z, xf(p.x, F, p.z, faceToward(p.x, p.z, tvx, c.z)), mat);
  }

  // ---------------------------------------------------------------- games on the open floor
  // air hockey in the middle, its long axis east-west; foosball nearer the hall
  const ah = { x: x0 + 6.0, z: c.z - 0.6 };
  airHockey(ctx, z, xf(ah.x, F, ah.z));
  ringPendant(ctx, z, new Vector3(ah.x, C, ah.z), 0.6, 1.6);
  const fb = { x: x0 + 4.0, z: z1 - 4.5 };
  foosball(ctx, z, xf(fb.x, F, fb.z, 0.12));
  wovenPendant(ctx, z, new Vector3(fb.x, C, fb.z), 0.26, 1.7, { shape: "drum" });

  // pinball machines in the north-east curve, facing into the room
  for (const [deg, title, body, a, b] of [
    [69, "JUNGLE QUEST", "arcadeBlue", "#1d2a6b", "#2fbf8f"],
    [78.5, "BANANA BLITZ", "arcadePink", "#5a1a6e", "#f2a830"],
  ] as [number, string, string, string, string][]) {
    const p = arcDeg(c.x, c.z, GAME.r - 0.95, deg, deg, 1)[0];
    pinball(ctx, z, xf(p.x, F, p.z, faceToward(p.x, p.z, c.x, c.z)), title, body, a, b);
  }
  // claw machine and snack machine in the south-east curve
  {
    const p = arcDeg(c.x, c.z, GAME.r - 0.78, -73, -73, 1)[0];
    clawMachine(ctx, z, xf(p.x, F, p.z, faceToward(p.x, p.z, c.x, c.z)));
    const q = arcDeg(c.x, c.z, GAME.r - 0.72, -59, -59, 1)[0];
    snackMachine(ctx, z, xf(q.x, F, q.z, faceToward(q.x, q.z, c.x, c.z)));
    // a plush chimp won from the claw, left on the bromeliad's pot rim
    plushChimp(ctx, z, xf(c.x + 0.4 * K + 0.32, F, 0.75, -0.6), 1.2);
  }

  // GAME ON in pink neon on the north wall's west end, with a palm below it beside the trunk planter;
  // a strip of light along the cabinet row's base
  const westX = past(pl.R + 0.2, z1 - 0.2);
  const gw = neonWordWidth("GAME ON", 0.32);
  neonWord(ctx, z, xf(Math.min((westX + bx0) / 2, bx0 - 0.2 - gw / 2), 3.4, z1), "GAME ON", 0.32, "#ff4fa3", "neonPink");
  const plantX = (past(pl.R + 0.35, z1 - 0.75) + rowX0 - 0.45) / 2;
  pottedPlant(ctx, z, new Vector3(plantX, F, z1 - 0.75), "palm", { pot: "charcoal", potR: 0.26, potH: 0.5, scale: 1.1, r });
  ctx.g(z, "neonCyan", { castShadow: false }).add(box(lastX - rowX0 + 0.8, 0.02, 0.02), xf((rowX0 + lastX) / 2, F + 0.012, rowZ - 0.36), "Floor light");
  // lighting: halo rings and woven globes
  ringPendant(ctx, z, new Vector3(c.x - 1.0 * K, C, c.z + 0.3 * K), 0.7, 0.75);
  ringPendant(ctx, z, new Vector3(tx, C, c.z), 0.75, 1.05);
  wovenPendant(ctx, z, new Vector3(tvx - 1.2 * K, C, c.z + 2.6 * K), 0.36, 0.8);
  // arch over the room toward the hall, springing from the north-east corner
  const archFoot = { x: c.x + 0.2, z: z1 - 1.0 };
  interiorArch(ctx, "gameRoom", "lower", archFoot, { x: x0 + 1.4, z: 0.9 }, 0, C - 0.05, 0.33);
  // plants
  // either side of the TV, set back from the curved glass so the leaves clear it
  for (const [deg, kind, s] of [
    [32, "monstera", 1.2],
    [-32, "palm", 1.0],
  ] as [number, "monstera" | "palm", number][]) {
    const p = arcDeg(c.x, c.z, GAME.r - 1.3, deg, deg, 1)[0];
    pottedPlant(ctx, z, new Vector3(p.x, F, p.z), kind, { pot: "cream", potR: 0.3, potH: 0.55, scale: s, r });
  }
  pottedPlant(ctx, z, new Vector3(c.x + 0.4 * K, F, 0.75), "bromeliad", { pot: "cream", potR: 0.25, potH: 0.4, scale: 1.2, r });
  roomLight(ctx, "gameRoom", "lower", new Vector3(c.x, 3.5, c.z), 4, 15, 11);
  roomLight(ctx, "gameRoom", "lower", new Vector3(ah.x, 3.0, ah.z), 1.5, 6, 6, "#ffd0a0");
  roomLight(ctx, "gameRoom", "lower", new Vector3(rowX0 + 1.4, 3.0, rowZ - 1.5), 3, 10, 7, "#ffb070");
}

/** Over-ear gaming headset lying on a table at p. */
function headset(ctx: WorldCtx, z: ReturnType<typeof zone>, p: Vector3) {
  const band: Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    band.push(new Vector3(p.x + Math.cos(a) * 0.09, p.y + 0.035, p.z + Math.sin(a) * 0.08));
  }
  ctx.g(z, "black").add(tube(band, 0.011, 8), undefined, "Gaming headset");
  for (const s of [-1, 1]) {
    ctx.g(z, "black").add(cylinder(0.045, 0.035, 18), xf(p.x + s * 0.09, p.y, p.z), "Gaming headset");
    ctx.g(z, "neonCyan").add(torus(0.04, 0.004, 18, 4), xf(p.x + s * 0.09, p.y + 0.036, p.z), "Gaming headset");
  }
}
