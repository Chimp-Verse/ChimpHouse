// The courtyard fountain's water, built at run time on the fountain's slot (roles.ts
// ROLE.fountain) from the spec its metadata carries (world/props/fountainSpec.ts), so it finds
// the fountain however its stone was built:
//
// - the streams: eight arcs from the nozzles round the coping, the jet up from the top bowl,
//   and the sheets falling off the two bowls' lips, all one mesh with one see-through material
//   whose streaks run along them as fast as the water flows (its texture's v is the water's
//   time in flight, scrolled with the clock);
// - the water in the basin: Babylon's WaterMaterial (reflecting and refracting the fountain's
//   own stone and the sky, nothing else) near it at high and medium quality, and a cheap tinted
//   water with drifting ripples at low quality, far off or out of sight; the bowls always have
//   the cheap one;
// - spray: CPU particles (no GPU particles) for the jet's crown, droplets peeling off the arcs,
//   and splashes where the water lands (none at low quality), stopped while the fountain is
//   far off or out of sight;
// - its sound (engine/fountainSound.ts).
//
// Draw order: the house draws in rendering group 1 (the sky in 0). The water surfaces are
// opaque; the particles draw after the opaque meshes and before the see-through ones, and the
// streams are see-through without writing depth, so neither cuts holes in the glazing behind.

