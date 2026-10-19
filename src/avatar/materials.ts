// The chimp's materials: Babylon's PBR material, so the chimp is lit as the house
// is (the sun, the room lights, the sky's reflections, shadows, fog), with two
// plugins that draw what is particular to it.
//
// - Skin: the colours come from the DNA as uniforms and are mixed per pixel from
//   what avatar/anatomy.ts painted on each vertex (bare or furred, palm, lips,
//   nails, the shade of creases), so changing a colour never rebuilds a mesh.
// - Fur: shells. The fur's carrier mesh is drawn several times (thin instances, one
//   draw call), each copy pushed a little further out along the skin's normal and
//   combed along its flow. Each shell keeps only the pixels where a strand reaches
//   that high, from a 3D strand pattern looked up at the root, so the strands rise
//   straight through the shells, thin toward their tips and lie the way the fur does.
// - Both fade with a dither (screen-door), for when the camera comes too close.

import { Color3, Constants, DynamicTexture, MaterialPluginBase, PBRMaterial, RawTexture3D, Scene, Texture, Vector4, type MaterialDefines, type UniformBuffer } from "@babylonjs/core";
import { type PrintArt, STACKED, drawWord, printAspect } from "./wordmark";
import type { Fabric } from "./items";

/** The DNA's colours, as the materials want them (linear). */
export interface ChimpColours {
  fur: Color3;
  furTips: Color3;
  skin: Color3;
  palms: Color3;
  eye: Color3;
}

export function linear(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace();
}

const DITHER = /* glsl */ `
float chimpBayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  // the 4x4 Bayer matrix, as a lookup on its index
  float b = 0.0;
  if (i < 1.0) b = 0.0; else if (i < 2.0) b = 8.0; else if (i < 3.0) b = 2.0; else if (i < 4.0) b = 10.0;
  else if (i < 5.0) b = 12.0; else if (i < 6.0) b = 4.0; else if (i < 7.0) b = 14.0; else if (i < 8.0) b = 6.0;
  else if (i < 9.0) b = 3.0; else if (i < 10.0) b = 11.0; else if (i < 11.0) b = 1.0; else if (i < 12.0) b = 9.0;
  else if (i < 13.0) b = 15.0; else if (i < 14.0) b = 7.0; else if (i < 15.0) b = 13.0; else b = 5.0;
  return (b + 0.5) / 16.0;
}
`;

/** The skin: bare where the face, ears, hands and feet are, the fur's root colour under the fur. */
export class ChimpSkinPlugin extends MaterialPluginBase {
  furRoot = new Color3(0.02, 0.015, 0.012);
  grey = new Color3(0.6, 0.57, 0.52);
  skin = new Color3(0.6, 0.38, 0.28);
  palms = new Color3(0.2, 0.13, 0.1);
  lip = new Color3(0.35, 0.15, 0.13);
  /** how grey the beard is (the DNA's beard) */
  beard = 0.25;
  /** 1 fully shown, 0 gone (dithered between) */
  fade = 1;

  constructor(material: PBRMaterial) {
    super(material, "ChimpSkin", 200, { CHIMPSKIN: false });
    this._enable(true);
  }

  getClassName(): string {
    return "ChimpSkinPlugin";
  }

  prepareDefines(defines: MaterialDefines): void {
    defines.CHIMPSKIN = true;
  }

  getAttributes(attributes: string[]): void {
    attributes.push("chimpPaintA", "chimpPaintB");
  }

  getUniforms() {
    return {
      ubo: [
        { name: "chimpFurRoot", size: 3, type: "vec3" },
        { name: "chimpGrey", size: 3, type: "vec3" },
        { name: "chimpSkin", size: 3, type: "vec3" },
        { name: "chimpPalms", size: 3, type: "vec3" },
        { name: "chimpLip", size: 3, type: "vec3" },
        { name: "chimpBeard", size: 1, type: "float" },
        { name: "chimpFade", size: 1, type: "float" },
      ],
      fragment: "uniform vec3 chimpFurRoot; uniform vec3 chimpGrey; uniform vec3 chimpSkin; uniform vec3 chimpPalms; uniform vec3 chimpLip; uniform float chimpBeard; uniform float chimpFade;",
    };
  }

  bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateColor3("chimpFurRoot", this.furRoot);
    ubo.updateColor3("chimpGrey", this.grey);
    ubo.updateColor3("chimpSkin", this.skin);
    ubo.updateColor3("chimpPalms", this.palms);
    ubo.updateColor3("chimpLip", this.lip);
    ubo.updateFloat("chimpBeard", this.beard);
    ubo.updateFloat("chimpFade", this.fade);
  }

  getCustomCode(shaderType: string): { [point: string]: string } | null {
    if (shaderType === "vertex")
      return {
        CUSTOM_VERTEX_DEFINITIONS: "#ifdef CHIMPSKIN\nattribute vec4 chimpPaintA;\nattribute vec4 chimpPaintB;\nvarying vec4 vChimpA;\nvarying vec4 vChimpB;\n#endif",
        CUSTOM_VERTEX_MAIN_END: "#ifdef CHIMPSKIN\nvChimpA = chimpPaintA;\nvChimpB = chimpPaintB;\n#endif",
      };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef CHIMPSKIN\nvarying vec4 vChimpA;\nvarying vec4 vChimpB;\n${DITHER}\n#endif`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: /* glsl */ `#ifdef CHIMPSKIN
if (chimpFade < 0.999 && chimpBayer(gl_FragCoord.xy) > chimpFade) discard;
// creases, and the inside of the mouth, see little of the sky's or the lamps' highlights
float chimpSpecOcc = vChimpB.y * vChimpB.y * (1.0 - smoothstep(0.5, 0.9, vChimpB.w));
{
  float fur = vChimpA.x;
  float palm = vChimpA.z;
  float dark = vChimpA.w;
  float grey = clamp(vChimpB.x * chimpBeard * 1.6, 0.0, 1.0);
  float ao = vChimpB.y;
  float nail = vChimpB.z;
  float mouth = vChimpB.w;
  vec3 skin = mix(chimpSkin, chimpPalms, palm);
  // the skin round the eyes and in the ears is darker, and a little redder
  skin = mix(skin, skin * vec3(0.5, 0.4, 0.38), dark * 0.8);
  // nails: paler and greyer than the skin round them
  skin = mix(skin, mix(skin, vec3(0.42, 0.36, 0.33), 0.55), nail);
  // the lips, then the dark inside of the mouth
  skin = mix(skin, chimpLip, smoothstep(0.08, 0.38, mouth));
  skin = mix(skin, vec3(0.03, 0.008, 0.008), smoothstep(0.55, 0.9, mouth));
  vec3 under = mix(chimpFurRoot, chimpGrey * 0.55, grey);
  // the skin shows between the few strands at a hairline; the coat's dark root only under thick fur
  surfaceAlbedo = mix(skin, under, smoothstep(0.55, 0.95, fur)) * mix(0.3, 1.0, ao * ao);
}
#endif`,
      // bare skin is smoother than the matted coat under the fur; lips are wet; nails shine; the mouth's inside is dull
      "!float roughness=reflectivityOut\\.roughness;": `float roughness=reflectivityOut.roughness;
#ifdef CHIMPSKIN
roughness = mix(mix(0.52, 0.82, smoothstep(0.55, 0.95, vChimpA.x)), 0.34, max(smoothstep(0.1, 0.4, vChimpB.w) * 0.7, vChimpB.z));
roughness = mix(roughness, 0.95, smoothstep(0.55, 0.9, vChimpB.w));
#endif`,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* glsl */ `#ifdef CHIMPSKIN
#ifdef REFLECTION
finalRadianceScaled *= chimpSpecOcc;
#endif
#ifdef SPECULARTERM
finalSpecularScaled *= chimpSpecOcc;
#endif
#ifdef SHEEN
finalSheenScaled *= chimpSpecOcc;
#endif
#endif`,
    };
  }
}

