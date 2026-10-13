// The Game Room's snack machine, CHIMP CHOMP (world/props/snackMachine.ts), working: choose a
// snack by its code on the keypad, and its coil turns one turn, pushing the front snack off its
// tray to tip over and fall down behind the glass into the bin while the others move up a place.
// Push the flap to take it, and it's in your hand; eat it, a bite at a time, and it's gone.
//
// The keys are used by pointing at them, as the lift's buttons are: the one under the cursor (or
// the crosshair) within reach lights up and is named in the prompt, and E or a click presses it.
// Walking up and pressing E (with no key pointed at) steps up to the machine instead: the camera
// settles in front of it and the mouse is free, to click the keys or type a code (A–E, then 1–6)
// and click the flap. Esc or Leave walks on.
//
// The machine, its coils, keys, display, bin and flap are found by role and slot (world/roles.ts),
// never by how the room builds them. The coils and the packs are thin instances, a mesh for the
// coils and one per brand, so moving a snack is a matrix. What the machine holds and every vend is
// one state shared through the room (engine/room.ts, engine/snackState.ts): a vend is a start
// time, and every visitor works out the same turn and the same fall from it. The snack in your
// hand and eating it are your own.

import { Color3, DynamicTexture, Matrix, Mesh, PBRMaterial, Quaternion, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { MeshMeta, SlotMeta } from "../world/context";
import { Geo, box, plane } from "../world/geometry/geo";
import { Materials } from "../world/materials/library";
import { COIL_CAPACITY, PACK_SIZE, SNACK, SNACK_BRANDS, SnackStockMeshes, buildSnackStock, coilCode, packGeo, packMat, paintDisplay, snackBrand } from "../world/props/snackMachine";
import { ROLE, find, findAll } from "../world/roles";
import { FlyCamera, Pose } from "./flyCamera";
import { ScreenFocus } from "./focus";
import { room } from "./room";
import { SnackSound } from "./snackSound";
import { BIN_LIMIT, COILS, FallPath, PLANOGRAM, SNACK_TIMING, Shaft, SnackState, Vend, coilTurn, fallAt, fallEnds, fallPath, initialSnacks, refusal, restock, take, vend } from "./snackState";
import { VIEWER, store } from "./store";

/** How far from the eye (m) a key or the flap can be used with E, and with a click. */
const REACH = 1.7;
const CLICK_REACH = 2.1;
/** How near the line of sight must pass a key's middle (m) for it to be the one pointed at. */
const AIM_KEY = 0.024;
/** How far in front of the machine (m) a visitor can step up to it with E. */
const NEAR = 1.3;
const GLIDE_IN = 0.8;
const GLIDE_OUT = 0.7;
/** The snack in the hand, in the camera's frame: low and to the right, its front to the eye. */
const HAND = { pos: new Vector3(0.17, -0.12, 0.5), rot: Quaternion.RotationYawPitchRoll(-0.3, 0.1, 0.1) };
/** At the mouth: just under the eye, its top tipped toward it. */
const MOUTH = { pos: new Vector3(0, -0.1, 0.24), rot: Quaternion.RotationYawPitchRoll(0, -0.7, 0) };
const TAKE_MS = 450;
/** Eating: to the mouth, the pack torn open, then a bite at each of these times (ms), and gone after the last. */
const RIP = 480;
const BITES = [700, 1300, 1900, 2500];
const EAT_MS = 2700;
const CRUMBS = 64;

const LETTERS = ["A", "B", "C", "D", "E"];
const DIGITS = ["1", "2", "3", "4", "5", "6"];

/** A small, steady wobble per pack so a coil's snacks don't stand like soldiers. */
function jitter(code: string, k: number): { yaw: number; lean: number } {
  let h = k * 2654435761;
  for (const ch of code) h = Math.imul(h ^ ch.charCodeAt(0), 2246822519);
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((h >>> 10) % 1000) / 1000;
  return { yaw: (a - 0.5) * 0.12, lean: 0.03 + b * 0.07 };
}

const titleCase = (name: string) => name.replace("\n", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

interface Key {
  label: string;
  /** where it is in the machine's frame */
  local: Vector3;
}

/** The snack in this visitor's hand: being taken out, held, or eaten. */
interface Held {
  vend: Vend;
  mesh: Mesh;
  phase: "taking" | "held" | "eating";
  since: number;
  /** where it started from, in the camera's frame, while being taken or brought to the mouth */
  from: { pos: Vector3; rot: Quaternion };
  ripped: boolean;
  bites: number;
}

interface Crumb {
  p: Vector3;
  v: Vector3;
  life: number;
}

export class SnackMachine {
  private machine: TransformNode;
  /** the machine's frame, and back */
  private world: Matrix;
  private inv: Matrix;
  /** each coil's frame in the machine's, by code, and the shaft its snacks fall down */
  private coilAt = new Map<string, Matrix>();
  private shafts = new Map<string, Shaft>();
  private stock: SnackStockMeshes;
  /** each brand's pack matrices, sized for every pack it could have showing */
  private buffers = new Map<string, Float32Array>();
  private coilBuf: Float32Array;
  private keys: Key[] = [];
  private display: Mesh;
  private displayTex: DynamicTexture;
  private shown = "";
  private flap: Mesh;
  private hinge: TransformNode;
  private glowKey: Mesh;
  private state: SnackState = initialSnacks(COIL_CAPACITY);
  private publish: (s: SnackState) => void;
  /** the paths of the vends in the state, worked out once each (by vendKey) */
  private paths = new Map<string, FallPath>();
  /** this visitor's code so far, and a message on the display until a time */
  private entry = "";
  private entryAt = 0;
  private message: { big: string; small: string; until: number } | null = null;
  /** what the visitor points at: a key (its index), or the flap */
  private target: { key: number } | { flap: true } | null = null;
  private pressed: { key: number; at: number } | null = null;
  private flapAt = -1e9;
  private held: Held | null = null;
  private crumbs: Crumb[] = [];
  private crumbMesh: Mesh;
  private crumbBuf = new Float32Array(CRUMBS * 16);
  private sound = new SnackSound();
  /** the vends whose sounds have been played (by vendKey) */
  private heard = new Set<string>();
  /** the state last drawn, and whether something was moving then */
  private drawn: SnackState | null = null;
  private moving = false;
  private night: boolean | null = null;
  private nextRestockCheck = 0;
  /** the moment the stock is shown at, while held still for a screenshot (tests); otherwise now */
  private clock: number | null = null;
  /** how far into eating the snack in hand is held still (tests' screenshots); otherwise it runs on */
  private eatClock: number | null = null;
  private fovBefore = 1;
  private mouse: { x: number; y: number } | null = null;
  private tmp = { a: new Matrix(), b: new Matrix(), q: new Quaternion(), v: new Vector3(), s: new Vector3(1, 1, 1) };

  constructor(
    private scene: Scene,
    private mats: Materials,
    private fly: FlyCamera,
    private focus: ScreenFocus,
    private canvas: HTMLCanvasElement,
    /** shows a short message */
    private flash: (msg: string) => void,
  ) {
    const need = <T>(n: T | null, what: string): T => {
      if (!n) throw new Error(`The snack machine has no ${what}`);
      return n;
    };
    const machine = find(scene, ROLE.snackMachine, 1);
    if (!(machine instanceof TransformNode)) throw new Error("The house has no snack machine");
    this.machine = machine;
    this.world = machine.computeWorldMatrix(true).clone();
    this.inv = this.world.clone().invert();
    for (const n of findAll(scene, ROLE.snackCoil)) {
      if (!(n instanceof TransformNode)) continue;
      const code = coilCode((n.metadata as SlotMeta).slot);
      const m = n.computeWorldMatrix(true).multiply(this.inv);
      this.coilAt.set(code, m);
      // the shaft in the coil's frame: the tray's lip is 14 mm in front of the coil, the rest is the machine's
      const cy = m.m[13];
      const cz = m.m[14];
      const sh = SNACK.shaft;
      this.shafts.set(code, { r: SNACK.coilR, edge: -0.014, front: sh.front - cz, floor: SNACK.bin.floor - cy, binBack: sh.binBack - cz, binTop: sh.top - cy, pitch: SNACK.pitch });
    }
    for (const n of findAll(scene, ROLE.snackKey)) {
      if (!(n instanceof TransformNode)) continue;
      this.keys.push({ label: (n.metadata as SlotMeta).label, local: Vector3.TransformCoordinates(n.computeWorldMatrix(true).getTranslation(), this.inv) });
    }
    this.display = need(find(scene, ROLE.snackDisplay) as Mesh | null, "display");
    this.displayTex = (this.display.material as PBRMaterial).emissiveTexture as DynamicTexture;
    this.flap = need(find(scene, ROLE.snackFlap) as Mesh | null, "flap");
    this.hinge = this.flap.parent as TransformNode;

    this.stock = buildSnackStock(mats, machine, this.coilAt.size);
    this.coilBuf = new Float32Array(this.coilAt.size * 16);
    this.stock.coils.thinInstanceSetBuffer("matrix", this.coilBuf, 16, false);
    for (const brand of SNACK_BRANDS) {
      const coils = COILS.filter((c) => PLANOGRAM[c] === brand.id).length;
      const buf = new Float32Array((coils * COIL_CAPACITY + BIN_LIMIT + 1) * 16);
      this.buffers.set(brand.id, buf);
      this.stock.packs.get(brand.id)!.thinInstanceSetBuffer("matrix", buf, 16, false);
    }
    // the light on the key pointed at: a soft mint glow over its cap
    if (!mats.has("snackKeyGlow")) mats.unlit("snackKeyGlow", { color: "#6ff0bf", intensity: 1.4, alpha: 0.4 });
    this.glowKey = this.movingMesh("Snack machine key light", new Geo().add(plane(0.05, 0.042)), "snackKeyGlow", machine);
    this.glowKey.setEnabled(false);
    // crumbs, while eating: tiny bits falling from the mouth, in the camera's frame, drawn over the room
    if (!mats.has("snackCrumb")) mats.pbr("snackCrumb", { color: "#d9a35a", rough: 0.8 });
    this.crumbMesh = this.movingMesh("Snack crumbs", box(0.0028, 0.002, 0.0024), "snackCrumb", fly.camera);
    this.crumbMesh.renderingGroupId = 2;
    this.crumbMesh.thinInstanceSetBuffer("matrix", this.crumbBuf, 16, false);
    this.crumbMesh.thinInstanceCount = 0;
    this.crumbMesh.setEnabled(false);

    canvas.addEventListener("pointermove", (e) => (this.mouse = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointerleave", () => (this.mouse = null));
    // at the machine (its focus): a click presses a key or pushes the flap, and keys type the code
    canvas.addEventListener("pointerdown", (e) => {
      const f = store.get().focus;
      if (f?.kind !== "snack" || f.phase !== "on" || e.button !== 0) return;
      this.mouse = { x: e.clientX, y: e.clientY };
      this.aim();
      if (this.target) this.act();
    });
    window.addEventListener("keydown", (e) => this.key(e));
    this.publish = room.share("snackMachine", this.state, (s) => (this.state = s));
    this.update(0);
  }

  /** A mesh the engine builds and moves: never solid, never exported, not picked. */
  private movingMesh(name: string, g: Geo, matKey: string, parent: TransformNode | FlyCamera["camera"]): Mesh {
    const sm = this.machine.metadata as SlotMeta;
    const mesh = g.build(name, this.scene);
    mesh.parent = parent;
    mesh.material = this.mats.get(matKey);
    mesh.metadata = { room: sm.room, roomName: sm.roomName, level: sm.level, labels: [{ face: 0, label: name }], matKey, kind: "moving" } satisfies MeshMeta;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  }

  // ------------------------------------------------------------------ each frame

  /** Each frame: the coils and snacks where the state has them now, the display, the flap, the snack in hand, and what E would do. */
  update(dt: number): void {
    const now = room.now();
    const st = store.get();
    if (st.night !== this.night) {
      this.night = st.night;
      const glow = new Color3(1, 1, 1).scale(st.night ? 0.42 : 0.04);
      for (const mesh of this.stock.packs.values()) (mesh.material as PBRMaterial).emissiveColor = glow;
    }
    // restock what has been empty long enough (whoever is in the room does it; they all agree)
    if (now >= this.nextRestockCheck) {
      this.nextRestockCheck = now + 1000;
      const next = restock(this.state, now, COIL_CAPACITY);
      if (next !== this.state) this.publish(next);
    }
    // the sounds of vends as they start, wherever they were chosen
    const eye = this.fly.camera.globalPosition;
    this.sound.distance = Vector3.Distance(eye, Vector3.TransformCoordinates(this.tmp.v.set(0, 1.1, SNACK.front), this.world));
    for (const v of this.state.vends) if (!this.heard.has(vendKey(v))) this.hear(v, now);

    // the stock: drawn when the state changes, and every frame while anything moves
    const shownAt = this.clock ?? now;
    const moving = this.clock !== null || this.state.vends.some((v) => now - v.at < fallEnds(this.path(v)) + 100) || this.held?.phase === "taking";
    if (moving || this.moving || this.drawn !== this.state) {
      this.drawStock(shownAt);
      this.drawn = this.state;
      this.moving = moving;
    }
    this.drawDisplay(now);
    this.drawFlap(now);
    this.drawHeld(now, dt);

    // what the visitor points at, and what E would do
    const f = st.focus;
    if (f?.kind === "snack" ? f.phase === "on" : !f && st.walking && this.fly.enabled && !!this.fly.walker && this.near()) this.aim();
    else this.target = null;
    const flashing = this.pressed && now - this.pressed.at < 160 ? this.pressed.key : null;
    const lit = flashing ?? (this.target && "key" in this.target ? this.target.key : null);
    if (lit === null) {
      if (this.glowKey.isEnabled()) this.glowKey.setEnabled(false);
    } else {
      this.glowKey.setEnabled(true);
      this.glowKey.position.copyFrom(this.keys[lit].local).addInPlaceFromFloats(0, 0, -0.0015);
      this.glowKey.scaling.setAll(flashing !== null ? 1.18 : 1);
    }
    if (f?.kind === "snack") this.canvas.style.cursor = this.target ? "pointer" : "";
    this.prompt();
  }

  /** A vend's fall, worked out the first time it's asked for. */
  private path(v: Vend): FallPath {
    const key = vendKey(v);
    let p = this.paths.get(key);
    if (!p) {
      p = fallPath(PACK_SIZE[snackBrand(v.brand).kind], this.shafts.get(v.coil)!, v.stack);
      this.paths.set(key, p);
      // forget the paths of vends long gone
      if (this.paths.size > 32) for (const k of [...this.paths.keys()].slice(0, 16)) this.paths.delete(k);
    }
    return p;
  }

  /** Whether a vend's snack lies in the bin. */
  private landed = (v: Vend, now: number): boolean => now - v.at >= fallEnds(this.path(v));

  /** Play a vend's sounds: the motor from now, its knocks as they come; a vend long over is silent. */
  private hear(v: Vend, now: number): void {
    this.heard.add(vendKey(v));
    const since = now - v.at;
    if (since > fallEnds(this.path(v))) return;
    if (since < SNACK_TIMING.turn) this.sound.motorRun((SNACK_TIMING.turn - since) / 1000);
    for (const h of this.path(v).hits) if (h.at > since) this.sound.hit(h.what, h.speed, (h.at - since) / 1000);
  }

  /** Every coil turned and every pack placed, as the state has them at `now`. */
  private drawStock(now: number): void {
    const t = this.tmp;
    const counts = new Map<string, number>();
    const turningCoil = new Map<string, Vend>();
    for (const v of this.state.vends) if (now - v.at < SNACK_TIMING.turn) turningCoil.set(v.coil, v);
    // the coils, each turned as far as its vend has got
    let i = 0;
    for (const [code, m] of this.coilAt) {
      const v = turningCoil.get(code);
      Matrix.RotationZToRef(v ? coilTurn(v, now) * Math.PI * 2 : 0, t.a);
      t.a.multiplyToRef(m, t.b);
      t.b.copyToArray(this.coilBuf, i * 16);
      i++;
    }
    this.stock.coils.thinInstanceBufferUpdated("matrix");
    const put = (brand: string, code: string, z: number, y: number, tip: number, k: number) => {
      const buf = this.buffers.get(brand)!;
      const n = counts.get(brand) ?? 0;
      if ((n + 1) * 16 > buf.length) return;
      const j = jitter(code, k);
      // the wobble fades as it tips: a pack in the air is wherever its fall puts it
      Quaternion.RotationYawPitchRollToRef(j.yaw, j.lean * Math.max(0, 1 - Math.abs(tip) * 4) - tip, 0, t.q);
      t.v.set(0, y, z);
      Matrix.ComposeToRef(t.s, t.q, t.v, t.a);
      t.a.multiplyToRef(this.coilAt.get(code)!, t.b);
      t.b.copyToArray(buf, n * 16);
      counts.set(brand, n + 1);
    };
    // the packs on each coil, one per turn from the front; a turning coil's move up a place as it turns
    for (const code of COILS) {
      const brand = PLANOGRAM[code];
      const { h } = PACK_SIZE[snackBrand(brand).kind];
      const v = turningCoil.get(code);
      const s = v ? coilTurn(v, now) : 1;
      for (let k = 0; k < this.state.stock[code]; k++) put(brand, code, SNACK.pitch * (k + 0.5 + (1 - s)), -SNACK.coilR + h / 2 + 0.001, 0, k + 1);
    }
    // and the ones on their way out, or lying in the bin (not one being taken out: that's drawn in the hand)
    for (const v of this.state.vends) {
      const f = fallAt(this.path(v), PACK_SIZE[snackBrand(v.brand).kind], this.shafts.get(v.coil)!, now - v.at);
      put(v.brand, v.coil, f.z, f.y, f.tip, 0);
    }
    for (const [id, mesh] of this.stock.packs) {
      const n = counts.get(id) ?? 0;
      mesh.thinInstanceCount = n;
      mesh.thinInstanceBufferUpdated("matrix");
      mesh.setEnabled(n > 0);
    }
  }

  /** What the display says now: a message, the code being typed, the vend under way, or a greeting. */
  private text(now: number): [string, string] {
    if (this.message && now < this.message.until) return [this.message.big, this.message.small];
    if (this.entry && now - this.entryAt < SNACK_TIMING.entry) return [`${this.entry}_`, "NOW A NUMBER, 1–6"];
    this.entry = "";
    const turningVend = this.state.vends.find((v) => now - v.at < SNACK_TIMING.turn);
    if (turningVend) return [`${turningVend.coil} · VENDING`, snackBrand(turningVend.brand).name.replace("\n", " ")];
    if (this.state.vends.some((v) => !this.landed(v, now))) return ["HERE IT COMES!", "WATCH IT DROP"];
    if (this.state.vends.length) return ["ENJOY!", "PUSH THE FLAP TO TAKE IT"];
    return ["CHOOSE A SNACK", "TYPE A CODE, LIKE B3"];
  }

  private drawDisplay(now: number): void {
    const [big, small] = this.text(now);
    const key = `${big}|${small}`;
    if (key === this.shown) return;
    this.shown = key;
    paintDisplay(this.displayTex.getContext() as unknown as CanvasRenderingContext2D, big, small);
    this.displayTex.update(true);
  }

  /** The flap: shut, or swung in as a snack is taken, then falling shut with a little bounce. */
  private drawFlap(now: number): void {
    const t = now - this.flapAt;
    let a = 0;
    if (t < 150) a = t / 150;
    else if (t < 450) a = 1;
    else if (t < 800) {
      const x = (t - 450) / 350;
      a = Math.cos(x * Math.PI * 0.5);
    } else if (t < 1000) a = Math.sin(((t - 800) / 200) * Math.PI) * 0.06;
    const rot = -1.15 * a;
    if (this.hinge.rotation.x !== rot) this.hinge.rotation.x = rot;
  }

  // ------------------------------------------------------------------ pointing and pressing

  /** Whether the camera is near enough the machine for its keys and flap to be pointed at. */
  private near(): boolean {
    return this.sound.distance < REACH + 0.8;
  }

  /** The key or flap pointed at, through the cursor (or the crosshair while the mouse is captured), within reach. */
  private aim(): void {
    const engine = this.scene.getEngine();
    let px = engine.getRenderWidth() / 2;
    let py = engine.getRenderHeight() / 2;
    const focused = store.get().focus?.kind === "snack";
    // the cursor, or the middle of the view while the mouse is captured or off the canvas
    if (document.pointerLockElement !== this.canvas && this.mouse) {
      const box = this.canvas.getBoundingClientRect();
      px = ((this.mouse.x - box.left) / box.width) * engine.getRenderWidth();
      py = ((this.mouse.y - box.top) / box.height) * engine.getRenderHeight();
    }
    const ray = this.scene.createPickingRay(px, py, Matrix.Identity(), this.fly.camera);
    const reach = focused ? 4 : REACH;
    let best = -1;
    let bestMiss = AIM_KEY;
    const p = this.tmp.v;
    this.keys.forEach((k, i) => {
      Vector3.TransformCoordinatesToRef(k.local, this.world, p);
      const v = p.subtract(ray.origin);
      const along = Vector3.Dot(v, ray.direction);
      if (along <= 0 || v.length() > reach) return;
      const miss = v.subtract(ray.direction.scale(along)).length();
      if (miss < bestMiss) {
        best = i;
        bestMiss = miss;
      }
    });
    if (best >= 0) {
      this.target = { key: best };
      return;
    }
    const hit = ray.intersectsMesh(this.flap);
    this.target = hit.hit && hit.distance <= reach + 0.3 ? { flap: true } : null;
  }

  /** E (or a click at the machine): press the key pointed at, push the flap, eat, or step up to the machine. */
  act(): void {
    const p = store.get().snackPrompt;
    if (this.target && "key" in this.target) this.press(this.keys[this.target.key].label);
    else if (this.target && "flap" in this.target) this.takeSnack();
    else if (p?.action === "eat") this.eat();
    else if (p?.action === "use") void this.use();
  }

  /** A canvas click in walk mode on a key or the flap within reach uses it. */
  click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().focus || !this.near()) return false;
    if (document.pointerLockElement !== this.canvas) this.mouse = { x: e.clientX, y: e.clientY };
    this.aim();
    if (!this.target) return false;
    const at = "key" in this.target ? Vector3.TransformCoordinates(this.keys[this.target.key].local, this.world) : this.flap.getBoundingInfo().boundingBox.centerWorld;
    if (Vector3.Distance(at, this.fly.camera.globalPosition) > CLICK_REACH) return false;
    this.act();
    return true;
  }

  /** At the machine, keys type: a letter, then a number; Backspace clears, Enter takes the snack, Esc walks on. */
  private key(e: KeyboardEvent): void {
    const f = store.get().focus;
    if (f?.kind !== "snack" || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toUpperCase();
    if (e.key === "Escape") void this.leave();
    else if (f.phase !== "on") return;
    else if (LETTERS.includes(k) || DIGITS.includes(k)) this.press(k);
    else if (e.key === "Backspace" || e.key === "Delete") this.press("CLR");
    else if (e.key === "Enter" || e.key === " ") this.takeSnack();
    else return;
    e.preventDefault();
  }

  /** A key on the keypad pressed: a letter starts a code, a number finishes it and sells that snack. */
  press(label: string): void {
    this.sound.unlock();
    const now = room.now();
    const i = this.keys.findIndex((k) => k.label === label);
    if (i >= 0) this.pressed = { key: i, at: now };
    this.message = null;
    if (label === "CLR") {
      this.entry = "";
      this.sound.beep();
      return;
    }
    if (LETTERS.includes(label)) {
      this.entry = label;
      this.entryAt = now;
      this.sound.beep();
      return;
    }
    if (!this.entry) {
      this.say("LETTER FIRST", "A–E, THEN 1–6", now);
      this.sound.beep(false);
      return;
    }
    const code = this.entry + label;
    this.entry = "";
    const why = refusal(this.state, code, now);
    if (why) {
      const back = this.state.restock[code];
      const small = why === "SOLD OUT" ? (back ? `BACK IN ${Math.max(1, Math.ceil((back - now) / 1000))} S` : "TRY ANOTHER") : why === "NO SUCH SNACK" ? "A1–C5, D1–E6" : "";
      this.say(why === "NO SUCH SNACK" || why === "SOLD OUT" ? `${code} ${why}` : why, small, now);
      this.sound.beep(false);
      return;
    }
    this.sound.beep();
    this.publish(vend(this.state, code, VIEWER, now, (coil, inBin) => this.stackUnder(coil, inBin)));
  }

  /** Type a whole code: its letter, then its number. */
  choose(code: string): void {
    this.press(code[0].toUpperCase());
    this.press(code.slice(1));
  }

  /** How high a snack from `coil` lands in the bin: on the packs already lying under where it falls. */
  private stackUnder(coil: string, inBin: Vend[]): number {
    const x = this.coilAt.get(coil)!.m[12];
    const w = PACK_SIZE[snackBrand(PLANOGRAM[coil]).kind].w;
    let h = 0;
    for (const v of inBin) {
      const s = PACK_SIZE[snackBrand(v.brand).kind];
      if (Math.abs(this.coilAt.get(v.coil)!.m[12] - x) < (w + s.w) / 2) h += s.d * 0.8;
    }
    return h;
  }

  private say(big: string, small: string, now: number): void {
    this.message = { big, small, until: now + 2600 };
  }

  // ------------------------------------------------------------------ taking and eating

  /** Push the flap and take the snack that has lain in the bin longest: it comes out into your hand. */
  takeSnack(): boolean {
    this.sound.unlock();
    const now = room.now();
    this.flapAt = now;
    this.sound.flap();
    if (this.held) {
      this.flash("One snack at a time: eat the one you have first");
      return false;
    }
    const v = this.state.vends.find((x) => this.landed(x, now));
    if (!v) return false;
    const next = take(this.state, v.id, now, this.landed);
    if (next === this.state) return false;
    // where it lay, in the camera's frame, to come out from
    const shape = PACK_SIZE[snackBrand(v.brand).kind];
    const f = fallAt(this.path(v), shape, this.shafts.get(v.coil)!, now - v.at);
    const lay = Matrix.Compose(Vector3.One(), Quaternion.RotationYawPitchRoll(0, -f.tip, 0), new Vector3(0, f.y, f.z)).multiply(this.coilAt.get(v.coil)!).multiply(this.world);
    const from = { pos: new Vector3(), rot: new Quaternion() };
    lay.multiply(this.fly.camera.getWorldMatrix().clone().invert()).decompose(undefined, from.rot, from.pos);
    const brand = snackBrand(v.brand);
    // in the hand: its own mesh on the camera, drawn over the room so it never sinks into a wall
    const mesh = this.movingMesh(`Snack in hand: ${titleCase(brand.name)}`, packGeo(brand.kind), packMat(this.mats, brand, false), this.fly.camera);
    mesh.renderingGroupId = 2;
    mesh.rotationQuaternion = from.rot.clone();
    mesh.position.copyFrom(from.pos);
    this.held = { vend: v, mesh, phase: "taking", since: now, from, ripped: false, bites: 0 };
    this.publish(next);
    store.set({ snackHeld: titleCase(brand.name) });
    if (store.get().focus?.kind === "snack") void this.leave();
    return true;
  }

  /** Eat the snack in your hand: it comes to your mouth and goes in bites, crumbs falling, until it's gone. */
  eat(): boolean {
    this.sound.unlock();
    const h = this.held;
    if (!h || h.phase !== "held") return false;
    h.phase = "eating";
    h.since = room.now();
    h.from = { pos: h.mesh.position.clone(), rot: h.mesh.rotationQuaternion!.clone() };
    (this.mats.get("snackCrumb") as PBRMaterial).albedoColor = Color3.FromHexString(crumbColour(h.vend.brand));
    store.set({ snackPrompt: null });
    return true;
  }

  /** The snack in hand: coming out of the bin, held, or being eaten; and the crumbs. */
  private drawHeld(now: number, dt: number): void {
    const h = this.held;
    if (h) {
      const m = h.mesh;
      // hidden while another screen is in use: it would sit in front of the game or the film
      const f = store.get().focus;
      m.setEnabled(!f || f.kind === "snack");
      const t = h.phase === "eating" && this.eatClock !== null ? this.eatClock : now - h.since;
      const ease = (x: number) => x * x * (3 - 2 * x);
      if (h.phase === "taking") {
        const k = ease(Math.min(1, t / TAKE_MS));
        Vector3.LerpToRef(h.from.pos, HAND.pos, k, m.position);
        // an arc up out of the bin
        m.position.y += Math.sin(k * Math.PI) * 0.06;
        Quaternion.SlerpToRef(h.from.rot, HAND.rot, k, m.rotationQuaternion!);
        if (t >= TAKE_MS) {
          h.phase = "held";
          h.since = now;
        }
      } else if (h.phase === "held") {
        // a gentle bob, as if held
        m.position.copyFrom(HAND.pos).addInPlaceFromFloats(0, Math.sin(t / 600) * 0.004, 0);
        m.rotationQuaternion!.copyFrom(HAND.rot);
      } else {
        const k = ease(Math.min(1, t / 450));
        Vector3.LerpToRef(h.from.pos, MOUTH.pos, k, m.position);
        Quaternion.SlerpToRef(h.from.rot, MOUTH.rot, k, m.rotationQuaternion!);
        if (!h.ripped && t >= RIP) {
          h.ripped = true;
          this.sound.rip();
        }
        // each bite: a lunge to the mouth, a crunch and crumbs, the pack a quarter shorter from the top
        while (h.bites < BITES.length && t >= BITES[h.bites]) {
          h.bites++;
          this.sound.crunch();
          this.spill(h.bites);
        }
        const left = 1 - h.bites / BITES.length;
        let lunge = 0;
        for (const b of BITES) lunge += Math.max(0, 1 - Math.abs(t - b + 60) / 90);
        const ph = PACK_SIZE[snackBrand(h.vend.brand).kind].h;
        m.scaling.set(left > 0 ? 1 - 0.1 * (1 - left) : 0, left, 1);
        // the bottom stays where the hand holds it; the top is bitten away
        const down = this.tmp.v.set(0, -(ph * (1 - left)) / 2, 0);
        down.rotateByQuaternionToRef(m.rotationQuaternion!, down);
        m.position.addInPlace(down).addInPlaceFromFloats(0, lunge * 0.015, -lunge * 0.04);
        if (t >= EAT_MS) {
          const name = snackBrand(h.vend.brand).name;
          m.dispose();
          this.held = null;
          store.set({ snackHeld: null });
          this.flash(`Mmm, ${titleCase(name)}!`);
        }
      }
    }
    this.drawCrumbs(dt);
  }

  /** A bite's crumbs, from the top of what's left. */
  private spill(bite: number): void {
    for (let i = 0; i < 14 && this.crumbs.length < CRUMBS; i++) {
      const r = (k: number) => Math.sin(bite * 91.7 + i * 13.3 + k * 7.1) * 0.5 + 0.5;
      this.crumbs.push({ p: MOUTH.pos.add(new Vector3((r(1) - 0.5) * 0.04, 0.03, (r(2) - 0.5) * 0.02)), v: new Vector3((r(3) - 0.5) * 0.18, r(4) * 0.12, 0.02 + r(5) * 0.08), life: 0.6 + r(6) * 0.35 });
    }
  }

  private drawCrumbs(dt: number): void {
    if (!this.crumbs.length) {
      if (this.crumbMesh.isEnabled()) this.crumbMesh.setEnabled(false);
      return;
    }
    this.crumbMesh.setEnabled(true);
    const t = this.tmp;
    let n = 0;
    for (const c of this.crumbs) {
      c.life -= dt;
      c.v.y -= 3.5 * dt;
      c.p.addInPlaceFromFloats(c.v.x * dt, c.v.y * dt, c.v.z * dt);
      if (c.life <= 0) continue;
      t.s.setAll(Math.min(1, c.life * 2));
      Quaternion.RotationYawPitchRollToRef(c.life * 9, c.life * 7, 0, t.q);
      Matrix.ComposeToRef(t.s, t.q, c.p, t.a);
      t.a.copyToArray(this.crumbBuf, n * 16);
      n++;
    }
    t.s.setAll(1);
    this.crumbs = this.crumbs.filter((c) => c.life > 0);
    this.crumbMesh.thinInstanceCount = n;
    this.crumbMesh.thinInstanceBufferUpdated("matrix");
  }

  // ------------------------------------------------------------------ at the machine

  /** Step up to the machine (walk mode): the camera settles in front of it, the mouse free for its keys and flap. */
  async use(): Promise<boolean> {
    if (store.get().focus || !this.fly.walker || !store.get().walking) return false;
    this.sound.unlock();
    this.fovBefore = this.fly.camera.fov;
    store.set({ snackPrompt: null });
    return this.focus.enter({ kind: "snack" }, this.display, () => this.pose(), GLIDE_IN);
  }

  /** Walk on from the machine: back to where a visitor stands in front of it. */
  async leave(): Promise<void> {
    const f = store.get().focus;
    if (f?.kind !== "snack" || f.phase === "out") return;
    const stand = Vector3.TransformCoordinates(Vector3.FromArray((this.machine.metadata as SlotMeta).stand), this.world);
    const look = Vector3.TransformCoordinates(new Vector3(0, 1.15, 0), this.world);
    const walker = this.fly.walker;
    let pose: Pose | null = null;
    if (walker && walker.place(stand.x, stand.y + 0.5, stand.z, 2)) {
      const p = walker.feet;
      const dx = look.x - p.x;
      const dz = look.z - p.z;
      pose = { x: p.x, y: walker.eyeY, z: p.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(look.y - walker.eyeY, Math.hypot(dx, dz)), fov: this.fovBefore };
    }
    this.target = null;
    this.canvas.style.cursor = "";
    await this.focus.leave(pose, GLIDE_OUT);
  }

  /** In front of the machine with the window, the keypad and the flap all in view. */
  private pose(): Pose {
    const engine = this.scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const fov = 0.8;
    // fit 1.5 m of height (the flap to the header) and the machine's width, with a margin
    const d = Math.max(0.9 / Math.tan(fov / 2), 0.62 / (Math.tan(fov / 2) * aspect));
    const eye = Vector3.TransformCoordinates(new Vector3(0, 1.12, SNACK.front - d), this.world);
    const at = Vector3.TransformCoordinates(new Vector3(0, 1.0, 0), this.world);
    const dx = at.x - eye.x;
    const dz = at.z - eye.z;
    return { x: eye.x, y: eye.y, z: eye.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(at.y - eye.y, Math.hypot(dx, dz)), fov };
  }

  /** What E would do here, for the prompt: press the key pointed at, take a snack, eat the one in hand, or step up to the machine. */
  private prompt(): void {
    const st = store.get();
    let next: { action: "key" | "take" | "eat" | "use"; label: string } | null = null;
    const now = room.now();
    if (st.walking && !st.focus && this.fly.enabled) {
      const others = st.arcadePrompt || st.remotePrompt || st.theatrePrompt || st.liftPrompt;
      if (this.target && "key" in this.target) next = { action: "key", label: `Press ${this.keys[this.target.key].label}` };
      else if (this.target && "flap" in this.target && !this.held && this.state.vends.some((v) => this.landed(v, now))) next = { action: "take", label: "Take your snack" };
      else if (this.held?.phase === "held" && !others) next = { action: "eat", label: `Eat the ${st.snackHeld ?? "snack"}` };
      else if (!this.held && this.atMachine()) next = { action: "use", label: "Use the snack machine" };
    }
    const cur = st.snackPrompt;
    if ((cur?.action ?? null) !== (next?.action ?? null) || cur?.label !== next?.label) store.set({ snackPrompt: next });
  }

  /** Whether the walker stands in front of the machine, near it and facing it. */
  private atMachine(): boolean {
    const w = this.fly.walker;
    if (!w) return false;
    const p = Vector3.TransformCoordinates(w.feet, this.inv);
    if (Math.abs(p.y) > 0.6 || p.z > SNACK.front || p.z < SNACK.front - NEAR || Math.abs(p.x) > 0.75) return false;
    const fwd = Vector3.TransformNormal(this.fly.camera.getDirection(Vector3.Forward()), this.inv);
    return fwd.z > 0.5;
  }

  // ------------------------------------------------------------------ for the page's checks

  /** The machine's base in the world, the way its front faces (unit, flat), and where a visitor stands to use it. */
  where(): { base: number[]; front: number[]; stand: number[] } {
    const f = Vector3.TransformNormal(new Vector3(0, 0, -1), this.world).normalize();
    return { base: this.world.getTranslation().asArray(), front: f.asArray(), stand: Vector3.TransformCoordinates(Vector3.FromArray((this.machine.metadata as SlotMeta).stand), this.world).asArray() };
  }

  /** The state and what shows: the display's lines, the code typed, each vend and its pack, the snack in hand. */
  describe() {
    const now = room.now();
    const [big, small] = this.text(now);
    return {
      stock: { ...this.state.stock },
      restock: { ...this.state.restock },
      display: [big, small],
      entry: this.entry,
      vends: this.state.vends.map((v) => {
        const f = fallAt(this.path(v), PACK_SIZE[snackBrand(v.brand).kind], this.shafts.get(v.coil)!, now - v.at);
        const at = Vector3.TransformCoordinates(new Vector3(0, f.y, f.z), this.coilAt.get(v.coil)!.multiply(this.world));
        return { id: v.id, coil: v.coil, brand: v.brand, by: v.by, since: now - v.at, landed: this.landed(v, now), turning: now - v.at < SNACK_TIMING.turn, fall: [f.z, f.y, f.tip], world: at.asArray(), ends: fallEnds(this.path(v)), hits: this.path(v).hits.map((h) => h.what) };
      }),
      held: this.held ? { brand: this.held.vend.brand, phase: this.held.phase, bites: this.held.bites, scale: this.held.mesh.isDisposed() ? 0 : this.held.mesh.scaling.y } : null,
      crumbs: this.crumbs.length,
      aimed: this.target ? ("key" in this.target ? this.keys[this.target.key].label : "flap") : null,
      flap: this.hinge.rotation.x,
    };
  }

  /** The packs standing on a coil now: each one's place along it (m from its front end). */
  coilPacks(code: string): number[] {
    const brand = PLANOGRAM[code];
    const buf = this.buffers.get(brand)!;
    const n = this.stock.packs.get(brand)!.thinInstanceCount;
    const inv = this.coilAt.get(code)!.clone().invert();
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = Vector3.TransformCoordinates(Vector3.FromArray(buf, i * 16 + 12), inv);
      if (Math.abs(p.x) < 0.02 && Math.abs(p.y) < 0.12 && p.z > -0.03 && p.z < SNACK.coilLen) out.push(Math.round(p.z * 1000) / 1000);
    }
    return out.sort((a, b) => a - b);
  }

  /** Show the stock as it was `ms` after the last vend started, held still there (tests' screenshots); null lets it run on. */
  pauseAt(ms: number | null): void {
    const last = this.state.vends[this.state.vends.length - 1];
    this.clock = ms === null || !last ? null : last.at + ms;
  }

  /** Hold eating still `ms` into it (tests' screenshots); null lets it run on from there. */
  holdEat(ms: number | null): void {
    if (ms === null && this.eatClock !== null && this.held) this.held.since = room.now() - this.eatClock;
    this.eatClock = ms;
  }

  /** The shaft a coil's snacks fall down, in its frame (tests). */
  shaftOf(code: string): Shaft | undefined {
    return this.shafts.get(code);
  }

  /** Where every key is in the world, by its label, and the flap. */
  places(): { keys: Record<string, number[]>; flap: number[] } {
    const keys: Record<string, number[]> = {};
    for (const k of this.keys) keys[k.label] = Vector3.TransformCoordinates(k.local, this.world).asArray();
    return { keys, flap: this.flap.getBoundingInfo().boundingBox.centerWorld.asArray() };
  }

  /** Change the shared state (tests): empty a coil, bring a restock forward, or start afresh. */
  setState(patch: Partial<SnackState> | "reset"): void {
    this.publish(patch === "reset" ? initialSnacks(COIL_CAPACITY) : { ...this.state, ...patch });
  }

  /** Put the snack in hand away (tests): as if eaten, at once. */
  drop(): void {
    this.held?.mesh.dispose();
    this.held = null;
    store.set({ snackHeld: null });
  }
}

/** A vend, told apart from any other: ids start again when the machine is reset. */
const vendKey = (v: Vend) => `${v.id}:${v.coil}:${v.at}`;

/** The colour of a snack's crumbs. */
function crumbColour(brand: string): string {
  const c: Record<string, string> = {
    jungleCrunch: "#f3d27a",
    canopyPuffs: "#ff9a3c",
    termiteTwigs: "#5a2e14",
    mangoMischief: "#ffb21f",
    silverback: "#e9c77a",
    vineSwingers: "#ff4fa3",
    knucklePops: "#fff3d0",
    bonoboBar: "#4a2410",
    apeEscape: "#c98a3c",
    nutCracker: "#b07a43",
    chocoChimps: "#6b3a1c",
  };
  return c[brand] ?? "#d9a35a";
}
