// The chimp lab (chimp.html): one chimp under light like the house's, a camera that
// orbits it, and a hook (window.__lab) for tools/chimp-shots.mjs to photograph it
// from set views. It is where the avatar's look and movement are worked on, and
// where clothes are tried on every kind of body (tools/wardrobe-shots.mjs).

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Scene,
  ShadowGenerator,
  Vector3,
} from "@babylonjs/core";
import { skyCube } from "../engine/lighting";
import { PostFx } from "../engine/postfx";
import { type ChimpDna, type ShapeKey, PRESETS, defaultDna, presetDna, randomDna, sanitize } from "../avatar/dna";
import { buildModel } from "../avatar/model";
import { Chimp, SHELLS } from "../avatar/chimp";
import { ChimpAnimator, type Motion } from "../avatar/animator";
import { buildAnatomy } from "../avatar/anatomy";
import { buildItem } from "../avatar/items";
import { item, itemColours, wornOver } from "../avatar/wardrobe";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("c") as HTMLCanvasElement;
const info = document.getElementById("info")!;
const engine = new Engine(canvas, false, { preserveDrawingBuffer: true, stencil: true, antialias: false }, false);
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
const scene = new Scene(engine);
scene.clearColor = new Color4(0.08, 0.065, 0.055, 1);
const night = params.get("night") === "1";

// ---------------------------------------------------------------- light, as indoors in the house
const sunDir = new Vector3(0.55, 0.62, 0.56).normalize();
const sun = new DirectionalLight("sun", sunDir.scale(-1), scene);
sun.position = sunDir.scale(8);
sun.intensity = night ? 0.3 : 3.2;
sun.diffuse = Color3.FromHexString(night ? "#7f9cd8" : "#ffc98f").toLinearSpace();
const hemi = new HemisphericLight("hemi", new Vector3(0.15, 1, -0.1), scene);
hemi.intensity = night ? 0.12 : 0.45;
hemi.diffuse = Color3.FromHexString("#cfe0f2").toLinearSpace();
hemi.groundColor = Color3.FromHexString("#6d5a3c").toLinearSpace();
hemi.specular = Color3.Black();
for (const [x, y, z, i] of [
  [-1.6, 2.6, 1.2, 9],
  [1.8, 2.4, -1.0, 6],
]) {
  const p = new PointLight("pendant", new Vector3(x, y, z), scene);
  p.diffuse = Color3.FromHexString("#ffb766").toLinearSpace();
  p.intensity = night ? i * 2 : i;
  p.range = 12;
}
scene.environmentTexture = skyCube(scene, night);
scene.environmentIntensity = night ? 0.6 : 1;

// a timber floor and a dark backdrop
const floor = MeshBuilder.CreateDisc("floor", { radius: 4, tessellation: 64 }, scene);
floor.rotation.x = Math.PI / 2;
const fm = new PBRMaterial("floor", scene);
fm.albedoColor = Color3.FromHexString("#b3713f").toLinearSpace();
fm.roughness = 0.45;
fm.metallic = 0;
floor.material = fm;
floor.receiveShadows = true;
floor.renderingGroupId = 1;

const camera = new ArcRotateCamera("cam", Math.PI / 2, 1.35, 3.2, new Vector3(0, 0.85, 0), scene);
camera.minZ = 0.02;
camera.fov = 0.6;
camera.wheelPrecision = 60;
camera.attachControl(canvas, true);
const post = new PostFx(scene, camera);
post.setQuality("high");
post.setNight(night);

const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering = true;
shadows.bias = 0.002;
shadows.normalBias = 0.01;

// ---------------------------------------------------------------- the chimp
let chimp: Chimp | null = null;
let animator: ChimpAnimator | null = null;
let dna: ChimpDna = params.get("dna") ? sanitize(JSON.parse(params.get("dna")!)) : params.get("random") ? randomDna(seeded(Number(params.get("random")))) : defaultDna();
let stats = "";

