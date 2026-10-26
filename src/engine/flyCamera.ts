import { Camera, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import { FLY_IN_ENABLED } from "./devFlags";
import { store } from "./store";
import { AVATAR, Walker } from "./walker";

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
  ortho?: { cx: number; cz: number; halfHeight: number } | null;
}

const POSE_KEY = "chimphouse.pose.v1";

/**
 * The visitor's eyes and the way they look (unit): the camera's while flying; walking, the chimp's
 * own eyes looking where the camera aims. Reach is measured from here (engine/focus.ts pickAt, and
 * each feature's "within reach and looking at it"), never from a camera behind the chimp.
 */
export const viewer = { eye: new Vector3(), aim: new Vector3(0, 0, 1) };

/** The third-person boom, metres: where it starts, its limits, the least a wall leaves of it, the gap kept to a wall. */
const BOOM = { start: 2.7, min: 1.1, max: 6, closest: 0.35, clear: 0.28 };
/** How far past the chimp the view's middle is followed to find what the chimp looks at, metres. */
const AIM_FAR = 30;

/**
 * Free-fly camera without collisions (developer-only: FLY_IN_ENABLED, engine/devFlags.ts).
 * Click the canvas to capture the mouse, WASD to move along the view, E/Space up,
 * Q/C down, Shift for speed, wheel adjusts base speed. Right-drag looks around
 * without capturing the mouse. Without the flag it never flies: it only follows the
 * walker, or glides to and from a screen in use.
 *
 * With a `walker` set, WASD walks it instead, and the camera follows the chimp:
 * from behind and above it (third person), on a boom that walls cut short, or
 * from its eyes (first person, a boom of 0). The wheel lengthens and shortens
 * the boom. Either way `eye` and `aim` are the visitor's own eyes and the way
 * they look, which is what reach is measured from (a cabinet in front of the
 * chimp, a remote on a stand), not the camera behind it.
 */
export class FlyCamera {
  readonly camera: UniversalCamera;
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private velocity = Vector3.Zero();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private transition: { from: Pose; to: Pose; t: number; dur: number; done?: () => void } | null = null;
  private saveTimer = 0;
  private orthoState: Pose["ortho"] = null;
  baseSpeed = 6;
  enabled = true;
  walker: Walker | null = null;
  /** Called on a canvas click before the mouse is captured; returning true keeps it free (the click was used). */
  onClick: ((e: MouseEvent) => boolean) | null = null;
  /** While this returns true the mouse is used for something else (turning a carried plush), and doesn't turn the view. */
  mouseTaken: (() => boolean) | null = null;
  /** Walking: how far behind the chimp the camera sits (metres; 0 is from its eyes). */
  boom = BOOM.start;
  /** The last third-person boom, for switching back from first person. */
  private lastBoom = BOOM.start;
  /** Where the boom turns: this far above the chimp's feet, over its head (engine/avatars.ts sets it to the chimp's height). */
  pivotHeight = 1.6;
  /**
   * Framing for a while (the wardrobe): the pivot lowered by `drop` metres and the camera moved
   * `side` metres to its right, so the chimp stands whole in the part of the view a panel leaves.
   */
  framing = { drop: 0, side: 0 };
  /** The boom as it is this frame: cut short by a wall at once, easing back out when it clears. */
  private reach = 0;
  /** How far (0 to 1) the pivot has gone down to the eyes: seated under a hood (see `follow`). */
  private hooded = 0;
  /** While set (the wardrobe is open) the walking keys do nothing; the mouse still turns the camera round the chimp. */
  holdStill = false;
  /** The visitor's eyes and the way they look (unit), for what is within reach: see the class's note. */
  readonly eye = viewer.eye;
  readonly aim = viewer.aim;

