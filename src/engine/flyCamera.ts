import { Camera, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
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
 * Free-fly camera without collisions. Click the canvas to capture the mouse,
 * WASD to move along the view, E/Space up, Q/C down, Shift for speed, wheel
 * adjusts base speed. Right-drag looks around without capturing the mouse.
 * With a `walker` set, WASD walks it instead and the camera rides at its eye.
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
      if (e.altKey || store.get().inspectMode || store.get().focus) return;
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
        if (store.get().focus) return;
        if (this.orthoState) {
          this.orthoState.halfHeight = Math.max(4, Math.min(80, this.orthoState.halfHeight * (e.deltaY > 0 ? 1.1 : 0.9)));
          this.applyOrtho();
          return;
        }
        this.baseSpeed = Math.max(0.5, Math.min(80, this.baseSpeed * (e.deltaY > 0 ? 0.85 : 1.18)));
        store.set({ speed: Math.round(this.baseSpeed * 10) / 10 });
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      if (isTyping(e) || store.get().focus) return;
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  private look(dx: number, dy: number) {
    if (!this.enabled || this.orthoState) return;
    this.transition = null;
    const sens = 0.0022;
    this.yaw += dx * sens;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dy * sens));
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
      this.camera.position.set(this.walker.feet.x, this.walker.eyeY, this.walker.feet.z);
    } else if (this.enabled && !this.orthoState) {
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
    } else if (this.orthoState) {
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
    this.saveTimer += dt;
    if (this.saveTimer > 0.5) {
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
