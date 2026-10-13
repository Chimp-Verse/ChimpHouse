// The Game Room's air hockey table, built like a coin-op arcade table: a thick
// laminated cabinet on four heavy legs with a blower housing between them, a
// perforated playfield with printed markings under raised rails with rubber
// bumpers, a goal slot through each end rail with a puck return below it, an LED
// strip under the rails, and an overhead scoreboard on a chrome arch whose two
// faces each show the score to one end. The mallets and the puck move, so they
// are meshes of their own, built at run time (buildAirHockeyPieces) and driven
// by engine/airHockey.ts.
//
// Local frame: base at m, the long axis along X, a player at each end (end 1 at
// -X plays red, end 2 at +X plays blue).

import { Matrix, Mesh, TransformNode, Vector3 } from "@babylonjs/core";
import { P2, ensureCCW } from "../geometry/curves";
import { Geo, box, cylinder, lathe, plane, slab, softBox, tube, wallStrip, xf } from "../geometry/geo";
import { MeshMeta, SlotMeta, WorldCtx, Zone } from "../context";
import { Materials } from "../materials/library";
import { makeCanvas, toTexture } from "../materials/canvas";
import { drawLeafEmblem } from "../materials/textures";
import { ROLE } from "../roles";
import { canvasMat } from "./tech";

/** The table's game sizes (m): its playfield inside the rails, the goals, the puck and the mallets. */
export const AIR_HOCKEY = {
  /** the playfield inside the rails, along X and across */
  length: 2.08,
  width: 1.04,
  /** the playfield's height above the floor */
  surfaceY: 0.785,
  /** the rails' height above the playfield */
  railH: 0.058,
  /** the rails' inside corners are rounded to this radius */
  cornerR: 0.06,
  /** the goal slot's width through each end rail */
  goalW: 0.3,
  puckR: 0.041,
  puckH: 0.007,
  malletR: 0.048,
  /** the colours of end 1 (red) and end 2 (blue) */
  colors: ["#e8312c", "#2f6fe4"] as const,
};

const SIDE_RAIL = 0.11;
const END_RAIL = 0.13;
const APRON = 0.27;

function mats(ctx: WorldCtx) {
  const add = (key: string, o: Parameters<typeof ctx.mats.pbr>[1]) => {
    if (!ctx.mats.has(key)) ctx.mats.pbr(key, o);
  };
  add("ahBody", { color: "#121418", rough: 0.28, clearCoat: 0.7 });
  if (!ctx.mats.has("neonCyan")) ctx.mats.unlit("neonCyan", { color: "#40e6ff", intensity: 1.8 });
  ctx.mats.glowing.add("neonCyan");
}

// ------------------------------------------------------------------ textures

/**
 * The playfield: white laminate perforated with air holes on a 25 mm grid, a
 * printed border, the red centre line and face-off circle, blue lines, a crease
 * round each goal and face-off spots. u runs along the table's length (X), v across.
 */
