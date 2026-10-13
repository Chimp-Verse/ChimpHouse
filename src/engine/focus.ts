// Using a screen in the house: a game at an arcade cabinet, a video on the
// theatre screen. The mouse is freed, ChimpHouse's own keys and mouse look stop,
// and the camera glides square onto the screen, so the screen shows as an
// upright rectangle; the content (another site's page, in an iframe) is laid
// exactly over it, because browsers don't let another site's content be drawn
// onto a 3D surface. Leaving glides back and gives walking or flying back.
//
// Shared by engine/arcade.ts and engine/theatre.ts; ui/FocusFrame.tsx is the
// frame of UI round the content. Screens are found by role (world/roles.ts) and
// read from their meshes, never from how the room code builds them.

import { AbstractMesh, Matrix, Mesh, Scene, Vector3, VertexBuffer, Viewport } from "@babylonjs/core";
import { FlyCamera, Pose } from "./flyCamera";
import { FocusInfo, ScreenRect, store } from "./store";

/** A screen's place in the world, read from its mesh. */
export interface ScreenGeometry {
  /** as seen from the front: bottom-left, bottom-right, top-right, top-left */
  corners: [Vector3, Vector3, Vector3, Vector3];
  centre: Vector3;
  /** unit vectors: out of the screen's front, its up, and its right as seen from the front */
  normal: Vector3;
  up: Vector3;
  right: Vector3;
  width: number;
  height: number;
}

/**
 * A screen's corners and frame from its mesh alone: the front is the way its
 * normals point, its up is the world's up laid in its plane (screens stand
 * upright or lean back), and its corners bound its vertices. So it holds for a
 * screen built in code or loaded from Blender, whatever its origin.
 */
export function screenGeometry(mesh: Mesh): ScreenGeometry {
  const wm = mesh.computeWorldMatrix(true);
  const P = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const N = mesh.getVerticesData(VertexBuffer.NormalKind) ?? [];
  const pts: Vector3[] = [];
  const normal = Vector3.Zero();
  const n = new Vector3();
  for (let i = 0; i < P.length; i += 3) {
    pts.push(Vector3.TransformCoordinatesFromFloatsToRef(P[i], P[i + 1], P[i + 2], wm, new Vector3()));
    normal.addInPlace(Vector3.TransformNormalFromFloatsToRef(N[i] ?? 0, N[i + 1] ?? 0, N[i + 2] ?? 0, wm, n));
  }
  normal.normalize();
  const mid = pts.reduce((a, p) => a.addInPlace(p), Vector3.Zero()).scaleInPlace(1 / Math.max(1, pts.length));
  const up = Vector3.Up().subtract(normal.scale(normal.y)).normalize();
  // the right of a viewer facing the screen: their up × their forward (Babylon is left-handed)
  const right = Vector3.Cross(up, normal.negate()).normalize();
  let s0 = Infinity;
  let s1 = -Infinity;
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const p of pts) {
    const d = p.subtract(mid);
    const s = Vector3.Dot(d, right);
    const t = Vector3.Dot(d, up);
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
  }
  const at = (s: number, t: number) => mid.add(right.scale(s)).addInPlace(up.scale(t));
  return {
    corners: [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)],
    centre: at((s0 + s1) / 2, (t0 + t1) / 2),
    normal,
    up,
    right,
    width: s1 - s0,
    height: t1 - t0,
  };
}

/** Points in the world as the page shows them, in CSS pixels, from the camera as it is now. */
export function toPage(points: Vector3[], scene: Scene, canvas: HTMLCanvasElement): { x: number; y: number }[] {
  const cam = scene.activeCamera!;
  const vp = cam.getViewMatrix(true).multiply(cam.getProjectionMatrix(true));
  const engine = scene.getEngine();
  const rw = engine.getRenderWidth();
  const rh = engine.getRenderHeight();
  const view = new Viewport(0, 0, rw, rh);
  const box = canvas.getBoundingClientRect();
  return points.map((p) => {
    const q = Vector3.Project(p, Matrix.IdentityReadOnly, vp, view);
    return { x: box.left + (q.x * box.width) / rw, y: box.top + (q.y * box.height) / rh };
  });
}

/** Where a screen is on the page, in CSS pixels: the box round its corners. Square on, that is the screen exactly. */
export function pageRect(mesh: Mesh, scene: Scene, canvas: HTMLCanvasElement): ScreenRect {
  const pts = toPage(screenGeometry(mesh).corners, scene, canvas);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The camera square onto a screen, near enough that the screen fills `fill` of
 * the view across and up (each a share of the half-view either side of its
 * centre). The eye is level with the screen's centre, or at height `eyeY`:
 * still square on, with the screen higher or lower in the view.
 */
export function squarePose(g: ScreenGeometry, fov: number, aspect: number, fill: { w: number; h: number }, eyeY?: number): Pose {
  const t = Math.tan(fov / 2);
  // the eye's offset from the screen's centre along its up, and its distance in front
  let lift = 0;
  let d = 0;
  for (let i = 0; i < 3; i++) {
    d = Math.max((g.height / 2 + Math.abs(lift)) / (t * fill.h), g.width / 2 / (t * aspect * fill.w));
    if (eyeY === undefined) break;
    lift = (eyeY - g.centre.y - g.normal.y * d) / g.up.y;
  }
  const p = g.centre.add(g.normal.scale(d)).addInPlace(g.up.scale(lift));
  return { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-g.normal.x, -g.normal.z), pitch: Math.asin(g.normal.y), fov };
}