function build(next: ChimpDna) {
  dna = next;
  const t0 = performance.now();
  const model = buildModel(dna);
  const ms = performance.now() - t0;
  chimp?.dispose();
  chimp = new Chimp(scene, model, dna);
  chimp.place(0, 0, 0, 0, dna.shape.height);
  animator = new ChimpAnimator(chimp);
  // dressed in ?wear=cap,tee,… (each in its own colours), or in the DNA's outfit
  const fur: Parameters<typeof buildItem>[1] = {};
  for (const p of model.parts) if (p.fur) fur[p.name] = p.fur.positions;
  const anatomy = buildAnatomy(dna);
  const wear = params.get("wear")?.split(",").filter(Boolean) ?? Object.values(dna.outfit).map((w) => w!.id);
  // what the list puts in each slot, for what goes over what (a bandana over the tee)
  const outfit: Partial<Record<string, { id: string }>> = {};
  for (const id of wear) {
    const def = item(id);
    if (def) outfit[def.slot] = { id };
  }
  for (const id of wear) {
    const def = item(id);
    if (!def) continue;
    const t1 = performance.now();
    chimp.wear(def.slot, buildItem(anatomy, fur, id, wornOver(def, outfit)), itemColours(def, dna.outfit[def.slot]?.colors));
    console.log(`[lab] ${id} in ${Math.round(performance.now() - t1)} ms`);
  }
  const shells = params.get("shells");
  chimp.setShells(shells !== null ? Number(shells) : SHELLS.high);
  for (const m of chimp.meshes) shadows.addShadowCaster(m, false);
  const tris = model.parts.reduce((s, p) => s + p.skin.indices.length / 3, 0);
  const furTris = model.parts.reduce((s, p) => s + (p.fur ? p.fur.indices.length / 3 : 0), 0);
  stats = `built in ${Math.round(ms)} ms · skin ${tris} tris · fur carrier ${furTris} tris · ${model.rig.bones.length} bones`;
}

/** Bodies to try clothes on: the wardrobe's presets, and the ends of the body's and face's settings. */
const withShape = (shape: Partial<Record<ShapeKey, number>>): ChimpDna => {
  const d = defaultDna();
  Object.assign(d.shape, shape);
  return d;
};
const BODIES: Record<string, () => ChimpDna> = {
  ...Object.fromEntries(PRESETS.map((p) => [p.name, () => presetDna(p.name, {})])),
  Slim: () => withShape({ height: 1.3, build: 0, belly: 0, arms: 0, legs: 0, head: 0, muzzle: 0, brow: 0, ears: 0, eyes: 0, furLength: 0 }),
  Big: () => withShape({ height: 1.8, build: 1, belly: 1, arms: 1, legs: 1, head: 1, muzzle: 1, brow: 1, ears: 1, eyes: 1, furLength: 1 }),
};

/** Where a view looks: a point on the chimp as it stands now (its eyes, its left hand…), or a height on it. */
const at = (bone: string, dy = 0) => () => {
  const n = chimp!.nodes[bone];
  n.computeWorldMatrix(true);
  return n.getAbsolutePosition().add(new Vector3(0, dy, 0));
};
const eyes = () => {
  const l = at("leftEye")();
  return l.add(at("rightEye")()).scale(0.5).add(new Vector3(0, -0.035, 0));
};
const middle = () => new Vector3(0, dna.shape.height * 0.48, 0);
/** the top of the head: between the eyes and the crown */
const crown = () => eyes().add(new Vector3(0, 0.06 * (dna.shape.height / 1.5), -0.02));
const VIEWS: Record<string, { alpha: number; beta: number; radius: number; target: () => Vector3 }> = {
  // close on what a piece of clothing covers: the head, the neck and chest, the torso, the left wrist
  headFront: { alpha: Math.PI / 2, beta: 1.45, radius: 0.62, target: crown },
  head3: { alpha: Math.PI / 2 - 0.65, beta: 1.32, radius: 0.66, target: crown },
  headSide: { alpha: Math.PI, beta: 1.42, radius: 0.66, target: crown },
  headBack: { alpha: -Math.PI / 2 - 0.5, beta: 1.2, radius: 0.66, target: crown },
  neckFront: { alpha: Math.PI / 2 + 0.25, beta: 1.42, radius: 0.85, target: at("upperChest", 0.08) },
  neck3: { alpha: Math.PI / 2 - 0.7, beta: 1.3, radius: 0.85, target: at("upperChest", 0.08) },
  neckBack: { alpha: -Math.PI / 2 + 0.4, beta: 1.2, radius: 0.85, target: at("upperChest", 0.08) },
  nape: { alpha: -Math.PI / 2 + 0.25, beta: 1.2, radius: 0.5, target: at("neck", 0.05) },
  torsoFront: { alpha: Math.PI / 2, beta: 1.45, radius: 1.55, target: at("chest", 0.02) },
  torso3: { alpha: Math.PI / 2 - 0.7, beta: 1.35, radius: 1.55, target: at("chest", 0.02) },
  torsoSide: { alpha: Math.PI, beta: 1.42, radius: 1.55, target: at("chest", 0.02) },
  torsoBack: { alpha: -Math.PI / 2 + 0.5, beta: 1.3, radius: 1.55, target: at("chest", 0.02) },
  hem: { alpha: Math.PI / 2 + 0.3, beta: 1.4, radius: 0.75, target: at("hips", 0.04) },
  wristOut: { alpha: Math.PI - 0.35, beta: 1.25, radius: 0.42, target: at("leftHand", 0.02) },
  wristTop: { alpha: Math.PI / 2 + 0.55, beta: 0.85, radius: 0.42, target: at("leftHand", 0.02) },
  front: { alpha: Math.PI / 2, beta: 1.42, radius: 3.4, target: middle },
  three: { alpha: Math.PI / 2 - 0.62, beta: 1.36, radius: 3.4, target: middle },
  side: { alpha: Math.PI, beta: 1.42, radius: 3.4, target: middle },
  back: { alpha: -Math.PI / 2, beta: 1.36, radius: 3.4, target: middle },
  face: { alpha: Math.PI / 2 - 0.45, beta: 1.5, radius: 0.72, target: eyes },
  faceFront: { alpha: Math.PI / 2, beta: 1.53, radius: 0.62, target: eyes },
  faceSide: { alpha: Math.PI, beta: 1.53, radius: 0.72, target: eyes },
  hands: { alpha: Math.PI / 2 - 0.9, beta: 1.45, radius: 0.72, target: at("leftHand", -0.05) },
  feet: { alpha: Math.PI / 2 - 0.5, beta: 1.25, radius: 0.8, target: at("leftFoot", -0.03) },
};