function playfieldMat(ctx: WorldCtx): string {
  const key = "ahPlayfield";
  if (ctx.mats.has(key)) return key;
  const { length: L, width: W, goalW } = AIR_HOCKEY;
  const PX = 2048;
  const PY = 1024;
  const sx = PX / L;
  const sy = PY / W;
  const { canvas, ctx: c } = makeCanvas(PX, PY);
  const g = c.createLinearGradient(0, 0, 0, PY);
  g.addColorStop(0, "#eef3f6");
  g.addColorStop(0.5, "#f7fafb");
  g.addColorStop(1, "#eef3f6");
  c.fillStyle = g;
  c.fillRect(0, 0, PX, PY);
  // faint ChimpVibe leaf at the centre, under the markings
  drawLeafEmblem(c, PX / 2, PY / 2 + 36, 190, "rgba(47,191,143,0.16)");
  c.save();
  c.font = "800 54px Nunito";
  c.textAlign = "center";
  c.fillStyle = "rgba(20,40,60,0.10)";
  c.fillText("CHIMPHOUSE", PX * 0.25, PY / 2 + 18);
  c.fillText("CHIMPHOUSE", PX * 0.75, PY / 2 + 18);
  c.restore();
  const line = (color: string, w: number, f: () => void) => {
    c.strokeStyle = color;
    c.lineWidth = w;
    c.beginPath();
    f();
    c.stroke();
  };
  const red = "#d8302a";
  const blue = "#2557c9";
  // border just inside the rails
  line(blue, 6, () => c.rect(14, 14, PX - 28, PY - 28));
  // centre line and face-off circle
  line(red, 12, () => {
    c.moveTo(PX / 2, 0);
    c.lineTo(PX / 2, PY);
  });
  line(red, 9, () => c.arc(PX / 2, PY / 2, 0.16 * sx, 0, Math.PI * 2));
  c.fillStyle = red;
  c.beginPath();
  c.arc(PX / 2, PY / 2, 0.025 * sx, 0, Math.PI * 2);
  c.fill();
  // blue lines a third of the way down each half
  for (const x of [L / 2 - 0.36, L / 2 + 0.36]) line(blue, 10, () => {
    c.moveTo(x * sx, 0);
    c.lineTo(x * sx, PY);
  });
  // goal creases and face-off spots in each half
  for (const end of [0, PX]) {
    line(red, 8, () => c.arc(end, PY / 2, 0.24 * sx, 0, Math.PI * 2));
    c.fillStyle = "rgba(37,87,201,0.12)";
    c.beginPath();
    c.arc(end, PY / 2, 0.24 * sx, 0, Math.PI * 2);
    c.fill();
    line(blue, 6, () => {
      c.moveTo(end, PY / 2 - (goalW / 2) * sy);
      c.lineTo(end + (end ? -1 : 1) * 0.03 * sx, PY / 2 - (goalW / 2) * sy);
      c.moveTo(end, PY / 2 + (goalW / 2) * sy);
      c.lineTo(end + (end ? -1 : 1) * 0.03 * sx, PY / 2 + (goalW / 2) * sy);
    });
    for (const v of [0.27, 0.73]) {
      const x = end + (end ? -1 : 1) * 0.5 * sx;
      line(red, 5, () => c.arc(x, v * PY, 0.07 * sx, 0, Math.PI * 2));
      c.fillStyle = red;
      c.beginPath();
      c.arc(x, v * PY, 0.012 * sx, 0, Math.PI * 2);
      c.fill();
    }
  }
  // the air holes: 25 mm apart, a dark core with a light rim
  const step = 0.025;
  for (let x = step / 2; x < L; x += step)
    for (let y = step / 2; y < W; y += step) {
      const px = x * sx;
      const py = y * sy;
      c.fillStyle = "rgba(255,255,255,0.7)";
      c.fillRect(px - 2, py - 1, 4, 4);
      c.fillStyle = "rgba(40,48,58,0.55)";
      c.fillRect(px - 2, py - 2, 4, 4);
      c.fillStyle = "rgba(10,14,20,0.8)";
      c.fillRect(px - 1, py - 1, 2, 2);
    }
  const tex = toTexture(ctx.scene, key, canvas, { wrap: false, aniso: 16 });
  const mat = ctx.mats.pbr(key, { tex, rough: 0.2, clearCoat: 0.45, emissive: "#ffffff", emissiveIntensity: 0.07 });
  mat.emissiveTexture = tex;
  return key;
}

