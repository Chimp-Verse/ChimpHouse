// Roles: what the client attaches behaviour to. A screen, slot or interactive
// spot carries its role (and slot number) in its metadata, which the Blender
// files will carry as custom properties too, so features find "cabinet slot 3"
// or "the screen of the cabinet in slot 3" the same way whichever built them.

import { Node, Scene } from "@babylonjs/core";
import { MeshMeta, SlotMeta } from "./context";

export const ROLE = {
  /** a place in the Game Room for an admitted game's arcade cabinet */
  cabinetSlot: "cabinet-slot",
  /** the screen of a cabinet: faces -Z, UVs 0..1 across it, its size in `screenSize` */
  cabinetScreen: "cabinet-screen",
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

/** The node with a role and slot number, e.g. find(scene, ROLE.cabinetSlot, 3). */
export function find(scene: Scene, role: string, slot: number): Node | null {
  return nodes(scene).find((n) => (n.metadata as Meta | undefined)?.role === role && (n.metadata as Meta).slot === slot) ?? null;
}

export type SlotNode = Node & { metadata: SlotMeta };
export type ScreenMeta = MeshMeta & { role: string; slot: number; screenSize: [number, number] };
