import {
  Color3,
  Constants,
  Material,
  PBRMaterial,
  RawTexture,
  Scene,
  Texture,
} from "@babylonjs/core";
import { makeCanvas, toTexture } from "./canvas";
import { leafAtlasData } from "./leaves";
import {
  TexPair,
  barkTexture,
  boardsTexture,
  brushedTexture,
  fabricTexture,
  glulamTexture,
  groundTexture,
  knitTexture,
  latticeTexture,
  poolTileTexture,
  slatsTexture,
  stoneTexture,
  waterNormalTexture,
  woodGrainTexture,
} from "./textures";

/** House palette (sRGB hex). */
export const PALETTE = {
  teal: "#1f6f6c",
  tealDeep: "#17524f",
  tealBright: "#2a8a86",
  mustard: "#d8a133",
  rust: "#c4552e",
  coral: "#d86a43",
  sage: "#6d8c58",
  cream: "#efe4cc",
  charcoal: "#24272b",
  mint: "#6ff7c6",
  amber: "#ffb25e",
  honey: "#d39a5a",
  walnut: "#6a4128",
};

export type MatKey =
  | "floor"
  | "deck"
  | "slats"
  | "slatsDark"
  | "glulam"
  | "timber"
  | "timberDark"
  | "timberPale"
  | "panelHoney"
  | "panelDark"
  | "acoustic"
  | "charcoal"
  | "black"
  | "steel"
  | "chrome"
  | "brass"
  | "glass"
  | "glassRail"
  | "glassBooth"
  | "mint"
  | "amberStrip"
  | "bulb"
  | "lattice"
  | "teal"
  | "tealDeep"
  | "tealBright"
  | "mustard"
  | "rust"
  | "coral"
  | "sage"
  | "cream"
  | "white"
  | "leatherBlack"
  | "jute"
  | "juteCream"
  | "juteTeal"
  | "bark"
  | "rock"
  | "stoneWhite"
  | "stepStone"
  | "ground"
  | "leaves"
  | "poolTile"
  | "counterTop"
  | "terracotta"
  | "potCream"
  | "potCharcoal"
  | "soil"
  | "red"
  | "rope"
  | "canvas"
  | "screenOff"
  | "darkPanel";

export class Materials {
  readonly map = new Map<string, Material>();
  readonly textures: Record<string, Texture> = {};
  /** materials that should feed the glow layer */
  readonly glowing = new Set<string>(["mint", "amberStrip", "bulb", "lattice"]);

  private waterNormalCanvas: HTMLCanvasElement | null = null;

  constructor(readonly scene: Scene) {}

  /** A fresh water-ripple normal texture (own scale/offset) sharing one canvas. */
  waterNormal(name: string): Texture {
    if (!this.waterNormalCanvas) this.waterNormalCanvas = waterNormalTexture();
    return toTexture(this.scene, name, this.waterNormalCanvas, { linear: true });
  }

