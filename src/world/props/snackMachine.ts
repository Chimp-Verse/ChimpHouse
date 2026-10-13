// The Game Room's snack machine, CHIMP CHOMP: a glass-front spiral machine
// made for ChimpHouse. Jungle-timber sides with painted leaves, a deep teal
// front with brass trim, a lit header, a keypad and pay panel, and a plush
// chimp sitting on top with a bag of banana chips.
//
// The cabinet is static and merged into the room like the rest of the house.
// What moves is found by role (world/roles.ts) and built or driven at run time
// (engine/snackMachine.ts): each coil is a slot (role "snack-coil", numbered
// row * 10 + lane, so A1 is 11 and E6 is 56) where its spiral and its snacks are
// built, the keys are slots of their own, the display is a screen, the bin a
// slot, and the PUSH flap a mesh of its own that swings open.
//
// The machine is built in a local frame with its base at m and its front (where
// the visitor stands) toward -Z.

import { Color3, Matrix, Mesh, PBRMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { rng } from "../geometry/curves";
import { Geo, box, cylinder, plane, softBox, sphere, torus, tube, xf } from "../geometry/geo";
import { MeshMeta, SlotMeta, WorldCtx, Zone } from "../context";
import { Ctx, makeCanvas, toTexture } from "../materials/canvas";
import { Leaf } from "../materials/leaves";
import { Materials } from "../materials/library";
import { drawLeafEmblem } from "../materials/textures";
import { ROLE } from "../roles";
import { leafMatrix, vine } from "./plants";
import { canvasMat } from "./tech";

// ------------------------------------------------------------------ layout

/** The machine's size and where its parts are, in its local frame (m; base at 0, front at -Z). */
export const SNACK = {
  W: 0.96,
  H: 1.84,
  D: 0.8,
  /** the window onto the coils */
  win: { x0: -0.41, x1: 0.19, y0: 0.66, y1: 1.58 },
  /** where the front plate's face is, and the glass just behind it */
  front: -0.4,
  glassZ: -0.386,
  /** the coils' front ends (the drop gap is between them and the glass) and their length */
  coilZ: -0.228,
  coilLen: 0.48,
  /** a coil's radius and the length of one turn: a snack sits in each turn */
  coilR: 0.04,
  pitch: 0.08,
  /** the trays' top surfaces, row A (top) to E */
  trays: [1.412, 1.228, 1.044, 0.86, 0.676],
  /** lanes per row */
  lanes: [5, 5, 5, 6, 6],
  /** the pickup bin behind the PUSH flap: its opening, and the floor a dropped snack lands on */
  bin: { x0: -0.37, x1: 0.15, y0: 0.17, y1: 0.42, floor: 0.19, z: -0.27 },
  /**
   * The shaft a snack falls down, in front of the trays below its own: the front panel's back
   * (the glass is just in front of it), and the bin's chute, sloping from the back of its floor
   * up to the trays' fronts at `top`.
   */
  shaft: { front: -0.37, binBack: -0.15, top: 0.45 },
} as const;

export const ROWS = ["A", "B", "C", "D", "E"] as const;
/** Snacks per coil: one per turn. */
export const COIL_CAPACITY = Math.round(SNACK.coilLen / SNACK.pitch);

/** The keypad's keys, in reading order: the letters choose a row, the numbers a lane. */
export const SNACK_KEYS = ["A", "B", "C", "D", "E", "CLR", "1", "2", "3", "4", "5", "6"] as const;
export type SnackKey = (typeof SNACK_KEYS)[number];

/** A coil's slot number from its code ("B3" is 23), and back. */
export const coilSlot = (code: string) => (ROWS.indexOf(code[0] as (typeof ROWS)[number]) + 1) * 10 + Number(code.slice(1));
export const coilCode = (slot: number) => `${ROWS[Math.floor(slot / 10) - 1]}${slot % 10}`;

/** A lane's centre across the window. */
export function laneX(row: number, lane: number): number {
  const { x0, x1 } = SNACK.win;
  const n = SNACK.lanes[row];
  return x0 + ((x1 - x0) * (lane - 0.5)) / n;
}

// ------------------------------------------------------------------ the snacks

export type PackKind = "bag" | "bar" | "box";

/** A ChimpHouse snack brand: its name, its pack and how it's printed. */
export interface SnackBrand {
  id: string;
  name: string;
  /** what's in it, printed under the name */
  flavour: string;
  kind: PackKind;
  /** the pack's colours: background top and bottom, the name, an accent */
  bg: [string, string];
  ink: string;
  accent: string;
  /** what's drawn on the front */
  art: "bananaChips" | "puffs" | "twigs" | "mango" | "vines" | "popcorn" | "chocolate" | "caramel" | "nuts" | "cookies" | "kettle";
}

export const SNACK_BRANDS: SnackBrand[] = [
  { id: "jungleCrunch", name: "JUNGLE\nCRUNCH", flavour: "Banana chips", kind: "bag", bg: ["#ffd23f", "#f0a81c"], ink: "#2b5d1e", accent: "#2fa05a", art: "bananaChips" },
  { id: "canopyPuffs", name: "CANOPY\nPUFFS", flavour: "Cheesy corn puffs", kind: "bag", bg: ["#ff8a2a", "#e3501b"], ink: "#fff6df", accent: "#6ff0bf", art: "puffs" },
  { id: "termiteTwigs", name: "TERMITE\nTWIGS", flavour: "Choc pretzel sticks", kind: "bag", bg: ["#7a4a2c", "#4a2a18"], ink: "#ffd9e6", accent: "#ff6fa8", art: "twigs" },
  { id: "mangoMischief", name: "MANGO\nMISCHIEF", flavour: "Chewy dried mango", kind: "bag", bg: ["#ff5fa2", "#d93a7a"], ink: "#fff3c4", accent: "#ffb21f", art: "mango" },
  { id: "silverback", name: "SILVER\nBACK", flavour: "Sea salt kettle chips", kind: "bag", bg: ["#c9d3dc", "#8d9aa8"], ink: "#16304f", accent: "#2a5bd7", art: "kettle" },
  { id: "vineSwingers", name: "VINE\nSWINGERS", flavour: "Sour gummy vines", kind: "bag", bg: ["#5fd068", "#2c9b4a"], ink: "#ffffff", accent: "#ff4fa3", art: "vines" },
  { id: "knucklePops", name: "KNUCKLE\nPOPS", flavour: "Butter popcorn", kind: "bag", bg: ["#e8382f", "#b8201c"], ink: "#fff8e8", accent: "#ffd23f", art: "popcorn" },
  { id: "bonoboBar", name: "BONOBO", flavour: "Milk chocolate", kind: "bar", bg: ["#6b3fa0", "#43206e"], ink: "#ffd96b", accent: "#ffd96b", art: "chocolate" },
  { id: "apeEscape", name: "APE\nESCAPE", flavour: "Caramel & peanut", kind: "bar", bg: ["#1f8f8a", "#105c58"], ink: "#ffcf5a", accent: "#ff8a3d", art: "caramel" },
  { id: "nutCracker", name: "NUT\nCRACKER", flavour: "Jungle trail mix", kind: "box", bg: ["#f3e3c0", "#d9bf8c"], ink: "#5a3418", accent: "#c4552e", art: "nuts" },
  { id: "chocoChimps", name: "CHOCO\nCHIMPS", flavour: "Cookies with choc chips", kind: "box", bg: ["#3d2416", "#24140b"], ink: "#ffe9c9", accent: "#6ff0bf", art: "cookies" },
];

/** A pack's size (m): width across the coil, height, and thickness front to back. */
export const PACK_SIZE: Record<PackKind, { w: number; h: number; d: number }> = {
  bag: { w: 0.104, h: 0.152, d: 0.05 },
  bar: { w: 0.07, h: 0.138, d: 0.024 },
  box: { w: 0.078, h: 0.126, d: 0.042 },
};

const brandById = new Map(SNACK_BRANDS.map((b) => [b.id, b]));
export const snackBrand = (id: string) => brandById.get(id)!;

/**
 * A brand's pack material: its art on the front, its back printed, glossy like a foil bag or a
 * wrapper. In the machine (`lit`) its art also glows a little, as the cabinet's tubes light it:
 * the engine turns that up at night (no lamp of its own, which the room's light budget hasn't room for).
 */
export function packMat(mats: Materials, brand: SnackBrand, lit = true): string {
  const key = `snackPack:${brand.id}${lit ? "" : ":out"}`;
  if (!mats.has(key)) {
    const tex = toTexture(mats.scene, key, packCanvas(brand), { wrap: false });
    const m = mats.pbr(key, { tex, rough: brand.kind === "box" ? 0.55 : 0.32, metal: brand.kind === "bag" ? 0.25 : 0.05, clearCoat: brand.kind === "box" ? 0 : 0.5 });
    if (lit) {
      m.emissiveTexture = tex;
      m.emissiveColor = Color3.Black();
    }
  }
  return key;
}

/**
 * A pack's shape, centred on its origin, front toward -Z, its front art on the
 * left half of its texture and its back on the right. A bag or a bar is a pillow
 * sealed flat at the top and bottom; a box is a carton.
 */
export function packGeo(kind: PackKind): Geo {
  const { w, h, d } = PACK_SIZE[kind];
  if (kind === "box") return cartonGeo(w, h, d);
  const g = new Geo();
  const nx = 12;
  const ny = 16;
  const seal = kind === "bag" ? 0.016 : 0.012;
  // thickness across (flat-sided for a bar) and up (sealed flat at the ends)
  const across = (s: number) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), kind === "bag" ? 2.6 : 6)), 0.5);
  const up = (y: number) => {
    const q = Math.abs(y) / (h / 2 - seal);
    return q >= 1 ? 0 : Math.pow(1 - Math.pow(q, kind === "bag" ? 3 : 8), 0.5);
  };
  for (const side of [-1, 1]) {
    const rows: number[][] = [];
    for (let j = 0; j <= ny; j++) {
      const v = j / ny;
      const y = (v - 0.5) * h;
      const row: number[] = [];
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const s = u * 2 - 1;
        const t = (d / 2) * across(s) * up(y);
        // a full bag pulls its sides in a little where it's fattest
        const x = (s * w) / 2 * (1 - 0.07 * up(y) * (kind === "bag" ? 1 : 0.3));
        // the front's art on the left half, the back's on the right, each read the right way round
        const uu = side < 0 ? u * 0.5 : 0.5 + (1 - u) * 0.5;
        row.push(g.vert(x, y, side * t, uu, v));
      }
      rows.push(row);
    }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = rows[j][i];
        const b = rows[j][i + 1];
        const c = rows[j + 1][i + 1];
        const e = rows[j + 1][i];
        if (side < 0) g.quad(a, b, c, e);
        else g.quad(a, e, c, b);
      }
  }
  return g.computeNormals();
}