/** Fur shells (see the file's note). */
export class ChimpFurPlugin extends MaterialPluginBase {
  root = new Color3(0.02, 0.015, 0.012);
  tip = new Color3(0.08, 0.05, 0.035);
  grey = new Color3(0.6, 0.57, 0.52);
  beard = 0.25;
  /** fur length in metres (rest space), before each region's own length */
  length = 0.02;
  /** the strand pattern's tiles per metre (16 strands across a tile): coarse, as a chimp's hair is */
  density = 13;
  /** how far the tips are combed along the flow, as a share of the length */
  comb = 0.85;
  /** how far the tips droop under their weight, as a share of the length */
  droop = 0.35;
  fade = 1;
  noise: Texture | null = null;

  constructor(material: PBRMaterial) {
    super(material, "ChimpFur", 210, { CHIMPFUR: false });
    this._enable(true);
  }

  getClassName(): string {
    return "ChimpFurPlugin";
  }

  prepareDefines(defines: MaterialDefines): void {
    defines.CHIMPFUR = true;
  }

  getAttributes(attributes: string[]): void {
    attributes.push("chimpFur", "chimpFlow", "chimpShell", "chimpCover");
  }

  getSamplers(samplers: string[]): void {
    samplers.push("chimpStrands");
  }

  getUniforms() {
    return {
      ubo: [
        { name: "chimpRoot", size: 3, type: "vec3" },
        { name: "chimpTip", size: 3, type: "vec3" },
        { name: "chimpGreyFur", size: 3, type: "vec3" },
        { name: "chimpFurBeard", size: 1, type: "float" },
        { name: "chimpLength", size: 1, type: "float" },
        { name: "chimpDensity", size: 1, type: "float" },
        { name: "chimpComb", size: 1, type: "float" },
        { name: "chimpDroop", size: 1, type: "float" },
        { name: "chimpFurFade", size: 1, type: "float" },
      ],
      vertex: "uniform float chimpLength; uniform float chimpComb; uniform float chimpDroop;",
      fragment:
        "uniform vec3 chimpRoot; uniform vec3 chimpTip; uniform vec3 chimpGreyFur; uniform float chimpFurBeard; uniform float chimpDensity; uniform float chimpFurFade; uniform float chimpLength;",
    };
  }

  bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateColor3("chimpRoot", this.root);
    ubo.updateColor3("chimpTip", this.tip);
    ubo.updateColor3("chimpGreyFur", this.grey);
    ubo.updateFloat("chimpFurBeard", this.beard);
    ubo.updateFloat("chimpLength", this.length);
    ubo.updateFloat("chimpDensity", this.density);
    ubo.updateFloat("chimpComb", this.comb);
    ubo.updateFloat("chimpDroop", this.droop);
    ubo.updateFloat("chimpFurFade", this.fade);
    if (this.noise) ubo.setTexture("chimpStrands", this.noise);
  }

  getCustomCode(shaderType: string): { [point: string]: string } | null {
    if (shaderType === "vertex")
      return {
        CUSTOM_VERTEX_DEFINITIONS: "#ifdef CHIMPFUR\nattribute vec4 chimpFur;\nattribute vec4 chimpFlow;\nattribute float chimpShell;\nattribute float chimpCover;\nvarying vec3 vChimpRoot;\nvarying vec4 vChimpFur;\nvarying float vChimpT;\n#endif",
        // out along the normal, combed along the flow more toward the tip (before skinning, so it bends with the body)
        CUSTOM_VERTEX_UPDATE_POSITION: /* glsl */ `#ifdef CHIMPFUR
vChimpRoot = positionUpdated;
// what is worn over the fur (avatar/items.ts cover): up to about 0.8 it presses the fur down,
// shorter the more (round a strap, under a hat's brim); fully covered (under cloth) there is none
vChimpFur = vec4(chimpFur.x * (1.0 - smoothstep(0.82, 0.95, chimpCover)), chimpFur.yzw);
vChimpT = chimpShell;
float chimpL = chimpLength * chimpFur.y * (1.0 - 0.92 * smoothstep(0.0, 0.82, chimpCover));
positionUpdated += (normalUpdated * chimpShell + chimpFlow.xyz * (chimpShell * chimpShell * chimpComb)) * chimpL;
#endif`,
        // tips droop under their weight, whichever way the body is turned
        CUSTOM_VERTEX_UPDATE_WORLDPOS: /* glsl */ `#ifdef CHIMPFUR
worldPos.y -= chimpShell * chimpShell * chimpLength * chimpFur.y * chimpDroop;
vPositionW = vec3(worldPos);
#endif`,
      };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef CHIMPFUR\nprecision highp sampler3D;\nuniform sampler3D chimpStrands;\nvarying vec3 vChimpRoot;\nvarying vec4 vChimpFur;\nvarying float vChimpT;\n${DITHER}\n#endif`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: /* glsl */ `#ifdef CHIMPFUR
if (chimpFurFade < 0.999 && chimpBayer(gl_FragCoord.xy) > chimpFurFade) discard;
// deep in the coat the highlights are as hidden as the light
float chimpSpecOcc = mix(0.25, 1.0, vChimpT) * vChimpFur.w;
{
  // the strand at this root: how near its middle we are, its own length, its shade, and
  // whether it grows here at all (fewer strands toward the face's edge, not shorter ones).
  // Toward its tip each strand leans with its neighbours, from a slow drift through the
  // same pattern, so the hair gathers into locks rather than standing like a brush's.
  float t = vChimpT;
  vec3 lock = texture(chimpStrands, vChimpRoot * chimpDensity * 0.13 + vec3(0.37)).rgb - 0.5;
  vec4 s = texture(chimpStrands, vChimpRoot * chimpDensity + lock * (t * t * 1.6));
  float amount = vChimpFur.x;
  float reach = s.g;
  // a clean edge where the fur stops (the carrier's triangles are too big for a fade), thinning just inside it
  // strands stay full most of the way out, thinning to their tips: a shaggy outline, not a velvet one
  float up = t / max(reach, 0.01);
  if (amount < 0.5 || s.a > amount * 1.6 - 0.5 || t > reach || s.r < 0.12 + 0.62 * up * up) discard;
  float grey = clamp(vChimpFur.z * chimpFurBeard * 1.6, 0.0, 1.0);
  vec3 root = mix(chimpRoot, chimpGreyFur * 0.6, grey);
  vec3 tip = mix(chimpTip, chimpGreyFur, grey);
  vec3 col = mix(root, tip, pow(t / max(reach, 0.01), 1.2)) * (0.78 + 0.44 * s.b);
  // deep in the coat and in the creases the light doesn't reach
  col *= mix(0.4, 1.0, t) * mix(0.55, 1.0, vChimpFur.w);
  surfaceAlbedo = col;
}
#endif`,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* glsl */ `#ifdef CHIMPFUR
#ifdef REFLECTION
finalRadianceScaled *= chimpSpecOcc;
#endif
#ifdef SPECULARTERM
finalSpecularScaled *= chimpSpecOcc;
#endif
#endif`,
    };
  }
}

