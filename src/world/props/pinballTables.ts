// The two pinball tables in the Game Room: JUNGLE QUEST and BANANA BLITZ. Each
// is one definition, read both by the model (props/pinball.ts) and by the
// physics and rules (engine/pinballPhysics.ts, engine/pinballRules.ts), so what
// you see under the glass is exactly what the ball hits. Pure data: no Babylon.
//
// Playfield coordinates, in metres: x across the playfield (-0.26 at the left
// wall, +0.26 at the right, as the player sees it), y up the playfield from its
// front edge (0) to the top of the arch (1.07), and h above its surface. The
// playfield is 0.52 m by 1.07 m and leans back at 6.5°, as a real one does; the
// ball is 27 mm across.

export type V2 = readonly [number, number];

/** What a wall is made of: how lively a bounce off it is, and how it is drawn. */
export type WallMat = "wood" | "metal" | "rubber";

export interface Wall {
  pts: V2[];
  /** a closed outline (a solid block) rather than a line */
  closed?: boolean;
  mat: WallMat;
  /** half its thickness: the ball's centre keeps r + t from the line */
  t?: number;
  /** how it is drawn: a painted wooden or plastic block, a steel rail, a rubber band, or not at all (the cabinet's own wall) */
  look: "block" | "rail" | "rubber" | "none";
  /** a block's colour */
  color?: string;
  h?: number;
}

/** A post with a rubber ring round it. */
export interface Post {
  at: V2;
  r: number;
}

export interface Bumper {
  id: string;
  at: V2;
  /** the skirt's radius, where it kicks */
  r: number;
  /** the cap's lamp */
  lamp: string;
}

/** A slingshot: a rubber triangle that kicks off its inner face, t to c. */
export interface Sling {
  id: string;
  /** top, bottom-outer and bottom-inner corners */
  t: V2;
  b: V2;
  c: V2;
}

export interface Flipper {
  id: string;
  pivot: V2;
  /** pivot to tip centre, and the radii of its round base and tip (rubber included) */
  len: number;
  r1: number;
  r2: number;
  /** angles from +x, radians: at rest and fully up */
  rest: number;
  up: number;
  button: "L" | "R";
}

/** A target: a face from a to b that scores when hit. A drop target drops out of the way. */
export interface Target {
  id: string;
  a: V2;
  b: V2;
  drop?: boolean;
  color: string;
  lamp?: string;
}

/** A rollover switch the ball passes over (a wire in a lane, or a star). */
export interface Rollover {
  id: string;
  at: V2;
  look: "wire" | "star";
  lamp?: string;
}

/** A spinner hung across a lane from a to b: each pass sets it spinning, faster the faster the ball. */
export interface Spinner {
  id: string;
  a: V2;
  b: V2;
}

/** A saucer: a shallow cup that catches a slow enough ball, holds it and kicks it out with velocity `eject`. */
export interface Scoop {
  id: string;
  at: V2;
  eject: V2;
  lamp?: string;
}

/** A one-way gate from a to b: the ball passes moving along `dir`, and bounces off it the other way. */
export interface Gate {
  a: V2;
  b: V2;
  dir: V2;
}

/**
 * A ramp: the ball goes in across its mouth (a to b, moving `in`) and then runs
 * along `path` (x, y, h), slowed by climbing; too slow and it rolls back out of
 * the mouth. It leaves at the path's end, back on the playfield.
 */
export interface Ramp {
  id: string;
  mouth: [V2, V2];
  path: [number, number, number][];
  /** from the mouth this far along, a clear plastic ramp; after it, a wire return */
  plastic: number;
}

/** A kickback: a ball over it while it is lit is fired back up at `v`. */
export interface Kickback {
  id: string;
  at: V2;
  v: V2;
  lamp: string;
}

/** A lamp under the playfield: a coloured plastic insert, lit or not by the rules. */
export interface Insert {
  lamp: string;
  at: V2;
  shape: "circle" | "arrow" | "tri" | "rect" | "star" | "oval";
  /** across, m */
  size: number;
  /** turn, radians: an arrow points along +y turned by this */
  rot?: number;
  color: string;
  /** printed on the playfield beside it */
  label?: string;
  /** where the label goes, relative to the insert */
  labelAt?: V2;
  /** a lamp above the playfield (on a slingshot's plastic), its height */
  h?: number;
}