/** A carton w x h x d: the front's art on the left half of the texture, the back's on the right, the edges in the background colour. */
function cartonGeo(w: number, h: number, d: number): Geo {
  const g = new Geo();
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const face = (n: [number, number, number], c: [number, number, number][], uv: [number, number, number, number]) => {
    const [u0, v0, u1, v1] = uv;
    const a = g.vert(...c[0], u0, v0, ...n);
    const b = g.vert(...c[1], u1, v0, ...n);
    const cc = g.vert(...c[2], u1, v1, ...n);
    const e = g.vert(...c[3], u0, v1, ...n);
    g.quad(a, b, cc, e);
  };
  // the edges take a thin strip down the art's side, which is plain background
  const edge: [number, number, number, number] = [0.01, 0.3, 0.02, 0.7];
  face([0, 0, -1], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz]], [0, 0, 0.5, 1]);
  face([0, 0, 1], [[hx, -hy, hz], [-hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz]], [0.5, 0, 1, 1]);
  face([-1, 0, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz]], edge);
  face([1, 0, 0], [[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz]], edge);
  face([0, 1, 0], [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]], edge);
  face([0, -1, 0], [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]], edge);
  // box() orders its corners the same way and then fixes the winding to its normals
  g.idx = [];
  for (let k = 0; k < 6; k++) g.quad(k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 3);
  return fixFaces(g);
}

/** Turn each triangle to face the way its normals point. */
function fixFaces(g: Geo): Geo {
  for (let i = 0; i < g.idx.length; i += 3) {
    const [a, b, c] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
    const p = (k: number) => new Vector3(g.pos[k * 3], g.pos[k * 3 + 1], g.pos[k * 3 + 2]);
    const seen = Vector3.Cross(p(c).subtract(p(a)), p(b).subtract(p(a)));
    const n = new Vector3(g.nrm[a * 3], g.nrm[a * 3 + 1], g.nrm[a * 3 + 2]);
    if (Vector3.Dot(seen, n) < 0) {
      g.idx[i + 1] = c;
      g.idx[i + 2] = b;
    }
  }
  return g;
}

/**
 * A coil: a steel wire spiral along +Z from its front end at the origin, one turn per
 * snack, its wire ending in a short straight tail at the front as a real coil's does.
 */
export function coilGeo(): Geo {
  const g = new Geo();
  const R = SNACK.coilR;
  const turns = COIL_CAPACITY;
  const wire = 0.0024;
  const per = 18;
  const n = turns * per;
  const sides = 6;
  const pts: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / per) * Math.PI * 2;
    pts.push(new Vector3(Math.sin(a) * R, -Math.cos(a) * R, (i / per) * SNACK.pitch));
  }
  // the wire, swept by hand: around a helix a fixed "up" would twist, so each ring is set square to the tangent and the axis
  const rings: number[][] = [];
  pts.forEach((p, i) => {
    const t = pts[Math.min(n, i + 1)].subtract(pts[Math.max(0, i - 1)]).normalize();
    const radial = new Vector3(p.x, p.y, 0).normalize();
    const b = Vector3.Cross(t, radial).normalize();
    const nrm = Vector3.Cross(b, t).normalize();
    const ring: number[] = [];
    for (let k = 0; k <= sides; k++) {
      const q = (k / sides) * Math.PI * 2;
      const dir = nrm.scale(Math.cos(q)).add(b.scale(Math.sin(q)));
      ring.push(g.vert(p.x + dir.x * wire, p.y + dir.y * wire, p.z + dir.z * wire, k / sides, i / per, dir.x, dir.y, dir.z));
    }
    rings.push(ring);
  });
  for (let i = 0; i < n; i++) for (let k = 0; k < sides; k++) g.quad(rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]);
  fixFaces(g);
  // the hub at the back, where the motor turns it
  g.add(cylinder(0.012, 0.02, 10), xf(0, 0, SNACK.coilLen + 0.01, 0, 1, 1, 1, Math.PI / 2));
  g.add(box(0.006, 2 * R, 0.006), xf(0, 0, SNACK.coilLen + 0.004));
  return g;
}

// ------------------------------------------------------------------ pack art

function packCanvas(b: SnackBrand): HTMLCanvasElement {
  const W = 256;
  const H = b.kind === "bag" ? 372 : b.kind === "bar" ? 504 : 412;
  const { canvas, ctx: c } = makeCanvas(W * 2, H);
  for (const back of [false, true]) {
    c.save();
    c.translate(back ? W : 0, 0);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, b.bg[0]);
    g.addColorStop(1, b.bg[1]);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // the sealed ends of a bag or a bar: crimped
    if (b.kind !== "box") {
      const seal = b.kind === "bag" ? 26 : 30;
      for (const y0 of [0, H - seal]) {
        c.fillStyle = "rgba(0,0,0,0.16)";
        c.fillRect(0, y0, W, seal);
        c.strokeStyle = "rgba(255,255,255,0.28)";
        c.lineWidth = 2;
        for (let x = -seal; x < W; x += 7) {
          c.beginPath();
          c.moveTo(x, y0);
          c.lineTo(x + seal * 0.6, y0 + seal);
          c.stroke();
        }
      }
    }
    if (back) packBack(c, b, W, H);
    else packFront(c, b, W, H);
    c.restore();
  }
  return canvas;
}