/** How a fabric takes the light, and which grain the cloth shader gives it (see FABRICS). */
export interface FabricLook {
  /** the shader's grain: 1 jersey, 2 fleece, 3 twill, 4 ribbed knit, 5 chunky knit, 6 plain weave, 7 canvas, 8 webbing, 9 leather */
  grain: number;
  rough: number;
  /** the soft sheen of fibres in a grazing light: how strong, how spread, and how near white (0: the cloth's own colour, lighter) */
  sheen: number;
  sheenRough: number;
  sheenTint: number;
  /** its reflection head-on, as a share of a smooth dielectric's 4% (fibres scatter most of it away) */
  f0: number;
  /** its folds' sizes, repeats per metre: a drape's along it and across it, creases' along a limb and round it */
  folds: [number, number, number, number];
  /** yarn's fuzz: a fine speckle of fibres, seen close to */
  fuzz: number;
}

/**
 * Each fabric. Cotton jersey is matt with a soft sheen; fleece is softer and sheenier, its folds
 * broader; twill a little firmer and smoother; knits the most matt; canvas and webbing (nylon) a
 * little glossier; leather glossier still, with no sheen.
 */
export const FABRICS: Record<Fabric, FabricLook> = {
  jersey: { grain: 1, rough: 0.9, sheen: 0.35, sheenRough: 0.45, sheenTint: 0.2, f0: 0.45, folds: [7, 12, 18, 6], fuzz: 0 },
  fleece: { grain: 2, rough: 0.95, sheen: 0.55, sheenRough: 0.55, sheenTint: 0.3, f0: 0.35, folds: [6, 10, 14, 5], fuzz: 0.3 },
  twill: { grain: 3, rough: 0.82, sheen: 0.35, sheenRough: 0.38, sheenTint: 0.3, f0: 0.55, folds: [7, 12, 16, 6], fuzz: 0 },
  rib: { grain: 4, rough: 0.92, sheen: 0.35, sheenRough: 0.45, sheenTint: 0.2, f0: 0.45, folds: [5, 21, 24, 7], fuzz: 0 },
  knit: { grain: 5, rough: 0.97, sheen: 0.5, sheenRough: 0.6, sheenTint: 0.3, f0: 0.35, folds: [5, 18, 20, 6], fuzz: 0.25 },
  plain: { grain: 6, rough: 0.86, sheen: 0.4, sheenRough: 0.4, sheenTint: 0.3, f0: 0.5, folds: [5, 22, 24, 7], fuzz: 0 },
  canvas: { grain: 7, rough: 0.84, sheen: 0.25, sheenRough: 0.4, sheenTint: 0.25, f0: 0.6, folds: [5, 18, 20, 6], fuzz: 0 },
  webbing: { grain: 8, rough: 0.74, sheen: 0.3, sheenRough: 0.35, sheenTint: 0.25, f0: 0.7, folds: [5, 18, 20, 6], fuzz: 0 },
  leather: { grain: 9, rough: 0.5, sheen: 0, sheenRough: 0.3, sheenTint: 0, f0: 1, folds: [5, 18, 20, 6], fuzz: 0 },
};

/** Gradient noise with its derivatives (after Inigo Quilez): the value in x, its gradient in yzw. */
const NOISE = /* glsl */ `
vec3 chimpHash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
vec4 chimpNoised(vec3 x) {
  vec3 i = floor(x);
  vec3 w = fract(x);
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * w * w * (w * (w - 2.0) + 1.0);
  vec3 ga = chimpHash3(i + vec3(0.0, 0.0, 0.0));
  vec3 gb = chimpHash3(i + vec3(1.0, 0.0, 0.0));
  vec3 gc = chimpHash3(i + vec3(0.0, 1.0, 0.0));
  vec3 gd = chimpHash3(i + vec3(1.0, 1.0, 0.0));
  vec3 ge = chimpHash3(i + vec3(0.0, 0.0, 1.0));
  vec3 gf = chimpHash3(i + vec3(1.0, 0.0, 1.0));
  vec3 gg = chimpHash3(i + vec3(0.0, 1.0, 1.0));
  vec3 gh = chimpHash3(i + vec3(1.0, 1.0, 1.0));
  float va = dot(ga, w - vec3(0.0, 0.0, 0.0));
  float vb = dot(gb, w - vec3(1.0, 0.0, 0.0));
  float vc = dot(gc, w - vec3(0.0, 1.0, 0.0));
  float vd = dot(gd, w - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, w - vec3(0.0, 0.0, 1.0));
  float vf = dot(gf, w - vec3(1.0, 0.0, 1.0));
  float vg = dot(gg, w - vec3(0.0, 1.0, 1.0));
  float vh = dot(gh, w - vec3(1.0, 1.0, 1.0));
  return vec4(
    va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * (va - vb - vc + vd) + u.y * u.z * (va - vc - ve + vg) + u.z * u.x * (va - vb - ve + vf) + (-va + vb + vc - vd + ve - vf - vg + vh) * u.x * u.y * u.z,
    ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf) + (-ga + gb + gc - gd + ge - gf - gg + gh) * u.x * u.y * u.z +
      du * (vec3(vb, vc, ve) - va + u.yzx * vec3(va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf) + u.zxy * vec3(va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg) + u.yzx * u.zxy * (-va + vb + vc - vd + ve - vf - vg + vh)));
}
`;

/** The cloth shader's helpers: a thin line's coverage, a fabric's grain, a seam's look. */
const CLOTH_HELPERS = /* glsl */ `
// how much of a line, hw either side of 0, covers a pixel w across: a line finer than a pixel fades rather than flickers
float chimpLine(float d, float hw, float w) {
  w = max(w, 1e-6);
  return (1.0 - smoothstep(hw - 0.5 * w, hw + 0.5 * w, abs(d))) * min(1.0, 2.0 * hw / w);
}
// a fabric's grain where it lies across a plane (u across the cloth, v down it, metres), as its slopes
// along u and v; faded out where it is finer than the pixels (px metres across), and (lost) how much was
vec2 chimpGrain2(float g, vec2 q, float px, out float lost) {
  const float TAU = 6.2831853;
  vec2 s = vec2(0.0);
  lost = 0.0;
  if (g < 0.5) return s;
  if (g < 2.5) {
    // jersey (and, softer, fleece): fine wales down the cloth, faint courses across them
    float f = 1.0 - smoothstep(0.2, 0.45, px / 0.0012);
    float k = g < 1.5 ? 0.15 : 0.07;
    s = vec2(cos(q.x * TAU / 0.0012), 0.35 * cos(q.y * TAU / 0.001)) * k * f;
    lost = 1.0 - f;
  } else if (g < 3.5) {
    // twill: ribs rising to the right
    float f = 1.0 - smoothstep(0.2, 0.45, px / 0.0016);
    float c = cos((q.x + 0.6 * q.y) * TAU / 0.0016) * 0.22 * f;
    s = vec2(c, 0.6 * c);
    lost = 1.0 - f;
  } else if (g > 5.5 && g < 7.5) {
    // plain weave, fine (cotton) or coarse (canvas): threads across and along
    float P = g < 6.5 ? 0.0009 : 0.0021;
    float f = 1.0 - smoothstep(0.2, 0.45, px / P);
    s = vec2(cos(q.x * TAU / P), cos(q.y * TAU / P)) * (g < 6.5 ? 0.15 : 0.3) * f;
    lost = 1.0 - f;
  }
  return s;
}
// a seam's look at d metres from it (w metres across a pixel) in style s (avatar/items.ts seamStyle), with
// run how far along it (rw across a pixel): its height's slope along d (x), its crease's shadow (y), its thread (z)
vec3 chimpSeamLook(float d, float w, float s, float run, float rw) {
  vec3 o = vec3(0.0);
  if (s < 0.5 || w > 0.02) return o;
  float ad = abs(d);
  if (s < 3.5) {
    // the crease where it is sewn (1.1 mm, 0.45 mm deep), and a ridge either side (the seam's allowance under it)
    float c = d / 0.0011;
    float crease = exp(-c * c);
    float t0 = clamp((ad - 0.0008) / 0.0014, 0.0, 1.0);
    float t1 = clamp((ad - 0.0035) / 0.004, 0.0, 1.0);
    float r0 = t0 * t0 * (3.0 - 2.0 * t0);
    float r1 = 1.0 - t1 * t1 * (3.0 - 2.0 * t1);
    float dr = sign(d) * (6.0 * t0 * (1.0 - t0) / 0.0014 * r1 - r0 * 6.0 * t1 * (1.0 - t1) / 0.004);
    o.x = (0.00045 * 2.0 * c * crease / 0.0011 + 0.00022 * dr) * (1.0 - smoothstep(0.0012, 0.003, w));
    o.y = 0.3 * crease * (1.0 - 0.6 * smoothstep(0.0012, 0.004, w));
  }
  if (s > 1.5 && s < 2.5) {
    // a patch sewn on (a pocket): its double cloth stands a little proud of the cloth round it
    float t = clamp((d + 0.0015) / 0.003, 0.0, 1.0);
    o.x += 0.0006 * 6.0 * t * (1.0 - t) / 0.003 * (1.0 - smoothstep(0.0012, 0.003, w));
  }
  // its stitches: one row 4 mm to its positive side (2), two at 3 and 9 mm (3), or one on it (4)
  float rows = 0.0;
  if (s > 1.5 && s < 2.5) rows = chimpLine(d - 0.004, 0.0003, w);
  else if (s > 2.5 && s < 3.5) rows = max(chimpLine(d - 0.003, 0.0003, w), chimpLine(d - 0.009, 0.0003, w));
  else if (s > 3.5) rows = chimpLine(d, 0.0003, w);
  o.z = rows * mix(0.58, step(0.42, fract(run / 0.003)), 1.0 - smoothstep(0.15, 0.35, rw / 0.003)) * (1.0 - step(0.02, rw)) * mix(1.0, 0.35, smoothstep(0.0006, 0.0015, w));
  return o;
}
`;