/**
 * The point Babylon's picking takes for a place on the canvas: CSS pixels from its top left, which
 * Babylon scales by the hardware scaling level itself (render pixels only match them at a scaling of
 * 1, so on a Retina screen or at another quality a pick would land beside the pointer). The centre
 * of the view while the mouse is captured or there is no pointer, else the pointer at `client`.
 */
export function pickPoint(canvas: HTMLCanvasElement, client: { x: number; y: number } | null): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  if (document.pointerLockElement === canvas || !client) return { x: box.width / 2, y: box.height / 2 };
  return { x: client.x - box.left, y: client.y - box.top };
}

/** What a click on the canvas is on (the centre of the view while the mouse is captured), and how far away. */
export function pickAt(scene: Scene, canvas: HTMLCanvasElement, e: MouseEvent): { mesh: AbstractMesh; distance: number } | null {
  const { x, y } = pickPoint(canvas, { x: e.clientX, y: e.clientY });
  const pick = scene.pick(x, y, (m) => m.isPickable && m.isEnabled() && m.isVisible);
  return pick?.hit && pick.pickedMesh ? { mesh: pick.pickedMesh, distance: pick.distance } : null;
}

/**
 * The one screen in use, if any. Its state is the store's `focus` (what is in use
 * and how far the glide has got) and `focusRect` (where the screen is on the
 * page once the camera is square onto it); while there is a focus, ChimpHouse's
 * own keys, mouse look and pointer capture do nothing (preview.ts, flyCamera.ts).
 */
export class ScreenFocus {
  private screen: Mesh | null = null;
  private pose: (() => Pose) | null = null;
  /** render size the pose was set for: a resize sets it again */
  private poseSize = "";
  private seq = 0;

  constructor(
    private scene: Scene,
    private fly: FlyCamera,
    private canvas: HTMLCanvasElement,
  ) {}

  /** The screen in use. */
  get current(): Mesh | null {
    return this.screen;
  }

  /**
   * Use a screen: free the mouse, stop ChimpHouse's input and glide to `pose()`
   * (asked again after a resize). Resolves true once the camera is there, false
   * when the screen was left on the way or another was already in use.
   */
  async enter(info: FocusInfo, screen: Mesh, pose: () => Pose, glide = 0.9): Promise<boolean> {
    if (store.get().focus) return false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.fly.releaseKeys();
    this.fly.enabled = false;
    this.screen = screen;
    this.pose = pose;
    const token = ++this.seq;
    store.set({ focus: { ...info, phase: "in" }, focusRect: null });
    await this.fly.glide(pose(), glide);
    const f = store.get().focus;
    if (this.seq !== token || !f || f.phase !== "in") return false;
    this.poseSize = "";
    store.set({ focus: { ...f, phase: "on" } });
    this.update();
    return true;
  }

  /** Stop using the screen: the content goes, the camera glides to `back` (if given), and walking or flying resumes. */
  async leave(back: Pose | null, glide = 0.8): Promise<void> {
    const f = store.get().focus;
    if (!f || f.phase === "out") return;
    const token = ++this.seq;
    store.set({ focus: { ...f, phase: "out" }, focusRect: null });
    if (back) await this.fly.glide(back, glide);
    if (this.seq !== token) return;
    this.screen = null;
    this.pose = null;
    store.set({ focus: null, focusRect: null });
    this.fly.releaseKeys();
    this.fly.enabled = true;
  }

  /** Each frame: while a screen is in use, keep the camera square onto it through window resizes, and `focusRect` on it. */
  update(): void {
    const f = store.get().focus;
    if (!f || f.phase !== "on" || !this.screen || !this.pose) return;
    const engine = this.scene.getEngine();
    const size = `${engine.getRenderWidth()}x${engine.getRenderHeight()}`;
    if (size !== this.poseSize) {
      this.poseSize = size;
      this.fly.setPose(this.pose());
    }
    const r = pageRect(this.screen, this.scene, this.canvas);
    const was = store.get().focusRect;
    if (!was || Math.abs(r.x - was.x) > 0.5 || Math.abs(r.y - was.y) > 0.5 || Math.abs(r.w - was.w) > 0.5 || Math.abs(r.h - was.h) > 0.5) store.set({ focusRect: r });
  }
}