function packFront(c: Ctx, b: SnackBrand, W: number, H: number) {
  const top = b.kind === "bag" ? 26 : b.kind === "bar" ? 30 : 0;
  // a sheen down the left, as foil catches the light
  const sh = c.createLinearGradient(0, 0, W, 0);
  sh.addColorStop(0, "rgba(255,255,255,0.22)");
  sh.addColorStop(0.35, "rgba(255,255,255,0)");
  c.fillStyle = sh;
  c.fillRect(0, top, W, H - 2 * top);
  // the ChimpHouse badge: a little chimp in a leaf
  const bx = W - 38;
  const by = top + 38;
  c.fillStyle = "rgba(255,255,255,0.9)";
  c.beginPath();
  c.arc(bx, by, 27, 0, Math.PI * 2);
  c.fill();
  chimpFace(c, bx, by + 2, 21);
  // the name
  const lines = b.name.split("\n");
  const size = b.kind === "bar" ? 44 : 46;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `900 ${size}px Nunito`;
  const y0 = b.kind === "bar" ? H * 0.26 : top + 100;
  lines.forEach((l, i) => {
    const y = y0 + i * size * 0.95;
    c.lineWidth = 9;
    c.strokeStyle = "rgba(0,0,0,0.35)";
    c.strokeText(l, W / 2, y + 3);
    c.fillStyle = b.ink;
    c.fillText(l, W / 2, y);
  });
  // the flavour on a ribbon
  const fy = y0 + lines.length * size * 0.95 + 4;
  c.fillStyle = b.accent;
  c.beginPath();
  c.moveTo(14, fy - 15);
  c.lineTo(W - 14, fy - 15);
  c.lineTo(W - 24, fy);
  c.lineTo(W - 14, fy + 15);
  c.lineTo(14, fy + 15);
  c.lineTo(24, fy);
  c.closePath();
  c.fill();
  c.fillStyle = "#ffffff";
  c.font = "800 17px Montserrat";
  c.fillText(b.flavour.toUpperCase(), W / 2, fy + 1, W - 50);
  // what's inside
  const ay = (fy + 22 + H - top) / 2;
  packArt(c, b, W / 2, ay, Math.min(W * 0.4, (H - top - fy) * 0.42));
  // "NEW!" or the weight
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.font = "700 14px Montserrat";
  c.fillText(b.kind === "bar" ? "45 g" : b.kind === "box" ? "120 g" : "60 g", W / 2, H - top - 14);
}

function packBack(c: Ctx, b: SnackBrand, W: number, H: number) {
  const top = b.kind === "bag" ? 26 : b.kind === "bar" ? 30 : 0;
  c.fillStyle = b.ink;
  c.font = "900 30px Nunito";
  c.textAlign = "center";
  c.fillText(b.name.replace("\n", " "), W / 2, top + 44, W - 20);
  c.fillStyle = "rgba(255,255,255,0.88)";
  c.fillRect(22, top + 64, W - 44, 130);
  c.fillStyle = "#333";
  c.font = "700 13px Montserrat";
  c.textAlign = "left";
  c.fillText("A CHIMPHOUSE SNACK", 32, top + 84);
  c.font = "500 11px Montserrat";
  for (let i = 0; i < 6; i++) {
    c.fillRect(32, top + 98 + i * 15, 60 + ((i * 37) % 90), 3);
    c.fillRect(W - 70, top + 98 + i * 15, 36, 3);
  }
  // a barcode
  c.fillStyle = "#fff";
  c.fillRect(W / 2 - 60, H - top - 76, 120, 56);
  c.fillStyle = "#111";
  const r = rng(b.id.length * 97 + b.name.length);
  for (let x = W / 2 - 54; x < W / 2 + 54; ) {
    const bw = 1 + Math.floor(r() * 3);
    c.fillRect(x, H - top - 70, bw, 38);
    x += bw + 1 + Math.floor(r() * 3);
  }
  drawLeafEmblem(c, W / 2, top + 240, 40, "rgba(255,255,255,0.35)");
}

/** The snack itself, drawn on the front of its pack. */
function packArt(c: Ctx, b: SnackBrand, x: number, y: number, s: number) {
  const r = rng(b.id.charCodeAt(0) * 13 + b.id.length);
  const blob = (px: number, py: number, rad: number, fill: string, edge?: string) => {
    c.fillStyle = fill;
    c.beginPath();
    c.arc(px, py, rad, 0, Math.PI * 2);
    c.fill();
    if (edge) {
      c.strokeStyle = edge;
      c.lineWidth = 2;
      c.stroke();
    }
  };
  // a soft glow behind the snack
  const gl = c.createRadialGradient(x, y, 0, x, y, s * 1.2);
  gl.addColorStop(0, "rgba(255,255,255,0.45)");
  gl.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = gl;
  c.fillRect(x - s * 1.3, y - s * 1.3, s * 2.6, s * 2.6);
  switch (b.art) {
    case "bananaChips":
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.3;
        const px = x + Math.cos(a) * s * (i ? 0.55 : 0);
        const py = y + Math.sin(a) * s * (i ? 0.45 : 0);
        blob(px, py, s * 0.3, "#fbe7a1", "#c98f2e");
        for (let k = 0; k < 6; k++) blob(px + Math.cos(k) * s * 0.12, py + Math.sin(k) * s * 0.12, 2.2, "#8a5a2b");
      }
      // a whole banana over the chips
      c.strokeStyle = "#f7d21c";
      c.lineWidth = s * 0.22;
      c.lineCap = "round";
      c.beginPath();
      c.arc(x, y - s * 0.9, s * 0.8, Math.PI * 0.2, Math.PI * 0.8);
      c.stroke();
      break;
    case "puffs":
      for (let i = 0; i < 9; i++) {
        const px = x + (r() - 0.5) * s * 1.5;
        const py = y + (r() - 0.5) * s * 1.1;
        c.fillStyle = "#ffb347";
        c.beginPath();
        c.ellipse(px, py, s * 0.28, s * 0.13, r() * 3, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#d9731f";
        c.lineWidth = 2;
        c.stroke();
      }
      break;
    case "twigs":
      c.lineCap = "round";
      for (let i = 0; i < 7; i++) {
        const a = -0.5 + (i / 6) * 1.0;
        const px = x + (i - 3) * s * 0.18;
        c.strokeStyle = "#e8c48a";
        c.lineWidth = 8;
        c.beginPath();
        c.moveTo(px - Math.sin(a) * s * 0.7, y + s * 0.7);
        c.lineTo(px + Math.sin(a) * s * 0.7, y - s * 0.7);
        c.stroke();
        // dipped in chocolate halfway, with pink sprinkles
        c.strokeStyle = "#3a1d0e";
        c.lineWidth = 10;
        c.beginPath();
        c.moveTo(px, y);
        c.lineTo(px + Math.sin(a) * s * 0.7, y - s * 0.7);
        c.stroke();
        blob(px + Math.sin(a) * s * 0.35, y - s * 0.35, 2.5, "#ff6fa8");
      }
      break;
    case "mango":
      for (let i = 0; i < 5; i++) {
        const px = x + (i - 2) * s * 0.36;
        const py = y + (i % 2 ? -0.15 : 0.2) * s;
        c.fillStyle = "#ffb21f";
        c.beginPath();
        c.ellipse(px, py, s * 0.24, s * 0.5, (i - 2) * 0.3, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#e07a10";
        c.lineWidth = 3;
        c.stroke();
      }
      break;
    case "kettle":
      for (let i = 0; i < 6; i++) {
        const px = x + (r() - 0.5) * s * 1.3;
        const py = y + (r() - 0.5) * s;
        c.fillStyle = "#f5d98a";
        c.beginPath();
        c.ellipse(px, py, s * 0.38, s * 0.28, r() * 3, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#c79b3c";
        c.lineWidth = 3;
        c.stroke();
        blob(px + 4, py - 3, 3, "#d8b25c");
      }
      break;
    case "vines":
      c.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        c.strokeStyle = ["#ff4fa3", "#ffd23f", "#40e6ff", "#ff7a1a"][i];
        c.lineWidth = 12;
        c.beginPath();
        for (let k = 0; k <= 20; k++) {
          const t = k / 20;
          const px = x - s + t * s * 2;
          const py = y + (i - 1.5) * s * 0.32 + Math.sin(t * 9 + i) * s * 0.12;
          if (k) c.lineTo(px, py);
          else c.moveTo(px, py);
        }
        c.stroke();
      }
      break;
    case "popcorn":
      for (let i = 0; i < 14; i++) {
        const px = x + (r() - 0.5) * s * 1.6;
        const py = y + (r() - 0.5) * s * 1.1;
        for (let k = 0; k < 4; k++) blob(px + Math.cos(k * 1.7) * 7, py + Math.sin(k * 1.7) * 6, 8, "#fff7dd", "#e3c27a");
      }
      break;
    case "chocolate":
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 3; i++) {
          c.fillStyle = "#5a2e14";
          c.fillRect(x - s * 0.9 + i * s * 0.62, y - s * 0.55 + j * s * 0.62, s * 0.55, s * 0.55);
          c.fillStyle = "#7a4220";
          c.fillRect(x - s * 0.86 + i * s * 0.62, y - s * 0.51 + j * s * 0.62, s * 0.47, s * 0.12);
        }
      break;
    case "caramel":
      c.fillStyle = "#6b3a17";
      c.fillRect(x - s, y - s * 0.3, s * 2, s * 0.6);
      c.fillStyle = "#e09b3d";
      c.fillRect(x - s, y - s * 0.1, s * 2, s * 0.2);
      for (let i = 0; i < 5; i++) blob(x - s * 0.8 + i * s * 0.4, y - s * 0.5, s * 0.14, "#d9a066", "#9a6532");
      break;
    case "nuts":
      for (let i = 0; i < 10; i++) {
        const px = x + (r() - 0.5) * s * 1.6;
        const py = y + (r() - 0.5) * s;
        c.fillStyle = ["#a0612f", "#d9a066", "#7a4420", "#f2c94c"][i % 4];
        c.beginPath();
        c.ellipse(px, py, s * 0.2, s * 0.13, r() * 3, 0, Math.PI * 2);
        c.fill();
      }
      // and the stone a chimp cracks them with
      blob(x + s * 0.7, y + s * 0.5, s * 0.25, "#8d8a84", "#5f5c57");
      break;
    case "cookies":
      for (let i = 0; i < 3; i++) {
        const px = x + (i - 1) * s * 0.6;
        const py = y + (i === 1 ? -0.2 : 0.15) * s;
        blob(px, py, s * 0.42, "#c98a4b", "#8a5524");
        for (let k = 0; k < 5; k++) blob(px + Math.cos(k * 2.3) * s * 0.22, py + Math.sin(k * 2.3) * s * 0.2, 4.5, "#3a1d0e");
      }
      break;
  }
}

