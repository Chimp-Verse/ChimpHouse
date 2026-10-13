// The foosball table's dimensions and rod layout: plain numbers, no Babylon, so the
// model (props/foosball.ts) and the ball's physics (engine/foosballPhysics.ts) are
// built from the same table.
//
// The table's own frame: origin on the playfield's surface at its centre, X along
// the table from red's goal (-X) to blue's (+X), Z across it along the rods, Y up.
// Red's handles are on the -Z side and blue's on +Z, so each player, standing at
// their handles, attacks to their right.

export type Team = "red" | "blue";

export interface RodSpec {
  /** where the rod crosses the table */
  x: number;
  team: Team;
  /** its men, and the distance between neighbours */
  men: number;
  spacing: number;
  /** how far it slides either way from the middle, before its bumpers meet the walls */
  travel: number;
  /** goalie, defence (2-bar), midfield (5-bar) or attack (3-bar) */
  name: "goalie" | "defence" | "midfield" | "attack";
}

/** The playfield: length (goal line to goal line), width (wall to wall), its height above the floor. */
export const FIELD = { length: 1.2, width: 0.68, y: 0.79 } as const;

/** Height of the rods' axes above the playfield, and of the walls' tops. */
export const ROD_Y = 0.085;
export const WALL_TOP = 0.13;

/** The goal mouth in each end wall: half its width, and its height. */
export const GOAL = { half: 0.1, height: 0.075 } as const;

/** Thickness of the long side walls (the rods pass through them) and of the end walls. */
export const SIDE_WALL = 0.05;
export const END_WALL = 0.1;

/** The ball: 35 mm across. */
export const BALL_R = 0.0175;

/**
 * A man, hanging from his rod: the rod passes through his chest. Measured from
 * the rod's axis along his body: his toe hangs `toe` below it (just clear of the
 * field) and his head reaches `head` above; `halfWidth` is half his width along
 * the rod, `thick` half his thickness front to back.
 */
export const MAN = { toe: 0.078, head: 0.052, halfWidth: 0.013, thick: 0.009 } as const;

/** The eight rods from red's goal end, slot 1 to 8: goalie, defence, then the 3- and 5-bars alternating. */
export const RODS: readonly RodSpec[] = [
  { x: -0.525, team: "red", men: 1, spacing: 0, travel: 0.2, name: "goalie" },
  { x: -0.375, team: "red", men: 2, spacing: 0.24, travel: 0.19, name: "defence" },
  { x: -0.225, team: "blue", men: 3, spacing: 0.2, travel: 0.11, name: "attack" },
  { x: -0.075, team: "red", men: 5, spacing: 0.12, travel: 0.07, name: "midfield" },
  { x: 0.075, team: "blue", men: 5, spacing: 0.12, travel: 0.07, name: "midfield" },
  { x: 0.225, team: "red", men: 3, spacing: 0.2, travel: 0.11, name: "attack" },
  { x: 0.375, team: "blue", men: 2, spacing: 0.24, travel: 0.19, name: "defence" },
  { x: 0.525, team: "blue", men: 1, spacing: 0, travel: 0.2, name: "goalie" },
];

/** Where man k of a rod is along it (Z) with the rod in the middle of its travel. */
export function manZ(rod: RodSpec, k: number): number {
  return (k - (rod.men - 1) / 2) * rod.spacing;
}

/** Which side a team's handles are on (Z), and which way it attacks (X). */
export const SIDE: Record<Team, number> = { red: -1, blue: 1 };
export const ATTACK: Record<Team, number> = { red: 1, blue: -1 };

/** Matches are played to this many goals. */
export const WIN_SCORE = 5;

/** The far end of a rod sticks out past its wall by this much more than its travel, and its grip starts as far out on the handle side. */
export const ROD_CLEAR = 0.04;
/** The grip's length and radius. */
export const GRIP = { length: 0.13, r: 0.017 } as const;