/** Laminated side art for the cabinet: a dark panel with neon racing stripes and the table's name. */
function sideArt(ctx: WorldCtx, key: string, w: number, h: number, title: boolean): string {
  if (ctx.mats.has(key)) return key;
  const PX = title ? 2048 : 1024;
  const PY = Math.round((PX * h) / w);
  const { canvas, ctx: c } = makeCanvas(PX, PY);
  const g = c.createLinearGradient(0, 0, 0, PY);
  g.addColorStop(0, "#1b2140");
  g.addColorStop(1, "#0b0e1c");
  c.fillStyle = g;
  c.fillRect(0, 0, PX, PY);
  // speed stripes sweeping in from each end
  const stripe = (x0: number, dir: number, color: string, wd: number, off: number) => {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x0, PY * (0.62 + off));
    c.lineTo(x0 + dir * PX * 0.36, PY * (0.62 + off));
    c.lineTo(x0 + dir * (PX * 0.36 + PY * 0.2), PY * (0.62 + off) - wd);
    c.lineTo(x0, PY * (0.62 + off) - wd);
    c.fill();
  };
  for (const [x0, dir] of [
    [0, 1],
    [PX, -1],
  ]) {
    stripe(x0, dir, "#ff4fa3", PY * 0.07, 0);
    stripe(x0, dir, "#40e6ff", PY * 0.035, 0.12);
    stripe(x0, dir, "#f2c230", PY * 0.02, 0.2);
  }
  c.strokeStyle = "rgba(255,255,255,0.18)";
  c.lineWidth = 3;
  c.strokeRect(6, 6, PX - 12, PY - 12);
  for (const cx of title ? [0.3, 0.7] : []) {
    c.save();
    c.translate(PX * cx, PY * 0.6);
    c.transform(1, 0, -0.18, 1, 0, 0);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = `800 ${Math.round(PY * 0.42)}px Nunito`;
    c.shadowColor = "#40e6ff";
    c.shadowBlur = 24;
    c.lineWidth = 10;
    c.strokeStyle = "#0b0e1c";
    c.strokeText("AIR HOCKEY", 0, 0);
    const tg = c.createLinearGradient(0, -PY * 0.2, 0, PY * 0.2);
    tg.addColorStop(0, "#ffffff");
    tg.addColorStop(1, "#9ff3ff");
    c.fillStyle = tg;
    c.fillText("AIR HOCKEY", 0, 0);
    c.shadowBlur = 0;
    c.font = `700 ${Math.round(PY * 0.11)}px Montserrat`;
    c.fillStyle = "#f2c230";
    c.fillText("C H I M P H O U S E   A R C A D E", 0, -PY * 0.34);
    c.restore();
  }
  const tex = toTexture(ctx.scene, key, canvas, { wrap: false });
  ctx.mats.pbr(key, { tex, rough: 0.3, clearCoat: 0.6 });
  return key;
}

/** Segments lit for each digit, a-g. */
const SEGMENTS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];

/** One seven-segment digit, w x h with its top left at (x, y): unlit segments show faintly, as on a real LED display. */
function digit(c: CanvasRenderingContext2D, n: number | null, x: number, y: number, w: number, h: number, on: string, off: string) {
  const t = w * 0.2;
  const lit = n === null ? "" : SEGMENTS[n];
  const seg = (s: string, sx: number, sy: number, horizontal: boolean, len: number) => {
    c.fillStyle = lit.includes(s) ? on : off;
    c.shadowColor = on;
    c.shadowBlur = lit.includes(s) ? t * 0.9 : 0;
    c.beginPath();
    if (horizontal) {
      c.moveTo(sx, sy);
      c.lineTo(sx + t / 2, sy - t / 2);
      c.lineTo(sx + len - t / 2, sy - t / 2);
      c.lineTo(sx + len, sy);
      c.lineTo(sx + len - t / 2, sy + t / 2);
      c.lineTo(sx + t / 2, sy + t / 2);
    } else {
      c.moveTo(sx, sy);
      c.lineTo(sx + t / 2, sy + t / 2);
      c.lineTo(sx + t / 2, sy + len - t / 2);
      c.lineTo(sx, sy + len);
      c.lineTo(sx - t / 2, sy + len - t / 2);
      c.lineTo(sx - t / 2, sy + t / 2);
    }
    c.closePath();
    c.fill();
  };
  const g = t * 0.12;
  const hw = w - t;
  const hh = (h - t) / 2;
  // a slight forward lean, as LED digits have
  c.save();
  c.translate(x + t / 2, y + t / 2);
  c.transform(1, 0, -0.08, 1, hh * 0.16, 0);
  seg("a", g, 0, true, hw - 2 * g);
  seg("b", hw, g, false, hh - 2 * g);
  seg("c", hw, hh + g, false, hh - 2 * g);
  seg("d", g, 2 * hh, true, hw - 2 * g);
  seg("e", 0, hh + g, false, hh - 2 * g);
  seg("f", 0, g, false, hh - 2 * g);
  seg("g", g, hh, true, hw - 2 * g);
  c.restore();
  c.shadowBlur = 0;
}

