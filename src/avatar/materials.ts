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
// under clothes (or a hat, a pack) there is no fur to see
vChimpFur = vec4(chimpFur.x * (1.0 - chimpCover), chimpFur.yzw);
vChimpT = chimpShell;
float chimpL = chimpLength * chimpFur.y * (1.0 - 0.85 * chimpCover);
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

/**
 * Clothes and the things a chimp wears: two colours (the body of the thing, and
 * its bands: cuffs, hems, a cap's brim), a woven or knitted surface laid on from the
 * rest pose's position (so it stays put on the cloth as the chimp moves), and a
 * print (the ChimpVibe tree on a tee's chest) projected from the front.
 */
export class ChimpClothPlugin extends MaterialPluginBase {
  main = new Color3(0.1, 0.1, 0.1);
  band = new Color3(0.05, 0.05, 0.05);
  printColour = new Color3(0.47, 0.85, 0.67);
  /** the print's middle and half size (x, y, half width, half height), rest space; a half width of 0 is no print */
  printRect = new Vector4(0, 0, 0, 0);
  /** the weave's size: repeats per metre, and 0 woven, 1 knitted ribs */
  weave = 260;
  knit = 0;
  fade = 1;
  print: Texture | null = null;

  constructor(material: PBRMaterial) {
    super(material, "ChimpCloth", 220, { CHIMPCLOTH: false });
    this._enable(true);
  }

  getClassName(): string {
    return "ChimpClothPlugin";
  }

  prepareDefines(defines: MaterialDefines): void {
    defines.CHIMPCLOTH = true;
  }

  getAttributes(attributes: string[]): void {
    attributes.push("chimpCloth");
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
        { name: "chimpPrintRect", size: 4, type: "vec4" },
        { name: "chimpWeave", size: 1, type: "float" },
        { name: "chimpKnit", size: 1, type: "float" },
        { name: "chimpClothFade", size: 1, type: "float" },
      ],
      fragment: "uniform vec3 chimpMain; uniform vec3 chimpBand; uniform vec3 chimpInk; uniform vec4 chimpPrintRect; uniform float chimpWeave; uniform float chimpKnit; uniform float chimpClothFade;",
    };
  }

  bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateColor3("chimpMain", this.main);
    ubo.updateColor3("chimpBand", this.band);
    ubo.updateColor3("chimpInk", this.printColour);
    ubo.updateVector4("chimpPrintRect", this.printRect);
    ubo.updateFloat("chimpWeave", this.weave);
    ubo.updateFloat("chimpKnit", this.knit);
    ubo.updateFloat("chimpClothFade", this.fade);
    if (this.print) ubo.setTexture("chimpPrint", this.print);
  }

  getCustomCode(shaderType: string): { [point: string]: string } | null {
    if (shaderType === "vertex")
      return {
        CUSTOM_VERTEX_DEFINITIONS: "#ifdef CHIMPCLOTH\nattribute vec4 chimpCloth;\nvarying vec4 vChimpCloth;\nvarying vec3 vChimpRest;\nvarying vec3 vChimpRestN;\n#endif",
        CUSTOM_VERTEX_UPDATE_POSITION: "#ifdef CHIMPCLOTH\nvChimpCloth = chimpCloth;\nvChimpRest = positionUpdated;\nvChimpRestN = normalUpdated;\n#endif",
      };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef CHIMPCLOTH\nuniform sampler2D chimpPrint;\nvarying vec4 vChimpCloth;\nvarying vec3 vChimpRest;\nvarying vec3 vChimpRestN;\n${DITHER}\n#endif`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: /* glsl */ `#ifdef CHIMPCLOTH
if (chimpClothFade < 0.999 && chimpBayer(gl_FragCoord.xy) > chimpClothFade) discard;
float chimpSpecOcc = vChimpCloth.z;
{
  float band = vChimpCloth.x;
  vec3 col = mix(chimpMain, chimpBand, smoothstep(0.35, 0.65, band));
  // the weave: fine threads across and along, from the rest pose's position on the plane it faces most;
  // knitted things (and every band) have ribs instead
  vec3 an = abs(normalize(vChimpRestN));
  vec2 q = an.x > max(an.y, an.z) ? vChimpRest.zy : an.y > an.z ? vChimpRest.xz : vChimpRest.xy;
  q *= chimpWeave;
  float woven = 0.5 + 0.25 * (sin(q.x * 6.2832) + sin(q.y * 6.2832));
  float ribs = 0.5 + 0.5 * sin(q.x * 6.2832 * 0.32);
  float knit = max(chimpKnit, smoothstep(0.35, 0.65, band));
  col *= mix(mix(0.9, 1.06, woven), mix(0.78, 1.08, ribs), knit);
  // the print, square on from the front, where the cloth faces forward
  if (chimpPrintRect.z > 0.0 && vChimpRestN.z > 0.25) {
    vec2 uv = (vChimpRest.xy - chimpPrintRect.xy) / (2.0 * chimpPrintRect.zw) + 0.5;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      float ink = texture2D(chimpPrint, vec2(uv.x, 1.0 - uv.y)).a;
      col = mix(col, chimpInk, ink * 0.95);
    }
  }
  surfaceAlbedo = col * mix(0.45, 1.0, vChimpCloth.z);
}
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

/** A PBR material with the cloth plugin: matte, with a soft sheen as fabric has. */
export function clothMaterial(name: string, scene: Scene, o: { rough?: number; sheen?: number; metal?: number } = {}): { material: PBRMaterial; cloth: ChimpClothPlugin } {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.White();
  m.metallic = o.metal ?? 0;
  m.roughness = o.rough ?? 0.86;
  m.maxSimultaneousLights = 8;
  if ((o.sheen ?? 0.22) > 0) {
    m.sheen.isEnabled = true;
    m.sheen.intensity = o.sheen ?? 0.22;
    m.sheen.color = Color3.White();
    m.sheen.roughness = 0.5;
  }
  return { material: m, cloth: new ChimpClothPlugin(m) };
}

let ink: DynamicTexture | null = null;

/**
 * The ChimpVibe tree mark as ink for prints: white, with the mark's shape in its
 * alpha (the mint of public/brand/chimpvibe-mark.svg, its dark ground clear).
 */
export function printTexture(scene: Scene): DynamicTexture {
  if (ink && ink.getScene() === scene) return ink;
  const S = 256;
  const tex = new DynamicTexture("chimpPrint", { width: S, height: S }, scene, true);
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S);
    for (let i = 0; i < d.data.length; i += 4) {
      // mint (green well above red) is ink; the ground is not
      const a = Math.max(0, Math.min(1, (d.data[i + 1] - d.data[i] - 30) / 60));
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
      d.data[i + 3] = Math.round(a * 255);
    }
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, S, S);
    ctx.putImageData(d, 0, 0);
    tex.update(true);
  };
  img.src = "/brand/chimpvibe-mark.svg";
  ink = tex;
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
