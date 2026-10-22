// Chimps in the house: this visitor's own, which walks where the walker walks, and
// every other visitor's, as the room server (engine/room.ts) says they are.
//
// - Each visitor's DNA (avatar/dna.ts) and name go to the room as the family
//   "chimpdna:<id>", whenever they change; where their chimp stands and how it moves
//   as "chimp:<id>", several times a second while it moves. Other visitors' chimps
//   are drawn a moment behind, smoothly between what they last heard.
// - Every chimp is lit as the house is where it stands, by copies of the room
//   lights there that light only it (ChimpLights, in lighting.ts), draws fewer fur
//   shells the further it is from the camera, and has a soft shadow under it.
// - This visitor's chimp turns to the way it goes, looks where the camera looks
//   (or, with the camera in front of it, at the camera), fades as the camera comes
//   close, and isn't drawn from its own eyes (first person) or while a screen is in use.
// - A chimp holds in its right hand what its visitor holds (a theatre remote: setInHand),
//   so everyone sees who has it.

import { BoundingSphere, Color3, DynamicTexture, Frustum, Mesh, MeshBuilder, Plane, Scene, StandardMaterial, type TransformNode, Vector3 } from "@babylonjs/core";
import { ChimpAnimator, type Motion } from "../avatar/animator";
import { chimpModel, itemModel } from "../avatar/builder";
import { Chimp, SHELLS } from "../avatar/chimp";
import { type ChimpDna, SLOTS, type Slot, defaultDna, geometryKey, sanitize } from "../avatar/dna";
import { item, itemColours, knownItem, wornOver } from "../avatar/wardrobe";
import type { Level } from "../world/context";
import { inCourtyard, levelAt, roomAt } from "../world/layout";
import { emptyProbe } from "./collision";
import type { FlyCamera } from "./flyCamera";
import { toPage } from "./focus";
import type { ChimpLights, Lighting } from "./lighting";
import { ME, room } from "./room";
import { type Quality, store } from "./store";

const DNA_KEY = "chimphouse.chimp.v1";
/** How far behind the room's clock other visitors' chimps are drawn (ms): time for the next word of where they are. */
const BEHIND = 160;
/** How often this visitor says where its chimp is (ms): moving, and standing still. */
const SAY_MOVING = 100;
const SAY_STILL = 1500;

/** What a visitor tells the room about their chimp, many times a second while it moves. */
interface Presence {
  /** walking about (and so shown), or flying */
  walking: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  ground: boolean;
  lookYaw: number;
  lookPitch: number;
  /** the room's clock when this was so */
  t: number;
}

/** A visitor's chimp's look, and who they are. */
interface Identity {
  name: string;
  dna: ChimpDna;
}

/** One chimp in the scene: built from its DNA when its model is ready, moved by its animator. */
class Body {
  chimp: Chimp | null = null;
  animator: ChimpAnimator | null = null;
  dna: ChimpDna;
  private geometry = "";
  private wanted = 0;
  /** the room whose lights light it */
  room: string | null = null;
  /** the chimp's meshes as last lit (its version: clothes change them) */
  litVersion = -1;
  readonly shadow: Mesh;
  /** what each slot is being dressed in (the item, and the clothes it goes over), so an older one arriving late is dropped */
  private dressing: Partial<Record<Slot, string>> = {};
  /** what each slot wears, as it was made: the item and the clothes it was made over */
  private made: Partial<Record<Slot, string>> = {};

  constructor(
    private scene: Scene,
    dna: ChimpDna,
    private name: string,
    readonly lights: ChimpLights,
    private onBuilt: (b: Body) => void,
  ) {
    this.dna = dna;
    this.shadow = contactShadow(scene, name);
    this.setDna(dna);
  }

