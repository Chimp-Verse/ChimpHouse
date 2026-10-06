// The theatre's remotes. Two lie on the stand under the screen. Any visitor can
// pick one up, and whoever holds one controls the theatre: they pause, skip and
// change the video, from their remote's panel (ui/RemotePanel.tsx) or with
// YouTube's player on the screen (engine/theatre.ts). They set it down again at
// the stand, or send it back from anywhere in the theatre; leaving the theatre
// with it sends it back.
//
// Who holds each remote is part of the theatre's state (the store's
// `theatre.remotes`), so the room server can share it later, and pass a remote
// from one visitor to another.

import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { SlotMeta } from "../world/context";
import { roomAt } from "../world/layout";
import { Materials } from "../world/materials/library";
import { Remote, buildRemote } from "../world/props/remote";
import { ROLE, ScreenMeta, findAll } from "../world/roles";
import { FlyCamera } from "./flyCamera";
import { pickAt } from "./focus";
import { Lighting } from "./lighting";
import { VIEWER, store } from "./store";

/** How near a remote's spot a walker's eye must be to take a remote or set one down (m), and how near the middle of the view the spot must be. */
const REACH = 2.0;
const LOOK = Math.cos((30 * Math.PI) / 180);

export class Remotes {
  private spots: TransformNode[];
  private models: Remote[];

  constructor(
    private scene: Scene,
    mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    private canvas: HTMLCanvasElement,
    /** shows a short message */
    private flash: (msg: string) => void,
  ) {
    this.spots = findAll(scene, ROLE.theatreRemoteSpot).filter((n): n is TransformNode => n instanceof TransformNode);
    for (const s of this.spots) s.computeWorldMatrix(true);
    this.models = this.spots.map((s) => buildRemote(mats, s, (s.metadata as SlotMeta).slot));
    for (const m of this.models) lighting.addMeshes(m.meshes, []);
    store.set({ theatre: { ...store.get().theatre, remotes: this.spots.map(() => null) } });
  }

  /** The remote this visitor holds (1, 2…), or null. */
  get held(): number | null {
    const i = store.get().theatre.remotes.indexOf(VIEWER);
    return i < 0 ? null : i + 1;
  }

  /**
   * Each frame: show the remotes that are on the stand, send a held one back
   * when its holder has left the theatre, and offer what E would do here.
   */
  update(): void {
    const s = store.get();
    s.theatre.remotes.forEach((holder, i) => {
      const root = this.models[i]?.root;
      if (root && root.isEnabled(false) !== (holder === null)) root.setEnabled(holder === null);
    });
    if (this.held !== null && !this.inTheatre()) {
      this.putBack();
      this.flash("You left the theatre, so the remote went back to the stand");
    }
    const prompt = !s.focus && s.walking && this.fly.enabled ? this.offer() : null;
    if (prompt?.action !== s.remotePrompt?.action || prompt?.remote !== s.remotePrompt?.remote) store.set({ remotePrompt: prompt });
  }

  /** Do what E offers here: take the remote, or set the held one down. */
  act(): void {
    const p = store.get().remotePrompt;
    if (p?.action === "take") this.take(p.remote);
    else if (p?.action === "put") this.putBack();
  }

  /** Pick up remote n from the stand, from in the theatre and with no remote in hand. */
  take(n: number): boolean {
    const remotes = [...store.get().theatre.remotes];
    if (remotes[n - 1] !== null || this.held !== null || !this.inTheatre()) return false;
    remotes[n - 1] = VIEWER;
    store.set({ theatre: { ...store.get().theatre, remotes }, remotePrompt: null });
    return true;
  }

  /** Put the held remote back on its spot on the stand. */
  putBack(): void {
    const held = this.held;
    if (held === null) return;
    const remotes = [...store.get().theatre.remotes];
    remotes[held - 1] = null;
    store.set({ theatre: { ...store.get().theatre, remotes }, remotePrompt: null });
  }

  /** A canvas click in walk mode on a remote within reach picks it up. */
  click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().focus) return false;
    const hit = pickAt(this.scene, this.canvas, e);
    const md = hit?.mesh.metadata as Partial<ScreenMeta> | undefined;
    if (!hit || md?.role !== ROLE.theatreRemote || md.slot === undefined || hit.distance > REACH + 0.5) return false;
    return this.take(md.slot);
  }

  /** What E would do here: take the remote whose spot is looked at, or, holding one, set it down at the stand. */
  private offer(): { action: "take" | "put"; remote: number } | null {
    const eye = this.fly.camera.position;
    const fwd = this.fly.camera.getDirection(Vector3.Forward());
    let best: { n: number; cos: number } | null = null;
    for (const spot of this.spots) {
      const to = spot.getAbsolutePosition().subtract(eye);
      const d = to.length();
      const cos = Vector3.Dot(fwd, to) / d;
      if (d <= REACH && cos >= LOOK && (!best || cos > best.cos)) best = { n: (spot.metadata as SlotMeta).slot, cos };
    }
    if (!best) return null;
    const held = this.held;
    if (held !== null) return { action: "put", remote: held };
    return store.get().theatre.remotes[best.n - 1] === null ? { action: "take", remote: best.n } : null;
  }

  /** Whether the camera is in the room the remotes belong to. */
  private inTheatre(): boolean {
    const room = (this.spots[0]?.metadata as SlotMeta | undefined)?.room;
    return !!room && roomAt(this.fly.camera.position)?.id === room;
  }
}
