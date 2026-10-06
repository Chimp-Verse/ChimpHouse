import {
  AbstractMesh,
  Color3,
  Color4,
  CubeTexture,
  DirectionalLight,
  HemisphericLight,
  PointLight,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  SpotLight,
  Vector3,
} from "@babylonjs/core";
import { LightDef, MeshMeta, WorldCtx } from "../world/context";
import { MOON_DIR, SUN_DIR, Sky } from "../world/environment/sky";
import { Quality } from "./store";

/** Interior lights read brighter against the dark jungle at night. */
const NIGHT_BOOST = 2.2;
/** Daytime interiors keep a warm glow from pendants and shelf lights, as in the concept art. */
const DAY_BOOST = 1.6;

interface RoomLight {
  light: PointLight | SpotLight;
  def: LightDef;
}

/** Sky radiance used for the environment cube (linear RGB). */
function skyColor(d: Vector3, night: boolean): [number, number, number] {
  const h = d.y;
  if (night) {
    const t = Math.pow(Math.max(0, h), 0.5);
    const top: [number, number, number] = [0.01, 0.018, 0.05];
    const hor: [number, number, number] = [0.03, 0.05, 0.11];
    const below: [number, number, number] = [0.01, 0.015, 0.012];
    const c = top.map((v, i) => hor[i] + (v - hor[i]) * t) as [number, number, number];
    return h < 0 ? (c.map((v, i) => v + (below[i] - v) * Math.min(1, -h * 4)) as [number, number, number]) : c;
  }
  const t = Math.pow(Math.max(0, h), 0.45);
  const zenith: [number, number, number] = [0.22, 0.45, 0.95];
  const horizon: [number, number, number] = [0.95, 0.9, 0.82];
  // below the horizon: sunlit jungle canopy bounce
  const below: [number, number, number] = [0.16, 0.24, 0.08];
  let c = horizon.map((v, i) => v + (zenith[i] - v) * t) as [number, number, number];
  if (h < 0) c = c.map((v, i) => v + (below[i] - v) * Math.min(1, -h * 5)) as [number, number, number];
  const s = Math.max(0, Vector3.Dot(d, SUN_DIR));
  const glow = Math.pow(s, 8) * 0.6 + Math.pow(s, 64) * 1.5;
  return [c[0] + glow * 1.0, c[1] + glow * 0.75, c[2] + glow * 0.45];
}

/** Build a small LDR cube map of the sky as six data-URL faces. */
function skyCube(scene: Scene, night: boolean): CubeTexture {
  const S = 64;
  const faces: string[] = [];
  // order: px, py, pz, nx, ny, nz (Babylon CreateFromImages default)
  const dirs = [
    (u: number, v: number) => new Vector3(1, -v, -u),
    (u: number, v: number) => new Vector3(u, 1, v),
    (u: number, v: number) => new Vector3(u, -v, 1),
    (u: number, v: number) => new Vector3(-1, -v, u),
    (u: number, v: number) => new Vector3(u, -1, -v),
    (u: number, v: number) => new Vector3(-u, -v, -1),
  ];
  const enc = (x: number) => Math.round(255 * Math.min(1, Math.pow(Math.max(0, x), 1 / 2.2)));
  for (const f of dirs) {
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const g = c.getContext("2d")!;
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const u = (2 * (x + 0.5)) / S - 1;
        const v = (2 * (y + 0.5)) / S - 1;
        const col = skyColor(f(u, v).normalize(), night);
        const i = (y * S + x) * 4;
        img.data[i] = enc(col[0]);
        img.data[i + 1] = enc(col[1]);
        img.data[i + 2] = enc(col[2]);
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    faces.push(c.toDataURL("image/png"));
  }
  const tex = CubeTexture.CreateFromImages(faces, scene, false);
  tex.gammaSpace = true;
  return tex;
}

