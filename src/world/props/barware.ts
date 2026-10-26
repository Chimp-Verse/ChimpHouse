// Bar and café pieces shared by the Arrival Lounge bar and the Canopy Bar:
// bottles, jars, glasses, taps, an espresso machine, menu cards, lit wall
// niches, plus the hanging egg chair and slatted side table.

import { Matrix, Vector3 } from "@babylonjs/core";
import { P2, resample } from "../geometry/curves";
import { Geo, at, beam, box, cylinder, lathe, plane, softBox, sphere, tube, xf } from "../geometry/geo";
import { WorldCtx, Zone } from "../context";
import { seat } from "./seats";
import { makeCanvas, toTexture } from "../materials/canvas";
import { Rand, pottedPlant, vine } from "./plants";

/** World position of a point given in an object's local frame. */
const pt = (m: Matrix, x: number, y: number, z: number) => Vector3.TransformCoordinates(new Vector3(x, y, z), m);

/** Materials the bar pieces use (created once). */
export function ensureBarMats(ctx: WorldCtx): void {
  const m = ctx.mats;
  if (m.has("fridgeGlow")) return;
  const add = (key: string, o: Parameters<typeof m.pbr>[1]) => {
    if (!m.has(key)) m.pbr(key, o);
  };
  add("bottleAmber", { color: "#9a4a12", rough: 0.08, alpha: 0.85 });
  add("bottleGreen", { color: "#2f5a2a", rough: 0.08, alpha: 0.85 });
  add("bottleClear", { color: "#d8e8e0", rough: 0.05, alpha: 0.5 });
  add("ceramicSage", { color: "#9fb39a", rough: 0.4 });
  add("orange", { color: "#f08a24", rough: 0.5 });
  add("juice", { color: "#ff9a2e", rough: 0.1, emissive: "#ff7a1a", emissiveIntensity: 0.2 });
  add("cake", { color: "#f3dfc0", rough: 0.8 });
  add("cakeBerry", { color: "#a3283c", rough: 0.6 });
  add("cookie", { color: "#a86b32", rough: 0.9 });
  add("coffeeBean", { color: "#3b2416", rough: 0.6 });
  add("paper", { color: "#efe9dc", rough: 0.9 });
  add("fridgeGlow", { color: "#e8f0f4", emissive: "#d8ecff", emissiveIntensity: 0.55, rough: 0.3 });
}

