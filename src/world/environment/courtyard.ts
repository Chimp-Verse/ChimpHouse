// The front courtyard: a round paved court on the ridge in front of the stair, the fountain at
// its centre. Sandstone paving laid in rings round the basin (a dark collar at the basin, a
// teal mosaic band, radial strips to the gates and diagonals), an open ring to walk round
// the fountain, curved timber benches on the diagonals backing onto raised planters, a wide
// gate north to the stair (with an apron of flagstones up to its foot) and a narrower one
// south onto the approach path, lamp posts with woven globes at the gates and between them,
// and dense tropical beds round the outside so the court sits in the jungle.
//
// Everything solid (basin, benches, planters, posts) is merged geometry, so it blocks walking as
// the house's furniture does (engine/collision.ts); the water, its jets and its spray are built
// at run time on the fountain's slot (engine/fountain.ts).

import { Vector3 } from "@babylonjs/core";
import { WorldCtx, Zone, zone } from "../context";
import { P2, rng } from "../geometry/curves";
import { Geo, box, cylinder, fixWinding, lathe, polygonFace, sphere, torus, xf } from "../geometry/geo";
import { COURTYARD, FRONT_STAIR_FOOT_Z, courtyardDistance } from "../layout";
import { heightFromCanvas, makeCanvas, normalFromHeight, toTexture } from "../materials/canvas";
import { FOUNTAIN } from "../props/fountainSpec";
import { PlantKind, plant } from "../props/plants";
import { ROLE } from "../roles";
import { seatAt } from "../props/seats";
import { ledStrip } from "../structure/elements";
import { terrainHeight } from "./terrain";

const C = COURTYARD;
const Y = C.y;
const deg = (d: number) => (d * Math.PI) / 180;

/** Plan point at radius r and bearing a (radians from north, clockwise seen from above: +x is east). */
function P(r: number, a: number): P2 {
  return { x: C.cx + Math.sin(a) * r, z: C.cz + Math.cos(a) * r };
}

/** The gates: north to the stair, south to the approach path (bearings of the planters' ends). */
const NORTH_GATE = deg(31);
const SOUTH_GATE = deg(14);
/** The planters run between the gates, east and west: [from, to] bearings. */
const PLANTERS: [number, number][] = [
  [NORTH_GATE, Math.PI - SOUTH_GATE],
  [Math.PI + SOUTH_GATE, Math.PI * 2 - NORTH_GATE],
];
/** Planter walls: thickness and height above the paving; the soil's top. */
const WALL = 0.22;
const WALL_H = 0.5;
const SOIL = 0.43;
/** Benches: on the diagonals, backing onto the planters. */
const BENCH = { at: [45, 135, 225, 315].map(deg), span: deg(26), r0: 6.95, r1: 7.45, seat: 0.46 };
/** Lamp posts: in the planters' ends at the gates, and midway along each planter. */
const LAMPS: { a: number; light: boolean }[] = [
  { a: NORTH_GATE + deg(3), light: true },
  { a: -NORTH_GATE - deg(3), light: true },
  { a: Math.PI - SOUTH_GATE - deg(3.5), light: true },
  { a: Math.PI + SOUTH_GATE + deg(3.5), light: true },
  { a: deg(90), light: false },
  { a: deg(270), light: false },
];
const LAMP_R = (C.ring + WALL + C.r - WALL) / 2;

export function buildCourtyard(ctx: WorldCtx): void {
  const z = zone("courtyard", "site");
  const r = rng(1717);
  pavingMaterials(ctx);
  paving(ctx, z);
  fountainStone(ctx, z);
  planters(ctx, z, r);
  benches(ctx, z);
  lamps(ctx, z);
  beds(ctx, z, r);

  // the slots the client attaches to (roles.ts): the fountain's water, and where visitors arrive
  const fountain = ctx.slot(z, ROLE.fountain, 1, xf(C.cx, Y, C.cz), new Vector3(0, 0, -(C.basin + 1)), "Fountain");
  fountain.metadata = { ...fountain.metadata, fountain: FOUNTAIN };
  const s = C.spawn;
  // facing the house's front doors, past the fountain
  const yaw = Math.atan2(s.faces.x - s.x, s.faces.z - s.z);
  ctx.slot(z, ROLE.spawnPoint, 1, xf(s.x, Y, s.z, yaw + Math.PI), Vector3.Zero(), "Visitor arrival point");
  // at night: the lamps at the gates, and a cool light in the basin washing up the bowls and the spray
  ctx.lights.push({ pos: new Vector3(C.cx, Y + 0.75, C.cz), color: "#bdefff", day: 0, night: 1.6, range: 7, rooms: ["courtyard"], level: "lower" });
}

