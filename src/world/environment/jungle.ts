// Distant jungle: thousands of instanced lumpy tree crowns on the valley and
// mountain slopes, plus mid-distance emergent trees around the house.

import { Color3, Matrix, Mesh, PBRMaterial, Quaternion, Vector3 } from "@babylonjs/core";
import { pointInPolygon, offsetPath, rng } from "../geometry/curves";
import { fbm2 } from "../geometry/noise";
import { sphere } from "../geometry/geo";
import { WorldCtx, zone } from "../context";
import { BRIDGE, SITE, lowerDeckLoop } from "../layout";
import { VIEWPOINTS } from "../viewpoints";
import { toTexture } from "../materials/canvas";
import { canopyTexture } from "../materials/textures";
import { LAKE_LEVEL, terrainHeight } from "./terrain";
import { buildTree } from "./trees";

function distToLoop(x: number, z: number, loop: { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

function crownGeo(seed: number) {
  const g = sphere(1, 14, 10, 0.75);
  for (let i = 0; i < g.pos.length; i += 3) {
    const x = g.pos[i];
    const y = g.pos[i + 1];
    const z = g.pos[i + 2];
    const n = fbm2(x * 1.8 + seed, z * 1.8 + y * 1.3, 3) * 0.32 + Math.max(0, fbm2(x * 4 + seed, y * 4, 2)) * 0.12;
    const k = 1 + n;
    g.pos[i] = x * k;
    g.pos[i + 1] = y * k + (y < 0 ? y * 0.2 : 0);
    g.pos[i + 2] = z * k;
    g.uv[(i / 3) * 2] *= 3;
    g.uv[(i / 3) * 2 + 1] *= 2;
  }
  return g.computeNormals();
}

export function buildJungle(ctx: WorldCtx): void {
  const z = zone("jungle", "site");
  const r = rng(4242);
  const tex = canopyTexture();
  const a = toTexture(ctx.scene, "canopy", tex.albedo);
  const n = toTexture(ctx.scene, "canopyN", tex.normal!, { linear: true });
  const mat = new PBRMaterial("jungleCanopy", ctx.scene);
  mat.albedoTexture = a;
  mat.bumpTexture = n;
  mat.bumpTexture.level = 1.2;
  mat.invertNormalMapY = true;
  mat.roughness = 0.85;
  mat.metallic = 0;
  mat.albedoColor = new Color3(1, 1, 1);
  ctx.mats.add("jungleCanopy", mat);

  const avoid = offsetPath(lowerDeckLoop, 4, true);
  // keep sight lines clear: around exterior viewpoint cameras and along the bridge
  const cams = VIEWPOINTS.filter((v) => !v.pose.ortho).map((v) => ({ x: v.pose.x, y: v.pose.y, z: v.pose.z }));
  const blocked = (x: number, zz: number, top: number) => {
    for (const c of cams) if (Math.hypot(x - c.x, zz - c.z) < 16 && top > c.y - 3) return true;
    const bx0 = BRIDGE.end.x - 4;
    const bx1 = BRIDGE.start.x;
    if (x > bx0 && x < bx1 && Math.abs(zz - (BRIDGE.start.z + BRIDGE.end.z) / 2) < 7 && top > BRIDGE.start.y - 4) return true;
    // the house should look over the canopy: crowns near it stay below the lower floor
    const near = Math.max(0, Math.hypot(x - SITE.cx, zz - SITE.cz) - SITE.r) + 20;
    if (near < 70 && top > -1 - (70 - near) * 0.05) return true;
    return false;
  };
  const sectors = 10;
  const buckets: number[][] = Array.from({ length: sectors }, () => []);
  const colors: number[][] = Array.from({ length: sectors }, () => []);
  const placeAt = (x: number, y: number, zz: number, s: number) => {
    const ang = Math.atan2(zz, x);
    const sec = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * sectors) % sectors;
    const m = Matrix.Compose(new Vector3(s * (0.95 + r() * 0.3), s * 0.85, s * (0.95 + r() * 0.3)), Quaternion.RotationYawPitchRoll(r() * 6.28, 0, 0), new Vector3(x, y, zz));
    buckets[sec].push(...m.asArray());
    const tint = 0.8 + r() * 0.35;
    colors[sec].push(tint, tint * 1.03, tint * 0.88, 1);
  };
  const place = (x: number, zz: number, s: number) => {
    const h = terrainHeight(x, zz);
    if (h < LAKE_LEVEL + 1) return;
    if (blocked(x, zz, h + s * 1.35)) return;
    const ang = Math.atan2(zz, x);
    const sec = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * sectors) % sectors;
    const m = Matrix.Compose(new Vector3(s * (0.9 + r() * 0.3), s * (0.75 + r() * 0.35), s * (0.9 + r() * 0.3)), Quaternion.RotationYawPitchRoll(r() * 6.28, 0, 0), new Vector3(x, h + s * 0.55, zz));
    buckets[sec].push(...m.asArray());
    const tint = 0.75 + r() * 0.4;
    const yellow = r() > 0.85 ? 0.15 : 0;
    colors[sec].push(tint * (0.95 + yellow), tint * (1.0 + yellow * 0.5), tint * 0.9, 1);
  };
  // near-mid ring
  for (let i = 0; i < 6500; i++) {
    const d = SITE.r * 0.9 + Math.pow(r(), 1.5) * 520;
    const ang = r() * Math.PI * 2;
    const x = Math.cos(ang) * d;
    const zz = Math.sin(ang) * d;
    if (pointInPolygon({ x, z: zz }, avoid)) continue;
    // keep the front approach path open
    if (zz < -6 && zz > -70 && Math.abs(x) < 9 + (-zz) * 0.08) continue;
    place(x, zz, 4 + r() * 5 + d * 0.014);
  }
  // far ring and mountain slopes
  for (let i = 0; i < 3800; i++) {
    const d = 520 + Math.pow(r(), 1.2) * 1500;
    const ang = r() * Math.PI * 2;
    const x = Math.cos(ang) * d;
    const zz = Math.sin(ang) * d;
    const h = terrainHeight(x, zz);
    if (h > 260 && r() > 0.3) continue;
    place(x, zz, 10 + r() * 14);
  }
  // understorey canopy filling the space beneath and around the house, so the
  // posts disappear into foliage and the decks look out over treetops
  const deck = offsetPath(lowerDeckLoop, -0.5, true);
  for (let x = SITE.x0 - 4; x <= SITE.x1 + 4; x += 2.6) {
    for (let zz = SITE.z0 - 3; zz <= SITE.z1 + 6; zz += 2.6) {
      const px = x + (r() - 0.5) * 2;
      const pz = zz + (r() - 0.5) * 2;
      const g = terrainHeight(px, pz);
      if (g > -5) continue;
      const inside = pointInPolygon({ x: px, z: pz }, deck);
      const d = inside ? 0 : distToLoop(px, pz, deck);
      if (d > 14) continue;
      // crown tops sit 2.5-4 m below the lower deck close in, lower further out
      const s = 3.2 + r() * 2.2;
      const topY = -3.2 - r() * 1.6 - d * 0.25;
      const cy = topY - s * 0.95;
      if (cy - s < g) continue;
      placeAt(px, cy, pz, s);
    }
  }

  const base = crownGeo(3);
  for (let s = 0; s < sectors; s++) {
    if (!buckets[s].length) continue;
    const mesh: Mesh = base.build(`jungleCrowns${s}`, ctx.scene);
    mesh.material = mat;
    mesh.thinInstanceSetBuffer("matrix", new Float32Array(buckets[s]), 16, true);
    mesh.thinInstanceSetBuffer("color", new Float32Array(colors[s]), 4, true);
    mesh.thinInstanceRefreshBoundingInfo(false);
    ctx.addMesh(mesh, z, "Jungle canopy", { receiveShadow: true, pickable: false });
    mesh.freezeWorldMatrix();
  }

  // emergent trees around the house
  const spots: [number, number][] = [
    [-36, -10], [-40, 24], [-30, 36], [-14, 46], [16, 48], [34, 34], [42, 12], [38, -14], [-24, -26], [26, -24], [-50, -4], [52, 24],
  ];
  spots.forEach(([sx, sz], i) => {
    const x = SITE.cx + sx * SITE.k;
    const zz = SITE.cz + (sz - 9) * SITE.k;
    const h = terrainHeight(x, zz);
    buildTree(ctx, { id: `emergent${i}`, name: "Jungle tree", x, z: zz, r: 0.9 + r() * 0.6, base: h, top: h + 16 + r() * 10, lean: (r() - 0.5) * 0.3, seed: 300 + i }, { limbs: 4, reach: [5, 9], vines: 2, density: 0.9 });
  });
}
