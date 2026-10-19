// Furniture: modular curved sofas, cushions, poufs, slatted drum tables,
// stools, armchairs, loungers, rugs, shelving, counters.

import { Matrix, Vector3 } from "@babylonjs/core";
import { P2, pathLength, pointAt, resample } from "../geometry/curves";
import { Geo, at, beam, box, cylinder, disc, fixWinding, lathe, softBox, sweep, torus, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { yawAlong } from "../structure/elements";

export type Rand = () => number;

/** Frame at distance s along a plan path: position + yaw so local +X runs along the path and -Z faces the path's left side. */
function frameAt(path: P2[], s: number): { p: P2; yaw: number } {
  const len = pathLength(path);
  const a = pointAt(path, Math.max(0, s - 0.05));
  const b = pointAt(path, Math.min(len, s + 0.05));
  return { p: pointAt(path, s), yaw: yawAlong({ x: b.x - a.x, z: b.z - a.z }) };
}

/**
 * Modular sofa along a plan path. The seat faces the LEFT of the travel
 * direction (back cushions on the right). Cushion colours cycle.
 */
export function sofa(
  ctx: WorldCtx,
  z: Zone,
  path: P2[],
  o: { mat?: string; baseMat?: string; y?: number; depth?: number; seatH?: number; backH?: number; pillows?: string[]; r: Rand; label?: string; arms?: boolean; module?: number },
): void {
  const { mat = "teal", baseMat = mat, y = 0, depth = 0.95, backH = 0.86, r, label = "Curved sofa", arms = true, module = 0.95 } = o;
  const len = pathLength(path);
  const n = Math.max(1, Math.round(len / module));
  const seg = len / n;
  const g = ctx.g(z, mat);
  g.setLabel(label);
  // continuous plinth following the path
  const back = resample(path, 0.15);
  const plinth = ctx.g(z, baseMat);
  const prof: [number, number][] = [
    [depth / 2 - 0.02, 0],
    [depth / 2, 0.2],
    [-depth / 2, 0.2],
    [-depth / 2 + 0.02, 0],
  ];
  plinth.add(sweep(prof, at(back, y + 0.02), { caps: true }), undefined, label);
  // back rail
  plinth.add(sweep([[depth / 2, 0], [depth / 2, backH - 0.2], [depth / 2 - 0.2, backH - 0.2], [depth / 2 - 0.2, 0]], at(back, y + 0.2), { caps: true }));
  // local frame: +X along the path, -Z = back (right of travel), +Z = front
  for (let i = 0; i < n; i++) {
    const f = frameAt(path, (i + 0.5) * seg);
    const m = xf(f.p.x, 0, f.p.z, f.yaw);
    const local = new Geo();
    local.add(softBox(seg - 0.03, 0.2, depth - 0.24, 0.07, 0.025), xf(0, y + 0.31, 0.06));
    local.add(softBox(seg - 0.05, 0.46, 0.22, 0.09, 0.03), xf(0, y + 0.62, -(depth / 2 - 0.21), 0, 1, 1, 1, -0.12));
    g.add(local, m);
  }
  if (arms) {
    for (const end of [0, len]) {
      const f = frameAt(path, end);
      g.add(softBox(0.24, 0.62, depth, 0.08, 0.02), xf(f.p.x, y + 0.31, f.p.z, f.yaw), label);
    }
  }
  // throw pillows leaning on the back cushions
  const pillows = o.pillows ?? ["mustard", "rust", "teal", "mustard", "coral"];
  const count = Math.max(1, Math.round(len / 0.75));
  for (let i = 0; i < count; i++) {
    if (r() > 0.85) continue;
    const s = ((i + 0.5) / count) * len;
    const f = frameAt(path, s);
    const pm = pillows[Math.floor(r() * pillows.length)];
    const local = xf(0, y + 0.66, -(depth / 2 - 0.4), (r() - 0.5) * 0.3, 1, 1, 1, -0.3 + (r() - 0.5) * 0.2, (r() - 0.5) * 0.4);
    ctx.g(z, pm).add(softBox(0.46, 0.44, 0.14, 0.06, 0.05), local.multiply(xf(f.p.x, 0, f.p.z, f.yaw)), "Cushion");
  }
}

/** Round pouf. */
export function pouf(ctx: WorldCtx, z: Zone, pos: Vector3, r: number, h: number, mat: string, label = "Pouf"): void {
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = t * Math.PI;
    const bulge = Math.sin(a) * 0.08;
    prof.push([r * (0.88 + bulge) * (i === 0 || i === 10 ? 0.92 : 1), h * (0.5 - Math.cos(a) * 0.5)]);
  }
  prof[0] = [0.001, 0];
  prof.splice(1, 0, [r * 0.85, 0.005]);
  prof.push([0.001, h]);
  ctx.g(z, mat).add(lathe(prof, 28), xf(pos.x, pos.y, pos.z), label);
}