/** A chimp's face, as on the packs, the keypad and the sign. */
export function chimpFace(c: Ctx, x: number, y: number, r: number): void {
  const brown = "#5b3a24";
  const tan = "#e2b98e";
  const dot = (px: number, py: number, rad: number, fill: string) => {
    c.fillStyle = fill;
    c.beginPath();
    c.arc(px, py, rad, 0, Math.PI * 2);
    c.fill();
  };
  for (const s of [-1, 1]) {
    dot(x + s * r * 0.95, y - r * 0.05, r * 0.32, brown);
    dot(x + s * r * 0.95, y - r * 0.05, r * 0.18, tan);
  }
  dot(x, y, r * 0.88, brown);
  // the face: two eye patches over a broad muzzle
  dot(x - r * 0.27, y - r * 0.15, r * 0.36, tan);
  dot(x + r * 0.27, y - r * 0.15, r * 0.36, tan);
  c.fillStyle = tan;
  c.beginPath();
  c.ellipse(x, y + r * 0.3, r * 0.55, r * 0.4, 0, 0, Math.PI * 2);
  c.fill();
  dot(x - r * 0.26, y - r * 0.18, r * 0.11, "#1b120c");
  dot(x + r * 0.26, y - r * 0.18, r * 0.11, "#1b120c");
  dot(x - r * 0.23, y - r * 0.22, r * 0.04, "#ffffff");
  dot(x + r * 0.29, y - r * 0.22, r * 0.04, "#ffffff");
  dot(x - r * 0.08, y + r * 0.15, r * 0.05, "#3b2516");
  dot(x + r * 0.08, y + r * 0.15, r * 0.05, "#3b2516");
  c.strokeStyle = "#3b2516";
  c.lineWidth = Math.max(1.5, r * 0.08);
  c.lineCap = "round";
  c.beginPath();
  c.arc(x, y + r * 0.28, r * 0.28, Math.PI * 0.15, Math.PI * 0.85);
  c.stroke();
}

/** A small banana, for prices: banana coins are what ChimpHouse counts in. */
function banana(c: Ctx, x: number, y: number, s: number) {
  // a crescent: the outer curve, back along a flatter inner one, with a stalk and a dark tip
  c.fillStyle = "#ffd23f";
  c.beginPath();
  c.arc(x, y - s * 0.9, s, Math.PI * 0.18, Math.PI * 0.82);
  c.arc(x, y - s * 1.45, s * 1.25, Math.PI * 0.74, Math.PI * 0.26, true);
  c.closePath();
  c.fill();
  c.fillStyle = "#6b4a1e";
  c.fillRect(x + Math.cos(Math.PI * 0.18) * s - s * 0.12, y - s * 0.9 + Math.sin(Math.PI * 0.18) * s - s * 0.2, s * 0.18, s * 0.22);
  c.beginPath();
  c.arc(x + Math.cos(Math.PI * 0.82) * s, y - s * 0.9 + Math.sin(Math.PI * 0.82) * s, s * 0.08, 0, Math.PI * 2);
  c.fill();
}

// ------------------------------------------------------------------ the cabinet's art

const TEAL = "#134a47";

/** The lit sign along the top: the machine's name, CHIMP CHOMP. */
function headerCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(1024, 256);
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#0f3533");
  g.addColorStop(1, "#071c1b");
  c.fillStyle = g;
  c.fillRect(0, 0, 1024, 256);
  // leaves in the corners, dark on dark
  drawLeafEmblem(c, 70, 200, 170, "rgba(47,191,143,0.22)");
  drawLeafEmblem(c, 960, 210, 150, "rgba(47,191,143,0.18)");
  // a mint border
  c.strokeStyle = "#6ff0bf";
  c.lineWidth = 6;
  c.strokeRect(14, 14, 996, 228);
  // the chimp's face, then the name glowing cream over the window; the right end is where the plush chimp's legs hang
  chimpFace(c, 100, 112, 58);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = "900 112px Nunito";
  c.shadowColor = "rgba(255,200,120,0.85)";
  c.shadowBlur = 24;
  c.fillStyle = "#ffe9c9";
  c.fillText("Chimp Chomp", 430, 104, 540);
  c.shadowBlur = 0;
  c.fillStyle = "#6ff0bf";
  c.font = "800 30px Montserrat";
  c.fillText("SNACKS  ·  FRESH FROM THE CANOPY", 430, 200, 540);
  return canvas;
}

/** The pay and select column beside the window. Coordinates: (x, y) in the machine's frame, to pixels. */
const COL = { x0: 0.225, x1: 0.445, y0: 0.64, y1: 1.6 };
const COL_PX = 220 / (COL.x1 - COL.x0) / 0.98;

function columnCanvas(): HTMLCanvasElement {
  const w = Math.round((COL.x1 - COL.x0) * COL_PX);
  const h = Math.round((COL.y1 - COL.y0) * COL_PX);
  const { canvas, ctx: c } = makeCanvas(w, h);
  const px = (x: number) => (x - COL.x0) * COL_PX;
  const py = (y: number) => (COL.y1 - y) * COL_PX;
  c.fillStyle = TEAL;
  c.fillRect(0, 0, w, h);
  drawLeafEmblem(c, w * 0.75, h * 0.92, 90, "rgba(111,240,191,0.12)");
  drawLeafEmblem(c, w * 0.2, h * 0.97, 70, "rgba(111,240,191,0.10)");
  c.textAlign = "center";
  c.textBaseline = "middle";
  const label = (t: string, y: number, size = 15, color = "#ffe9c9") => {
    c.fillStyle = color;
    c.font = `800 ${size}px Montserrat`;
    c.fillText(t, w / 2, py(y));
  };
  // brass pinstripes boxing each section
  c.strokeStyle = "#c8a15a";
  c.lineWidth = 2;
  const boxAt = (y0: number, y1: number) => c.strokeRect(px(0.236), py(y1), px(0.434) - px(0.236), py(y0) - py(y1));
  boxAt(1.165, 1.575);
  boxAt(0.86, 1.15);
  boxAt(0.68, 0.845);
  label("SELECT", 1.443, 16, "#6ff0bf");
  label("LETTER, THEN NUMBER", 1.183, 11);
  label("PAY", 1.13, 16, "#6ff0bf");
  label("COINS", 1.025, 10);
  label("NOTES", 1.025, 10);
  // move the two to sit under their slots
  c.fillStyle = TEAL;
  c.fillRect(0, py(1.035), w, py(1.015) - py(1.035));
  c.fillStyle = "#ffe9c9";
  c.font = "800 10px Montserrat";
  c.fillText("COINS", px(0.287), py(1.025));
  c.fillText("NOTES", px(0.385), py(1.025));
  // the tap-to-pay ring
  c.strokeStyle = "#6ff0bf";
  c.lineWidth = 3;
  c.beginPath();
  c.arc(px(0.335), py(0.94), 0.034 * COL_PX, 0, Math.PI * 2);
  c.stroke();
  label("TAP", 0.885, 11);
  label("COIN RETURN", 0.828, 10);
  // free today: snacks are on the house
  c.fillStyle = "#ffd23f";
  c.font = "900 15px Nunito";
  c.fillText("ON THE HOUSE!", w / 2, py(0.66));
  return canvas;
}

