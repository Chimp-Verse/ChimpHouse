// Front approach: stepping-stone path through gravel, mossy boulders and
// dense tropical planting around the stair and under the decks.

import { Vector3 } from "@babylonjs/core";
import { P2, offsetPath, pointInPolygon, resample, rng, smoothPath } from "../geometry/curves";
import { fbm2 } from "../geometry/noise";
import { Geo, lathe, polygonFace, sphere, xf } from "../geometry/geo";
import { WorldCtx, zone } from "../context";
import { M, SITE, lowerDeckLoop } from "../layout";

const T = (x: number, z: number): [number, number] => {
  const p = M(x, z);
  return [p.x, p.z];
};
import { PlantKind, bed, plant } from "../props/plants";
import { FRONT_LANDING_Z } from "../structure/stairs";
import { terrainHeight } from "./terrain";

/** Lumpy boulder (noise-displaced sphere). */
export function rockGeo(radius: number, seed: number, squash = 0.65): Geo {
  const g = sphere(radius, 20, 14, squash);
  for (let i = 0; i < g.pos.length; i += 3) {
    const x = g.pos[i];
    const y = g.pos[i + 1];
    const z = g.pos[i + 2];
    const n = fbm2(x * 1.3 / radius + seed, z * 1.3 / radius + y * 0.7 / radius, 3) * 0.28 + fbm2(x * 4 / radius, y * 4 / radius + seed, 2) * 0.06;
    const k = 1 + n;
    g.pos[i] = x * k;
    g.pos[i + 1] = y * k;
    g.pos[i + 2] = z * k;
  }
  return g.computeNormals();
}

/** Flat irregular stepping stone. */
function stoneGeo(w: number, d: number, seed: number): Geo {
  const prof: [number, number][] = [
    [0.01, 0.0],
    [0.92, 0.0],
    [1.0, 0.05],
    [0.97, 0.1],
    [0.0, 0.11],
  ];
  const g = lathe(prof, 18, false, false);
  for (let i = 0; i < g.pos.length; i += 3) {
    const a = Math.atan2(g.pos[i + 2], g.pos[i]);
    const k = 1 + fbm2(Math.cos(a) * 1.5 + seed, Math.sin(a) * 1.5, 2) * 0.25;
    g.pos[i] *= k * w;
    g.pos[i + 2] *= k * d;
  }
  return g.computeNormals();
}