// ---------------------------------------------------------------- paving

/** The paving's rings, from the basin out (metres from the centre). The texture runs over PAVE_R0..C.r. */
const PAVE_R0 = 2.6;
const RINGS = {
  collar: [PAVE_R0, 3.25],
  inlay1: [3.25, 3.35],
  inner: [3.35, 4.55],
  mosaic: [4.55, 4.85],
  inlay2: [4.85, 4.95],
  outer: [4.95, 7.35],
  border: [7.35, 7.7],
  under: [7.7, C.r],
};
/** The radial strips' half-width; the texture is one eighth of the circle, a strip on its seam. */
const STRIP = 0.22;
const SECTOR = Math.PI / 4;

/** Sandstone, a stone at a time: cream with a little warmth and the odd darker one. */
function stoneColour(r: () => number): string {
  const k = r();
  const base = k < 0.12 ? [196, 178, 143] : k < 0.3 ? [222, 206, 172] : [214, 198, 163];
  const v = (r() - 0.5) * 14;
  return `rgb(${Math.round(base[0] + v)},${Math.round(base[1] + v * 0.95)},${Math.round(base[2] + v * 0.85)})`;
}

/** Speckle a canvas region (grain in the stone). */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const r = rng(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.9;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * The court's paving, drawn in polar form: across is one eighth of the way round (the strip on
 * its seam, so it repeats round the circle), down is the radius from PAVE_R0 out to the edge.
 * Albedo and height are drawn with the same shapes; the normal map comes from the height.
 */