  /** Wear new DNA: colours, height and clothes at once, a new shape once its model is ready. */
  setDna(dna: ChimpDna): void {
    this.dna = dna;
    const key = geometryKey(dna);
    if (this.chimp && key === this.geometry) {
      this.chimp.setColours(dna);
      this.dress();
      return;
    }
    const ticket = ++this.wanted;
    void chimpModel(dna).then((model) => {
      // a newer look was asked for meanwhile, or the body was let go of
      if (ticket !== this.wanted || this.wanted < 0) return;
      const old = this.chimp;
      this.chimp = new Chimp(this.scene, model, this.dna, this.name);
      this.animator = new ChimpAnimator(this.chimp);
      this.geometry = key;
      if (old) {
        // carry the pose over, so a reshaped chimp doesn't jump
        this.chimp.root.position.copyFrom(old.root.position);
        this.chimp.root.rotationQuaternion = old.root.rotationQuaternion?.clone() ?? null;
        old.dispose();
      }
      this.litVersion = -1;
      this.dressing = {};
      this.made = {};
      this.dress();
      this.onBuilt(this);
    });
  }

  /** Dress the chimp as its DNA says: items put on, taken off or recoloured; each made for its shape. */
  private dress(): void {
    const c = this.chimp;
    if (!c) return;
    const on = c.wearing();
    for (const { slot } of SLOTS) {
      const want = this.dna.outfit[slot];
      const def = want ? item(want.id) : undefined;
      if (!want || !def) {
        delete this.dressing[slot];
        delete this.made[slot];
        if (on[slot]) c.wear(slot, null, []);
        continue;
      }
      const colours = itemColours(def, want.colors);
      // made over the clothes it is worn over (a bandana over the tee): a new tee, a new bandana
      const over = wornOver(def, this.dna.outfit);
      const key = `${want.id}|${over.join(",")}`;
      if (this.made[slot] === key || this.dressing[slot] === key) {
        c.colourWorn(slot, colours);
        continue;
      }
      this.dressing[slot] = key;
      void itemModel(this.dna, want.id, over).then((m) => {
        // the chimp was rebuilt, or something else was chosen for the slot, meanwhile
        if (this.chimp !== c || this.dressing[slot] !== key) return;
        const now = this.dna.outfit[slot];
        c.wear(slot, m, itemColours(def, now?.id === want.id ? now.colors : want.colors));
        this.made[slot] = key;
      });
    }
  }

  dispose(): void {
    this.wanted = -1;
    this.chimp?.dispose();
    this.chimp = null;
    this.shadow.dispose();
    this.lights.dispose();
  }
}

/** Something a chimp holds in its hand: its key, and how to build its model (built afresh for each chimp that holds it). */
export interface InHand {
  key: string;
  build: () => { root: TransformNode; meshes: Mesh[] };
}

/** A remote visitor's chimp, with what they last said about it. */
interface Remote {
  body: Body | null;
  name: string;
  dna: ChimpDna | null;
  said: Presence[];
  label: HTMLDivElement;
  facing: number;
}

export class Avatars {
  /** this visitor's chimp */
  readonly mine: Body;
  private facing = 0;
  private lastFacing = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private others = new Map<string, Remote>();
  /** what each visitor's chimp holds in its hand, by visitor id */
  private hands = new Map<string, InHand>();
  private sayPose: (p: Presence) => void;
  private sayDna: (i: Identity) => void;
  private saidAt = 0;
  private lastSaid: Presence | null = null;
  private labels: HTMLDivElement;
  private frustum: Plane[] = [];
  private probe = emptyProbe();
  private sphere = new BoundingSphere(Vector3.Zero(), Vector3.Zero());

  constructor(
    private scene: Scene,
    private fly: FlyCamera,
    private lighting: Lighting,
  ) {
    this.mine = new Body(scene, loadDna(), "My chimp", lighting.chimpLights(), (b) => this.built(b));
    this.labels = document.createElement("div");
    this.labels.className = "chimp-labels";
    document.querySelector(".app")?.appendChild(this.labels) ?? document.body.appendChild(this.labels);
    // everyone else's chimps, and their looks
    this.sayDna = room.family<Identity>("chimpdna:", (topic, i) => this.heardDna(topic.slice("chimpdna:".length), i));
    this.sayPose = room.family<Presence>("chimp:", (topic, p) => this.heardPose(topic.slice("chimp:".length), p));
    room.onGone((id) => this.forget(id));
    this.sayDna({ name: ME.name, dna: this.mine.dna });
  }

