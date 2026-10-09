// The lift beside the stairs: a car that rises in the shaft between the two floors, with
// a pair of landing doors, a call station and an indicator on each floor, and inside the
// car its own doors, its buttons and an indicator.
//
// It is built as a real one is. Each landing's doorway is lined with stainless steel (its
// frame, the reveal through the wall, the grooved sill), and the landing doors run in the
// shaft just behind the wall, sliding behind it to open. The car carries its own doors in
// front of it, which open with the landing's. Inside the shaft everything is dark, so no
// light shows through the doors' gaps.
//
// The car, the doors and the buttons are meshes of their own, since they move or light up
// while the house is in use. engine/lift.ts finds them by role and slot (world/roles.ts),
// so the Blender files carry them the same way. The shaft's walls and the openings through
// the floors are part of the house (facades.ts, floors.ts). Everything here is built at
// rest: the car on the lower floor, the doors shut.

import { DynamicTexture, Mesh, TransformNode } from "@babylonjs/core";
import { Geo, box, cylinder, disc, plane, xf } from "../geometry/geo";
import { MeshMeta, WorldCtx, Zone, zone } from "../context";
import { makeCanvas, toTexture } from "../materials/canvas";
import { LiftGlyph, buttonMat, liftMaterials } from "../materials/lift";
import { LEVEL, LIFT_CAR, LIFT_DOOR, LIFT_SHAFT, core } from "../layout";
import { ROLE } from "../roles";

/** The floors the lift serves, by number: 1 the lower floor, 2 the upper. */
export type Floor = 1 | 2;
export const FLOORS: Floor[] = [1, 2];
/** The height of each floor's top. */
export const FLOOR_Y: Record<Floor, number> = { 1: LEVEL.lower, 2: LEVEL.upper };

/** What an indicator shows: the floor the car is at or passing, and the way it is heading while it travels. */
export interface Shown {
  floor: Floor;
  dir: "up" | "down" | null;
}

/** An indicator's canvas, in pixels: three times as wide as it is high, like its display. */
export const INDICATOR_PX = { w: 480, h: 160 };

const CAR_ZONE = zone("core", "lower");
const LANDING_ZONE: Record<Floor, Zone> = { 1: zone("core", "lower"), 2: zone("core", "upper") };

/** A button's radius and how far it stands proud of its plate (m). */
const BUTTON_R = 0.023;
const BUTTON_D = 0.007;

/** Build the lift: the car, the landing doors and call stations, the indicators and the shaft's lining. */
export function buildLift(ctx: WorldCtx): void {
  liftMaterials(ctx.mats);
  buildCar(ctx);
  for (const f of FLOORS) buildLanding(ctx, f);
  buildShaftLining(ctx);
}

// ------------------------------------------------ the car