function setView(name: string) {
  const v = VIEWS[name] ?? VIEWS.front;
  // the target first: setting it keeps the camera where it is and works out its angles afresh
  camera.setTarget(v.target());
  camera.alpha = v.alpha;
  camera.beta = v.beta;
  // as far off for every height of chimp, so each fills the frame alike
  camera.radius = v.radius * (dna.shape.height / 1.5);
}

build(dna);
setView(params.get("view") ?? "front");

// what the chimp does: stand, walk, jog or run on the spot (a treadmill), or hold its rest pose
const PACES: Record<string, number> = { idle: 0, walk: 1.2, jog: 2.5, run: 5.5 };
let anim = params.get("anim") ?? "idle";
let frozen = false;
const motion = (): Motion => ({ speed: PACES[anim] ?? 0, heading: 0, turn: 0, grounded: true, lookYaw: 0, lookPitch: 0 });

/** Run the animation from the start for `seconds` in even steps, then hold it there (for photographs). */
function simulate(name: string, seconds: number) {
  anim = name;
  if (!chimp) return;
  animator = new ChimpAnimator(chimp);
  if (name === "rest") {
    // every bone back as it rests
    for (const [n, node] of Object.entries(chimp.nodes)) {
      node.position.copyFrom(chimp.rest[n]);
      node.rotationQuaternion!.set(0, 0, 0, 1);
    }
    chimp.setLids(1);
  } else for (let t = 0; t < seconds; t += 1 / 60) animator.update(1 / 60, motion());
  frozen = true;
}

if (params.get("t")) simulate(anim, Number(params.get("t")));

let frames = 0;
engine.runRenderLoop(() => {
  if (!frozen && anim !== "rest" && animator) animator.update(engine.getDeltaTime() / 1000, motion());
  scene.render();
  frames++;
  if (frames % 20 === 0) info.textContent = `${stats}\n${Math.round(engine.getFps())} fps`;
});
addEventListener("resize", () => engine.resize());

/** A small seeded random, so ?random=<seed> always makes the same chimp. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

(window as unknown as { __lab: unknown }).__lab = {
  get ready() {
    return frames > 30;
  },
  whenReady: () => scene.whenReadyAsync(),
  settle: (n: number) =>
    new Promise<void>((done) => {
      const until = frames + n;
      const tick = () => (frames >= until ? done() : requestAnimationFrame(tick));
      tick();
    }),
  setView,
  simulate,
  play: (name: string) => ((anim = name), (frozen = false)),
  setDna: (d: unknown) => build(sanitize(d)),
  /** rebuild as one of BODIES (a preset, Slim or Big), wearing what ?wear= says */
  setBody: (name: string) => build(BODIES[name]?.() ?? defaultDna()),
  bodies: () => Object.keys(BODIES),
  dna: () => dna,
  stats: () => stats,
  scene,
  chimp: () => chimp,
};
