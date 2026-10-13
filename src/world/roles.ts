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
  /** the lift car: one node that moves between the floors, with its floor-buttons and indicator */
  liftCar: "lift-car",
  /** a landing's call button, numbered with its floor (1 lower, 2 upper) */
  liftCallButton: "lift-call-button",
  /** a button inside the car for a floor, numbered with the floor */
  liftFloorButton: "lift-floor-button",
  /** the car's door-open and door-close buttons */
  liftOpenButton: "lift-open-button",
  liftCloseButton: "lift-close-button",
  /** the indicator above a landing's doors, numbered with its floor: which floor the car is at or going to */
  liftIndicator: "lift-indicator",
  /** the indicator inside the car */
  liftCarIndicator: "lift-car-indicator",
  /** the landing doors of a floor, numbered with it: the left and right leaves */
  liftDoorLeft: "lift-door-left",
  liftDoorRight: "lift-door-right",
  /** the car's own doors, which open with the landing's: the left and right leaves */
  liftCarDoorLeft: "lift-car-door-left",
  liftCarDoorRight: "lift-car-door-right",
  /** the claw machine: its root node, which carries the inside's measurements (props/clawMachine.ts ClawSpec) */
  clawMachine: "claw-machine",
  /** the claw machine's moving parts: the gantry bridge, the trolley on it, the cable and its coiled cord, the claw head and its prongs */
  clawGantry: "claw-gantry",
  clawTrolley: "claw-trolley",
  clawCable: "claw-cable",
  clawCord: "claw-cord",
  clawHead: "claw-head",
  clawProng: "claw-prong",
  /** the claw machine's controls: the joystick, the drop button, the credit and timer display */
  clawJoystick: "claw-joystick",
  clawButton: "claw-button",
  clawDisplay: "claw-display",
  /** the flap of the claw machine's pickup door, hinged along its top */
  clawDoor: "claw-door",
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
