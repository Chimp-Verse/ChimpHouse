// The shared arcade cabinet: one basic design built in code and dressed for
// each admitted ChimpVibe game (its palette on the sides and trim, a marquee
// with its name, its art on the screen). Unlike the rest of the house it is
// built as meshes of its own in a cabinet slot, so cabinets come and go at run
// time without rebuilding the room. After the Blender cut-over it stays as the
// stand-in for a newly admitted game whose own cabinet isn't made yet.

import { DynamicTexture, Matrix, Mesh, Quaternion, TransformNode } from "@babylonjs/core";
import { ensureCCW } from "../geometry/curves";
import { Geo, box, cylinder, lathe, plane, slab, xf } from "../geometry/geo";
import { MeshMeta, SlotMeta } from "../context";
import { Materials } from "../materials/library";
import { makeCanvas, toTexture } from "../materials/canvas";
import { ROLE, ScreenMeta } from "../roles";

/** What a cabinet is dressed with: a game from the arcade's list. */
export interface CabinetDress {
  gameId: string;
  name: string;
  palette: string[];
  /** the game's art for the screen (an image URL the page may read), if any */
  art: string | null;
}

/** The screen, in metres: 16:10, so the 16:9 art loses little and games letterbox little. */
export const CABINET_SCREEN = { w: 0.6, h: 0.375 } as const;

export interface Cabinet {
  root: TransformNode;
  meshes: Mesh[];
  /** the meshes that cast the sun's shadow */
  casters: Mesh[];
  /** the screen: role "cabinet-screen", centred on its origin and facing -Z, UVs 0..1 */
  screen: Mesh;
  /** Show a sign on the screen, OUT OF ORDER by default, with the reason in small print; or the game's art again with null. */
  outOfOrder(reason: string | null, title?: string): void;
  dispose(): void;
}

const W = 0.72;
/** where the screen sits in the cabinet: tilted back, under the marquee */
const SCREEN_AT = xf(0, 1.34, 0.03, 0, 1, 1, 1, -0.12);