function polarPaving(): { albedo: HTMLCanvasElement; normal: HTMLCanvasElement } {
  const W = 1024;
  const H = 1024;
  const a = makeCanvas(W, H);
  const h = makeCanvas(W, H);
  const A = a.ctx;
  const Hc = h.ctx;
  const span = C.r - PAVE_R0;
  const yOf = (rad: number) => ((rad - PAVE_R0) / span) * H;
  /** pixels across per metre of arc at radius rad */
  const pxPerM = (rad: number) => W / (rad * SECTOR);
  const r = rng(91);
  const joint = "#7d705c";
  A.fillStyle = joint;
  A.fillRect(0, 0, W, H);
  Hc.fillStyle = "#282828";
  Hc.fillRect(0, 0, W, H);

  /** a ring of stones between radii r0 and r1, n stones an eighth, staggered by `shift` (0..1 of a stone) */
  const course = (r0: number, r1: number, n: number, shift: number, colour: () => string, from = 0, to = 1) => {
    const y0 = yOf(r0);
    const y1 = yOf(r1);
    const jy = Math.max(1.2, (0.007 / span) * H);
    const step = (to - from) / n;
    for (let k = -1; k <= n; k++) {
      let u0 = from + (k + shift) * step;
      let u1 = u0 + step;
      u0 = Math.max(from, u0);
      u1 = Math.min(to, u1);
      if (u1 - u0 < 1e-4) continue;
      const jx = Math.max(1.2, 0.007 * pxPerM((r0 + r1) / 2));
      A.fillStyle = colour();
      A.fillRect(u0 * W + jx / 2, y0 + jy / 2, (u1 - u0) * W - jx, y1 - y0 - jy);
      const g = 190 + Math.round(r() * 40);
      Hc.fillStyle = `rgb(${g},${g},${g})`;
      Hc.fillRect(u0 * W + jx / 2, y0 + jy / 2, (u1 - u0) * W - jx, y1 - y0 - jy);
    }
  };
  /** courses of sandstone filling r0..r1, each `depth` deep, stones about `len` long */
  const courses = (r0: number, r1: number, depth: number, len: number) => {
    const n = Math.max(1, Math.round((r1 - r0) / depth));
    const d = (r1 - r0) / n;
    for (let i = 0; i < n; i++) {
      const ra = r0 + i * d;
      const rb = ra + d;
      const arc = ((ra + rb) / 2) * SECTOR;
      const stones = Math.max(2, Math.round(arc / len));
      course(ra, rb, stones, i % 2 ? 0.5 : 0, () => stoneColour(r));
    }
  };
  const slate = () => {
    const v = Math.round((r() - 0.5) * 12);
    return `rgb(${74 + v},${77 + v},${74 + v})`;
  };
  const cream = () => "#efe4cc";
  course(RINGS.collar[0], RINGS.collar[1], 5, 0.5, slate);
  course(RINGS.inlay1[0], RINGS.inlay1[1], 8, 0, cream);
  courses(RINGS.inner[0], RINGS.inner[1], 0.4, 0.62);
  course(RINGS.inlay2[0], RINGS.inlay2[1], 12, 0.5, cream);
  courses(RINGS.outer[0], RINGS.outer[1], 0.4, 0.62);
  course(RINGS.border[0], RINGS.border[1], 14, 0.5, slate);
  courses(RINGS.under[0], RINGS.under[1], 0.38, 0.62);

  // the radial strips on the seam, from the inlay out: darker stone in blocks along them
  const stripAt = (rad: number) => (STRIP * pxPerM(rad)) / W;
  const block = 0.42;
  for (let ra = RINGS.inlay1[1]; ra < C.r - 1e-3; ra += block) {
    const rb = Math.min(C.r, ra + block);
    if (rb > RINGS.mosaic[0] && ra < RINGS.mosaic[1]) continue;
    const v = Math.round((r() - 0.5) * 14);
    const col = `rgb(${150 + v},${132 + v},${104 + v})`;
    for (const side of [0, 1]) {
      const y0 = yOf(ra) + 0.8;
      const y1 = yOf(rb) - 0.8;
      const w0 = stripAt(ra) * W;
      const w1 = stripAt(rb) * W;
      const x = (wid: number) => (side ? W - wid : 0);
      const path = (c: CanvasRenderingContext2D) => {
        c.beginPath();
        if (side) {
          c.moveTo(W, y0);
          c.lineTo(W - w0 + 1.2, y0);
          c.lineTo(W - w1 + 1.2, y1);
          c.lineTo(W, y1);
        } else {
          c.moveTo(0, y0);
          c.lineTo(w0 - 1.2, y0);
          c.lineTo(w1 - 1.2, y1);
          c.lineTo(0, y1);
        }
        c.closePath();
      };
      // the strip's joint first, a little wider
      A.fillStyle = joint;
      A.fillRect(x(w0 + 2), y0 - 1, w0 + 2, y1 - y0 + 2);
      Hc.fillStyle = "#282828";
      Hc.fillRect(x(w0 + 2), y0 - 1, w0 + 2, y1 - y0 + 2);
      path(A);
      A.fillStyle = col;
      A.fill();
      path(Hc);
      Hc.fillStyle = "#d2d2d2";
      Hc.fill();
    }
  }

  // the mosaic band: small teal and green-blue glass tiles, a pale grout
  {
    const [m0, m1] = RINGS.mosaic;
    const rows = 5;
    const teal = ["#2b8f88", "#3aa99b", "#1f716d", "#4cbcae", "#2a8079", "#5fc8b8"];
    for (let i = 0; i < rows; i++) {
      const ra = m0 + ((m1 - m0) * i) / rows;
      const rb = m0 + ((m1 - m0) * (i + 1)) / rows;
      const n = Math.round((((ra + rb) / 2) * SECTOR) / 0.06);
      const y0 = yOf(ra);
      const y1 = yOf(rb);
      A.fillStyle = "#cfe3dc";
      A.fillRect(0, y0, W, y1 - y0);
      Hc.fillStyle = "#909090";
      Hc.fillRect(0, y0, W, y1 - y0);
      for (let k = 0; k < n; k++) {
        const u0 = k / n;
        const u1 = (k + 1) / n;
        A.fillStyle = teal[Math.floor(r() * teal.length)];
        A.fillRect(u0 * W + 0.6, y0 + 0.6, (u1 - u0) * W - 1.2, y1 - y0 - 1.2);
        Hc.fillStyle = "#d8d8d8";
        Hc.fillRect(u0 * W + 0.6, y0 + 0.6, (u1 - u0) * W - 1.2, y1 - y0 - 1.2);
      }
    }
  }
  grain(A, W, H, 16, 5);
  Hc.filter = "blur(1.2px)";
  Hc.drawImage(h.canvas, 0, 0);
  Hc.filter = "none";
  const normal = normalFromHeight(heightFromCanvas(Hc, W, H), W, H, 2.2);
  return { albedo: a.canvas, normal };
}