/** One side of a scoreboard face: a team's label and its two-digit score. */
export interface ScoreSide {
  label: string;
  score: number;
  color: string;
}

/**
 * Paint a scoreboard face (an LED panel behind smoked glass): the left team's
 * score, a message in the middle, the right team's score. The canvas is 1024 x 272.
 */
export function paintScoreboard(canvas: HTMLCanvasElement, left: ScoreSide, right: ScoreSide, message: string): void {
  const c = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  c.fillStyle = "#050607";
  c.fillRect(0, 0, W, H);
  // the LED panel's fine grid
  c.fillStyle = "rgba(255,255,255,0.025)";
  for (let x = 0; x < W; x += 6) c.fillRect(x, 0, 1, H);
  const dim = (hex: string) => hex + "26";
  for (const [side, x0] of [
    [left, 40],
    [right, W - 40 - 330],
  ] as [ScoreSide, number][]) {
    c.font = "800 34px Nunito";
    c.textAlign = "center";
    c.fillStyle = side.color;
    c.fillText(side.label, x0 + 165, 44);
    const s = Math.max(0, Math.min(99, side.score));
    digit(c, s >= 10 ? Math.floor(s / 10) : null, x0, 64, 150, 190, side.color, dim(side.color));
    digit(c, s % 10, x0 + 175, 64, 150, 190, side.color, dim(side.color));
  }
  c.font = "700 30px Montserrat";
  c.fillStyle = "#f2c230";
  c.shadowColor = "#f2c230";
  c.shadowBlur = 10;
  c.textAlign = "center";
  const words = message.split("\n");
  words.forEach((w, i) => c.fillText(w, W / 2, H / 2 + 10 + (i - (words.length - 1) / 2) * 40));
  c.shadowBlur = 0;
  // smoked glass sheen
  const sheen = c.createLinearGradient(0, 0, 0, H);
  sheen.addColorStop(0, "rgba(255,255,255,0.07)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.0)");
  c.fillStyle = sheen;
  c.fillRect(0, 0, W, H);
}

export const SCOREBOARD_SIZE = { w: 1024, h: 272 };

/** The two sides of the scoreboard face towards end n: that end's team on the left. */
export function scoreSides(end: 1 | 2, red: number, blue: number): [ScoreSide, ScoreSide] {
  const r = { label: "RED", score: red, color: "#ff3b30" };
  const b = { label: "BLUE", score: blue, color: "#3d8bff" };
  return end === 1 ? [r, b] : [b, r];
}

// ------------------------------------------------------------------ geometry

/** Points round an arc (a0 to a1, radians) in the plan, centre (cx, cz). */
function arcPts(cx: number, cz: number, r: number, a0: number, a1: number, n = 8): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return out;
}

/**
 * The inner edge of the north rail (z > 0), from the west goal round to the east
 * goal; the south rail's is its mirror. Corners rounded to AIR_HOCKEY.cornerR.
 */
function railInner(px: number, pz: number, gh: number, r: number): P2[] {
  return [{ x: -px, z: gh }, ...arcPts(-px + r, pz - r, r, Math.PI, Math.PI / 2), ...arcPts(px - r, pz - r, r, Math.PI / 2, 0), { x: px, z: gh }];
}