/**
 * Clothes and the things a chimp wears: two colours (the body of the thing, and its bands:
 * cuffs, hems, a cap's button); what the cloth is (FABRICS), for how it takes the light and
 * the grain of its surface (a tee's jersey, a pair of shorts' twill, ribbed cuffs, a pack's
 * canvas, a strap's webbing, leather), laid on from the rest pose's position so it stays put
 * on the cloth as the chimp moves; the folds it falls into; its seams, hems and stitching;
 * a print (the ChimpVibe tree and word on a tee's chest) projected from the front; and a
 * pattern all over (a bandana's). The grain, the folds and the seams are drawn as the light
 * catches them (the surface's normal is tipped by their slopes) and fade, to the cloth's
 * own roughness, where they are finer than the pixels.
 *
 * The mesh's chimpCloth attribute says, per vertex: on a band (x), how far the cloth's edge
 * is in metres (y: for stitching along it), how open to the light it is (z), and how far
 * along the edge (or round a ribbed band) it is in metres, plus 10 (w: 0 for neither). A
 * garment's also carry its folds (chimpFold) and its seams (chimpSeam): avatar/items.ts
 * ItemMesh folds and seamLines.
 */
export class ChimpClothPlugin extends MaterialPluginBase {
  main = new Color3(0.1, 0.1, 0.1);
  band = new Color3(0.05, 0.05, 0.05);
  /** the print's two inks: its main one (the tree, "vibe"), and one that stands out from the cloth ("chimp") */
  printColour = new Color3(0.47, 0.85, 0.67);
  printColour2 = new Color3(0.9, 0.92, 0.95);
  /** the print's middle and half size (x, y, half width, half height), rest space; a half width of 0 is no print */
  printRect = new Vector4(0, 0, 0, 0);
  /**
   * a crown's panel seams: the axis they meet on (x, z, rest space), how many, and their turn; 0 of them is none.
   * A negative count is a knitted hat's ribs instead: that many round the same axis, meeting at its crown.
   */
  seams = new Vector4(0, 0, 0, 0);
  /** yarn's fuzz (a bobble): 0 smooth, 1 a fine speckle of fibres */
  fuzz = 0;
  /** a printed pattern all over, in the band colour: 0 none, 1 a bandana's paisley, dots and border */
  pattern = 0;
  /** the fabric's grain (FabricLook grain; 0 none: plastic) and its folds' sizes */
  grain = 0;
  foldSizes = new Vector4(5, 21, 24, 7);
  /** rows of stitches along its edges: the first's distance in, between rows, how many (0 none), a stitch's length */
  stitch = new Vector4(0, 0, 0, 0.003);
  /** how each of a garment's three seams is made, and its rule (avatar/items.ts seamStyle) */
  seamStyle = new Vector4(0, 0, 0, 0);
  /** a hem turned up inside: how deep (metres; 0 none) */
  hem = 0;
  fade = 1;
  private printTex: Texture | null = null;
  private hasFolds = false;
  private hasSeams = false;

  constructor(material: PBRMaterial) {
    super(material, "ChimpCloth", 220, { CHIMPCLOTH: false, CHIMPPRINT: false, CHIMPFOLD: false, CHIMPSEAM: false });
    this._enable(true);
  }

  /**
   * The print's artwork (printTexture), or none. Cloth without a print has no print in its
   * shader at all: a sampler with no texture bound reads whatever an earlier draw left on its
   * unit, and when that is the very image being drawn into, WebGL refuses the whole draw call
   * (INVALID_OPERATION), so the garment silently isn't drawn.
   */
  get print(): Texture | null {
    return this.printTex;
  }

  set print(t: Texture | null) {
    if (!!t !== !!this.printTex) this.markAllDefinesAsDirty();
    this.printTex = t;
  }

  /** Whether its mesh carries folds (chimpFold) and seams (chimpSeam): a garment's does. */
  setSewn(folds: boolean, seams: boolean): void {
    if (folds === this.hasFolds && seams === this.hasSeams) return;
    this.hasFolds = folds;
    this.hasSeams = seams;
    this.markAllDefinesAsDirty();
  }

  /** Take on a fabric's grain and folds (the material's light it takes in clothMaterial). */
  setFabric(look: FabricLook): void {
    this.grain = look.grain;
    this.foldSizes.set(...look.folds);
    this.fuzz = Math.max(this.fuzz, look.fuzz);
  }

  getClassName(): string {
    return "ChimpClothPlugin";
  }

  prepareDefines(defines: MaterialDefines): void {
    defines.CHIMPCLOTH = true;
    defines.CHIMPPRINT = !!this.printTex;
    defines.CHIMPFOLD = this.hasFolds;
    defines.CHIMPSEAM = this.hasSeams;
  }

  getAttributes(attributes: string[]): void {
    attributes.push("chimpCloth");
    if (this.hasFolds) attributes.push("chimpFold");
    if (this.hasSeams) attributes.push("chimpSeam");
  }

  getSamplers(samplers: string[]): void {
    samplers.push("chimpPrint");
  }