/** Build a game's cabinet in a slot (a node with SlotMeta). */
export function buildCabinet(mats: Materials, slot: TransformNode, dress: CabinetDress): Cabinet {
  const scene = mats.scene;
  const sm = slot.metadata as SlotMeta;
  const label = `Arcade cabinet: ${dress.name}`;
  const c = cabinetColors(dress.palette);
  const key = (part: string) => `cabinet:${sm.slot}:${dress.gameId}:${part}`;
  const own: string[] = [];
  const mat = (part: string, make: (k: string) => void) => {
    const k = key(part);
    make(k);
    own.push(k);
    return k;
  };
  const side = mat("side", (k) => mats.pbr(k, { color: c.side, rough: 0.35, clearCoat: 0.5 }));
  const trim = mat("trim", (k) => mats.unlit(k, { color: c.trim, intensity: 1.6 }));
  const marqueeTex = toTexture(scene, key("marqueeTex"), marqueeCanvas(dress.name, c), { wrap: false });
  const marquee = mat("marquee", (k) => mats.unlit(k, { tex: marqueeTex, intensity: 1.3 }));
  const screenCanvas = makeCanvas(1024, 640).canvas;
  const screenTex = toTexture(scene, key("screenTex"), screenCanvas, { wrap: false }) as DynamicTexture;
  const screenMat = mat("screen", (k) => mats.unlit(k, { tex: screenTex, intensity: 1.15 }));

  // the body, by material, in the slot's local space (front faces -Z, base at the origin)
  const parts = new Map<string, Geo>();
  const g = (m: string) => {
    let geo = parts.get(m);
    if (!geo) parts.set(m, (geo = new Geo()));
    return geo;
  };
  // side panel profile in (depth, height); the control deck juts forward
  const prof = ensureCCW([
    { x: 0.0, z: 0.0 },
    { x: 0.62, z: 0.0 },
    { x: 0.62, z: 1.9 },
    { x: -0.02, z: 1.9 },
    { x: -0.02, z: 1.66 },
    { x: -0.1, z: 1.62 },
    { x: -0.12, z: 1.06 },
    { x: -0.22, z: 0.98 },
    { x: 0.0, z: 0.92 },
  ]);
  // permutation: slab (x, y, z) -> (y, z, x): the extrusion axis becomes the width
  const perm = Matrix.FromValues(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  for (const sx of [-W / 2, W / 2]) g(side).add(slab(prof, sx - 0.02, sx + 0.02), perm, label);
  const inner = g("black");
  inner.add(box(W - 0.06, 0.92, 0.6), xf(0, 0.46, 0.31), label);
  inner.add(box(W - 0.06, 0.06, 0.32), xf(0, 0.98, 0.0, 0, 1, 1, 1, -0.25), label);
  inner.add(box(W - 0.06, 0.25, 0.5), xf(0, 1.78, 0.33), label);
  inner.add(box(W - 0.06, 1.0, 0.1), xf(0, 1.35, 0.6), label);
  // the screen's bezel, a little taller than the screen
  inner.add(box(CABINET_SCREEN.w + 0.04, 0.54, 0.02), xf(0, 0, 0.01).multiply(SCREEN_AT), label);
  // neon edges, and a strip under the marquee
  g(trim).add(box(0.015, 1.9, 0.015), xf(-W / 2 - 0.022, 0.95, -0.005), label);
  g(trim).add(box(0.015, 1.9, 0.015), xf(W / 2 + 0.022, 0.95, -0.005), label);
  g(trim).add(box(W - 0.06, 0.012, 0.012), xf(0, 1.655, -0.035), label);
  // controls
  g("red").add(cylinder(0.012, 0.08, 6), xf(-0.15, 1.0, -0.12), label);
  g("red").add(lathe([[0.001, 0], [0.025, 0.01], [0.022, 0.035], [0.001, 0.04]], 10), xf(-0.15, 1.08, -0.12), label);
  for (let i = 0; i < 4; i++) g("bulb").add(cylinder(0.018, 0.02, 10), xf(0.0 + i * 0.065, 1.0, -0.1 - (i % 2) * 0.03), label);
  g(marquee).add(plane(W - 0.04, 0.24), xf(0, 1.78, -0.03), label);

  const root = new TransformNode(label, scene);
  root.parent = slot;
  const meta = (matKey: string): MeshMeta => ({ room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label }], matKey, kind: "dynamic" });
  const meshes: Mesh[] = [];
  const casters: Mesh[] = [];
  const setup = (mesh: Mesh, matKey: string, shadow: boolean) => {
    mesh.parent = root;
    mesh.material = mats.get(matKey);
    mesh.metadata = meta(matKey);
    mesh.receiveShadows = true;
    mesh.renderingGroupId = 1;
    if (shadow) casters.push(mesh);
    meshes.push(mesh);
  };
  for (const [m, geo] of parts) setup(geo.build(`${label}:${m}`, scene), m, m === side || m === "black");

  // the screen: its own mesh, centred on its origin and facing -Z
  const screen = plane(CABINET_SCREEN.w, CABINET_SCREEN.h).build(`${label}:screen`, scene);
  setup(screen, screenMat, false);
  const q = new Quaternion();
  xf(0, 0, -0.004).multiply(SCREEN_AT).decompose(undefined, q, screen.position);
  screen.rotationQuaternion = q;
  screen.metadata = { ...meta(screenMat), role: ROLE.cabinetScreen, slot: sm.slot } satisfies ScreenMeta;

  // the screen: the game's art once it loads, over a placeholder that stays without it
  // (or when the browser won't let the page read it); OUT OF ORDER while ChimpVibe fails
  let disposed = false;
  let art: HTMLImageElement | null = null;
  let broken: string | null = null;
  let sign = "OUT OF ORDER";
  const paint = () => {
    const ctx = screenCanvas.getContext("2d")!;
    const { width: w, height: h } = screenCanvas;
    if (broken !== null) drawOutOfOrder(ctx, w, h, broken, sign);
    else {
      drawPlaceholder(ctx, w, h, dress.name, c);
      if (art) drawCover(ctx, art, w, h);
    }
    screenTex.update(true);
    screenTex.metadata = { art: broken === null && art ? dress.art : null, outOfOrder: broken, sign: broken === null ? null : sign };
  };
  paint();
  if (dress.art) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (disposed) return;
      art = img;
      paint();
    };
    img.onerror = () => console.info(`[arcade] no art for ${dress.name}: ${dress.art}`);
    img.src = dress.art;
  }

  return {
    root,
    meshes,
    casters,
    screen,
    outOfOrder(reason, title = "OUT OF ORDER") {
      if (reason === broken && title === sign) return;
      broken = reason;
      sign = title;
      paint();
    },
    dispose() {
      disposed = true;
      root.dispose(false, false);
      for (const k of own) mats.remove(k);
    },
  };
}

// ---------------------------------------------------------------- colours and canvases

type Hsl = { hex: string; h: number; s: number; l: number };
export type CabinetColors = { side: string; trim: string; dark: string; light: string };

const FALLBACK = ["#1b2a24", "#2f6f55", "#4fb98a", "#7cf2c3", "#d9fff0"];

function hsl(hex: string): Hsl {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hex, h: h * 60, s, l };
}