/** The north rail's outline in the plan: its inner edge, then back round its outer edge. */
function railOutline(px: number, pz: number, ox: number, oz: number, gh: number, ri: number, ro: number): P2[] {
  return [...railInner(px, pz, gh, ri), { x: ox, z: gh }, ...arcPts(ox - ro, oz - ro, ro, 0, Math.PI / 2), ...arcPts(-ox + ro, oz - ro, ro, Math.PI / 2, Math.PI), { x: -ox, z: gh }];
}

const mirrorZ = (pts: P2[]) => pts.map((p) => ({ x: p.x, z: -p.z }));

/** Air hockey table, 2.34 m by 1.26 m, long axis along X, its ends the players'. Base at m. */
export function airHockey(ctx: WorldCtx, z: Zone, m: Matrix): void {
  mats(ctx);
  const { length, width, surfaceY: SY, railH, cornerR, goalW } = AIR_HOCKEY;
  const label = "Air hockey table";
  const px = length / 2;
  const pz = width / 2;
  const ox = px + END_RAIL;
  const oz = pz + SIDE_RAIL;
  const L = ox * 2;
  const W = oz * 2;
  const gh = goalW / 2;
  const RY = SY + railH;
  const at = (x: number, y: number, zz: number, yaw = 0) => xf(x, y, zz, yaw).multiply(m);

  // the playfield: a mesh of its own with a role, where the game is played (engine/airHockey.ts reads its bounds)
  ctx.screen(z, ROLE.airHockeySurface, xf(0, SY, 0, 0, 1, 1, 1, Math.PI / 2).multiply(m), length, width, playfieldMat(ctx), "Air hockey table: playfield");

  // rails: two C-shaped mouldings, north and south, meeting over the goal slots, with rubber bumpers inside
  const north = railOutline(px, pz, ox, oz, gh, cornerR, 0.1);
  const rails = new Geo();
  for (const outline of [north, mirrorZ(north)]) rails.add(slab(ensureCCW(outline), SY - 0.012, RY));
  ctx.g(z, "ahBody").add(rails, m, `${label}: rails`);
  const rubber = new Geo();
  for (const inner of [railInner(px - 0.004, pz - 0.004, gh, cornerR), mirrorZ(railInner(px - 0.004, pz - 0.004, gh, cornerR))]) {
    rubber.add(wallStrip(inner, SY, SY + 0.034, false));
    rubber.add(wallStrip([...inner].reverse(), SY, SY + 0.034, false));
  }
  ctx.g(z, "charcoal", { castShadow: false }).add(rubber, m, `${label}: rail bumpers`);
  // the goals: a notch through each end rail, the puck dropping into a dark pocket behind the playfield's edge
  const pocket = new Geo();
  for (const s of [-1, 1]) pocket.add(box(END_RAIL - 0.01, 0.1, goalW), xf(s * (px + (END_RAIL - 0.01) / 2), SY - 0.006 - 0.05, 0));
  ctx.g(z, "black", { castShadow: false }).add(pocket, m, `${label}: goal`);

  // the cabinet: a thick laminated apron under the rails, with art on every side and an LED strip under the rail lip
  const apronTop = SY - 0.012;
  const apronY = apronTop - APRON / 2;
  ctx.g(z, "ahBody").add(softBox(L - 0.02, APRON, W - 0.02, 0.02), at(0, apronY, 0), label);
  const longArt = sideArt(ctx, "ahSideArt", L - 0.16, APRON - 0.07, true);
  const endArt = sideArt(ctx, "ahEndArt", W - 0.14, APRON - 0.07, false);
  for (const s of [-1, 1]) {
    ctx.g(z, longArt, { castShadow: false }).add(plane(L - 0.16, APRON - 0.07), at(0, apronY, s * (W / 2 - 0.01 + 0.0012), s > 0 ? Math.PI : 0), label);
    ctx.g(z, endArt, { castShadow: false }).add(plane(W - 0.14, APRON - 0.07), at(s * (L / 2 - 0.01 + 0.0012), apronY, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2), label);
  }
  const led = new Geo();
  for (const s of [-1, 1]) {
    led.add(box(L - 0.06, 0.008, 0.008), xf(0, apronTop - 0.006, s * (W / 2 - 0.016)));
    led.add(box(0.008, 0.008, W - 0.06), xf(s * (L / 2 - 0.016), apronTop - 0.006, 0));
  }
  ctx.g(z, "neonCyan", { castShadow: false }).add(led, m, `${label}: rail lights`);
  // chrome trim round the apron's foot
  const trim = new Geo();
  const trimY = apronTop - APRON + 0.008;
  for (const s of [-1, 1]) {
    trim.add(box(L - 0.04, 0.016, 0.012), xf(0, trimY, s * (W / 2 - 0.012)));
    trim.add(box(0.012, 0.016, W - 0.04), xf(s * (L / 2 - 0.012), trimY, 0));
  }
  ctx.g(z, "chrome").add(trim, m, label);

  // puck returns under each goal: a dark mouth in the end panel in a chrome bezel, a tray lip below it
  const retIn = new Geo();
  const retFrame = new Geo();
  const retY = apronY + 0.005;
  for (const s of [-1, 1]) {
    const face = (d: number) => s * (L / 2 - 0.01 + d);
    retIn.add(box(0.004, 0.07, 0.2), xf(face(0.003), retY, 0));
    for (const t of [-1, 1]) {
      retFrame.add(box(0.012, 0.012, 0.224), xf(face(0.006), retY + t * 0.041, 0));
      retFrame.add(box(0.012, 0.094, 0.012), xf(face(0.006), retY, t * 0.106));
    }
    // the tray: a shelf the returned puck slides out onto, with a raised lip
    retFrame.add(box(0.06, 0.008, 0.2), xf(face(0.03), retY - 0.035, 0));
    retFrame.add(box(0.008, 0.022, 0.2), xf(face(0.058), retY - 0.027, 0));
  }
  ctx.g(z, "black", { castShadow: false }).add(retIn, m, `${label}: puck return`);
  ctx.g(z, "chrome").add(retFrame, m, `${label}: puck return`);

  // a coin door on the south side, by the west end: two lit coin slots
  {
    const dm = at(-0.9, apronY, -(W / 2 - 0.01) - 0.004);
    ctx.g(z, "steel").add(box(0.22, 0.19, 0.008), dm, `${label}: coin door`);
    const slots = new Geo();
    const lamps = new Geo();
    for (const t of [-1, 1]) {
      slots.add(box(0.05, 0.07, 0.006), xf(t * 0.052, 0.03, -0.005));
      lamps.add(box(0.006, 0.03, 0.004), xf(t * 0.052, 0.03, -0.0085));
      slots.add(box(0.03, 0.03, 0.006), xf(t * 0.052, -0.05, -0.005));
    }
    ctx.g(z, "black").add(slots, dm, `${label}: coin door`);
    ctx.g(z, "amberStrip", { castShadow: false }).add(lamps, dm, `${label}: coin door`);
  }

  // the base: an underside, a blower housing with vents, four heavy legs on levelling feet, stretchers
  const base = new Geo();
  const under = apronTop - APRON;
  base.add(box(L - 0.36, 0.04, W - 0.34), xf(0, under - 0.02, 0));
  base.add(softBox(0.72, 0.2, 0.46, 0.02), xf(0, under - 0.1, 0));
  const lx = L / 2 - 0.2;
  const lz = W / 2 - 0.17;
  const legTop = under;
  const legBot = 0.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) base.add(softBox(0.13, legTop - legBot, 0.13, 0.012), xf(sx * lx, (legTop + legBot) / 2, sz * lz));
  for (const sz of [-1, 1]) base.add(box(lx * 2 - 0.13, 0.07, 0.05), xf(0, 0.17, sz * lz));
  base.add(box(0.05, 0.07, lz * 2 - 0.13), xf(0, 0.17, 0));
  ctx.g(z, "ahBody").add(base, m, `${label}: base`);
  const vents = new Geo();
  for (const s of [-1, 1]) for (let i = 0; i < 7; i++) vents.add(box(0.5, 0.012, 0.006), xf(0, under - 0.17 + i * 0.022, s * 0.232));
  ctx.g(z, "steel").add(vents, m, `${label}: blower`);
  const feet = new Geo();
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      feet.add(cylinder(0.045, 0.014, 20), xf(sx * lx, 0.007, sz * lz));
      feet.add(cylinder(0.012, 0.04, 10), xf(sx * lx, 0.03, sz * lz));
    }
  ctx.g(z, "chrome").add(feet, m, `${label}: levelling feet`);

  // the overhead scoreboard on a chrome arch over the centre line, one LED face to each end
  const az = oz + 0.03;
  const topY = 1.64;
  const rr = 0.14;
  const archPath: Vector3[] = [new Vector3(0, apronY - 0.06, -az), new Vector3(0, topY - rr, -az)];
  for (let i = 1; i < 8; i++) {
    const a = Math.PI + (i / 8) * (Math.PI / 2);
    archPath.push(new Vector3(0, topY - rr - Math.sin(a) * rr, -az + rr + Math.cos(a) * rr));
  }
  archPath.push(new Vector3(0, topY, -az + rr), new Vector3(0, topY, az - rr));
  for (let i = 1; i < 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    archPath.push(new Vector3(0, topY - rr - Math.sin(a) * rr, az - rr + Math.cos(a) * rr));
  }
  archPath.push(new Vector3(0, topY - rr, az), new Vector3(0, apronY - 0.06, az));
  const arch = new Geo().add(tube(archPath, 0.022, 14, true));
  // brackets bolting the arch's feet to the cabinet, and hangers for the board
  for (const s of [-1, 1]) arch.add(cylinder(0.008, topY - 1.53, 8), xf(0, 1.53, s * 0.26));
  ctx.g(z, "chrome").add(arch, m, `${label}: scoreboard arch`);
  const brackets = new Geo();
  for (const s of [-1, 1]) for (const y of [apronY + 0.07, apronY - 0.05]) brackets.add(softBox(0.07, 0.035, 0.05, 0.008), xf(0, y, s * (az - 0.02)));
  ctx.g(z, "steel").add(brackets, m, `${label}: scoreboard arch`);
  const boardY = 1.42;
  ctx.g(z, "ahBody").add(softBox(0.12, 0.23, 0.74, 0.025), at(0, boardY, 0), `${label}: scoreboard`);
  const trimB = new Geo();
  for (const s of [-1, 1]) trimB.add(box(0.004, 0.006, 0.66), xf(s * 0.0605, boardY - 0.098, 0));
  ctx.g(z, "neonCyan", { castShadow: false }).add(trimB, m, `${label}: scoreboard`);
  for (const end of [1, 2] as const) {
    const s = end === 1 ? -1 : 1;
    const sm = at(s * 0.0612, boardY + 0.008, 0, s < 0 ? Math.PI / 2 : -Math.PI / 2);
    const mesh = ctx.screen(z, ROLE.airHockeyScore, sm, 0.64, 0.17, scoreboardMat(ctx, end), `${label}: scoreboard`);
    (mesh.metadata as MeshMeta).slot = end;
  }

  // the table itself, and its two ends: where the players stand
  ctx.slot(z, ROLE.airHockeyTable, 1, m, new Vector3(-(ox + 0.55), 0, 0), label);
  for (const end of [1, 2] as const) {
    const s = end === 1 ? -1 : 1;
    // the end's front (-Z) faces out from the table, towards its player
    ctx.slot(z, ROLE.airHockeyEnd, end, at(s * ox, 0, 0, s < 0 ? Math.PI / 2 : -Math.PI / 2), new Vector3(0, 0, -0.55), `${label}: ${end === 1 ? "red" : "blue"} end`);
  }
}

