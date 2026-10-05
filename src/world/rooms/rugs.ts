// Rug materials (each rug has its own painted texture).

import { WorldCtx } from "../context";
import { toTexture } from "../materials/canvas";
import { TexPair, mosaicRugTexture, persianRugTexture, rectRugTexture, roundRugTexture } from "../materials/textures";

function make(ctx: WorldCtx, key: string, gen: () => TexPair, alpha: boolean): string {
  if (ctx.mats.has(key)) return key;
  const p = gen();
  const tex = toTexture(ctx.scene, key, p.albedo, { wrap: false, hasAlpha: alpha });
  const bump = p.normal ? toTexture(ctx.scene, key + "N", p.normal, { wrap: false, linear: true }) : undefined;
  ctx.mats.decal(key, tex, { rough: 0.95, bump, alphaTest: alpha });
  return key;
}

export const rugs = {
  mosaic: (ctx: WorldCtx) => make(ctx, "rug:mosaic", mosaicRugTexture, true),
  loungeJute: (ctx: WorldCtx) =>
    make(ctx, "rug:lounge", () => roundRugTexture({
      base: [200, 162, 112],
      bands: [
        { r0: 0.18, r1: 0.26, color: [47, 111, 106], pattern: "diamonds" },
        { r0: 0.56, r1: 0.68, color: [47, 111, 106], pattern: "zigzag" },
        { r0: 0.8, r1: 0.86, color: [150, 82, 52], pattern: "dots" },
        { r0: 0.92, r1: 0.97, color: [47, 111, 106], pattern: "solid" },
      ],
      seed: 3,
    }), true),
  gameJute: (ctx: WorldCtx) =>
    make(ctx, "rug:game", () => roundRugTexture({
      base: [192, 156, 106],
      bands: [
        { r0: 0.0, r1: 0.52, color: [36, 96, 94], pattern: "solid" },
        { r0: 0.52, r1: 0.58, color: [210, 170, 110], pattern: "stripes" },
        { r0: 0.86, r1: 0.92, color: [36, 96, 94], pattern: "zigzag" },
      ],
      seed: 5,
    }), true),
  smallJute: (ctx: WorldCtx) =>
    make(ctx, "rug:small", () => roundRugTexture({ base: [196, 158, 108], bands: [{ r0: 0.7, r1: 0.8, color: [47, 111, 106], pattern: "dots" }], seed: 9 }), true),
  persian: (ctx: WorldCtx) => make(ctx, "rug:persian", persianRugTexture, false),
  knit: (ctx: WorldCtx) => make(ctx, "rug:knit", () => rectRugTexture([190, 150, 104], null, 4), false),
  knitTeal: (ctx: WorldCtx) => make(ctx, "rug:knitTeal", () => rectRugTexture([176, 140, 96], [47, 111, 106], 6), false),
};