/**
 * A game's palette as cabinet colours: the sides take its richest mid-dark
 * colour, the neon trim its brightest saturated one, the marquee its darkest
 * and lightest.
 */
export function cabinetColors(palette: string[]): CabinetColors {
  let cs = palette.filter((p) => /^#[0-9a-f]{6}$/i.test(p)).map(hsl);
  if (cs.length < 2) cs = FALLBACK.map(hsl);
  const byL = [...cs].sort((a, b) => a.l - b.l);
  const dark = byL[0];
  const light = byL[byL.length - 1];
  const sideScore = (c: Hsl) => (c.l < 0.15 || c.l > 0.62 ? -1 : 0) + c.s * (1 - Math.abs(c.l - 0.38));
  const side = [...cs].sort((a, b) => sideScore(b) - sideScore(a))[0];
  const trimScore = (c: Hsl) => (c === side ? -2 : 0) + (c.l < 0.4 ? -1 : 0) + c.s + c.l * 0.5;
  const trim = [...cs].sort((a, b) => trimScore(b) - trimScore(a))[0];
  return { side: side.hex, trim: trim.hex, dark: dark.hex, light: light.hex };
}

/** The largest font size (from `start`) at which `text` fits `maxW`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, maxW: number): number {
  let px = start;
  ctx.font = font(px);
  while (px > 20 && ctx.measureText(text).width > maxW) ctx.font = font((px -= 4));
  return px;
}

function marqueeCanvas(name: string, c: CabinetColors): HTMLCanvasElement {
  const W = 1024;
  const H = 362;
  const { canvas, ctx } = makeCanvas(W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, c.dark);
  bg.addColorStop(1, c.side);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = c.trim;
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitFont(ctx, name, (px) => `800 ${px}px Nunito`, 150, W - 120);
  ctx.shadowColor = c.trim;
  ctx.shadowBlur = 28;
  ctx.fillStyle = c.light;
  ctx.fillText(name, W / 2, H / 2 - 18);
  ctx.shadowBlur = 0;
  ctx.font = "700 34px Montserrat";
  ctx.fillStyle = c.trim;
  ctx.fillText("C H I M P V I B E", W / 2, H - 62);
  return canvas;
}

/** The screen before the art loads (or without it): the name on the game's colours. */
function drawPlaceholder(ctx: CanvasRenderingContext2D, W: number, H: number, name: string, c: CabinetColors): void {
  const bg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.7);
  bg.addColorStop(0, c.side);
  bg.addColorStop(1, c.dark);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitFont(ctx, name, (px) => `800 ${px}px Nunito`, 110, W - 140);
  ctx.fillStyle = c.light;
  ctx.fillText(name, W / 2, H / 2 - 20);
  ctx.font = "600 34px Montserrat";
  ctx.fillStyle = c.trim;
  ctx.fillText("PRESS E TO PLAY", W / 2, H / 2 + 70);
}

/** A dead screen with a sign (OUT OF ORDER, GAME FULL) taped across it, and why in small print. */
function drawOutOfOrder(ctx: CanvasRenderingContext2D, W: number, H: number, reason: string, title: string): void {
  // a switched-off screen: near black, faint scan lines and a dull reflection
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);
  const glare = ctx.createLinearGradient(0, 0, W, H);
  glare.addColorStop(0, "rgba(255,255,255,0.07)");
  glare.addColorStop(0.45, "rgba(255,255,255,0)");
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, W, H);
  // the sign, a little crooked, with tape at its corners
  ctx.save();
  ctx.translate(W / 2, H / 2 - 10);
  ctx.rotate(-0.045);
  const sw = 760;
  const sh = 300;
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#f3ecd8";
  ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#c2362b";
  ctx.lineWidth = 8;
  ctx.strokeRect(-sw / 2 + 18, -sh / 2 + 18, sw - 36, sh - 36);
  ctx.fillStyle = "rgba(235,225,190,0.75)";
  for (const [x, y, a] of [
    [-sw / 2, -sh / 2, -0.7],
    [sw / 2, -sh / 2, 0.7],
    [-sw / 2, sh / 2, 0.7],
    [sw / 2, sh / 2, -0.7],
  ]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillRect(-55, -16, 110, 32);
    ctx.restore();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#b8281f";
  fitFont(ctx, title, (px) => `800 ${px}px Nunito`, 110, sw - 90);
  ctx.fillText(title, 0, -22);
  ctx.fillStyle = "#4a3b2a";
  fitFont(ctx, reason, (px) => `600 ${px}px Montserrat`, 30, sw - 90);
  ctx.fillText(reason, 0, 82);
  ctx.restore();
}

/** Draw an image to fill w × h, cropping what overflows. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * k;
  const ih = img.naturalHeight * k;
  ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}