  /** What visitor `who`'s chimp holds in its hand (this visitor's too), or null: it shows the next time their chimp is drawn. */
  setInHand(who: string, item: InHand | null): void {
    if (item) this.hands.set(who, item);
    else this.hands.delete(who);
  }

  /** This visitor's chimp's DNA. */
  get dna(): ChimpDna {
    return this.mine.dna;
  }

  /** Change this visitor's chimp: kept for their next visit, and shown to everyone. */
  setDna(dna: ChimpDna): void {
    const d = sanitize(dna, knownItem);
    // a new shape is built (a moment, in the workers); colours, height and clothes are not
    const reshaping = !this.mine.chimp || geometryKey(d) !== geometryKey(this.mine.dna);
    this.mine.setDna(d);
    try {
      localStorage.setItem(DNA_KEY, JSON.stringify(d));
    } catch {
      /* storage unavailable: it lasts this visit */
    }
    this.sayDna({ name: ME.name, dna: d });
    if (reshaping) store.set({ chimpBuilding: true });
  }

  /** A body's chimp has been (re)built: give it what the scene needs. */
  private built(b: Body) {
    if (b === this.mine) {
      store.set({ chimpBuilding: false });
      this.fitWalker();
    }
  }

  /** The walker sees from the chimp's eyes, and the camera turns over its head. */
  private fitWalker() {
    const c = this.mine.chimp;
    if (!c) return;
    const k = this.mine.dna.shape.height / c.baseHeight;
    // the eyes as the chimp stands, a little stooped
    const eye = (c.rig.marks.eyeL[1] - 0.07) * k;
    if (this.fly.walker) this.fly.walker.eye = eye;
    this.fly.pivotHeight = this.mine.dna.shape.height + 0.14;
  }

  update(dt: number): void {
    const s = store.get();
    const cam = this.fly.camera;
    const vp = cam.getTransformationMatrix();
    this.frustum = Frustum.GetPlanes(vp);
    this.updateMine(dt, s.walking, s.quality, !!s.focus);
    const now = room.now();
    for (const [id, r] of this.others) this.updateOther(id, r, now, dt, s.quality);
  }

  private updateMine(dt: number, walking: boolean, quality: Quality, focus: boolean) {
    const b = this.mine;
    const c = b.chimp;
    const w = this.fly.walker;
    if (w && w.eye !== undefined && c && Math.abs(w.eye - (c.rig.marks.eyeL[1] - 0.07) * (b.dna.shape.height / c.baseHeight)) > 1e-3) this.fitWalker();
    const shown = walking && !!w;
    if (!c || !w || !shown) {
      if (c) c.root.setEnabled(false);
      b.shadow.setEnabled(false);
      this.say(shown);
      return;
    }
    c.root.setEnabled(true);
    const v = w.velocity;
    const speed = Math.hypot(v.x, v.z);
    const camYaw = this.cameraYaw();
    // first person: the chimp faces the way the camera does; else it turns to the way it goes
    if (this.fly.firstPerson) this.facing = camYaw;
    else if (speed > 0.15 && !this.fly.holdStill) this.facing = turnToward(this.facing, Math.atan2(v.x, v.z), 9 * dt);
    const turn = wrap(this.facing - this.lastFacing) / Math.max(dt, 1e-3);
    this.lastFacing = this.facing;
    // where it looks: where the camera looks, or (the camera in front of it) at the camera
    const rel = wrap(camYaw - this.facing);
    const pitch = this.cameraPitch();
    const toCam = this.fly.camera.position.subtract(new Vector3(w.feet.x, w.eyeY, w.feet.z));
    const atCamYaw = wrap(Math.atan2(toCam.x, toCam.z) - this.facing);
    const atCamPitch = Math.atan2(toCam.y, Math.hypot(toCam.x, toCam.z));
    const facingCam = smoothstepN(1.5, 2.2, Math.abs(rel));
    this.lookYaw = lerpN(rel, atCamYaw, facingCam);
    this.lookPitch = lerpN(-pitch * 0.7, atCamPitch, facingCam);
    const height = b.dna.shape.height;
    c.place(w.feet.x, w.groundY, w.feet.z, this.facing, height);
    const motion: Motion = { speed, heading: wrap(Math.atan2(v.x, v.z) - this.facing), turn, grounded: w.onGround, lookYaw: this.lookYaw, lookPitch: this.lookPitch, feet: this.feetOn(c, w.groundY) };
    b.animator!.update(dt, motion);
    // fade as the camera comes close; not drawn from its own eyes, or while a screen is in use
    const head = new Vector3(w.feet.x, w.groundY + height * 0.85, w.feet.z);
    const d = Vector3.Distance(this.fly.camera.position, head);
    const fade = this.fly.firstPerson || focus ? 0 : smoothstepN(0.4, 0.85, d);
    c.setFade(fade);
    c.root.setEnabled(fade > 0.01);
    this.dress(b, ME.id, d, quality, w.feet.x, w.groundY, w.feet.z, fade);
    this.say(true, { x: w.feet.x, y: w.groundY, z: w.feet.z, vx: v.x, vz: v.z, ground: w.onGround });
  }