export interface Theme {
  /** cabinet and backbox paint, its trim and the legs' finish */
  body: string;
  body2: string;
  trim: string;
  legs: "chrome" | "black";
  /** playfield and art colours */
  field: [string, string, string];
  accent: string;
  accent2: string;
  /** the DMD's dot colour */
  dmd: string;
  /** colours of the lane guides and blocks */
  plastic: string;
  rubber: string;
}

export interface TableDef {
  id: "jungleQuest" | "bananaBlitz";
  /** the machine's slot number (role pinball-machine) */
  slot: number;
  title: string;
  theme: Theme;
  walls: Wall[];
  posts: Post[];
  bumpers: Bumper[];
  slings: Sling[];
  flippers: Flipper[];
  targets: Target[];
  rollovers: Rollover[];
  spinners: Spinner[];
  scoops: Scoop[];
  gates: Gate[];
  ramps: Ramp[];
  kickbacks: Kickback[];
  inserts: Insert[];
  /** short lines printed on the playfield (shot names), at a point, turned */
  prints: { text: string; at: V2; rot?: number; size: number; color?: string }[];
}

// ---------------------------------------------------------------- shared measures

export const PF = {
  /** playfield width and length, m */
  w: 0.52,
  l: 1.07,
  /** the lean, radians */
  slope: (6.5 * Math.PI) / 180,
  /** the ball's radius, m */
  ball: 0.0135,
  /** the centre line of the flippers and the lanes, left of the middle to make room for the shooter lane */
  cx: -0.022,
  /** the apron covers the playfield below this; a ball below `drain` (left of the shooter lane) has drained */
  apron: 0.12,
  drain: 0.09,
  /** the shooter lane: its centre, the plunger tip at rest, and how far the plunger pulls back */
  shooterX: 0.241,
  plungerY: 0.045,
  plungerPull: 0.06,
  /** the shooter lane's inner wall */
  shooterWall: 0.219,
  /** top of the shooter lane's wall, where the ball comes out under the arch */
  shooterTop: 0.79,
  /** the arch at the top: centre height and radius */
  archY: 0.8,
  archR: 0.26,
} as const;

/** Mirror a point about the flippers' centre line. */
const mx = ([x, y]: V2): V2 => [2 * PF.cx - x, y];
const mpts = (pts: V2[]) => pts.map(mx).reverse();

/** Points round an arc (centre, radius, from a0 to a1 radians). */
export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** The cabinet's own walls round the playfield: up the right side, over the arch, down the left. */
function outerWall(): Wall {
  return { pts: [[0.26, 0.0], [0.26, PF.archY], ...arcPts(0, PF.archY, PF.archR, 0, Math.PI, 48).slice(1), [-0.26, 0.0]], mat: "wood", look: "none" };
}

/**
 * The lower playfield both tables share, as on most real machines: two
 * flippers, an inlane and an outlane each side, the slingshots above the
 * inlanes, and the shooter lane up the right with a one-way gate at its top.
 */
