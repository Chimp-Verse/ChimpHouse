// The theatre's remotes. Two lie on the stand under the screen. Any visitor can
// pick one up, and whoever holds one controls the theatre: they pause, skip and
// change the video, from their remote's panel (ui/RemotePanel.tsx) or with
// YouTube's player on the screen (engine/theatre.ts). They set it down again at
// the stand, or send it back from anywhere in the theatre; leaving the theatre
// with it sends it back.
//
// Who holds each remote is part of the theatre's state (the store's
// `theatre.remotes`), which the room server owns: taking a remote and setting it
// down are commands (engine/theatreCommands.ts), so a remote is held by one
// visitor at a time, and everyone sees it gone from the stand while it is held.
// It goes back to the stand for everyone when its holder sets it down, leaves
// the theatre, or leaves the house (their page closed, or their connection
// stayed down). While it is held, the holder's chimp has it in its hand.

import { Scene, TransformNode } from "@babylonjs/core";
import { Avatars } from "./avatars";
import { Materials } from "../world/materials/library";
import { buildRemote } from "../world/props/remote";
import { ROLE } from "../world/roles";
import { FlyCamera } from "./flyCamera";
import { Handhelds } from "./handhelds";
import { Lighting } from "./lighting";
import { VIEWER, store } from "./store";
import { Theatre } from "./theatre";
import { holderOf, remoteHeldBy } from "./theatreState";

export class Remotes {
  private hh: Handhelds;
  /** who each remote was last put in the hand of, as "holder,holder" */
  private inHands = "";
  private handed: string[] = [];

  constructor(
    scene: Scene,
    private mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    canvas: HTMLCanvasElement,
    /** the theatre, whose state says who holds each remote, and which runs the commands */
    private theatre: Theatre,
    /** the chimps, which hold the remotes their visitors hold */
    private avatars: Avatars,
    /** shows a short message */
    private flash: (msg: string) => void,
  ) {
    this.hh = new Handhelds(scene, lighting, fly, canvas, ROLE.theatreRemoteSpot, ROLE.theatreRemote, (spot, n) => buildRemote(mats, spot, n));
  }

  /** The remote this visitor holds (1, 2…), or null. */
  get held(): number | null {
    return remoteHeldBy(store.get().theatre, VIEWER);
  }

  /**
   * Each frame: show the remotes that are on the stand, send a held one back
   * when its holder has left the theatre, and offer what E would do here.
   */
  update(): void {
    const s = store.get();
    this.hh.show((n) => holderOf(s.theatre, n) !== null);
    this.toHands(s.theatre.remotes);
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
    if (!this.hh.numbers.includes(n) || holderOf(store.get().theatre, n) !== null || this.held !== null || !this.hh.inRoom()) return false;
    if (this.theatre.tell({ name: "take", args: { remote: n } })) return false;
    store.set({ remotePrompt: null });
    return true;
  }

  /** Put the held remote back on its spot on the stand. */
  putBack(): void {
    if (this.held === null) return;
    this.theatre.tell({ name: "put" });
    store.set({ remotePrompt: null });
  }

  /** A canvas click in walk mode on a remote within reach picks it up. */
  click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().focus) return false;
    const n = this.hh.clicked(e);
    return n !== null && this.take(n);
  }

  /** Each held remote in its holder's chimp's hand, and none in the hands of those who have let go. */
  private toHands(remotes: (string | null)[]): void {
    const key = remotes.join(",");
    if (key === this.inHands) return;
    this.inHands = key;
    const now: string[] = [];
    this.hh.spots.forEach((spot, i) => {
      const n = this.hh.numbers[i];
      const who = remotes[n - 1];
      if (!who) return;
      now.push(who);
      this.avatars.setInHand(who, { key: `theatre-remote-${n}`, build: () => this.inHand(spot, n) });
    });
    for (const who of this.handed) if (!now.includes(who)) this.avatars.setInHand(who, null);
    this.handed = now;
  }

  /** A copy of remote n for a chimp's hand: not one a click picks up (the chimp's hand carries it). */
  private inHand(spot: TransformNode, n: number) {
    return buildRemote(this.mats, spot, n, { label: `Held theatre remote ${n}`, role: ROLE.theatreRemoteHeld });
  }

  /** What E would do here: take the remote whose spot is looked at, or, holding one, set it down at the stand. */
  private offer(): { action: "take" | "put"; remote: number } | null {
    const n = this.hh.lookedAt()?.n;
    if (n === undefined) return null;
    const held = this.held;
    if (held !== null) return { action: "put", remote: held };
    return holderOf(store.get().theatre, n) === null ? { action: "take", remote: n } : null;
  }
}