  /** Lights, fur shells and shadow for a body where it stands, `d` from the camera. */
  private dress(b: Body, who: string, d: number, quality: Quality, x: number, y: number, z: number, fade: number) {
    const c = b.chimp!;
    // what it holds, before it is lit: a new model in hand is lit with the chimp from the frame it shows
    const hand = this.hands.get(who) ?? null;
    if (c.holding !== (hand?.key ?? null)) {
      c.hold(hand?.key ?? null, hand?.build());
      c.setFade(fade);
    }
    // lit by the lights of the room it stands in, as the house is
    const at = new Vector3(x, y + 0.8, z);
    // out in the front courtyard, by its lamps (it isn't one of the house's rooms)
    const r = roomAt(at)?.id ?? (inCourtyard(at) ? "courtyard" : null);
    const lv = (levelAt(at.y) ?? null) as Level | null;
    if (c.version !== b.litVersion) {
      b.litVersion = c.version;
      b.lights.light(c.meshes);
    }
    b.room = r;
    b.lights.follow(at, r, lv, fade < 0.01);
    const most = SHELLS[quality];
    c.setShells(d < 4 ? most : d < 9 ? Math.ceil(most * 0.6) : d < 22 ? Math.ceil(most * 0.3) : 0);
    b.shadow.setEnabled(fade > 0.3);
    b.shadow.position.set(x, y + 0.012, z);
    b.shadow.scaling.setAll(b.dna.shape.height / 1.5);
  }

  /** Tell the room where this visitor's chimp is: often while it moves, now and then while it stands. */
  private say(walking: boolean, at?: { x: number; y: number; z: number; vx: number; vz: number; ground: boolean }) {
    const now = room.now();
    const last = this.lastSaid;
    const moving = !!at && Math.hypot(at.vx, at.vz) > 0.05;
    const changed = !last || last.walking !== walking || Math.abs(wrap(last.yaw - this.facing)) > 0.05 || Math.abs(last.lookYaw - this.lookYaw) > 0.1;
    const every = moving ? SAY_MOVING : SAY_STILL;
    if (!changed && now - this.saidAt < every) return;
    if (!walking && last && !last.walking && now - this.saidAt < SAY_STILL) return;
    const p: Presence = {
      walking,
      x: round3(at?.x ?? last?.x ?? 0),
      y: round3(at?.y ?? last?.y ?? 0),
      z: round3(at?.z ?? last?.z ?? 0),
      yaw: round3(this.facing),
      vx: round3(at?.vx ?? 0),
      vz: round3(at?.vz ?? 0),
      ground: at?.ground ?? true,
      lookYaw: round3(this.lookYaw),
      lookPitch: round3(this.lookPitch),
      t: Math.round(now),
    };
    this.saidAt = now;
    this.lastSaid = p;
    this.sayPose(p);
  }

  // ---------------------------------------------------------------- other visitors