  getUniforms() {
    return {
      ubo: [
        { name: "chimpMain", size: 3, type: "vec3" },
        { name: "chimpBand", size: 3, type: "vec3" },
        { name: "chimpInk", size: 3, type: "vec3" },
        { name: "chimpInk2", size: 3, type: "vec3" },
        { name: "chimpSeams", size: 4, type: "vec4" },
        { name: "chimpFuzz", size: 1, type: "float" },
        { name: "chimpPattern", size: 1, type: "float" },
        { name: "chimpPrintRect", size: 4, type: "vec4" },
        { name: "chimpGrain", size: 1, type: "float" },
        { name: "chimpFoldSizes", size: 4, type: "vec4" },
        { name: "chimpStitch", size: 4, type: "vec4" },
        { name: "chimpSeamStyle", size: 4, type: "vec4" },
        { name: "chimpHem", size: 1, type: "float" },
        { name: "chimpClothFade", size: 1, type: "float" },
      ],
      fragment:
        "uniform vec3 chimpMain; uniform vec3 chimpBand; uniform vec3 chimpInk; uniform vec3 chimpInk2; uniform vec4 chimpSeams; uniform float chimpFuzz; uniform float chimpPattern; uniform vec4 chimpPrintRect; uniform float chimpGrain; uniform vec4 chimpFoldSizes; uniform vec4 chimpStitch; uniform vec4 chimpSeamStyle; uniform float chimpHem; uniform float chimpClothFade;",
    };
  }

  bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateColor3("chimpMain", this.main);
    ubo.updateColor3("chimpBand", this.band);
    ubo.updateColor3("chimpInk", this.printColour);
    ubo.updateColor3("chimpInk2", this.printColour2);
    ubo.updateVector4("chimpSeams", this.seams);
    ubo.updateFloat("chimpFuzz", this.fuzz);
    ubo.updateFloat("chimpPattern", this.pattern);
    ubo.updateVector4("chimpPrintRect", this.printRect);
    ubo.updateFloat("chimpGrain", this.grain);
    ubo.updateVector4("chimpFoldSizes", this.foldSizes);
    ubo.updateVector4("chimpStitch", this.stitch);
    ubo.updateVector4("chimpSeamStyle", this.seamStyle);
    ubo.updateFloat("chimpHem", this.hem);
    ubo.updateFloat("chimpClothFade", this.fade);
    if (this.printTex) ubo.setTexture("chimpPrint", this.printTex);
  }

  getCustomCode(shaderType: string): { [point: string]: string } | null {
    if (shaderType === "vertex")
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef CHIMPCLOTH
attribute vec4 chimpCloth;
varying vec4 vChimpCloth;
varying vec3 vChimpRest;
varying vec3 vChimpRestN;
#ifdef CHIMPFOLD
attribute vec4 chimpFold;
varying vec4 vChimpFold;
#endif
#ifdef CHIMPSEAM
attribute vec4 chimpSeam;
varying vec4 vChimpSeam;
#endif
#endif`,
        CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef CHIMPCLOTH
vChimpCloth = chimpCloth;
vChimpRest = positionUpdated;
vChimpRestN = normalUpdated;
#ifdef CHIMPFOLD
vChimpFold = chimpFold;
#endif
#ifdef CHIMPSEAM
vChimpSeam = chimpSeam;
#endif
#endif`,
      };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef CHIMPCLOTH
