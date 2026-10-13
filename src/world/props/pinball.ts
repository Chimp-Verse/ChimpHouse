// A pinball machine, as real ones are built: the cabinet on four legs with its
// lockdown bar, flipper buttons, plunger, start button and coin door; under the
// glass the playfield with its inlanes and outlanes, slingshots, pop bumpers,
// ramps, targets, lamps and the shooter lane; and the backbox with its lit
// backglass and dot-matrix display. What is under the glass comes from the
// table's definition (pinballTables.ts), which the physics reads too.
//
// The cabinet and everything fixed are merged into the room like the rest of
// the house. The parts that move (the flippers, ball, plunger, spinner, drop
// targets and the lamps) are built at run time on the machine's playfield node
// (role pinball-machine), as the arcade cabinets are on their slots.
//
// Local frame: base at m, the player at -Z. The cabinet leans back at the
// playfield's 6.5°; the playfield frame has x across, y out of the playfield and
// z up it, so a playfield point (x, y, h) of the table is (x, h, y) there.

import { Matrix, Mesh, Quaternion, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import { Geo, beam, box, cylinder, floorQuad, lathe, plane, slab, sphere, sweep, torus, tube, xf } from "../geometry/geo";
import { ensureCCW } from "../geometry/curves";
import { MeshMeta, SlotMeta, WorldCtx, Zone } from "../context";
import { makeCanvas, toTexture } from "../materials/canvas";
import { Materials } from "../materials/library";
import { ROLE } from "../roles";
import { canvasMat } from "./tech";
import { LAMP_CELL, LAMP_COLS, apronCanvas, backglassCanvas, lampAtlas, playfieldCanvas, sideCanvas } from "./pinballArt";
import { Flipper, PF, TableDef, V2, rampCurve, tableName } from "./pinballTables";

/** The cabinet: outside width, length and side height; the front legs; where the playfield and glass sit in it. */
export const CAB = { w: 0.6, l: 1.4, h: 0.36, legs: 0.56, z0: -0.7, pfY: 0.245, pfZ: 0.075, glassY: 0.345 } as const;
/** The backbox: width, height and depth. */
const BOX = { w: 0.62, h: 0.8, d: 0.26 } as const;
/** The dot-matrix display's size in the backbox. */
export const DMD_SIZE = { w: 0.32, h: 0.08 } as const;

/** The cabinet's frame in the machine's space: origin at its front bottom edge, leaning back. */
export function cabinetFrame(): Matrix {
  return xf(0, CAB.legs, CAB.z0, 0, 1, 1, 1, -PF.slope);
}

/** The playfield's frame in the machine's space: x across, y out of the playfield, z up it from its front edge. */
export function playfieldFrame(): Matrix {
  return xf(0, CAB.pfY, CAB.pfZ).multiply(cabinetFrame());
}

/** Where a player stands to play, on the floor in the machine's space. */
export const STAND = new Vector3(0, 0, CAB.z0 - 0.42);

const p3 = ([x, y]: V2, h = 0) => new Vector3(x, h, y);
const loop = (pts: V2[]) => ensureCCW(pts.map(([x, y]) => ({ x, z: y })));

/** Per-table materials, made once. */
function tableMats(ctx: WorldCtx, def: TableDef) {
  const k = (s: string) => `pin${def.slot}:${s}`;
  const t = def.theme;
  const pbr = (key: string, o: Parameters<typeof ctx.mats.pbr>[1]) => {
    if (!ctx.mats.has(key)) ctx.mats.pbr(key, o);
    return key;
  };
  const tex = (key: string, canvas: HTMLCanvasElement, o: Parameters<typeof ctx.mats.pbr>[1] = {}) => {
    if (!ctx.mats.has(key)) ctx.mats.pbr(key, { ...o, tex: toTexture(ctx.scene, key, canvas, { wrap: false }) });
    return key;
  };
  const field = k("field");
  if (!ctx.mats.has(field)) {
    // the playfield glows a little of its own: the lamps under its plastics (GI)
    const ft = toTexture(ctx.scene, field, playfieldCanvas(def), { wrap: false, aniso: 16 });
    ctx.mats.pbr(field, { tex: ft, rough: 0.22, clearCoat: 0.8, emissive: "#ffffff", emissiveTex: ft, emissiveIntensity: 0.32 });
  }
  const jq = def.id === "jungleQuest";
  const cards: [string[], string[]] = jq
    ? [
        ["JUNGLE QUEST", "Spell T-E-M: bonus X", "IDOL targets light", "  the TEMPLE and KICK", "TEMPLE starts a quest", "4 quests: JUNGLE KING"],
        ["3 BALLS · 1 PLAYER", "Shift / Z  L flipper", "Shift / /  R flipper", "Space  plunger", "X . arrows  nudge", "Esc  leave"],
      ]
    : [
        ["BANANA BLITZ", "Spell BANANA: lock lit", "MONKEY MOUTH: lock", "2 locks + mouth:", "  BLITZ MULTIBALL", "Shots back to back: COMBO"],
        ["3 BALLS · 1 PLAYER", "Shift / Z  L flippers", "Shift / /  R flipper", "Space  plunger", "X . arrows  nudge", "Esc  leave"],
      ];
  const backglass = canvasMat(ctx, k("backglass"), backglassCanvas(def), 1.25);
  ctx.mats.glowing.add(backglass);
  return {
    k,
    field,
    body: pbr(k("body"), { color: t.body, rough: 0.3, clearCoat: 0.6 }),
    body2: pbr(k("body2"), { color: t.body2, rough: 0.35, clearCoat: 0.5 }),
    side: tex(k("side"), sideCanvas(def), { rough: 0.3, clearCoat: 0.7 }),
    apron: tex(k("apron"), apronCanvas(def, cards), { rough: 0.35, clearCoat: 0.4 }),
    backglass,
    trim: jq ? "brass" : pbr(k("trim"), { color: t.trim, rough: 0.25, clearCoat: 0.7 }),
    legs: t.legs === "chrome" ? "chrome" : "black",
    lockdown: jq ? "black" : "chrome",
    plastic: pbr(k("plastic"), { color: t.plastic, rough: 0.3, clearCoat: 0.6 }),
    rubber: pbr(k("rubber"), { color: t.rubber, rough: 0.75 }),
    sling: pbr(k("sling"), { color: t.accent, rough: 0.25, clearCoat: 0.8 }),
    bumper: [pbr(k("bumperA"), { color: jq ? "#c81d1d" : "#ff3b9a", rough: 0.3, clearCoat: 0.7 }), pbr(k("bumperB"), { color: jq ? "#f2c230" : "#38e8ff", rough: 0.3, clearCoat: 0.7 })],
    cap: pbr(k("cap"), { color: "#fff8ec", rough: 0.15, clearCoat: 0.6, alpha: 0.85 }),
    ramp: (() => {
      const key = k("ramp");
      if (!ctx.mats.has(key)) {
        const m = ctx.mats.pbr(key, { color: jq ? "#d8ffe6" : "#ffe3f4", rough: 0.08, alpha: 0.32, twoSided: true });
        m.useRadianceOverAlpha = true;
        m.useSpecularOverAlpha = true;
      }
      return key;
    })(),
    color: (hex: string) => pbr(`pin:col:${hex}`, { color: hex, rough: 0.3, clearCoat: 0.6 }),
    wood: pbr("pin:wood", { color: "#2a1a10", rough: 0.6 }),
    inner: pbr(k("inner"), { color: jq ? "#08130e" : "#1a0628", rough: 0.5 }),
  };
}

/**
 * A pinball machine in the room. Base at m, its player at -Z. Adds the
 * machine's playfield node (role pinball-machine, slot def.slot) and its
 * display (role pinball-dmd), which the engine finds by role.
 */
export function pinballMachine(ctx: WorldCtx, z: Zone, m: Matrix, def: TableDef): void {
  const M = tableMats(ctx, def);
  const label = `Pinball machine: ${tableName(def)}`;
  const CB = cabinetFrame().multiply(m);
  const PFm = playfieldFrame().multiply(m);
  const inCab = (x: number, y: number, zz: number) => Vector3.TransformCoordinates(new Vector3(x, y, zz), cabinetFrame());
  const { w, l, h } = CAB;

  // ------------------------------------------------ legs, with their bolt plates and levellers
  const legs = new Geo();
  const plates = new Geo();
  const feet = new Geo();
  for (const zz of [0.07, l - 0.09])
    for (const sx of [-1, 1]) {
      const top = inCab(sx * (w / 2 + 0.028), 0.02, zz);
      legs.add(box(0.05, top.y, 0.05), xf(top.x, top.y / 2, top.z));
      plates.add(box(0.006, 0.13, 0.11), xf(sx * (w / 2 + 0.003), 0.07, zz).multiply(cabinetFrame()));
      feet.add(cylinder(0.026, 0.014, 18), xf(top.x, 0, top.z));
      feet.add(cylinder(0.006, 0.05, 8), xf(top.x, 0.01, top.z));
    }
  ctx.g(z, M.legs).add(legs, m, label);
  ctx.g(z, "chrome").add(plates, m, label);
  ctx.g(z, "chrome").add(feet, m, label);

  // ------------------------------------------------ the cabinet
  const body = new Geo();
  body.add(box(w, 0.02, l), xf(0, 0.01, l / 2));
  for (const s of [-1, 1]) body.add(box(0.02, h, l), xf(s * (w / 2 - 0.01), h / 2, l / 2));
  body.add(box(w - 0.04, h, 0.02), xf(0, h / 2, 0.01));
  body.add(box(w - 0.04, h, 0.02), xf(0, h / 2, l - 0.01));
  ctx.g(z, M.body).add(body, CB, label);
  // side art, outside each side
  for (const s of [-1, 1]) ctx.g(z, M.side).add(plane(l - 0.02, h - 0.02), xf(s * (w / 2 + 0.0006), h / 2, l / 2, s > 0 ? -Math.PI / 2 : Math.PI / 2).multiply(CB), label);
  // trim along the cabinet's edges, the side rails over them, and the lockdown bar
  const trim = new Geo();
  for (const s of [-1, 1]) {
    trim.add(box(0.008, 0.012, l), xf(s * (w / 2 + 0.002), 0.006, l / 2));
    trim.add(box(0.008, 0.012, l), xf(s * (w / 2 + 0.002), h - 0.006, l / 2));
  }
  ctx.g(z, M.trim).add(trim, CB, label);
  const rails = new Geo();
  for (const s of [-1, 1]) rails.add(box(0.028, 0.014, l - 0.33), xf(s * (w / 2 - 0.012), h + 0.007, 0.08 + (l - 0.33) / 2));
  ctx.g(z, "chrome").add(rails, CB, label);
  ctx.g(z, M.lockdown).add(box(w + 0.012, 0.032, 0.088), xf(0, h + 0.016, 0.044).multiply(CB), "Lockdown bar");
  // the front: coin door, start button, plunger housing; flipper buttons on the sides
  const front = xf(0, 0, -0.001).multiply(CB);
  ctx.g(z, "charcoal").add(box(0.27, 0.24, 0.012), xf(0, 0.15, -0.006).multiply(front), "Coin door");
  const coin = new Geo();
  for (const s of [-1, 1]) {
    coin.add(box(0.05, 0.075, 0.01), xf(s * 0.06, 0.2, -0.015));
    coin.add(box(0.008, 0.03, 0.004), xf(s * 0.06, 0.2, -0.021));
  }
  coin.add(cylinder(0.011, 0.012, 14), xf(0, 0.08, -0.012, 0, 1, 1, 1, Math.PI / 2));
  coin.add(box(0.29, 0.012, 0.01), xf(0, 0.276, -0.012));
  ctx.g(z, "chrome").add(coin, front, "Coin door");
  ctx.g(z, "red").add(new Geo().add(box(0.03, 0.022, 0.006), xf(-0.06, 0.15, -0.021)).add(box(0.03, 0.022, 0.006), xf(0.06, 0.15, -0.021)), front, "Coin door");
  const startAt = xf(-0.22, 0.27, 0).multiply(front);
  ctx.g(z, "chrome").add(cylinder(0.019, 0.01, 18), xf(0, 0, 0, 0, 1, 1, 1, -Math.PI / 2).multiply(startAt), "Start button");
  ctx.g(z, M.sling).add(cylinder(0.014, 0.014, 18), xf(0, 0, -0.005, 0, 1, 1, 1, -Math.PI / 2).multiply(startAt), "Start button");
  ctx.g(z, "chrome").add(cylinder(0.024, 0.008, 20), xf(PF.shooterX, CAB.pfY + PF.ball, 0, 0, 1, 1, 1, -Math.PI / 2).multiply(front), "Plunger");
  for (const s of [-1, 1]) {
    const at = xf(s * (w / 2 + 0.0), CAB.pfY + 0.02, 0.14).multiply(CB);
    ctx.g(z, "chrome").add(cylinder(0.019, 0.006, 18), xf(0, 0, 0, 0, 1, 1, 1, 0, -s * Math.PI / 2).multiply(at), "Flipper button");
    ctx.g(z, M.sling).add(cylinder(0.0135, 0.017, 18), xf(0, 0, 0, 0, 1, 1, 1, 0, -s * Math.PI / 2).multiply(at), "Flipper button");
  }

  // ------------------------------------------------ the playfield and what is fixed on it
  const field = M.field;
  ctx.g(z, field, { castShadow: false }).add(floorQuad(PF.w, PF.l), xf(0, 0, PF.l / 2).multiply(PFm), label);
  const inside = new Geo();
  for (const s of [-1, 1]) {
    inside.add(box(0.022, 0.01, PF.l + 0.08), xf(s * 0.271, -0.005, PF.l / 2 - 0.04));
    inside.add(box(0.004, CAB.glassY - CAB.pfY, PF.l + 0.08), xf(s * 0.279, (CAB.glassY - CAB.pfY) / 2, PF.l / 2 - 0.04));
  }
  inside.add(box(0.56, CAB.glassY - CAB.pfY, 0.004), xf(0, (CAB.glassY - CAB.pfY) / 2, -0.06));
  ctx.g(z, M.inner, { castShadow: false }).add(inside, PFm, label);
  // the outer wall's face round the playfield: wood up the sides, a steel band round the arch
  const outer = def.walls[0].pts;
  const archStart = outer.findIndex(([x, y]) => y >= PF.archY - 1e-6 && x > 0);
  const archEnd = outer.findIndex(([x, y], i) => i > archStart && y <= PF.archY + 1e-6 && x < 0);
  const archPath = outer.slice(archStart, archEnd + 1).map(([x, y]) => {
    const a = Math.atan2(y - PF.archY, x);
    return new Vector3(x - Math.cos(a) * 0.002, 0.02, y - Math.sin(a) * 0.002);
  });
  ctx.g(z, "steel", { castShadow: false }).add(beam(archPath, 0.004, 0.04, { up: Vector3.Up() }), PFm, label);
  const sides = new Geo();
  sides.add(box(0.006, 0.04, PF.archY), xf(-0.263, 0.02, PF.archY / 2));
  sides.add(box(0.006, 0.04, PF.archY), xf(0.263, 0.02, PF.archY / 2));
  ctx.g(z, M.inner, { castShadow: false }).add(sides, PFm, label);

  const fixed = (mat: string) => ctx.g(z, mat, { castShadow: false });
  // walls: painted blocks, guide rails and rubbers
  for (const wall of def.walls) {
    if (wall.look === "none") continue;
    if (wall.look === "block") {
      fixed(wall.color ? M.color(wall.color) : M.plastic).add(slab(loop(wall.pts), 0, wall.h ?? 0.032), PFm, label);
      fixed("steel").add(beam(wall.pts.map((p) => p3(p, 0.033)).concat(wall.closed ? [p3(wall.pts[0], 0.033)] : []), 0.003, 0.002, { up: Vector3.Up() }), PFm, label);
    } else if (wall.look === "rail") {
      const mat = wall.mat === "metal" ? "steel" : M.plastic;
      fixed(mat).add(beam(wall.pts.map((p) => p3(p, 0.018)), Math.max(0.003, (wall.t ?? 0.002) * 2), 0.036, { up: Vector3.Up() }), PFm, label);
    } else fixed(M.rubber).add(tube(wall.pts.map((p) => p3(p, 0.012)), wall.t ?? 0.004, 10, true), PFm, label);
  }
  // posts, each with its rubber ring
  const post = (at: V2, r: number) => {
    fixed("steel").add(cylinder(0.0032, 0.034, 10), xf(at[0], 0, at[1]).multiply(PFm), label);
    fixed(M.sling).add(lathe([[0.0001, 0.034], [0.0055, 0.034], [0.006, 0.04], [0.0001, 0.043]], 14), xf(at[0], 0, at[1]).multiply(PFm), label);
    fixed(M.rubber).add(torus(Math.max(0.003, r - 0.0028), 0.0028, 18, 8), xf(at[0], 0.013, at[1]).multiply(PFm), label);
  };
  for (const p of def.posts) post(p.at, p.r);
  // slingshots: a block, rubber round its three posts, and a plastic over it
  for (const s of def.slings) {
    const tri = [s.t, s.b, s.c];
    fixed("white").add(slab(loop(tri), 0, 0.03), PFm, label);
    for (const c of tri) post(c, 0.0058);
    const band = [s.t, s.c, s.b, s.t].map((p) => p3(p, 0.013));
    fixed(M.rubber).add(tube(band, 0.0032, 8), PFm, label);
    const cx = (s.t[0] + s.b[0] + s.c[0]) / 3;
    const cy = (s.t[1] + s.b[1] + s.c[1]) / 3;
    const big = tri.map(([x, y]): V2 => [cx + (x - cx) * 1.25, cy + (y - cy) * 1.25]);
    fixed(M.sling).add(slab(loop(big), 0.043, 0.046), PFm, "Slingshot");
  }
  // pop bumpers: base, skirt, body, the ring that pulls down, and a clear cap (its lamp lights it from the lamp mesh)
  def.bumpers.forEach((b, i) => {
    const at = xf(b.at[0], 0, b.at[1]).multiply(PFm);
    fixed("black").add(cylinder(b.r + 0.003, 0.004, 24), at, "Pop bumper");
    fixed("white").add(cylinder(b.r, 0.003, 24), xf(0, 0.004, 0).multiply(at), "Pop bumper");
    fixed(M.bumper[i % 2]).add(cylinder(b.r * 0.72, 0.03, 24), xf(0, 0.007, 0).multiply(at), "Pop bumper");
    fixed("chrome").add(torus(b.r * 0.78, 0.0025, 24, 6), xf(0, 0.027, 0).multiply(at), "Pop bumper");
    fixed(M.cap).add(cylinder(b.r * 0.92, 0.013, 24, true, b.r * 0.86), xf(0, 0.037, 0).multiply(at), "Pop bumper");
  });
  // standup targets: a coloured face on a black post; drop targets are built to move
  for (const t of def.targets) {
    if (t.drop) continue;
    const mid = p3([(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2]);
    const yaw = Math.atan2(t.b[0] - t.a[0], t.b[1] - t.a[1]) - Math.PI / 2;
    const len = Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]);
    fixed(M.color(t.color)).add(box(len, 0.024, 0.004), xf(mid.x, 0.014, mid.z, yaw).multiply(PFm), "Target");
    fixed("black").add(box(0.006, 0.02, 0.01), xf(mid.x, 0.01, mid.z, yaw).multiply(PFm), "Target");
  }
  // rollovers: a steel wire across the lane, or a star
  for (const r of def.rollovers) {
    if (r.look === "wire") fixed("steel").add(tube([p3([r.at[0], r.at[1] - 0.012], -0.001), p3(r.at, 0.004), p3([r.at[0], r.at[1] + 0.012], -0.001)], 0.0012, 6), PFm, label);
    else {
      fixed("white").add(cylinder(0.0085, 0.0025, 10), xf(r.at[0], 0, r.at[1]).multiply(PFm), "Star rollover");
      fixed("chrome").add(torus(0.0095, 0.001, 16, 4), xf(r.at[0], 0.001, r.at[1]).multiply(PFm), "Star rollover");
    }
  }
  // spinner brackets: two wire posts and the axle (the flap is built to move)
  for (const s of def.spinners) {
    const g = new Geo();
    for (const p of [s.a, s.b]) g.add(tube([p3(p, 0), p3(p, 0.04)], 0.0016, 6));
    g.add(tube([p3(s.a, 0.036), p3(s.b, 0.036)], 0.0014, 6));
    fixed("steel").add(g, PFm, "Spinner");
  }
  // saucers: a dark cup with a chrome rim
  for (const s of def.scoops) {
    fixed("black").add(cylinder(0.016, 0.001, 20), xf(s.at[0], 0.0004, s.at[1]).multiply(PFm), "Saucer");
    fixed("chrome").add(torus(0.0168, 0.0015, 24, 6), xf(s.at[0], 0.0012, s.at[1]).multiply(PFm), "Saucer");
  }
  // one-way gates: a wire flap on an axle between two posts
  for (const gt of def.gates) {
    const g = new Geo();
    for (const p of [gt.a, gt.b]) g.add(tube([p3(p, 0), p3(p, 0.04)], 0.0016, 6));
    g.add(tube([p3(gt.a, 0.036), p3(gt.b, 0.036)], 0.0012, 6));
    g.add(tube([p3(gt.a, 0.036), p3(gt.a, 0.012), p3(gt.b, 0.012), p3(gt.b, 0.036)].map((v, i) => (i === 0 || i === 3 ? v : v)), 0.001, 5));
    fixed("steel").add(g, PFm, "Gate");
  }
  // ramps: a clear plastic ramp up from the mouth, then a wire return on posts
  for (const r of def.ramps) {
    const curve = rampCurve(r);
    let s = 0;
    let split = curve.length - 1;
    for (let i = 1; i < curve.length; i++) {
      s += Math.hypot(curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1], curve[i][2] - curve[i - 1][2]);
      if (s >= r.plastic) {
        split = i;
        break;
      }
    }
    const pts = curve.map(([x, y, hh]) => new Vector3(x, hh, y));
    const chan: [number, number][] = [[-0.024, 0.026], [-0.024, -0.002], [0.024, -0.002], [0.024, 0.026]];
    fixed(M.ramp).add(sweep(chan, pts.slice(0, split + 1), { closedProfile: false, caps: false, up: Vector3.Up() }), PFm, "Ramp");
    // a lip either side of the mouth, and the ramp's flap on the playfield
    fixed("steel").add(beam(pts.slice(0, split + 1).map((p) => p.add(new Vector3(0, 0.027, 0))), 0.05, 0.002, { up: Vector3.Up() }), PFm, "Ramp");
    const wire = pts.slice(split);
    const g = new Geo();
    const along = (off: number, lift: number) =>
      wire.map((p, i) => {
        const a = wire[Math.max(0, i - 1)];
        const b = wire[Math.min(wire.length - 1, i + 1)];
        const d = b.subtract(a);
        const side = new Vector3(d.z, 0, -d.x).normalize();
        return p.add(side.scale(off)).add(new Vector3(0, lift, 0));
      });
    for (const [off, lift] of [
      [-0.009, 0.002],
      [0.009, 0.002],
      [-0.017, 0.018],
      [0.017, 0.018],
    ])
      g.add(tube(along(off, lift), 0.0016, 6));
    for (let i = 4; i < wire.length - 4; i += 9) g.add(tube([new Vector3(wire[i].x, 0, wire[i].z), wire[i]], 0.0018, 6));
    fixed("steel").add(g, PFm, "Wire ramp");
  }
  // kickbacks: a steel kicker at the foot of the outlane
  for (const kb of def.kickbacks) fixed("chrome").add(box(0.02, 0.012, 0.012), xf(kb.at[0], 0.006, kb.at[1] - 0.03).multiply(PFm), "Kickback");
  // the apron over the bottom, with its cards; the shooter lane's housing
  const apron = new Geo().add(floorQuad(PF.shooterWall + 0.28, 0.12 + 0.055), xf((PF.shooterWall - 0.28) / 2, 0.012, (0.12 - 0.055) / 2));
  ctx.g(z, M.apron, { castShadow: false }).add(apron, PFm, "Apron");
  ctx.g(z, M.trim, { castShadow: false }).add(box(PF.shooterWall + 0.28, 0.012, 0.004), xf((PF.shooterWall - 0.28) / 2, 0.006, 0.12).multiply(PFm), "Apron");
  fixed("chrome").add(box(0.04, 0.02, 0.03), xf(PF.shooterX, 0.01, 0.0).multiply(PFm), "Shooter lane");
  // the glass over it all
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(box(0.565, 0.005, l - 0.33), xf(0, CAB.glassY, 0.08 + (l - 0.33) / 2).multiply(CB), label);

  // ------------------------------------------------ the backbox
  const backTop = inCab(0, h, l);
  const frontTop = inCab(0, h, l - BOX.d);
  const yb = backTop.y + 0.01;
  const zb = backTop.z - BOX.d / 2;
  const bb = xf(0, yb, zb).multiply(m);
  // its neck: from the leaning cabinet up to the level backbox
  ctx.g(z, M.body2).add(box(BOX.w - 0.04, yb - frontTop.y + 0.02, BOX.d - 0.02), xf(0, (frontTop.y + yb) / 2 - 0.01, zb).multiply(m), label);
  ctx.g(z, M.body).add(box(BOX.w, BOX.h, BOX.d), xf(0, BOX.h / 2, 0).multiply(bb), label);
  for (const s of [-1, 1]) ctx.g(z, M.side).add(plane(BOX.d - 0.01, BOX.h - 0.02), xf(s * (BOX.w / 2 + 0.0006), BOX.h / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.98, 1, 1).multiply(bb), label);
  const face = (y: number, zz = 0) => xf(0, y, -BOX.d / 2 - 0.002 - zz).multiply(bb);
  const glassH = 0.46;
  const glassY = BOX.h - 0.04 - glassH / 2;
  ctx.g(z, M.backglass, { castShadow: false }).add(plane(BOX.w - 0.05, glassH), face(glassY), "Backglass");
  ctx.g(z, "glass", { castShadow: false, pickable: false }).add(box(BOX.w - 0.04, glassH + 0.01, 0.004), face(glassY, 0.004), label);
  // the speaker panel: grilles either side of the display
  const panelY = 0.15;
  ctx.g(z, "black").add(box(BOX.w - 0.04, 0.24, 0.006), face(panelY, -0.001), "Speaker panel");
  const grille = new Geo();
  for (const s of [-1, 1]) for (let i = 0; i < 7; i++) grille.add(box(0.1, 0.006, 0.004), xf(s * 0.215, panelY - 0.045 + i * 0.015, -0.006));
  ctx.g(z, "charcoal", { castShadow: false }).add(grille, face(0), "Speaker panel");
  const rims = new Geo();
  for (const s of [-1, 1]) rims.add(torus(0.058, 0.003, 28, 6), xf(s * 0.215, panelY, -0.006, 0, 1, 1, 1, Math.PI / 2));
  rims.add(box(DMD_SIZE.w + 0.03, 0.006, 0.006), xf(0, panelY + DMD_SIZE.h / 2 + 0.012, -0.006));
  rims.add(box(DMD_SIZE.w + 0.03, 0.006, 0.006), xf(0, panelY - DMD_SIZE.h / 2 - 0.012, -0.006));
  ctx.g(z, M.trim, { castShadow: false }).add(rims, face(0), "Speaker panel");
  const dmd0 = makeCanvas(256, 64);
  dmd0.ctx.fillStyle = "#120600";
  dmd0.ctx.fillRect(0, 0, 256, 64);
  const dmd = ctx.screen(z, ROLE.pinballDmd, xf(0, panelY, -0.01).multiply(face(0)), DMD_SIZE.w, DMD_SIZE.h, canvasMat(ctx, M.k("dmd0"), dmd0.canvas, 1), `Pinball display: ${tableName(def)}`);
  dmd.metadata = { ...(dmd.metadata as MeshMeta), slot: def.slot };
  // trim round the backbox
  const bt = new Geo();
  for (const s of [-1, 1]) bt.add(box(0.012, BOX.h, 0.012), xf(s * (BOX.w / 2 - 0.004), BOX.h / 2, -BOX.d / 2 - 0.004));
  bt.add(box(BOX.w, 0.012, 0.012), xf(0, BOX.h - 0.004, -BOX.d / 2 - 0.004));
  bt.add(box(BOX.w, 0.012, 0.012), xf(0, 0.29, -BOX.d / 2 - 0.004));
  bt.add(box(BOX.w, 0.012, 0.012), xf(0, 0.006, -BOX.d / 2 - 0.004));
  ctx.g(z, M.trim).add(bt, bb, label);
  // a topper: a stepped temple crest for the jungle, a bunch of bananas for the party
  const top = xf(0, BOX.h, 0).multiply(bb);
  if (def.id === "jungleQuest") {
    const steps = new Geo();
    for (let i = 0; i < 3; i++) steps.add(box(0.44 - i * 0.12, 0.05, 0.16 - i * 0.03), xf(0, 0.025 + i * 0.05, 0));
    ctx.g(z, "stoneWhite").add(steps, top, label);
    ctx.g(z, "brass").add(new Geo().add(cylinder(0.035, 0.012, 5), xf(0, 0.075, -0.075, 0, 1, 1, 1, Math.PI / 2)), top, label);
    ctx.g(z, M.body).add(box(0.2, 0.012, 0.13), xf(0, 0.156, 0).multiply(top), label);
  } else {
    const g = new Geo();
    for (let i = 0; i < 5; i++) {
      const a = -0.6 + i * 0.3;
      const pts: Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        pts.push(new Vector3(Math.sin(a) * t * 0.22, 0.03 + t * 0.2 - t * t * 0.08, -Math.cos(a) * 0.02 + Math.sin(t * Math.PI) * 0.03));
      }
      g.add(tube(pts, (t) => 0.028 * Math.sin(Math.PI * (0.08 + t * 0.84)) + 0.005, 10, true));
    }
    ctx.g(z, "bananaYellow").add(g, top, label);
    ctx.g(z, "black").add(cylinder(0.02, 0.04, 10), top, label);
  }

  // ------------------------------------------------ the playfield node the engine builds the moving parts on
  const standLocal = Vector3.TransformCoordinates(STAND, playfieldFrame().clone().invert());
  ctx.slot(z, ROLE.pinballMachine, def.slot, PFm, standLocal, `Pinball machine ${def.slot}: ${tableName(def)}`);
  // the playfield's own light: under the plastics, it lights what stands on it
  ctx.lights.push({ pos: Vector3.TransformCoordinates(new Vector3(0, 0.25, 0.55), PFm), color: def.id === "jungleQuest" ? "#ffe2b0" : "#ffd0ec", day: 0.15, night: 0.6, range: 1.2, rooms: [z.room], level: z.level });
}