/** Drum coffee table with vertical slats (panel texture) and round top. */
export function drumTable(ctx: WorldCtx, z: Zone, pos: Vector3, r: number, h: number, o: { top?: string; side?: string; label?: string } = {}): void {
  const label = o.label ?? "Round timber table";
  ctx.g(z, o.side ?? "panelHoney").add(lathe([[r * 0.97, 0], [r * 0.97, h - 0.05]], 32, false, false, Math.round(2 * Math.PI * r / 1)), xf(pos.x, pos.y, pos.z), label);
  ctx.g(z, o.top ?? "timber").add(cylinder(r, 0.06, 32), xf(pos.x, pos.y + h - 0.06, pos.z), label);
}

/** Bar/counter stool: upholstered round seat, timber legs, footrest ring. */
export function stool(ctx: WorldCtx, z: Zone, pos: Vector3, h: number, seatMat: string, label = "Stool"): void {
  const legs = ctx.g(z, "timber");
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const top = pos.add(new Vector3(Math.cos(a) * 0.13, h - 0.06, Math.sin(a) * 0.13));
    const bot = pos.add(new Vector3(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2));
    legs.add(beam([bot, top], 0.035, 0.035), undefined, label);
  }
  legs.add(torus(0.17, 0.012, 20, 5), xf(pos.x, pos.y + h * 0.33, pos.z));
  ctx.g(z, seatMat).add(softBox(0.4, 0.1, 0.4, 0.05, 0.02), xf(pos.x, pos.y + h - 0.02, pos.z), label);
  ctx.g(z, seatMat).add(cylinder(0.2, 0.08, 20), xf(pos.x, pos.y + h - 0.09, pos.z));
}

/** Rounded tub armchair facing -Z in local space. */
export function armchair(ctx: WorldCtx, z: Zone, pos: Vector3, yaw: number, mat: string, pillow?: string): void {
  const m = xf(pos.x, pos.y, pos.z, yaw);
  const g = new Geo();
  g.add(softBox(0.8, 0.42, 0.78, 0.14, 0.03), xf(0, 0.21, 0));
  // curved back shell
  const shell = sweep(
    [
      [0.0, 0],
      [0.16, 0],
      [0.16, 0.42],
      [0.0, 0.42],
    ],
    resample(
      Array.from({ length: 13 }, (_, i) => {
        const a = Math.PI * (0.05 + (i / 12) * 0.9);
        return { x: Math.cos(a) * 0.4, z: Math.sin(a) * 0.38 };
      }),
      0.06,
    ).map((p) => new Vector3(-p.x, 0.4, p.z)),
    { caps: true, smooth: true },
  );
  g.add(shell);
  g.add(softBox(0.62, 0.14, 0.58, 0.06, 0.03), xf(0, 0.48, -0.04));
  ctx.g(z, mat).add(g, m, "Armchair");
  if (pillow) ctx.g(z, pillow).add(softBox(0.42, 0.38, 0.13, 0.05, 0.04), xf(0, 0.72, 0.18, 0, 1, 1, 1, 0.3).multiply(m), "Cushion");
}

/** Round woven rug with its own texture material. */
export function roundRug(ctx: WorldCtx, z: Zone, pos: Vector3, r: number, matKey: string, label = "Woven rug"): void {
  ctx.g(z, matKey, { castShadow: false }).add(disc(r, 64), xf(pos.x, pos.y + 0.008, pos.z), label);
  ctx.g(z, matKey, { castShadow: false }).add(lathe([[r, 0], [r + 0.01, 0.004], [r, 0.008]], 64), xf(pos.x, pos.y, pos.z));
}