function lower(theme: Theme): Pick<TableDef, "walls" | "posts" | "slings" | "flippers" | "rollovers" | "gates"> {
  // the left inlane guide: a solid block between the outlane and the inlane, its nose over the
  // flipper's base, as on a real machine, so a ball rolls onto the flipper (and cradles on it) rather
  // than resting on its pivot
  const guideL: V2[] = [[-0.221, PF.apron - 0.02], [-0.135, PF.apron - 0.02], [-0.135, 0.175], [-0.122, 0.186], [-0.111, 0.191], [-0.129, 0.2], [-0.21, 0.302], [-0.21, 0.397], [-0.221, 0.397]];
  const slingL: Sling = { id: "slingL", t: [-0.172, 0.385], b: [-0.172, 0.31], c: [-0.137, 0.266] };
  const slingR: Sling = { id: "slingR", t: mx(slingL.t), b: mx(slingL.b), c: mx(slingL.c) };
  const flipper = (side: "L" | "R"): Flipper => {
    const s = side === "L" ? 1 : -1;
    const rest = (-30 * Math.PI) / 180;
    const up = (26 * Math.PI) / 180;
    return {
      id: `flipper${side}`,
      pivot: [PF.cx - s * 0.0934, 0.17],
      len: 0.068,
      r1: 0.013,
      r2: 0.0075,
      rest: side === "L" ? rest : Math.PI - rest,
      up: side === "L" ? up : Math.PI - up,
      button: side,
    };
  };
  return {
    walls: [
      outerWall(),
      { pts: guideL, closed: true, mat: "wood", look: "block", color: theme.plastic },
      { pts: mpts(guideL), closed: true, mat: "wood", look: "block", color: theme.plastic },
      // the shooter lane's wall, up to where the ball comes out under the arch
      { pts: [[PF.shooterWall, 0.0], [PF.shooterWall, PF.shooterTop]], mat: "wood", t: 0.003, look: "rail" },
    ],
    posts: [
      { at: [-0.2155, 0.4], r: 0.0058 },
      { at: mx([-0.2155, 0.4]), r: 0.0058 },
    ],
    slings: [slingL, slingR],
    flippers: [flipper("L"), flipper("R")],
    rollovers: [
      { id: "outlaneL", at: [-0.2405, 0.3], look: "wire", lamp: "outlaneL" },
      { id: "inlaneL", at: [-0.191, 0.35], look: "wire", lamp: "inlaneL" },
      { id: "inlaneR", at: mx([-0.191, 0.35]), look: "wire", lamp: "inlaneR" },
      { id: "outlaneR", at: mx([-0.2405, 0.3]), look: "wire", lamp: "outlaneR" },
    ],
    gates: [{ a: [0.26, 0.815], b: [PF.shooterWall, 0.788], dir: [0, 1] }],
  };
}

/** The inserts both tables have: shoot again, the lane lamps, and a lamp on each slingshot's plastic that flashes as it fires. */
function lowerInserts(theme: Theme): Insert[] {
  const sling = (id: string, c: V2): Insert => ({ lamp: id, at: c, shape: "oval", size: 0.03, rot: 0, color: theme.accent, h: 0.0475 });
  return [
    sling("slingL", [-0.16, 0.32]),
    sling("slingR", mx([-0.16, 0.32])),
    { lamp: "shootAgain", at: [PF.cx, 0.215], shape: "oval", size: 0.03, color: "#ff3b3b", label: "SHOOT AGAIN", labelAt: [0, -0.024] },
    { lamp: "outlaneL", at: [-0.2405, 0.255], shape: "circle", size: 0.016, color: "#ffffff" },
    { lamp: "inlaneL", at: [-0.191, 0.3], shape: "circle", size: 0.016, color: "#ffffff" },
    { lamp: "inlaneR", at: mx([-0.191, 0.3]), shape: "circle", size: 0.016, color: "#ffffff" },
    { lamp: "outlaneR", at: mx([-0.2405, 0.255]), shape: "circle", size: 0.016, color: "#ffffff" },
  ];
}

/** The right orbit: a lane up beside the shooter lane, round the arch and down the far side; its entrance funnels in from the left. */
function rightOrbitWall(top: number): Wall {
  return { pts: [[0.163, 0.44], [0.177, 0.495], [0.177, top]], mat: "wood", t: 0.003, look: "rail" };
}

// ---------------------------------------------------------------- JUNGLE QUEST

/**
 * JUNGLE QUEST: an explorer's table, in deep jungle greens, temple stone and
 * gold. A left ramp climbs to the temple and returns down a wire to the left
 * inlane; three pop bumpers sit under three top lanes (T-E-M); the IDOL drop
 * targets guard the right; the TEMPLE scoop starts quests (timed modes); a
 * kickback saves the left outlane. One ball at a time.
 */
