// Things a visitor picks up and puts down again: the theatre's remotes
// (engine/remotes.ts), and the Game Room TV's controllers and remote
// (engine/gameTv.ts). Each is kept on a spot, a slot found by role
// (world/roles.ts), and built there at run time; it shows on its spot while
// nobody holds it. Who holds each is the feature's own state, kept where the
// room server can share it; this finds the spots, shows the models, and says
// which spot a walker is reaching for.

import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { SlotMeta } from "../world/context";
import { roomAt } from "../world/layout";
import { ScreenMeta, findAll } from "../world/roles";
import { FlyCamera } from "./flyCamera";
import { pickAt } from "./focus";
import { Lighting } from "./lighting";

/** How near a spot a walker's eye must be to take what is on it or set it down (m), and how near the middle of the view the spot must be. */
const REACH = 2.0;
const LOOK = Math.cos((30 * Math.PI) / 180);

/** A model on a spot: its root (shown while nobody holds it) and meshes. */
export interface HandheldModel {
  root: TransformNode;
  meshes: Mesh[];
}

export class Handhelds {
  readonly spots: TransformNode[];
  private models: HandheldModel[];

  constructor(
    private scene: Scene,
    lighting: Lighting,
    private fly: FlyCamera,
    private canvas: HTMLCanvasElement,
    /** the spots' role */
    spotRole: string,
    /** the role carried by the models' meshes, which a click picks */
    private itemRole: string,
    build: (spot: TransformNode, n: number) => HandheldModel,
  ) {
    this.spots = findAll(scene, spotRole).filter((n): n is TransformNode => n instanceof TransformNode);
    for (const s of this.spots) s.computeWorldMatrix(true);
    this.models = this.spots.map((s) => {
      const m = build(s, (s.metadata as SlotMeta).slot);
      lighting.addMeshes(m.meshes, []);
      return m;
    });
  }

  /** The spots' numbers, in order. */
  get numbers(): number[] {
    return this.spots.map((s) => (s.metadata as SlotMeta).slot);
  }

  /** The room the spots are in. */
  get room(): string | null {
    return (this.spots[0]?.metadata as SlotMeta | undefined)?.room ?? null;
  }

  /** Show each model on its spot while nobody holds it: `held(n)` says whether thing n is held. */
  show(held: (n: number) => boolean): void {
    this.spots.forEach((s, i) => {
      const root = this.models[i]?.root;
      const on = !held((s.metadata as SlotMeta).slot);
      if (root && root.isEnabled(false) !== on) root.setEnabled(on);
    });
  }

  /** The spot a walker is reaching for: within reach and nearest the middle of their view (`cos`, of the angle off it); or null. */
  lookedAt(): { n: number; cos: number } | null {
    const eye = this.fly.camera.position;
    const fwd = this.fly.camera.getDirection(Vector3.Forward());
    let best: { n: number; cos: number } | null = null;
    for (const spot of this.spots) {
      const to = spot.getAbsolutePosition().subtract(eye);
      const d = to.length();
      const cos = Vector3.Dot(fwd, to) / d;
      if (d <= REACH && cos >= LOOK && (!best || cos > best.cos)) best = { n: (spot.metadata as SlotMeta).slot, cos };
    }
    return best;
  }

  /** The number of the thing a canvas click is on, when it is within reach; or null. */
  clicked(e: MouseEvent): number | null {
    const hit = pickAt(this.scene, this.canvas, e);
    const md = hit?.mesh.metadata as Partial<ScreenMeta> | undefined;
    if (!hit || md?.role !== this.itemRole || md.slot === undefined || hit.distance > REACH + 0.5) return null;
    return md.slot;
  }

  /** Whether the camera is in the spots' room. */
  inRoom(): boolean {
    const room = this.room;
    return !!room && roomAt(this.fly.camera.position)?.id === room;
  }
}