export function rectRug(ctx: WorldCtx, z: Zone, pos: Vector3, w: number, d: number, yaw: number, matKey: string, label = "Rug"): void {
  const g = new Geo();
  const a = g.vert(-w / 2, 0, -d / 2, 0, 0, 0, 1, 0);
  const b = g.vert(w / 2, 0, -d / 2, 1, 0, 0, 1, 0);
  const c = g.vert(w / 2, 0, d / 2, 1, 1, 0, 1, 0);
  const e = g.vert(-w / 2, 0, d / 2, 0, 1, 0, 1, 0);
  g.tri(a, e, c);
  g.tri(a, c, b);
  fixWinding(g);
  ctx.g(z, matKey, { castShadow: false }).add(g, xf(pos.x, pos.y + 0.008, pos.z, yaw), label);
}

/**
 * Teak sun lounger. Local frame: the foot points along -Z (the way the person
 * looks), the backrest rises toward +Z. 2.0 m long, 0.72 m wide, seat 0.32 m.
 */
export function lounger(ctx: WorldCtx, z: Zone, pos: Vector3, yaw: number, o: { towel?: string } = {}): void {
  const m = xf(pos.x, pos.y, pos.z, yaw);
  const h = 0.32; // top of the seat slats
  const zf = -1.0; // foot end
  const zh = 0.28; // backrest hinge
  const bl = 0.72; // backrest length
  const th = (40 * Math.PI) / 180;
  const dir = new Vector3(0, Math.sin(th), Math.cos(th)); // up the backrest
  const nrm = new Vector3(0, Math.cos(th), -Math.sin(th)); // out of the backrest, toward the sitter
  const onBack = (d: number, out: number) => new Vector3(0, h, zh).add(dir.scale(d)).add(nrm.scale(out));
  const frame = new Geo();
  // side rails, end rails, legs and head-end wheels
  for (const sx of [-0.34, 0.34]) {
    frame.add(box(0.05, 0.09, 1.66), xf(sx, h - 0.055, -0.19));
    for (const lz of [-0.92, 0.52]) frame.add(box(0.055, h - 0.1, 0.055), xf(sx, (h - 0.1) / 2, lz));
  }
  frame.add(box(0.73, 0.09, 0.05), xf(0, h - 0.055, zf - 0.02));
  frame.add(box(0.73, 0.09, 0.05), xf(0, h - 0.055, 0.64));
  // seat slats across the frame
  for (let zz = zf + 0.04; zz < zh - 0.03; zz += 0.095) frame.add(box(0.66, 0.025, 0.07), xf(0, h - 0.0125, zz));
  // backrest: inclined stiles and slats, propped on a strut
  for (const sx of [-0.31, 0.31]) {
    const a = onBack(0, -0.03);
    const b = onBack(bl, -0.03);
    frame.add(beam([a.add(new Vector3(sx, 0, 0)), b.add(new Vector3(sx, 0, 0))], 0.04, 0.05));
  }
  for (let d = 0.06; d < bl - 0.02; d += 0.095) {
    const p = onBack(d, -0.0125);
    frame.add(box(0.6, 0.025, 0.07), xf(p.x, p.y, p.z, 0, 1, 1, 1, -th));
  }
  for (const sx of [-0.24, 0.24]) {
    const top = onBack(0.46, -0.05).add(new Vector3(sx, 0, 0));
    frame.add(beam([top, new Vector3(sx, h - 0.07, 0.5)], 0.035, 0.035));
  }
  frame.add(box(0.5, 0.035, 0.035), xf(0, h - 0.07, 0.5));
  ctx.g(z, "timber").add(frame, m, "Sun lounger");
  const wheels = new Geo();
  for (const sx of [-0.4, 0.4]) wheels.add(cylinder(0.065, 0.04, 16), xf(sx + (sx > 0 ? -0.02 : 0.02), 0.065, 0.56, 0, 1, 1, 1, 0, Math.PI / 2));
  ctx.g(z, "charcoal").add(wheels, m, "Sun lounger wheel");
  // two-part cushion following the seat and the raised backrest, with a headrest pillow
  const cush = new Geo();
  cush.add(softBox(0.62, 0.075, 1.24, 0.03, 0.008), xf(0, h + 0.0375, (zf + zh) / 2 - 0.01));
  const bc = onBack(bl / 2 + 0.01, 0.0375);
  cush.add(softBox(0.62, 0.075, 0.7, 0.03, 0.008), xf(bc.x, bc.y, bc.z, 0, 1, 1, 1, -th));
  const pc = onBack(bl - 0.17, 0.13);
  cush.add(softBox(0.42, 0.1, 0.22, 0.045, 0.03), xf(pc.x, pc.y, pc.z, 0, 1, 1, 1, -th));
  ctx.g(z, "cream").add(cush, m, "Lounger cushion");
  if (o.towel) ctx.g(z, o.towel).add(cylinder(0.055, 0.52, 16), xf(-0.26, h + 0.075 + 0.055, zf + 0.2, 0, 1, 1, 1, 0, -Math.PI / 2).multiply(m), "Rolled towel");
}

