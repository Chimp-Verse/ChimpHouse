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
  /** a theatre remote in its holder's chimp's hand, numbered with its remote. Built at run time, for each chimp holding one */
  theatreRemoteHeld: "theatre-remote-held",
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
  /** the Game Room's TV, where the players on the couch play a ChimpVibe game together, split-screen */
  gameTvScreen: "game-tv-screen",
  /** a place on the coffee table where a game controller is kept, numbered with its controller (player 1, 2…) */
  gameTvControllerSpot: "game-tv-controller-spot",
  /** a game controller: its holder is a player at the TV. Put on its spot at run time */
  gameTvController: "game-tv-controller",
  /** the place on the coffee table where the TV's remote is kept */
  gameTvRemoteSpot: "game-tv-remote-spot",
  /** the TV's remote: its holder chooses the game. Put on its spot at run time */
  gameTvRemote: "game-tv-remote",
  /** the foosball table's frame: a slot at the playfield's centre (props/foosballSpec.ts), its stand point where red's player stands; blue's is across the table */
  foosballTable: "foosball-table",
  /** the foosball table's playfield: one quad, facing up */
  foosballField: "foosball-field",
  /** the place of a foosball rod, numbered 1-8 from red's goal: its shaft, men and grip are built there at run time */
  foosballRodSlot: "foosball-rod-slot",
  /** a foosball rod's men, bumpers and grip, numbered with its slot */
  foosballRod: "foosball-rod",
  /** a foosball score counter's rod over each end, 1 red's and 2 blue's: its beads are put there at run time */
  foosballCounter: "foosball-counter",
  /** the foosball */
  foosballBall: "foosball-ball",
  /** the air hockey table: a node at its base, its long axis along X, a player at each end */
  airHockeyTable: "air-hockey-table",
  /** the table's playfield inside the rails: a flat quad, facing up, whose bounds are where the puck can go */
  airHockeySurface: "air-hockey-surface",
  /** an end of the table, numbered (1 at -X plays red, 2 at +X blue): its front faces its player, who stands at its stand point */
  airHockeyEnd: "air-hockey-end",
  /** a face of the overhead scoreboard, numbered with the end it faces */
  airHockeyScore: "air-hockey-score",
  /** where a puck put into an end's goal comes back out, numbered with the end: on its puck return's tray */
  airHockeyReturn: "air-hockey-return",
  /** a mallet, numbered with its end, and the puck: put on the table at run time */
  airHockeyMallet: "air-hockey-mallet",
  airHockeyPuck: "air-hockey-puck",
  /** the Game Room's snack machine, a slot at its base (front -Z) with where a visitor stands to use it */
  snackMachine: "snack-machine",
  /** a coil's front end, numbered row * 10 + lane (A1 is 11, E6 is 56): its spiral and snacks are built there at run time */
  snackCoil: "snack-coil",
  /** the coils, one mesh of thin instances built at run time, and a brand's packs, numbered with the brand */
  snackCoils: "snack-coils",
  snackPack: "snack-pack",
  /** a key on the snack machine's keypad, numbered in reading order, its legend the slot's label */
  snackKey: "snack-key",
  /** the snack machine's display, a screen */
  snackDisplay: "snack-display",
  /** the floor of the pickup bin, where a dropped snack lands */
  snackBin: "snack-bin",
  /** the PUSH flap over the bin, hinged at its top edge */
  snackFlap: "snack-flap",
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
  /** a pinball machine's playfield: a node in its plane (x across, y out of it, z up it), numbered with the machine (1 Jungle Quest, 2 Banana Blitz) */
  pinballMachine: "pinball-machine",
  /** a pinball machine's dot-matrix score display in its backbox, numbered with the machine */
  pinballDmd: "pinball-dmd",
  /** a pinball machine's flippers, the ball and the plunger, built at run time on its playfield, numbered with the machine */
  pinballFlipper: "pinball-flipper",
  pinballBall: "pinball-ball",
  pinballPlunger: "pinball-plunger",
  /**
   * The courtyard fountain: a slot at the middle of the basin on the paving, carrying its water's
   * spec (`FountainSpec`, in its own space) in `fountain`: the jets, sheets, water surfaces and
   * spray are built from it at run time (engine/fountain.ts), its sound placed on it
   */
  fountain: "fountain",
  /** where a visitor arrives (engine/preview.ts spawn): a floor point, its front (-Z) the way they face, with open paving all round it */
  spawnPoint: "spawn-point",
  /**
   * A place to sit (engine/seats.ts): a slot on the seat's top where a sitter's hips go, its front (-Z)
   * the way they face, numbered room by room (props/seats.ts), with how it is sat on (`seat`: SeatInfo
   * in context.ts). One per sitter: a sofa has one for each of its places.
   */
  seat: "seat",
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