// ---------------------------------------------------------------- the moving parts

export interface PinballParts {
  root: TransformNode;
  meshes: Mesh[];
  balls: Mesh[];
  /** each flipper's node, turned about the playfield's normal */
  flippers: TransformNode[];
  plunger: TransformNode;
  spinners: TransformNode[];
  drops: Mesh[];
  lamps: LampMesh;
}

/** The lamp mesh: every insert and bumper cap as a quad on one mesh, lit or not by swapping its UVs. */
export interface LampMesh {
  mesh: Mesh;
  /** each lamp's name, in the order `set` takes them */
  names: string[];
  set(i: number, on: boolean): void;
  /** send the changed UVs to the GPU (once a frame, when something changed) */
  flush(): void;
}

/** The colours of a table's flippers: bat and rubber. */
const FLIPPER_COLORS: Record<TableDef["id"], [string, string]> = { jungleQuest: ["#f4f1e6", "#c81d1d"], bananaBlitz: ["#ffd23a", "#7b2fb8"] };

/**
 * Build a machine's moving parts on its playfield node (role pinball-machine).
 * They're meshes of their own, kind "special": not solid to a walker (they're
 * under the glass), and seen by the export in their rest pose.
 */
export function buildPinballParts(mats: Materials, slot: TransformNode, def: TableDef): PinballParts {
  const scene = mats.scene;
  const sm = slot.metadata as SlotMeta;
  const name = tableName(def);
  const label = `Pinball machine: ${name}`;
  const root = new TransformNode(`${label}: moving parts`, scene);
  root.parent = slot;
  const meshes: Mesh[] = [];
  const own = (mesh: Mesh, mat: string, role?: string) => {
    mesh.material = mats.get(mat);
    mesh.metadata = { room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label }], matKey: mat, kind: "special", ...(role ? { role, slot: def.slot } : {}) } satisfies MeshMeta;
    mesh.receiveShadows = true;
    mesh.renderingGroupId = 1;
    meshes.push(mesh);
    return mesh;
  };
  const key = (s: string) => `pin${def.slot}:${s}`;
  const pbr = (k: string, o: Parameters<Materials["pbr"]>[1]) => {
    if (!mats.has(k)) mats.pbr(k, o);
    return k;
  };

  // the balls: steel, mirror-bright
  const balls: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const b = own(sphere(PF.ball, 24, 16).build(`${label}: ball ${i + 1}`, scene), "chrome", ROLE.pinballBall);
    b.parent = root;
    b.setEnabled(false);
    balls.push(b);
  }

  // the flippers: a white or yellow bat with its rubber ring, turned about its pivot
  const [batCol, rubCol] = FLIPPER_COLORS[def.id];
  const flipMat = pbr("pin:flipper", { color: "#ffffff", rough: 0.3, clearCoat: 0.6, vertexColors: true });
  const flippers = def.flippers.map((f) => {
    const node = new TransformNode(`${label}: ${f.id}`, scene);
    node.parent = root;
    node.position.set(f.pivot[0], 0, f.pivot[1]);
    node.rotation.y = -f.rest;
    const mesh = own(flipperGeo(f, batCol, rubCol).build(`${label}: ${f.id}`, scene), flipMat, ROLE.pinballFlipper);
    mesh.parent = node;
    return node;
  });

  // the plunger: a steel rod with its spring, out through the front to its knob
  const plunger = new TransformNode(`${label}: plunger`, scene);
  plunger.parent = root;
  plunger.position.set(PF.shooterX, PF.ball, PF.plungerY);
  const rod = new Geo();
  rod.add(tube([new Vector3(0, 0, -0.006), new Vector3(0, 0, -0.205)], 0.0038, 10));
  const coil: Vector3[] = [];
  for (let i = 0; i <= 120; i++) {
    const a = i * 0.55;
    coil.push(new Vector3(Math.cos(a) * 0.0075, Math.sin(a) * 0.0075, -0.03 - (i / 120) * 0.075));
  }
  rod.add(tube(coil, 0.0011, 5));
  const rodMesh = own(rod.build(`${label}: plunger`, scene), "chrome", ROLE.pinballPlunger);
  rodMesh.parent = plunger;
  const knobMat = pbr(key("knob"), { color: def.theme.accent, rough: 0.25, clearCoat: 0.8 });
  const knob = own(
    new Geo()
      .add(lathe([[0.0001, -0.205], [0.012, -0.205], [0.016, -0.22], [0.015, -0.245], [0.0001, -0.247]], 18))
      .add(cylinder(0.0075, 0.012, 12), xf(0, 0, -0.006, 0, 1, 1, 1, Math.PI / 2))
      .build(`${label}: plunger knob`, scene),
    knobMat,
    ROLE.pinballPlunger,
  );
  knob.parent = plunger;

  // spinners: a flap hung under its axle
  const spinMat = pbr(key("spinner"), { color: def.theme.accent2, rough: 0.2, metal: 0.6 });
  const spinners = def.spinners.map((s) => {
    const node = new TransformNode(`${label}: ${s.id}`, scene);
    node.parent = root;
    node.position.set((s.a[0] + s.b[0]) / 2, 0.036, (s.a[1] + s.b[1]) / 2);
    node.rotation.y = -Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) - 0.004;
    const flap = own(box(len, 0.026, 0.0016).build(`${label}: ${s.id}`, scene), spinMat);
    flap.parent = node;
    flap.position.y = -0.0145;
    return node;
  });

  // drop targets: standing up in front of their bank, dropped below the playfield when hit
  const drops = def.targets
    .filter((t) => t.drop)
    .map((t) => {
      const len = Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]);
      const mesh = own(box(len, 0.026, 0.006).build(`${label}: ${t.id}`, scene), pbr(`pin:col:${t.color}`, { color: t.color, rough: 0.3, clearCoat: 0.6 }));
      mesh.parent = root;
      mesh.position.set((t.a[0] + t.b[0]) / 2, 0.013, (t.a[1] + t.b[1]) / 2);
      mesh.rotation.y = -Math.atan2(t.b[1] - t.a[1], t.b[0] - t.a[0]);
      return mesh;
    });

  const lamps = buildLamps(mats, def, own, label);
  lamps.mesh.parent = root;
  return { root, meshes, balls, flippers, plunger, spinners, drops, lamps };
}