/** Rectangular flagstones in running bond, the same sandstone: the apron up to the stair, `metres` a tile. */
function flagstones(metres: number): { albedo: HTMLCanvasElement; normal: HTMLCanvasElement } {
  const S = 512;
  const a = makeCanvas(S, S);
  const h = makeCanvas(S, S);
  const r = rng(404);
  const px = S / metres;
  a.ctx.fillStyle = "#7d705c";
  a.ctx.fillRect(0, 0, S, S);
  h.ctx.fillStyle = "#282828";
  h.ctx.fillRect(0, 0, S, S);
  const rows = Math.round(metres / 0.4);
  const cols = Math.round(metres / 0.6);
  const rh = S / rows;
  const cw = S / cols;
  const j = Math.max(1.5, 0.007 * px);
  for (let i = 0; i < rows; i++) {
    const off = i % 2 ? cw / 2 : 0;
    for (let k = -1; k < cols; k++) {
      const x = k * cw + off;
      a.ctx.fillStyle = stoneColour(r);
      a.ctx.fillRect(x + j / 2, i * rh + j / 2, cw - j, rh - j);
      const g = 190 + Math.round(r() * 40);
      h.ctx.fillStyle = `rgb(${g},${g},${g})`;
      h.ctx.fillRect(x + j / 2, i * rh + j / 2, cw - j, rh - j);
    }
  }
  grain(a.ctx, S, S, 16, 9);
  h.ctx.filter = "blur(1px)";
  h.ctx.drawImage(h.canvas, 0, 0);
  h.ctx.filter = "none";
  return { albedo: a.canvas, normal: normalFromHeight(heightFromCanvas(h.ctx, S, S), S, S, 2.2) };
}

const FLAG_TILE = 2.4;

function pavingMaterials(ctx: WorldCtx): void {
  const s = ctx.scene;
  const m = ctx.mats;
  if (m.has("courtyardPaving")) return;
  const polar = polarPaving();
  const albedo = toTexture(s, "courtyardPaving", polar.albedo);
  const normal = toTexture(s, "courtyardPavingN", polar.normal, { linear: true });
  m.decal("courtyardPaving", albedo, { rough: 0.78, bump: normal });
  const flags = flagstones(FLAG_TILE);
  m.decal("courtyardFlags", toTexture(s, "courtyardFlags", flags.albedo), { rough: 0.8, bump: toTexture(s, "courtyardFlagsN", flags.normal, { linear: true }) });
}

function paving(ctx: WorldCtx, z: Zone): void {
  // the court: rings of vertices round the centre, u one eighth of the way round, v out along the radius
  const g = new Geo();
  const segs = 256;
  const radii: number[] = [];
  for (let rad = PAVE_R0; rad < C.r - 1e-3; rad += 0.35) radii.push(rad);
  radii.push(C.r);
  const rows: number[][] = [];
  for (const rad of radii) {
    const row: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const p = P(rad, a);
      row.push(g.vert(p.x, Y, p.z, a / SECTOR, (rad - PAVE_R0) / (C.r - PAVE_R0), 0, 1, 0));
    }
    rows.push(row);
  }
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < segs; i++) g.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
  fixWinding(g);
  ctx.g(z, "courtyardPaving", { castShadow: false }).add(g, undefined, "Courtyard paving");

  // the apron of flagstones from the north gate up to the stair's foot
  const edgeA = Math.asin(C.northHalf / C.r);
  const apron: P2[] = [
    { x: C.cx - C.northHalf, z: FRONT_STAIR_FOOT_Z - 0.005 },
    { x: C.cx - C.northHalf, z: P(C.r, -edgeA).z },
  ];
  for (let i = 0; i <= 24; i++) apron.push(P(C.r, -edgeA + (2 * edgeA * i) / 24));
  apron.push({ x: C.cx + C.northHalf, z: FRONT_STAIR_FOOT_Z - 0.005 });
  ctx.g(z, "courtyardFlags", { castShadow: false }).add(polygonFace(apron, Y, true, [], 1 / FLAG_TILE), undefined, "Flagstone apron");

  // the paving's edge: a stone face down to the ground round the court and the apron's sides
  // (in the planter walls' bucket: one mesh for both)
  const kerb = ctx.g(z, "stepStone");
  kerb.setLabel("Paving edge");
  const ring: Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const p = P(C.r, (i / segs) * Math.PI * 2);
    ring.push(new Vector3(p.x, Y, p.z));
  }
  kerb.add(edgeFace(ring, 0.25, true));
  for (const sx of [-1, 1]) {
    const x = C.cx + sx * C.northHalf;
    const a = new Vector3(x, Y, FRONT_STAIR_FOOT_Z);
    const b = new Vector3(x, Y, P(C.r, edgeA).z);
    kerb.add(edgeFace(sx > 0 ? [a, b] : [b, a], 0.25, false));
  }
}