#ifdef CHIMPPRINT
uniform sampler2D chimpPrint;
#endif
varying vec4 vChimpCloth;
varying vec3 vChimpRest;
varying vec3 vChimpRestN;
#ifdef CHIMPFOLD
varying vec4 vChimpFold;
#endif
#ifdef CHIMPSEAM
varying vec4 vChimpSeam;
#endif
${DITHER}
${NOISE}
${CLOTH_HELPERS}
#endif`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: /* glsl */ `#ifdef CHIMPCLOTH
// how things change across the pixel, wanted before anything is discarded (a pixel's neighbours make them)
vec3 chimpDpx = dFdx(vPositionW);
vec3 chimpDpy = dFdy(vPositionW);
vec3 chimpDrx = dFdx(vChimpRest);
vec3 chimpDry = dFdy(vChimpRest);
vec4 chimpDcx = dFdx(vChimpCloth);
vec4 chimpDcy = dFdy(vChimpCloth);
#ifdef CHIMPSEAM
vec4 chimpDsx = dFdx(vChimpSeam);
vec4 chimpDsy = dFdy(vChimpSeam);
#endif
if (chimpClothFade < 0.999 && chimpBayer(gl_FragCoord.xy) > chimpClothFade) discard;
float chimpSpecOcc = vChimpCloth.z;
// roughness the grain gives where it is too fine to draw
float chimpRoughAdd = 0.0;
{
  vec3 rn = normalize(vChimpRestN);
  // a pixel's size on the cloth, metres
  float px = max(length(chimpDrx), length(chimpDry));
  // the cloth's height, by its slopes: in rest space (grain, folds), and per pixel (seams, ribs, hems: their
  // distances' change across it), metres
  vec3 grad = vec3(0.0);
  float hx = 0.0;
  float hy = 0.0;
  // how deep in a fold's valley (0 out on the cloth), and how much is thread
  float cavity = 0.0;
  float stitches = 0.0;
  float band = vChimpCloth.x;
  vec3 col = mix(chimpMain, chimpBand, smoothstep(0.35, 0.65, band));
  if (chimpPattern > 0.5) {
    // a bandana's print, in the second colour: paisley drops in staggered rows, dots between, a
    // border line just inside the cloth's edge (y: how far the edge is; far away on the roll and knot)
    vec3 pn = abs(rn);
    vec2 p = (pn.x > max(pn.y, pn.z) ? vChimpRest.zy : pn.y > pn.z ? vChimpRest.xz : vChimpRest.xy) / 0.017;
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5;
    if (mod(cell.y, 2.0) > 0.5) f.x = fract(p.x + 0.5) - 0.5;
    // a drop: a round head with its tail curling up and over, a cloth-coloured hollow, a dot in it
    vec2 h = f - vec2(-0.03, -0.07);
    float head = 1.0 - smoothstep(0.17, 0.2, length(h));
    float tail = (1.0 - smoothstep(0.055, 0.08, length(f - vec2(0.1, 0.13)))) + (1.0 - smoothstep(0.03, 0.05, length(f - vec2(0.17, 0.25))));
    float hollow = 1.0 - smoothstep(0.08, 0.1, length(h));
    float eye = 1.0 - smoothstep(0.035, 0.05, length(h));
    float motif = clamp(max(head, tail) * (1.0 - hollow) + eye, 0.0, 1.0);
    float dots = 1.0 - smoothstep(0.04, 0.055, length(fract(p + vec2(0.5, 0.5)) - 0.5));
    float ink = max(motif, dots);
    float e = vChimpCloth.y;
    if (e > 0.0 && e < 0.5) {
      // the border: plain cloth along the very edge, a line, then the field of the print
      float line = 1.0 - smoothstep(0.0007, 0.0013, abs(e - 0.0045));
      ink = e < 0.0085 ? line : ink;
    }
    col = mix(col, chimpBand, ink * 0.92);
  }
  // the grain, laid on from the planes the cloth faces (blended where it turns between them): a top's
  // wales run down it, a twill's ribs rise to the right
  {
    vec3 an = rn * rn;
    an *= an;
    an /= max(an.x + an.y + an.z, 1e-5);
    float l0;
    float l1;
    float l2;
    vec2 gx = chimpGrain2(chimpGrain, vChimpRest.zy, px, l0);
    vec2 gy = chimpGrain2(chimpGrain, vChimpRest.xz, px, l1);
    vec2 gz = chimpGrain2(chimpGrain, vChimpRest.xy, px, l2);
    grad += an.x * vec3(0.0, gx.y, gx.x) + an.y * vec3(gy.x, 0.0, gy.y) + an.z * vec3(gz.x, gz.y, 0.0);
    chimpRoughAdd += 0.05 * (an.x * l0 + an.y * l1 + an.z * l2);
  }
  if (chimpGrain > 3.5 && chimpGrain < 4.5 && vChimpCloth.w > 5.0) {
    // ribbed knit: ribs across the band, every 3.2 mm round it (not across where its count wraps round)
    float a = vChimpCloth.w - 10.0;
    float aw = length(vec2(chimpDcx.w, chimpDcy.w));
    float f = (1.0 - smoothstep(0.2, 0.45, aw / 0.0032)) * (1.0 - step(0.02, aw));
    float ph = a * 6.2831853 / 0.0032;
    float dh = 0.00011 * 6.2831853 / 0.0032 * cos(ph) * f;
    hx += dh * chimpDcx.w;
    hy += dh * chimpDcy.w;
    col *= 1.0 - 0.08 * f * (0.5 - 0.5 * sin(ph));
    chimpRoughAdd += 0.04 * (1.0 - f);
  }
  if (chimpGrain > 7.5 && chimpGrain < 8.5) {
    // webbing: fine ribs along the strap, so across its width
    float e = vChimpCloth.y;
    float ew = length(vec2(chimpDcx.y, chimpDcy.y));
    float f = 1.0 - smoothstep(0.2, 0.45, ew / 0.0011);
    float dh = 0.00005 * 6.2831853 / 0.0011 * cos(e * 6.2831853 / 0.0011) * f;
    hx += dh * chimpDcx.y;
    hy += dh * chimpDcy.y;
    chimpRoughAdd += 0.04 * (1.0 - f);
  }
  if (chimpGrain > 8.5) {
    // leather: a fine pebbled grain, its tops a little smoother
    vec4 n = chimpNoised(vChimpRest * 1400.0);
    float f = 1.0 - smoothstep(0.2, 0.45, px * 1400.0);
    grad += 0.00003 * 1400.0 * n.yzw * f;
    col *= 1.0 + 0.05 * n.x * f;
    chimpRoughAdd += 0.03 * (1.0 - f) - 0.08 * n.x * f;
  }
  if (chimpSeams.z < 0.0) {
    // a knitted hat's ribs run round it, closing in to its crown (and fading there, where they'd crowd)
    vec2 d = vChimpRest.xz - chimpSeams.xy;
    float r2 = max(dot(d, d), 1e-6);
    float N = -chimpSeams.z;
    float th = atan(d.x, d.y) * N;
    float f = (1.0 - smoothstep(0.2, 0.45, px * N / (6.2831853 * sqrt(r2)))) * smoothstep(0.006, 0.022, sqrt(r2));
    grad += 0.00025 * N * cos(th) * vec3(d.y, 0.0, -d.x) / r2 * f;
    col *= 1.0 - 0.14 * f * (0.5 - 0.5 * sin(th));
  }
#ifdef CHIMPFOLD
  {
    // the folds it falls into: ridged noise, stretched to run along its axis (a drape) or round it (creases)
    float depth = length(vChimpFold.xyz);
    if (depth > 0.00005) {
      vec3 ax = vChimpFold.xyz / depth;
      vec2 fq = vChimpFold.w > 0.0 ? chimpFoldSizes.xy : chimpFoldSizes.zw;
      float t = dot(vChimpRest, ax);
      vec3 q = (vChimpRest - t * ax) * fq.y + ax * (t * fq.x);
      vec4 n1 = chimpNoised(q);
      vec4 n2 = chimpNoised(q * 2.03 + vec3(5.2, 1.3, 2.7));
      float nn = n1.x + 0.4 * n2.x;
      vec3 gq = n1.yzw + 0.812 * n2.yzw;
      float ga = dot(gq, ax);
      vec3 gp = fq.y * (gq - ga * ax) + fq.x * ga * ax;
      // folds smaller than a few pixels go
      float f = 1.0 - smoothstep(0.15, 0.45, px * max(fq.x, fq.y));
      grad += depth * gp * f;
      cavity = smoothstep(-0.05, -0.5, nn) * smoothstep(0.0006, 0.004, depth) * f;
    }
  }
#endif
  // cloth's colour isn't quite even (the yarn's own, the dye's), nor, close to, is a fuzzy yarn's
  if (chimpGrain > 0.5) col *= 1.0 + 0.045 * chimpNoised(vChimpRest * 47.0 + vec3(13.1, 7.7, 3.3)).x;
  if (chimpFuzz > 0.0) {
    vec3 fc = floor(vChimpRest * 1500.0);
    float n = fract(sin(dot(fc, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    col *= 1.0 + chimpFuzz * 0.7 * mix(-0.1, n - 0.6, 1.0 - smoothstep(0.0007, 0.0018, px));
  }
  // thread: darker than the cloth, or lighter on dark cloth
  vec3 thread = dot(col, vec3(0.3, 0.59, 0.11)) > 0.05 ? col * 0.5 : mix(col, vec3(0.6), 0.4);
  // a crown's panel seams: a soft crease where two panels meet, a row of stitches beside it
  if (chimpSeams.z > 0.0) {
    vec2 d = vChimpRest.xz - chimpSeams.xy;
    float per = 6.2831853 / chimpSeams.z;
    float a = abs(mod(atan(d.x, d.y) + chimpSeams.w + per * 0.5, per) - per * 0.5);
    float across = a * length(d);
    float dash = step(0.42, fract((length(d) - vChimpRest.y) / 0.0034));
    col *= 1.0 - 0.4 * (1.0 - smoothstep(0.0003, 0.0013, across));
    stitches = max(stitches, (1.0 - smoothstep(0.00022, 0.00055, abs(across - 0.0026))) * dash * step(0.006, length(d)));
  }
#ifdef CHIMPSEAM
  {
    // a garment's seams: creases where it is sewn, and its top-stitching
    float rw = length(vec2(chimpDsx.w, chimpDsy.w));
    vec3 a = chimpSeamLook(vChimpSeam.x, length(vec2(chimpDsx.x, chimpDsy.x)), chimpSeamStyle.x, vChimpSeam.w, rw);
    // a top's side and shoulder seams stop at its armholes
    if (chimpSeamStyle.w > 0.5) a *= step(vChimpSeam.y, 0.0);
    vec3 b = chimpSeamLook(vChimpSeam.y, length(vec2(chimpDsx.y, chimpDsy.y)), chimpSeamStyle.y, vChimpSeam.w, rw);
    vec3 c = chimpSeamLook(vChimpSeam.z, length(vec2(chimpDsx.z, chimpDsy.z)), chimpSeamStyle.z, vChimpSeam.w, rw);
    hx += a.x * chimpDsx.x + b.x * chimpDsx.y + c.x * chimpDsx.z;
    hy += a.x * chimpDsy.x + b.x * chimpDsy.y + c.x * chimpDsy.z;
    col *= (1.0 - a.y) * (1.0 - b.y) * (1.0 - c.y);
    stitches = max(stitches, max(a.z, max(b.z, c.z)));
  }
#endif
  if (vChimpCloth.w > 5.0 && chimpStitch.z > 0.5) {
    // rows of stitches along an edge (a peak's, a hem's, a strap's), dashed along it
    float e = vChimpCloth.y;
    float ew = length(vec2(chimpDcx.y, chimpDcy.y));
    float rw = length(vec2(chimpDcx.w, chimpDcy.w));
    float rows = 0.0;
    for (int k = 0; k < 5; k++) {
      if (float(k) > chimpStitch.z - 0.5) break;
      rows = max(rows, chimpLine(e - chimpStitch.x - float(k) * chimpStitch.y, 0.0003, ew));
    }
    float dash = mix(0.58, step(0.42, fract((vChimpCloth.w - 10.0) / chimpStitch.w)), 1.0 - smoothstep(0.15, 0.35, rw / chimpStitch.w));
    stitches = max(stitches, rows * dash * (1.0 - step(0.02, rw)) * mix(1.0, 0.35, smoothstep(0.0006, 0.0015, ew)));
    if (chimpHem > 0.0) {
      // where the hem's turned-up edge ends inside: a soft step down, from double cloth to single
      float t = clamp((e - chimpHem + 0.0015) / 0.003, 0.0, 1.0);
      float dh = -0.00035 * 6.0 * t * (1.0 - t) / 0.003;
      hx += dh * chimpDcx.y;
      hy += dh * chimpDcy.y;
    }
  }
  col = mix(col, thread, stitches * 0.85);
  // the print, square on from the front where the cloth faces forward: seen from in front, the
  // chimp's right (+x) is on the left; red is its main ink, green the one that stands out. It is
  // looked up for every pixel and masked to its rectangle, not looked up only inside it: a lookup
  // that only some pixels make can't tell its size on screen at the rectangle's edge, and draws a
  // faint frame there
#ifdef CHIMPPRINT
  if (chimpPrintRect.z > 0.0) {
    vec2 uv = vec2(0.5 - (vChimpRest.x - chimpPrintRect.x) / (2.0 * chimpPrintRect.z), 0.5 + (vChimpRest.y - chimpPrintRect.y) / (2.0 * chimpPrintRect.w));
    vec4 ink = texture2D(chimpPrint, clamp(uv, 0.0, 1.0));
    float on = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0) * step(0.25, vChimpRestN.z);
    col = mix(col, chimpInk, ink.r * 0.95 * on);
    col = mix(col, chimpInk2, ink.g * 0.95 * on);
  }
#endif
  // the folds' valleys and the creases see less of the light, and less of the sky's reflection
  surfaceAlbedo = col * mix(0.45, 1.0, vChimpCloth.z) * (1.0 - 0.3 * cavity);
  chimpSpecOcc *= 1.0 - 0.5 * cavity;
  chimpRoughAdd += 0.04 * stitches;
  // tip the surface's normal by the height's slope (bump mapping without tangents: the height's change
  // across the pixel, against the surface's own; after Mikkelsen)
  float dhx = dot(grad, chimpDrx) + hx;
  float dhy = dot(grad, chimpDry) + hy;
  vec3 r1 = cross(chimpDpy, normalW);
  vec3 r2 = cross(normalW, chimpDpx);
  float det = dot(chimpDpx, r1);
  if (abs(det) > 1e-14) normalW = normalize(normalW - (dhx * r1 + dhy * r2) / det);
}
#endif`,
      // what the grain smooths over where it is too fine to draw, it makes a little rougher
      "!float roughness=reflectivityOut\\.roughness;": `float roughness=reflectivityOut.roughness;
#ifdef CHIMPCLOTH
roughness = clamp(roughness + chimpRoughAdd, 0.0, 1.0);
#endif`,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* glsl */ `#ifdef CHIMPCLOTH
#ifdef REFLECTION
finalRadianceScaled *= chimpSpecOcc;
#endif
#ifdef SPECULARTERM
finalSpecularScaled *= chimpSpecOcc;
#endif
#endif`,
    };
  }
}