/** The scoreboard face towards end n at 0-0, until the game draws its own. */
function scoreboardMat(ctx: WorldCtx, end: 1 | 2): string {
  const { canvas } = makeCanvas(SCOREBOARD_SIZE.w, SCOREBOARD_SIZE.h);
  paintScoreboard(canvas, ...scoreSides(end, 0, 0), "FIRST\nTO 7");
  return canvasMat(ctx, `ahScore${end}`, canvas, 1.1);
}

// ------------------------------------------------------------------ the moving pieces

export interface AirHockeyPieces {
  /** mallet 1 (red, end 1) and mallet 2 (blue, end 2) */
  mallets: [TransformNode, TransformNode];
  puck: TransformNode;
  meshes: Mesh[];
}

/**
 * Build the mallets and the puck on the table's node (its role ROLE.airHockeyTable),
 * each a node of its own the engine moves across the playfield; their origins are
 * on the bottom, which sits on the playfield.
 */
export function buildAirHockeyPieces(mats: Materials, table: TransformNode): AirHockeyPieces {
  const scene = mats.scene;
  const sm = table.metadata as SlotMeta;
  const { malletR: R, puckR, puckH, colors } = AIR_HOCKEY;
  for (const [i, c] of colors.entries()) if (!mats.has(`ahMallet${i + 1}`)) mats.pbr(`ahMallet${i + 1}`, { color: c, rough: 0.32, clearCoat: 0.6 });
  if (!mats.has("ahFelt")) mats.pbr("ahFelt", { color: "#1d1e20", rough: 1 });
  if (!mats.has("ahPuck")) mats.pbr("ahPuck", { color: "#ffd21c", rough: 0.25, clearCoat: 0.8 });
  const meshes: Mesh[] = [];
  const make = (name: string, parts: [string, Geo][], role: string, slot?: number) => {
    const node = new TransformNode(name, scene);
    node.parent = table;
    for (const [mat, geo] of parts) {
      const mesh = geo.build(`${name}:${mat}`, scene);
      mesh.parent = node;
      mesh.material = mats.get(mat);
      mesh.metadata = { room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label: name }], matKey: mat, kind: "moving", role, slot } satisfies MeshMeta;
      mesh.receiveShadows = true;
      mesh.renderingGroupId = 1;
      mesh.isPickable = false;
      meshes.push(mesh);
    }
    return node;
  };
  // an arcade mallet: a wide base on a felt pad, a waisted neck and a round knob
  const body = lathe(
    [
      [0.001, 0.003],
      [R - 0.003, 0.003],
      [R, 0.006],
      [R, 0.017],
      [R - 0.005, 0.021],
      [0.03, 0.023],
      [0.019, 0.03],
      [0.015, 0.042],
      [0.015, 0.056],
      [0.021, 0.064],
      [0.024, 0.073],
      [0.021, 0.082],
      [0.012, 0.087],
      [0.001, 0.088],
    ],
    32,
  );
  const felt = cylinder(R - 0.004, 0.003, 32);
  const mallet = (n: 1 | 2) =>
    make(`Air hockey mallet ${n}`, [
      [`ahMallet${n}`, body],
      ["ahFelt", new Geo().add(felt, xf(0, 0.0015, 0))],
    ], ROLE.airHockeyMallet, n);
  const puckGeo = lathe(
    [
      [0.001, 0],
      [puckR - 0.0015, 0],
      [puckR, 0.0015],
      [puckR, puckH - 0.0015],
      [puckR - 0.0015, puckH],
      [0.001, puckH],
    ],
    36,
  );
  const puck = make("Air hockey puck", [["ahPuck", puckGeo]], ROLE.airHockeyPuck);
  return { mallets: [mallet(1), mallet(2)], puck, meshes };
}