/** A vertical face hanging `drop` below a path, facing outwards (to the right of travel for clockwise rings). */
function edgeFace(path: Vector3[], drop: number, ringOut: boolean): Geo {
  const g = new Geo();
  let s = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const t = b.subtract(a);
    const len = t.length();
    let n = new Vector3(t.z, 0, -t.x).normalize();
    if (ringOut) {
      const mid = a.add(b).scale(0.5);
      const out = new Vector3(mid.x - C.cx, 0, mid.z - C.cz);
      if (Vector3.Dot(out, n) < 0) n = n.scale(-1);
    }
    const v0 = g.vert(a.x, a.y, a.z, s, 0, n.x, 0, n.z);
    const v1 = g.vert(b.x, b.y, b.z, s + len, 0, n.x, 0, n.z);
    const v2 = g.vert(b.x, b.y - drop, b.z, s + len, drop, n.x, 0, n.z);
    const v3 = g.vert(a.x, a.y - drop, a.z, s, drop, n.x, 0, n.z);
    g.quad(v0, v1, v2, v3);
    s += len;
  }
  return fixWinding(g);
}

// ---------------------------------------------------------------- the fountain's stone

function fountainStone(ctx: WorldCtx, z: Zone): void {
  const F = FOUNTAIN;
  const m = xf(C.cx, Y, C.cz);
  const B = F.basin;
  const segs = 96;
  // the basin's wall, the coping over it (overhanging, the mint light tucked under), its tiled inside
  ctx.g(z, "stoneWhite").add(lathe([[B.r - 0.06, -0.2], [B.r - 0.06, B.rim - 0.09]], segs, false, false, 2 * Math.PI * B.r), m, "Fountain basin");
  ctx.g(z, "coping").add(
    lathe(
      [
        [B.r - 0.06, B.rim - 0.09],
        [B.r + 0.02, B.rim - 0.09],
        [B.r + 0.02, B.rim - 0.03],
        [B.r, B.rim],
        [B.inner + 0.03, B.rim],
        [B.inner, B.rim - 0.03],
        [B.inner, B.rim - 0.09],
      ],
      segs,
      false,
      false,
      2 * Math.PI * B.r,
    ),
    m,
    "Fountain basin coping",
  );
  ctx.g(z, "poolTile", { castShadow: false }).add(
    lathe([[B.inner, B.rim - 0.09], [B.inner, 0.06], [B.inner - 0.06, 0.04], [0.5, 0.04]], segs, false, false, 2 * Math.PI * B.inner),
    m,
    "Fountain basin",
  );
  ctx.g(z, "mint", { castShadow: false }).add(torus(B.r - 0.045, 0.016, segs, 6), xf(C.cx, Y + B.rim - 0.115, C.cz), "Fountain basin light");
  // the pedestal and its two bowls, one lathe up from the basin's floor
  const [low, top] = F.bowls;
  ctx.g(z, "stoneWhite").add(
    lathe(
      [
        [0.58, 0.04],
        [0.58, 0.16],
        [0.48, 0.2],
        [0.34, 0.26],
        [0.24, 0.36],
        [0.19, 0.5],
        [0.19, 0.74],
        [0.26, 0.8],
        [0.55, 0.88],
        [0.86, 0.95],
        [low.r, low.lip - 0.05],
        [low.r, low.lip],
        [low.inner + 0.02, low.lip],
        [low.inner, low.water - 0.03],
        [0.18, low.water - 0.07],
        [0.13, low.water - 0.05],
        [0.12, top.lip - 0.3],
        [0.17, top.lip - 0.25],
        [0.34, top.lip - 0.15],
        [top.r, top.lip - 0.04],
        [top.r, top.lip],
        [top.inner + 0.02, top.lip],
        [top.inner, top.water - 0.03],
        [0.05, top.water - 0.05],
      ],
      64,
      false,
      false,
      4,
    ),
    m,
    "Fountain",
  );
  // the jet's nozzle, and the arcs' round the coping
  const brass = ctx.g(z, "brass", { castShadow: false });
  brass.setLabel("Fountain nozzle");
  brass.add(cylinder(0.07, 0.05, 14), xf(C.cx, Y + top.water - 0.05, C.cz));
  brass.add(cylinder(0.035, F.jet.at[1] - top.water + 0.04, 10, true, 0.022), xf(C.cx, Y + top.water - 0.02, C.cz));
  for (let i = 0; i < F.arcs.count; i++) {
    const a = F.arcs.turn + (i / F.arcs.count) * Math.PI * 2;
    const p = P(F.arcs.from.r, a);
    brass.add(cylinder(0.05, 0.02, 12), xf(p.x, Y + B.rim, p.z));
    brass.add(cylinder(0.026, F.arcs.from.y - B.rim, 8, true, 0.018), xf(p.x, Y + B.rim + 0.01, p.z, a, 1, 1, 1, -0.5));
  }
}

