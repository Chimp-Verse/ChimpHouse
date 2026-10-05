// Raised glass-edge infinity pool on the pool terrace (see POOL in layout.ts).
//
// The water edge is `poolLoop`. A wall `POOL.wall` thick surrounds it. On the
// terrace side (north and west) the wall rises from the deck to a stone coping.
// On the jungle side (south and east) the deck edge follows the wall: from deck
// level up, the wall is a glass panel showing the water, which spills over the
// glass rim and down a deep blue mosaic band into a catch gutter. Glulam
// columns carry the corner that overhangs the lower deck.

import { Color3, Constants, PBRMaterial, Vector3 } from "@babylonjs/core";
import { P2, offsetPath, pointInPolygon, resample, rightOf, tangentAt } from "../geometry/curves";
import { Geo, alignY, at, beam, circleProfile, cylinder, disc, fixWinding, floorQuad, plane, polygonFace, ribbonWall, sweep, torus, xf } from "../geometry/geo";
import { WorldCtx, Zone, zone } from "../context";
import { LEVEL, POOL, lowerDeckLoop, poolLoop, upperDeckLoop } from "../layout";
import { ledStrip } from "../structure/elements";
import { terrainHeight } from "../environment/terrain";
import { makeCanvas, toTexture } from "../materials/canvas";
import { causticsTexture, drawLeafEmblem, spillTexture } from "../materials/textures";

const U = LEVEL.upper;

export interface PoolInfo {
  /** pool centre and bounds of the water edge */
  pc: P2;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** where the entry steps are, on the terrace side */
  entry: P2;
  /** the two points where the coping (terrace side) meets the infinity edge */
  corners: P2[];
}

interface Run {
  infinity: boolean;
  idx: number[];
}

function distToLoop(p: P2, loop: P2[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}

/** Horizontal strip between two matched paths at height y; v runs from 1 on `a` to 0 on `b`. */
function hstrip(a: P2[], b: P2[], y: number, up = true): Geo {
  const g = new Geo();
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (i) s += Math.hypot(a[i].x - a[i - 1].x, a[i].z - a[i - 1].z);
    g.vert(a[i].x, y, a[i].z, s, 1, 0, up ? 1 : -1, 0);
    g.vert(b[i].x, y, b[i].z, s, 0, 0, up ? 1 : -1, 0);
  }
  for (let i = 0; i < a.length - 1; i++) g.quad(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1);
  return fixWinding(g);
}

/** Double-sided vertical quad across the wall, from p to q, between y0 and y1. */
function endFace(p: P2, q: P2, y0: number, y1: number): Geo {
  return new Geo().add(ribbonWall([p, q], y0, y1)).add(ribbonWall([q, p], y0, y1));
}