  get(key: MatKey | string): Material {
    const m = this.map.get(key);
    if (!m) throw new Error(`Unknown material ${key}`);
    return m;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  add(key: string, m: Material): Material {
    m.name = key;
    this.map.set(key, m);
    return m;
  }

  /** Generic PBR helper. */
  pbr(
    key: string,
    o: {
      color?: string | Color3;
      tex?: Texture;
      bump?: Texture;
      bumpLevel?: number;
      rough?: number;
      metal?: number;
      emissive?: string | Color3;
      emissiveTex?: Texture;
      emissiveIntensity?: number;
      alpha?: number;
      alphaTest?: boolean;
      twoSided?: boolean;
      vertexColors?: boolean;
      clearCoat?: number;
      sheen?: number;
    },
  ): PBRMaterial {
    const m = new PBRMaterial(key, this.scene);
    m.albedoColor = toColor(o.color ?? "#ffffff");
    if (o.tex) m.albedoTexture = o.tex;
    if (o.bump) {
      m.bumpTexture = o.bump;
      m.bumpTexture.level = o.bumpLevel ?? 1;
      m.invertNormalMapY = true;
    }
    m.roughness = o.rough ?? 0.7;
    m.metallic = o.metal ?? 0;
    if (o.emissive) {
      m.emissiveColor = toColor(o.emissive);
      m.emissiveIntensity = o.emissiveIntensity ?? 1;
    }
    if (o.emissiveTex) m.emissiveTexture = o.emissiveTex;
    if (o.alpha !== undefined) {
      m.alpha = o.alpha;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    }
    if (o.alphaTest) {
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
      m.alphaCutOff = 0.45;
      m.useAlphaFromAlbedoTexture = true;
      if (m.albedoTexture) m.albedoTexture.hasAlpha = true;
    }
    if (o.twoSided) {
      m.backFaceCulling = false;
      m.twoSidedLighting = true;
    }
    void o.vertexColors; // PBR picks up mesh vertex colours automatically
    if (o.clearCoat) {
      m.clearCoat.isEnabled = true;
      m.clearCoat.intensity = o.clearCoat;
      m.clearCoat.roughness = 0.15;
    }
    if (o.sheen) {
      m.sheen.isEnabled = true;
      m.sheen.intensity = o.sheen;
      m.sheen.color = Color3.White();
    }
    m.maxSimultaneousLights = 8;
    return this.add(key, m) as PBRMaterial;
  }

  /** Unlit emissive (LED strips, screens, signs). Output = colour x texture, in linear HDR. */
  unlit(key: string, o: { color?: string | Color3; tex?: Texture; alpha?: number; alphaTest?: boolean; intensity?: number; twoSided?: boolean }): PBRMaterial {
    const m = new PBRMaterial(key, this.scene);
    m.unlit = true;
    m.albedoColor = Color3.Black();
    m.emissiveColor = toColor(o.color ?? "#ffffff").scale(o.intensity ?? 1);
    if (o.tex) {
      m.emissiveTexture = o.tex;
      if (o.alphaTest || o.alpha !== undefined) {
        m.albedoTexture = o.tex;
        m.useAlphaFromAlbedoTexture = true;
        o.tex.hasAlpha = true;
      }
    }
    if (o.alpha !== undefined) {
      m.alpha = o.alpha;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    }
    if (o.alphaTest) {
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
      m.alphaCutOff = 0.4;
    }
    if (o.twoSided) m.backFaceCulling = false;
    return this.add(key, m) as PBRMaterial;
  }

  async init(progress: (msg: string) => Promise<void>): Promise<void> {
    const s = this.scene;
    const T = (name: string, c: HTMLCanvasElement, scale: number, linear = false) => {
      const t = toTexture(s, name, c, { linear });
      t.uScale = 1 / scale;
      t.vScale = 1 / scale;
      this.textures[name] = t;
      return t;
    };
    const pair = (name: string, p: TexPair, scale: number) => ({
      a: T(name, p.albedo, scale),
      n: p.normal ? T(name + "N", p.normal, scale, true) : undefined,
    });

    await progress("Milling timber…");
    const floor = pair(
      "planks",
      boardsTexture({ boards: 12, lengths: [0.45, 0.95], base: [214, 146, 78], vary: 0.09, gap: 1.2, gapColor: [92, 52, 26], grain: 1, seed: 21 }),
      2.4,
    );
    const deck = pair(
      "decking",
      boardsTexture({ size: 1024, boards: 14, lengths: [0.5, 1.0], base: [190, 122, 66], vary: 0.1, gap: 3, gapColor: [48, 30, 18], grain: 1.3, seed: 33 }),
      2.0,
    );
    const slats = pair("slats", slatsTexture({ slats: 10, gapFrac: 0.26, base: [206, 140, 74], vary: 0.07, gapColor: [58, 34, 18], seed: 4 }), 0.8);
    const slatsDark = pair("slatsDark", slatsTexture({ slats: 12, gapFrac: 0.3, base: [140, 86, 48], vary: 0.06, gapColor: [30, 20, 14], seed: 8 }), 0.8);
    const panel = pair("panel", slatsTexture({ slats: 16, gapFrac: 0.22, base: [206, 142, 78], vary: 0.06, gapColor: [60, 36, 20], seed: 12, vertical: true }), 1);
    const panelDark = pair("panelDark", slatsTexture({ slats: 16, gapFrac: 0.3, base: [118, 72, 42], vary: 0.06, gapColor: [22, 16, 12], seed: 14, vertical: true }), 1);
    const glulam = pair("glulam", glulamTexture(), 1);
    const grain = pair("grain", woodGrainTexture([206, 146, 84]), 1);
    const grainDark = pair("grainDark", woodGrainTexture([112, 68, 40], 4), 1);
    const grainPale = pair("grainPale", woodGrainTexture([222, 172, 112], 6), 1);

    this.pbr("floor", { tex: floor.a, bump: floor.n, bumpLevel: 0.5, rough: 0.32, clearCoat: 0.35 });
    this.pbr("deck", { tex: deck.a, bump: deck.n, bumpLevel: 0.9, rough: 0.6 });
    this.pbr("slats", { tex: slats.a, bump: slats.n, bumpLevel: 1.2, rough: 0.62 });
    this.pbr("slatsDark", { tex: slatsDark.a, bump: slatsDark.n, bumpLevel: 1.2, rough: 0.6 });
    this.pbr("panelHoney", { tex: panel.a, bump: panel.n, bumpLevel: 1.1, rough: 0.6 });
    this.pbr("panelDark", { tex: panelDark.a, bump: panelDark.n, bumpLevel: 1.1, rough: 0.6 });
    this.pbr("glulam", { tex: glulam.a, bump: glulam.n, bumpLevel: 0.5, rough: 0.42, clearCoat: 0.2 });
    this.pbr("timber", { tex: grain.a, bump: grain.n, bumpLevel: 0.3, rough: 0.45 });
    this.pbr("timberDark", { tex: grainDark.a, bump: grainDark.n, bumpLevel: 0.3, rough: 0.45 });
    this.pbr("timberPale", { tex: grainPale.a, bump: grainPale.n, bumpLevel: 0.3, rough: 0.45 });

    await progress("Weaving fabrics…");
    const fabric = pair("fabric", fabricTexture(1), 0.22);
    const knit = pair("knit", knitTexture(), 0.25);
    const fab = (key: string, color: string, rough = 0.85) =>
      this.pbr(key, { color, tex: fabric.a, bump: fabric.n, bumpLevel: 0.6, rough, sheen: 0.4 });
    fab("teal", PALETTE.teal);
    fab("tealDeep", PALETTE.tealDeep);
    fab("tealBright", PALETTE.tealBright);
    fab("mustard", PALETTE.mustard);
    fab("rust", PALETTE.rust);
    fab("coral", PALETTE.coral);
    fab("sage", PALETTE.sage);
    fab("cream", PALETTE.cream);
    fab("plum", "#6a3d7e");
    fab("navy", "#24365a");
    this.pbr("jute", { color: "#c49a64", tex: knit.a, bump: knit.n, bumpLevel: 1, rough: 0.95 });
    this.pbr("juteCream", { color: "#e6d6b6", tex: knit.a, bump: knit.n, bumpLevel: 1, rough: 0.95 });
    this.pbr("juteTeal", { color: "#3f8a86", tex: knit.a, bump: knit.n, bumpLevel: 1, rough: 0.95 });
    this.pbr("canvas", { color: "#f1e8d6", tex: fabric.a, rough: 0.9, twoSided: true });
    this.pbr("rope", { color: "#c9a774", tex: knit.a, bump: knit.n, rough: 0.95 });

    await progress("Growing bark and stone…");
    const bark = pair("bark", barkTexture(), 3.0);
    this.pbr("bark", { tex: bark.a, bump: bark.n, bumpLevel: 1.4, rough: 0.92 });
    const rock = pair("rock", stoneTexture([142, 136, 124], 0.2), 2.5);
    this.pbr("rock", { tex: rock.a, bump: rock.n, bumpLevel: 1.2, rough: 0.9 });
    const stoneW = pair("stoneW", stoneTexture([226, 222, 212], -0.4, 3), 1.5);
    this.pbr("stoneWhite", { tex: stoneW.a, bump: stoneW.n, bumpLevel: 0.6, rough: 0.7 });
    const stepStone = pair("stepStone", stoneTexture([170, 164, 150], -0.15, 5), 1.2);
    this.pbr("stepStone", { tex: stepStone.a, bump: stepStone.n, bumpLevel: 0.8, rough: 0.85 });
    const ground = pair("ground", groundTexture(), 4);
    this.pbr("ground", { tex: ground.a, bump: ground.n, bumpLevel: 0.8, rough: 0.95, vertexColors: true });

    await progress("Painting leaves…");
    const atlas = leafAtlasData();
    const leafTex = RawTexture.CreateRGBATexture(atlas.data, atlas.size, atlas.size, s, true, true, Texture.TRILINEAR_SAMPLINGMODE);
    leafTex.hasAlpha = true;
    leafTex.wrapU = Texture.CLAMP_ADDRESSMODE;
    leafTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    leafTex.anisotropicFilteringLevel = 4;
    this.textures.leaves = leafTex;
    const leaves = this.pbr("leaves", { tex: leafTex, rough: 0.55, alphaTest: true, twoSided: true });
    leaves.alphaCutOff = 0.5;
    leaves.subSurface.isTranslucencyEnabled = true;
    leaves.subSurface.translucencyIntensity = 0.6;
    leaves.subSurface.tintColor = Color3.FromHexString("#b8e05a");

    await progress("Glazing and metalwork…");
    this.pbr("charcoal", { color: PALETTE.charcoal, rough: 0.42, metal: 0.55 });
    this.pbr("black", { color: "#111214", rough: 0.35, metal: 0.1 });
    const brushed = T("brushed", brushedTexture(), 0.5);
    this.pbr("steel", { color: "#c9c9c4", tex: brushed, rough: 0.32, metal: 0.95 });
    this.pbr("chrome", { color: "#e8e8e8", rough: 0.12, metal: 1 });
    this.pbr("brass", { color: "#c8a15a", rough: 0.3, metal: 1 });
    const glass = this.pbr("glass", { color: "#f4fbf8", rough: 0.04, metal: 0, alpha: 0.12 });
    glass.indexOfRefraction = 1.5;
    glass.environmentIntensity = 0.9;
    glass.backFaceCulling = false;
    glass.useRadianceOverAlpha = true;
    glass.useSpecularOverAlpha = true;
    const rail = this.pbr("glassRail", { color: "#eef8f4", rough: 0.05, alpha: 0.16 });
    rail.backFaceCulling = false;
    rail.useRadianceOverAlpha = true;
    const booth = this.pbr("glassBooth", { color: "#e6f2ee", rough: 0.05, alpha: 0.2 });
    booth.backFaceCulling = false;

    this.unlit("mint", { color: PALETTE.mint, intensity: 1.6 });
    this.unlit("amberStrip", { color: "#ffb766", intensity: 1.5 });
    this.unlit("bulb", { color: "#ffcf8a", intensity: 2.2 });
    const lattice = toTexture(s, "lattice", latticeTexture(), { hasAlpha: true });
    this.textures.lattice = lattice;
    const lat = this.pbr("lattice", { tex: lattice, rough: 0.8, alphaTest: true, twoSided: true, emissive: "#ff9a3c", emissiveIntensity: 0.55 });
    lat.emissiveTexture = lattice;

    this.pbr("white", { color: "#f3f1ea", rough: 0.5 });
    this.pbr("stem", { color: "#55782e", rough: 0.75 });
    this.pbr("leatherBlack", { color: "#1b1a1a", rough: 0.45, clearCoat: 0.3 });
    this.pbr("counterTop", { color: "#e9e1d0", tex: stoneW.a, rough: 0.3, clearCoat: 0.4 });
    this.pbr("terracotta", { color: "#b5653d", rough: 0.85 });
    this.pbr("potCream", { color: "#e8e1d2", tex: stoneW.a, rough: 0.6 });
    this.pbr("potCharcoal", { color: "#3a3b3b", tex: stoneW.a, rough: 0.6 });
    this.pbr("soil", { color: "#3e2a1c", tex: ground.a, rough: 1 });
    this.pbr("red", { color: "#c81d1d", rough: 0.25, clearCoat: 0.8 });
    this.pbr("screenOff", { color: "#0d0f12", rough: 0.15, metal: 0.2 });
    this.pbr("darkPanel", { color: "#2a2724", tex: fabric.a, rough: 0.9 });
    this.pbr("acoustic", { color: "#3a3532", tex: fabric.a, bump: fabric.n, rough: 0.95 });

    // pool mosaic: 2.5 cm glass tiles inside, a deep blue waterline band, aqua on the outer walls
    const tile = pair("poolTile", poolTileTexture([34, 178, 196], [86, 214, 222], [196, 228, 226]), 0.8);
    const pt = this.pbr("poolTile", { tex: tile.a, bump: tile.n, bumpLevel: 0.5, rough: 0.18, clearCoat: 0.5, emissive: "#0d6d70", emissiveIntensity: 0.18 });
    pt.emissiveTexture = tile.a;
    const band = pair("poolTileBand", poolTileTexture([14, 74, 112], [28, 112, 150], [150, 190, 200]), 0.8);
    this.pbr("poolTileBand", { tex: band.a, bump: band.n, bumpLevel: 0.5, rough: 0.15, clearCoat: 0.6 });
    const outer = pair("poolTileOuter", poolTileTexture([58, 186, 178], [130, 222, 206], [210, 236, 230], 24), 0.8);
    this.pbr("poolTileOuter", { tex: outer.a, bump: outer.n, bumpLevel: 0.5, rough: 0.2, clearCoat: 0.5 });
    this.pbr("coping", { color: "#ece4d3", tex: fabric.a, bump: fabric.n, bumpLevel: 0.15, rough: 0.6 });

    this.waterNormalCanvas = waterNormalTexture();
    this.textures.waterNormal = this.waterNormal("waterNormal");
  }

  /** A per-image unlit screen/sign material. */
  screen(key: string, tex: Texture, intensity = 1): PBRMaterial {
    if (this.map.has(key)) return this.map.get(key) as PBRMaterial;
    return this.unlit(key, { tex, intensity });
  }

  /** Material with a decal-like texture (rugs, signs) lit normally. */
  decal(key: string, tex: Texture, o: { rough?: number; bump?: Texture; alphaTest?: boolean; emissive?: string; emissiveIntensity?: number } = {}): PBRMaterial {
    if (this.map.has(key)) return this.map.get(key) as PBRMaterial;
    const m = this.pbr(key, { tex, bump: o.bump, rough: o.rough ?? 0.9, alphaTest: o.alphaTest, emissive: o.emissive, emissiveIntensity: o.emissiveIntensity });
    if (o.emissive) m.emissiveTexture = tex;
    return m;
  }
}

export function toColor(c: string | Color3): Color3 {
  return typeof c === "string" ? Color3.FromHexString(c).toLinearSpace() : c;
}

/** Load an image file into a texture (screens extracted from references). */
export function loadImageTexture(scene: Scene, url: string): Texture {
  const t = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  return t;
}

export { Constants, makeCanvas };