import {
  AbstractMesh,
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector2,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { WaterMaterial } from "@babylonjs/materials/water/waterMaterial";
import { MeshMeta } from "../world/context";
import { roomAt } from "../world/layout";
import { Materials } from "../world/materials/library";
import { makeCanvas, toTexture } from "../world/materials/canvas";
import { FountainSpec, G, arcCoefficients, arcFlightTime, arcPoint } from "../world/props/fountainSpec";
import { ROLE, find } from "../world/roles";
import { FlyCamera } from "./flyCamera";
import { Lighting } from "./lighting";
import { FountainSound } from "./fountainSound";
import { type Quality } from "./store";

/** Streak repeats per second of the water's flight: how fast the streaks run along the streams. */
const FLOW = 2.6;
/** Spray runs within this distance (m) of the fountain, while it is in view. */
const SPRAY_FAR = 45;
/** The reflecting water within this distance (m); the cheap water beyond. */
const MIRROR_FAR = 28;

/** Emit rates (per second) at high quality; capacities. */
const JET = { rate: 170, capacity: 150 };
const ARC_SPRAY = { rate: 520, capacity: 200 };
const SPLASH = { rate: 380, capacity: 150 };
const RATE_SCALE: Record<Quality, number> = { high: 1, medium: 0.7, low: 0.45 };

/** The water's colours by day and by night (the basin's cool light and the lamps). */
const TINT = {
  day: { stream: new Color3(0.86, 0.95, 1), spray: new Color4(0.93, 0.97, 1, 0.62), water: "#2f8f96", deep: "#0f4a52" },
  night: { stream: new Color3(0.42, 0.72, 0.86), spray: new Color4(0.62, 0.86, 0.98, 0.55), water: "#16525e", deep: "#06222a" },
};

export class Fountain {
  readonly node: TransformNode | null;
  private spec: FountainSpec | null = null;
  private streams: Mesh | null = null;
  private streamMat: StandardMaterial | null = null;
  private streak: Texture | null = null;
  private basin: Mesh | null = null;
  private mirror: WaterMaterial | null = null;
  private cheap: PBRMaterial | null = null;
  private ripples: Texture[] = [];
  private jet: ParticleSystem | null = null;
  private arcSpray: ParticleSystem | null = null;
  private splash: ParticleSystem | null = null;
  private sound: FountainSound | null = null;
  private quality: Quality = "high";
  private night = false;
  /** whether the spray should run now (near and in view); set false to have the next frame apply it afresh */
  private sprayWanted = false;
  private t = 0;
  /** the basin's middle at the water, in the house */
  private centre = new Vector3();

  constructor(
    private scene: Scene,
    mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    sky: AbstractMesh,
  ) {
    const node = find(scene, ROLE.fountain);
    this.node = node instanceof TransformNode ? node : null;
    const spec = (this.node?.metadata as { fountain?: FountainSpec } | undefined)?.fountain;
    if (!this.node || !spec) return;
    this.spec = spec;
    this.node.computeWorldMatrix(true);
    this.centre = Vector3.TransformCoordinates(new Vector3(0, spec.basin.water, 0), this.node.getWorldMatrix());

    const meshes: Mesh[] = [];
    this.streams = this.buildStreams(spec);
    meshes.push(this.streams);
    meshes.push(...this.buildWater(spec, mats, sky));
    for (const m of meshes) {
      m.parent = this.node;
      m.isPickable = false;
      m.renderingGroupId = 1;
      m.metadata = { room: "courtyard", roomName: "Front Courtyard", level: "site", labels: [{ face: 0, label: m.name }], matKey: m.material?.name ?? "", kind: "moving" } satisfies MeshMeta;
    }
    lighting.addMeshes(meshes, []);
    this.buildSpray(spec);
    this.sound = new FountainSound(`${import.meta.env.BASE_URL}sounds/fountain-loop.mp3`);
    this.setQuality(this.quality);
  }

  // ------------------------------------------------ streams

  /** The streak texture: soft lines along the stream (v) over a faint body of water. */
  private streakTexture(): Texture {
    const W = 64;
    const H = 256;
    const { canvas, ctx } = makeCanvas(W, H);
    ctx.fillStyle = "rgb(70,70,70)";
    ctx.fillRect(0, 0, W, H);
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 46; i++) {
      const x = r() * W;
      const w = 1 + r() * 3.5;
      const len = 40 + r() * 170;
      const y = r() * H;
      const v = Math.round(150 + r() * 105);
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, `rgba(${v},${v},${v},0)`);
      g.addColorStop(0.3, `rgba(${v},${v},${v},1)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      // drawn twice, a height apart, so streaks crossing the edge wrap round
      for (const dy of [0, -H]) ctx.fillRect(x, y + dy, w, len);
    }
    ctx.filter = "blur(0.8px)";
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = "none";
    const tex = toTexture(this.scene, "fountainStreak", canvas, { aniso: 4 });
    tex.getAlphaFromRGB = true;
    return tex;
  }

  private buildStreams(s: FountainSpec): Mesh {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    /** a grid of rows of points, row k at flight time times[k]; u runs round each row `uRepeat` times */
    const grid = (rows: Vector3[][], times: number[], uRepeat: number) => {
      const base = pos.length / 3;
      const n = rows[0].length;
      rows.forEach((row, k) =>
        row.forEach((p, j) => {
          pos.push(p.x, p.y, p.z);
          uv.push((j / (n - 1)) * uRepeat, times[k] * FLOW);
        }),
      );
      for (let k = 0; k < rows.length - 1; k++)
        for (let j = 0; j < n - 1; j++) {
          const a = base + k * n + j;
          const b = a + n;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
    };
    /** a tube along points (with their flight times), its radius from r0 to r1 */
    const tube = (pts: Vector3[], times: number[], r0: number, r1: number, sides = 8) => {
      const rows = pts.map((p, k) => {
        const t = (pts[Math.min(k + 1, pts.length - 1)].subtract(pts[Math.max(k - 1, 0)])).normalize();
        const ref = Math.abs(t.y) > 0.9 ? Vector3.Right() : Vector3.Up();
        const n = Vector3.Cross(t, ref).normalize();
        const b = Vector3.Cross(n, t).normalize();
        const rad = r0 + (r1 - r0) * (k / (pts.length - 1));
        return Array.from({ length: sides + 1 }, (_, j) => {
          const a = (j / sides) * Math.PI * 2;
          return p.add(n.scale(Math.cos(a) * rad)).add(b.scale(Math.sin(a) * rad));
        });
      });
      grid(rows, times, 1);
    };

    // the arcs
    const T = arcFlightTime(s);
    const steps = 28;
    for (let i = 0; i < s.arcs.count; i++) {
      const pts: Vector3[] = [];
      const times: number[] = [];
      for (let k = 0; k <= steps; k++) {
        const [x, y, z] = arcPoint(s, i, k / steps);
        pts.push(new Vector3(x, y, z));
        times.push((k / steps) * T);
      }
      tube(pts, times, 0.016, 0.03);
    }
    // the jet, up from its nozzle to where it breaks into the crown (the spray)
    {
      const [jx, jy, jz] = s.jet.at;
      const v0 = Math.sqrt(2 * G * s.jet.rise);
      const top = (v0 / G) * 0.86;
      const pts: Vector3[] = [];
      const times: number[] = [];
      for (let k = 0; k <= 14; k++) {
        const t = (k / 14) * top;
        pts.push(new Vector3(jx, jy + v0 * t - 0.5 * G * t * t, jz));
        times.push(t);
      }
      tube(pts, times, 0.022, 0.04, 10);
    }
    // the sheets falling off the bowls' lips, each to the water below it
    s.bowls.forEach((bowl, i) => {
      const below = i === 0 ? s.basin.water : s.bowls[i - 1].water;
      const fall = Math.sqrt((2 * (bowl.lip - below)) / G);
      const around = 72;
      const rows: Vector3[][] = [];
      const times: number[] = [];
      const n = 10;
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * fall;
        const rad = bowl.r + 0.012 + bowl.spill * t;
        const y = bowl.lip - 0.004 - 0.5 * G * t * t;
        rows.push(Array.from({ length: around + 1 }, (_, j) => {
          const a = (j / around) * Math.PI * 2;
          return new Vector3(Math.sin(a) * rad, y, Math.cos(a) * rad);
        }));
        times.push(t);
      }
      grid(rows, times, Math.round(bowl.r * 14));
    });

    const mesh = new Mesh("Fountain streams", this.scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.uvs = uv;
    vd.indices = idx;
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, idx, normals);
    vd.normals = normals;
    vd.applyToMesh(mesh);

    const m = new StandardMaterial("fountainStreams", this.scene);
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    this.streak = this.streakTexture();
    m.emissiveTexture = this.streak;
    m.opacityTexture = this.streak;
    m.emissiveColor = TINT.day.stream.clone();
    m.alpha = 0.85;
    m.fogEnabled = true;
    this.streamMat = m;
    mesh.material = m;
    mesh.alphaIndex = 20;
    return mesh;
  }

  // ------------------------------------------------ water surfaces

  private buildWater(s: FountainSpec, mats: Materials, sky: AbstractMesh): Mesh[] {
    // the cheap water: tinted, nearly mirror-smooth, two drifting layers of ripples
    const cheap = new PBRMaterial("fountainWaterCheap", this.scene);
    cheap.albedoColor = Color3.FromHexString(TINT.day.water).toLinearSpace();
    cheap.metallic = 0;
    cheap.roughness = 0.06;
    cheap.environmentIntensity = 0.9;
    cheap.clearCoat.isEnabled = true;
    cheap.clearCoat.intensity = 0.6;
    cheap.clearCoat.roughness = 0.03;
    const n1 = mats.waterNormal("fountainRippleA");
    n1.uScale = n1.vScale = 1.6;
    n1.level = 0.5;
    const n2 = mats.waterNormal("fountainRippleB");
    n2.uScale = n2.vScale = 3.1;
    n2.level = 0.35;
    cheap.bumpTexture = n1;
    cheap.clearCoat.bumpTexture = n2;
    cheap.invertNormalMapY = true;
    cheap.maxSimultaneousLights = 8;
    this.ripples = [n1, n2];
    this.cheap = cheap;

    /** a flat disc of water; the water's plane is the mesh's own height (the reflecting water mirrors about it) */
    const disc = (name: string, r: number, y: number) => {
      const d = MeshBuilder.CreateDisc(name, { radius: r, tessellation: 96 }, this.scene);
      d.rotation.x = Math.PI / 2;
      d.bakeCurrentTransformIntoVertices();
      d.position.y = y;
      d.receiveShadows = true;
      d.material = cheap;
      return d;
    };
    const basin = disc("Fountain basin water", s.basin.inner + 0.01, s.basin.water);
    this.basin = basin;
    // the bowls' water, one mesh (both always have the cheap water)
    const bowls = Mesh.MergeMeshes(s.bowls.map((b, i) => disc(`Fountain bowl water ${i + 1}`, b.inner + 0.01, b.water)), true)!;
    bowls.name = "Fountain bowl water";
    bowls.receiveShadows = true;

    // the reflecting water: its render lists only the fountain's own stone and the sky
    const mirror = new WaterMaterial("fountainWater", this.scene, new Vector2(256, 256));
    mirror.bumpTexture = mats.waterNormal("fountainWaterBump");
    mirror.bumpHeight = 0.06;
    mirror.waveHeight = 0;
    mirror.waveLength = 0.08;
    mirror.waveSpeed = 12;
    mirror.windForce = -3;
    mirror.windDirection = new Vector2(0.6, 0.8);
    mirror.waterColor = Color3.FromHexString(TINT.day.water);
    mirror.waterColor2 = Color3.FromHexString(TINT.day.deep);
    mirror.colorBlendFactor = 0.32;
    mirror.colorBlendFactor2 = 0.25;
    mirror.specularColor = new Color3(0.6, 0.6, 0.6);
    mirror.specularPower = 120;
    mirror.maxSimultaneousLights = 8;
    mirror.backFaceCulling = true;
    const stone = new Set(["stoneWhite", "poolTile", "coping"]);
    for (const m of this.scene.meshes) {
      const md = m.metadata as MeshMeta | undefined;
      if (md?.room === "courtyard" && stone.has(md.matKey)) mirror.addToRenderList(m);
    }
    mirror.addToRenderList(sky);
    this.mirror = mirror;
    return [basin, bowls];
  }

  // ------------------------------------------------ spray

  /** A soft round droplet. */
  private dropTexture(): Texture {
    const S = 32;
    const { canvas, ctx } = makeCanvas(S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.75)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return toTexture(this.scene, "fountainDrop", canvas, { wrap: false, mipmaps: false, hasAlpha: true });
  }

  private system(name: string, capacity: number, tex: Texture): ParticleSystem {
    const p = new ParticleSystem(name, capacity, this.scene);
    p.particleTexture = tex;
    p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    p.renderingGroupId = 1;
    // speeds in m/s and lifetimes in s: one update step is a sixtieth of a second, at 60 fps
    p.updateSpeed = 1 / 60;
    p.minEmitPower = p.maxEmitPower = 1;
    p.gravity = new Vector3(0, -G, 0);
    p.emitter = this.centre.clone();
    p.isLocal = false;
    p.preventAutoStart = true;
    return p;
  }

  private buildSpray(s: FountainSpec): void {
    const wm = this.node!.getWorldMatrix();
    const world = (x: number, y: number, z: number, out: Vector3) => Vector3.TransformCoordinatesFromFloatsToRef(x, y, z, wm, out);
    const dir = (x: number, y: number, z: number, out: Vector3) => Vector3.TransformNormalFromFloatsToRef(x, y, z, wm, out);
    const tex = this.dropTexture();
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    // the jet's crown: up from the nozzle, opening out and falling back into the top bowl
    const jet = this.system("Fountain jet spray", JET.capacity, tex);
    const v0 = Math.sqrt(2 * G * s.jet.rise);
    const [jx, jy, jz] = s.jet.at;
    jet.startPositionFunction = (_m, out) => world(jx, jy + 0.02, jz, out);
    jet.startDirectionFunction = (_m, out) => {
      const a = Math.random() * Math.PI * 2;
      const h = rnd(0.08, 0.42);
      dir(Math.sin(a) * h, v0 * rnd(0.86, 1), Math.cos(a) * h, out);
    };
    jet.minLifeTime = 0.62;
    jet.maxLifeTime = (2 * v0) / G * 0.95;
    jet.minSize = 0.045;
    jet.maxSize = 0.1;

    // droplets peeling off the arcs, flying on as the stream does
    const arcSpray = this.system("Fountain arc spray", ARC_SPRAY.capacity, tex);
    const T = arcFlightTime(s);
    const [b, c] = arcCoefficients(s);
    let pick = 0;
    let along = 0;
    arcSpray.startPositionFunction = (_m, out) => {
      pick = Math.floor(Math.random() * s.arcs.count);
      along = rnd(0.12, 0.98);
      const [x, y, z] = arcPoint(s, pick, along);
      world(x + rnd(-0.015, 0.015), y, z + rnd(-0.015, 0.015), out);
    };
    arcSpray.startDirectionFunction = (_m, out) => {
      const a = s.arcs.turn + (pick / s.arcs.count) * Math.PI * 2;
      const dr = (s.arcs.to.r - s.arcs.from.r) / T;
      const dy = (b + 2 * c * along) / T;
      const k = rnd(0.85, 1.05);
      dir(Math.sin(a) * dr * k + rnd(-0.3, 0.3), dy * k + rnd(-0.2, 0.25), Math.cos(a) * dr * k + rnd(-0.3, 0.3), out);
    };
    arcSpray.minLifeTime = 0.1;
    arcSpray.maxLifeTime = 0.32;
    arcSpray.minSize = 0.022;
    arcSpray.maxSize = 0.05;

    // splashes where the water lands: the arcs' feet, and round the sheets' feet
    const splash = this.system("Fountain splash", SPLASH.capacity, tex);
    splash.startPositionFunction = (_m, out) => {
      const k = Math.random();
      let x: number;
      let y: number;
      let z: number;
      if (k < 0.62) {
        [x, y, z] = arcPoint(s, Math.floor(Math.random() * s.arcs.count), 1);
        x += rnd(-0.05, 0.05);
        z += rnd(-0.05, 0.05);
      } else {
        const i = k < 0.88 ? 0 : 1;
        const bowl = s.bowls[i];
        const below = i === 0 ? s.basin.water : s.bowls[0].water;
        const rad = bowl.r + bowl.spill * Math.sqrt((2 * (bowl.lip - below)) / G);
        const a = Math.random() * Math.PI * 2;
        x = Math.sin(a) * rad;
        y = below;
        z = Math.cos(a) * rad;
      }
      world(x, y + 0.01, z, out);
    };
    splash.startDirectionFunction = (_m, out) => {
      const a = Math.random() * Math.PI * 2;
      const h = rnd(0.15, 0.6);
      dir(Math.sin(a) * h, rnd(0.7, 1.7), Math.cos(a) * h, out);
    };
    splash.minLifeTime = 0.14;
    splash.maxLifeTime = 0.34;
    splash.minSize = 0.03;
    splash.maxSize = 0.075;

    this.jet = jet;
    this.arcSpray = arcSpray;
    this.splash = splash;
    this.applyTint();
  }

  // ------------------------------------------------ settings

  setQuality(q: Quality): void {
    this.quality = q;
    const k = RATE_SCALE[q];
    if (this.jet) this.jet.emitRate = JET.rate * k;
    if (this.arcSpray) this.arcSpray.emitRate = ARC_SPRAY.rate * k;
    if (this.splash) this.splash.emitRate = q === "low" ? 0 : SPLASH.rate * k;
    // the reflections redrawn every other frame (every third at medium): still water, a small surface
    for (const rt of [this.mirror?.reflectionTexture, this.mirror?.refractionTexture]) if (rt) rt.refreshRate = q === "high" ? 2 : 3;
    this.sprayWanted = false;
  }

  setNight(n: boolean): void {
    this.night = n;
    this.applyTint();
  }

  private applyTint(): void {
    const tint = this.night ? TINT.night : TINT.day;
    this.streamMat?.emissiveColor.copyFrom(tint.stream);
    for (const p of [this.jet, this.arcSpray, this.splash]) {
      if (!p) continue;
      p.color1 = tint.spray.clone();
      p.color2 = new Color4(tint.spray.r * 0.9, tint.spray.g * 0.95, tint.spray.b, tint.spray.a * 0.75);
      p.colorDead = new Color4(tint.spray.r, tint.spray.g, tint.spray.b, 0);
    }
    if (this.cheap) this.cheap.albedoColor = Color3.FromHexString(tint.water).toLinearSpace();
    if (this.mirror) {
      this.mirror.waterColor = Color3.FromHexString(tint.water);
      this.mirror.waterColor2 = Color3.FromHexString(tint.deep);
    }
  }

  /** For the tests: what the fountain is doing now. */
  info(): { built: boolean; mirror: boolean; spraying: boolean; particles: number; sound: { playing: boolean; level: number } } {
    return {
      built: !!this.streams,
      mirror: !!this.basin && this.basin.material === this.mirror,
      // switched on, and a system really emitting (isStarted() stays true after stop(): isAlive() goes false once its last drop is gone)
      spraying: this.sprayWanted && [this.jet, this.arcSpray, this.splash].some((p) => !!p && p.isAlive() && p.emitRate > 0),
      particles: [this.jet, this.arcSpray, this.splash].reduce((n, p) => n + (p?.getActiveCount() ?? 0), 0),
      sound: { playing: this.sound?.playing ?? false, level: this.sound?.level ?? 0 },
    };
  }

  // ------------------------------------------------ each frame

  update(dt: number): void {
    if (!this.streams || !this.basin || !this.spec) return;
    this.t += dt;
    if (this.streak) this.streak.vOffset = -((this.t * FLOW) % 1);
    const [r1, r2] = this.ripples;
    if (r1) {
      r1.uOffset = (this.t * 0.021) % 1;
      r1.vOffset = (this.t * 0.013) % 1;
    }
    if (r2) {
      r2.uOffset = (-this.t * 0.017) % 1;
      r2.vOffset = (this.t * 0.027) % 1;
    }

    const cam = this.fly.camera;
    const eye = this.fly.eye;
    const d = Vector3.Distance(cam.position, this.centre);
    const inView = this.streams.isEnabled() && cam.isInFrustum(this.streams);
    // the reflecting water near and in view, above low quality; the cheap water otherwise
    const mirror = this.quality !== "low" && inView && d < MIRROR_FAR;
    const want = mirror && this.mirror ? this.mirror : this.cheap;
    if (want && this.basin.material !== want) this.basin.material = want;
    // spray while near and in view
    const spray = inView && d < SPRAY_FAR;
    if (spray !== this.sprayWanted) {
      this.sprayWanted = spray;
      for (const p of [this.jet, this.arcSpray, this.splash]) {
        if (!p) continue;
        if (spray && p.emitRate > 0) p.start();
        else p.stop();
      }
    }
    if (this.sound) {
      const fwd = cam.getDirection(Vector3.Forward());
      const up = cam.getDirection(Vector3.Up());
      const c = this.centre;
      this.sound.listen([eye.x, eye.y, eye.z], [fwd.x, fwd.y, fwd.z], [up.x, up.y, up.z], [c.x, c.y + 0.5, c.z], !!roomAt(eye));
    }
  }
}