/** A flipper in its own frame: pivot at the origin, pointing along +x. The bat is the hull of its base and tip circles. */
function flipperGeo(f: Flipper, bat: string, rubber: string): Geo {
  const hull = (grow: number): V2[] => {
    const r1 = f.r1 + grow;
    const r2 = f.r2 + grow;
    const a = Math.asin((r1 - r2) / f.len);
    const pts: V2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = Math.PI / 2 + a + ((Math.PI - 2 * a) * i) / 16;
      pts.push([Math.cos(t) * r1, Math.sin(t) * r1]);
    }
    for (let i = 0; i <= 12; i++) {
      const t = -Math.PI / 2 + a + ((Math.PI - 2 * a) * i) / 12;
      pts.push([f.len + Math.cos(t) * r2, Math.sin(t) * r2]);
    }
    return pts;
  };
  const hex = (c: string) => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255] as const;
  const g = new Geo();
  const b = hex(bat);
  const r = hex(rubber);
  g.add(slab(loop(hull(-0.0025)), 0.003, 0.027).paint(b[0], b[1], b[2]));
  g.add(slab(loop(hull(0)), 0.008, 0.02).paint(r[0], r[1], r[2]));
  g.add(cylinder(0.0045, 0.004, 12).paint(0.8, 0.8, 0.8), xf(0, 0.027, 0));
  return g;
}

