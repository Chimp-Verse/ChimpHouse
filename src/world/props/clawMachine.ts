// The Chimp Claw: a crane machine full of plush prizes, in the Game Room's
// south-east curve. A glossy cabinet on a black plinth, a glass box lit from
// inside with a jungle back panel, an arched marquee ringed with chasing bulbs,
// the control deck with its ball-top joystick, drop button and credit display,
// a coin door, and the prize chute in the front-left corner behind its acrylic
// guard, dropping to the pickup door below.
//
// The static cabinet is merged into the room by material as the rest of the
// house is. The parts that move are meshes of their own carrying roles
// (world/roles.ts), found by engine/clawMachine.ts: the gantry bridge on its
// rails, the trolley, the cable, the claw head and its prongs, the joystick, the
// drop button, the credit display and the pickup door's flap. The machine's
// root node carries its role and the inside's measurements (ClawSpec), so the
// engine reads where the bed, the chute and the rails are from the node, never
// from this code. The prizes are built at run time (prizeGeo), since they move,
// are won and are restocked.
//
// Built in a local frame with its base at m and its front (where the player
// stands) toward -Z; seen from the front, +X is the player's right.

import { Color3, Matrix, Mesh, PBRMaterial, Quaternion, Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { Geo, box, cylinder, lathe, plane, softBox, sphere, torus, tube, xf } from "../geometry/geo";
import { MeshMeta, WorldCtx, Zone } from "../context";
import { makeCanvas, toTexture } from "../materials/canvas";
import { drawLeafEmblem } from "../materials/textures";
import { ROLE } from "../roles";

/** The cabinet's footprint and heights (m). */
const W = 0.88;
const D = 0.86;
/** top of the base cabinet, the glass box's bottom and top, the header's top */
const BASE_H = 0.86;
const GLASS_B = 0.9;
const GLASS_T = 1.8;
const HEAD_T = 1.97;
const POST = 0.04;
/** where a player stands to play: in front of the deck (local z) */
const STAND = -D / 2 - 0.45;

/**
 * The inside of the machine, in its own frame (metres, base at y 0, front -Z):
 * what engine/clawMachine.ts and its physics need, carried on the root node's
 * metadata so a machine from Blender can carry it too.
 */
export interface ClawSpec {
  /** the prize bed's floor height, and the walls round it: x0..x1 (left to right), z0..z1 (front to back) */
  bedY: number;
  bed: [number, number, number, number];
  /** the chute's opening in the bed floor (x0, x1, z0, z1), and its guard's top above the floor */
  chute: [number, number, number, number];
  guardH: number;
  /** the bin under the chute, behind the pickup door: its floor height, and the door's front plane (z) */
  binY: number;
  doorZ: number;
  /** where the claw's trolley can go (x0, x1, z0, z1), and its home over the chute */
  travel: [number, number, number, number];
  home: [number, number];
  /** the cable's top (the trolley's underside), the cable's length with the claw up, and the head's height to the prongs' hinges */
  cableTop: number;
  cableUp: number;
  hingeDrop: number;
  hingeR: number;
  /** the gantry bridge's height and the rails' x either side */
  bridgeY: number;
  /** the whole cabinet's box (x0, x1, y0, y1, z0, z1), deck and marquee too: what a visitor looks at to be offered it */
  outer: [number, number, number, number, number, number];
}

export const CLAW_SPEC: ClawSpec = {
  bedY: GLASS_B + 0.04,
  bed: [-W / 2 + 0.035, W / 2 - 0.035, -D / 2 + 0.03, D / 2 - 0.045],
  chute: [-W / 2 + 0.035, -0.175, -D / 2 + 0.03, -0.17],
  guardH: 0.14,
  binY: 0.1,
  doorZ: -D / 2,
  travel: [-0.3, 0.31, -0.285, 0.3],
  home: [-0.29, -0.285],
  cableTop: 1.69,
  cableUp: 0.05,
  hingeDrop: 0.078,
  hingeR: 0.027,
  bridgeY: 1.715,
  outer: [-W / 2 - 0.02, W / 2 + 0.02, 0, 2.33, -D / 2 - 0.19, D / 2],
};

/** The prize kinds a machine is stocked with (engine/clawPhysics.ts has their bodies). */
export type PrizeKind = "chimp" | "pinkChimp" | "banana" | "coconut" | "star" | "king";

export const PRIZE_NAMES: Record<PrizeKind, string> = {
  chimp: "Plush Chimp",
  pinkChimp: "Pink Party Chimp",
  banana: "Banana Buddy",
  coconut: "Coco Ball",
  star: "Vibe Star",
  king: "King Kongo",
};

function clawMats(ctx: WorldCtx) {
  const pbr = (key: string, o: Parameters<typeof ctx.mats.pbr>[1]) => {
    if (!ctx.mats.has(key)) ctx.mats.pbr(key, o);
  };
  const unlit = (key: string, o: Parameters<typeof ctx.mats.unlit>[1]) => {
    if (!ctx.mats.has(key)) ctx.mats.unlit(key, o);
    ctx.mats.glowing.add(key);
  };
  pbr("clawBody", { color: "#4a1a6b", rough: 0.28, clearCoat: 0.9 });
  pbr("clawBodyPink", { color: "#e2367f", rough: 0.28, clearCoat: 0.9 });
  pbr("clawFelt", { color: "#2b1240", rough: 0.95 });
  pbr("clawRubber", { color: "#141416", rough: 0.75 });
  pbr("clawAlu", { color: "#d9dce0", rough: 0.22, metal: 0.95 });
  if (!ctx.mats.has("clawAcrylic")) {
    const m = ctx.mats.pbr("clawAcrylic", { color: "#eaf6ff", rough: 0.03, alpha: 0.18 });
    m.backFaceCulling = false;
    m.useRadianceOverAlpha = true;
    m.useSpecularOverAlpha = true;
  }
  if (!ctx.mats.has("clawGlass")) {
    // clearer than the house's windows, so the prizes read through it, still catching reflections
    const m = ctx.mats.pbr("clawGlass", { color: "#ffffff", rough: 0.02, alpha: 0.05 });
    m.environmentIntensity = 0.45;
    m.backFaceCulling = false;
    m.useRadianceOverAlpha = true;
    m.useSpecularOverAlpha = true;
  }
  if (!ctx.mats.has("clawSmoke")) {
    const m = ctx.mats.pbr("clawSmoke", { color: "#2a1838", rough: 0.08, alpha: 0.4 });
    m.backFaceCulling = false;
    m.useSpecularOverAlpha = true;
  }
  unlit("clawLedWhite", { color: "#f4f8ff", intensity: 2.4 });
  unlit("clawNeonPink", { color: "#ff4fa3", intensity: 2.0 });
  unlit("clawNeonCyan", { color: "#40e6ff", intensity: 2.0 });
  // the chasing bulbs: two sets, lit in turn (see the animator in clawMachine)
  unlit("clawBulbA", { color: "#ffe9a8", intensity: 2.6 });
  unlit("clawBulbB", { color: "#ffe9a8", intensity: 2.6 });
  unlit("clawButtonLit", { color: "#ff3d7f", intensity: 1.7 });
  unlit("clawRedBall", { color: "#e8243c", intensity: 0.0 });
  pbr("clawBallRed", { color: "#d91f35", rough: 0.18, clearCoat: 1 });
  plushMat(ctx);
}

/** The prizes' fabric: white plush, coloured by each prize's vertex colours. */
export function plushMat(ctx: { mats: WorldCtx["mats"] }): string {
  const key = "clawPlush";
  if (ctx.mats.has(key)) return key;
  // the house's fabric weave, shared rather than copied (a copied canvas texture is never drawn)
  const base = ctx.mats.get("cream") as PBRMaterial;
  ctx.mats.pbr(key, { color: "#ffffff", bump: base.bumpTexture as Texture, bumpLevel: 0.6, rough: 0.95, sheen: 0.22 });
  return key;
}

/** Flat textured quad w x h in the local XY plane facing -Z, centred at m. */
function face(ctx: WorldCtx, z: Zone, mat: string, m: Matrix, w: number, h: number, label: string) {
  ctx.g(z, mat, { castShadow: false }).add(plane(w, h), m, label);
}

function canvasPbr(ctx: WorldCtx, key: string, draw: () => HTMLCanvasElement, o: { glow?: number; clearCoat?: number; rough?: number } = {}): string {
  if (ctx.mats.has(key)) return key;
  const tex = toTexture(ctx.scene, key, draw(), { wrap: false });
  const m = ctx.mats.pbr(key, { tex, rough: o.rough ?? 0.3, clearCoat: o.clearCoat ?? 0.8 });
  if (o.glow) {
    m.emissiveTexture = tex;
    m.emissiveColor = new Color3(o.glow, o.glow, o.glow);
  }
  return key;
}

function canvasUnlit(ctx: WorldCtx, key: string, draw: () => HTMLCanvasElement, intensity: number): string {
  if (!ctx.mats.has(key)) ctx.mats.unlit(key, { tex: toTexture(ctx.scene, key, draw(), { wrap: false }), intensity });
  ctx.mats.glowing.add(key);
  return key;
}

// ------------------------------------------------------------------ artwork

const FONT = "Nunito, sans-serif";

/** Chunky outlined title text. */
function title(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, edge: string) {
  c.font = `800 ${size}px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = size * 0.2;
  c.strokeStyle = "#1a0826";
  c.strokeText(text, x, y + size * 0.06);
  c.lineWidth = size * 0.12;
  c.strokeStyle = edge;
  c.strokeText(text, x, y);
  const g = c.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  g.addColorStop(0, "#fff7c2");
  g.addColorStop(0.45, fill);
  g.addColorStop(1, "#f08a18");
  c.fillStyle = g;
  c.fillText(text, x, y);
}

/** A cartoon claw, prongs open, at (x, y) of size s. */
function drawClaw(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.save();
  c.translate(x, y);
  c.strokeStyle = "#cfd6de";
  c.lineWidth = s * 0.05;
  c.beginPath();
  c.moveTo(0, -s * 1.2);
  c.lineTo(0, -s * 0.3);
  c.stroke();
  const g = c.createLinearGradient(-s * 0.3, 0, s * 0.3, 0);
  g.addColorStop(0, "#8a96a3");
  g.addColorStop(0.5, "#ffffff");
  g.addColorStop(1, "#7d8894");
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(0, -s * 0.18, s * 0.26, s * 0.2, 0, 0, Math.PI * 2);
  c.fill();
  c.lineCap = "round";
  c.lineWidth = s * 0.09;
  c.strokeStyle = "#e9eef3";
  for (const k of [-1, 0, 1]) {
    c.beginPath();
    c.moveTo(k * s * 0.12, -s * 0.05);
    c.quadraticCurveTo(k * s * 0.55, s * 0.25, k * s * 0.3 + (k === 0 ? s * 0.04 : 0), s * 0.62);
    c.lineTo(k * s * 0.12, s * 0.7);
    c.stroke();
  }
  c.restore();
}

/** A plush chimp face, for the art. */
function drawChimpFace(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.save();
  c.translate(x, y);
  c.fillStyle = "#6b4528";
  for (const k of [-1, 1]) {
    c.beginPath();
    c.arc(k * s * 0.92, -s * 0.1, s * 0.3, 0, Math.PI * 2);
    c.fill();
  }
  c.beginPath();
  c.arc(0, 0, s, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#e8c39b";
  for (const k of [-1, 1]) {
    c.beginPath();
    c.arc(k * s * 0.92, -s * 0.1, s * 0.16, 0, Math.PI * 2);
    c.fill();
  }
  c.beginPath();
  c.ellipse(0, s * 0.28, s * 0.62, s * 0.5, 0, 0, Math.PI * 2);
  c.ellipse(-s * 0.3, -s * 0.18, s * 0.34, s * 0.4, 0, 0, Math.PI * 2);
  c.ellipse(s * 0.3, -s * 0.18, s * 0.34, s * 0.4, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#1a0f0a";
  for (const k of [-1, 1]) {
    c.beginPath();
    c.arc(k * s * 0.28, -s * 0.18, s * 0.11, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = "#fff";
  for (const k of [-1, 1]) {
    c.beginPath();
    c.arc(k * s * 0.28 + s * 0.04, -s * 0.22, s * 0.035, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = "#1a0f0a";
  c.lineWidth = s * 0.07;
  c.lineCap = "round";
  c.beginPath();
  c.arc(0, s * 0.25, s * 0.3, 0.2 * Math.PI, 0.8 * Math.PI);
  c.stroke();
  c.restore();
}

function drawBanana(c: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  const g = c.createLinearGradient(0, -s * 0.3, 0, s * 0.3);
  g.addColorStop(0, "#ffe46b");
  g.addColorStop(1, "#e9a91c");
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-s, -s * 0.15);
  c.quadraticCurveTo(0, s * 0.75, s, -s * 0.15);
  c.quadraticCurveTo(0, s * 0.3, -s, -s * 0.15);
  c.fill();
  c.fillStyle = "#5a3b1c";
  c.fillRect(-s * 1.08, -s * 0.2, s * 0.12, s * 0.1);
  c.restore();
}

/** The marquee: CHIMP CLAW over a burst, a claw dropping on a plush, bananas. */
function marqueeCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(1024, 400);
  const g = c.createRadialGradient(512, 330, 20, 512, 300, 620);
  g.addColorStop(0, "#ff5fb0");
  g.addColorStop(0.35, "#9c2a9e");
  g.addColorStop(1, "#2a0b45");
  c.fillStyle = g;
  c.fillRect(0, 0, 1024, 400);
  // sunburst rays
  c.save();
  c.translate(512, 330);
  for (let i = 0; i < 24; i++) {
    c.rotate((Math.PI * 2) / 24);
    c.fillStyle = i % 2 ? "rgba(255,255,255,0.07)" : "rgba(64,230,255,0.06)";
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(700, -90);
    c.lineTo(700, 90);
    c.fill();
  }
  c.restore();
  drawLeafEmblem(c, 110, 330, 170, "rgba(47,191,143,0.55)");
  drawLeafEmblem(c, 914, 330, 170, "rgba(47,191,143,0.55)");
  drawBanana(c, 150, 120, 50, -0.5);
  drawBanana(c, 875, 120, 50, 0.5);
  drawClaw(c, 512, 70, 46);
  title(c, "CHIMP CLAW", 512, 220, 150, "#ffd23f", "#ff4fa3");
  c.font = `800 38px ${FONT}`;
  c.textAlign = "center";
  c.fillStyle = "#7ff3ff";
  c.fillText("★  GRAB A PLUSH PAL  ★", 512, 340);
  return canvas;
}

/** A base side panel: jungle leaves, a giant claw lifting a plush chimp, stripes. */
function sideCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(512, 512);
  const g = c.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#5a1f82");
  g.addColorStop(1, "#22093a");
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 512);
  c.globalAlpha = 0.9;
  drawLeafEmblem(c, 80, 470, 260, "#1f7a5c");
  drawLeafEmblem(c, 440, 500, 300, "#2a9a70");
  drawLeafEmblem(c, 260, 520, 200, "#36b585");
  c.globalAlpha = 1;
  // stripes along the top
  c.fillStyle = "#ff4fa3";
  c.fillRect(0, 22, 512, 14);
  c.fillStyle = "#40e6ff";
  c.fillRect(0, 44, 512, 8);
  drawClaw(c, 256, 170, 70);
  drawChimpFace(c, 256, 270, 52);
  c.font = `800 46px ${FONT}`;
  c.textAlign = "center";
  c.lineWidth = 8;
  c.strokeStyle = "#1a0826";
  c.strokeText("WIN ME!", 256, 380);
  c.fillStyle = "#ffd23f";
  c.fillText("WIN ME!", 256, 380);
  return canvas;
}

/** The base's front panel, round the pickup door and the coin door. */
function frontCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(512, 420);
  const g = c.createLinearGradient(0, 0, 0, 420);
  g.addColorStop(0, "#5a1f82");
  g.addColorStop(1, "#2a0b45");
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 420);
  c.globalAlpha = 0.85;
  drawLeafEmblem(c, 250, 460, 260, "#1f7a5c");
  c.globalAlpha = 1;
  c.fillStyle = "#ff4fa3";
  c.fillRect(0, 10, 512, 10);
  c.fillStyle = "#40e6ff";
  c.fillRect(0, 28, 512, 6);
  // over the pickup door (left): PRIZE
  c.font = `800 34px ${FONT}`;
  c.textAlign = "center";
  c.fillStyle = "#ffd23f";
  c.fillText("PRIZE", 128, 150);
  c.font = `800 22px ${FONT}`;
  c.fillStyle = "#7ff3ff";
  c.fillText("▼  ▼  ▼", 128, 180);
  drawBanana(c, 300, 60, 22, 0.25);
  c.font = `700 22px ${FONT}`;
  c.fillStyle = "#ffffff";
  c.fillText("1 BANANA COIN", 384, 78);
  c.fillText("= 1 PLAY", 384, 104);
  return canvas;
}

/** The deck's printed overlay: MOVE round the joystick, DROP by the button. */
function deckCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(512, 112);
  const g = c.createLinearGradient(0, 0, 0, 112);
  g.addColorStop(0, "#2b1144");
  g.addColorStop(1, "#1a0a2a");
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 112);
  c.strokeStyle = "#40e6ff";
  c.lineWidth = 3;
  c.strokeRect(6, 6, 500, 100);
  c.font = `800 17px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "#7ff3ff";
  // the joystick sits at u ≈ 0.31, the button at u ≈ 0.67 (see the deck in clawMachine)
  c.fillText("◀  MOVE  ▶", 160, 99);
  c.fillStyle = "#ff8cc4";
  c.fillText("DROP", 343, 99);
  c.fillStyle = "#ffd23f";
  c.font = `800 18px ${FONT}`;
  c.fillText("CHIMP", 455, 40);
  c.fillText("CLAW", 455, 64);
  return canvas;
}

/** The inside's back panel: a lit jungle at dusk. */
function backCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(512, 512);
  const g = c.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#3b1a78");
  g.addColorStop(0.55, "#c2408e");
  g.addColorStop(1, "#ff9a5a");
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 512);
  c.fillStyle = "rgba(255,240,200,0.9)";
  c.beginPath();
  c.arc(256, 300, 70, 0, Math.PI * 2);
  c.fill();
  for (const [x, y, s, col] of [
    [40, 420, 260, "#1d5e48"],
    [470, 430, 280, "#1d5e48"],
    [150, 500, 220, "#287a5c"],
    [380, 520, 240, "#287a5c"],
    [256, 560, 260, "#33946d"],
  ] as [number, number, number, string][])
    drawLeafEmblem(c, x, y, s, col);
  // a row of lights along the top
  for (let i = 0; i < 12; i++) {
    c.fillStyle = i % 2 ? "#ffd23f" : "#40e6ff";
    c.beginPath();
    c.arc(22 + i * 42, 26, 7, 0, Math.PI * 2);
    c.fill();
  }
  return canvas;
}