  private remote(id: string): Remote {
    let r = this.others.get(id);
    if (!r) {
      const label = document.createElement("div");
      label.className = "chimp-label";
      this.labels.appendChild(label);
      r = { body: null, name: "", dna: null, said: [], label, facing: 0 };
      this.others.set(id, r);
    }
    return r;
  }

  private heardDna(id: string, i: Identity) {
    if (id === ME.id || !i) return;
    const r = this.remote(id);
    r.name = String(i.name ?? "").slice(0, 24);
    r.label.textContent = r.name;
    r.dna = sanitize(i.dna, knownItem);
    if (r.body) r.body.setDna(r.dna);
    else r.body = new Body(this.scene, r.dna, `Chimp of ${r.name}`, this.lighting.chimpLights(), () => undefined);
  }

  private heardPose(id: string, p: Presence) {
    if (id === ME.id || !p) return;
    const r = this.remote(id);
    r.said.push(p);
    r.said.sort((a, b) => a.t - b.t);
    if (r.said.length > 12) r.said.splice(0, r.said.length - 12);
  }

  private forget(id: string) {
    const r = this.others.get(id);
    if (!r) return;
    r.body?.dispose();
    r.label.remove();
    this.others.delete(id);
  }

  private updateOther(id: string, r: Remote, now: number, dt: number, quality: Quality) {
    const b = r.body;
    const c = b?.chimp;
    const at = sample(r.said, now - BEHIND);
    if (!b || !c || !at || !at.walking) {
      if (c) c.root.setEnabled(false);
      b?.shadow.setEnabled(false);
      r.label.style.display = "none";
      return;
    }
    c.place(at.x, at.y, at.z, at.yaw, b.dna.shape.height);
    const pos = c.root.position;
    // outside the view: not drawn, and moved on without being posed
    this.sphere.reConstruct(pos.add(new Vector3(0, -0.2, 0)), pos.add(new Vector3(0, b.dna.shape.height + 0.2, 0)));
    const seen = this.sphere.isInFrustum(this.frustum);
    c.root.setEnabled(seen);
    b.shadow.setEnabled(seen);
    const d = Vector3.Distance(this.fly.camera.position, pos);
    if (!seen) {
      r.label.style.display = "none";
      return;
    }
    const speed = Math.hypot(at.vx, at.vz);
    const turn = wrap(at.yaw - r.facing) / Math.max(dt, 1e-3);
    r.facing = at.yaw;
    b.animator!.update(dt, { speed, heading: wrap(Math.atan2(at.vx, at.vz) - at.yaw), turn, grounded: at.ground, lookYaw: at.lookYaw, lookPitch: at.lookPitch, feet: this.feetOn(c, at.y) });
    c.setFade(1);
    this.dress(b, id, d, quality, at.x, at.y, at.z, 1);
    // the name over its head, in front of the camera and not too far off
    const head = new Vector3(at.x, at.y + b.dna.shape.height + 0.22, at.z);
    const ahead = Vector3.TransformCoordinates(head, this.fly.camera.getViewMatrix()).z > this.fly.camera.minZ;
    const show = ahead && d < 16;
    r.label.style.display = show ? "block" : "none";
    if (show) {
      const [pt] = toPage([head], this.scene, this.scene.getEngine().getRenderingCanvas()!);
      r.label.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -100%)`;
      r.label.style.opacity = String(Math.min(1, (16 - d) / 4));
    }
  }

  /**
   * The ground under each of a chimp's feet (where they were last drawn), above the ground its body
   * stands on: on stairs, one foot on the step above. From the walker's own collision grid.
   */
  private feetOn(c: Chimp, groundY: number): [number, number] {
    const world = this.fly.walker?.world;
    const out: [number, number] = [0, 0];
    if (!world) return out;
    ["leftFoot", "rightFoot"].forEach((n, i) => {
      const p = c.nodes[n].getAbsolutePosition();
      const probe = emptyProbe(this.probe);
      // no higher than a step (not onto a low table beside it), and not far down
      world.probe(p.x, p.z, groundY + 0.3, groundY - 0.4, probe);
      if (probe.walkY > -Infinity) out[i] = probe.walkY - groundY;
    });
    return out;
  }

  private cameraYaw(): number {
    const f = this.fly.aim;
    return Math.atan2(f.x, f.z);
  }

  private cameraPitch(): number {
    const p = this.fly.getPose();
    return p.pitch;
  }

  /** For tests and tools: this visitor's chimp, and the others'. */
  describe() {
    const c = this.mine.chimp;
    return {
      mine: c ? { shown: c.root.isEnabled(), at: c.root.position.asArray(), facing: this.facing, height: this.mine.dna.shape.height, lights: { room: this.mine.room, copied: this.mine.lights.describe() }, wearing: c.wearing(), holding: c.holding } : null,
      others: [...this.others].map(([id, r]) => ({ id, name: r.name, built: !!r.body?.chimp, shown: !!r.body?.chimp?.root.isEnabled(), heard: r.said.length, holding: r.body?.chimp?.holding ?? null })),
    };
  }
}

/**
 * Start building this visitor's chimp, and what it wears, at once: called as the page
 * starts, so the workers build it while the house builds, rather than after.
 */
export function prepareMyChimp(): void {
  const dna = loadDna();
  void chimpModel(dna);
  for (const w of Object.values(dna.outfit)) if (w) void itemModel(dna, w.id);
}

/** This visitor's DNA from their last visit, or the default chimp. */
function loadDna(): ChimpDna {
  try {
    const raw = localStorage.getItem(DNA_KEY);
    if (raw) return sanitize(JSON.parse(raw), knownItem);
  } catch {
    /* none kept, or unreadable */
  }
  return defaultDna();
}

/** Where a remote chimp was at time t: between the two words either side of it, or the last word, a little ahead. */
function sample(said: Presence[], t: number): Presence | null {
  if (!said.length) return null;
  let i = said.length - 1;
  while (i > 0 && said[i - 1].t > t) i--;
  const b = said[i];
  const a = said[Math.max(0, i - 1)];
  if (t >= b.t || a === b) {
    // past the last word: carry on a little at its speed, then wait
    const ahead = Math.min(0.25, Math.max(0, (t - b.t) / 1000));
    return { ...b, x: b.x + b.vx * ahead, z: b.z + b.vz * ahead };
  }
  const k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1, b.t - a.t)));
  return {
    walking: b.walking,
    x: lerpN(a.x, b.x, k),
    y: lerpN(a.y, b.y, k),
    z: lerpN(a.z, b.z, k),
    yaw: a.yaw + wrap(b.yaw - a.yaw) * k,
    vx: lerpN(a.vx, b.vx, k),
    vz: lerpN(a.vz, b.vz, k),
    ground: b.ground,
    lookYaw: lerpN(a.lookYaw, b.lookYaw, k),
    lookPitch: lerpN(a.lookPitch, b.lookPitch, k),
    t,
  };
}

/** A soft, round shadow under a chimp's feet: grounds it where the house's sun shadows can't (they are drawn once). */
function contactShadow(scene: Scene, name: string): Mesh {
  let mat = scene.getMaterialByName("chimpShadow") as StandardMaterial | null;
  if (!mat) {
    const tex = new DynamicTexture("chimpShadow", { width: 128, height: 128 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.45, "rgba(0,0,0,0.32)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    tex.update();
    tex.hasAlpha = true;
    mat = new StandardMaterial("chimpShadow", scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.Black();
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.disableDepthWrite = true;
  }
  const disc = MeshBuilder.CreateGround(`${name} shadow`, { width: 0.95, height: 0.95 }, scene);
  disc.material = mat;
  disc.isPickable = false;
  disc.renderingGroupId = 1;
  disc.setEnabled(false);
  return disc;
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Turn an angle toward another by at most `step`, the short way round. */
function turnToward(from: number, to: number, step: number): number {
  const d = wrap(to - from);
  return from + Math.max(-step, Math.min(step, d)) * Math.min(1, 0.35 + Math.abs(d));
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstepN(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