/**
 * The lamp mesh: each insert a quad just over the playfield and each bumper
 * cap a quad on top of the cap, all UV-mapped into the table's lamp atlas.
 */
function buildLamps(mats: Materials, def: TableDef, own: (m: Mesh, mat: string) => Mesh, label: string): LampMesh {
  const scene = mats.scene;
  const atlas = lampAtlas(def);
  const matKey = `pin${def.slot}:lamps`;
  if (!mats.has(matKey)) {
    const tex = toTexture(scene, matKey, atlas.canvas, { wrap: false, hasAlpha: true });
    mats.unlit(matKey, { tex, alpha: 1, intensity: 2.2 });
  }
  const g = new Geo();
  const names: string[] = [];
  const quads: { lamp: number }[] = [];
  const quad = (lamp: string, x: number, y: number, h: number, size: number, rot: number) => {
    let i = names.indexOf(lamp);
    if (i < 0) i = names.push(lamp) - 1;
    const half = size / 2;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const at = (u: number, v: number) => [x + u * c - v * s, y + u * s + v * c] as const;
    const base = g.vertexCount;
    for (const [u, v] of [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ]) {
      const [px, py] = at(u, v);
      g.vert(px, h, py, 0, 0, 0, 1, 0);
    }
    g.tri(base, base + 2, base + 1);
    g.tri(base, base + 3, base + 2);
    quads.push({ lamp: i });
  };
  const cells: number[] = [];
  def.inserts.forEach((ins, k) => {
    quad(ins.lamp, ins.at[0], ins.at[1], 0.0008, ins.size / (0.86 * (ins.shape === "arrow" ? 0.72 : 1)), ins.rot ?? 0);
    cells.push(k);
  });
  def.bumpers.forEach((b, k) => {
    quad(b.lamp, b.at[0], b.at[1], 0.0505, b.r * 1.75, 0);
    cells.push(def.inserts.length + k);
  });
  const mesh = own(g.build(`${label}: lamps`, scene), matKey);
  mesh.isPickable = false;
  const uvs = new Float32Array(g.vertexCount * 2);
  const on = new Uint8Array(names.length);
  const du = LAMP_CELL / atlas.canvas.width;
  const dv = LAMP_CELL / atlas.canvas.height;
  // canvas rows run down; the texture's v runs up
  const writeQuad = (q: number) => {
    const cell = cells[q];
    const lit = on[quads[q].lamp] === 1;
    const u0 = (cell % LAMP_COLS) * du;
    const row = Math.floor(cell / LAMP_COLS) + (lit ? 0 : atlas.rows);
    const v1 = 1 - row * dv;
    const v0 = v1 - dv;
    const o = q * 8;
    uvs.set([u0, v0, u0 + du, v0, u0 + du, v1, u0, v1], o);
  };
  for (let q = 0; q < quads.length; q++) writeQuad(q);
  mesh.setVerticesData(VertexBuffer.UVKind, uvs, true);
  let dirty = false;
  return {
    mesh,
    names,
    set(i, lit) {
      const v = lit ? 1 : 0;
      if (on[i] === v) return;
      on[i] = v;
      for (let q = 0; q < quads.length; q++) if (quads[q].lamp === i) writeQuad(q);
      dirty = true;
    },
    flush() {
      if (!dirty) return;
      dirty = false;
      mesh.updateVerticesData(VertexBuffer.UVKind, uvs);
    },
  };
}

/** The world matrix of a node as a matrix (for placing things on a machine's playfield). */
export function nodeMatrix(n: TransformNode): Matrix {
  return n.computeWorldMatrix(true).clone();
}

export { Quaternion };