export function buildApproach(ctx: WorldCtx): void {
  const z = zone("approach", "site");
  const r = rng(2024);
  // stepping stone path winding south from the stair
  const bottom = FRONT_LANDING_Z - 12 * 0.46;
  const pathCtrl: P2[] = [
    { x: 0, z: bottom - 0.4 },
    { x: 0.4, z: bottom - 5 },
    { x: -0.8, z: bottom - 11 },
    { x: 0.6, z: bottom - 18 },
    { x: 2.5, z: bottom - 27 },
    { x: 1.0, z: bottom - 40 },
  ];
  const centre = smoothPath(pathCtrl, 8);
  const pts = resample(centre, 0.85);
  const stones = ctx.g(z, "stepStone");
  stones.setLabel("Stepping stones");
  pts.forEach((p, i) => {
    const off = (i % 2 ? 1 : -1) * 0.18;
    const w = 0.55 + r() * 0.25;
    const d = 0.38 + r() * 0.15;
    const y = terrainHeight(p.x, p.z) + 0.02;
    stones.add(stoneGeo(w, d, i * 3.1), xf(p.x + off, y, p.z, r() * Math.PI));
    if (r() > 0.5) stones.add(stoneGeo(0.3, 0.25, i * 7.3), xf(p.x - off * 3, y, p.z + (r() - 0.5) * 0.4, r() * 3));
  });
  // gravel strip (slightly lighter ground) along the path
  const left = offsetPath(centre, -1.25);
  const right = offsetPath(centre, 1.25);
  const gravelLoop = [...right, ...left.reverse()];
  const gv = polygonFace(gravelLoop, 0, true);
  for (let i = 0; i < gv.pos.length; i += 3) gv.pos[i + 1] = terrainHeight(gv.pos[i], gv.pos[i + 2]) + 0.015;
  gv.paint(0.62, 0.58, 0.52);
  ctx.g(z, "ground", { castShadow: false }).add(gv, undefined, "Gravel path");

  // boulders along the path and around the deck base
  const rocks = ctx.g(z, "rock");
  rocks.setLabel("Mossy boulder");
  const rockSpots: [number, number, number][] = [
    [-3.6, bottom - 1.5, 1.1],
    [-5.2, bottom + 0.8, 1.4],
    [3.9, bottom - 1.2, 1.0],
    [5.8, bottom + 0.5, 1.5],
    [-2.6, bottom - 6, 0.9],
    [3.2, bottom - 7.5, 1.2],
    [-4.8, bottom - 9, 1.6],
    [5.5, bottom - 12, 1.1],
    [-3.5, bottom - 15, 1.3],
    [...T(-9.06, -4.38), 1.6],
    [...T(9.69, -5.0), 1.4],
    [...T(-14.06, -5.25), 1.2],
    [...T(15.31, -5.75), 1.5],
    [...T(-19.69, -3.75), 1.3],
    [...T(20.94, -4.25), 1.1],
  ];
  for (const [x, zz, s] of rockSpots) {
    const y = terrainHeight(x, zz);
    rocks.add(rockGeo(s, x * 0.37 + zz), xf(x, y - s * 0.15, zz, r() * 6, 1, 1, 1));
    for (let k = 0; k < 2; k++) {
      const a = r() * Math.PI * 2;
      const rr = s * (0.25 + r() * 0.3);
      const xx = x + Math.cos(a) * (s + rr);
      const z2 = zz + Math.sin(a) * (s + rr);
      rocks.add(rockGeo(rr, xx + z2), xf(xx, terrainHeight(xx, z2) - rr * 0.2, z2, r() * 6));
    }
  }

  // planting: under and in front of the lower decks, flanking stair and path
  const plantY = (p: P2) => terrainHeight(p.x, p.z);
  const kinds: PlantKind[] = ["monstera", "fern", "palm", "bromeliad", "elephant", "cordyline", "philodendron", "banana", "calathea", "croton"];
  const front: P2[] = [];
  for (let x = SITE.x0 - 1.5; x <= SITE.x1 + 1.5; x += 1.1) {
    for (let zz = SITE.z0 - 5; zz <= 1.5; zz += 1.1) {
      const p = { x: x + (r() - 0.5) * 0.8, z: zz + (r() - 0.5) * 0.8 };
      if (Math.abs(p.x) < 3.6 && p.z > bottom - 1) continue; // stair
      if (Math.abs(p.x - centre[0].x) < 1.6 && p.z < bottom) continue; // path
      if (pointInPolygon(p, offsetPath(lowerDeckLoop, -1.2, true))) continue;
      if (r() > 0.72) continue;
      front.push(p);
    }
  }
  bed(ctx, z, front, plantY, r, kinds, [0.9, 1.7]);
  // path borders
  for (const p of resample(centre, 1.2)) {
    for (const side of [-1, 1]) {
      if (r() > 0.75) continue;
      const q = { x: p.x + side * (1.6 + r() * 2.5), z: p.z + (r() - 0.5) };
      plant(ctx, z, new Vector3(q.x, plantY(q), q.z), kinds[Math.floor(r() * kinds.length)], 0.8 + r() * 0.9, r);
    }
  }
  // ground cover further out
  for (let i = 0; i < 260; i++) {
    const p = { x: (r() - 0.5) * 70 * SITE.k, z: SITE.z0 - 6 - r() * 40 };
    if (Math.abs(p.x - 0.5) < 2.2) continue;
    plant(ctx, z, new Vector3(p.x, plantY(p), p.z), r() > 0.5 ? "fern" : r() > 0.5 ? "grass" : "mixed", 0.8 + r() * 1.2, r);
  }
}
