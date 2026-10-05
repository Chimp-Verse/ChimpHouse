// Fireflies drifting among the planting at night.

import { Color3, Matrix, Mesh, PBRMaterial, Vector3 } from "@babylonjs/core";
import { rng } from "../geometry/curves";
import { sphere } from "../geometry/geo";
import { WorldCtx, zone } from "../context";
import { LEVEL, SITE, lowerDeckLoop } from "../layout";
import { offsetPath, pointInPolygon } from "../geometry/curves";
import { terrainHeight } from "./terrain";
import { VIEWPOINTS } from "../viewpoints";

export function buildFireflies(ctx: WorldCtx): void {
  const r = rng(909);
  const mat = new PBRMaterial("firefly", ctx.scene);
  mat.unlit = true;
  mat.albedoColor = Color3.Black();
  mat.emissiveColor = new Color3(3.2, 3.6, 1.2);
  mat.disableLighting = true;
  const outside = offsetPath(lowerDeckLoop, 0.5, true);
  const cams = VIEWPOINTS.filter((v) => !v.pose.ortho).map((v) => new Vector3(v.pose.x, v.pose.y, v.pose.z));
  for (let g = 0; g < 4; g++) {
    const m: number[] = [];
    let n = 0;
    while (n < 90) {
      const x = SITE.x0 - 10 + r() * (SITE.x1 - SITE.x0 + 20);
      const z = SITE.z0 - 24 + r() * (SITE.z1 - SITE.z0 + 34);
      if (pointInPolygon({ x, z }, outside)) continue;
      const ground = Math.max(terrainHeight(x, z), -6);
      const y = ground + 0.4 + r() * 3.5;
      if (y > LEVEL.upper + 2) continue;
      if (cams.some((c) => Vector3.Distance(c, new Vector3(x, y, z)) < 7)) continue;
      m.push(...Matrix.Translation(x, y, z).asArray());
      n++;
    }
    const mesh: Mesh = sphere(0.035, 6, 4).build(`fireflies${g}`, ctx.scene);
    mesh.material = mat;
    mesh.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, true);
    mesh.thinInstanceRefreshBoundingInfo(false);
    ctx.addMesh(mesh, zone("approach", "site"), "Fireflies", { receiveShadow: false, pickable: false });
    mesh.doNotSyncBoundingInfo = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    ctx.nightOnly.push(mesh);
    const phase = g * 1.7;
    const amp = new Vector3(0.6 + g * 0.2, 0.35, 0.5 + g * 0.15);
    ctx.animators.push((t) => {
      if (!mesh.isEnabled()) return;
      mesh.position.set(Math.sin(t * 0.31 + phase) * amp.x, Math.sin(t * 0.53 + phase * 2) * amp.y, Math.cos(t * 0.27 + phase) * amp.z);
    });
  }
}
