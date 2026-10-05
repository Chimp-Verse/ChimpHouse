// Golden-hour gradient sky with sun glow, cloud cards, and a starry night dome.

import { Color3, Effect, Mesh, MeshBuilder, PBRMaterial, Scene, ShaderMaterial, Texture, Vector3 } from "@babylonjs/core";
import { rng } from "../geometry/curves";
import { toTexture } from "../materials/canvas";
import { cloudTexture, starsTexture } from "../materials/textures";

/** Direction from the scene toward the sun (late afternoon, west-south-west). */
export const SUN_DIR = new Vector3(-0.78, 0.34, -0.52).normalize();
export const MOON_DIR = new Vector3(0.45, 0.55, -0.7).normalize();

Effect.ShadersStore["chimpSkyVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

Effect.ShadersStore["chimpSkyFragmentShader"] = `
precision highp float;
varying vec3 vDir;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 below;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float sunSize;
uniform float glow;
uniform sampler2D stars;
uniform float starAmount;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(horizon, zenith, t);
  col = mix(col, below, smoothstep(0.0, -0.25, h));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += sunColor * (pow(s, 6.0) * 0.35 * glow + pow(s, 48.0) * 0.8 * glow);
  col += sunColor * smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.6, s) * 30.0;
  if (starAmount > 0.0) {
    vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, acos(clamp(d.y, -1.0, 1.0)) / 3.14159265);
    vec3 st = texture2D(stars, uv * vec2(3.0, 2.0)).rgb;
    col += st * starAmount * smoothstep(-0.05, 0.2, h);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  readonly dome: Mesh;
  readonly clouds: Mesh[] = [];
  readonly moon: Mesh;
  readonly mat: ShaderMaterial;
  private cloudMats: PBRMaterial[] = [];

  constructor(scene: Scene) {
    this.dome = MeshBuilder.CreateSphere("skyDome", { diameter: 7000, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
    const m = new ShaderMaterial("skyMat", scene, "chimpSky", {
      attributes: ["position"],
      uniforms: ["worldViewProjection", "zenith", "horizon", "below", "sunColor", "sunDir", "sunSize", "glow", "starAmount"],
      samplers: ["stars"],
    });
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    const stars = toTexture(scene, "stars", starsTexture(), { wrap: true });
    m.setTexture("stars", stars);
    this.mat = m;
    this.dome.material = m;
    this.dome.infiniteDistance = true;
    this.dome.isPickable = false;
    this.dome.renderingGroupId = 0;

    this.moon = MeshBuilder.CreateDisc("moon", { radius: 55, tessellation: 40 }, scene);
    const mm = new PBRMaterial("moonMat", scene);
    mm.unlit = true;
    mm.albedoColor = new Color3(3.2, 3.0, 2.6);
    mm.disableDepthWrite = true;
    this.moon.material = mm;
    this.moon.position = MOON_DIR.scale(3000);
    this.moon.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.moon.infiniteDistance = true;
    this.moon.isPickable = false;
    this.moon.renderingGroupId = 0;
    this.moon.setEnabled(false);

    const r = rng(42);
    const texes: Texture[] = [1, 2, 3].map((s) => toTexture(scene, `cloud${s}`, cloudTexture(s), { wrap: false, hasAlpha: true }));
    for (let i = 0; i < 30; i++) {
      const a = r() * Math.PI * 2;
      const d = 2000 + r() * 1100;
      const y = 260 + r() * 650;
      const w = 600 + r() * 900;
      const c = MeshBuilder.CreatePlane(`cloud${i}`, { width: w, height: w * 0.42 }, scene);
      c.position.set(Math.cos(a) * d, y, Math.sin(a) * d);
      c.billboardMode = Mesh.BILLBOARDMODE_Y;
      const cm = new PBRMaterial(`cloudMat${i}`, scene);
      const t = texes[i % 3];
      cm.unlit = true;
      cm.albedoTexture = t;
      cm.useAlphaFromAlbedoTexture = true;
      cm.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
      cm.albedoColor = new Color3(1.5, 1.45, 1.38);
      cm.disableDepthWrite = true;
      cm.fogEnabled = false;
      cm.backFaceCulling = false;
      c.material = cm;
      c.isPickable = false;
      c.infiniteDistance = false;
      c.renderingGroupId = 0;
      this.cloudMats.push(cm);
      this.clouds.push(c);
    }
    this.setNight(false);
  }

  setNight(night: boolean): void {
    const m = this.mat;
    if (night) {
      m.setColor3("zenith", new Color3(0.004, 0.009, 0.03));
      m.setColor3("horizon", new Color3(0.02, 0.04, 0.1));
      m.setColor3("below", new Color3(0.006, 0.01, 0.02));
      m.setColor3("sunColor", new Color3(0.5, 0.55, 0.7));
      m.setVector3("sunDir", MOON_DIR);
      m.setFloat("sunSize", 0.0);
      m.setFloat("glow", 0.15);
      m.setFloat("starAmount", 1.2);
    } else {
      m.setColor3("zenith", new Color3(0.22, 0.5, 1.15));
      m.setColor3("horizon", new Color3(1.05, 1.08, 1.1));
      m.setColor3("below", new Color3(0.45, 0.5, 0.5));
      m.setColor3("sunColor", new Color3(1.0, 0.72, 0.42));
      m.setVector3("sunDir", SUN_DIR);
      m.setFloat("sunSize", 0.0006);
      m.setFloat("glow", 1.0);
      m.setFloat("starAmount", 0);
    }
    this.moon.setEnabled(night);
    for (const cm of this.cloudMats) {
      cm.albedoColor = night ? new Color3(0.05, 0.065, 0.11) : new Color3(1.5, 1.45, 1.38);
      cm.alpha = night ? 0.6 : 1;
    }
  }

  meshesForProbe(_night: boolean): Mesh[] {
    return [this.dome, this.moon, ...this.clouds];
  }
}