function buildCar(ctx: WorldCtx): void {
  const car = new TransformNode("Lift car", ctx.scene);
  car.metadata = { room: CAR_ZONE.room, roomName: CAR_ZONE.roomName, level: CAR_ZONE.level, role: ROLE.liftCar, label: "Lift car" };
  const add = (geo: Geo, mat: string, label: string, extra: Partial<MeshMeta> = {}) => part(ctx, CAR_ZONE, geo, mat, label, { kind: "lift", ...extra }, car);

  const lx = LIFT_CAR.x;
  const hw = LIFT_CAR.halfW;
  const t = LIFT_CAR.wall;
  const H = LIFT_CAR.height;
  const top = FLOOR_Y[1] + LIFT_CAR.floorLift;
  const ceil = top + H;
  // inside: x within ±iw of the centre line, z from the front wall's inner face to the back wall's
  const iw = hw - t;
  const iz0 = LIFT_CAR.z0 + t;
  const iz1 = LIFT_CAR.z1 - t;
  const izc = (iz0 + iz1) / 2;
  const id = iz1 - iz0;
  const half = LIFT_DOOR.w / 2;

  // the platform: a granite floor, and at the doorway the car's grooved sill
  const base = top - 0.14;
  add(new Geo().add(box(2 * hw, top - base, id + t), xf(lx, (top + base) / 2, izc + t / 2)), "liftFloor", "Lift car floor");
  const sillZ0 = LIFT_DOOR.z1 + 0.012;
  add(new Geo().add(box(LIFT_DOOR.w + 0.08, top - base, iz0 - sillZ0), xf(lx, (top + base) / 2, (sillZ0 + iz0) / 2)), "liftSill", "Lift car sill");

  // the shell: side and back walls, the front wall either side of the doorway and the transom over it
  const shell = new Geo();
  shell.add(box(t, H, LIFT_CAR.z1 - LIFT_CAR.z0), xf(lx - hw + t / 2, top + H / 2, (LIFT_CAR.z0 + LIFT_CAR.z1) / 2));
  shell.add(box(t, H, LIFT_CAR.z1 - LIFT_CAR.z0), xf(lx + hw - t / 2, top + H / 2, (LIFT_CAR.z0 + LIFT_CAR.z1) / 2));
  shell.add(box(2 * hw, H, t), xf(lx, top + H / 2, LIFT_CAR.z1 - t / 2));
  const ret = hw - half;
  shell.add(box(ret, H, t), xf(lx - half - ret / 2, top + H / 2, LIFT_CAR.z0 + t / 2));
  shell.add(box(ret, H, t), xf(lx + half + ret / 2, top + H / 2, LIFT_CAR.z0 + t / 2));
  shell.add(box(LIFT_DOOR.w, H - LIFT_DOOR.h, t), xf(lx, top + LIFT_DOOR.h + (H - LIFT_DOOR.h) / 2, LIFT_CAR.z0 + t / 2));
  // the roof, and the housing of the door operator over the car's doors, outside
  shell.add(box(2 * hw, 0.05, LIFT_CAR.z1 - LIFT_CAR.z0), xf(lx, ceil + 0.025, (LIFT_CAR.z0 + LIFT_CAR.z1) / 2));
  add(shell, "liftSteel", "Lift car shell");
  // above the car's doors, between their track and the car's front: never forward of the landing doors' back, or it shows through them as the car passes
  const opZ0 = LIFT_DOOR.z1 + 0.008;
  add(new Geo().add(box(2 * hw - 0.1, 0.2, LIFT_CAR.z0 - opZ0), xf(lx, top + LIFT_DOOR.h + 0.16, (opZ0 + LIFT_CAR.z0) / 2)), "liftSteelDark", "Lift car door operator");

  // the walls inside: a stainless kick plate, then walnut panels set off by steel reveals. The right
  // wall's front panel is the car's operating panel, in steel; the back wall has smoked glass in the middle.
  const kick = 0.12;
  const pTop = ceil - 0.08;
  const pH = pTop - (top + kick);
  const pY = top + kick + pH / 2;
  const gap = 0.012;
  const pt = 0.012;
  const walnut = new Geo();
  const steel = new Geo();
  steel.add(box(0.006, kick, id), xf(lx - iw + 0.003, top + kick / 2, izc));
  steel.add(box(0.006, kick, id), xf(lx + iw - 0.003, top + kick / 2, izc));
  steel.add(box(2 * iw, kick, 0.006), xf(lx, top + kick / 2, iz1 - 0.003));
  const copZ1 = iz0 + 0.34;
  const sidePanels = (side: -1 | 1, z0: number) => {
    const n = side > 0 ? 2 : 3;
    const w = (iz1 - z0 - gap * (n + 1)) / n;
    for (let i = 0; i < n; i++) {
      const zc = z0 + gap + w / 2 + i * (w + gap);
      walnut.add(box(pt, pH, w), xf(lx + side * (iw - pt / 2), pY, zc));
    }
  };
  sidePanels(-1, iz0);
  sidePanels(1, copZ1);
  const cop = xf(lx + iw - pt / 2, pY, (iz0 + gap + copZ1) / 2);
  steel.add(box(pt, pH, copZ1 - iz0 - gap), cop);
  const glassW = 0.86;
  const sideW = (2 * iw - glassW - gap * 4) / 2;
  walnut.add(box(sideW, pH, pt), xf(lx - glassW / 2 - gap - sideW / 2, pY, iz1 - pt / 2));
  walnut.add(box(sideW, pH, pt), xf(lx + glassW / 2 + gap + sideW / 2, pY, iz1 - pt / 2));
  add(new Geo().add(box(glassW, pH, pt), xf(lx, pY, iz1 - pt / 2)), "liftGlass", "Lift car mirror");
  add(walnut, "liftWalnut", "Lift car panels");

  // handrails: round stainless tube on standoffs, along the back wall and the left wall
  const railY = top + 0.9;
  const railR = 0.019;
  const rail = new Geo();
  const backOff = iz1 - pt - 0.055;
  rail.add(cylinder(railR, 2 * iw - 0.4, 20), xf(lx + iw - 0.2, railY, backOff, 0, 1, 1, 1, 0, Math.PI / 2));
  for (const x of [-0.6, 0.6]) rail.add(cylinder(0.008, 0.055, 12), xf(lx + x, railY, iz1 - pt, 0, 1, 1, 1, -Math.PI / 2));
  const sideOff = lx - iw + pt + 0.055;
  rail.add(cylinder(railR, iz1 - iz0 - 0.65, 20), xf(sideOff, railY, iz0 + 0.45, 0, 1, 1, 1, Math.PI / 2));
  for (const z of [iz0 + 0.6, iz1 - 0.35]) rail.add(cylinder(0.008, 0.055, 12), xf(lx - iw + pt, railY, z, 0, 1, 1, 1, 0, -Math.PI / 2));
  add(rail, "liftChrome", "Lift car handrails");
  add(steel, "liftSteel", "Lift car trim");

  // the ceiling: a pale panel with six LED downlights, and a lit cove round its edge
  add(new Geo().add(box(2 * iw, 0.03, id), xf(lx, ceil - 0.015, izc)), "liftCeiling", "Lift car ceiling");
  const leds = new Geo();
  for (const x of [-0.5, 0, 0.5]) for (const z of [-0.38, 0.38]) leds.add(disc(0.045, 32).flip(), xf(lx + x, ceil - 0.031, izc + z));
  leds.add(box(2 * iw - 0.1, 0.008, 0.02), xf(lx, ceil - 0.034, iz0 + 0.04));
  leds.add(box(2 * iw - 0.1, 0.008, 0.02), xf(lx, ceil - 0.034, iz1 - 0.04));
  leds.add(box(0.02, 0.008, id - 0.1), xf(lx - iw + 0.04, ceil - 0.034, izc));
  leds.add(box(0.02, 0.008, id - 0.1), xf(lx + iw - 0.04, ceil - 0.034, izc));
  const lights = add(leds, "liftLed", "Lift car lights");
  ctx.glowMeshes.push(lights);

  // the car's doors, in front of its front wall: shut, meeting in the middle
  const leafH = LIFT_DOOR.h + 0.04;
  const dz = (LIFT_DOOR.carZ0 + LIFT_DOOR.carZ1) / 2;
  const dd = LIFT_DOOR.carZ1 - LIFT_DOOR.carZ0;
  const leafX = LIFT_DOOR.leafW / 2;
  const carLeft = add(new Geo().add(box(LIFT_DOOR.leafW, leafH, dd), xf(lx - leafX, top + 0.004 + leafH / 2, dz)), "liftSteel", "Lift car doors, left", { role: ROLE.liftCarDoorLeft });
  const carRight = add(new Geo().add(box(LIFT_DOOR.leafW, leafH, dd), xf(lx + leafX, top + 0.004 + leafH / 2, dz)), "liftSteel", "Lift car doors, right", { role: ROLE.liftCarDoorRight });
  meetingEdges(ctx, CAR_ZONE, carLeft, carRight, lx, top + 0.004 + leafH / 2, leafH, dz, dd, "Lift car doors");

  // the operating panel, on the right wall by the doors: the floors' buttons, 2 over 1, then the
  // door buttons side by side. Built in the panel's own space (its face toward -Z, x to the right
  // of someone facing it), then turned to face into the car.
  const face = xf(lx + iw - pt - 0.001, top + 1.0, (iz0 + gap + copZ1) / 2, Math.PI / 2);
  const button = (glyph: LiftGlyph, x: number, y: number, label: string, extra: Partial<MeshMeta>) =>
    add(buttonGeo(xf(x, y, 0).multiply(face)), buttonMat(glyph, false), label, extra);
  button("2", 0, 0.27, "Lift car button 2", { role: ROLE.liftFloorButton, slot: 2 });
  button("1", 0, 0.17, "Lift car button 1", { role: ROLE.liftFloorButton, slot: 1 });
  button("open", -0.04, 0.04, "Lift car door-open button", { role: ROLE.liftOpenButton });
  button("close", 0.04, 0.04, "Lift car door-close button", { role: ROLE.liftCloseButton });

  // the car's indicator, on the transom over the doors, facing in
  indicator(ctx, CAR_ZONE, "liftCarIndicator", 0.27, 0.09, lx, top + LIFT_DOOR.h + (H - LIFT_DOOR.h) / 2, iz0, Math.PI, "Lift car indicator", { kind: "lift", role: ROLE.liftCarIndicator }, car);
}