/** Plan path offset sideways, on the same side as a sweep's +lateral (the bartender's side of the bar). */
export function offsetPlan(plan: P2[], d: number): P2[] {
  return plan.map((p, i) => {
    const a = plan[Math.max(0, i - 1)];
    const b = plan[Math.min(plan.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    return { x: p.x + (tz / l) * d, z: p.z - (tx / l) * d };
  });
}

export function ledAlong(ctx: WorldCtx, z: Zone, plan: P2[], d: number, y: number, mat: string, label: string) {
  ctx.g(z, mat, { castShadow: false }).add(beam(at(resample(offsetPlan(plan, d), 0.1), y), 0.022, 0.018), undefined, label);
}

/** Beer and juice tap tower facing the bartender (+Z). Base at m on the counter. */
export function tapTower(ctx: WorldCtx, z: Zone, m: Matrix) {
  ensureBarMats(ctx);
  const g = new Geo();
  g.add(cylinder(0.045, 0.4, 14));
  g.add(box(0.52, 0.08, 0.08), xf(0, 0.42, 0));
  for (const x of [-0.17, 0, 0.17]) g.add(cylinder(0.012, 0.09, 8), xf(x, 0.3, 0.07));
  ctx.g(z, "brass").add(g, m, "Tap tower");
  const handles = ["tealBright", "mustard", "coral"];
  [-0.17, 0, 0.17].forEach((x, i) => ctx.g(z, handles[i]).add(box(0.03, 0.14, 0.03), xf(x, 0.53, 0.02).multiply(m), "Tap handle"));
  ctx.g(z, "steel").add(box(0.5, 0.02, 0.14), xf(0, 0.01, 0.1).multiply(m), "Drip tray");
}

/** Two-group espresso machine, front facing -Z. Base at m. */
export function espressoMachine(ctx: WorldCtx, z: Zone, m: Matrix) {
  ensureBarMats(ctx);
  ctx.g(z, "steel").add(softBox(0.72, 0.42, 0.48, 0.03), xf(0, 0.21, 0).multiply(m), "Espresso machine");
  ctx.g(z, "steel").add(box(0.66, 0.02, 0.18), xf(0, 0.04, -0.3).multiply(m), "Espresso machine");
  const black = new Geo();
  for (const s of [-1, 1]) {
    black.add(cylinder(0.045, 0.06, 14), xf(s * 0.17, 0.22, -0.26));
    black.add(box(0.03, 0.03, 0.16), xf(s * 0.17, 0.2, -0.36));
    black.add(cylinder(0.028, 0.006, 12), xf(s * 0.3, 0.33, -0.245, 0, 1, 1, 1, Math.PI / 2));
  }
  ctx.g(z, "black").add(black, m, "Espresso machine");
  for (let i = 0; i < 6; i++) ctx.g(z, "cream", { castShadow: false }).add(cylinder(0.035, 0.07, 10), xf(-0.22 + (i % 3) * 0.1, 0.42, -0.05 + Math.floor(i / 3) * 0.1).multiply(m), "Cups");
}

export function cakeStand(ctx: WorldCtx, z: Zone, p: Vector3) {
  ensureBarMats(ctx);
  ctx.g(z, "potCream").add(lathe([[0.001, 0], [0.07, 0], [0.03, 0.02], [0.025, 0.1], [0.15, 0.11], [0.15, 0.125], [0.001, 0.125]], 24), xf(p.x, p.y, p.z), "Cake stand");
  ctx.g(z, "cake").add(cylinder(0.11, 0.08, 20), xf(p.x, p.y + 0.125, p.z), "Cake");
  ctx.g(z, "cakeBerry").add(cylinder(0.112, 0.015, 20), xf(p.x, p.y + 0.205, p.z), "Cake");
  const dome: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    dome.push([Math.max(0.01, Math.cos(a) * 0.15), 0.125 + Math.sin(a) * 0.17]);
  }
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(lathe(dome, 24), xf(p.x, p.y, p.z), "Cake dome");
  ctx.g(z, "brass").add(sphere(0.015, 8, 6), xf(p.x, p.y + 0.305, p.z));
}

export function jar(ctx: WorldCtx, z: Zone, p: Vector3, rad: number, h: number, fill: string) {
  ensureBarMats(ctx);
  if (!ctx.mats.has("coffeeBean")) ctx.mats.pbr("coffeeBean", { color: "#3b2416", rough: 0.6 });
  ctx.g(z, fill, { castShadow: false }).add(cylinder(rad - 0.01, h * 0.7, 12), xf(p.x, p.y + 0.005, p.z), "Jar");
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(cylinder(rad, h, 14, false), xf(p.x, p.y, p.z), "Jar");
  ctx.g(z, "timber").add(cylinder(rad + 0.004, 0.03, 14), xf(p.x, p.y + h, p.z), "Jar");
}

export function juiceGlass(ctx: WorldCtx, z: Zone, p: Vector3) {
  ensureBarMats(ctx);
  ctx.g(z, "juice", { castShadow: false }).add(cylinder(0.03, 0.11, 10), xf(p.x, p.y + 0.004, p.z), "Juice");
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(cylinder(0.034, 0.13, 12, false), xf(p.x, p.y, p.z), "Juice");
}

export function bottle(ctx: WorldCtx, z: Zone, m: Matrix, mat: string, h: number, label: string) {
  ensureBarMats(ctx);
  const prof: [number, number][] = [
    [0.001, 0],
    [0.036, 0.0],
    [0.038, h * 0.62],
    [0.015, h * 0.8],
    [0.013, h],
    [0.001, h],
  ];
  ctx.g(z, mat, { castShadow: false }).add(lathe(prof, 10), m, label);
  ctx.g(z, "paper", { castShadow: false }).add(cylinder(0.0385, h * 0.22, 10, false), xf(0, h * 0.22, 0).multiply(m), label);
}

export function menuStand(ctx: WorldCtx, z: Zone, m: Matrix) {
  ensureBarMats(ctx);
  if (!ctx.mats.has("loungeMenu")) {
    const { canvas, ctx: g } = makeCanvas(256, 360);
    g.fillStyle = "#f3ead8";
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = "#2a2018";
    g.textAlign = "center";
    g.font = "700 30px Montserrat";
    g.fillText("MENU", 128, 52);
    g.font = "500 19px Montserrat";
    const items = ["Banana Smoothie", "Jungle Cold Brew", "Flat White", "Mango Juice", "Coconut Water", "Canopy Cake"];
    items.forEach((t, i) => g.fillText(t, 128, 104 + i * 42));
    g.strokeStyle = "#2fbf8f";
    g.lineWidth = 4;
    g.strokeRect(10, 10, 236, 340);
    ctx.mats.pbr("loungeMenu", { tex: toTexture(ctx.scene, "loungeMenu", canvas, { wrap: false }), rough: 0.8 });
  }
  ctx.g(z, "timberDark").add(box(0.13, 0.02, 0.07), m, "Menu stand");
  ctx.g(z, "loungeMenu", { castShadow: false }).add(plane(0.11, 0.155, true), xf(0, 0.09, 0, 0, 1, 1, 1, 0.15).multiply(m), "Menu");
}

/**
 * Lit wall niche above the back bar: timber frame, dark back, three shelves of
 * bottles, jars, cups and trailing plants. Centred on x against the wall at wz;
 * o.floor is the floor level, o.y0 and o.h the niche's bottom and height above it.
 */
export function barNiche(ctx: WorldCtx, z: Zone, x: number, wz: number, w: number, r: Rand, variant: number, o: { floor?: number; y0?: number; h?: number } = {}) {
  ensureBarMats(ctx);
  const y0 = o.y0 ?? 1.35;
  const h = o.h ?? 1.6;
  const d = 0.32;
  const m = xf(x, o.floor ?? 0, wz - d / 2);
  const frame = new Geo();
  for (const s of [-1, 1]) frame.add(box(0.05, h, d), xf(s * (w / 2 - 0.025), y0 + h / 2, 0));
  frame.add(box(w, 0.06, d), xf(0, y0 + h - 0.03, 0));
  frame.add(box(w, 0.06, d), xf(0, y0 + 0.03, 0));
  ctx.g(z, "timberDark").add(frame, m, "Bar niche");
  ctx.g(z, "panelDark").add(box(w - 0.1, h - 0.12, 0.02), xf(0, y0 + h / 2, d / 2 - 0.02).multiply(m), "Bar niche");
  const ys = [y0 + 0.06, y0 + h * 0.375, y0 + h * 0.67];
  const boards = new Geo();
  const strips = new Geo();
  for (const y of ys.slice(1)) boards.add(box(w - 0.1, 0.035, d - 0.04), xf(0, y - 0.0175, 0));
  for (const y of [...ys.slice(1), y0 + h - 0.06]) strips.add(box(w - 0.16, 0.012, 0.02), xf(0, y - 0.045, -d / 2 + 0.05));
  ctx.g(z, "timber").add(boards, m, "Bar niche");
  ctx.g(z, "amberStrip", { castShadow: false }).add(strips, m, "Niche light");
  const mats = ["bottleAmber", "bottleGreen", "bottleClear"];
  ys.forEach((y, row) => {
    let lx = -w / 2 + 0.12;
    const kind = (row + variant) % 3;
    while (lx < w / 2 - 0.12) {
      const roll = r();
      if (kind === 0 || roll < 0.25) {
        bottle(ctx, z, xf(lx, y, 0.02).multiply(m), mats[Math.floor(r() * 3)], 0.26 + r() * 0.1, "Bottles");
        lx += 0.1;
      } else if (kind === 1) {
        if (roll < 0.5) {
          for (let k = 0; k < 3; k++) ctx.g(z, k % 2 ? "cream" : "tealBright", { castShadow: false }).add(cylinder(0.04, 0.085, 10), xf(lx, y + k * 0.085, 0.02).multiply(m), "Cups");
          lx += 0.14;
        } else {
          jar(ctx, z, pt(m, lx, y, 0.02), 0.06, 0.18, r() > 0.5 ? "coffeeBean" : "cookie");
          lx += 0.16;
        }
      } else {
        if (roll < 0.55) {
          const p = pt(m, lx + 0.03, y, 0.03);
          pottedPlant(ctx, z, p, r() > 0.5 ? "philodendron" : "fern", { pot: r() > 0.5 ? "terracotta" : "cream", potR: 0.07, potH: 0.11, scale: 0.3, r });
          vine(ctx, z, pt(m, lx + 0.03, y + 0.11, -0.06), 0.25 + r() * 0.3, r, { leaf: 0.055, density: 22 });
          lx += 0.22;
        } else {
          ctx.g(z, "ceramicSage").add(lathe([[0.05, 0], [0.07, 0.08], [0.045, 0.17], [0.03, 0.2]], 14), xf(lx, y, 0.02).multiply(m), "Ceramic jug");
          lx += 0.17;
        }
      }
    }
  });
}

/** Black slatted drum side table, as in the concept render. Base at p. */
export function slattedSideTable(ctx: WorldCtx, z: Zone, p: Vector3) {
  const g = new Geo();
  g.add(cylinder(0.21, 0.03, 20), xf(0, 0.49, 0));
  g.add(cylinder(0.2, 0.03, 20));
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    g.add(box(0.025, 0.46, 0.02), xf(Math.cos(a) * 0.19, 0.26, Math.sin(a) * 0.19, -a));
  }
  ctx.g(z, "charcoal").add(g, xf(p.x, p.y, p.z), "Slatted side table");
}