export function buildPool(ctx: WorldCtx): PoolInfo {
  const z: Zone = zone("poolTerrace", "upper");
  const { water: W, coping: C, floor: B, wall, gutter: G } = POOL;
  const L = resample(poolLoop, 0.15, true);
  const n = L.length;
  const N = L.map((_, i) => rightOf(tangentAt(L, i, true)));
  const off = (i: number, d: number): P2 => ({ x: L[i].x + N[i].x * d, z: L[i].z + N[i].z * d });

  // ---- which stretches face the jungle (the deck edge follows the wall there)
  const inf = L.map((_, i) => distToLoop(off(i, wall + 0.01), upperDeckLoop) < 0.1);
  const runs: Run[] = [];
  {
    const start = inf.findIndex((v, i) => v !== inf[(i - 1 + n) % n]);
    const s0 = start < 0 ? 0 : start;
    let cur: Run | null = null;
    for (let k = 0; k < n; k++) {
      const i = (s0 + k) % n;
      if (!cur || cur.infinity !== inf[i]) {
        if (cur) cur.idx.push(i); // runs share their boundary point
        cur = { infinity: inf[i], idx: [i] };
        runs.push(cur);
      } else cur.idx.push(i);
    }
    if (cur && runs.length > 1) cur.idx.push(s0);
    else if (cur) cur.idx.push(cur.idx[0]); // one closed run
  }
  const path = (run: Run, d: number) => run.idx.map((i) => off(i, d));

  // ---- interior: floor and tiled walls; a deep blue waterline band on the terrace side,
  // and on the glass side the tiled wall stops at deck level under the glass panel
  const OUT = wall + 0.02; // outer face, just beyond the deck edge
  const GLASS_IN = OUT - 0.045;
  const GLASS_OUT = OUT - 0.005;
  const YB = U + 0.005; // top of the solid wall under the glass
  ctx.g(z, "poolTile").add(polygonFace(L, B, true), undefined, "Pool floor");
  const corners: P2[] = [];
  for (const run of runs) {
    const inner = [...path(run, 0)].reverse();
    if (run.infinity) ctx.g(z, "poolTile").add(ribbonWall(inner, B, YB), undefined, "Pool wall (mosaic)");
    else {
      ctx.g(z, "poolTile").add(ribbonWall(inner, B, W - 0.1), undefined, "Pool wall (mosaic)");
      ctx.g(z, "poolTileBand").add(ribbonWall(inner, W - 0.1, C - 0.05), undefined, "Waterline tiles");
    }
    corners.push(L[run.idx[0]]);
  }

  // ---- terrace side: raised wall clad in mosaic, stone coping, wall ends at the weir
  for (const run of runs.filter((r) => !r.infinity)) {
    const inner = path(run, 0);
    ctx.g(z, "poolTileOuter").add(ribbonWall(path(run, wall), U, C - 0.05), undefined, "Pool wall (mosaic)");
    ctx.g(z, "coping").add(beam(at(inner, 0), wall + 0.1, 0.05, { offsetX: wall / 2, offsetY: C - 0.025 }), undefined, "Pool coping");
    // where the glass meets the solid wall, the wall's end faces into the water behind the glass
    for (const i of [run.idx[0], run.idx[run.idx.length - 1]]) ctx.g(z, "poolTile").add(endFace(off(i, 0), off(i, OUT), YB, C - 0.05));
  }

  // ---- jungle side: glass edge, overflow over its rim, water down the mosaic band, catch gutter
  const fallTex = toTexture(ctx.scene, "poolFallTex", spillTexture(), { hasAlpha: true });
  fallTex.uScale = 0.7;
  fallTex.vScale = 0.8;
  const fallMat = (name: string, alpha: number) => {
    const m = new PBRMaterial(name, ctx.scene);
    m.albedoTexture = fallTex;
    m.useAlphaFromAlbedoTexture = true;
    m.albedoColor = Color3.FromHexString("#e6fbf8").toLinearSpace();
    m.emissiveColor = Color3.FromHexString("#7fe9e2").toLinearSpace();
    m.emissiveTexture = fallTex;
    m.emissiveIntensity = 0.25;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.alpha = alpha;
    m.roughness = 0.08;
    m.backFaceCulling = false;
    return m;
  };
  // a thin, clear sheet over the glass so the water behind it stays visible
  const fallOnGlass = fallMat("poolFallGlassMat", 0.3);
  const fall = fallMat("poolFallMat", 0.7);
  if (!ctx.mats.has("poolGlass")) {
    const g = ctx.mats.pbr("poolGlass", { color: "#7fd8d4", rough: 0.03, alpha: 0.28 });
    g.useRadianceOverAlpha = true;
    g.useSpecularOverAlpha = true;
    g.backFaceCulling = false;
  }
  const glassGeo = ctx.g(z, "poolGlass", { castShadow: false });
  const glassFallGeo = new Geo();
  const fallGeo = new Geo();
  const filmGeo = new Geo();
  const waterEdge = new Geo();
  for (const run of runs.filter((r) => r.infinity)) {
    const inner = path(run, 0);
    const outer = path(run, OUT);
    // solid wall below the glass: a ledge inside, deep blue mosaic outside down to the gutter
    ctx.g(z, "poolTile").add(hstrip(inner, path(run, GLASS_IN), YB), undefined, "Pool ledge under the glass");
    ctx.g(z, "poolTileBand").add(ribbonWall(outer, G, YB + 0.002), undefined, "Infinity wall (mosaic)");
    for (const i of [run.idx[0], run.idx[run.idx.length - 1]]) ctx.g(z, "poolTileBand").add(endFace(off(i, 0), off(i, OUT), G, YB));
    // glass panel, 4 cm thick, from the ledge to just under the water line
    glassGeo.setLabel("Glass pool edge");
    glassGeo.add(ribbonWall(path(run, GLASS_OUT), YB, W - 0.006));
    glassGeo.add(ribbonWall([...path(run, GLASS_IN)].reverse(), YB, W - 0.006));
    glassGeo.add(hstrip(path(run, GLASS_IN), path(run, GLASS_OUT), W - 0.006));
    ledStrip(ctx, z, at(path(run, OUT + 0.025), YB - 0.03), "mint", 0.035);
    // water reaches the glass, slides over its rim and falls to the gutter
    waterEdge.add(hstrip(inner, path(run, GLASS_IN), W));
    filmGeo.add(hstrip(path(run, GLASS_IN - 0.005), path(run, OUT + 0.012), W - 0.002));
    glassFallGeo.add(ribbonWall(path(run, OUT + 0.012), YB, W - 0.002));
    fallGeo.add(ribbonWall(path(run, OUT + 0.012), G + 0.16, YB));
    // catch gutter: steel channel along the foot of the wall, filled with churning water
    ctx.g(z, "charcoal").add(beam(at(outer, 0), 0.32, 0.03, { offsetX: 0.16, offsetY: G + 0.015 }), undefined, "Catch gutter");
    ctx.g(z, "charcoal").add(beam(at(outer, 0), 0.03, 0.24, { offsetX: 0.305, offsetY: G + 0.12 }), undefined, "Catch gutter");
    fallGeo.add(hstrip(path(run, OUT + 0.012), path(run, OUT + 0.29), G + 0.17));
  }
  const addFall = (geo: Geo, name: string, mat: PBRMaterial, label: string) => {
    const mesh = geo.build(name, ctx.scene);
    mesh.material = mat;
    mesh.alphaIndex = 12;
    ctx.addMesh(mesh, z, label);
  };
  addFall(fallGeo, "poolFall", fall, "Infinity edge waterfall");
  addFall(filmGeo, "poolFilm", fall, "Infinity edge overflow");
  addFall(glassFallGeo, "poolFallGlass", fallOnGlass, "Water over the glass edge");
  ctx.animators.push((t) => {
    fallTex.vOffset = t * 0.9;
  });

  // ---- entry: outside step and grab rails at the west of the north side, steps down inside
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of L) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const pc = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const northRun = runs.find((r) => !r.infinity && r.idx.some((i) => L[i].z > maxZ - 0.3))!;
  const along = (x0: number, x1: number) => northRun.idx.filter((i) => L[i].z > pc.z && L[i].x >= x0 && L[i].x <= x1);
  const stepIdx = along(minX + 1.4, minX + 3.0);
  const stepPath = (d: number) => stepIdx.map((i) => off(i, d));
  // equal risers of about 0.23 m, like the house's stairs and low enough for any avatar to
  // step: three teak steps up to the coping outside, six steps down to the floor inside
  const OUT_STEPS = 3;
  const outRise = (C - U) / (OUT_STEPS + 1);
  const outTread = 0.32;
  for (let k = 0; k < OUT_STEPS; k++) {
    const top = C - (k + 1) * outRise;
    ctx.g(z, "deck").add(beam(at(stepPath(0), 0), outTread, top - U, { offsetX: wall + outTread * (k + 0.5), offsetY: (U + top) / 2 }), undefined, "Pool entry steps");
  }
  const IN_STEPS = 6;
  const inRise = (C - B) / (IN_STEPS + 1);
  const inTread = 0.28;
  for (let k = 0; k < IN_STEPS; k++) {
    const top = C - (k + 1) * inRise;
    ctx.g(z, "poolTile").add(beam(at(stepPath(0), 0), inTread, top - B, { offsetX: -inTread * (k + 0.5), offsetY: (top + B) / 2 }), undefined, "Pool steps");
  }
  // grab rails either side: a post from the deck past the bottom step, a handrail up along
  // the steps, over the coping and straight down onto the first step inside
  const sFoot = wall + OUT_STEPS * outTread + 0.1;
  const sIn = -inTread * 0.55;
  const inTop = C - inRise;
  for (const i of [stepIdx[1], stepIdx[stepIdx.length - 2]]) {
    const ctrl: [number, number][] = [
      [sFoot, U],
      [sFoot, U + 0.85],
      [0.12, C + 0.8],
      [sIn, C + 0.8],
      [sIn, inTop],
    ];
    const pts = roundCorners(ctrl, 0.14, 6).map(([sd, y]) => {
      const p = off(i, sd);
      return new Vector3(p.x, y, p.z);
    });
    // the rail lies in a plane across the steps, so the line along them is a steady "up"
    const along = tangentAt(L, i, true);
    ctx.g(z, "chrome").add(sweep(circleProfile(0.022, 10), pts, { up: new Vector3(along.x, 0, along.z), caps: false, smooth: true }), undefined, "Pool grab rail");
    for (const [sd, y] of [
      [sFoot, U],
      [sIn, inTop],
    ]) {
      const p = off(i, sd);
      ctx.g(z, "chrome").add(cylinder(0.05, 0.015, 14), xf(p.x, y, p.z), "Pool grab rail");
    }
  }
  const benchIdx = along(maxX - 4.4, maxX - 1.6);
  ctx.g(z, "poolTile").add(beam(at(benchIdx.map((i) => off(i, 0)), 0), 0.42, W - 0.48 - B, { offsetX: -0.21, offsetY: (W - 0.48 + B) / 2 }), undefined, "Submerged bench");

  // ---- pool lights and skimmers on the inner wall
  const lightMat = "poolLight";
  if (!ctx.mats.has(lightMat)) ctx.mats.unlit(lightMat, { color: "#bff9ff", intensity: 2.2 });
  for (let k = 0; k < 6; k++) {
    const i = Math.floor(((k + 0.5) / 6) * n);
    const p = off(i, -0.006);
    const inward = new Vector3(-N[i].x, 0, -N[i].z);
    const pos = new Vector3(p.x, B + 0.55, p.z);
    ctx.g(z, lightMat, { castShadow: false }).add(disc(0.09, 20), alignY(pos, inward), "Pool light");
    ctx.g(z, "chrome", { castShadow: false }).add(torus(0.1, 0.014, 24, 6), alignY(pos, inward), "Pool light");
  }
  for (const i of [northRun.idx[Math.floor(northRun.idx.length * 0.35)], northRun.idx[Math.floor(northRun.idx.length * 0.75)]]) {
    // skimmer mouth: a dark opening half above the water line, facing into the pool
    const p = off(i, -0.004);
    ctx.g(z, "black", { castShadow: false }).add(plane(0.34, 0.16), xf(p.x, W, p.z, Math.atan2(N[i].x, N[i].z)), "Skimmer");
  }

  // ---- mosaic leaf emblem on the pool floor
  if (!ctx.mats.has("poolEmblem")) {
    const { canvas, ctx: c } = makeCanvas(512, 512);
    c.clearRect(0, 0, 512, 512);
    drawLeafEmblem(c, 256, 470, 400, "#ffffff");
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    for (let k = 0; k < 512; k += 10) {
      c.fillRect(k, 0, 2, 512);
      c.fillRect(0, k, 512, 2);
    }
    const tex = toTexture(ctx.scene, "poolEmblem", canvas, { wrap: false, hasAlpha: true });
    ctx.mats.decal("poolEmblem", tex, { rough: 0.2, alphaTest: true });
    (ctx.mats.get("poolEmblem") as PBRMaterial).albedoColor = Color3.FromHexString("#0f5f86").toLinearSpace();
  }
  const ec = pointInPolygon(pc, L) ? pc : L[0];
  ctx.g(z, "poolEmblem", { castShadow: false }).add(floorQuad(3.0, 3.0), xf(ec.x, B + 0.004, ec.z, Math.PI), "Pool floor emblem");

  // ---- water: two layers of ripples (bump + clear-coat bump), tinted and see-through
  const water = new PBRMaterial("poolWaterMat", ctx.scene);
  water.albedoColor = Color3.FromHexString("#18a9bd").toLinearSpace();
  water.alpha = 0.5;
  water.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  water.metallic = 0;
  water.roughness = 0.05;
  water.indexOfRefraction = 1.33;
  water.useRadianceOverAlpha = true;
  water.useSpecularOverAlpha = true;
  water.emissiveColor = Color3.FromHexString("#0a7f8f").toLinearSpace();
  water.emissiveIntensity = 0.2;
  const n1 = ctx.mats.waterNormal("poolNormalA");
  n1.uScale = 0.45;
  n1.vScale = 0.45;
  n1.level = 0.55;
  water.bumpTexture = n1;
  water.invertNormalMapY = true;
  water.clearCoat.isEnabled = true;
  water.clearCoat.intensity = 0.7;
  water.clearCoat.roughness = 0.02;
  const n2 = ctx.mats.waterNormal("poolNormalB");
  n2.uScale = 1.4;
  n2.vScale = 1.4;
  n2.level = 0.4;
  water.clearCoat.bumpTexture = n2;
  water.backFaceCulling = false; // seen from below through the glass edge too
  const surf = polygonFace(L, W, true).add(waterEdge).build("poolWater", ctx.scene);
  surf.material = water;
  surf.alphaIndex = 10;
  ctx.addMesh(surf, z, "Pool water");
  // the catch gutter's water
  const gutterGeo = new Geo();
  for (const run of runs.filter((r) => r.infinity)) gutterGeo.add(hstrip(path(run, OUT + 0.012), path(run, OUT + 0.29), G + 0.165));
  const gutterWater = gutterGeo.build("poolGutterWater", ctx.scene);
  gutterWater.material = water;
  ctx.addMesh(gutterWater, z, "Catch gutter water");

  // ---- caustics: two drifting layers of light on the floor and walls
  const caus = causticsTexture();
  const causGeo = new Geo();
  causGeo.add(polygonFace(L, B + 0.006, true, [], 1 / 1.6));
  for (const run of runs) causGeo.add(ribbonWall([...run.idx.map((i) => off(i, -0.006))].reverse(), B, run.infinity ? YB - 0.01 : W - 0.04, false, 1 / 1.6));
  const layers: [number, number, number][] = [
    [1, 0.018, 0.011],
    [0.73, -0.013, 0.016],
  ];
  layers.forEach(([scale, du, dv], k) => {
    const tex = toTexture(ctx.scene, `poolCaustics${k}`, caus);
    tex.uScale = scale;
    tex.vScale = scale;
    const m = new PBRMaterial(`poolCausticsMat${k}`, ctx.scene);
    m.unlit = true;
    m.albedoColor = Color3.Black();
    m.emissiveTexture = tex;
    m.emissiveColor = new Color3(0.55, 0.9, 0.95);
    m.alpha = 0.45;
    m.alphaMode = Constants.ALPHA_ADD;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.disableDepthWrite = true;
    const mesh = causGeo.build(`poolCaustics${k}`, ctx.scene);
    mesh.material = m;
    mesh.alphaIndex = 1;
    ctx.addMesh(mesh, z, "Pool caustics", { pickable: false, receiveShadow: false });
    ctx.animators.push((t) => {
      tex.uOffset = t * du;
      tex.vOffset = t * dv;
      n1.uOffset = t * 0.02;
      n1.vOffset = t * 0.013;
      n2.uOffset = -t * 0.031;
      n2.vOffset = t * 0.024;
    });
  });

  // underwater glow at night
  ctx.lights.push({ pos: new Vector3(pc.x, W + 0.3, pc.z), color: "#40fff0", day: 0, night: 9, range: 10, rooms: ["poolTerrace", "barLounge", "structure"], level: "upper" });

  // ---- glulam columns under the corner that overhangs the lower deck, braced to the soffit
  // and raked back to the lower deck's ring beam
  const over = L.map((_, i) => {
    const o = off(i, OUT / 2);
    return pointInPolygon(o, lowerDeckLoop) ? 0 : distToLoop(o, lowerDeckLoop);
  });
  const picks: number[] = [];
  for (const i of [...over.keys()].sort((a, b) => over[b] - over[a])) {
    if (over[i] < 1.0 || picks.length >= 3) break;
    if (picks.every((j) => Math.hypot(L[i].x - L[j].x, L[i].z - L[j].z) > 3.2)) picks.push(i);
  }
  const ringBeam = offsetPath(lowerDeckLoop, -1.3, true);
  const sb = ctx.g(zone("structure", "site"), "glulam");
  sb.setLabel("Pool support column");
  for (const i of picks) {
    const c = off(i, OUT / 2 - 0.02);
    const t = tangentAt(L, i, true);
    const base = Math.max(terrainHeight(c.x, c.z) - 0.4, -22);
    sb.add(beam([new Vector3(c.x, base, c.z), new Vector3(c.x, G, c.z)], 0.42, 0.42, { up: new Vector3(t.x, 0, t.z) }));
    ctx.g(zone("structure", "site"), "charcoal").add(beam([new Vector3(c.x, G - 0.05, c.z), new Vector3(c.x, G, c.z)], 0.6, 0.6, { up: new Vector3(t.x, 0, t.z) }), undefined, "Column cap plate");
    for (const sgn of [-1, 1]) {
      const a = new Vector3(c.x, G - 1.9, c.z);
      const b = new Vector3(c.x + t.x * sgn * 1.6, G - 0.08, c.z + t.z * sgn * 1.6);
      sb.add(beam([a, b], 0.24, 0.28), undefined, "Knee brace");
    }
    let q = ringBeam[0];
    for (const p of ringBeam) if (Math.hypot(p.x - c.x, p.z - c.z) < Math.hypot(q.x - c.x, q.z - c.z)) q = p;
    // raked up from low on the column into the lower deck's ring beam, staying under the deck
    sb.add(beam([new Vector3(c.x, -3.8, c.z), new Vector3(q.x, -0.9, q.z)], 0.26, 0.3), undefined, "Raking strut");
  }

  const entry = off(stepIdx[Math.floor(stepIdx.length / 2)], wall + 1.0);
  return { pc, minX, maxX, minZ, maxZ, entry, corners };
}

/** Polyline through (s, y) points with each inner corner rounded off by a quadratic curve of radius about r. */
function roundCorners(pts: [number, number][], r: number, n: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const [px, py] = pts[k - 1];
    const [cx, cy] = pts[k];
    const [nx, ny] = pts[k + 1];
    const la = Math.hypot(cx - px, cy - py);
    const lb = Math.hypot(nx - cx, ny - cy);
    const ra = Math.min(r, la / 2);
    const rb = Math.min(r, lb / 2);
    const ax = cx + ((px - cx) / la) * ra;
    const ay = cy + ((py - cy) / la) * ra;
    const bx = cx + ((nx - cx) / lb) * rb;
    const by = cy + ((ny - cy) / lb) * rb;
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const u = 1 - t;
      out.push([u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