// ------------------------------------------------ each floor's landing

function buildLanding(ctx: WorldCtx, f: Floor): void {
  const z = LANDING_ZONE[f];
  const y0 = FLOOR_Y[f];
  const lx = LIFT_CAR.x;
  const half = LIFT_DOOR.w / 2;
  const h = LIFT_DOOR.h;
  const front = core.lift.z0 - 0.1;
  const back = core.lift.z0 + 0.1;
  const depth = back - front;

  // the stainless frame round the doorway, and the lining of its reveal through the wall
  const frame = new Geo();
  const fw = 0.07;
  const ft = 0.022;
  frame.add(box(fw, h + fw, ft), xf(lx - half - fw / 2, y0 + (h + fw) / 2, front - ft / 2));
  frame.add(box(fw, h + fw, ft), xf(lx + half + fw / 2, y0 + (h + fw) / 2, front - ft / 2));
  frame.add(box(2 * half + 2 * fw, fw, ft), xf(lx, y0 + h + fw / 2, front - ft / 2));
  frame.add(box(0.006, h, depth), xf(lx - half + 0.003, y0 + h / 2, core.lift.z0));
  frame.add(box(0.006, h, depth), xf(lx + half - 0.003, y0 + h / 2, core.lift.z0));
  frame.add(box(2 * half, 0.006, depth), xf(lx, y0 + h - 0.003, core.lift.z0));
  part(ctx, z, frame, "liftSteel", `Lift frame ${f}`);

  // the sill: from in front of the frame to the edge of the shaft, level with the car's floor
  const sillZ1 = LIFT_DOOR.z1 + 0.008;
  const sillTop = y0 + LIFT_CAR.floorLift;
  part(ctx, z, new Geo().add(box(2 * half + 0.1, 0.03, sillZ1 - (front - ft)), xf(lx, sillTop - 0.015, (sillZ1 + front - ft) / 2)), "liftSill", `Lift sill ${f}`);

  // the doors, behind the wall: shut, meeting in the middle, their tops hidden behind the lintel
  const leafX = LIFT_DOOR.leafW / 2;
  const dz = (LIFT_DOOR.z0 + LIFT_DOOR.z1) / 2;
  const dd = LIFT_DOOR.z1 - LIFT_DOOR.z0;
  const leafY = sillTop + 0.002 + LIFT_DOOR.leafH / 2;
  const left = part(ctx, z, new Geo().add(box(LIFT_DOOR.leafW, LIFT_DOOR.leafH, dd), xf(lx - leafX, leafY, dz)), "liftSteel", `Landing doors ${f}, left`, { kind: "lift", role: ROLE.liftDoorLeft, slot: f });
  const right = part(ctx, z, new Geo().add(box(LIFT_DOOR.leafW, LIFT_DOOR.leafH, dd), xf(lx + leafX, leafY, dz)), "liftSteel", `Landing doors ${f}, right`, { kind: "lift", role: ROLE.liftDoorRight, slot: f });
  meetingEdges(ctx, z, left, right, lx, leafY, LIFT_DOOR.leafH, dz, dd, `Landing doors ${f}`);

  // the call station on the pier beside the doors: a steel plate with one button, up from the
  // lower floor and down from the upper
  const cy = y0 + 1.1;
  part(ctx, z, new Geo().add(box(0.1, 0.22, 0.01), xf(LIFT_DOOR.callX, cy, front - 0.005)), "liftSteel", `Lift call station ${f}`);
  const face = xf(LIFT_DOOR.callX, cy, front - 0.01);
  part(ctx, z, buttonGeo(face), buttonMat(f === 1 ? "up" : "down", false), `Lift call button ${f}`, { role: ROLE.liftCallButton, slot: f });

  // the indicator over the doors
  indicator(ctx, z, `liftIndicator${f}`, 0.3, 0.1, lx, y0 + h + fw + 0.16, front, 0, `Lift indicator ${f}`, { role: ROLE.liftIndicator, slot: f });
}

