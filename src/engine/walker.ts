import { Vector3 } from "@babylonjs/core";
import { faceLabel } from "../world/context";
import { CollisionWorld, closestOnTriangle, emptyProbe } from "./collision";

/**
 * Size of the walking body, in metres: the capsule that bumps into things. The
 * chimp (engine/avatars.ts) sets the eye height a walker sees from to its own;
 * the capsule stays person-sized, so every chimp fits through the same doors.
 */
export const AVATAR = {
  height: 1.7,
  /** eye height until a chimp sets the walker's own (`Walker.eye`) */
  eye: 1.55,
  /** eye height sitting down, as when watching the theatre screen */
  seatedEye: 1.15,
  /** half the shoulder width: the closest the body gets to a wall */
  radius: 0.3,
  /** tallest ledge stepped up without stopping, a common game-engine default: every stair (risers up to 0.23 m), not sofa seats */
  step: 0.3,
  /** walking speed; Shift runs */
  speed: 2.5,
  run: 2.2,
};

const GRAVITY = 9.81;
const SUBSTEP = 1 / 120;
/** how far below the feet the ground is followed down stairs and slopes while walking */
const SNAP_DOWN = 0.45;
/** where the ground is sampled, as fractions of the radius: four points round the centre */
const FOOTPRINT = [0.6, 0, -0.6, 0, 0, 0.6, 0, -0.6];
/** how fast the walker slides down a slope too steep to stand on */
const SLIDE = 3;

/**
 * Walk mode: a capsule that moves through the house's real geometry. Walls,
 * glass, railings and furniture block it and it slides along them; stair
 * risers and ledges up to `AVATAR.step` are stepped onto; anything else is
 * fallen off. Leaves and plant stems are passed through.
 */
export class Walker {
  readonly feet = new Vector3();
  private vel = new Vector3();
  private vy = 0;
  /** horizontal velocity down a slope too steep to stand on */
  private slideX = 0;
  private slideZ = 0;
  private grounded = false;
  private camY = 0;
  private safe = new Vector3();
  private safeTimer = 0;
  private stuckTime = 0;
  private sinceBlocked = 0;
  private acc = 0;
  private contactTri = -1;
  private contactPush = 0;
  /** Label of what the walker last walked into, kept for a few seconds after. */
  blockedBy: string | null = null;
  /** the eye's height above the feet: the chimp's own, once it has one */
  eye = AVATAR.eye;
  private cp = new Float64Array(3);
  private under = emptyProbe();

  /** the house's solid triangles; replaced when cabinets come or go */
  constructor(public world: CollisionWorld) {}

  /** Eye height for the camera, eased over steps. */
  get eyeY(): number {
    return this.camY;
  }

  /** The ground's height under the walker, eased over steps as the eye is (where a body stands). */
  get groundY(): number {
    return this.camY - this.eye;
  }

  /** Horizontal velocity, metres per second (world x and z). */
  get velocity(): { x: number; z: number } {
    return { x: this.vel.x, z: this.vel.z };
  }

  /** On the ground (not falling). */
  get onGround(): boolean {
    return this.grounded;
  }

  /**
   * Stand on the highest floor below (x, y, z), at most `drop` metres down; on
   * a slope too steep to stand on, slide from there. Returns false, leaving the
   * walker where it was, when there is nothing below.
   */
  place(x: number, y: number, z: number, drop: number): boolean {
    this.world.syncMovers();
    const p = emptyProbe(this.under);
    this.world.probe(x, z, y, y - drop, p);
    if (p.anyY === -Infinity) return false;
    const floor = Math.max(p.walkY, p.anyY);
    this.feet.set(x, floor, z);
    this.vel.setAll(0);
    this.vy = 0;
    this.slideX = this.slideZ = 0;
    this.grounded = p.walkY === floor;
    this.camY = floor + this.eye;
    this.safe.copyFrom(this.feet);
    this.stuckTime = 0;
    this.blockedBy = null;
    this.collide(x, z);
    return true;
  }

  /** Advance by dt with the wanted horizontal velocity (world space, m/s). */
  update(dt: number, wantX: number, wantZ: number): void {
    // the lift car and its doors are where they are this frame (engine/lift.ts moves them first)
    this.world.syncMovers();
    const blend = 1 - Math.exp(-dt * 12);
    this.vel.x += (wantX - this.vel.x) * blend;
    this.vel.z += (wantZ - this.vel.z) * blend;
    const x0 = this.feet.x;
    const z0 = this.feet.z;
    this.contactTri = -1;
    this.contactPush = 0;
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= SUBSTEP) {
      this.acc -= SUBSTEP;
      this.step(SUBSTEP);
    }

