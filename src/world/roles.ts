// Roles: what the client attaches behaviour to. A screen, slot or interactive
// spot carries its role (and slot number) in its metadata, which the Blender
// files will carry as custom properties too, so features find "cabinet slot 3"
// or "the theatre screen" the same way whichever built them.
//
// A screen is a flat quad with UVs 0..1 across it, its front the way its normals
// point. Code reads its corners from the mesh itself (engine/focus.ts), never
// from how a room builds it.

import { Node, Scene } from "@babylonjs/core";
import { MeshMeta, SlotMeta } from "./context";

export const ROLE = {
  /** a place in the Game Room for an admitted game's arcade cabinet */
  cabinetSlot: "cabinet-slot",
  /** the screen of a cabinet, numbered with its slot */
  cabinetScreen: "cabinet-screen",
  /** the theatre's big screen, where YouTube videos and streams play */
  theatreScreen: "theatre-screen",
  /** the "Now Showing" lightbox outside the theatre: what's on the screen */
  theatreLightbox: "theatre-lightbox",
  /** a place on the stand under the theatre screen where a remote is kept, numbered with its remote */
  theatreRemoteSpot: "theatre-remote-spot",
  /** a theatre remote: its holder controls the screen. Put on its spot at run time */
  theatreRemote: "theatre-remote",
} as const;

type Meta = { role?: string; slot?: number };

function nodes(scene: Scene): Node[] {
  return [...scene.transformNodes, ...scene.meshes];
}

/** Every node with a role, in slot order. */
export function findAll(scene: Scene, role: string): Node[] {
  return nodes(scene)
    .filter((n) => (n.metadata as Meta | undefined)?.role === role)
    .sort((a, b) => ((a.metadata as Meta).slot ?? 0) - ((b.metadata as Meta).slot ?? 0));
}

/** The node with a role and slot number, e.g. find(scene, ROLE.cabinetSlot, 3); without a number, the first with the role. */
export function find(scene: Scene, role: string, slot?: number): Node | null {
  return nodes(scene).find((n) => (n.metadata as Meta | undefined)?.role === role && (slot === undefined || (n.metadata as Meta).slot === slot)) ?? null;
}

export type SlotNode = Node & { metadata: SlotMeta };
export type ScreenMeta = MeshMeta & { role: string; slot?: number };