// ------------------------------------------------ the shaft

/**
 * The shaft's inside, painted dark: its side and back walls, and the back of its front wall round
 * each doorway, from the pit to the top. Without it the house's timber cladding would show through
 * the gaps round the car and between the doors.
 */
function buildShaftLining(ctx: WorldCtx): void {
  const { x0, x1, z0, z1 } = LIFT_SHAFT;
  const lx = LIFT_CAR.x;
  const half = LIFT_DOOR.w / 2;
  const t = 0.006;
  for (const f of FLOORS) {
    const z = LANDING_ZONE[f];
    // each level's lining runs from its floor (the lower one from the pit) to the next floor up, or the roof
    const ya = f === 1 ? LEVEL.lower - 0.2 : LEVEL.upper;
    const yb = f === 1 ? LEVEL.upper : LEVEL.upperCeil;
    const h = yb - ya;
    const ym = (ya + yb) / 2;
    const g = new Geo();
    g.add(box(t, h, z1 - z0), xf(x0 + t / 2, ym, (z0 + z1) / 2));
    g.add(box(t, h, z1 - z0), xf(x1 - t / 2, ym, (z0 + z1) / 2));
    g.add(box(x1 - x0, h, t), xf((x0 + x1) / 2, ym, z1 - t / 2));
    // the front: either side of the doorway, and over it
    const dTop = FLOOR_Y[f] + LIFT_DOOR.h;
    g.add(box(lx - half - x0, h, t), xf((x0 + lx - half) / 2, ym, z0 + t / 2));
    g.add(box(x1 - lx - half, h, t), xf((lx + half + x1) / 2, ym, z0 + t / 2));
    g.add(box(2 * half, yb - dTop, t), xf(lx, (dTop + yb) / 2, z0 + t / 2));
    if (f === 2) g.add(box(2 * half, FLOOR_Y[2] - ya, t), xf(lx, (ya + FLOOR_Y[2]) / 2, z0 + t / 2));
    // the pit's floor, under the car when it is down
    if (f === 1) g.add(box(x1 - x0, 0.01, z1 - z0), xf((x0 + x1) / 2, LEVEL.lower + 0.005, (z0 + z1) / 2));
    part(ctx, z, g, "liftShaft", `Lift shaft lining ${f}`);
  }
}

