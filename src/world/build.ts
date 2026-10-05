import { loadChimpVibeMark } from "./props/lettering3d";
import { Scene } from "@babylonjs/core";
import { WorldCtx } from "./context";
import { Materials } from "./materials/library";
import { fontsReady } from "./materials/canvas";
import { buildFacades } from "./structure/facades";
import { buildEntrance } from "./structure/entrance";
import { buildTrees } from "./environment/trees";
import { buildStairs } from "./structure/stairs";
import { buildEdges } from "./structure/edges";
import { buildApproach } from "./environment/approach";
import { buildLowerRooms } from "./rooms/lower";
import { buildBridge } from "./environment/bridge";
import { buildJungle } from "./environment/jungle";
import { buildFireflies } from "./environment/fireflies";
import { buildUpperRooms } from "./rooms/upper";
import { buildFloors, buildRoofs } from "./structure/floors";
import { buildLake, buildTerrain, buildWaterfalls } from "./environment/terrain";
import { Sky } from "./environment/sky";
import { toTexture } from "./materials/canvas";
import { waterfallTexture } from "./materials/textures";

export interface World {
  ctx: WorldCtx;
  mats: Materials;
  sky: Sky;
}

export type Progress = (fraction: number, message: string) => Promise<void>;

/** Build the whole ChimpHouse scene. */
export async function buildWorld(scene: Scene, progress: Progress): Promise<World> {
  await fontsReady(["700 64px Cinzel", "500 64px Montserrat", "600 64px Montserrat", "700 64px Montserrat", "800 64px Nunito"]);
  await loadChimpVibeMark();
  const mats = new Materials(scene);
  let step = 0;
  const steps = 18;
  const tick = async (msg: string) => progress(Math.min(0.98, ++step / steps), msg);
  await mats.init(tick);
  const ctx = new WorldCtx(scene, mats);
  const sky = new Sky(scene);

  await tick("Laying floors and slabs…");
  buildFloors(ctx);
  await tick("Glazing the pavilions…");
  buildFacades(ctx);
  await tick("Raising roofs and the atrium dome…");
  buildRoofs(ctx);
  await tick("Raising the great arches…");
  buildEntrance(ctx);
  await tick("Building stairs and railings…");
  buildStairs(ctx);
  buildEdges(ctx);
  await tick("Furnishing the lower rooms…");
  buildLowerRooms(ctx);
  await tick("Furnishing the upper rooms…");
  buildUpperRooms(ctx);
  await tick("Growing the living trees…");
  buildTrees(ctx);
  await tick("Stringing the canopy bridge…");
  buildBridge(ctx);
  await tick("Planting the approach…");
  buildApproach(ctx);

  await tick("Shaping the ridge and valley…");
  buildTerrain(ctx);
  buildLake(ctx);
  buildWaterfalls(ctx, toTexture(scene, "waterfall", waterfallTexture(), { hasAlpha: true }));
  await tick("Growing the jungle…");
  buildJungle(ctx);
  buildFireflies(ctx);

  await tick("Finishing…");
  ctx.finalize();
  return { ctx, mats, sky };
}