// ---------------------------------------------------------------- planters, benches, lamps

/** A closed annular block between radii r0 and r1, bearings a0..a1, heights y0..y1 (above the paving). */
function ringBlock(r0: number, r1: number, a0: number, a1: number, y0: number, y1: number, faces: { top?: boolean; inner?: boolean; outer?: boolean; ends?: boolean } = {}): Geo {
  const { top = true, inner = true, outer = true, ends = true } = faces;
  const g = new Geo();
  const n = Math.max(2, Math.ceil(((a1 - a0) * r1) / 0.3));
  const A = (i: number) => a0 + ((a1 - a0) * i) / n;
  const yy0 = Y + y0;
  const yy1 = Y + y1;
  if (top) {
    const rows = [r0, r1].map((rad) =>
      Array.from({ length: n + 1 }, (_, i) => {
        const p = P(rad, A(i));
        return g.vert(p.x, yy1, p.z, p.x, p.z, 0, 1, 0);
      }),
    );
    for (let i = 0; i < n; i++) g.quad(rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]);
  }
  for (const [rad, out, on] of [
    [r0, -1, inner],
    [r1, 1, outer],
  ] as [number, number, boolean][]) {
    if (!on) continue;
    const lo: number[] = [];
    const hi: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = A(i);
      const p = P(rad, a);
      const nx = Math.sin(a) * out;
      const nz = Math.cos(a) * out;
      lo.push(g.vert(p.x, yy0, p.z, a * rad, y0, nx, 0, nz));
      hi.push(g.vert(p.x, yy1, p.z, a * rad, y1, nx, 0, nz));
    }
    for (let i = 0; i < n; i++) g.quad(lo[i], lo[i + 1], hi[i + 1], hi[i]);
  }
  if (ends)
    for (const [a, s] of [
      [a0, -1],
      [a1, 1],
    ]) {
      const nx = Math.cos(a) * s;
      const nz = -Math.sin(a) * s;
      const p0 = P(r0, a);
      const p1 = P(r1, a);
      const v = [g.vert(p0.x, yy0, p0.z, 0, y0, nx, 0, nz), g.vert(p1.x, yy0, p1.z, r1 - r0, y0, nx, 0, nz), g.vert(p1.x, yy1, p1.z, r1 - r0, y1, nx, 0, nz), g.vert(p0.x, yy1, p0.z, 0, y1, nx, 0, nz)];
      g.quad(v[0], v[1], v[2], v[3]);
    }
  return fixWinding(g);
}

/** Plan points along an arc at radius rad from bearing a0 to a1. */
function arcPath(rad: number, a0: number, a1: number, step = 0.4): P2[] {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * rad) / step));
  return Array.from({ length: n + 1 }, (_, i) => P(rad, a0 + ((a1 - a0) * i) / n));
}