// ------------------------------------------------ the parts

/**
 * A round push button standing proud of its plate: a short cylinder whose face carries the
 * button's symbol. Built facing -Z at the origin of `place`, which puts it on its plate.
 */
function buttonGeo(place: ReturnType<typeof xf>): Geo {
  const g = new Geo().add(cylinder(BUTTON_R, BUTTON_D, 32), xf(0, 0, 0, 0, 1, 1, 1, -Math.PI / 2));
  return new Geo().add(g, place);
}

/** Paint an indicator's canvas (INDICATOR_PX): the floor's number in amber, with an arrow beside it while the car travels. */
export function paintIndicator(g: CanvasRenderingContext2D, shown: Shown): void {
  const { w, h } = INDICATOR_PX;
  g.fillStyle = "#050607";
  g.fillRect(0, 0, w, h);
  // a faint grid of unlit dots, the display's matrix
  g.fillStyle = "#121314";
  for (let y = 8; y < h; y += 10) for (let x = 8; x < w; x += 10) g.fillRect(x, y, 4, 4);
  g.shadowColor = "#ff8a1e";
  g.shadowBlur = 16;
  g.fillStyle = "#ffb25c";
  g.font = "700 120px Montserrat, Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(shown.floor), w / 2 + 40, h / 2 + 8);
  if (shown.dir) {
    const up = shown.dir === "up";
    const cx = w / 2 - 80;
    g.beginPath();
    g.moveTo(cx, up ? 30 : 130);
    g.lineTo(cx + 40, up ? 104 : 56);
    g.lineTo(cx + 14, up ? 104 : 56);
    g.lineTo(cx + 14, up ? 130 : 30);
    g.lineTo(cx - 14, up ? 130 : 30);
    g.lineTo(cx - 14, up ? 104 : 56);
    g.lineTo(cx - 40, up ? 104 : 56);
    g.closePath();
    g.fill();
  }
  g.shadowBlur = 0;
}