    // walking into something: name it once the walker has been held up for a moment
    const want = Math.hypot(wantX, wantZ) * dt;
    const moved = Math.hypot(this.feet.x - x0, this.feet.z - z0);
    if (want > 1e-4 && moved < want * 0.25 && this.contactTri >= 0) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 0.2) {
      const f = this.world.face(this.contactTri);
      this.blockedBy = faceLabel(f.mesh, f.face);
      this.sinceBlocked = 0;
    } else if ((this.sinceBlocked += dt) > 2.5) this.blockedBy = null;

    // ease the eye over steps; follow falls exactly
    const target = this.feet.y + this.eye;
    if (this.grounded && Math.abs(target - this.camY) < 0.6) this.camY += (target - this.camY) * (1 - Math.exp(-dt * 16));
    else this.camY = target;

    // fell out of the world (off the grid, or a long drop): back to the last place stood
    this.safeTimer += dt;
    if (this.grounded && this.safeTimer > 0.5) {
      this.safeTimer = 0;
      this.safe.copyFrom(this.feet);
    }
    if (this.feet.y < this.safe.y - 60) this.place(this.safe.x, this.safe.y + 0.5, this.safe.z, 1);
  }

  private step(h: number) {
    const x0 = this.feet.x;
    const z0 = this.feet.z;
    let x = x0 + (this.vel.x + this.slideX) * h;
    let z = z0 + (this.vel.z + this.slideZ) * h;
    if (!this.world.inside(x, z)) {
      x = x0;
      z = z0;
    }
    this.collide(x, z);

    // ground: the surfaces under the body, walking from step height above the feet
    // down to the snap distance; in the air, from the feet down to this substep's fall
    const top = this.feet.y + (this.grounded ? AVATAR.step : 0.02);
    if (!this.grounded) this.vy = Math.max(this.vy - GRAVITY * h, -40);
    const bottom = this.grounded ? this.feet.y - SNAP_DOWN : this.feet.y + this.vy * h;
    const p = emptyProbe(this.under);
    this.world.probe(this.feet.x, this.feet.z, top, bottom, p);
    // stepping onto a slope too steep to stand on: stay put, as at a wall
    if (this.grounded && p.anyY > Math.max(p.walkY, this.feet.y) + 0.1 && (this.feet.x !== x0 || this.feet.z !== z0)) {
      this.feet.x = x0;
      this.feet.z = z0;
      this.contact(p.anyTri, AVATAR.radius);
      return;
    }
    const r = AVATAR.radius;
    for (let i = 0; i < FOOTPRINT.length; i += 2) this.world.probe(this.feet.x + FOOTPRINT[i] * r, this.feet.z + FOOTPRINT[i + 1] * r, top, bottom, p);
    if (p.walkY > -Infinity) {
      this.feet.y = p.walkY;
      this.vy = 0;
      this.slideX = this.slideZ = 0;
      this.grounded = true;
    } else if (!this.grounded && p.anyY > -Infinity) {
      // on a slope too steep to stand on: slide down it, keeping the fall's speed
      this.feet.y = p.anyY;
      this.slideX = p.downX * SLIDE;
      this.slideZ = p.downZ * SLIDE;
    } else {
      if (this.grounded) this.vy = 0;
      else this.feet.y = bottom;
      this.grounded = false;
    }
  }

  /** Remember the strongest contact of this frame, to name what the walker is walking into. */
  private contact(tri: number, push: number) {
    if (push > this.contactPush) {
      this.contactPush = push;
      this.contactTri = tri;
    }
  }

  /**
   * Move the feet to (x, z) and push the body out of anything it overlaps.
   * The body is a stack of spheres from step height to the top of the head,
   * so anything lower than a step is left to the ground test. Pushes are
   * horizontal only; floor- and ceiling-like contacts are ignored.
   */
  private collide(x: number, z: number) {
    const { radius: r, height, step } = AVATAR;
    const w = this.world;
    const yLo = this.feet.y + step + r;
    const yHi = this.feet.y + height - r;
    const n = Math.max(1, Math.ceil((yHi - yLo) / (r * 0.9)) + 1);
    const pad = r + 0.05;
    w.gather(Math.min(x, this.feet.x) - pad, Math.max(x, this.feet.x) + pad, this.feet.y + step, this.feet.y + height, Math.min(z, this.feet.z) - pad, Math.max(z, this.feet.z) + pad);
    const v = w.verts;
    const cp = this.cp;
    for (let iter = 0; iter < 4; iter++) {
      let pushed = false;
      for (let s = 0; s < n; s++) {
        const cy = n === 1 ? yLo : yLo + ((yHi - yLo) * s) / (n - 1);
        for (let k = 0; k < w.count; k++) {
          const o = k * 9;
          if (Math.min(v[o + 1], v[o + 4], v[o + 7]) > cy + r || Math.max(v[o + 1], v[o + 4], v[o + 7]) < cy - r) continue;
          if (Math.min(v[o], v[o + 3], v[o + 6]) > x + r || Math.max(v[o], v[o + 3], v[o + 6]) < x - r) continue;
          if (Math.min(v[o + 2], v[o + 5], v[o + 8]) > z + r || Math.max(v[o + 2], v[o + 5], v[o + 8]) < z - r) continue;
          closestOnTriangle(x, cy, z, v, o, cp);
          const dx = x - cp[0];
          const dy = cy - cp[1];
          const dz = z - cp[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          const hl = Math.hypot(dx, dz);
          // the centre sits on the triangle, or the contact is straight above or below
          if (d < 1e-6 || hl < 0.3 * d) continue;
          const push = Math.min(r, (r - d) * (d / hl)) + 1e-4;
          x += (dx / hl) * push;
          z += (dz / hl) * push;
          pushed = true;
          this.contact(w.ids[k], push);
        }
      }
      if (!pushed) break;
    }
    this.feet.x = x;
    this.feet.z = z;
  }
}