export function jungleQuest(): TableDef {
  const theme: Theme = {
    body: "#123d2c",
    body2: "#0b241b",
    trim: "#d9a93a",
    legs: "black",
    field: ["#0c3326", "#1f6b45", "#c9a25a"],
    accent: "#ffcf3a",
    accent2: "#3fe08f",
    dmd: "#ff8a1e",
    plastic: "#2c6e4a",
    rubber: "#151515",
  };
  const base = lower(theme);
  const mouth: [V2, V2] = [[-0.162, 0.519], [-0.118, 0.541]];
  // the ramp's flap on the playfield, behind its mouth: solid to a ball on the playfield
  const flap: V2[] = [mouth[1], [-0.1405, 0.5855], [-0.1845, 0.5635], mouth[0]];
  const dropA: V2 = [0.0985, 0.509];
  const dropB: V2 = [0.1615, 0.471];
  const drops: Target[] = [0, 1, 2].map((i) => {
    const t0 = (i * 0.026 + 0.002) / 0.074;
    const t1 = (i * 0.026 + 0.024) / 0.074;
    const L = (t: number): V2 => [dropA[0] + (dropB[0] - dropA[0]) * t - 0.52 * 0.004, dropA[1] + (dropB[1] - dropA[1]) * t - 0.85 * 0.004];
    return { id: `idol${i + 1}`, a: L(t0), b: L(t1), drop: true, color: "#e8c34a", lamp: `idol${i + 1}` };
  });
  return {
    id: "jungleQuest",
    slot: 1,
    title: "JUNGLE QUEST",
    theme,
    walls: [
      ...base.walls,
      rightOrbitWall(0.74),
      // the ramp's flap: three sides solid, the mouth open
      { pts: flap, mat: "wood", t: 0.002, look: "none" },
      // the IDOL targets' housing, its top sloping so a ball can't rest on it
      { pts: [dropA, dropB, [0.172, 0.475], [0.177, 0.495], [0.177, 0.565], [0.106, 0.527]], closed: true, mat: "wood", look: "block", color: "#5b4a33" },
      // the top lanes' guides
      ...[-0.105, -0.05, 0.005, 0.06].map((x): Wall => ({ pts: [[x, 0.878], [x, 0.935]], mat: "metal", t: 0.0035, look: "rail" })),
      // a rubber at the left wall, turning a ball coming down it toward the inlane
      { pts: [[-0.26, 0.505], [-0.24, 0.46]], mat: "rubber", t: 0.004, look: "rubber" },
    ],
    posts: [...base.posts, { at: [0.163, 0.44], r: 0.0055 }, { at: [0.177, 0.74], r: 0.0055 }, { at: [-0.24, 0.46], r: 0.005 }],
    bumpers: [
      { id: "bumper1", at: [-0.085, 0.79], r: 0.031, lamp: "bumper1" },
      { id: "bumper2", at: [0.035, 0.8], r: 0.031, lamp: "bumper2" },
      { id: "bumper3", at: [-0.025, 0.715], r: 0.031, lamp: "bumper3" },
    ],
    slings: base.slings,
    flippers: base.flippers,
    targets: drops,
    rollovers: [
      ...base.rollovers,
      { id: "laneT", at: [-0.0775, 0.905], look: "wire", lamp: "laneT" },
      { id: "laneE", at: [-0.0225, 0.905], look: "wire", lamp: "laneE" },
      { id: "laneM", at: [0.0325, 0.905], look: "wire", lamp: "laneM" },
      { id: "orbit", at: [0.1965, 0.5], look: "star", lamp: "orbit" },
    ],
    spinners: [],
    scoops: [{ id: "temple", at: [0.075, 0.625], eject: [-0.42, -1.05], lamp: "temple" }],
    gates: base.gates,
    ramps: [
      {
        id: "temple",
        mouth,
        plastic: 0.24,
        path: [
          [-0.14, 0.53, 0.0],
          [-0.1625, 0.575, 0.01],
          [-0.183, 0.64, 0.03],
          [-0.194, 0.71, 0.048],
          [-0.19, 0.772, 0.058],
          [-0.2, 0.802, 0.063],
          [-0.222, 0.808, 0.064],
          [-0.238, 0.785, 0.063],
          [-0.242, 0.7, 0.058],
          [-0.24, 0.58, 0.05],
          [-0.236, 0.49, 0.044],
          [-0.228, 0.432, 0.038],
          [-0.212, 0.398, 0.018],
          [-0.192, 0.372, 0.0],
        ],
      },
    ],
    kickbacks: [{ id: "kickback", at: [-0.2405, 0.205], v: [0.0, 2.9], lamp: "kickback" }],
    inserts: [
      ...lowerInserts(theme),
      { lamp: "kickback", at: [-0.2405, 0.17], shape: "tri", size: 0.022, color: "#ffcf3a", label: "KICK", labelAt: [0, -0.025] },
      // the shots: arrows pointing at them
      { lamp: "rampArrow", at: [-0.118, 0.47], shape: "arrow", size: 0.03, rot: 0.47, color: "#ffcf3a", label: "TEMPLE RAMP", labelAt: [0.0, -0.032] },
      { lamp: "templeArrow", at: [0.045, 0.545], shape: "arrow", size: 0.03, rot: -0.33, color: "#ff3b3b", label: "TEMPLE", labelAt: [0.0, -0.032] },
      { lamp: "orbitArrow", at: [0.155, 0.395], shape: "arrow", size: 0.028, rot: -0.12, color: "#3fe08f", label: "RIVER", labelAt: [-0.004, -0.03] },
      { lamp: "idolArrow", at: [0.088, 0.43], shape: "arrow", size: 0.026, rot: -0.55, color: "#e8c34a" },
      // the quests, round the centre
      { lamp: "quest1", at: [-0.07, 0.385], shape: "circle", size: 0.022, color: "#3fe08f", label: "VINE", labelAt: [0, -0.022] },
      { lamp: "quest2", at: [-0.035, 0.41], shape: "circle", size: 0.022, color: "#ff8a1e", label: "SNAKE", labelAt: [0, -0.022] },
      { lamp: "quest3", at: [0.0, 0.41], shape: "circle", size: 0.022, color: "#e8c34a", label: "IDOL", labelAt: [0, -0.022] },
      { lamp: "quest4", at: [0.035, 0.385], shape: "circle", size: 0.022, color: "#40b8ff", label: "RIVER", labelAt: [0, -0.022] },
      { lamp: "king", at: [-0.0175, 0.47], shape: "star", size: 0.04, color: "#ffffff", label: "JUNGLE KING", labelAt: [0, -0.03] },
      // the bonus multiplier
      { lamp: "x2", at: [-0.075, 0.29], shape: "circle", size: 0.017, color: "#ffcf3a", label: "2X" , labelAt: [0, -0.017] },
      { lamp: "x3", at: [-0.042, 0.305], shape: "circle", size: 0.017, color: "#ffcf3a", label: "3X", labelAt: [0, -0.017] },
      { lamp: "x4", at: [-0.002, 0.305], shape: "circle", size: 0.017, color: "#ffcf3a", label: "4X", labelAt: [0, -0.017] },
      { lamp: "x5", at: [0.031, 0.29], shape: "circle", size: 0.017, color: "#ffcf3a", label: "5X", labelAt: [0, -0.017] },
      // the IDOL targets' lamps, in front of them
      { lamp: "idol1", at: [0.083, 0.485], shape: "rect", size: 0.012, rot: -0.55, color: "#e8c34a" },
      { lamp: "idol2", at: [0.105, 0.471], shape: "rect", size: 0.012, rot: -0.55, color: "#e8c34a" },
      { lamp: "idol3", at: [0.127, 0.457], shape: "rect", size: 0.012, rot: -0.55, color: "#e8c34a" },
      // the top lanes
      { lamp: "laneT", at: [-0.0775, 0.955], shape: "circle", size: 0.018, color: "#ffffff", label: "T", labelAt: [0, 0.0] },
      { lamp: "laneE", at: [-0.0225, 0.955], shape: "circle", size: 0.018, color: "#ffffff", label: "E", labelAt: [0, 0.0] },
      { lamp: "laneM", at: [0.0325, 0.955], shape: "circle", size: 0.018, color: "#ffffff", label: "M", labelAt: [0, 0.0] },
      { lamp: "temple", at: [0.075, 0.6], shape: "oval", size: 0.02, color: "#ff3b3b" },
      { lamp: "orbit", at: [0.1965, 0.53], shape: "circle", size: 0.014, color: "#3fe08f" },
    ],
    prints: [
      { text: "IDOL", at: [0.15, 0.53], rot: -0.55, size: 0.014, color: "#ffe9a8" },
      { text: "SNAKE PIT", at: [-0.025, 0.665], size: 0.013 },
    ],
  };
}