/** How wide (m) each leaf's rubber meeting edge is: the two make the dark line where a pair of doors meet. */
const EDGE = 0.004;

/**
 * The black rubber on a pair of doors' meeting edges, each strip carried by its leaf: shut, they
 * meet in a dark line down the middle, solid, so nothing shows through it. Each wraps its leaf's
 * edge a hair proud of both faces, and reaches a hair past it, so the two touch when shut.
 */
function meetingEdges(ctx: WorldCtx, z: Zone, left: Mesh, right: Mesh, x: number, y: number, h: number, dz: number, dd: number, label: string): void {
  const strip = (leaf: Mesh, side: -1 | 1, name: string) =>
    part(ctx, z, new Geo().add(box(EDGE + 0.0005, h, dd + 0.002), xf(x + side * (EDGE - 0.0005) / 2, y, dz)), "liftRubber", `${label}, ${name} edge`, { kind: "lift" }, leaf);
  strip(left, -1, "left");
  strip(right, 1, "right");
}

/** A mesh of its own in the house's materials, labelled, with the metadata the client finds it by. */
function part(ctx: WorldCtx, z: Zone, geo: Geo, mat: string, label: string, extra: Partial<MeshMeta> = {}, parent?: TransformNode): Mesh {
  const mesh = geo.build(label, ctx.scene);
  mesh.material = ctx.mats.get(mat);
  if (parent) mesh.parent = parent;
  mesh.metadata = { room: z.room, roomName: z.roomName, level: z.level, labels: [{ face: 0, label }], matKey: mat, ...extra } as MeshMeta;
  mesh.receiveShadows = true;
  mesh.renderingGroupId = 1;
  // the sun's shadows are drawn once, so the parts that move cast none
  if (extra.kind !== "lift") ctx.shadowCasters.push(mesh);
  ctx.meshes.push(mesh);
  return mesh;
}

/**
 * An indicator on a wall whose face is at `zz`: a display `w` × `h` centred at (x, y) in a black
 * glass housing, facing -Z (yaw 0) or +Z (yaw π). Its canvas is painted by paintIndicator and lit
 * by it; the engine finds the canvas through the material's emissive texture.
 */
function indicator(ctx: WorldCtx, z: Zone, key: string, w: number, h: number, x: number, y: number, zz: number, yaw: number, label: string, extra: Partial<MeshMeta>, parent?: TransformNode): Mesh {
  const { canvas } = makeCanvas(INDICATOR_PX.w, INDICATOR_PX.h);
  const tex = toTexture(ctx.scene, key, canvas, { wrap: false, aniso: 16 }) as DynamicTexture;
  paintIndicator(tex.getContext() as CanvasRenderingContext2D, { floor: 1, dir: null });
  tex.update();
  ctx.mats.unlit(key, { tex, intensity: 1.1 });
  // toward the viewer: -Z for a display facing -Z, +Z for one turned round
  const out = yaw ? 1 : -1;
  part(ctx, z, new Geo().add(box(w + 0.04, h + 0.035, 0.012), xf(x, y, zz + out * 0.006, yaw)), "liftBlackGlass", `${label} housing`, extra.kind ? { kind: extra.kind } : {}, parent);
  return part(ctx, z, new Geo().add(plane(w, h), xf(x, y, zz + out * 0.0125, yaw)), key, label, extra, parent);
}