  constructor(
    private scene: Scene,
    private canvas: HTMLCanvasElement,
  ) {
    this.camera = new UniversalCamera("flyCamera", new Vector3(0, 2, -40), scene);
    this.camera.minZ = 0.05;
    this.camera.maxZ = 6000;
    this.camera.fov = 1.0;
    this.camera.inputs.clear();
    scene.activeCamera = this.camera;
    this.bind();
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener("click", (e) => {
      // while a screen is in use (a cabinet's game, the theatre's video) the mouse stays free for it and its frame
      // and in the lobby, where the mouse is for its panel and the chimp stands still
      if (e.altKey || store.get().inspectMode || store.get().focus || store.get().lobby) return;
      if (this.onClick?.(e)) return;
      if (document.pointerLockElement !== c) {
        // returns a promise in current browsers; it rejects when lock is unavailable
        const req = c.requestPointerLock?.() as unknown as Promise<void> | undefined;
        req?.catch?.(() => undefined);
      }
    });
    document.addEventListener("pointerlockchange", () => {
      store.set({ pointerLocked: document.pointerLockElement === c });
    });
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === c) this.look(e.movementX, e.movementY);
      else if (this.dragging) {
        this.look(e.clientX - this.lastX, e.clientY - this.lastY);
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    c.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    window.addEventListener("mouseup", () => (this.dragging = false));
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (store.get().focus || store.get().lobby) return;
        if (FLY_IN_ENABLED && this.orthoState) {
          this.orthoState.halfHeight = Math.max(4, Math.min(80, this.orthoState.halfHeight * (e.deltaY > 0 ? 1.1 : 0.9)));
          this.applyOrtho();
          return;
        }
        if (this.walker) {
          // walking: the wheel brings the camera in to the chimp's eyes, or out behind it
          this.setBoom(this.boom === 0 ? (e.deltaY > 0 ? BOOM.min : 0) : this.boom * (e.deltaY > 0 ? 1.12 : 0.89));
          return;
        }
        if (!FLY_IN_ENABLED) return;
        this.baseSpeed = Math.max(0.5, Math.min(80, this.baseSpeed * (e.deltaY > 0 ? 0.85 : 1.18)));
        store.set({ speed: Math.round(this.baseSpeed * 10) / 10 });
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      if (isTyping(e) || store.get().focus || store.get().lobby) return;
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  private look(dx: number, dy: number) {
    if (!this.enabled || this.orthoState || this.mouseTaken?.() || store.get().lobby) return;
    this.transition = null;
    const sens = 0.0022;
    this.yaw += dx * sens;
    // behind the chimp, not so low the boom digs into the floor
    const [lo, hi] = this.walker && this.boom > 0 ? [-0.75, 1.3] : [-1.55, 1.55];
    this.pitch = Math.max(lo, Math.min(hi, this.pitch + dy * sens));
  }

  /** Walking: from the chimp's eyes (first person) or from behind it (third). */
  get firstPerson(): boolean {
    return this.boom === 0;
  }

  /** Set the boom (metres), within its limits; under the shortest a third-person boom can be, it is first person. */
  setBoom(m: number): void {
    const b = m < BOOM.min * 0.8 ? 0 : Math.max(BOOM.min, Math.min(BOOM.max, m));
    if (b > 0) this.lastBoom = b;
    if (b > 0 && this.boom === 0) this.reach = 0;
    this.boom = b;
    store.set({ firstPerson: b === 0 });
  }

  /** Switch between first and third person. */
  toggleView(): void {
    this.setBoom(this.boom === 0 ? this.lastBoom : 0);
  }

  /**
   * Walking: the camera where the view needs it this frame (see the class's
   * note). `snap` sets the boom at once, without easing it out from a wall.
   */
  private follow(dt: number, snap = false) {
    const w = this.walker!;
    this.eye.set(w.eyeX, w.eyeY, w.eyeZ);
    const fx = Math.sin(this.yaw) * Math.cos(this.pitch);
    const fy = -Math.sin(this.pitch);
    const fz = Math.cos(this.yaw) * Math.cos(this.pitch);
    if (this.boom === 0) {
      this.camera.position.copyFrom(this.eye);
      this.aim.set(fx, fy, fz);
      this.reach = 0;
      return;
    }
    let [px, py, pz] = this.pivot(w, fx, fz);
    let want = this.boomAt(px, py, pz, fx, fy, fz);
    // seated under a hood (an egg chair's), the pivot over the head is inside it and the boom can't
    // get out: it turns about the eyes instead, out through the seat's opening (eased, either way)
    const low = w.seated && want < Math.min(this.boom, 1) ? this.boomAt(w.eyeX, w.eyeY, w.eyeZ, fx, fy, fz) : 0;
    const toEyes = low > want + 0.3 ? 1 : 0;
    this.hooded = snap ? toEyes : this.hooded + (toEyes - this.hooded) * (1 - Math.exp(-dt * 6));
    if (this.hooded > 0.001) {
      px += (w.eyeX - px) * this.hooded;
      py += (w.eyeY - py) * this.hooded;
      pz += (w.eyeZ - pz) * this.hooded;
      want = this.boomAt(px, py, pz, fx, fy, fz);
    }
    // in at once (the camera never looks through a wall), back out gently
    this.reach = snap || want < this.reach ? want : this.reach + (want - this.reach) * (1 - Math.exp(-dt * 3.5));
    const cx = px - fx * this.reach;
    const cy = py - fy * this.reach;
    const cz = pz - fz * this.reach;
    this.camera.position.set(cx, cy, cz);
    // the eyes look at what the middle of the view rests on (past the chimp), so aiming at a
    // button or a remote from behind the chimp points the chimp at it too
    const hit = w.world.raycast(cx + fx * this.reach, cy + fy * this.reach, cz + fz * this.reach, fx, fy, fz, AIM_FAR);
    const far = this.reach + Math.max(0.3, hit);
    this.aim.set(cx + fx * far - this.eye.x, cy + fy * far - this.eye.y, cz + fz * far - this.eye.z).normalize();
  }

  /** Where the boom turns: over the chimp's head, or as framed (see `framing`), for a view along (fx, fz). */
  private pivot(w: Walker, fx: number, fz: number): [number, number, number] {
    const h = Math.hypot(fx, fz) || 1;
    // the view's right, flat: (cos yaw, 0, -sin yaw)
    const rx = fz / h;
    const rz = -fx / h;
    return [w.eyeX + rx * this.framing.side, w.groundY + this.pivotHeight - this.framing.drop, w.eyeZ + rz * this.framing.side];
  }

  /** How long the boom can be from a pivot, looking along (fx, fy, fz): its length, or short of the first wall behind. */
  private boomAt(px: number, py: number, pz: number, fx: number, fy: number, fz: number): number {
    const free = this.walker!.world.raycast(px, py, pz, -fx, -fy, -fz, this.boom + BOOM.clear) - BOOM.clear;
    return Math.max(BOOM.closest, Math.min(this.boom, free));
  }

  /**
   * The pose to glide back to after a screen (engine/focus.ts): `pose` is from
   * the chimp's eyes; in third person, the camera behind the chimp looking the
   * same way, where following it will carry on from.
   */
  settlePose(pose: Pose): Pose {
    const w = this.walker;
    if (!w || this.boom === 0) return pose;
    const fx = Math.sin(pose.yaw) * Math.cos(pose.pitch);
    const fy = -Math.sin(pose.pitch);
    const fz = Math.cos(pose.yaw) * Math.cos(pose.pitch);
    const [px, py, pz] = this.pivot(w, fx, fz);
    this.reach = this.boomAt(px, py, pz, fx, fy, fz);
    return { ...pose, x: px - fx * this.reach, y: py - fy * this.reach, z: pz - fz * this.reach };
  }

  update(dt: number) {
    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const k = tr.t < 0.5 ? 4 * tr.t * tr.t * tr.t : 1 - Math.pow(-2 * tr.t + 2, 3) / 2;
      const a = tr.from;
      const b = tr.to;
      let dyaw = b.yaw - a.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      this.camera.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      this.yaw = a.yaw + dyaw * k;
      this.pitch = a.pitch + (b.pitch - a.pitch) * k;
      this.camera.fov = a.fov + (b.fov - a.fov) * k;
      if (tr.t >= 1) {
        this.transition = null;
        tr.done?.();
      }
    } else if (this.enabled && !this.orthoState && this.walker) {
      if (this.holdStill) this.keys.clear();
      const fast = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
      const slow = this.keys.has("AltLeft") || this.keys.has("AltRight");
      const speed = AVATAR.speed * (fast ? AVATAR.run : 1) * (slow ? 0.4 : 1);
      let fx = 0;
      let rx = 0;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fx += 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fx -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) rx += 1;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) rx -= 1;
      const k = fx || rx ? speed / Math.hypot(fx, rx) : 0;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      this.walker.update(dt, (fx * sin + rx * cos) * k, (fx * cos - rx * sin) * k);
      this.follow(dt);
    } else if (FLY_IN_ENABLED && this.enabled && !this.orthoState) {
      const fast = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
      const slow = this.keys.has("AltLeft") || this.keys.has("AltRight");
      const speed = this.baseSpeed * (fast ? 4 : 1) * (slow ? 0.25 : 1);
      const fwd = new Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const want = Vector3.Zero();
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) want.addInPlace(fwd);
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) want.subtractInPlace(fwd);
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) want.addInPlace(right);
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) want.subtractInPlace(right);
      if (this.keys.has("KeyE") || this.keys.has("Space")) want.y += 1;
      if (this.keys.has("KeyQ") || this.keys.has("KeyC")) want.y -= 1;
      if (want.lengthSquared() > 0) want.normalize().scaleInPlace(speed);
      const blend = 1 - Math.exp(-dt * 10);
      this.velocity = Vector3.Lerp(this.velocity, want, blend);
      if (this.velocity.lengthSquared() > 1e-6) this.camera.position.addInPlace(this.velocity.scale(dt));
    } else if (FLY_IN_ENABLED && this.orthoState) {
      // pan the plan view with WASD
      const s = this.orthoState.halfHeight * 1.2 * dt;
      let moved = false;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) (this.orthoState.cz += s), (moved = true);
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) (this.orthoState.cz -= s), (moved = true);
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) (this.orthoState.cx += s), (moved = true);
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) (this.orthoState.cx -= s), (moved = true);
      if (moved) this.applyOrtho();
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    // flying, or gliding to or from a screen: the visitor's eyes are the camera's
    if (!this.walker || this.transition || !this.enabled || this.orthoState) {
      this.eye.copyFrom(this.camera.position);
      this.aim.set(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    }
    // the camera is remembered between reloads only for the fly-in camera (restoreSaved)
    if (FLY_IN_ENABLED && (this.saveTimer += dt) > 0.5) {
      this.saveTimer = 0;
      try {
        localStorage.setItem(POSE_KEY, JSON.stringify(this.getPose()));
      } catch {
        /* storage unavailable */
      }
    }
  }

  getPose(): Pose {
    const p = this.camera.position;
    return {
      x: round(p.x),
      y: round(p.y),
      z: round(p.z),
      yaw: round(this.yaw, 4),
      pitch: round(this.pitch, 4),
      fov: round(this.camera.fov, 4),
      ortho: this.orthoState ? { ...this.orthoState } : null,
    };
  }

  /** Glide to a pose over `dur` seconds; resolves on arrival, or when another pose replaces it. */
  glide(pose: Pose, dur: number): Promise<void> {
    return new Promise((resolve) => {
      this.setPose(pose, dur);
      if (this.transition) this.transition.done = resolve;
      else resolve();
    });
  }

  /** Forget held keys, so nothing keeps moving once input goes elsewhere. */
  releaseKeys(): void {
    this.keys.clear();
    this.velocity.setAll(0);
  }

  setPose(pose: Pose, animate = 0) {
    this.transition?.done?.();
    this.velocity.setAll(0);
    if (pose.ortho) {
      // a plan view is the fly-in camera's: refused without it
      if (!FLY_IN_ENABLED) return;
      this.transition = null;
      this.orthoState = { ...pose.ortho };
      this.camera.position.set(pose.ortho.cx, 120, pose.ortho.cz);
      this.yaw = 0;
      this.pitch = Math.PI / 2;
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      this.applyOrtho();
      return;
    }
    if (this.orthoState) {
      this.orthoState = null;
      this.camera.mode = Camera.PERSPECTIVE_CAMERA;
      animate = 0;
    }
    if (animate > 0) {
      this.transition = { from: this.getPose(), to: pose, t: 0, dur: animate };
    } else {
      this.transition = null;
      this.camera.position.set(pose.x, pose.y, pose.z);
      this.yaw = pose.yaw;
      this.pitch = pose.pitch;
      this.camera.fov = pose.fov;
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
  }

  get isOrtho(): boolean {
    return !!this.orthoState;
  }

  applyOrtho() {
    const o = this.orthoState;
    if (!o) return;
    const engine = this.scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.position.set(o.cx, 120, o.cz);
    this.camera.orthoTop = o.halfHeight;
    this.camera.orthoBottom = -o.halfHeight;
    this.camera.orthoLeft = -o.halfHeight * aspect;
    this.camera.orthoRight = o.halfHeight * aspect;
  }

  restoreSaved(): boolean {
    if (!FLY_IN_ENABLED) return false;
    try {
      const raw = localStorage.getItem(POSE_KEY);
      if (!raw) return false;
      const pose = JSON.parse(raw) as Pose;
      if (typeof pose.x !== "number") return false;
      this.setPose(pose);
      return true;
    } catch {
      return false;
    }
  }

  get headingDeg(): number {
    return ((((this.yaw * 180) / Math.PI) % 360) + 360) % 360;
  }
}

function round(v: number, d = 2) {
  const k = Math.pow(10, d);
  return Math.round(v * k) / k;
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
