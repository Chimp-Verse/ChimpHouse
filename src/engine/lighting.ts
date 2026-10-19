import {
  AbstractMesh,
  Color3,
  Color4,
  CubeTexture,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  PointLight,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  SpotLight,
  Vector3,
} from "@babylonjs/core";
import { Level, LightDef, MeshMeta, WorldCtx } from "../world/context";
import { MOON_DIR, SUN_DIR, Sky } from "../world/environment/sky";
import { Quality } from "./store";

/** Interior lights read brighter against the dark jungle at night. */
const NIGHT_BOOST = 2.2;
/** Daytime interiors keep a warm glow from pendants and shelf lights, as in the concept art. */
const DAY_BOOST = 1.6;
/** Lights each chimp has: copies of the room lights that light it most. */
const CHIMP_LIGHTS = 3;
/** Chimps whose lights are made at the start (`Lighting.spare`); any more make their own. */
const SPARE_CHIMPS = 12;
/** Babylon's physical spotlight falloff: a spotlight lights 1% at its cone's edge (-log2 0.01). */
const SPOT_EDGE = 6.64385618977;

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
export function skyCube(scene: Scene, night: boolean): CubeTexture {
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
  /**
   * Lights waiting for a chimp, lighting nothing meanwhile. They are made before the
   * room lights: a light made once those are there costs a pass over every mesh in the
   * house against every room light's list, a hitch each time a visitor arrives.
   */
  private spare: PointLight[] = [];
  /** All a spare light lights (an empty list would mean every mesh in the house) */
  private nobody: AbstractMesh;
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

    this.nobody = new Mesh("lit by nobody", scene);
    this.nobody.setEnabled(false);
    for (let i = 0; i < CHIMP_LIGHTS * SPARE_CHIMPS; i++) this.spare.push(this.chimpLight());
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

  /** Lights of its own for a chimp (`ChimpLights`), from the spare ones while they last. */
  chimpLights(): ChimpLights {
    const lights = Array.from({ length: CHIMP_LIGHTS }, () => this.spare.pop() ?? this.chimpLight());
    return new ChimpLights(lights, this.roomLights, this.nobody, (given) => {
      for (const l of given) {
        l.intensity = 0;
        l.includedOnlyMeshes = [this.nobody];
        this.spare.push(l);
      }
    });
  }

  private chimpLight(): PointLight {
    const l = new PointLight("chimp light", Vector3.Zero(), this.scene);
    l.includedOnlyMeshes = [this.nobody];
    l.falloffType = PointLight.FALLOFF_PHYSICAL;
    l.shadowEnabled = false;
    l.intensity = 0;
    return l;
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

/**
 * A chimp's own lights: copies of the room lights that light it most where it stands,
 * moved onto them each frame and lighting only the chimp. So a chimp is lit as the house
 * around it is, and walking from room to room never touches the house's own lights, whose
 * lists name hundreds of meshes each (a change to one is a pass over every mesh).
 */
export class ChimpLights {
  private lit: AbstractMesh[] = [];
  /** the room lights copied, strongest first, and how much of each reaches the chimp */
  private from: (PointLight | SpotLight | null)[];
  private reach: number[];
  private share: number[];

  constructor(
    private lights: PointLight[],
    private rooms: readonly RoomLight[],
    private nobody: AbstractMesh,
    private giveBack: (lights: PointLight[]) => void,
  ) {
    this.from = lights.map(() => null);
    this.reach = lights.map(() => 0);
    this.share = lights.map(() => 0);
  }

  /** Light these meshes only: the chimp's, again whenever its clothes change. */
  light(meshes: AbstractMesh[]): void {
    if (meshes.length === this.lit.length && meshes.every((m, i) => m === this.lit[i])) return;
    this.lit = [...meshes];
    for (const l of this.lights) l.includedOnlyMeshes = meshes.length ? [...meshes] : [this.nobody];
  }

  /**
   * Copy the room lights that light `at` most: the lights of its room on its level, by their
   * strength over the distance squared, a spotlight's by how far into its cone `at` is (as
   * Babylon lights the house). None outside the rooms, or when `off` (the chimp isn't drawn).
   */
  follow(at: Vector3, room: string | null, level: Level | null, off = false): void {
    const n = this.lights.length;
    this.from.fill(null);
    this.reach.fill(0);
    if (room && !off) {
      for (const { light, def } of this.rooms) {
        if (!light.isEnabled() || def.level !== level || !def.rooms.includes(room)) continue;
        const dx = at.x - light.position.x;
        const dy = at.y - light.position.y;
        const dz = at.z - light.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        let share = 1;
        if (light instanceof SpotLight) {
          const dir = light.direction;
          const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / (Math.sqrt(d2) * dir.length() || 1);
          share = Math.pow(2, (-SPOT_EDGE * (1 - cos)) / (1 - Math.cos(light.angle / 2)));
        }
        const reach = (light.intensity * share) / Math.max(0.25, d2);
        let i = n;
        while (i > 0 && reach > this.reach[i - 1]) i--;
        if (i === n) continue;
        for (let j = n - 1; j > i; j--) {
          this.from[j] = this.from[j - 1];
          this.reach[j] = this.reach[j - 1];
          this.share[j] = this.share[j - 1];
        }
        this.from[i] = light;
        this.reach[i] = reach;
        this.share[i] = share;
      }
    }
    for (let i = 0; i < n; i++) {
      const l = this.lights[i];
      const from = this.from[i];
      // a light without one to copy stays on, lighting nothing: switching it off would change the chimp's shaders
      if (!from) {
        l.intensity = 0;
        continue;
      }
      l.position.copyFrom(from.position);
      l.diffuse.copyFrom(from.diffuse);
      l.specular.copyFrom(from.specular);
      l.range = from.range;
      l.intensity = from.intensity * this.share[i];
    }
  }

  /** What it copies now, for tests: each light's intensity. */
  describe(): number[] {
    return this.lights.map((l) => +l.intensity.toFixed(3));
  }

  /** Give the lights back for another chimp. */
  dispose(): void {
    this.giveBack(this.lights);
    this.lights = [];
  }
}

/** Whether a room light lights a mesh: the mesh is in one of its rooms, on its level (or the site or a roof). */
function lights(def: LightDef, m: AbstractMesh): boolean {
  const md = m.metadata as MeshMeta | undefined;
  return !!md && def.rooms.includes(md.room) && (md.level === def.level || md.level === "site" || md.level === "roof");
}
