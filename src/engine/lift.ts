// The lift in the house: the car and its doors, the buttons that call it and ride it, its
// light and its sounds. All of it is shown from the lift's shared state (engine/liftState.ts,
// store.lift): the car is where that state puts it at the time, so everyone who looks sees
// the same car, and the sounds follow the same changes.
//
// The buttons are used by pointing at them: the one under the cursor (or the crosshair, while
// the mouse is captured) within reach is outlined and named in the prompt, and E or a click
// presses it.
//
// The car, doors, buttons and indicators are found by role and slot (world/roles.ts).
// The state is shared through the room (engine/room.ts): each visitor's page moves it on by
// the room's clock, which needs no messages, and passes on the changes its visitor makes (a
// button pressed, stepping into a doorway, coming to the lift or walking away), so everyone
// sees the same car and hears the same music. A visitor who leaves is let go of.

import { Color3, DynamicTexture, Matrix, Mesh, PBRMaterial, PointLight, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { FLOORS, Floor, Shown, paintIndicator } from "../world/structure/lift";
import { LEVEL, LIFT_CAR, LIFT_DOOR } from "../world/layout";
import { Materials } from "../world/materials/library";
import { LiftGlyph, buttonMat } from "../world/materials/lift";
import { ROLE, find } from "../world/roles";
import { FlyCamera } from "./flyCamera";
import { pickAt, pickPoint } from "./focus";
import { LiftSound } from "./liftSound";
import { LIFT_TIMING, LiftState, advanceLift, callLift, carHeight, carSpeed, doorPosAt, floorHeight, holdDoors, initialLift, musicAt, playMusic, setDoorway, setNearby, shutDoorsNow } from "./liftState";
import { room } from "./room";
import { VIEWER, store } from "./store";
import { AVATAR } from "./walker";

/** How far from the eye (m) a button can be pressed with E, and with a click. */
const REACH = 2.0;
const CLICK_REACH = 2.2;
/**
 * How near the line of sight must pass to a button (m) for it to be the one pointed at: the car's
 * buttons are close together, so they need a careful aim; a landing has only one, so near is enough.
 */
const AIM = { call: 0.2, car: 0.035 };
/** How near (m, vertically) the walker's feet must be to a landing's floor, or the car's, to use its buttons. */
const LEVEL_TOLERANCE = 0.8;
/** How far past the walker's body (m) the doorway sensor reaches: someone touching the doors is in the doorway. */
const SENSE_REACH = 0.08;
/** How long (ms) a door button stays lit after it is pressed. */
const FLASH = 400;
/** A visitor is at the lift (and keeps its music playing) within this far (m) of a landing's doors, and has walked away a little further off. */
const NEAR_LIFT = 4.5;
const LEFT_LIFT = 5.0;

/** The lift's buttons: a landing's call button, a car button for a floor, and the car's door buttons. */
export type ButtonId = "call1" | "call2" | "car1" | "car2" | "open" | "close";

interface Button {
  id: ButtonId;
  mesh: Mesh;
  glyph: LiftGlyph;
  /** where it is: on a landing (its floor), or in the car */
  at: Floor | "car";
}

const ease = (x: number) => x * x * (3 - 2 * x);

export class Lift {
  private car: TransformNode;
  private doors = new Map<Floor, { left: Mesh; right: Mesh }>();
  private carDoors: { left: Mesh; right: Mesh };
  private buttons: Button[] = [];
  private indicators: Mesh[] = [];
  private light: PointLight;
  /** each button's materials, unlit and lit */
  private lamps = new Map<ButtonId, { off: PBRMaterial; on: PBRMaterial }>();
  /** when the door buttons were last pressed, to light them for a moment */
  private flashed = new Map<ButtonId, number>();
  /** what each indicator shows, so its canvas is only painted when that changes */
  private shown = new Map<Mesh, string>();
  private sound = new LiftSound();
  /** this visitor's changes to the shared state, passed on to everyone */
  private publish: (s: LiftState) => void;
  /** the state seen last frame, to tell the sounds of its changes */
  private last: { phase: LiftState["phase"]; doorTarget: 0 | 1; doorAt: number } | null = null;
  /** which way the car last travelled: one chime for up, two for down */
  private lastDir: "up" | "down" = "up";
  private target: Button | null = null;
  private carShown = true;
  /** the mouse over the canvas (client px), to aim at buttons while it isn't captured */
  private mouse: { x: number; y: number } | null = null;

  constructor(
    private scene: Scene,
    mats: Materials,
    private fly: FlyCamera,
    private canvas: HTMLCanvasElement,
  ) {
    const need = <T>(n: T | null, what: string): T => {
      if (!n) throw new Error(`The house has no ${what}`);
      return n;
    };
    const mesh = (role: string, slot: number | undefined, what: string) => need(find(scene, role, slot) as Mesh | null, what);
    this.car = need(find(scene, ROLE.liftCar) as TransformNode | null, "lift car");
    for (const f of FLOORS) {
      this.doors.set(f, { left: mesh(ROLE.liftDoorLeft, f, `left landing door on floor ${f}`), right: mesh(ROLE.liftDoorRight, f, `right landing door on floor ${f}`) });
      this.indicators.push(mesh(ROLE.liftIndicator, f, `indicator on floor ${f}`));
      this.buttons.push({ id: `call${f}`, mesh: mesh(ROLE.liftCallButton, f, `call button on floor ${f}`), glyph: f === 1 ? "up" : "down", at: f });
      this.buttons.push({ id: `car${f}`, mesh: mesh(ROLE.liftFloorButton, f, `car button for floor ${f}`), glyph: f === 1 ? "1" : "2", at: "car" });
    }
    this.buttons.push({ id: "open", mesh: mesh(ROLE.liftOpenButton, undefined, "door-open button in the car"), glyph: "open", at: "car" });
    this.buttons.push({ id: "close", mesh: mesh(ROLE.liftCloseButton, undefined, "door-close button in the car"), glyph: "close", at: "car" });
    this.carDoors = { left: mesh(ROLE.liftCarDoorLeft, undefined, "car's left door"), right: mesh(ROLE.liftCarDoorRight, undefined, "car's right door") };
    this.indicators.push(mesh(ROLE.liftCarIndicator, undefined, "indicator in the lift car"));
    for (const b of this.buttons) {
      this.lamps.set(b.id, { off: mats.get(buttonMat(b.glyph, false)) as PBRMaterial, on: mats.get(buttonMat(b.glyph, true)) as PBRMaterial });
      b.mesh.outlineColor = Color3.FromHexString("#ffd08a");
      b.mesh.outlineWidth = 0.003;
    }

    // the car's own light, which travels with it: its ceiling's downlights
    const carMeshes = this.car.getChildMeshes();
    const ceiling = carMeshes.find((m) => m.name === "Lift car ceiling");
    const c = ceiling ? ceiling.getBoundingInfo().boundingBox.centerWorld : new Vector3(LIFT_CAR.x, LIFT_CAR.height, (LIFT_CAR.z0 + LIFT_CAR.z1) / 2);
    // hung a little below the ceiling, so the light spreads over it rather than burning a spot on it
    this.light = new PointLight("Lift car light", new Vector3(c.x, c.y - 0.55, c.z), scene);
    this.light.parent = this.car;
    this.light.diffuse = Color3.FromHexString("#fff0dc").toLinearSpace();
    this.light.specular = this.light.diffuse.scale(0.25);
    this.light.intensity = 9;
    this.light.range = 4.5;
    this.light.falloffType = PointLight.FALLOFF_PHYSICAL;
    // all but the back glass, where the light's highlight would show as a lamp hanging in mid-air
    this.light.includedOnlyMeshes = carMeshes.filter((m) => m.name !== "Lift car mirror");
    // inside, the car is lit by its own light alone: the rooms' lamps are outside it, and at the
    // upper floor the lower floor's lamps would light it from below the slab
    for (const l of scene.lights) {
      if (l === this.light || !l.includedOnlyMeshes.length) continue;
      l.includedOnlyMeshes = l.includedOnlyMeshes.filter((m) => !carMeshes.includes(m as Mesh));
    }

    canvas.addEventListener("pointermove", (e) => (this.mouse = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointerleave", () => (this.mouse = null));
    // the shared state: everyone's changes come in here, and a visitor who leaves lets go of the doorway and the lift
    this.publish = room.share("lift", store.get().lift, (s) => store.set({ lift: s }));
    room.onGone((id) => {
      const now = room.now();
      const s = advanceLift(store.get().lift, now);
      const next = setNearby(setDoorway(s, id, false, now), id, false);
      if (next !== s) this.publish(next);
    });

    // sound may start at the visitor's first key press or click, so the lift is heard before it is used
    const wake = () => this.sound.unlock();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
  }

  /** Each frame, before the walker moves: the timeline on, the doorway sensed, the car and its parts shown. */
  update(): void {
    const now = room.now();
    // the timed steps: the same for everyone from the same state, so kept here, not passed on
    let s = advanceLift(store.get().lift, now);
    if (s !== store.get().lift) store.set({ lift: s });
    // this visitor's own changes are passed on: in or out of the doorway, at the lift or away
    let mine = s;
    const inside = this.inDoorway(mine);
    if (inside !== mine.inDoorway.includes(VIEWER)) mine = setDoorway(mine, VIEWER, inside, now);
    const near = this.nearLift(mine, now);
    if (near !== mine.nearby.includes(VIEWER)) mine = setNearby(mine, VIEWER, near);
    if (mine !== s) this.publish((s = mine));
    this.show(s, now);
    this.prompt(s, now);
    this.listen(s, now);
  }

  /** A floor button pressed (E, or a click): `floor` called from the landing, or chosen inside the car. */
  press(floor: Floor, source: "call" | "car"): void {
    this.use(source === "call" ? `call${floor}` : `car${floor}`);
  }

  /** Puts the shared lift back as the house opens with it (parked downstairs, doors shut, quiet), for everyone: for tests. */
  reset(): void {
    this.publish(initialLift(room.now()));
  }

  /** E: presses the button the walker is pointing at, if any. */
  act(): void {
    if (this.target) this.use(this.target.id);
  }

  /** A canvas click in walk mode on a lift button within reach presses it. */
  click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().focus) return false;
    const hit = pickAt(this.scene, this.canvas, e);
    if (!hit || hit.distance > CLICK_REACH) return false;
    const b = this.buttons.find((b) => b.mesh === hit.mesh);
    if (!b) return false;
    this.use(b.id);
    return true;
  }

  /** A button pressed: the command it gives the shared state. */
  use(id: ButtonId): void {
    this.sound.unlock();
    this.sound.press();
    const now = room.now();
    const s = advanceLift(store.get().lift, now);
    let next: LiftState;
    if (id === "open") next = holdDoors(s, now);
    else if (id === "close") next = shutDoorsNow(s, now);
    else next = callLift(s, Number(id.slice(-1)) as Floor, id.startsWith("call") ? "call" : "car", now);
    if (id === "open" || id === "close") this.flashed.set(id, now);
    this.publish(playMusic(next, VIEWER, now));
  }

  /**
   * Whether the walker's body is in the doorway of the floor the car is at: the threshold from in
   * front of the landing's frame to the car's front. Someone touching the doors is in it, so the
   * sensor reaches a little past the body (SENSE_REACH).
   */
  private inDoorway(s: LiftState): boolean {
    const w = this.fly.walker;
    if (!w || !this.fly.enabled || s.phase === "moving") return false;
    const reach = AVATAR.radius + SENSE_REACH;
    const half = LIFT_DOOR.w / 2;
    const x = w.feet.x;
    const z = w.feet.z;
    const front = LIFT_DOOR.z0 - 0.2;
    return Math.abs(w.feet.y - (LEVEL.lower + floorHeight(s.floor))) < LEVEL_TOLERANCE && x > LIFT_CAR.x - half - reach && x < LIFT_CAR.x + half + reach && z + reach > front && z - reach < LIFT_CAR.z0;
  }

  /** Puts the car, its doors, lamps and indicators where the state has them, and plays the sounds of its changes. */
  private show(s: LiftState, now: number): void {
    const height = carHeight(s, now);
    this.car.position.y = height;
    // the car is part of the upper floor's space: hidden with it when the upper floor is hidden, but still a solid
    const visible = !(store.get().upperHidden && height > LEVEL.lowerCeil - LEVEL.lower);
    if (visible !== this.carShown) {
      this.carShown = visible;
      for (const m of this.car.getChildMeshes()) m.isVisible = visible;
      this.light.setEnabled(visible);
    }

    // the doors of the floor the car is at open with the car's own; the others stay shut
    const open = s.phase !== "moving" ? ease(doorPosAt(s, now)) * LIFT_DOOR.travel : 0;
    for (const f of FLOORS) {
      const d = this.doors.get(f)!;
      const o = f === s.floor ? open : 0;
      d.left.position.x = -o;
      d.right.position.x = o;
    }
    this.carDoors.left.position.x = -open;
    this.carDoors.right.position.x = open;

    for (const b of this.buttons) {
      const lit = b.id === "open" || b.id === "close" ? now - (this.flashed.get(b.id) ?? -Infinity) < FLASH : s.pending.includes(Number(b.id.slice(-1)) as Floor);
      const lamp = this.lamps.get(b.id)!;
      const want = lit ? lamp.on : lamp.off;
      if (b.mesh.material !== want) b.mesh.material = want;
    }

    // while it travels, the indicators show the floor it is passing, and its way
    const moving = s.phase === "moving" && s.dest !== null;
    const passing: Floor = height >= floorHeight(2) / 2 ? 2 : 1;
    const shown: Shown = moving ? { floor: passing, dir: s.dest! > s.floor ? "up" : "down" } : { floor: s.floor, dir: null };
    for (const m of this.indicators) this.paint(m, shown);

    this.sound.motor(moving ? carSpeed(s, now) / LIFT_TIMING.topSpeed : 0);
    this.sounds(s, now);
    this.music(s, now);
  }

  private paint(mesh: Mesh, shown: Shown): void {
    const key = `${shown.floor}${shown.dir ?? ""}`;
    if (this.shown.get(mesh) === key) return;
    this.shown.set(mesh, key);
    const tex = (mesh.material as PBRMaterial).emissiveTexture as DynamicTexture;
    paintIndicator(tex.getContext() as CanvasRenderingContext2D, shown);
    tex.update();
  }

  /** The sounds of the state's changes: the car setting off and stopping, the chime, the doors opening, shutting and reopening. */
  private sounds(s: LiftState, now: number): void {
    const prev = this.last;
    this.last = { phase: s.phase, doorTarget: s.doorTarget, doorAt: s.doorAt };
    // on the first look the house opens with the car where it is: silent
    if (!prev || (prev.phase === s.phase && prev.doorTarget === s.doorTarget && prev.doorAt === s.doorAt)) return;
    if (s.phase === "moving" && prev.phase !== "moving") {
      this.lastDir = s.dest !== null && s.dest > s.floor ? "up" : "down";
      this.sound.depart();
    }
    if (prev.phase === "moving" && s.phase !== "moving") this.sound.stop();
    // the doors set off: opening (with the chime, for a car that has just come), shutting, or reversing on someone
    if (s.doorTarget === 1 && (prev.doorTarget !== 1 || prev.phase !== "open")) {
      if (prev.phase === "closing") this.sound.reopen();
      else if (prev.phase === "arriving" || prev.phase === "moving") this.sound.chime(this.lastDir === "up" ? 1 : 2);
      const left = (1 - doorPosAt(s, now)) * LIFT_TIMING.openTime;
      if (left > 0.05) this.sound.doors(true, left);
    }
    if (s.phase === "closing" && prev.phase !== "closing") this.sound.doors(false, doorPosAt(s, now) * LIFT_TIMING.shutTime);
  }

  /** The car's music, playing while the shared state has it on, from the same point in the tune for everyone. */
  private music(s: LiftState, now: number): void {
    const into = musicAt(s, now);
    if (into !== null && !this.sound.musicPlaying) this.sound.music(true, into);
    else if (into === null && this.sound.musicPlaying) this.sound.music(false);
  }

  /** Whether this visitor is at the lift: in the car, or near a landing's doors (a little further to leave than to come). */
  private nearLift(s: LiftState, now: number): boolean {
    // the visitor is where their eyes are: the chimp's, walking, not a camera behind it
    const eye = this.fly.eye;
    const carFloor = LEVEL.lower + carHeight(s, now);
    if (this.inCar(eye.x, eye.z) && eye.y > carFloor && eye.y < carFloor + LIFT_CAR.height) return true;
    const reach = s.nearby.includes(VIEWER) ? LEFT_LIFT : NEAR_LIFT;
    return FLOORS.some((f) => Math.hypot(eye.x - LIFT_CAR.x, eye.y - (LEVEL.lower + floorHeight(f) + 1.6), eye.z - LIFT_DOOR.z0) < reach);
  }

  /** Where the visitor hears the lift from: their ear and the way they face, where the car is, and whether they are inside it or shut out of it. */
  private listen(s: LiftState, now: number): void {
    const cam = this.fly.camera;
    // heard from where the visitor is (the chimp's head, walking), facing the way the camera does
    const eye = this.fly.eye;
    const cy = LEVEL.lower + carHeight(s, now) + 1.2;
    const cz = (LIFT_CAR.z0 + LIFT_CAR.z1) / 2;
    const inside = this.inCar(eye.x, eye.z) && Math.abs(eye.y - cy) < 1.3;
    const shut = s.phase === "moving" || doorPosAt(s, now) < 0.05;
    const fwd = cam.getDirection(Vector3.Forward());
    const up = cam.getDirection(Vector3.Up());
    this.sound.listen([eye.x, eye.y, eye.z], [fwd.x, fwd.y, fwd.z], [up.x, up.y, up.z], [LIFT_CAR.x, cy, cz], inside, shut);
  }

  private inCar(x: number, z: number): boolean {
    return z > LIFT_CAR.z0 && z < LIFT_CAR.z1 && Math.abs(x - LIFT_CAR.x) < LIFT_CAR.halfW;
  }

  /** Which lift button the walker is pointing at now, if any: outlined, and named in the prompt. */
  private prompt(s: LiftState, now: number): void {
    const st = store.get();
    let next: Button | null = null;
    if (this.fly.walker && st.walking && !st.focus && this.fly.enabled) next = this.aimed(s, now);
    if (next !== this.target) {
      if (this.target) this.target.mesh.renderOutline = false;
      if (next) next.mesh.renderOutline = true;
    }
    this.target = next;
    const label = next ? this.label(next, s) : null;
    const current = st.liftPrompt;
    if ((current?.label ?? null) !== label || (current?.id ?? null) !== (next?.id ?? null)) store.set({ liftPrompt: next && label ? { id: next.id, label } : null });
  }

  /**
   * The button the visitor points at: of the buttons they can use where they stand (the car's inside
   * the car, the landing's on its floor), within reach, the one nearest the line from the eye through
   * the cursor, or through the crosshair while the mouse is captured.
   */
  private aimed(s: LiftState, now: number): Button | null {
    const w = this.fly.walker!;
    const carFloor = LEVEL.lower + carHeight(s, now) + LIFT_CAR.floorLift;
    const inCar = this.inCar(w.feet.x, w.feet.z) && Math.abs(w.feet.y - carFloor) < LEVEL_TOLERANCE;
    const p = pickPoint(this.canvas, this.mouse);
    const ray = this.scene.createPickingRay(p.x, p.y, Matrix.Identity(), this.fly.camera);
    let best: Button | null = null;
    let bestMiss = Infinity;
    for (const b of this.buttons) {
      if (inCar ? b.at !== "car" : b.at === "car" || Math.abs(w.feet.y - (LEVEL.lower + floorHeight(b.at))) >= LEVEL_TOLERANCE) continue;
      // a button's geometry is built in place, so its pivot is the origin: its box's centre is where it is
      const p = b.mesh.getBoundingInfo().boundingBox.centerWorld;
      const v = p.subtract(ray.origin);
      const along = Vector3.Dot(v, ray.direction);
      // pointed at through the view, within reach of the visitor's eyes
      if (along <= 0 || Vector3.Distance(p, this.fly.eye) > REACH) continue;
      const miss = v.subtract(ray.direction.scale(along)).length();
      if (miss > AIM[b.at === "car" ? "car" : "call"] || miss >= bestMiss) continue;
      best = b;
      bestMiss = miss;
    }
    return best;
  }

  private label(b: Button, s: LiftState): string {
    switch (b.id) {
      case "open":
        return "Hold the doors open";
      case "close":
        return "Close the doors";
      case "call1":
      case "call2":
        return b.at === s.floor && s.phase !== "moving" ? "Call the lift (it's here)" : "Call the lift";
      default: {
        const f = Number(b.id.slice(-1)) as Floor;
        const name = f === 1 ? "lower" : "upper";
        return f === s.floor && s.phase !== "moving" ? `${f} · Open the doors (you're on the ${name} floor)` : `${f} · Go to the ${name} floor`;
      }
    }
  }

  /** The state as the lift shows it, for the page's checks. */
  describe(now = room.now()): { phase: LiftState["phase"]; floor: Floor; dest: Floor | null; height: number; doorPos: number; pending: Floor[]; inDoorway: string[]; aimed: string | null; music: boolean } {
    const s = store.get().lift;
    return { phase: s.phase, floor: s.floor, dest: s.dest, height: carHeight(s, now), doorPos: doorPosAt(s, now), pending: s.pending, inDoorway: s.inDoorway, aimed: this.target?.id ?? null, music: musicAt(s, now) !== null };
  }
}