/** The panel under the window, round the PUSH flap: a banner of leaves. */
function lowerCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(1024, 640);
  c.fillStyle = TEAL;
  c.fillRect(0, 0, 1024, 640);
  const r = rng(77);
  for (let i = 0; i < 16; i++) drawLeafEmblem(c, r() * 1024, 380 + r() * 300, 70 + r() * 90, `rgba(${47 + r() * 30},${150 + r() * 60},${110 + r() * 40},${0.12 + r() * 0.12})`);
  // a brass line along the top
  c.fillStyle = "#c8a15a";
  c.fillRect(0, 10, 1024, 4);
  return canvas;
}

/** Inside the cabinet, behind the coils: a dim jungle, lit from the front. */
function backWallCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(512, 768);
  const g = c.createLinearGradient(0, 0, 0, 768);
  g.addColorStop(0, "#1d5a52");
  g.addColorStop(1, "#0c2e2b");
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 768);
  const r = rng(12);
  for (let i = 0; i < 26; i++) drawLeafEmblem(c, r() * 512, r() * 768, 60 + r() * 120, `rgba(${30 + r() * 40},${120 + r() * 80},${90 + r() * 40},${0.2 + r() * 0.25})`);
  return canvas;
}

/** The cabinet's timber sides, painted with big jungle leaves and edged in mint. */
function sideCanvas(): HTMLCanvasElement {
  const W = 460;
  const H = 1024;
  const { canvas, ctx: c } = makeCanvas(W, H);
  c.fillStyle = "#4b2f1d";
  c.fillRect(0, 0, W, H);
  const r = rng(5);
  // planks and their grain
  for (let p = 0; p < 5; p++) {
    const x0 = (p * W) / 5;
    c.fillStyle = `rgba(${90 + r() * 30},${55 + r() * 20},${30 + r() * 12},0.5)`;
    c.fillRect(x0, 0, W / 5, H);
    c.strokeStyle = "rgba(30,16,8,0.35)";
    c.lineWidth = 1.5;
    for (let k = 0; k < 14; k++) {
      const gx = x0 + r() * (W / 5);
      c.beginPath();
      c.moveTo(gx, 0);
      for (let y = 0; y <= H; y += 64) c.lineTo(gx + Math.sin(y * 0.01 + k) * 4, y);
      c.stroke();
    }
    c.fillStyle = "rgba(20,10,4,0.7)";
    c.fillRect(x0, 0, 3, H);
  }
  // the leaves, in a deep green with lighter veins
  const leaf = (x: number, y: number, len: number, a: number, fill: string) => {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(len * 0.35, -len * 0.3, len * 0.8, -len * 0.25, len, 0);
    c.bezierCurveTo(len * 0.8, len * 0.25, len * 0.35, len * 0.3, 0, 0);
    c.fill();
    c.strokeStyle = "rgba(160,230,180,0.45)";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(len * 0.95, 0);
    c.stroke();
    c.lineWidth = 1.5;
    for (let k = 1; k < 7; k++) {
      const t = k / 7;
      for (const s of [-1, 1]) {
        c.beginPath();
        c.moveTo(len * t, 0);
        c.lineTo(len * (t + 0.08), s * len * 0.2 * Math.sin(Math.PI * t));
        c.stroke();
      }
    }
    c.restore();
  };
  leaf(-20, 880, 420, -0.9, "#1f5e3f");
  leaf(-10, 640, 360, -0.35, "#24704a");
  leaf(W + 20, 760, 380, Math.PI + 0.7, "#1c5639");
  leaf(W + 10, 420, 300, Math.PI + 0.2, "#22684a");
  leaf(-20, 300, 260, -0.15, "#1f5e3f");
  drawLeafEmblem(c, W / 2, 180, 150, "rgba(111,240,191,0.25)");
  // a mint pinstripe round the edge
  c.strokeStyle = "#6ff0bf";
  c.lineWidth = 6;
  c.strokeRect(18, 18, W - 36, H - 36);
  return canvas;
}

/** The labels along each tray's front: each lane's code and price, row A at the top. */
function tagCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(1024, 320);
  ROWS.forEach((row, ri) => {
    const y0 = ri * 64;
    c.fillStyle = "#0b2423";
    c.fillRect(0, y0, 1024, 64);
    const n = SNACK.lanes[ri];
    for (let k = 0; k < n; k++) {
      const cx = ((k + 0.5) * 1024) / n;
      c.fillStyle = "#ffe9c9";
      c.fillRect(cx - 72, y0 + 10, 70, 44);
      c.fillStyle = "#0b2423";
      c.font = "900 34px Nunito";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(`${row}${k + 1}`, cx - 37, y0 + 33);
      c.fillStyle = "#ffd23f";
      c.font = "800 30px Montserrat";
      c.fillText(`${1 + ((ri + k) % 3)}`, cx + 22, y0 + 33);
      banana(c, cx + 52, y0 + 38, 18);
    }
  });
  return canvas;
}

/** The keys' legends, a 4 x 3 grid in the keypad's order. */
function keyCanvas(): HTMLCanvasElement {
  const { canvas, ctx: c } = makeCanvas(384, 512);
  SNACK_KEYS.forEach((k, i) => {
    const x = (i % 3) * 128;
    const y = Math.floor(i / 3) * 128;
    const g = c.createLinearGradient(0, y, 0, y + 128);
    g.addColorStop(0, "#f7f3ea");
    g.addColorStop(1, "#d8d1c2");
    c.fillStyle = g;
    c.fillRect(x, y, 128, 128);
    c.fillStyle = k === "CLR" ? "#c4552e" : /\d/.test(k) ? "#134a47" : "#2a2a2a";
    c.font = k === "CLR" ? "900 40px Montserrat" : "900 72px Nunito";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(k, x + 64, y + 68);
  });
  return canvas;
}

// ------------------------------------------------------------------ the machine

function mats(ctx: WorldCtx) {
  const add = (key: string, o: Parameters<typeof ctx.mats.pbr>[1]) => {
    if (!ctx.mats.has(key)) ctx.mats.pbr(key, o);
  };
  add("snackTeal", { color: TEAL, rough: 0.3, clearCoat: 0.7 });
  add("snackInside", { color: "#163b39", rough: 0.6 });
  add("plushBrown", { color: "#6b4a33", rough: 0.95 });
  add("plushTan", { color: "#d9b48f", rough: 0.95 });
  if (!ctx.mats.has("snackLed")) ctx.mats.unlit("snackLed", { color: "#f2fff8", intensity: 1.3 });
  ctx.mats.glowing.add("snackLed");
  const decal = (key: string, canvas: () => HTMLCanvasElement, o: { rough?: number; emissive?: string; emissiveIntensity?: number } = {}) => {
    if (!ctx.mats.has(key)) ctx.mats.decal(key, toTexture(ctx.scene, key, canvas(), { wrap: false }), o);
    return key;
  };
  return {
    side: decal("snackSide", sideCanvas, { rough: 0.5 }),
    column: decal("snackColumn", columnCanvas, { rough: 0.35, emissive: "#ffffff", emissiveIntensity: 0.12 }),
    lower: decal("snackLower", lowerCanvas, { rough: 0.35 }),
    back: decal("snackBackWall", backWallCanvas, { rough: 0.8, emissive: "#ffffff", emissiveIntensity: 0.35 }),
    tags: decal("snackTags", tagCanvas, { rough: 0.4, emissive: "#ffffff", emissiveIntensity: 0.3 }),
    keys: decal("snackKeys", keyCanvas, { rough: 0.3, emissive: "#ffffff", emissiveIntensity: 0.1 }),
  };
}

/** A quad covering [x0, x1] x [y0, y1] in the plane z, facing -Z, its UVs the part of `full` it covers. */
function rect(x0: number, y0: number, x1: number, y1: number, z: number, full: { x0: number; y0: number; x1: number; y1: number }): [Geo, Matrix] {
  const g = plane(x1 - x0, y1 - y0).remapUV((x0 - full.x0) / (full.x1 - full.x0), (y0 - full.y0) / (full.y1 - full.y0), (x1 - full.x0) / (full.x1 - full.x0), (y1 - full.y0) / (full.y1 - full.y0));
  return [g, xf((x0 + x1) / 2, (y0 + y1) / 2, z)];
}