/**
 * A PBR material with the cloth plugin, as a fabric takes the light: matt, a soft sheen at
 * grazing angles (the fibres'), and little of the sharp reflection a smooth surface has. Plastic
 * (a frame, a cup) is smoother and has no sheen.
 */
export function clothMaterial(name: string, scene: Scene, fabric: Fabric | "plastic" = "plain"): { material: PBRMaterial; cloth: ChimpClothPlugin } {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.White();
  m.metallic = 0;
  m.maxSimultaneousLights = 8;
  const cloth = new ChimpClothPlugin(m);
  if (fabric === "plastic") {
    m.roughness = 0.32;
    return { material: m, cloth };
  }
  const look = FABRICS[fabric];
  m.roughness = look.rough;
  m.metallicF0Factor = look.f0;
  if (look.sheen > 0) {
    m.sheen.isEnabled = true;
    m.sheen.intensity = look.sheen;
    m.sheen.color = Color3.White();
    m.sheen.roughness = look.sheenRough;
    m.sheen.albedoScaling = true;
  }
  cloth.setFabric(look);
  return { material: m, cloth };
}

const prints = new Map<string, DynamicTexture>();

/**
 * A print's artwork as ink masks: red where the main ink goes (the tree from
 * public/brand/chimpvibe-mark.svg, its mint only; "vibe" and the apples), green where
 * the ink that stands out from the cloth goes ("chimp", as the wordmark sets it in the
 * light ink). One per scene and artwork.
 */
export function printTexture(scene: Scene, art: PrintArt = "mark"): DynamicTexture {
  const key = `${art}:${scene.uid}`;
  const had = prints.get(key);
  if (had) return had;
  const H = 1024;
  const W = Math.round(H * printAspect(art));
  const tex = new DynamicTexture(`chimpPrint ${art}`, { width: W, height: H }, scene, true);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const img = new Image();
  img.onload = () => {
    const canvas = (w: number, h: number) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c.getContext("2d")!;
    };
    // where the tree's square goes, in pixels: the mark's ink fills the artwork; the lockup's box does
    let k: number;
    let ox: number;
    let oy: number;
    if (art === "mark") {
      k = H / (0.855 - 0.14);
      ox = -0.13 * k;
      oy = -0.14 * k;
    } else {
      const b = STACKED.box;
      k = H / (b.bottom - b.y);
      ox = -b.x * k;
      oy = -b.y * k;
    }
    const size = art === "mark" ? k : STACKED.size * k;
    const tree = canvas(W, H);
    // only the tree's ink box: the traced mark leaves specks along its square's edges
    tree.beginPath();
    tree.rect(ox + 0.12 * size, oy + 0.12 * size, 0.76 * size, 0.76 * size);
    tree.clip();
    tree.drawImage(img, ox, oy, size, size);
    const word = canvas(W, H);
    if (art === "stacked") drawWord(word, ox + STACKED.textX * k, oy + (STACKED.cap + 100) * k, k, "chimpvibe", 5, "#00ff00", "#ff0000");
    const t = tree.getImageData(0, 0, W, H).data;
    const w = word.getImageData(0, 0, W, H).data;
    const out = (tex.getContext() as CanvasRenderingContext2D).createImageData(W, H);
    for (let i = 0; i < t.length; i += 4) {
      // mint and the apples' paler mint (green above red) are the tree; the mark's dark ground is not
      const mint = Math.max(0, Math.min(1, (t[i + 1] - t[i] - 12) / 26)) * (t[i + 3] / 255);
      out.data[i] = Math.max(Math.round(mint * 255), (w[i] * w[i + 3]) / 255);
      out.data[i + 1] = (w[i + 1] * w[i + 3]) / 255;
      out.data[i + 2] = 0;
      out.data[i + 3] = 255;
    }
    (tex.getContext() as CanvasRenderingContext2D).putImageData(out, 0, 0);
    tex.update(true);
  };
  img.src = "/brand/chimpvibe-mark.svg";
  prints.set(key, tex);
  return tex;
}

const dials = new Map<number, DynamicTexture>();

/**
 * A watch's dial: cream, a minute track and baton hour markers, the ChimpVibe tree in mint
 * under 12, and the hands at ten past ten (as a watch is shown), the seconds hand in mint.
 * Its top is 12 and its right 3, as laid on the dial (avatar/fit.ts disc). One per scene.
 */