function planters(ctx: WorldCtx, z: Zone, r: () => number): void {
  const stone = ctx.g(z, "stepStone");
  const cap = ctx.g(z, "glulam");
  const soil = ctx.g(z, "soil", { castShadow: false });
  const r0 = C.ring;
  const r1 = C.r;
  // full-leaved kinds, so the planting covers the soil (the beds round the court have the same kinds: no extra leaf meshes)
  const kinds: PlantKind[] = ["fern", "bromeliad", "calathea", "philodendron", "cordyline", "fern", "calathea"];
  for (const [a0, a1] of PLANTERS) {
    stone.setLabel("Planter wall");
    // inner and outer walls (the outer reaching down past the ground's edge), and their ends
    stone.add(ringBlock(r0, r0 + WALL, a0, a1, 0, WALL_H - 0.06));
    stone.add(ringBlock(r1 - WALL, r1, a0, a1, -0.25, WALL_H - 0.06));
    stone.add(ringBlock(r0 + WALL, r1 - WALL, a0, a0 + 0.22 / r0, 0, WALL_H - 0.06, { top: false, inner: false, outer: false }));
    stone.add(ringBlock(r0 + WALL, r1 - WALL, a1 - 0.22 / r0, a1, 0, WALL_H - 0.06, { top: false, inner: false, outer: false }));
    // timber caps, a touch proud of the stone, as the stair's cheek walls are capped
    cap.setLabel("Planter cap");
    cap.add(ringBlock(r0 - 0.03, r0 + WALL + 0.03, a0 - 0.03 / r0, a1 + 0.03 / r0, WALL_H - 0.06, WALL_H));
    cap.add(ringBlock(r1 - WALL - 0.03, r1 + 0.03, a0 - 0.03 / r1, a1 + 0.03 / r1, WALL_H - 0.06, WALL_H));
    for (const a of [a0, a1]) {
      const s = a === a0 ? 1 : -1;
      cap.add(ringBlock(r0 + WALL, r1 - WALL, Math.min(a, a + (s * 0.25) / r0), Math.max(a, a + (s * 0.25) / r0), WALL_H - 0.06, WALL_H));
    }
    soil.add(ringBlock(r0 + WALL, r1 - WALL, a0 + 0.2 / r0, a1 - 0.2 / r0, 0, SOIL, { inner: false, outer: false, ends: false }), undefined, "Planter");
    // low tropical planting, its leaves spilling over the outer walls' caps but kept within the
    // inner caps (none reach over the court's walkway); a taller accent between the bench and the lamp
    ctx.withFence([arcPath(r0 + 0.02, a0, a1), arcPath(r1 + 0.12, a0, a1)], () => {
      const palms = [a0 + (a1 - a0) * 0.27, a0 + (a1 - a0) * 0.73];
      // three staggered rows, close enough that the leaves meet over the soil
      const rows = [r0 + WALL + 0.3, (r0 + r1) / 2, r1 - WALL - 0.3];
      rows.forEach((rad, row) => {
        const n = Math.floor(((a1 - a0 - 0.12) * rad) / 0.5);
        for (let i = 0; i <= n; i++) {
          const a = a0 + 0.06 + ((a1 - a0 - 0.12) * (i + (row % 2 ? 0.5 : 0))) / (n + 0.5);
          if (LAMPS.some((l) => Math.abs(angleDiff(l.a, a)) * rad < 0.45)) continue;
          if (row === 1 && palms.some((pa) => Math.abs(angleDiff(pa, a)) * rad < 0.5)) continue;
          const p = P(rad + (r() - 0.5) * 0.12, a);
          // the front row lower, so the planting steps up to the back
          const s = row === 0 ? 0.85 + r() * 0.25 : 1.0 + r() * 0.35;
          plant(ctx, z, new Vector3(p.x, Y + SOIL, p.z), kinds[Math.floor(r() * kinds.length)], s, r, "Planter");
        }
      });
      for (const a of palms) {
        const p = P((r0 + r1) / 2, a);
        plant(ctx, z, new Vector3(p.x, Y + SOIL, p.z), "palm", 1.15, r, "Planter", 0.7);
      }
    });
  }
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function benches(ctx: WorldCtx, z: Zone): void {
  const timber = ctx.g(z, "timber");
  const plinth = ctx.g(z, "stoneWhite");
  const b = BENCH;
  for (const mid of b.at) {
    const a0 = mid - b.span / 2;
    const a1 = mid + b.span / 2;
    timber.setLabel("Courtyard bench");
    // five curved boards for the seat, and two for the back against the planter
    const boards = 5;
    const w = (b.r1 - b.r0) / boards;
    for (let i = 0; i < boards; i++) timber.add(ringBlock(b.r0 + i * w + 0.01, b.r0 + (i + 1) * w - 0.01, a0, a1, b.seat - 0.05, b.seat));
    for (const y of [0.62, 0.78]) timber.add(ringBlock(b.r1 - 0.02, b.r1 + 0.04, a0 + 0.01, a1 - 0.01, y, y + 0.12));
    // stone plinths under it, with timber uprights for the back
    plinth.setLabel("Courtyard bench");
    for (const k of [-0.4, 0, 0.4]) {
      const a = mid + (b.span / 2) * k * 2;
      const da = 0.08 / b.r0;
      plinth.add(ringBlock(b.r0 + 0.06, b.r1 - 0.02, a - da, a + da, 0, b.seat - 0.05));
      timber.add(ringBlock(b.r1 + 0.04, b.r1 + 0.1, a - 0.05 / b.r1, a + 0.05 / b.r1, b.seat - 0.05, 0.92));
    }
    // a warm strip under the seat's front edge, lighting the paving at night
    const strip = arcPath(b.r0 + 0.05, a0 + 0.02, a1 - 0.02, 0.3).map((p) => new Vector3(p.x, Y + b.seat - 0.07, p.z));
    ledStrip(ctx, z, strip, "amberStrip", 0.022);
    // three places to sit along it, backs to the planter, facing the fountain
    for (const k of [-1, 0, 1]) {
      const a = mid + k * (1.0 / b.r1);
      const p = P(b.r1 - 0.24, a);
      seatAt(ctx, z, p.x, Y + b.seat, p.z, Math.atan2(Math.sin(a), Math.cos(a)), { kind: "bench", height: b.seat, recline: 0.1, legs: "down" }, "Courtyard bench");
    }
  }
}

function lamps(ctx: WorldCtx, z: Zone): void {
  for (const l of LAMPS) {
    const p = P(LAMP_R, l.a);
    const base = Y + SOIL;
    const h = 2.55;
    const label = "Courtyard lamp";
    ctx.g(z, "stoneWhite").add(box(0.34, WALL_H - SOIL + 0.12, 0.34), xf(p.x, base + (WALL_H - SOIL + 0.12) / 2, p.z, l.a), label);
    ctx.g(z, "glulam").add(box(0.15, h, 0.15), xf(p.x, base + h / 2, p.z, l.a), label);
    const brass = ctx.g(z, "brass", { castShadow: false });
    brass.add(cylinder(0.1, 0.06, 12), xf(p.x, base + h, p.z), label);
    const c = new Vector3(p.x, base + h + 0.3, p.z);
    ctx.g(z, "lattice", { castShadow: false }).add(sphere(0.24, 20, 12, 1.12), xf(c.x, c.y, c.z), label);
    ctx.g(z, "bulb", { castShadow: false }).add(sphere(0.12, 12, 8), xf(c.x, c.y, c.z), label);
    brass.add(cylinder(0.07, 0.05, 10), xf(c.x, c.y + 0.25, c.z), label);
    if (l.light) ctx.lights.push({ pos: c, color: "#ffb35e", day: 0, night: 4.2, range: 12, rooms: ["courtyard"], level: "lower" });
  }
}

// ---------------------------------------------------------------- the jungle round it

function beds(ctx: WorldCtx, z: Zone, r: () => number): void {
  const kinds: PlantKind[] = ["monstera", "elephant", "banana", "philodendron", "cordyline", "fern", "croton", "palm", "monstera", "calathea"];
  // their leaves stay off the paving: the court's edge and the apron's sides
  const apronEnd = P(C.r, Math.asin(C.northHalf / C.r)).z;
  const side = (sx: number) => [
    { x: C.cx + sx * (C.northHalf + 0.05), z: FRONT_STAIR_FOOT_Z + 0.3 },
    { x: C.cx + sx * (C.northHalf + 0.05), z: apronEnd - 0.3 },
  ];
  const fence = [arcPath(C.r + 0.05, 0, Math.PI * 2, 0.5), side(-1), side(1)];
  const at = (p: P2) => new Vector3(p.x, terrainHeight(p.x, p.z), p.z);
  ctx.withFence(fence, () => {
    // a clipped edge of low planting where the paving meets the beds in the open (the apron's
    // sides, and the court's edge between the apron and the planters' ends), so it ends tidily
    const edging: P2[] = [];
    for (const sx of [-1, 1]) {
      for (let zz = apronEnd + 0.2; zz < FRONT_STAIR_FOOT_Z - 0.1; zz += 0.62) edging.push({ x: C.cx + sx * (C.northHalf + 0.5), z: zz });
      const a0 = Math.asin((C.northHalf + 0.5) / (C.r + 0.5));
      for (const p of arcPath(C.r + 0.5, a0, NORTH_GATE + deg(6), 0.62)) edging.push({ x: C.cx + sx * (p.x - C.cx), z: p.z });
    }
    edging.forEach((p, i) => plant(ctx, z, at(p), i % 2 ? "calathea" : "bromeliad", 0.8 + r() * 0.12, r, "Courtyard border"));
    // behind it, dense jungle planting stepping up away from the paving
    for (let x = C.cx - 15.5; x <= C.cx + 15.5; x += 1.05) {
      for (let zz = C.cz - 14; zz <= FRONT_STAIR_FOOT_Z + 1; zz += 1.05) {
        const p = { x: x + (r() - 0.5) * 0.6, z: zz + (r() - 0.5) * 0.6 };
        const d = courtyardDistance(p.x, p.z);
        if (d < 1.1 || Math.hypot(p.x - C.cx, p.z - C.cz) > C.r + 4.6) continue;
        // the approach path south stays open
        if (p.z < C.cz - C.r + 0.5 && Math.abs(p.x - C.cx) < C.southHalf + 0.9) continue;
        if (Math.abs(p.x) > 15) continue;
        if (r() > 0.9) continue;
        const near = d < 2.2;
        const k = near ? (["fern", "calathea", "philodendron", "croton"] as PlantKind[])[Math.floor(r() * 4)] : kinds[Math.floor(r() * kinds.length)];
        plant(ctx, z, at(p), k, near ? 0.9 + r() * 0.4 : 1.1 + r() * 0.8, r, "Courtyard border");
      }
    }
  });
}
