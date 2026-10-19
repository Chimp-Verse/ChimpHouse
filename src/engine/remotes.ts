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

import { Scene } from "@babylonjs/core";
import { Materials } from "../world/materials/library";
import { buildRemote } from "../world/props/remote";
import { ROLE } from "../world/roles";
import { FlyCamera } from "./flyCamera";
import { Handhelds } from "./handhelds";
import { Lighting } from "./lighting";
import { VIEWER, store } from "./store";

export class Remotes {
  private hh: Handhelds;

  constructor(
    scene: Scene,
    mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    canvas: HTMLCanvasElement,
    /** shows a short message */
    private flash: (msg: string) => void,
  ) {
    this.hh = new Handhelds(scene, lighting, fly, canvas, ROLE.theatreRemoteSpot, ROLE.theatreRemote, (spot, n) => buildRemote(mats, spot, n));
    store.set({ theatre: { ...store.get().theatre, remotes: this.hh.spots.map(() => null) } });
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
    this.hh.show((n) => s.theatre.remotes[n - 1] !== null);
    if (this.held !== null && !this.hh.inRoom()) {
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
    if (remotes[n - 1] !== null || this.held !== null || !this.hh.inRoom()) return false;
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
    const n = this.hh.clicked(e);
    return n !== null && this.take(n);
  }

  /** What E would do here: take the remote whose spot is looked at, or, holding one, set it down at the stand. */
  private offer(): { action: "take" | "put"; remote: number } | null {
    const n = this.hh.lookedAt()?.n;
    if (n === undefined) return null;
    const held = this.held;
    if (held !== null) return { action: "put", remote: held };
    return store.get().theatre.remotes[n - 1] === null ? { action: "take", remote: n } : null;
  }
}