export class Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphericLight;
  readonly shadows: ShadowGenerator;
  private roomLights: RoomLight[] = [];
  private env: Record<"day" | "night", CubeTexture | null> = { day: null, night: null };
  night = false;

  constructor(
    private scene: Scene,
    private sky: Sky,
  ) {
    scene.clearColor = new Color4(0.55, 0.7, 0.85, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    this.sun = new DirectionalLight("sun", SUN_DIR.scale(-1), scene);
    this.sun.intensity = 5.2;
    this.sun.diffuse = Color3.FromHexString("#ffc98f").toLinearSpace();
    // static orthographic shadow frustum around the house and its trees
    this.sun.autoUpdateExtends = false;
    this.sun.autoCalcShadowZBounds = false;
    this.sun.orthoLeft = -42;
    this.sun.orthoRight = 42;
    this.sun.orthoTop = 42;
    this.sun.orthoBottom = -42;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 220;
    this.placeSun(SUN_DIR);

    this.hemi = new HemisphericLight("hemi", new Vector3(0.15, 1, -0.1), scene);
    this.hemi.intensity = 0.45;
    this.hemi.diffuse = Color3.FromHexString("#cfe0f2").toLinearSpace();
    this.hemi.groundColor = Color3.FromHexString("#6d5a3c").toLinearSpace();
    this.hemi.specular = Color3.Black();

    const sg = new ShadowGenerator(4096, this.sun);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    sg.bias = 0.0006;
    sg.normalBias = 0.02;
    sg.darkness = 0.0;
    sg.getShadowMap()!.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    this.shadows = sg;

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0006;
    scene.fogColor = Color3.FromHexString("#b9cbd6").toLinearSpace();
  }

  private placeSun(dir: Vector3) {
    this.sun.direction = dir.scale(-1);
    this.sun.position = new Vector3(0, 6, 9).add(dir.scale(110));
  }

  /** Create room lights scoped to their rooms' meshes; register shadow casters. */
  attach(ctx: WorldCtx): void {
    for (const c of ctx.shadowCasters) this.shadows.addShadowCaster(c, false);
    for (const def of ctx.lights) {
      let light: PointLight | SpotLight;
      if (def.kind === "spot") light = new SpotLight(`roomSpot`, def.pos, def.dir ?? Vector3.Down(), def.angle ?? 1.2, 2, this.scene);
      else light = new PointLight(`roomLight`, def.pos, this.scene);
      light.diffuse = Color3.FromHexString(def.color).toLinearSpace();
      light.specular = light.diffuse.scale(0.6);
      light.range = def.range;
      light.falloffType = PointLight.FALLOFF_PHYSICAL;
      light.shadowEnabled = false;
      light.includedOnlyMeshes = ctx.meshes.filter((m) => lights(def, m));
      this.roomLights.push({ light, def });
    }
    this.applyIntensities();
  }

  /** Light and shade meshes added after the house was built (a game's cabinet), as attach does the house's. */
  addMeshes(meshes: AbstractMesh[], casters: AbstractMesh[]): void {
    for (const { light, def } of this.roomLights) for (const m of meshes) if (lights(def, m)) light.includedOnlyMeshes.push(m);
    for (const c of casters) this.shadows.addShadowCaster(c, false);
    this.shadows.getShadowMap()!.resetRefreshCounter();
  }

  /** Before meshes added with addMeshes are disposed (disposing takes them out of the lights' lists). */
  removeCasters(casters: AbstractMesh[]): void {
    for (const c of casters) this.shadows.removeShadowCaster(c, false);
    this.shadows.getShadowMap()!.resetRefreshCounter();
  }

  private applyIntensities() {
    for (const { light, def } of this.roomLights) {
      const v = this.night ? def.night * NIGHT_BOOST : def.day * DAY_BOOST;
      light.intensity = v;
      light.setEnabled(v > 0);
    }
  }

  setNight(night: boolean): void {
    this.night = night;
    const s = this.scene;
    if (night) {
      this.placeSun(MOON_DIR);
      this.sun.intensity = 0.35;
      this.sun.diffuse = Color3.FromHexString("#7f9cd8").toLinearSpace();
      this.hemi.intensity = 0.12;
      this.hemi.diffuse = Color3.FromHexString("#3b5a9a").toLinearSpace();
      this.hemi.groundColor = Color3.FromHexString("#141a24").toLinearSpace();
      s.fogColor = Color3.FromHexString("#0d1630").toLinearSpace();
      s.fogDensity = 0.0012;
      s.clearColor = new Color4(0.02, 0.04, 0.09, 1);
    } else {
      this.placeSun(SUN_DIR);
      this.sun.intensity = 5.2;
      this.sun.diffuse = Color3.FromHexString("#ffc98f").toLinearSpace();
      this.hemi.intensity = 0.45;
      this.hemi.diffuse = Color3.FromHexString("#cfe0f2").toLinearSpace();
      this.hemi.groundColor = Color3.FromHexString("#6d5a3c").toLinearSpace();
      s.fogColor = Color3.FromHexString("#b9cbd6").toLinearSpace();
      s.fogDensity = 0.0006;
      s.clearColor = new Color4(0.55, 0.7, 0.85, 1);
    }
    this.shadows.getShadowMap()!.resetRefreshCounter();
    this.sky.setNight(night);
    this.applyIntensities();
    this.refreshEnvironment();
  }

  refreshEnvironment(): void {
    const key = this.night ? "night" : "day";
    if (!this.env[key]) this.env[key] = skyCube(this.scene, this.night);
    this.scene.environmentTexture = this.env[key];
    this.scene.environmentIntensity = this.night ? 0.6 : 1.0;
  }

  setQuality(q: Quality): void {
    this.sun.shadowEnabled = q !== "low";
    this.shadows.filteringQuality = q === "high" ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM;
  }
}

/** Whether a room light lights a mesh: the mesh is in one of its rooms, on its level (or the site or a roof). */
function lights(def: LightDef, m: AbstractMesh): boolean {
  const md = m.metadata as MeshMeta | undefined;
  return !!md && def.rooms.includes(md.room) && (md.level === def.level || md.level === "site" || md.level === "roof");
}
