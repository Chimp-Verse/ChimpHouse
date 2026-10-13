// The pinball machines' printed art, painted on canvases: the playfield, the
// backglass, the cabinet's sides, the apron's cards and the lamp atlas (each
// insert lit and unlit). Each table has its own: JUNGLE QUEST's temple stone,
// vines and gold, BANANA BLITZ's party pink, purple and banana yellow.

import { makeCanvas } from "../materials/canvas";
import { Insert, PF, TableDef, V2 } from "./pinballTables";

type C2 = CanvasRenderingContext2D;

/** Playfield canvas pixels per metre. */
const PX = 1960;
export const FIELD_W = Math.round(PF.w * PX);
export const FIELD_H = Math.round(PF.l * PX);

/** A playfield point on its canvas. */
const fx = (x: number) => (x + PF.w / 2) * PX;
const fy = (y: number) => (PF.l - y) * PX;

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function path(c: C2, pts: V2[], close = false) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(fx(x), fy(y)) : c.moveTo(fx(x), fy(y))));
  if (close) c.closePath();
}

/** A leaf: a pointed ellipse with a midrib, at (x, y) in canvas pixels. */
function leaf(c: C2, x: number, y: number, len: number, rot: number, fill: string, rib: string) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(len * 0.5, -len * 0.32, len, 0);
  c.quadraticCurveTo(len * 0.5, len * 0.32, 0, 0);
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = rib;
  c.lineWidth = Math.max(1, len * 0.03);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(len * 0.95, 0);
  c.stroke();
  c.restore();
}