/**
 * Rattan egg chair hanging from the ceiling on a chain: woven shell with an
 * oval opening facing `yaw`, and a teal seat cushion. Base point p on the floor.
 *
 * Sized for chimps: the hood over the seat is taller than the bowl under it (an egg, its tall
 * end up), so a big chimp's head (a cap on it too) is under it, clear of the rim, as it sits back
 * into it and as it gets up; the opening is wide enough for its elbows and its lip low enough for
 * the legs to hang out over it: it is cut down below the cushion, as a real egg chair's is.
 */
export function eggChair(ctx: WorldCtx, z: Zone, p: Vector3, yaw: number, r: Rand, ceil: number) {
  ensureBarMats(ctx);
  const hc = 1.12; // shell centre height (its widest)
  const ax = 0.56;
  const az = 0.5;
  // the bowl's depth under the centre, the hood's height over it, and between them a smooth change
  const ayB = 0.7;
  const ayT = 1.1;
  const ayAt = (v: number) => {
    const t = Math.min(1, Math.max(0, (v + 0.25) / 0.6));
    return ayB + (ayT - ayB) * t * t * (3 - 2 * t);
  };
  // the opening: across (u, from the front) and from its lip to its top (v, elevation)
  const uOpen = 1.15;
  const vLo = -0.85;
  const vHi = 1.2;
  const m = xf(p.x, p.y + hc, p.z, yaw);
  const shell = (s: number) => {
    const g = new Geo();
    const nu = 40;
    const nv = 24;
    const open = (u: number, v: number) => {
      // u: angle around (0 = front, local -Z); v: elevation
      const du = Math.atan2(Math.sin(u), Math.cos(u));
      return Math.abs(du) < uOpen && v > vLo && v < vHi;
    };
    const idx: number[][] = [];
    for (let i = 0; i <= nu; i++) {
      const row: number[] = [];
      const u = (i / nu) * Math.PI * 2;
      for (let j = 0; j <= nv; j++) {
        const v = -Math.PI / 2 + (j / nv) * Math.PI;
        const x = Math.sin(u) * Math.cos(v) * ax * s;
        const y = Math.sin(v) * ayAt(v) * s;
        const zz = -Math.cos(u) * Math.cos(v) * az * s;
        row.push(g.vert(x, y, zz, (i / nu) * 4, (j / nv) * 3));
      }
      idx.push(row);
    }
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const u = ((i + 0.5) / nu) * Math.PI * 2;
        const v = -Math.PI / 2 + ((j + 0.5) / nv) * Math.PI;
        if (open(u, v)) continue;
        g.quad(idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]);
      }
    return g.computeNormals();
  };
  const outer = shell(1);
  ctx.g(z, "lattice").add(outer, m, "Hanging egg chair");
  ctx.g(z, "jute").add(shell(0.95).flip(), m, "Hanging egg chair");
  // rim around the opening
  const rim: Vector3[] = [];
  for (let k = 0; k <= 48; k++) {
    const t = (k / 48) * Math.PI * 2;
    const u = Math.sin(t) * uOpen;
    const v = (vLo + vHi) / 2 + Math.cos(t) * ((vHi - vLo) / 2);
    rim.push(new Vector3(Math.sin(u) * Math.cos(v) * ax * 0.975, Math.sin(v) * ayAt(v) * 0.975, -Math.cos(u) * Math.cos(v) * az * 0.975));
  }
  ctx.g(z, "timber").add(tube(rim, 0.025, 8, false), m, "Hanging egg chair");
  // seat and back cushions
  const cush = ["tealBright", "mustard", "coral"][Math.floor(r() * 3)];
  ctx.g(z, cush).add(softBox(0.68, 0.16, 0.5, 0.07, 0.04), xf(0, -0.38, -0.02).multiply(m), "Egg chair cushion");
  ctx.g(z, "cream").add(softBox(0.5, 0.4, 0.12, 0.06, 0.05), xf(0, -0.05, 0.27, 0, 1, 1, 1, -0.25).multiply(m), "Egg chair cushion");
  // on the seat cushion, the feet hanging clear of the floor
  seat(ctx, z, xf(0, -0.3, 0.04).multiply(m), { kind: "eggChair", height: hc - 0.3, recline: 0.2, legs: "down", from: "front" }, "Hanging egg chair");
  // chain to the ceiling
  ctx.g(z, "black").add(cylinder(0.012, ceil - (p.y + hc + ayT), 6, false), xf(p.x, p.y + hc + ayT - 0.02, p.z), "Egg chair chain");
  ctx.g(z, "black").add(cylinder(0.06, 0.03, 12), xf(p.x, ceil - 0.03, p.z));
}