/** The pickup door's flap, printed PUSH. */
function flapCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(256, 256);
  c.clearRect(0, 0, 256, 256);
  c.fillStyle = "rgba(255,255,255,0.9)";
  c.font = `800 44px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("PUSH", 128, 70);
  return canvas;
}

// ------------------------------------------------------------------ the machine

/** A mesh of its own for a part that moves, labelled, with its role; parented to `parent`. */
function part(ctx: WorldCtx, z: Zone, parent: TransformNode, geo: Geo, mat: string, label: string, role: string, at?: Matrix): Mesh {
  const mesh = geo.build(label, ctx.scene);
  mesh.material = ctx.mats.get(mat);
  mesh.parent = parent;
  if (at) {
    const q = new Quaternion();
    at.decompose(undefined, q, mesh.position);
    mesh.rotationQuaternion = q;
  }
  // "special": not a solid for the walker (it moves, and it is inside the glass)
  mesh.metadata = { room: z.room, roomName: z.roomName, level: z.level, labels: [{ face: 0, label }], matKey: mat, kind: "special", role } satisfies MeshMeta;
  mesh.receiveShadows = true;
  mesh.renderingGroupId = 1;
  ctx.meshes.push(mesh);
  return mesh;
}

/** An empty node with a role, parented to `parent`, at `at`. */
function node(ctx: WorldCtx, z: Zone, parent: TransformNode, label: string, role: string, at: Matrix): TransformNode {
  const n = new TransformNode(label, ctx.scene);
  n.parent = parent;
  const q = new Quaternion();
  at.decompose(undefined, q, n.position);
  n.rotationQuaternion = q;
  n.metadata = { role, room: z.room, roomName: z.roomName, level: z.level, label };
  return n;
}

/** A rounded rectangle in the canvas, for the arch and the bezels. */
function archPath(w: number, h: number, n: number): Vector3[] {
  // the marquee's outline from the left foot over the arch to the right foot, in its own XY plane
  const pts: Vector3[] = [];
  const rise = h * 0.42;
  const sh = h - rise;
  pts.push(new Vector3(-w / 2, 0, 0));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = -w / 2 + t * w;
    pts.push(new Vector3(x, sh + Math.sin(Math.PI * t) * rise, 0));
  }
  pts.push(new Vector3(w / 2, 0, 0));
  return pts;
}

/** The Chimp Claw, 0.88 m wide, 0.86 m deep and 2.3 m tall to the marquee's crown. Base at m, front -Z. */
export function clawMachine(ctx: WorldCtx, z: Zone, m: Matrix): void {
  clawMats(ctx);
  const label = "Claw machine: Chimp Claw";
  const S = CLAW_SPEC;
  const fz = -D / 2;
  const at = (x: number, y: number, zz: number, ry = 0, rx = 0, rz = 0) => xf(x, y, zz, ry, 1, 1, 1, rx, rz).multiply(m);

  // ---- base cabinet: plinth, glossy body with art on the sides and front, chrome edges
  ctx.g(z, "clawRubber").add(box(W - 0.03, 0.07, D - 0.03), at(0, 0.035, 0), label);
  const body = new Geo();
  body.add(box(W, BASE_H - 0.07, D), xf(0, 0.07 + (BASE_H - 0.07) / 2, 0));
  ctx.g(z, "clawBody").add(body, m, label);
  const side = canvasPbr(ctx, "clawSideArt", sideCanvas);
  for (const s of [-1, 1]) face(ctx, z, side, at(s * (W / 2 + 0.002), 0.07 + (BASE_H - 0.07) / 2, 0, s < 0 ? Math.PI / 2 : -Math.PI / 2), D - 0.06, BASE_H - 0.13, label);
  const front = canvasPbr(ctx, "clawFrontArt", frontCanvas);
  face(ctx, z, front, at(0, 0.07 + 0.36, fz - 0.002), W - 0.06, 0.72, label);
  // vertical chrome edges on the base, and pink neon down the front corners
  const edges = new Geo();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) edges.add(box(0.03, BASE_H - 0.07, 0.03), xf(sx * (W / 2 - 0.005), 0.07 + (BASE_H - 0.07) / 2, sz * (D / 2 - 0.005)));
  ctx.g(z, "chrome").add(edges, m, label);
  for (const sx of [-1, 1]) ctx.g(z, "clawNeonPink", { castShadow: false }).add(box(0.012, BASE_H - 0.12, 0.012), at(sx * (W / 2 - 0.005), 0.07 + (BASE_H - 0.07) / 2, fz - 0.018), label);

  // ---- the control deck: a slab jutting out, its fascia sloping back under it, the overlay on top
  const deckD = 0.17;
  const deckY = 0.915;
  const deckZ = fz - deckD / 2 + 0.02;
  const tilt = -0.09; // falls toward the player
  const deckM = at(0, deckY, deckZ, 0, tilt);
  ctx.g(z, "clawBodyPink").add(softBox(W + 0.02, 0.055, deckD, 0.012), xf(0, -0.03, 0).multiply(deckM), label);
  ctx.g(z, "chrome").add(box(W + 0.03, 0.012, 0.012), xf(0, -0.005, -deckD / 2 - 0.002).multiply(deckM), label);
  ctx.g(z, "clawNeonCyan", { castShadow: false }).add(box(W - 0.02, 0.008, 0.006), xf(0, -0.045, -deckD / 2 - 0.004).multiply(deckM), label);
  const deckArt = canvasPbr(ctx, "clawDeckArt", deckCanvas, { rough: 0.25, clearCoat: 1 });
  ctx.g(z, deckArt, { castShadow: false }).add(new Geo().add(plane(W - 0.03, deckD - 0.02), xf(0, 0, 0, 0, 1, 1, 1, Math.PI / 2)), xf(0, 0.0015, 0).multiply(deckM), label);
  // under the deck, a fascia from its front edge back to the body
  ctx.g(z, "clawBody").add(box(W, 0.012, 0.2), at(0, 0.83, fz - 0.07, 0, -0.7), label);
  // joystick: chrome bezel, rubber boot, and (moving) shaft and ball
  const joyX = -0.17;
  const joyZ = 0.012;
  ctx.g(z, "chrome").add(cylinder(0.034, 0.006, 28), xf(joyX, 0, joyZ).multiply(deckM), "Claw joystick");
  ctx.g(z, "clawRubber").add(lathe([[0.026, 0], [0.024, 0.008], [0.016, 0.02], [0.009, 0.03], [0.006, 0.036]], 20), xf(joyX, 0.005, joyZ).multiply(deckM), "Claw joystick");
  // drop button: chrome bezel ring and the (moving) lit dome
  const btnX = 0.15;
  const btnZ = 0.012;
  ctx.g(z, "chrome").add(lathe([[0.046, 0], [0.047, 0.006], [0.041, 0.013], [0.036, 0.013]], 32), xf(btnX, 0, btnZ).multiply(deckM), "Claw drop button");
  ctx.g(z, "clawRubber").add(cylinder(0.036, 0.004, 28), xf(btnX, 0.001, btnZ).multiply(deckM), "Claw drop button");
  // the credit and timer display, in a black housing at the back of the deck
  const dispAt = xf(-0.01, 0.026, deckD / 2 - 0.03, 0, 1, 1, 1, -0.45);
  ctx.g(z, "black").add(softBox(0.15, 0.06, 0.03, 0.006), dispAt.multiply(deckM), "Claw credit display");

  // ---- the root, which the engine finds the machine by; the parts that move hang from it
  // (a slot: the prizes, built at run time, go in it; its stand point is where a player stands at the deck)
  const root = ctx.slot(z, ROLE.clawMachine, 1, m, new Vector3(0, 0, STAND), label);
  root.metadata = { ...root.metadata, claw: S };
  const local = (x: number, y: number, zz: number, ry = 0, rx = 0, rz = 0) => xf(x, y, zz, ry, 1, 1, 1, rx, rz);
  const deckLocal = local(0, deckY, deckZ, 0, tilt);

  // joystick: a node at its pivot, tilted by the engine; shaft and ball under it
  const joy = node(ctx, z, root, "Claw joystick", ROLE.clawJoystick, xf(joyX, 0.012, joyZ).multiply(deckLocal));
  part(ctx, z, joy, cylinder(0.0055, 0.085, 12), "chrome", "Claw joystick", ROLE.clawJoystick);
  part(ctx, z, joy, sphere(0.024, 20, 14), "clawBallRed", "Claw joystick", ROLE.clawJoystick, xf(0, 0.098, 0));
  const btnGeo = new Geo().add(cylinder(0.034, 0.008, 28)).add(lathe([[0.034, 0.008], [0.032, 0.016], [0.022, 0.024], [0.001, 0.027]], 28));
  part(ctx, z, root, btnGeo, "clawButtonLit", "Claw drop button", ROLE.clawButton, xf(btnX, 0.003, btnZ).multiply(deckLocal));
  // the display: a canvas the engine paints (credits, the timer)
  const dispKey = "clawDisplay";
  if (!ctx.mats.has(dispKey)) {
    const { canvas, ctx: c } = makeCanvas(256, 96);
    c.fillStyle = "#120406";
    c.fillRect(0, 0, 256, 96);
    c.fillStyle = "#ff3a2a";
    c.font = "700 54px Montserrat, monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("PLAY", 128, 50);
    ctx.mats.unlit(dispKey, { tex: toTexture(ctx.scene, dispKey, canvas, { wrap: false }), intensity: 1.4 });
    ctx.mats.glowing.add(dispKey);
  }
  part(ctx, z, root, plane(0.13, 0.044), dispKey, "Claw credit display", ROLE.clawDisplay, xf(0, 0, -0.0158).multiply(dispAt).multiply(deckLocal));

  // ---- the front: the pickup door (left) and the coin door (right)
  const [cx0, cx1] = S.chute;
  const doorW = cx1 - cx0;
  const doorX = (cx0 + cx1) / 2;
  const doorY0 = S.binY;
  const doorH = 0.27;
  const bezel = new Geo();
  bezel.add(box(doorW + 0.05, 0.025, 0.03), xf(doorX, doorY0 - 0.0125, fz - 0.01));
  bezel.add(box(doorW + 0.05, 0.025, 0.03), xf(doorX, doorY0 + doorH + 0.0125, fz - 0.01));
  for (const s of [-1, 1]) bezel.add(box(0.025, doorH + 0.05, 0.03), xf(doorX + s * (doorW / 2 + 0.0125), doorY0 + doorH / 2, fz - 0.01));
  ctx.g(z, "chrome").add(bezel, m, "Pickup door");
  // the bin behind it: dark walls, a lip at the front
  const bin = new Geo();
  bin.add(box(doorW, 0.01, 0.2), xf(doorX, doorY0 - 0.005, fz + 0.1));
  for (const s of [-1, 1]) bin.add(box(0.01, doorH, 0.2), xf(doorX + s * (doorW / 2 - 0.005), doorY0 + doorH / 2, fz + 0.1));
  bin.add(box(doorW, doorH, 0.01), xf(doorX, doorY0 + doorH / 2, fz + 0.2));
  ctx.g(z, "clawFelt").add(bin, m, "Pickup door");
  // the flap, hinged along its top: a node at the hinge, the smoked panel and its PUSH under it
  const flap = node(ctx, z, root, "Pickup door flap", ROLE.clawDoor, local(doorX, doorY0 + doorH - 0.005, fz - 0.004));
  part(ctx, z, flap, box(doorW - 0.01, doorH - 0.01, 0.005), "clawSmoke", "Pickup door flap", ROLE.clawDoor, xf(0, -(doorH - 0.01) / 2, 0));
  if (!ctx.mats.has("clawPush")) {
    ctx.mats.unlit("clawPush", { tex: toTexture(ctx.scene, "clawPush", flapCanvas(), { wrap: false, hasAlpha: true }), intensity: 1, alphaTest: true });
  }
  part(ctx, z, flap, plane(doorW - 0.03, doorW - 0.03), "clawPush", "Pickup door flap", ROLE.clawDoor, xf(0, -(doorW - 0.03) / 2 - 0.01, -0.004));
  // coin door: a gunmetal plate, two coin entries with lit buttons, a lock
  const coinX = 0.2;
  const coinY = 0.44;
  ctx.g(z, "steel").add(softBox(0.2, 0.3, 0.02, 0.006), at(coinX, coinY, fz - 0.008), "Coin door");
  for (const s of [-1, 1]) {
    ctx.g(z, "chrome").add(softBox(0.06, 0.09, 0.016, 0.004), at(coinX + s * 0.045, coinY + 0.06, fz - 0.02), "Coin slot");
    ctx.g(z, "black").add(box(0.006, 0.034, 0.004), at(coinX + s * 0.045, coinY + 0.075, fz - 0.029), "Coin slot");
    ctx.g(z, "clawButtonLit", { castShadow: false }).add(softBox(0.026, 0.02, 0.006, 0.003), at(coinX + s * 0.045, coinY + 0.035, fz - 0.029), "Coin return");
  }
  ctx.g(z, "chrome").add(new Geo().add(cylinder(0.012, 0.01, 18), xf(0, 0, 0, 0, 1, 1, 1, -Math.PI / 2)), at(coinX, coinY - 0.09, fz - 0.018), "Coin door lock");
  ctx.g(z, "black").add(box(0.003, 0.012, 0.003), at(coinX, coinY - 0.09, fz - 0.029), "Coin door lock");
  // a speaker grille, low on the right
  const grille = new Geo();
  for (let i = 0; i < 5; i++) grille.add(box(0.12, 0.006, 0.006), xf(coinX, 0.13 + i * 0.016, fz - 0.004));
  ctx.g(z, "black").add(grille, m, "Speaker grille");

  // ---- the glass box: aluminium corner posts, frames top and bottom, glass on three sides, the lit back panel
  const posts = new Geo();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.add(softBox(POST, GLASS_T - BASE_H, POST, 0.008), xf(sx * (W / 2 - POST / 2), (BASE_H + GLASS_T) / 2, sz * (D / 2 - POST / 2)));
  // the bottom frame round the glass, and a chrome lip along the front
  for (const s of [-1, 1]) posts.add(box(W, GLASS_B - BASE_H, 0.03), xf(0, (BASE_H + GLASS_B) / 2, s * (D / 2 - 0.015)));
  for (const s of [-1, 1]) posts.add(box(0.03, GLASS_B - BASE_H, D), xf(s * (W / 2 - 0.015), (BASE_H + GLASS_B) / 2, 0));
  ctx.g(z, "clawAlu").add(posts, m, label);
  ctx.g(z, "chrome").add(box(W - 0.04, 0.014, 0.014), at(0, GLASS_B - 0.004, fz - 0.003), label);
  const glass = new Geo();
  const gh = GLASS_T - GLASS_B;
  glass.add(box(W - 2 * POST + 0.01, gh, 0.006), xf(0, GLASS_B + gh / 2, fz + 0.02));
  for (const s of [-1, 1]) glass.add(box(0.006, gh, D - 2 * POST + 0.01), xf(s * (W / 2 - 0.02), GLASS_B + gh / 2, 0));
  ctx.g(z, "clawGlass", { castShadow: false, pickable: false }).add(glass, m, label);
  const back = canvasPbr(ctx, "clawBackArt", backCanvas, { glow: 0.5, rough: 0.9, clearCoat: 0 });
  face(ctx, z, back, at(0, GLASS_B + gh / 2, D / 2 - 0.03), W - 2 * POST, gh, label);
  ctx.g(z, "clawBody").add(box(W - 0.02, gh, 0.01), at(0, GLASS_B + gh / 2, D / 2 - 0.02), label);
  // the prize bed: felt over the floor, round the chute
  const [bx0, bx1, bz0, bz1] = S.bed;
  const [, chx1, , chz1] = S.chute;
  const bed = new Geo();
  bed.add(box(bx1 - chx1, 0.04, bz1 - bz0), xf((chx1 + bx1) / 2, S.bedY - 0.02, (bz0 + bz1) / 2));
  bed.add(box(chx1 - bx0, 0.04, bz1 - chz1), xf((bx0 + chx1) / 2, S.bedY - 0.02, (chz1 + bz1) / 2));
  ctx.g(z, "clawFelt").add(bed, m, "Prize bed");
  // the chute: acrylic guard on its two open sides, a chrome rim, a dark shaft down to the bin
  const gy = S.bedY + S.guardH / 2;
  const guard = new Geo();
  guard.add(box(0.006, S.guardH, chz1 - bz0), xf(chx1, gy, (bz0 + chz1) / 2));
  guard.add(box(chx1 - bx0, S.guardH, 0.006), xf((bx0 + chx1) / 2, gy, chz1));
  ctx.g(z, "clawAcrylic", { castShadow: false, pickable: false }).add(guard, m, "Prize chute guard");
  const rim = new Geo();
  rim.add(tube([new Vector3(chx1, S.bedY + S.guardH, bz0), new Vector3(chx1, S.bedY + S.guardH, chz1), new Vector3(bx0, S.bedY + S.guardH, chz1)], 0.006, 10, true));
  ctx.g(z, "chrome").add(rim, m, "Prize chute guard");
  ctx.g(z, "clawNeonCyan", { castShadow: false }).add(box(chx1 - bx0, 0.008, 0.004), at((bx0 + chx1) / 2, S.bedY + 0.006, chz1 + 0.004), "Prize chute");
  const shaft = new Geo();
  const shaftH = S.bedY - (doorY0 + doorH);
  shaft.add(box(0.008, shaftH, chz1 - bz0), xf(chx1 + 0.004, doorY0 + doorH + shaftH / 2, (bz0 + chz1) / 2));
  shaft.add(box(chx1 - bx0, shaftH, 0.008), xf((bx0 + chx1) / 2, doorY0 + doorH + shaftH / 2, chz1 + 0.004));
  ctx.g(z, "black").add(shaft, m, "Prize chute");

  // ---- the header box over the glass: lit LED strips inside, chasing bulbs on its front band
  const hh = HEAD_T - GLASS_T;
  ctx.g(z, "clawBody").add(box(W + 0.01, hh, D + 0.01), at(0, GLASS_T + hh / 2, 0), label);
  ctx.g(z, "chrome").add(box(W + 0.02, 0.014, D + 0.02), at(0, GLASS_T + 0.007, 0), label);
  ctx.g(z, "chrome").add(box(W + 0.02, 0.014, D + 0.02), at(0, HEAD_T - 0.007, 0), label);
  ctx.g(z, "clawBodyPink").add(box(W - 0.04, hh - 0.05, 0.01), at(0, GLASS_T + hh / 2, fz - 0.006), label);
  const leds = new Geo();
  leds.add(box(W - 0.1, 0.012, 0.02), xf(0, GLASS_T - 0.012, fz + 0.05));
  for (const s of [-1, 1]) leds.add(box(0.02, 0.012, D - 0.16), xf(s * (W / 2 - 0.06), GLASS_T - 0.012, 0));
  ctx.g(z, "clawLedWhite", { castShadow: false }).add(leds, m, "Claw machine lights");
  ctx.g(z, "black").add(box(W - 0.04, 0.012, D - 0.04), at(0, GLASS_T - 0.004, 0), label);
  const bulbsA = new Geo();
  const bulbsB = new Geo();
  const nb = 13;
  for (let i = 0; i < nb; i++) {
    const x = -W / 2 + 0.06 + (i * (W - 0.12)) / (nb - 1);
    (i % 2 ? bulbsB : bulbsA).add(sphere(0.011, 10, 8), xf(x, GLASS_T + hh / 2, fz - 0.013));
  }
  // ---- the marquee on top: an arched sign standing a little forward, ringed with bulbs
  const mw = W - 0.02;
  const mh = 0.36;
  const mz = fz + 0.08;
  const marquee = canvasUnlit(ctx, "clawMarquee", marqueeCanvas, 1.25);
  const arch = archPath(mw, mh, 24);
  // the sign's face: a fan of triangles under the arch, UV-mapped from the canvas
  const sign = new Geo();
  {
    const c0 = sign.vert(0, 0, 0, 0.5, 0, 0, 0, -1);
    const ids = arch.map((p) => sign.vert(p.x, p.y, 0, p.x / mw + 0.5, p.y / mh, 0, 0, -1));
    for (let i = 0; i < ids.length - 1; i++) sign.tri(c0, ids[i + 1], ids[i]);
  }
  ctx.g(z, marquee, { castShadow: false }).add(sign, at(0, HEAD_T, mz - 0.031), "Chimp Claw marquee");
  // its body behind (a slab under the arch) and a chrome edge round it
  const slabG = new Geo();
  for (let i = 1; i < arch.length - 2; i++) {
    const a = arch[i];
    const b = arch[i + 1];
    const w = b.x - a.x;
    const h = Math.min(a.y, b.y);
    slabG.add(box(w + 0.001, h, 0.06), xf((a.x + b.x) / 2, h / 2, 0));
  }
  ctx.g(z, "clawBody").add(slabG, at(0, HEAD_T, mz), "Chimp Claw marquee");
  ctx.g(z, "chrome").add(tube(arch.slice(1, -1), 0.012, 10), at(0, HEAD_T, mz - 0.03), "Chimp Claw marquee");
  ctx.g(z, "chrome").add(tube(arch.slice(1, -1), 0.012, 10), at(0, HEAD_T, mz + 0.03), "Chimp Claw marquee");
  const inner = arch.slice(1, -1);
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const k = t * (inner.length - 1);
    const j = Math.min(inner.length - 2, Math.floor(k));
    const p = Vector3.Lerp(inner[j], inner[j + 1], k - j);
    (i % 2 ? bulbsB : bulbsA).add(sphere(0.012, 10, 8), xf(p.x, HEAD_T + p.y, mz - 0.045));
  }
  ctx.g(z, "clawBulbA", { castShadow: false }).add(bulbsA, m, "Marquee bulbs");
  ctx.g(z, "clawBulbB", { castShadow: false }).add(bulbsB, m, "Marquee bulbs");
  // attract mode: the two sets of bulbs light in turn
  const lampA = ctx.mats.get("clawBulbA") as PBRMaterial;
  const lampB = ctx.mats.get("clawBulbB") as PBRMaterial;
  const lit = Color3.FromHexString("#ffe9a8").toLinearSpace().scale(2.6);
  const dim = lit.scale(0.12);
  let phase = -1;
  ctx.animators.push((t) => {
    const p = Math.floor(t * 3) % 2;
    if (p === phase) return;
    phase = p;
    lampA.emissiveColor = p ? lit : dim;
    lampB.emissiveColor = p ? dim : lit;
  });

  // ---- the gantry: two rails along the sides; the bridge, the trolley, the cable and the claw move
  const rails = new Geo();
  const [tx0, tx1, tz0, tz1] = S.travel;
  for (const s of [-1, 1]) rails.add(box(0.026, 0.03, D - 0.1), xf(s * (W / 2 - 0.06), S.bridgeY + 0.02, 0));
  for (const s of [-1, 1]) rails.add(box(W - 0.1, 0.026, 0.026), xf(0, S.bridgeY + 0.035, s * (D / 2 - 0.06)));
  ctx.g(z, "clawAlu").add(rails, m, "Claw gantry");
  // the bridge spans the rails, with a carriage on each; it is moved along Z by the engine
  const bridge = new Geo();
  bridge.add(box(W - 0.12, 0.022, 0.05), xf(0, 0, 0));
  for (const s of [-1, 1]) bridge.add(box(0.05, 0.035, 0.07), xf(s * (W / 2 - 0.06), 0.004, 0));
  part(ctx, z, root, bridge, "clawAlu", "Claw gantry bridge", ROLE.clawGantry, local(0, S.bridgeY, (tz0 + tz1) / 2));
  // the trolley rides the bridge: a black carriage with its winch drum
  const trolley = new Geo();
  trolley.add(softBox(0.11, 0.045, 0.085, 0.008), xf(0, -0.028, 0));
  trolley.add(new Geo().add(cylinder(0.02, 0.07, 18), xf(0, -0.035, 0)), xf(0, -0.03, 0, 0, 1, 1, 1, 0, Math.PI / 2));
  trolley.add(box(0.03, 0.02, 0.03), xf(0, -0.058, 0));
  part(ctx, z, root, trolley, "black", "Claw trolley", ROLE.clawTrolley, local((tx0 + tx1) / 2, S.bridgeY, (tz0 + tz1) / 2));
  // the cable, 1 m long and hanging from its top: the engine scales it to length
  part(ctx, z, root, new Geo().add(cylinder(0.0016, 1, 6, false), xf(0, -1, 0)), "steel", "Claw cable", ROLE.clawCable, local(0, S.cableTop, 0));
  // the claw's coiled power cord beside the cable, stretched with it
  const coil: Vector3[] = [];
  for (let i = 0; i <= 360; i++) {
    const t = i / 360;
    const a = t * Math.PI * 2 * 30;
    coil.push(new Vector3(0.012 + Math.cos(a) * 0.006, -t, Math.sin(a) * 0.006));
  }
  part(ctx, z, root, tube(coil, 0.0014, 5), "clawRubber", "Claw cord", ROLE.clawCord, local(0, S.cableTop, 0));
  // the claw head, hanging from its eye at the origin: shackle, cap, coil housing, the collar the prongs hinge on
  const head = new Geo();
  head.add(torus(0.007, 0.0018, 14, 6), xf(0, -0.006, 0, 0, 1, 1, 1, Math.PI / 2));
  head.add(lathe([[0.002, -0.012], [0.012, -0.014], [0.026, -0.022], [0.031, -0.03]], 28));
  head.add(cylinder(0.031, 0.034, 28), xf(0, -0.064, 0));
  head.add(lathe([[0.031, -0.064], [0.034, -0.066], [0.034, -0.072], [0.027, -0.079], [0.008, -0.082], [0.002, -0.082]], 28));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    head.add(box(0.012, 0.014, 0.008), xf(Math.cos(a) * S.hingeR, -S.hingeDrop, Math.sin(a) * S.hingeR, -a));
  }
  head.add(torus(0.0315, 0.003, 28, 6), xf(0, -0.047, 0));
  part(ctx, z, root, head, "chrome", "Claw", ROLE.clawHead, local(0, S.cableTop - S.cableUp, 0));
  // one prong, hinged at its origin: out along +X and down, curling in at the tip to a pad
  // (the engine draws three, as thin instances turned round the head)
  const prong = new Geo();
  const path = [new Vector3(0, 0, 0), new Vector3(0.016, -0.018, 0), new Vector3(0.03, -0.045, 0), new Vector3(0.034, -0.075, 0), new Vector3(0.026, -0.1, 0), new Vector3(0.012, -0.114, 0)];
  prong.add(tube(path, (t) => 0.0042 - t * 0.001, 10, true));
  prong.add(softBox(0.016, 0.006, 0.012, 0.0028), xf(0.009, -0.116, 0, 0, 1, 1, 1, 0, -0.5));
  const prongs = part(ctx, z, root, prong, "chrome", "Claw prongs", ROLE.clawProng);
  prongs.parent = root;
  // the light inside, under the header (the room's light budget may drop it: the glow comes from the LED strips)
  ctx.lights.push({ pos: Vector3.TransformCoordinates(new Vector3(0, GLASS_T - 0.12, -0.05), m), color: "#fff2fa", day: 0.7, night: 1.8, range: 1.6, rooms: [z.room], level: z.level });
}

// ------------------------------------------------------------------ the prizes

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const c = Color3.FromHexString(h).toLinearSpace();
  return [c.r, c.g, c.b];
};
const paint = (g: Geo, c: RGB) => g.paint(c[0], c[1], c[2]);

/** A sitting plush chimp, base at the origin facing -Z, about 0.21 m tall. */
function chimpGeo(furHex: string, faceHex: string, s = 1): Geo {
  const fur = hex(furHex);
  const skin = hex(faceHex);
  const dark = hex("#1a100b");
  const g = new Geo();
  const add = (piece: Geo, c: RGB, m: Matrix) => g.add(paint(piece, c), m);
  add(sphere(0.066, 18, 14, 1.05), fur, xf(0, 0.07, 0.005));
  add(sphere(0.045, 14, 10, 0.95), skin, xf(0, 0.072, -0.03, 0, 1, 1, 0.75));
  add(sphere(0.058, 18, 14), fur, xf(0, 0.168, -0.004));
  add(sphere(0.04, 16, 12, 0.85), skin, xf(0, 0.162, -0.038, 0, 1, 1, 0.7));
  add(sphere(0.026, 12, 10, 0.8), skin, xf(0, 0.145, -0.055, 0, 1.2, 1, 0.8));
  for (const k of [-1, 1]) {
    add(sphere(0.022, 12, 10), fur, xf(k * 0.058, 0.19, 0));
    add(sphere(0.013, 10, 8), skin, xf(k * 0.064, 0.19, -0.008, 0, 1, 1, 0.5));
    add(sphere(0.0085, 10, 8), dark, xf(k * 0.019, 0.178, -0.064));
    add(sphere(0.0028, 6, 4), hex("#ffffff"), xf(k * 0.019 + 0.003, 0.182, -0.071));
    add(sphere(0.004, 6, 5), dark, xf(k * 0.008, 0.151, -0.08));
    // arms reaching round the front, hands on the belly
    add(tube([new Vector3(k * 0.055, 0.11, 0), new Vector3(k * 0.07, 0.07, -0.025), new Vector3(k * 0.035, 0.05, -0.055)], (t) => 0.02 - t * 0.004, 10, true), fur, Matrix.Identity());
    add(sphere(0.02, 10, 8), fur, xf(k * 0.055, 0.11, 0));
    add(sphere(0.017, 10, 8), skin, xf(k * 0.032, 0.05, -0.058));
    // legs out in front, feet up
    add(tube([new Vector3(k * 0.035, 0.03, -0.02), new Vector3(k * 0.045, 0.022, -0.075)], 0.022, 10, true), fur, Matrix.Identity());
    add(sphere(0.02, 10, 8, 1.1), skin, xf(k * 0.047, 0.028, -0.092, 0, 1, 1, 0.6));
  }
  add(tube([new Vector3(-0.01, 0.134, -0.073), new Vector3(0, 0.131, -0.076), new Vector3(0.01, 0.134, -0.073)], 0.0018, 5, true), dark, Matrix.Identity());
  return s === 1 ? g : new Geo().add(g, xf(0, 0, 0, 0, s));
}

/** A banana plush lying on its side, centred at the origin, about 0.24 m long along X. */
function bananaGeo(): Geo {
  const yel = hex("#f6cf3a");
  const g = new Geo();
  const pts: Vector3[] = [];
  for (let k = 0; k <= 14; k++) {
    const t = -0.95 + (k / 14) * 1.9;
    pts.push(new Vector3(Math.sin(t) * 0.13, 0.11 - Math.cos(t) * 0.11 + 0.035, 0));
  }
  g.add(paint(tube(pts, (t) => 0.036 * Math.sin(Math.PI * (0.06 + t * 0.88)) + 0.006, 14, true), yel));
  const tip = hex("#5a3b1c");
  for (const [p, q] of [
    [pts[0], pts[1]],
    [pts[14], pts[13]],
  ])
    g.add(paint(tube([p, p.add(p.subtract(q).normalize().scale(0.016))], 0.006, 8, true), tip));
  // a face on the inside of the curve
  const dark = hex("#1a100b");
  for (const k of [-1, 1]) g.add(paint(sphere(0.0065, 8, 6), dark), xf(k * 0.018, 0.045, -0.034));
  g.add(paint(tube([new Vector3(-0.012, 0.03, -0.037), new Vector3(0, 0.025, -0.039), new Vector3(0.012, 0.03, -0.037)], 0.0018, 5, true), dark));
  return g;
}

/** A round coconut plush, base at the origin, 0.13 m across: a fuzzy shell, three dark eyes on its crown, a smile. */
function coconutGeo(): Geo {
  const g = new Geo();
  g.add(paint(sphere(0.064, 20, 16), hex("#6a4426")), xf(0, 0.064, 0));
  g.add(paint(sphere(0.03, 14, 10, 0.4), hex("#e9d9b8")), xf(0, 0.07, -0.058, 0, 1, 1, 1, Math.PI / 2));
  const dark = hex("#1a100b");
  for (const k of [-1, 1]) g.add(paint(sphere(0.007, 8, 6), dark), xf(k * 0.012, 0.078, -0.068));
  g.add(paint(tube([new Vector3(-0.009, 0.062, -0.07), new Vector3(0, 0.058, -0.071), new Vector3(0.009, 0.062, -0.07)], 0.0017, 5, true), dark));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(paint(sphere(0.008, 8, 6), hex("#2b1a0e")), xf(Math.cos(a) * 0.016, 0.126, Math.sin(a) * 0.016));
  }
  return g;
}

/** A five-pointed star plush lying flat, centred at the origin, 0.22 m across and 0.06 m thick. */
function starGeo(): Geo {
  const g = new Geo();
  const col = hex("#2fd0c0");
  const n = 5;
  const R = 0.11;
  const r = 0.05;
  const T = 0.03;
  // a puffed star: rim points round, each a pillow from the centre, top and bottom
  const rim: { x: number; z: number; h: number }[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r : R;
    rim.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, h: i % 2 ? 0.75 : 0.25 });
  }
  const rings = 4;
  for (const side of [1, -1]) {
    const ids: number[][] = [];
    for (let k = 0; k <= rings; k++) {
      const t = k / rings;
      const row: number[] = [];
      for (const p of rim) {
        const y = side * T * Math.sqrt(Math.max(0, 1 - t * t)) * (0.55 + 0.45 * p.h) + T;
        row.push(g.vert(p.x * t, y, p.z * t, 0, 0));
      }
      ids.push(row);
    }
    for (let k = 0; k < rings; k++)
      for (let i = 0; i < rim.length; i++) {
        const j = (i + 1) % rim.length;
        if (side > 0) g.quad(ids[k][i], ids[k + 1][i], ids[k + 1][j], ids[k][j]);
        else g.quad(ids[k][i], ids[k][j], ids[k + 1][j], ids[k + 1][i]);
      }
  }
  g.computeNormals();
  paint(g, col);
  const dark = hex("#1a100b");
  for (const k of [-1, 1]) g.add(paint(sphere(0.008, 8, 6), dark), xf(k * 0.018, 2 * T + 0.002, -0.008));
  g.add(paint(tube([new Vector3(-0.012, 2 * T, 0.012), new Vector3(0, 2 * T, 0.018), new Vector3(0.012, 2 * T, 0.012)], 0.0022, 5, true), hex("#ff4fa3")));
  return g;
}

/** King Kongo: a big chimp with a gold crown, about 0.3 m tall. */
function kingGeo(): Geo {
  const g = chimpGeo("#4a2f1c", "#e3b98e", 1.42);
  const gold = hex("#ffc93a");
  const crown = new Geo();
  crown.add(cylinder(0.038, 0.022, 20, false));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    crown.add(new Geo().add(cylinder(0.009, 0.026, 6, false, 0.001)), xf(Math.cos(a) * 0.034, 0.02, Math.sin(a) * 0.034));
  }
  g.add(paint(crown, gold), xf(0, 0.318, -0.006, 0, 1, 1, 1, -0.12));
  g.add(paint(sphere(0.008, 8, 6), hex("#ff3d7f")), xf(0, 0.33, -0.044));
  return g;
}

/** A prize's look, vertex-coloured for the plush material, in the same frame as its body in engine/clawPhysics.ts. */
export function prizeGeo(kind: PrizeKind): Geo {
  switch (kind) {
    case "chimp":
      return chimpGeo("#6b4528", "#e8c39b");
    case "pinkChimp":
      return chimpGeo("#ff6fae", "#ffe0ec");
    case "banana":
      return bananaGeo();
    case "coconut":
      return coconutGeo();
    case "star":
      return starGeo();
    case "king":
      return kingGeo();
  }
}

/** A plush chimp left out of the machine, sitting. Base at m. */
export function plushChimp(ctx: WorldCtx, z: Zone, m: Matrix, s = 1): void {
  ctx.g(z, plushMat(ctx)).add(chimpGeo("#6b4528", "#e8c39b", s), m, "Plush chimp");
}
