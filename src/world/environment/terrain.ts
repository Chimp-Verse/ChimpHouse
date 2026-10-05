// Site terrain: a ridge carrying the house, falling steeply at the sides and
// rear into a jungle valley with a lake, ringed by mountains.

import { Color3, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import { fbm2, ridged2 } from "../geometry/noise";
import { Geo } from "../geometry/geo";
import { WorldCtx, zone } from "../context";
import { LEVEL, M, SITE, TREES } from "../layout";

const ANCHOR = TREES.find((t) => t.id === "bridgeAnchor")!;

export const LAKE_LEVEL = -50;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Terrain height at (x, z). A narrow ridge carries the front approach up to
 * the entrance; everywhere else the land falls steeply away so the house
 * stands among the tree trunks and looks out over the jungle canopy.
 */
export function terrainHeight(x: number, z: number): number {
  const top = LEVEL.ground;
  // approach ridge: widest at the house front, narrowing and sloping down to the south
  const zEnd = M(0, 2.5).z;
  const half = M(14, 0).x + Math.max(0, -z - 8 * SITE.k) * 0.12;
  const along = Math.max(0, -z - 30 * SITE.k) * 0.05;
  let dRidge: number;
  if (z <= zEnd) dRidge = Math.max(0, Math.abs(x) - half);
  else dRidge = Math.hypot(Math.max(0, Math.abs(x) - half), z - zEnd);
  let h = top - along - 1.1 * Math.pow(dRidge, 1.15);
  // knoll carrying the bridge anchor tree (west)
  const kd = Math.hypot(x - ANCHOR.x, z - ANCHOR.z);
  h = Math.max(h, -4 - Math.pow(Math.max(0, kd - 6), 1.2) * 1.3);
  // rolling valley floor
  const valley = -40 + fbm2(x * 0.004, z * 0.004, 4) * 26 + fbm2(x * 0.02, z * 0.02, 3) * 6;
  h = -smin(-h, -valley, 16);
  h = Math.max(h, valley);
  // local detail
  h += fbm2(x * 0.05 + 3, z * 0.05, 3) * (0.5 + Math.min(4, dRidge * 0.1));
  // mountain ring
  const r = Math.hypot(x, z);
  const m = smoothstep(380, 1200, r);
  if (m > 0) {
    const ridge = ridged2(x / 520 + 7, z / 520 - 3, 5);
    h += m * (ridge * 430 + fbm2(x / 900, z / 900, 3) * 110);
  }
  return h;
}

function terrainColor(x: number, z: number, h: number, slope: number): [number, number, number] {
  const lush: [number, number, number] = [0.16, 0.3, 0.09];
  const lush2: [number, number, number] = [0.22, 0.38, 0.11];
  const soil: [number, number, number] = [0.33, 0.24, 0.15];
  const rock: [number, number, number] = [0.42, 0.38, 0.42];
  const n = fbm2(x * 0.01, z * 0.01, 3) * 0.5 + 0.5;
  let c = [lush[0] + (lush2[0] - lush[0]) * n, lush[1] + (lush2[1] - lush[1]) * n, lush[2] + (lush2[2] - lush[2]) * n];
  const rk = smoothstep(0.55, 0.9, slope) * (h > 30 ? 1 : 0.6);
  c = c.map((v, i) => v + (rock[i] - v) * rk);
  // bare path area in front of the house
  const path = Math.abs(x) < 2.5 && z < -6 && z > -50 ? 0.35 : 0;
  c = c.map((v, i) => v + (soil[i] - v) * path);
  return c as [number, number, number];
}

export function buildTerrain(ctx: WorldCtx): Mesh {
  const N = 380;
  const R = 3200;
  const g = new Geo();
  const coord = (i: number) => {
    const u = (i / N) * 2 - 1;
    return R * (0.028 * u + 0.972 * Math.sign(u) * Math.pow(Math.abs(u), 2.6));
  };
  const xs = Array.from({ length: N + 1 }, (_, i) => coord(i));
  const H: number[] = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H.push(terrainHeight(xs[i], xs[j]));
  g.col = [];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const x = xs[i];
      const zz = xs[j];
      const h = H[j * (N + 1) + i];
      const hx = H[j * (N + 1) + Math.min(N, i + 1)] - H[j * (N + 1) + Math.max(0, i - 1)];
      const hz = H[Math.min(N, j + 1) * (N + 1) + i] - H[Math.max(0, j - 1) * (N + 1) + i];
      const dx = xs[Math.min(N, i + 1)] - xs[Math.max(0, i - 1)];
      const dz = xs[Math.min(N, j + 1)] - xs[Math.max(0, j - 1)];
      const nrm = new Vector3(-hx / dx, 1, -hz / dz).normalize();
      g.vert(x, h, zz, x * 0.25, zz * 0.25, nrm.x, nrm.y, nrm.z);
      const c = terrainColor(x, zz, h, 1 - nrm.y);
      g.col.push(c[0], c[1], c[2], 1);
    }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      g.tri(a, a + N + 2, a + N + 1);
      g.tri(a, a + 1, a + N + 2);
    }
  const mesh = g.build("terrain", ctx.scene);
  const mat = ctx.mats.get("ground") as PBRMaterial;
  mesh.material = mat;
  ctx.addMesh(mesh, zone("landscape", "site"), "Terrain", { receiveShadow: true });
  mesh.freezeWorldMatrix();
  return mesh;
}