/** A banana: a curved crescent, at (x, y) in canvas pixels. */
function banana(c: C2, x: number, y: number, len: number, rot: number, fill = "#ffd23a", edge = "#8a5a00") {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.beginPath();
  c.moveTo(-len / 2, 0);
  c.quadraticCurveTo(0, len * 0.55, len / 2, 0);
  c.quadraticCurveTo(0, len * 0.25, -len / 2, 0);
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = edge;
  c.lineWidth = Math.max(1, len * 0.04);
  c.stroke();
  c.fillStyle = "#3b2a10";
  c.beginPath();
  c.arc(-len / 2, 0, len * 0.04, 0, Math.PI * 2);
  c.arc(len / 2, 0, len * 0.04, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function star(c: C2, x: number, y: number, r: number, points = 5, inner = 0.45) {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}

/** A cartoon chimp's face, `s` pixels across its head, grinning or determined. */
export function chimpFace(c: C2, x: number, y: number, s: number, o: { hat?: boolean; grin?: boolean } = {}) {
  const fur = "#5a3a22";
  const skin = "#e2b58c";
  c.save();
  c.translate(x, y);
  // ears
  for (const sx of [-1, 1]) {
    c.fillStyle = fur;
    c.beginPath();
    c.arc(sx * s * 0.48, s * 0.02, s * 0.16, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = skin;
    c.beginPath();
    c.arc(sx * s * 0.48, s * 0.02, s * 0.09, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = fur;
  c.beginPath();
  c.ellipse(0, 0, s * 0.44, s * 0.46, 0, 0, Math.PI * 2);
  c.fill();
  // the face: two lobes round the eyes and a muzzle
  c.fillStyle = skin;
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.ellipse(sx * s * 0.14, -s * 0.06, s * 0.17, s * 0.19, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.beginPath();
  c.ellipse(0, s * 0.17, s * 0.3, s * 0.21, 0, 0, Math.PI * 2);
  c.fill();
  // eyes
  for (const sx of [-1, 1]) {
    c.fillStyle = "#fff";
    c.beginPath();
    c.ellipse(sx * s * 0.13, -s * 0.07, s * 0.075, s * 0.09, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#1a1008";
    c.beginPath();
    c.arc(sx * s * 0.12 + s * 0.012, -s * 0.06, s * 0.045, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(sx * s * 0.12 + s * 0.025, -s * 0.075, s * 0.014, 0, Math.PI * 2);
    c.fill();
  }
  // brow
  c.strokeStyle = fur;
  c.lineWidth = s * 0.05;
  c.beginPath();
  c.moveTo(-s * 0.28, -s * 0.2);
  c.quadraticCurveTo(0, o.grin ? -s * 0.3 : -s * 0.2, s * 0.28, -s * 0.2);
  c.stroke();
  // nostrils and mouth
  c.fillStyle = "#4a2c18";
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.ellipse(sx * s * 0.045, s * 0.1, s * 0.022, s * 0.016, 0, 0, Math.PI * 2);
    c.fill();
  }
  if (o.grin) {
    c.fillStyle = "#3a1a10";
    c.beginPath();
    c.moveTo(-s * 0.2, s * 0.18);
    c.quadraticCurveTo(0, s * 0.42, s * 0.2, s * 0.18);
    c.closePath();
    c.fill();
    c.fillStyle = "#fff";
    c.fillRect(-s * 0.15, s * 0.18, s * 0.3, s * 0.05);
  } else {
    c.strokeStyle = "#3a1a10";
    c.lineWidth = s * 0.03;
    c.beginPath();
    c.moveTo(-s * 0.14, s * 0.24);
    c.quadraticCurveTo(0, s * 0.3, s * 0.14, s * 0.22);
    c.stroke();
  }
  if (o.hat) {
    // an explorer's pith helmet
    c.fillStyle = "#d8c08a";
    c.beginPath();
    c.ellipse(0, -s * 0.36, s * 0.58, s * 0.1, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(0, -s * 0.42, s * 0.38, s * 0.26, 0, Math.PI, 0);
    c.fill();
    c.fillStyle = "#7a5a2a";
    c.fillRect(-s * 0.38, -s * 0.44, s * 0.76, s * 0.06);
  }
  c.restore();
}

/** Big title lettering with a dark outline and a glow. */
function title(c: C2, text: string, x: number, y: number, px: number, fill: string | CanvasGradient, outline: string, glow: string, maxW: number) {
  c.save();
  c.textAlign = "center";
  c.textBaseline = "middle";
  let size = px;
  c.font = `900 ${size}px Nunito`;
  while (c.measureText(text).width > maxW && size > 20) c.font = `900 ${(size -= 4)}px Nunito`;
  c.lineJoin = "round";
  c.shadowColor = glow;
  c.shadowBlur = size * 0.4;
  c.strokeStyle = outline;
  c.lineWidth = size * 0.2;
  c.strokeText(text, x, y);
  c.shadowBlur = 0;
  c.fillStyle = fill;
  c.fillText(text, x, y);
  c.restore();
}

// ---------------------------------------------------------------- the playfield

/** The playfield's printed art: the table's background, lanes and shot names, and a chrome ring round each insert. */
export function playfieldCanvas(def: TableDef): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(FIELD_W, FIELD_H);
  const W = FIELD_W;
  const H = FIELD_H;
  const t = def.theme;
  const r = rand(def.slot * 97);
  const g = c.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, t.field[0]);
  g.addColorStop(0.55, t.field[1]);
  g.addColorStop(1, t.field[0]);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  if (def.id === "jungleQuest") {
    // a river winding across, then temple stonework behind the bumpers and lanes
    c.strokeStyle = "rgba(64,170,220,0.45)";
    c.lineWidth = 70;
    c.beginPath();
    c.moveTo(0, fy(0.62));
    c.bezierCurveTo(fx(-0.1), fy(0.5), fx(0.05), fy(0.72), W, fy(0.58));
    c.stroke();
    c.strokeStyle = "rgba(200,240,255,0.25)";
    c.lineWidth = 6;
    for (let k = -1; k <= 1; k++) {
      c.beginPath();
      c.moveTo(0, fy(0.62) + k * 22);
      c.bezierCurveTo(fx(-0.1), fy(0.5) + k * 22, fx(0.05), fy(0.72) + k * 22, W, fy(0.58) + k * 22);
      c.stroke();
    }
    c.save();
    c.beginPath();
    c.arc(fx(0), fy(PF.archY), PF.archR * PX, Math.PI, 0);
    c.lineTo(fx(0.26), fy(0.68));
    c.lineTo(fx(-0.26), fy(0.68));
    c.clip();
    const sw = 64;
    const sh = 34;
    for (let row = 0; row < 40; row++)
      for (let col = -1; col < W / sw + 1; col++) {
        const x = col * sw + (row % 2 ? sw / 2 : 0);
        const y = fy(0.68) - (row + 1) * sh;
        const v = 120 + r() * 50;
        c.fillStyle = `rgb(${v * 0.82},${v * 0.78},${v * 0.62})`;
        c.fillRect(x + 2, y + 2, sw - 4, sh - 4);
        c.fillStyle = "rgba(40,60,30,0.25)";
        if (r() < 0.3) c.fillRect(x + 2, y + sh - 10, sw - 4, 8);
      }
    // a carved sun over the lanes
    c.fillStyle = "rgba(255,207,58,0.35)";
    star(c, fx(-0.022), fy(1.0), 70, 12, 0.7);
    c.fill();
    c.restore();
    for (let i = 0; i < 46; i++) {
      const x = r() * W;
      const y = H * (0.2 + r() * 0.5);
      leaf(c, x, y, 60 + r() * 110, r() * Math.PI * 2, `rgba(${30 + r() * 40},${110 + r() * 80},${50 + r() * 40},0.45)`, "rgba(10,40,20,0.5)");
    }
    // vines down the sides
    c.strokeStyle = "rgba(30,90,40,0.8)";
    c.lineWidth = 9;
    for (const x0 of [fx(-0.245), fx(0.2)]) {
      c.beginPath();
      for (let y = fy(0.95); y < fy(0.42); y += 20) c.lineTo(x0 + Math.sin(y * 0.02) * 16, y);
      c.stroke();
      for (let y = fy(0.92); y < fy(0.45); y += 70) leaf(c, x0, y, 50, Math.sin(y) > 0 ? 0.6 : 2.5, "rgba(60,170,80,0.85)", "rgba(10,50,20,0.8)");
    }
  } else {
    // a sunburst from the monkey mouth, polka dots and flying bananas
    const ox = fx(0.03);
    const oy = fy(0.75);
    for (let i = 0; i < 28; i++) {
      const a0 = (i / 28) * Math.PI * 2;
      c.fillStyle = i % 2 ? "rgba(255,80,170,0.32)" : "rgba(120,40,190,0.25)";
      c.beginPath();
      c.moveTo(ox, oy);
      c.arc(ox, oy, H, a0, a0 + Math.PI / 28);
      c.closePath();
      c.fill();
    }
    for (let i = 0; i < 160; i++) {
      c.fillStyle = r() < 0.5 ? "rgba(255,210,58,0.22)" : "rgba(56,232,255,0.18)";
      c.beginPath();
      c.arc(r() * W, r() * H * 0.85, 6 + r() * 12, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 22; i++) banana(c, r() * W, H * (0.15 + r() * 0.6), 70 + r() * 60, r() * Math.PI * 2, "rgba(255,214,60,0.75)", "rgba(120,70,0,0.8)");
    // checkerboard down the outer lanes
    for (const [x0, x1] of [
      [-0.26, -0.221],
      [0.177, 0.216],
    ]) {
      const n = Math.floor(((x1 - x0) * PX) / 18);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < 30; j++) {
          if ((i + j) % 2) continue;
          c.fillStyle = "rgba(255,255,255,0.12)";
          c.fillRect(fx(x0) + i * 18, fy(0.4) + j * 18, 18, 18);
        }
    }
    // a glittering pit behind the bumpers
    c.save();
    c.beginPath();
    c.arc(fx(-0.095), fy(0.88), 0.12 * PX, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = "rgba(20,0,40,0.55)";
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) {
      c.fillStyle = `rgba(255,${180 + r() * 75},${80 + r() * 100},${0.4 + r() * 0.5})`;
      star(c, fx(-0.095) + (r() - 0.5) * 480, fy(0.88) + (r() - 0.5) * 480, 4 + r() * 8, 4, 0.35);
      c.fill();
    }
    c.restore();
  }
  // outside the arch is the cabinet's wood
  c.beginPath();
  c.moveTo(W, fy(PF.archY));
  c.lineTo(W, 0);
  c.lineTo(0, 0);
  c.lineTo(0, fy(PF.archY));
  c.arc(fx(0), fy(PF.archY), PF.archR * PX, Math.PI, 0, false);
  c.closePath();
  c.fillStyle = "#1b120c";
  c.fill();
  // the shooter lane: plain, with the lane stripes
  c.fillStyle = def.id === "jungleQuest" ? "#0e2a20" : "#2a0b3f";
  c.fillRect(fx(PF.shooterWall), fy(PF.shooterTop), fx(0.26) - fx(PF.shooterWall), H);
  c.fillStyle = t.accent;
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    const y = fy(0.2 + i * 0.09);
    c.moveTo(fx(PF.shooterX) - 18, y + 16);
    c.lineTo(fx(PF.shooterX), y - 6);
    c.lineTo(fx(PF.shooterX) + 18, y + 16);
    c.lineTo(fx(PF.shooterX) + 18, y + 26);
    c.lineTo(fx(PF.shooterX), y + 4);
    c.lineTo(fx(PF.shooterX) - 18, y + 26);
    c.fill();
  }
  // the lanes' outlines: inlanes and outlanes, painted lines
  c.strokeStyle = "rgba(255,255,255,0.55)";
  c.lineWidth = 4;
  for (const s of [1, -1]) {
    const X = (x: number) => (s > 0 ? x : 2 * PF.cx - x);
    path(c, [
      [X(-0.193), 0.39],
      [X(-0.193), 0.31],
      [X(-0.135), 0.235],
    ]);
    c.stroke();
    path(c, [
      [X(-0.2405), 0.39],
      [X(-0.2405), 0.14],
    ]);
    c.stroke();
  }
  // a chrome ring round each insert, and its label
  for (const ins of def.inserts) if (!ins.h) insertRing(c, ins);
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (const ins of def.inserts) {
    if (!ins.label) continue;
    const [dx, dy] = ins.labelAt ?? [0, -0.02];
    const onTop = dx === 0 && dy === 0;
    c.font = `800 ${onTop ? Math.round(ins.size * PX * 0.62) : 22}px Nunito`;
    c.fillStyle = onTop ? "rgba(20,10,0,0.85)" : "#fff";
    c.save();
    c.translate(fx(ins.at[0] + dx), fy(ins.at[1] + dy));
    if (!onTop) {
      c.shadowColor = "rgba(0,0,0,0.9)";
      c.shadowBlur = 6;
    }
    c.fillText(ins.label, 0, onTop ? 2 : 0);
    c.restore();
  }
  for (const p of def.prints) {
    c.save();
    c.translate(fx(p.at[0]), fy(p.at[1]));
    c.rotate(-(p.rot ?? 0));
    c.font = `900 ${Math.round(p.size * PX)}px Nunito`;
    c.fillStyle = p.color ?? "#fff";
    c.shadowColor = "rgba(0,0,0,0.9)";
    c.shadowBlur = 8;
    c.fillText(p.text, 0, 0);
    c.restore();
  }
  // the title under the flippers, half hidden by the apron
  title(c, def.title, fx(PF.cx), fy(0.255), 56, t.accent, "#120a04", "rgba(0,0,0,0.6)", 360);
  return canvas;
}

/** Dark recess and chrome ring under an insert (the lamp mesh lays the plastic over it). */
function insertRing(c: C2, ins: Insert) {
  const s = ins.size * PX;
  c.save();
  c.translate(fx(ins.at[0]), fy(ins.at[1]));
  c.rotate(-(ins.rot ?? 0));
  c.fillStyle = "rgba(0,0,0,0.6)";
  c.strokeStyle = "rgba(230,230,230,0.8)";
  c.lineWidth = 3;
  shapePath(c, ins.shape, s * 1.12);
  c.fill();
  c.stroke();
  c.restore();
}

/** An insert's outline, `s` across, centred on the origin, pointing up (-y on the canvas). */
function shapePath(c: C2, shape: Insert["shape"], s: number) {
  const h = s / 2;
  c.beginPath();
  if (shape === "circle") c.arc(0, 0, h, 0, Math.PI * 2);
  else if (shape === "oval") c.ellipse(0, 0, h, h * 0.62, 0, 0, Math.PI * 2);
  else if (shape === "rect") c.rect(-h * 0.7, -h, h * 1.4, s);
  else if (shape === "tri") {
    c.moveTo(0, -h);
    c.lineTo(h, h * 0.75);
    c.lineTo(-h, h * 0.75);
    c.closePath();
  } else if (shape === "arrow") {
    c.moveTo(0, -h * 1.3);
    c.lineTo(h * 0.75, -h * 0.2);
    c.lineTo(h * 0.32, -h * 0.2);
    c.lineTo(h * 0.32, h * 1.1);
    c.lineTo(-h * 0.32, h * 1.1);
    c.lineTo(-h * 0.32, -h * 0.2);
    c.lineTo(-h * 0.75, -h * 0.2);
    c.closePath();
  } else if (shape === "star") {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? h * 0.45 : h;
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
  }
}

// ---------------------------------------------------------------- the lamps

/** Each lamp's cell in the atlas: lit cells in the top half, unlit in the bottom. */
export const LAMP_CELL = 64;
export const LAMP_COLS = 16;

/**
 * The lamp atlas: a cell per insert (its shape and colour, as plastic), lit
 * in the top half and unlit in the bottom, and one per bumper cap. The lamp
 * mesh swaps a lamp's UVs between the halves (props/pinball.ts).
 */
export function lampAtlas(def: TableDef): { canvas: HTMLCanvasElement; rows: number } {
  const n = def.inserts.length + def.bumpers.length;
  const rows = Math.ceil(n / LAMP_COLS);
  const { canvas, ctx: c } = makeCanvas(LAMP_COLS * LAMP_CELL, rows * 2 * LAMP_CELL);
  c.clearRect(0, 0, canvas.width, canvas.height);
  const cell = (i: number, lit: boolean) => [(i % LAMP_COLS) * LAMP_CELL + LAMP_CELL / 2, (Math.floor(i / LAMP_COLS) + (lit ? 0 : rows)) * LAMP_CELL + LAMP_CELL / 2];
  def.inserts.forEach((ins, i) => {
    // a lamp on a plastic (a slingshot's) is clear when unlit
    for (const lit of ins.h ? [true] : [true, false]) {
      const [x, y] = cell(i, lit);
      c.save();
      c.translate(x, y);
      // the insert's shape fills the cell's width (the quad is sized by the insert)
      const s = LAMP_CELL * 0.86 * (ins.shape === "arrow" ? 0.72 : 1);
      shapePath(c, ins.shape, s);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.7);
      if (lit) {
        g.addColorStop(0, tint(ins.color, 0.55));
        g.addColorStop(0.45, ins.color);
        g.addColorStop(1, shade(ins.color, 0.85));
      } else {
        g.addColorStop(0, shade(ins.color, 0.4));
        g.addColorStop(1, shade(ins.color, 0.24));
      }
      c.fillStyle = g;
      c.fill();
      c.restore();
    }
  });
  def.bumpers.forEach((_, k) => {
    const i = def.inserts.length + k;
    for (const lit of [true, false]) {
      const [x, y] = cell(i, lit);
      const g = c.createRadialGradient(x, y, 0, x, y, LAMP_CELL / 2);
      const col = def.id === "jungleQuest" ? (k === 1 ? "#ff8a1e" : "#ffcf3a") : k ? "#38e8ff" : "#ff4fb0";
      g.addColorStop(0, lit ? tint(col, 0.6) : shade(col, 0.45));
      g.addColorStop(0.45, lit ? col : shade(col, 0.32));
      g.addColorStop(1, lit ? col : shade(col, 0.22));
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, LAMP_CELL / 2 - 1, 0, Math.PI * 2);
      c.fill();
      // the cap's print: a star for the jungle, a banana for the party
      c.save();
      c.translate(x, y);
      if (def.id === "jungleQuest") {
        c.fillStyle = lit ? "rgba(90,50,0,0.7)" : "rgba(0,0,0,0.5)";
        star(c, 0, 0, LAMP_CELL * 0.3, 5, 0.45);
        c.fill();
      } else banana(c, 0, -4, LAMP_CELL * 0.6, 0.2, lit ? "#fff27a" : "#7a6a20", "#3a2a00");
      c.restore();
    }
  });
  return { canvas, rows };
}

/** A colour mixed toward white by k. */
function tint(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((v >> s) & 255) * (1 - k) + 255 * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((v >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// ---------------------------------------------------------------- the backglass, sides and apron

export function backglassCanvas(def: TableDef): HTMLCanvasElement {
  const W = 1024;
  const H = 744;
  const { canvas, ctx: c } = makeCanvas(W, H);
  const t = def.theme;
  const r = rand(def.slot * 31);
  if (def.id === "jungleQuest") {
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#1b0b3a");
    sky.addColorStop(0.45, "#c2471d");
    sky.addColorStop(0.75, "#ffb347");
    sky.addColorStop(1, "#ffe08a");
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    // the sun behind a stepped temple
    c.fillStyle = "rgba(255,240,180,0.9)";
    c.beginPath();
    c.arc(W / 2, H * 0.6, 150, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 6; i++) {
      const w = 560 - i * 80;
      const y = H * 0.92 - i * 52;
      c.fillStyle = i % 2 ? "#5a4a35" : "#4a3c2a";
      c.fillRect(W / 2 - w / 2, y - 52, w, 54);
      c.fillStyle = "rgba(0,0,0,0.25)";
      for (let k = 0; k < w; k += 48) c.fillRect(W / 2 - w / 2 + k, y - 52, 3, 54);
    }
    c.fillStyle = "#2a2018";
    c.fillRect(W / 2 - 40, H * 0.92 - 340, 80, 90);
    c.fillStyle = "#ffcf3a";
    star(c, W / 2, H * 0.92 - 296, 26, 5, 0.45);
    c.fill();
    // jungle silhouettes either side
    for (const side of [-1, 1]) {
      for (let i = 0; i < 26; i++) {
        const x = W / 2 + side * (300 + r() * 260);
        const y = H * (0.3 + r() * 0.7);
        leaf(c, x, y, 120 + r() * 140, side > 0 ? Math.PI + (r() - 0.5) * 1.6 : (r() - 0.5) * 1.6, `rgba(${10 + r() * 20},${40 + r() * 40},${20 + r() * 20},0.95)`, "rgba(0,0,0,0.6)");
      }
    }
    // vines hanging from the top
    c.strokeStyle = "#1c4a22";
    c.lineWidth = 10;
    for (let i = 0; i < 7; i++) {
      const x = 60 + i * 150;
      c.beginPath();
      c.moveTo(x, 0);
      c.quadraticCurveTo(x + 40, 120, x - 10, 200 + r() * 80);
      c.stroke();
    }
    // the explorer chimp, front and centre
    chimpFace(c, W * 0.5, H * 0.66, 230, { hat: true });
    title(c, "JUNGLE", W / 2, 96, 120, gold(c, 40, 150), "#2a1405", "rgba(255,200,80,0.9)", W - 140);
    title(c, "QUEST", W / 2, 208, 120, gold(c, 150, 260), "#2a1405", "rgba(255,200,80,0.9)", W - 140);
  } else {
    const bg = c.createRadialGradient(W / 2, H * 0.6, 40, W / 2, H * 0.6, W * 0.8);
    bg.addColorStop(0, "#ff7ac3");
    bg.addColorStop(0.5, "#c2186f");
    bg.addColorStop(1, "#2a0840");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 36; i++) {
      const a0 = (i / 36) * Math.PI * 2;
      c.fillStyle = i % 2 ? "rgba(255,210,58,0.25)" : "rgba(255,255,255,0.06)";
      c.beginPath();
      c.moveTo(W / 2, H * 0.62);
      c.arc(W / 2, H * 0.62, W, a0, a0 + Math.PI / 36);
      c.closePath();
      c.fill();
    }
    // a disco ball and confetti
    c.fillStyle = "#cfd6e6";
    c.beginPath();
    c.arc(W / 2, 40, 46, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 90; i++) {
      c.fillStyle = ["#ffd23a", "#38e8ff", "#ffffff", "#7b2fb8"][i % 4];
      c.save();
      c.translate(r() * W, r() * H);
      c.rotate(r() * 6);
      c.fillRect(-6, -3, 12, 6);
      c.restore();
    }
    for (let i = 0; i < 14; i++) banana(c, 80 + r() * (W - 160), 300 + r() * 400, 90 + r() * 80, r() * 6);
    // the party chimp, grinning, with a banana in each hand
    banana(c, W * 0.27, H * 0.7, 150, -0.9);
    banana(c, W * 0.73, H * 0.7, 150, 0.9 + Math.PI);
    chimpFace(c, W * 0.5, H * 0.66, 240, { grin: true });
    // sunglasses
    c.fillStyle = "#111";
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.ellipse(W * 0.5 + sx * 32, H * 0.66 - 16, 30, 22, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillRect(W * 0.5 - 10, H * 0.66 - 22, 20, 6);
    const yel = c.createLinearGradient(0, 60, 0, 270);
    yel.addColorStop(0, "#fff7a0");
    yel.addColorStop(1, "#ffb800");
    title(c, "BANANA", W / 2, 120, 140, yel, "#5a0a4a", "rgba(255,80,200,1)", W - 120);
    title(c, "BLITZ!", W / 2, 245, 120, "#38e8ff", "#24063a", "rgba(56,232,255,1)", W - 220);
  }
  // a frame round the glass
  c.strokeStyle = t.trim;
  c.lineWidth = 12;
  c.strokeRect(6, 6, W - 12, H - 12);
  return canvas;
}

function gold(c: C2, y0: number, y1: number) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "#fff3b0");
  g.addColorStop(0.5, "#ffcf3a");
  g.addColorStop(1, "#b07a10");
  return g;
}

/** A cabinet side's art (the left side; the right is the same, mirrored by its UVs). */
export function sideCanvas(def: TableDef): HTMLCanvasElement {
  const W = 1024;
  const H = 264;
  const { canvas, ctx: c } = makeCanvas(W, H);
  const t = def.theme;
  const r = rand(def.slot * 13);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, t.body);
  g.addColorStop(1, t.body2);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  if (def.id === "jungleQuest") {
    for (let i = 0; i < 40; i++) leaf(c, r() * W, H * (0.3 + r() * 0.8), 60 + r() * 90, -Math.PI / 2 + (r() - 0.5) * 1.8, `rgba(${30 + r() * 40},${120 + r() * 60},${60 + r() * 30},0.55)`, "rgba(0,0,0,0.4)");
    c.strokeStyle = t.trim;
    c.lineWidth = 5;
    c.beginPath();
    for (let x = 0; x <= W; x += 8) c.lineTo(x, 26 + Math.sin(x * 0.03) * 8);
    c.stroke();
    title(c, def.title, W * 0.62, H * 0.5, 96, gold(c, H * 0.3, H * 0.7), "#120a04", "rgba(255,200,80,0.6)", W * 0.6);
    chimpFace(c, W * 0.16, H * 0.55, 150, { hat: true });
  } else {
    c.fillStyle = t.trim;
    for (let i = -4; i < 24; i++) {
      c.beginPath();
      c.moveTo(i * 60, H);
      c.lineTo(i * 60 + 26, H);
      c.lineTo(i * 60 + 26 + H * 0.7, 0);
      c.lineTo(i * 60 + H * 0.7, 0);
      c.fill();
    }
    c.fillStyle = "rgba(74,20,102,0.55)";
    c.fillRect(0, H * 0.22, W, H * 0.56);
    for (let i = 0; i < 10; i++) banana(c, 80 + i * 100, H * 0.84, 60, i % 2 ? 0.3 : -0.3);
    title(c, def.title, W * 0.6, H * 0.5, 96, "#fff27a", "#5a0a4a", "rgba(255,80,200,0.9)", W * 0.62);
    chimpFace(c, W * 0.15, H * 0.5, 150, { grin: true });
  }
  return canvas;
}

/** The apron: the table's colour, its name, and the two instruction cards. */
export function apronCanvas(def: TableDef, cards: [string[], string[]]): HTMLCanvasElement {
  const W = 1024;
  const H = 260;
  const { canvas, ctx: c } = makeCanvas(W, H);
  const t = def.theme;
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, t.body);
  g.addColorStop(1, t.body2);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.strokeStyle = t.trim;
  c.lineWidth = 8;
  c.strokeRect(4, 4, W - 8, H - 8);
  // the drain: dark between the flippers
  c.fillStyle = "#050505";
  c.beginPath();
  c.ellipse(W * ((PF.cx + 0.26) / (PF.shooterWall + 0.26)), 0, 120, 60, 0, 0, Math.PI);
  c.fill();
  cards.forEach((lines, i) => {
    const x = i ? W - 310 : 30;
    c.fillStyle = "#f6f1e3";
    c.fillRect(x, 70, 280, 170);
    c.fillStyle = "#1a1a1a";
    c.textAlign = "left";
    c.font = "800 22px Nunito";
    lines.forEach((line, k) => {
      if (k === 0) c.font = "900 24px Nunito";
      else c.font = "700 17px Nunito";
      c.fillText(line, x + 12, 98 + k * 23);
    });
  });
  c.textAlign = "center";
  title(c, def.title, W / 2, 190, 44, t.accent, "#000", "rgba(0,0,0,0.5)", 330);
  return canvas;
}