/** The CHIMP CHOMP snack machine. Base at m, front -Z. */
export function snackMachine(ctx: WorldCtx, z: Zone, m: Matrix): void {
  const M = mats(ctx);
  const label = "Snack machine: Chimp Chomp";
  const { W, H, D, win, front, glassZ, coilZ, coilLen, trays } = SNACK;
  const at = (g: Geo, l: Matrix) => [g, l.multiply(m)] as const;
  const put = (mat: string, g: Geo, l: Matrix, lbl = label, opts?: { castShadow?: boolean; pickable?: boolean }) => ctx.g(z, mat, opts).add(...at(g, l), lbl);

  // ---- the body: plinth, timber sides, back and the cap
  put("black", box(W - 0.08, 0.07, D - 0.08), xf(0, 0.035, 0));
  const sideT = 0.035;
  for (const s of [-1, 1]) {
    put("timberDark", softBox(sideT, H - 0.07, D, 0.008), xf(s * (W / 2 - sideT / 2), 0.07 + (H - 0.07) / 2, 0));
    put(M.side, plane(D - 0.004, H - 0.074), xf(s * (W / 2 + 0.0005), 0.07 + (H - 0.07) / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2), label, { castShadow: false });
  }
  put("charcoal", box(W - 2 * sideT, H - 0.07, 0.02), xf(0, 0.07 + (H - 0.07) / 2, D / 2 - 0.01));
  put("timber", softBox(W + 0.06, 0.06, D + 0.05, 0.018), xf(0, H + 0.03, 0.005));
  put("timberDark", box(W + 0.02, 0.012, D + 0.01), xf(0, H - 0.004, 0.005));

  // ---- the front: a teal plate round the window, the pay column and the bin, 3 cm deep
  const fz = front + 0.015;
  const plate = (x0: number, y0: number, x1: number, y1: number) => put("snackTeal", box(x1 - x0, y1 - y0, 0.03), xf((x0 + x1) / 2, (y0 + y1) / 2, fz));
  const xl = -W / 2 + sideT;
  const xr = W / 2 - sideT;
  plate(xl, 0.07, win.x0, H - 0.01); // left stile
  plate(win.x1, win.y0 - 0.02, COL.x0, COL.y1); // mullion
  plate(win.x0, win.y0 - 0.04, win.x1, win.y0); // window sill
  plate(win.x0, win.y1, win.x1, COL.y1); // over the window, under the header
  plate(COL.x0, COL.y0, xr, COL.y1); // pay column
  plate(win.x0, 0.07, xr, SNACK.bin.y0); // under the bin
  plate(win.x0, SNACK.bin.y1, xr, win.y0 - 0.04); // over the bin
  plate(win.x0, SNACK.bin.y0, SNACK.bin.x0, SNACK.bin.y1); // left of the bin
  plate(SNACK.bin.x1, SNACK.bin.y0, xr, SNACK.bin.y1); // right of the bin
  plate(xl, H - 0.25, xr, H - 0.01); // behind the header
  // printed faces: the pay column, and the lower panel round the flap
  put(M.column, ...rect(COL.x0, COL.y0, xr, COL.y1, front - 0.0008, { x0: COL.x0, y0: COL.y0, x1: xr, y1: COL.y1 }), label, { castShadow: false });
  const low = { x0: win.x0, y0: 0.07, x1: xr, y1: win.y0 - 0.04 };
  const b = SNACK.bin;
  for (const r of [
    [low.x0, low.y0, low.x1, b.y0],
    [low.x0, b.y1, low.x1, low.y1],
    [low.x0, b.y0, b.x0, b.y1],
    [b.x1, b.y0, low.x1, b.y1],
  ])
    put(M.lower, ...rect(r[0], r[1], r[2], r[3], front - 0.0008, low), label, { castShadow: false });
  // the header: the lit sign, framed in brass
  const hdr = canvasMat(ctx, "snackHeader", headerCanvas(), 1.25);
  ctx.mats.glowing.add(hdr);
  const hy0 = H - 0.235;
  const hy1 = H - 0.025;
  put(hdr, plane(xr - xl - 0.03, hy1 - hy0), xf(0, (hy0 + hy1) / 2, front - 0.004), label, { castShadow: false });
  // brass trim: round the header, round the window, a kick strip
  const brass = new Geo();
  const trimH = (x0: number, x1: number, y: number) => brass.add(box(x1 - x0, 0.01, 0.012), xf((x0 + x1) / 2, y, front - 0.004));
  const trimV = (x: number, y0: number, y1: number) => brass.add(box(0.01, y1 - y0, 0.012), xf(x, (y0 + y1) / 2, front - 0.004));
  trimH(xl + 0.01, xr - 0.01, hy0 - 0.008);
  trimH(xl + 0.01, xr - 0.01, hy1 + 0.008);
  trimV(xl + 0.01, hy0 - 0.008, hy1 + 0.008);
  trimV(xr - 0.01, hy0 - 0.008, hy1 + 0.008);
  trimH(win.x0 - 0.01, win.x1 + 0.01, win.y0 - 0.008);
  trimH(win.x0 - 0.01, win.x1 + 0.01, win.y1 + 0.008);
  trimV(win.x0 - 0.008, win.y0 - 0.013, win.y1 + 0.013);
  trimV(win.x1 + 0.008, win.y0 - 0.013, win.y1 + 0.013);
  trimH(xl + 0.01, xr - 0.01, 0.1);
  put("brass", brass, Matrix.Identity(), label, { castShadow: false });

  // ---- the window: glass, and inside it the lit cabinet the trays stand in
  put("glass", box(win.x1 - win.x0 + 0.02, win.y1 - win.y0 + 0.02, 0.006), xf((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, glassZ), label, { castShadow: false, pickable: false });
  const back = coilZ + coilLen + 0.06;
  const iw = win.x1 - win.x0;
  put(M.back, plane(iw, win.y1 - win.y0 + 0.2), xf((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2 - 0.1, back), label, { castShadow: false });
  const inside = new Geo();
  for (const s of [-1, 1]) inside.add(plane(back - front, win.y1 - b.floor), xf(s < 0 ? win.x0 : win.x1, (win.y1 + b.floor) / 2, (back + front) / 2, s < 0 ? Math.PI / 2 : -Math.PI / 2));
  inside.add(plane(iw, back - front), xf((win.x0 + win.x1) / 2, win.y1, (back + front) / 2, 0, 1, 1, 1, -Math.PI / 2));
  put("snackInside", inside, Matrix.Identity(), label, { castShadow: false });
  // LED strips down each side of the window, behind the frame, and one along the top
  const led = new Geo();
  for (const x of [win.x0 + 0.006, win.x1 - 0.006]) led.add(box(0.005, win.y1 - win.y0 - 0.02, 0.005), xf(x, (win.y0 + win.y1) / 2, glassZ + 0.02));
  led.add(box(iw - 0.02, 0.005, 0.005), xf((win.x0 + win.x1) / 2, win.y1 - 0.006, glassZ + 0.03));
  put("snackLed", led, Matrix.Identity(), label, { castShadow: false });

  // ---- the trays: a steel shelf per row, its label strip, the coils' motors at the back, lane dividers
  const steel = new Geo();
  const motors = new Geo();
  const tags = new Geo();
  trays.forEach((ty, ri) => {
    steel.add(box(iw - 0.004, 0.006, coilLen + 0.03), xf((win.x0 + win.x1) / 2, ty - 0.003, coilZ + coilLen / 2 + 0.005));
    // a lip at the front, holding the label strip
    steel.add(box(iw - 0.004, 0.03, 0.004), xf((win.x0 + win.x1) / 2, ty - 0.015, coilZ - 0.012));
    const v0 = 1 - (ri + 1) / ROWS.length;
    tags.add(plane(iw - 0.01, 0.026).remapUV(0, v0, 1, v0 + 1 / ROWS.length), xf((win.x0 + win.x1) / 2, ty - 0.015, coilZ - 0.0145));
    const n = SNACK.lanes[ri];
    for (let k = 1; k <= n; k++) {
      motors.add(box(0.05, 0.06, 0.045), xf(laneX(ri, k), ty + 0.03, coilZ + coilLen + 0.03));
      // a wire divider between lanes
      if (k < n) steel.add(box(0.002, 0.07, coilLen - 0.04), xf((laneX(ri, k) + laneX(ri, k + 1)) / 2, ty + 0.035, coilZ + coilLen / 2 + 0.02));
    }
  });
  put("steel", steel, Matrix.Identity(), label, { castShadow: false });
  put("black", motors, Matrix.Identity(), label, { castShadow: false });
  put(M.tags, tags, Matrix.Identity(), label, { castShadow: false });

  // ---- the bin: a chute down behind the lower panel to the floor a dropped snack lands on
  const bin = new Geo();
  const sh = SNACK.shaft;
  const lip = coilZ - 0.014;
  const bw = b.x1 - b.x0 + 0.06;
  bin.add(box(bw, 0.01, sh.binBack - front), xf((b.x0 + b.x1) / 2, b.floor - 0.005, (sh.binBack + front) / 2));
  const chute = Math.hypot(sh.top - b.floor, lip - sh.binBack);
  bin.add(box(bw, chute, 0.008), xf((b.x0 + b.x1) / 2, (sh.top + b.floor) / 2, (sh.binBack + lip) / 2 + 0.004, 0, 1, 1, 1, -Math.atan2(sh.binBack - lip, sh.top - b.floor)));
  bin.add(box(bw, win.y0 - sh.top, 0.008), xf((b.x0 + b.x1) / 2, (win.y0 + sh.top) / 2, lip + 0.004));
  for (const x of [b.x0 - 0.03, b.x1 + 0.03]) bin.add(box(0.01, win.y0 - b.floor, sh.binBack - front), xf(x, (win.y0 + b.floor) / 2, (sh.binBack + front) / 2));
  put("charcoal", bin, Matrix.Identity(), label, { castShadow: false });
  // the flap's brass frame
  const fr = new Geo();
  fr.add(box(b.x1 - b.x0 + 0.03, 0.015, 0.012), xf((b.x0 + b.x1) / 2, b.y1 + 0.0075, front - 0.004));
  fr.add(box(b.x1 - b.x0 + 0.03, 0.015, 0.012), xf((b.x0 + b.x1) / 2, b.y0 - 0.0075, front - 0.004));
  for (const x of [b.x0 - 0.0075, b.x1 + 0.0075]) fr.add(box(0.015, b.y1 - b.y0, 0.012), xf(x, (b.y0 + b.y1) / 2, front - 0.004));
  put("brass", fr, Matrix.Identity(), "PUSH flap");

  // ---- the pay column: display, keypad, coin and note slots, tap pad, coin return
  const cx = (COL.x0 + xr) / 2;
  put("black", softBox(0.19, 0.1, 0.02, 0.006), xf(cx, 1.5, front - 0.006), "Snack machine display");
  put("black", softBox(0.172, 0.21, 0.012, 0.006), xf(cx, 1.3, front - 0.004), "Keypad");
  const keys = new Geo();
  const keyFaces = new Geo();
  SNACK_KEYS.forEach((k, i) => {
    const { x, y } = keyAt(i);
    keys.add(softBox(0.044, 0.036, 0.012, 0.005), xf(x, y, front - 0.012));
    const col = i % 3;
    const row = Math.floor(i / 3);
    keyFaces.add(plane(0.036, 0.028).remapUV(col / 3, 1 - (row + 1) / 4, (col + 1) / 3, 1 - row / 4), xf(x, y, front - 0.0185));
    void k;
  });
  put("arcadeWhiteKey", keys, Matrix.Identity(), "Keypad");
  if (!ctx.mats.has("arcadeWhiteKey")) ctx.mats.pbr("arcadeWhiteKey", { color: "#d9d2c3", rough: 0.35 });
  put(M.keys, keyFaces, Matrix.Identity(), "Keypad", { castShadow: false });
  // coin slot plate, note acceptor with its green light, tap pad, coin return lever and cup
  put("chrome", softBox(0.06, 0.08, 0.012, 0.006), xf(0.287, 1.075, front - 0.006), "Coin slot");
  put("black", box(0.006, 0.034, 0.004), xf(0.287, 1.08, front - 0.0125), "Coin slot");
  put("black", softBox(0.075, 0.075, 0.03, 0.006), xf(0.385, 1.075, front - 0.012), "Note slot");
  put("chrome", box(0.058, 0.006, 0.004), xf(0.385, 1.09, front - 0.0275), "Note slot");
  put("mint", box(0.012, 0.006, 0.004), xf(0.405, 1.06, front - 0.0275), "Note slot", { castShadow: false });
  put("black", cylinder(0.028, 0.006, 24), xf(0.335, 0.94, front - 0.003, 0, 1, 1, 1, -Math.PI / 2), "Tap to pay");
  put("chrome", softBox(0.03, 0.022, 0.016, 0.005), xf(0.335, 0.87, front - 0.008), "Coin return");
  put("chrome", softBox(0.085, 0.07, 0.02, 0.008), xf(0.335, 0.765, front - 0.01), "Coin return");
  put("black", box(0.065, 0.045, 0.004), xf(0.335, 0.76, front - 0.0205), "Coin return");

  // ---- the mascot: a plush chimp sitting on top with a bag of banana chips, legs over the sign
  mascot(ctx, z, xf(0.27, H + 0.06, -0.2).multiply(m));
  // a pothos trailing over the cap's left front corner and down the side
  const r = rng(59);
  const world = (x: number, y: number, zz: number) => Vector3.TransformCoordinates(new Vector3(x, y, zz), m);
  vine(ctx, z, world(-W / 2 - 0.02, H + 0.06, -D / 2 + 0.06), 0.8, r, { leaf: 0.085, density: 12, drift: Vector3.TransformNormal(new Vector3(-0.08, 0, 0.05), m) });
  vine(ctx, z, world(-W / 2 - 0.03, H + 0.06, 0.1), 1.1, r, { leaf: 0.09, density: 10, drift: Vector3.TransformNormal(new Vector3(-0.06, 0, 0.1), m) });
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const p = world(-W / 2 + 0.06 + r() * 0.25, H + 0.065, -D / 2 + 0.08 + r() * 0.5);
    ctx.leaf(z, Leaf.Pothos, leafMatrix(p, Vector3.TransformNormal(new Vector3(Math.cos(a), 0.15, Math.sin(a)), m), 0.1, (r() - 0.5) * 1.2));
  }

  // the light inside the cabinet, at the top of the window, which spills a little out of the glass
  ctx.lights.push({ pos: Vector3.TransformCoordinates(new Vector3((win.x0 + win.x1) / 2, win.y1 - 0.12, glassZ + 0.08), m), color: "#f4fff6", day: 0.5, night: 1.3, range: 1.6, rooms: [z.room], level: z.level });

  // ---- what moves, by role: the machine, its coils, keys, display, bin and flap
  ctx.slot(z, ROLE.snackMachine, 1, m, new Vector3(0, 0, -0.75), label);
  ROWS.forEach((row, ri) => {
    for (let k = 1; k <= SNACK.lanes[ri]; k++) {
      ctx.slot(z, ROLE.snackCoil, (ri + 1) * 10 + k, xf(laneX(ri, k), trays[ri] + SNACK.coilR, coilZ).multiply(m), new Vector3(0, 0, -0.75), `Coil ${row}${k}`);
    }
  });
  SNACK_KEYS.forEach((k, i) => {
    const { x, y } = keyAt(i);
    ctx.slot(z, ROLE.snackKey, i + 1, xf(x, y, front - 0.0185).multiply(m), new Vector3(0, 0, -0.75), k);
  });
  ctx.slot(z, ROLE.snackBin, 1, xf((b.x0 + b.x1) / 2, b.floor, b.z).multiply(m), new Vector3(0, 0, -0.75), "Snack bin");
  ctx.screen(z, ROLE.snackDisplay, xf(cx, 1.5, front - 0.0165).multiply(m), 0.17, 0.075, displayMat(ctx), "Snack machine display");
  flap(ctx, z, m);
}

/** Where key i is on the keypad (the machine's frame). */
function keyAt(i: number): { x: number; y: number } {
  const cx = (COL.x0 + W_R) / 2;
  return { x: cx + ((i % 3) - 1) * 0.052, y: 1.3 + (1.5 - Math.floor(i / 3)) * 0.046 };
}
const W_R = SNACK.W / 2 - 0.035;

/** The display's material: what the engine paints on it, and before then a greeting. */
function displayMat(ctx: WorldCtx): string {
  const { canvas, ctx: c } = makeCanvas(512, 224);
  paintDisplay(c, "CHOOSE A SNACK", "TYPE A CODE, LIKE B3");
  return canvasMat(ctx, "snackDisplay", canvas, 1.2);
}

/** Paint the display: a line in big letters and one under it, green on black like an LCD. */
export function paintDisplay(c: Ctx, big: string, small: string): void {
  c.fillStyle = "#05140f";
  c.fillRect(0, 0, 512, 224);
  c.fillStyle = "rgba(111,240,191,0.06)";
  for (let y = 0; y < 224; y += 4) c.fillRect(0, y, 512, 2);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "#7dffc9";
  c.shadowColor = "#3dffa8";
  c.shadowBlur = 12;
  c.font = "800 64px Montserrat";
  c.fillText(big, 256, 88, 480);
  c.font = "700 34px Montserrat";
  c.fillStyle = "#c8ffe6";
  c.fillText(small, 256, 168, 480);
  c.shadowBlur = 0;
}

/**
 * The PUSH flap: smoked acrylic in the bin's opening, hinged at its top edge so it swings
 * in (rotation.x about its node). A mesh of its own with role "snack-flap".
 */
function flap(ctx: WorldCtx, z: Zone, m: Matrix): void {
  const b = SNACK.bin;
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const key = "snackFlap";
  if (!ctx.mats.has(key)) {
    const { canvas, ctx: c } = makeCanvas(512, 256);
    c.fillStyle = "rgba(20,30,30,0.72)";
    c.fillRect(0, 0, 512, 256);
    c.fillStyle = "rgba(255,233,201,0.95)";
    c.font = "900 92px Nunito";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("PUSH", 256, 136);
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.fillRect(0, 0, 512, 40);
    const tex = toTexture(ctx.scene, key, canvas, { wrap: false, hasAlpha: true });
    const mat = ctx.mats.pbr(key, { tex, rough: 0.12, clearCoat: 0.8 }) as PBRMaterial;
    mat.useAlphaFromAlbedoTexture = true;
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    mat.backFaceCulling = false;
    mat.albedoColor = Color3.White();
  }
  const g = new Geo().add(plane(w - 0.004, h - 0.004), xf(0, -h / 2, 0));
  const mesh = ctx.addMesh(g.build("Snack machine PUSH flap", ctx.scene), z, "PUSH flap", { castShadow: false });
  mesh.material = ctx.mats.get(key);
  const hinge = new TransformNode("Snack machine flap hinge", ctx.scene);
  const q = xf((b.x0 + b.x1) / 2, b.y1 - 0.002, SNACK.front + 0.006).multiply(m);
  q.decompose(hinge.scaling, undefined, hinge.position);
  hinge.rotationQuaternion = null;
  hinge.rotation.y = Math.atan2(-q.m[2], q.m[0]);
  mesh.parent = hinge;
  mesh.metadata = { ...(mesh.metadata as MeshMeta), role: ROLE.snackFlap, slot: 1 };
}

/** The plush chimp on top: sitting at m (its seat), legs hanging over the front edge, a bag in its hands. */
function mascot(ctx: WorldCtx, z: Zone, m: Matrix): void {
  const label = "Chimp Chomp's chimp";
  const fur = new Geo();
  const tan = new Geo();
  const dark = new Geo();
  // body and belly
  fur.add(sphere(0.11, 18, 14), xf(0, 0.13, 0, 0, 1, 1.25, 0.88));
  tan.add(sphere(0.075, 14, 10), xf(0, 0.12, -0.062, 0, 1, 1.2, 0.6));
  // head: skull, brow, ears, the face and muzzle, eyes
  fur.add(sphere(0.092, 18, 14), xf(0, 0.345, 0.005));
  fur.add(sphere(0.07, 14, 10), xf(0, 0.375, -0.035, 0, 1.15, 0.5, 0.8));
  for (const s of [-1, 1]) {
    fur.add(sphere(0.034, 10, 8), xf(s * 0.094, 0.35, 0.01, 0, 0.5, 1, 1));
    tan.add(sphere(0.024, 10, 8), xf(s * 0.1, 0.35, 0.005, 0, 0.4, 1, 1));
  }
  tan.add(sphere(0.064, 16, 12), xf(0, 0.345, -0.055, 0, 1.12, 0.95, 0.62));
  tan.add(sphere(0.052, 14, 10), xf(0, 0.305, -0.078, 0, 1.15, 0.78, 0.8));
  for (const s of [-1, 1]) {
    dark.add(sphere(0.0125, 10, 8), xf(s * 0.03, 0.36, -0.1));
    dark.add(sphere(0.006, 8, 6), xf(s * 0.011, 0.312, -0.12));
  }
  dark.add(torus(0.022, 0.0035, 16, 6), xf(0, 0.288, -0.112, 0, 1, 1, 0.5, Math.PI / 2 + 0.1));
  // arms reaching round the bag, plush and chunky
  for (const s of [-1, 1]) {
    fur.add(sphere(0.045, 12, 10), xf(s * 0.095, 0.225, 0));
    fur.add(tube([new Vector3(s * 0.1, 0.22, 0), new Vector3(s * 0.128, 0.14, -0.045), new Vector3(s * 0.07, 0.12, -0.125)], (t) => 0.042 - t * 0.008, 12, true));
    tan.add(sphere(0.036, 12, 10), xf(s * 0.062, 0.122, -0.132, 0, 1, 0.8, 1.1));
  }
  // legs: short thighs forward to the cap's front edge, then the shins hanging over the sign, big flat feet
  const edge = -(SNACK.D / 2 + 0.025) - -0.2;
  for (const s of [-1, 1]) {
    fur.add(tube([new Vector3(s * 0.062, 0.045, -0.02), new Vector3(s * 0.07, 0.04, edge + 0.025), new Vector3(s * 0.074, -0.01, edge - 0.03), new Vector3(s * 0.075, -0.115, edge - 0.04)], (t) => 0.05 - t * 0.01, 12, true));
    tan.add(sphere(0.042, 12, 10), xf(s * 0.078, -0.14, edge - 0.06, 0, 0.85, 0.6, 1.45));
  }
  ctx.g(z, "plushBrown").add(fur, m, label);
  ctx.g(z, "plushTan").add(tan, m, label);
  ctx.g(z, "black").add(dark, m, label);
  // a white glint in each eye
  for (const s of [-1, 1]) ctx.g(z, "white", { castShadow: false }).add(sphere(0.004, 6, 4), xf(s * 0.03 + 0.004, 0.366, -0.111).multiply(m), label);
  // the bag of banana chips it's holding, tipped toward the room
  const brand = snackBrand("jungleCrunch");
  ctx.g(z, packMat(ctx.mats, brand, false)).add(packGeo("bag"), xf(0, 0.15, -0.15, 0.15, 0.95, 0.95, 0.95, -0.25).multiply(m), label);
}

// ------------------------------------------------------------------ built at run time

/** The coils and the snacks on them, built at run time on the machine's slots (engine/snackMachine.ts). */
export interface SnackStockMeshes {
  /** one root at the machine; every matrix below is in its frame */
  root: TransformNode;
  /** every coil, a thin instance each, in the order of `coils` */
  coils: Mesh;
  /** a mesh per brand, its packs thin instances */
  packs: Map<string, Mesh>;
  meshes: Mesh[];
}

/**
 * Build the coils and a mesh per brand under a root at the machine's slot. The
 * engine places their thin instances (each coil's turn, each pack where it is).
 */
export function buildSnackStock(mats: Materials, machine: TransformNode, coilCount: number): SnackStockMeshes {
  const scene = mats.scene;
  const sm = machine.metadata as SlotMeta;
  const root = new TransformNode("Snack machine stock", scene);
  root.parent = machine;
  const meta = (label: string, matKey: string, role?: string): MeshMeta => ({ room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label }], matKey, kind: "moving", role });
  const setup = (mesh: Mesh, label: string, matKey: string, role?: string) => {
    mesh.parent = root;
    mesh.material = mats.get(matKey);
    mesh.metadata = meta(label, matKey, role);
    mesh.receiveShadows = true;
    mesh.renderingGroupId = 1;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  };
  const coils = setup(coilGeo().build("Snack machine coils", scene), "Snack coil", "steel", ROLE.snackCoils);
  coils.thinInstanceSetBuffer("matrix", new Float32Array(coilCount * 16), 16, false);
  const packs = new Map<string, Mesh>();
  const geos = new Map<PackKind, Geo>();
  for (const brand of SNACK_BRANDS) {
    let g = geos.get(brand.kind);
    if (!g) geos.set(brand.kind, (g = packGeo(brand.kind)));
    const mesh = setup(g.build(`Snack: ${brand.name.replace("\n", " ")}`, scene), `Snack: ${brand.name.replace("\n", " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase())}`, packMat(mats, brand), ROLE.snackPack);
    mesh.metadata = { ...(mesh.metadata as MeshMeta), slot: SNACK_BRANDS.indexOf(brand) + 1 };
    packs.set(brand.id, mesh);
  }
  return { root, coils, packs, meshes: [coils, ...packs.values()] };
}