/** Lake surface filling the valley. */
export function buildLake(ctx: WorldCtx): Mesh {
  const lake = MeshBuilder.CreateGround("lake", { width: 6000, height: 6000, subdivisions: 4 }, ctx.scene);
  lake.position.y = LAKE_LEVEL;
  const m = new PBRMaterial("lakeMat", ctx.scene);
  m.albedoColor = Color3.FromHexString("#2b6f78").toLinearSpace();
  m.metallic = 0;
  m.roughness = 0.08;
  m.environmentIntensity = 1.1;
  const bump = ctx.mats.waterNormal("lakeNormal");
  bump.uScale = 120;
  bump.vScale = 120;
  bump.level = 0.35;
  m.bumpTexture = bump;
  m.invertNormalMapY = true;
  m.name = "lake";
  lake.material = m;
  ctx.animators.push((t) => {
    bump.uOffset = t * 0.004;
    bump.vOffset = t * 0.0025;
  });
  ctx.addMesh(lake, zone("landscape", "site"), "Lake", { receiveShadow: false, pickable: true });
  return lake;
}

/**
 * Waterfalls: for each bearing, find the steepest slope on the surrounding
 * hills and drape a scrolling translucent sheet down it, with mist below.
 */
export function buildWaterfalls(ctx: WorldCtx, tex: Texture): void {
  const bearings = [182, 168, 200, 8, 22, 70, 120, 240, 300, 330];
  const t = tex;
  t.vScale = 2;
  const mat = new StandardMaterial("waterfall", ctx.scene);
  mat.disableLighting = true;
  mat.emissiveColor = new Color3(0.95, 0.97, 1.0);
  mat.emissiveTexture = t;
  mat.opacityTexture = t;
  t.hasAlpha = true;
  mat.backFaceCulling = false;
  const mistMat = new StandardMaterial("mistMat", ctx.scene);
  mistMat.disableLighting = true;
  mistMat.emissiveColor = new Color3(0.95, 0.97, 1);
  mistMat.alpha = 0.3;
  for (const deg of bearings) {
    const a = (deg * Math.PI) / 180;
    const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
    // search for the steepest 60 m drop facing the house
    let best = { d: 0, drop: 0 };
    for (let d = 260; d < 900; d += 10) {
      const hTop = terrainHeight(dir.x * d, dir.z * d);
      const hBot = terrainHeight(dir.x * (d - 60), dir.z * (d - 60));
      const drop = hTop - hBot;
      if (drop > best.drop) best = { d, drop };
    }
    if (best.drop < 25) continue;
    const pts: Vector3[] = [];
    for (let s = 0; s <= 60; s += 3) {
      const d = best.d - s;
      const x = dir.x * d;
      const z = dir.z * d;
      pts.push(new Vector3(x, terrainHeight(x, z) + 2.0, z));
    }
    const side = new Vector3(-dir.z, 0, dir.x);
    const w = 10 + (deg % 7) * 2;
    const g = new Geo();
    let len = 0;
    const rows: number[][] = [];
    pts.forEach((p, i) => {
      if (i) len += Vector3.Distance(p, pts[i - 1]);
      const l = p.add(side.scale(-w / 2));
      const r = p.add(side.scale(w / 2));
      rows.push([g.vert(l.x, l.y, l.z, 0, len / 40), g.vert(r.x, r.y, r.z, 1, len / 40)]);
    });
    for (let i = 0; i < rows.length - 1; i++) g.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
    g.computeNormals();
    const mesh = g.build("waterfall", ctx.scene);
    mesh.material = mat;
    ctx.addMesh(mesh, zone("landscape", "site"), "Waterfall", { receiveShadow: false });
    const foot = pts[pts.length - 1];
    const mist = MeshBuilder.CreatePlane("mist", { width: w * 2.5, height: w * 1.2 }, ctx.scene);
    mist.position.set(foot.x, foot.y + w * 0.3, foot.z);
    mist.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mist.material = mistMat;
    ctx.addMesh(mist, zone("landscape", "site"), "Waterfall mist", { receiveShadow: false, pickable: false });
  }
  ctx.animators.push((time) => {
    t.vOffset = time * 0.25;
  });
}