/** Soda can (red, teal or gold) standing at p. */
export function sodaCan(ctx: WorldCtx, z: Zone, p: Vector3, r: () => number) {
  if (!ctx.mats.has("can:red")) {
    ctx.mats.pbr("can:red", { color: "#c8142c", rough: 0.28, metal: 0.65, clearCoat: 0.6 });
    ctx.mats.pbr("can:teal", { color: "#16a39a", rough: 0.28, metal: 0.65, clearCoat: 0.6 });
    ctx.mats.pbr("can:gold", { color: "#e2a62c", rough: 0.28, metal: 0.65, clearCoat: 0.6 });
  }
  const mat = ["can:red", "can:teal", "can:gold"][Math.floor(r() * 3)];
  ctx.g(z, mat, { castShadow: false }).add(
    lathe([[0.001, 0], [0.027, 0], [0.033, 0.012], [0.033, 0.104], [0.027, 0.118], [0.001, 0.118]], 16, false, false, 1),
    xf(p.x, p.y, p.z),
    "Soda can",
  );
  ctx.g(z, "steel", { castShadow: false }).add(cylinder(0.026, 0.004, 14), xf(p.x, p.y + 0.116, p.z), "Soda can");
  ctx.g(z, "chrome", { castShadow: false }).add(box(0.02, 0.003, 0.012), xf(p.x + 0.008, p.y + 0.121, p.z, r() * Math.PI));
  ctx.g(z, "white", { castShadow: false }).add(cylinder(0.0335, 0.03, 16, false), xf(p.x, p.y + 0.05, p.z), "Soda can");
}