/** Wall shelving unit with warm under-shelf strips. Local: back on +Z, facing -Z. */
export function shelves(ctx: WorldCtx, z: Zone, m: Matrix, w: number, h: number, rows: number, o: { depth?: number; mat?: string; strips?: boolean } = {}): number[] {
  const depth = o.depth ?? 0.3;
  const g = new Geo();
  const ys: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const y = (i / rows) * h;
    g.add(box(w, 0.04, depth), xf(0, y, 0));
    ys.push(y);
  }
  g.add(box(0.04, h, depth), xf(-w / 2, h / 2, 0));
  g.add(box(0.04, h, depth), xf(w / 2, h / 2, 0));
  ctx.g(z, o.mat ?? "timber").add(g, m, "Shelving");
  if (o.strips !== false) {
    const s = new Geo();
    for (let i = 1; i <= rows; i++) s.add(box(w - 0.1, 0.012, 0.02), xf(0, (i / rows) * h - 0.025, -depth / 2 + 0.03));
    ctx.g(z, "amberStrip", { castShadow: false }).add(s, m, "Shelf light");
  }
  return ys;
}

/** Books, plants, mugs, jars on shelves. */
export function shelfDecor(ctx: WorldCtx, z: Zone, m: Matrix, w: number, ys: number[], r: Rand, o: { books?: boolean; plants?: boolean } = {}): void {
  const colors = ["mustard", "rust", "teal", "cream", "sage", "tealDeep", "coral"];
  for (const y of ys.slice(0, -1)) {
    let x = -w / 2 + 0.08;
    while (x < w / 2 - 0.15) {
      const kind = r();
      if (kind < 0.45 && o.books !== false) {
        const n = 3 + Math.floor(r() * 6);
        for (let i = 0; i < n && x < w / 2 - 0.08; i++) {
          const bh = 0.18 + r() * 0.08;
          const bw = 0.025 + r() * 0.02;
          ctx.g(z, colors[Math.floor(r() * colors.length)], { castShadow: false }).add(box(bw, bh, 0.16), xf(x + bw / 2, y + 0.02 + bh / 2, 0, 0, 1, 1, 1, 0, (r() - 0.5) * 0.08).multiply(m), "Books");
          x += bw + 0.004;
        }
        x += 0.08;
      } else if (kind < 0.75) {
        const pr = 0.06 + r() * 0.03;
        ctx.g(z, r() > 0.5 ? "potCream" : "terracotta").add(cylinder(pr, pr * 1.6, 12, true, pr * 1.1), xf(x + pr, y + 0.02, 0).multiply(m), "Shelf plant");
        x += pr * 2 + 0.1;
      } else {
        ctx.g(z, r() > 0.5 ? "cream" : "tealBright").add(cylinder(0.04, 0.09, 10), xf(x + 0.05, y + 0.02, 0).multiply(m), "Mug");
        x += 0.16;
      }
    }
  }
}

export { disc };