export function dialTexture(scene: Scene): DynamicTexture {
  const had = dials.get(scene.uid as unknown as number);
  if (had) return had;
  const S = 512;
  const tex = new DynamicTexture("chimpDial", { width: S, height: S }, scene, true);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const c = S / 2;
  const draw = (tree: HTMLImageElement | null) => {
    const bg = ctx.createRadialGradient(c, c * 0.8, 0, c, c, c);
    bg.addColorStop(0, "#f6f2ea");
    bg.addColorStop(0.85, "#e9e3d7");
    bg.addColorStop(1, "#cfc7b8");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);
    // the minute track, and the hours' batons (12's doubled)
    ctx.save();
    ctx.translate(c, c);
    for (let i = 0; i < 60; i++) {
      ctx.save();
      ctx.rotate((i / 60) * Math.PI * 2);
      ctx.fillStyle = "#2a2c30";
      if (i % 5 === 0) {
        const w = S * 0.03;
        if (i === 0) {
          ctx.fillRect(-w * 1.15, -S * 0.455, w * 0.8, S * 0.12);
          ctx.fillRect(w * 0.35, -S * 0.455, w * 0.8, S * 0.12);
        } else ctx.fillRect(-w / 2, -S * 0.455, w, S * 0.11);
      } else ctx.fillRect(-S * 0.003, -S * 0.465, S * 0.006, S * 0.03);
      ctx.restore();
    }
    ctx.restore();
    // the tree under 12, in mint (the mark's mint only, its dark ground left out)
    if (tree) {
      const t = document.createElement("canvas");
      const T = 128;
      t.width = T;
      t.height = T;
      const g = t.getContext("2d")!;
      g.drawImage(tree, 0, 0, T, T);
      const d = g.getImageData(0, 0, T, T);
      for (let i = 0; i < d.data.length; i += 4) {
        const a = Math.max(0, Math.min(1, (d.data[i + 1] - d.data[i] - 12) / 26)) * (d.data[i + 3] / 255);
        d.data[i] = 47;
        d.data[i + 1] = 138;
        d.data[i + 2] = 98;
        d.data[i + 3] = Math.round(a * 255);
      }
      g.putImageData(d, 0, 0);
      ctx.drawImage(t, c - S * 0.1, S * 0.17, S * 0.2, S * 0.2);
    }
    // the hands, at ten past ten: hour, minute, then the seconds in mint over them, and a cap
    const hand = (turns: number, len: number, w: number, colour: string, tail = 0) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(turns * Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(-w / 2, tail);
      ctx.lineTo(-w * 0.35, -len * S);
      ctx.lineTo(0, -len * S - w * 0.6);
      ctx.lineTo(w * 0.35, -len * S);
      ctx.lineTo(w / 2, tail);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    hand((10 + 10 / 60) / 12, 0.24, S * 0.04, "#1d1f22", S * 0.04);
    hand(10 / 60, 0.36, S * 0.028, "#1d1f22", S * 0.04);
    hand(37 / 60, 0.4, S * 0.009, "#2f8a62", S * 0.09);
    ctx.fillStyle = "#1d1f22";
    ctx.beginPath();
    ctx.arc(c, c, S * 0.028, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2f8a62";
    ctx.beginPath();
    ctx.arc(c, c, S * 0.014, 0, Math.PI * 2);
    ctx.fill();
    tex.update(true);
  };
  draw(null);
  const img = new Image();
  img.onload = () => draw(img);
  img.src = "/brand/chimpvibe-mark.svg";
  dials.set(scene.uid as unknown as number, tex);
  return tex;
}

let strands: RawTexture3D | null = null;

/**
 * The strand pattern: a tiling 3D texture of jittered strand centres (a Worley
 * pattern). Red is how near a strand's middle a point is, green that strand's
 * length, blue its shade, alpha a chance for thinning it out. One is shared by
 * every chimp.
 */
export function strandTexture(scene: Scene): RawTexture3D {
  if (strands && strands.getScene() === scene) return strands;
  const N = 64;
  const CELLS = 16;
  const per = N / CELLS;
  // a strand centre in each cell, and its length and shade, from a hash
  const hash = (i: number, j: number, k: number, salt: number) => {
    let h = (i * 374761393 + j * 668265263 + k * 2147483647 + salt * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
  };
  const data = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const px = (x + 0.5) / per;
        const py = (y + 0.5) / per;
        const pz = (z + 0.5) / per;
        const ci = Math.floor(px);
        const cj = Math.floor(py);
        const ck = Math.floor(pz);
        let best = 9;
        let bi = 0;
        let bj = 0;
        let bk = 0;
        for (let dk = -1; dk <= 1; dk++)
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const i = ci + di;
              const j = cj + dj;
              const k = ck + dk;
              const wi = ((i % CELLS) + CELLS) % CELLS;
              const wj = ((j % CELLS) + CELLS) % CELLS;
              const wk = ((k % CELLS) + CELLS) % CELLS;
              const cx = i + 0.15 + 0.7 * hash(wi, wj, wk, 1);
              const cy = j + 0.15 + 0.7 * hash(wi, wj, wk, 2);
              const cz = k + 0.15 + 0.7 * hash(wi, wj, wk, 3);
              const d = Math.hypot(px - cx, py - cy, pz - cz);
              if (d < best) {
                best = d;
                bi = wi;
                bj = wj;
                bk = wk;
              }
            }
        const o = (x + y * N + z * N * N) * 4;
        // strands about 0.55 of a cell across, rounded at their edge
        const r = Math.max(0, 1 - best / 0.55);
        data[o] = Math.round(255 * Math.min(1, Math.pow(r, 0.8)));
        data[o + 1] = Math.round(255 * (0.55 + 0.45 * hash(bi, bj, bk, 4)));
        data[o + 2] = Math.round(255 * hash(bi, bj, bk, 5));
        // a second chance per strand: whether it grows where the fur thins out
        data[o + 3] = Math.round(255 * (0.02 + 0.96 * hash(bi, bj, bk, 6)));
      }
  const tex = new RawTexture3D(data, N, N, N, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.wrapR = Texture.WRAP_ADDRESSMODE;
  tex.name = "chimpStrands";
  strands = tex;
  return tex;
}

/** A PBR material with the skin plugin. */
export function skinMaterial(name: string, scene: Scene): { material: PBRMaterial; skin: ChimpSkinPlugin } {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.White();
  m.metallic = 0;
  m.roughness = 0.7;
  m.maxSimultaneousLights = 8;
  // a soft sheen at grazing angles: the velvet of short hair and skin
  m.sheen.isEnabled = true;
  m.sheen.intensity = 0.12;
  m.sheen.color = new Color3(1, 0.92, 0.85);
  m.sheen.roughness = 0.6;
  const skin = new ChimpSkinPlugin(m);
  return { material: m, skin };
}

/** A PBR material with the fur plugin. */
export function furMaterial(name: string, scene: Scene): { material: PBRMaterial; fur: ChimpFurPlugin } {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.White();
  m.metallic = 0;
  m.roughness = 0.72;
  m.maxSimultaneousLights = 8;
  // fur catches the light at its edges
  m.sheen.isEnabled = true;
  m.sheen.intensity = 0.3;
  m.sheen.color = new Color3(1, 0.93, 0.85);
  m.sheen.roughness = 0.5;
  m.backFaceCulling = false;
  const fur = new ChimpFurPlugin(m);
  fur.noise = strandTexture(scene);
  return { material: m, fur };
}