// ---------------------------------------------------------------- BANANA BLITZ

/**
 * BANANA BLITZ: a party table in hot pink, purple and banana yellow. Three
 * flippers: an upper-left flipper fed from the bumper pit. A spinner in the
 * right orbit, two pop bumpers up in the pit, B-A-N-A-N-A standup targets, and
 * the MONKEY MOUTH: spell BANANA to light the lock, lock two balls there, and
 * the third shot starts three-ball BLITZ MULTIBALL, the mouth then scoring
 * jackpots. Back-to-back shots score combos.
 */
export function bananaBlitz(): TableDef {
  const theme: Theme = {
    body: "#d6267a",
    body2: "#4a1466",
    trim: "#ffd23a",
    legs: "chrome",
    field: ["#3a0f55", "#c2186f", "#ffcf2e"],
    accent: "#ffd23a",
    accent2: "#38e8ff",
    dmd: "#ff5fb4",
    plastic: "#7b2fb8",
    rubber: "#f2f2f2",
  };
  const base = lower(theme);
  // the upper-left flipper, and the block behind it on the left wall
  const upper: Flipper = { id: "flipperU", pivot: [-0.214, 0.6], len: 0.06, r1: 0.012, r2: 0.007, rest: (-28 * Math.PI) / 180, up: (24 * Math.PI) / 180, button: "L" };
  // the BAN bank, below the bumper pit, facing the right flipper
  const banC: V2 = [-0.105, 0.735];
  const bdir: V2 = [0.97, 0.24];
  const bn: V2 = [0.24, -0.97];
  const ban: Target[] = [0, 1, 2].map((i) => {
    const s0 = -0.037 + i * 0.026 + 0.002;
    const s1 = s0 + 0.022;
    const P = (s: number): V2 => [banC[0] + bdir[0] * s + bn[0] * 0.004, banC[1] + bdir[1] * s + bn[1] * 0.004];
    return { id: `banana${i + 1}`, a: P(s0), b: P(s1), color: "#ffd23a", lamp: `banana${i + 1}` };
  });
  const banBlock: V2[] = [
    [banC[0] - bdir[0] * 0.04, banC[1] - bdir[1] * 0.04],
    [banC[0] + bdir[0] * 0.04, banC[1] + bdir[1] * 0.04],
    [banC[0] + bdir[0] * 0.04 - bn[0] * 0.018, banC[1] + bdir[1] * 0.04 - bn[1] * 0.018],
    [banC[0] - bdir[0] * 0.04 - bn[0] * 0.018, banC[1] - bdir[1] * 0.04 - bn[1] * 0.018],
  ];
  // the ANA bank, on the left face of the right orbit's wall
  const ana: Target[] = [0, 1, 2].map((i) => ({ id: `banana${i + 4}`, a: [0.1712, 0.6 + i * 0.032], b: [0.1712, 0.624 + i * 0.032], color: "#ffd23a", lamp: `banana${i + 4}` }));
  return {
    id: "bananaBlitz",
    slot: 2,
    title: "BANANA BLITZ",
    theme,
    walls: [
      ...base.walls,
      rightOrbitWall(0.76),
      // the block behind the upper flipper
      { pts: [[-0.26, 0.548], [-0.2275, 0.59], [-0.2235, 0.614], [-0.26, 0.642]], closed: true, mat: "wood", look: "block", color: theme.plastic },
      { pts: banBlock, closed: true, mat: "wood", look: "block", color: "#3a0f55" },
      // the ANA bank's backing on the orbit wall
      { pts: [[0.1712, 0.596], [0.1712, 0.692]], mat: "wood", t: 0.002, look: "none" },
      // the MONKEY MOUTH's horseshoe: a back wall round the saucer, open toward the flippers
      { pts: arcPts(0.03, 0.745, 0.034, -0.25, Math.PI + 0.25, 14), mat: "metal", t: 0.003, look: "rail" },
    ],
    posts: [...base.posts, { at: [0.163, 0.44], r: 0.0055 }, { at: [0.177, 0.76], r: 0.0055 }],
    bumpers: [
      { id: "bumper1", at: [-0.135, 0.85], r: 0.031, lamp: "bumper1" },
      { id: "bumper2", at: [-0.055, 0.905], r: 0.031, lamp: "bumper2" },
    ],
    slings: base.slings,
    flippers: [...base.flippers, upper],
    targets: [...ban, ...ana],
    rollovers: [...base.rollovers, { id: "orbitTop", at: [0.0, 1.043], look: "star", lamp: "orbitTop" }],
    spinners: [{ id: "spinner", a: [0.1805, 0.585], b: [0.2155, 0.585] }],
    scoops: [{ id: "mouth", at: [0.03, 0.75], eject: [-0.3, -1.05], lamp: "mouth" }],
    gates: base.gates,
    ramps: [],
    kickbacks: [],
    inserts: [
      ...lowerInserts(theme),
      { lamp: "spinArrow", at: [0.142, 0.425], shape: "arrow", size: 0.03, rot: -0.12, color: "#38e8ff", label: "SPIN", labelAt: [-0.002, -0.032] },
      { lamp: "mouthArrow", at: [0.022, 0.6], shape: "arrow", size: 0.034, rot: -0.05, color: "#ff3b8f", label: "MONKEY MOUTH", labelAt: [0, -0.036] },
      { lamp: "lock", at: [0.022, 0.665], shape: "rect", size: 0.022, color: "#ffd23a", label: "LOCK", labelAt: [0.04, 0.0] },
      { lamp: "jackpot", at: [0.022, 0.535], shape: "star", size: 0.036, color: "#ffffff", label: "JACKPOT", labelAt: [0, -0.03] },
      { lamp: "pitArrow", at: [-0.155, 0.69], shape: "arrow", size: 0.026, rot: 0.55, color: "#ffd23a" },
      ...[0, 1, 2, 3, 4, 5].map((i): Insert => ({ lamp: `banana${i + 1}`, at: [-0.105 + i * 0.033, 0.33 + (i === 0 || i === 5 ? 0 : i === 1 || i === 4 ? 0.014 : 0.02)], shape: "circle", size: 0.022, color: "#ffd23a", label: "BANANA"[i], labelAt: [0, 0] })),
      { lamp: "combo2", at: [-0.07, 0.43], shape: "tri", size: 0.02, color: "#38e8ff", label: "2X", labelAt: [0, -0.02] },
      { lamp: "combo3", at: [-0.035, 0.45], shape: "tri", size: 0.02, color: "#38e8ff", label: "3X", labelAt: [0, -0.02] },
      { lamp: "combo4", at: [0.0, 0.45], shape: "tri", size: 0.02, color: "#38e8ff", label: "4X", labelAt: [0, -0.02] },
      { lamp: "combo5", at: [0.035, 0.43], shape: "tri", size: 0.02, color: "#38e8ff", label: "5X", labelAt: [0, -0.02] },
      { lamp: "orbitTop", at: [0.0, 1.012], shape: "circle", size: 0.016, color: "#ffffff" },
      { lamp: "mouth", at: [0.03, 0.722], shape: "oval", size: 0.018, color: "#ff3b8f" },
    ],
    prints: [
      { text: "BANANA", at: [0.193, 0.65], rot: Math.PI / 2, size: 0.013, color: "#ffe86a" },
      { text: "PIT", at: [-0.1, 0.94], size: 0.014, color: "#ffe86a" },
    ],
  };
}

export const TABLES: TableDef[] = [jungleQuest(), bananaBlitz()];

/**
 * A ramp's path smoothed through its points (Catmull-Rom, `per` points to a
 * span): the line the ball's contact point follows, shared by the model and the
 * physics so the ball runs exactly on the ramp you see.
 */
export function rampCurve(r: Ramp, per = 8): [number, number, number][] {
  const p = r.path;
  const out: [number, number, number][] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(p.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (j: number) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([f(0), f(1), Math.max(0, f(2))]);
    }
  }
  out.push([...p[p.length - 1]]);
  return out;
}

/** A table's name as people write it: "Jungle Quest". */
export function tableName(def: TableDef): string {
  return def.title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
