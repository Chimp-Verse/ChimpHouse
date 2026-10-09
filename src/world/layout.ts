// ChimpHouse layout — the single source of truth for dimensions (metres).
//
// Axes: +X = house right (east), +Y = up, +Z = rear (north). The main
// entrance faces -Z. Lower floor top is y = 0.
//
// Footprints were traced from Reference Images/FloorPlan.png on a 0.05 m/px
// grid (see tools/plan-grid.mjs). Every plan position goes through `M`, which
// scales the traced plan: PLAN_SCALE for the wings and for depth, HALL_SCALE
// for the width of the entry hall. Change these two numbers to grow or shrink
// the whole house; rooms, furniture, stairs, bridge, terrain and viewpoints
// all follow because they are placed relative to the anchors below.

import { P2, closestFraction, ensureCCW, offsetPath, pointInPolygon, resample, roundedRect, smoothPath, subPath } from "./geometry/curves";

/** Scale of the wings and of depth (north–south) relative to the traced plan. */
export const PLAN_SCALE = 1.1;
/** Scale of the entry hall width relative to the traced plan. */
export const HALL_SCALE = 1.15;
/** Half-width of the traced entry hall (traced metres). */
export const HALL_TRACED = 3.75;
/** Half-width of the entry hall in the model (metres). */
export const HALL_HALF = HALL_TRACED * HALL_SCALE;

/** Map traced plan metres (0.05 m/px) to model metres. */
export function M(x: number, z: number): P2 {
  const ax = Math.abs(x);
  const mx = ax <= HALL_TRACED ? x * HALL_SCALE : Math.sign(x) * (HALL_HALF + (ax - HALL_TRACED) * PLAN_SCALE);
  return { x: mx, z: z * PLAN_SCALE };
}
const S = PLAN_SCALE;

export const LEVEL = {
  ground: -2.4, // front approach ground
  lower: 0, // lower floor top
  lowerCeil: 4.8,
  upper: 5.6, // upper floor top
  upperCeil: 10.4,
  roof: 11.2, // wing roof top
  domeSpring: 11.0,
  domeApex: 13.4,
};

export const FLOOR_PLAN = {
  /** FloorPlan.png pixel that maps to (0, 0) for the lower level */
  lowerOrigin: { px: 496, py: 575 },
  upperOrigin: { px: 1416, py: 575 },
  /** traced metres per plan pixel (positions then go through M) */
  metresPerPixel: 0.05,
  imageSize: { w: 1915, h: 821 },
};

/** A room footprint with a rounded end (semicircle centre `c`, radius `r`). */
export interface Lobe {
  loop: P2[];
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  c: P2;
  r: number;
  cx: number;
  cz: number;
}

function lobe(tx0: number, tz0: number, tx1: number, tz1: number, radii: [number, number, number, number], round: "west" | "east" | "ne"): Lobe {
  const a = M(tx0, tz0);
  const b = M(tx1, tz1);
  const rr = radii.map((v) => v * S) as [number, number, number, number];
  const loop = ensureCCW(roundedRect(a.x, a.z, b.x, b.z, rr));
  const r = round === "west" ? rr[0] : round === "east" ? rr[1] : rr[2];
  const c = round === "west" ? { x: a.x + r, z: (a.z + b.z) / 2 } : round === "east" ? { x: b.x - r, z: (a.z + b.z) / 2 } : { x: b.x - r, z: b.z - r };
  return { loop, x0: a.x, x1: b.x, z0: a.z, z1: b.z, c, r, cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2 };
}

// ---------------------------------------------------------------- lower level

/** Arrival Lounge (front-left lobe), glazed on its west and south curve. */
export const LOUNGE = lobe(-16.7, 0.3, -3.75, 12.2, [5.95, 0.4, 1.2, 5.95], "west");
/** ChimpVibe Game Room (front-right lobe), glazed on its east and south curve. */
export const GAME = lobe(3.75, 0.0, 18.9, 12.2, [0.4, 6.1, 6.1, 1.2], "east");
/**
 * Trading Room (rear-left). Its south wall stands back from the lounge so the
 * passage between them, which leads to its door, is about 1.35 m wide.
 */
export const TRADING = lobe(-16.1, 13.8, -5.0, 23.8, [5.0, 0.4, 3.0, 5.0], "west");
/** MixChimp Studio (rear-right). Extends toward the centre so the rear core reads narrow. */
export const MIX = lobe(1.25, 13.3, 17.1, 24.0, [2.0, 5.6, 5.6, 3.0], "east");
/** MixChimp's rounded south-west corner, facing the north end of the entry hall: centre and radius. */
export const MIX_CORNER = { x: MIX.x0 + 2.0 * S, z: MIX.z0 + 2.0 * S, R: 2.0 * S };

export const loungeLoop = LOUNGE.loop;
export const gameLoop = GAME.loop;
export const tradingLoop = TRADING.loop;
export const mixLoop = MIX.loop;

const c0 = M(-5.0, 13.3);
const c1 = M(1.0, 23.4);
/**
 * U-shaped main stair in the west of the core. Flight A rises north from the
 * entry hall to a half-landing at the back; flight B turns and rises south,
 * arriving on the upper floor beside the gallery. The stair hall is double
 * height up to the rear wall.
 */
const stairX0 = M(-4.7, 0).x;
const stairX1 = M(-2.3, 0).x;
const stairZ0 = c0.z + 0.25;
const stairSpine = 0.14;
const stairTread = 0.28;
const stairRisers = 32; // 16 per flight
const stairLanding = 1.5;
const stairLandingZ = stairZ0 + (stairRisers / 2 - 1) * stairTread;
export const STAIR = {
  x0: stairX0,
  x1: stairX1,
  z0: stairZ0,
  /** width of each flight */
  flight: (stairX1 - stairX0 - stairSpine) / 2,
  spine: stairSpine,
  tread: stairTread,
  risers: stairRisers,
  /** z where both flights meet the half-landing */
  landingZ: stairLandingZ,
  landingDepth: stairLanding,
  /** north end of the double-height stair hall (inner face of the rear wall) */
  hallZ1: c1.z - 0.13,
};

/** Central service core: stair, lift and WC (WC behind the lift, reached around its east side). */
export const core = {
  x0: c0.x,
  x1: c1.x,
  z0: c0.z,
  z1: c1.z,
  stair: { x0: stairX0, x1: stairX1, z0: stairZ0, z1: stairLandingZ + stairLanding },
  lift: { x0: M(-1.95, 0).x, x1: M(-1.95, 0).x + 2.2, z0: c0.z + 1.6, z1: c0.z + 3.6 },
  wc: { x0: M(-1.95, 0).x, x1: M(0.8, 0).x, z0: c0.z + 5.0, z1: c1.z - 0.3 },
};

/**
 * The lift car, inside the shaft: x is its centre line, z0 the face of its front wall (where its
 * own doors run, just in front of it) and z1 its back; halfW its half-width outside. Its floor
 * sits floorLift above the storey floor it stops at, and it is `height` from floor to ceiling inside.
 */
export const LIFT_CAR = {
  x: (core.lift.x0 + core.lift.x1) / 2,
  halfW: 1.0,
  wall: 0.04,
  z0: core.lift.z0 + 0.2,
  z1: core.lift.z0 + 1.94,
  height: 2.4,
  /** level with the floors' timber finish, which lies 12 mm on each storey's slab */
  floorLift: 0.014,
};

/**
 * The doorway on each landing, and the doors. The opening through the shaft's front wall is
 * `w` wide and `h` high. Each landing has two leaves, `leafW` wide, which meet in the middle and
 * slide `travel` apart behind the wall, in the band z0–z1 just behind its back face; the car's
 * own pair runs in front of the car (carZ0–carZ1) and opens with them. `callX` is where the call
 * panel sits, on the pier beside the doors.
 */
export const LIFT_DOOR = {
  w: 1.0,
  h: 2.2,
  leafW: 0.52,
  leafH: 2.25,
  travel: 0.51,
  z0: core.lift.z0 + 0.105,
  z1: core.lift.z0 + 0.135,
  carZ0: LIFT_CAR.z0 - 0.045,
  carZ1: LIFT_CAR.z0 - 0.015,
  callX: core.lift.x1 - 0.2,
};

/** The shaft's inner faces: where the floors and the upper slab open for it. */
export const LIFT_SHAFT = { x0: core.lift.x0 + 0.03, x1: core.lift.x1 - 0.03, z0: core.lift.z0 + 0.1, z1: core.lift.z1 };

/** Entry hall (open to the atrium above). */
export const hall = { x0: -HALL_HALF, x1: HALL_HALF, z0: 0, z1: core.z0 };

/** Convex glazed front of the central bay, both storeys: bulges FRONT_SAG forward of its ends. */
const FRONT_END_Z = 0.3 * S;
const FRONT_SAG = 0.75 * S;
const FRONT_R = (HALL_HALF * HALL_HALF + FRONT_SAG * FRONT_SAG) / (2 * FRONT_SAG);
export const FRONT_ARC = { cx: 0, cz: FRONT_END_Z - FRONT_SAG + FRONT_R, R: FRONT_R, half: Math.asin(HALL_HALF / FRONT_R) };

const trace = (pts: [number, number][]) => pts.map(([x, z]) => M(x, z));

/** Lower level deck/slab outline (CCW), traced around all lower rooms. */
export const lowerDeckLoop = ensureCCW(
  smoothPath(
    trace([
      [-4.03, -0.2], [-5.28, -0.63], [-9.34, -1.25], [-14.03, -0.94], [-17.16, 0.63],
      [-19.03, 3.13], [-19.5, 6.25], [-18.4, 9.4], [-16.4, 11.56], [-15.4, 12.6],
      [-15.9, 14.6], [-16.9, 17.2], [-17.16, 20.3], [-16.5, 21.9], [-14.66, 23.44],
      [-10.9, 24.2], [-5.9, 24.2], [0, 24.2], [6.9, 24.4], [12.53, 24.2], [15.66, 23.1],
      [17.4, 20.3], [18.3, 15.6], [18.7, 12.5], [19.4, 11.2], [20.2, 9.2], [20.5, 6.25],
      [19.9, 3.1], [17.6, 0.0], [14.1, -1.7], [9.4, -1.9], [5.2, -1.2], [4.1, -0.2], [0, -0.75],
    ]),
    6,
    true,
  ),
);

// ---------------------------------------------------------------- upper level

/** Community Builds Showroom (above the lounge). */
export const SHOWROOM = lobe(-16.2, 0.9, -5.0, 11.0, [5.0, 0.4, 1.2, 5.0], "west");
/** Theatre (above the trading room). */
export const THEATRE = lobe(-15.6, 14.5, -5.0, 23.4, [4.4, 0.4, 3.0, 4.4], "west");
/** Bar & Lounge (above MixChimp) — sheltered, open to the pool terrace on its south/east. */
export const BAR = lobe(1.25, 13.3, 17.1, 23.6, [0.4, 0.8, 5.4, 3.0], "ne");

export const showroomLoop = SHOWROOM.loop;
export const theatreLoop = THEATRE.loop;
export const barLoop = BAR.loop;
/**
 * The Canopy Bar's back bar runs along the straight part of the north wall
 * from x0 to x1; the wall behind it (wallX0..wallX1) is solid, the rest glazed.
 */
/** Drinks ledge along the east railing of the pool terrace (where the deck edge has x > xMin, zMin < z < zMax). */
export const RAIL_BAR = { xMin: 22.5, zMin: 12.9, zMax: 17.4 };
/** Cabana daybed on the terrace between the gallery and the pool. */
export const CABANA = { x: 8.45, z: 2.45, r: 1.7 };
export const CANOPY_BAR = { x0: BAR.x0 + 4.1, x1: BAR.c.x - 1.4, wallX0: BAR.x0 + 3.5, wallX1: BAR.c.x - 0.11 };

/** Atrium void (open to below). */
export const atriumVoid = { cx: 0, cz: 6.0 * S, rx: 3.5 * HALL_SCALE, rz: 3.6 * S };

/** Upper gallery outer boundary around the void. */
export const galleryOuter = { cx: 0, cz: 6.0 * S, rx: M(5.1, 0).x, rz: 5.6 * S };

/**
 * Push a deck outline out so it stays at least `gap` from each room's glazing,
 * leaving a walkway between the windows and the balcony railing.
 */
function clearOf(loop: P2[], rooms: P2[][], gap: number): P2[] {
  const nearest = (p: P2, room: P2[]) => {
    let best = { d: Infinity, q: p };
    for (let i = 0; i < room.length; i++) {
      const a = room[i];
      const b = room[(i + 1) % room.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
      const q = { x: a.x + dx * t, z: a.z + dz * t };
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < best.d) best = { d, q };
    }
    return best;
  };
  let pts = loop.map((p) => ({ ...p }));
  for (let pass = 0; pass < 4; pass++) {
    pts = pts.map((p) => {
      let out = p;
      for (const room of rooms) {
        const { d, q } = nearest(out, room);
        if (d < gap && d > 1e-6) out = { x: q.x + ((out.x - q.x) / d) * gap, z: q.z + ((out.z - q.z) / d) * gap };
      }
      return out;
    });
    // relax kinks left by the push
    pts = pts.map((p, i) => {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[(i + 1) % pts.length];
      return { x: p.x * 0.5 + (a.x + b.x) * 0.25, z: p.z * 0.5 + (a.z + b.z) * 0.25 };
    });
  }
  return pts.map((p) => {
    let out = p;
    for (const room of rooms) {
      const { d, q } = nearest(out, room);
      if (d < gap && d > 1e-6) out = { x: q.x + ((out.x - q.x) / d) * gap, z: q.z + ((out.z - q.z) / d) * gap };
    }
    return out;
  });
}

/** Upper deck/slab outline (CCW): showroom balcony, bridge landing, terrace, pool edge. */
const tracedUpperDeck = ensureCCW(
  smoothPath(
    trace([
      [-4.2, 0.0], [-5.28, -0.31], [-9.34, -0.94], [-14.03, -0.63], [-17.16, 1.25],
      [-19.03, 4.7], [-19.03, 7.8], [-17.8, 10.3], [-16.6, 11.8], [-17.6, 12.4],
      [-17.6, 15.2], [-17.0, 16.0], [-17.6, 17.6], [-17.16, 20.3], [-14.97, 22.5],
      [-10.9, 23.75], [-5.6, 24.1], [4.7, 24.1], [11.0, 23.75], [15.7, 22.8],
      [17.4, 20.6], [20.0, 17.6], [21.9, 15.0], [23.2, 11.9], [23.5, 7.8], [23.4, 3.1],
      [22.8, -1.0], [18.8, -1.9], [14.1, -1.9], [9.4, -1.25], [6.0, -0.4], [4.2, 0.0],
      [0, -0.75],
    ]),
    6,
    true,
  ),
);
const deckClearOfRooms = ensureCCW(clearOf(tracedUpperDeck, [THEATRE.loop, BAR.loop], 1.4));

/** Infinity plunge pool on the front-right of the terrace (water polygon, CCW). */
export const poolLoop = ensureCCW(
  smoothPath(
    trace([
      [11.2, 4.6], [10.8, 3.6], [10.8, 0.6], [11.6, -0.9], [14.2, -1.55], [18.8, -1.55],
      [22.2, -0.8], [22.9, 1.2], [23.0, 3.4], [22.4, 4.6], [16.8, 4.75],
    ]),
    5,
    true,
  ),
);

/**
 * Raised glass-edge infinity pool at the terrace's outer corner. Heights are
 * absolute; `wall` is the wall thickness from the water edge to its outer face.
 * On the jungle side the deck edge follows the outer wall: a glass panel shows
 * the water, which spills over its rim and down the wall into a catch gutter.
 */
export const POOL = {
  water: LEVEL.upper + 0.8,
  coping: LEVEL.upper + 0.92,
  floor: LEVEL.upper - 0.7,
  wall: 0.25,
  /** catch gutter along the foot of the infinity wall, flush with the slab soffit */
  gutter: LEVEL.lowerCeil,
};

function distToLoop(p: P2, loop: P2[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}

/** Where the deck edge runs within `gap` of the pool, replace it with the pool's outer wall line. */
function hugPool(loop: P2[], pool: P2[], gap: number, edge: number): P2[] {
  const ring = offsetPath(resample(pool, 0.15, true), edge, true);
  const n = loop.length;
  const near = loop.map((p) => !pointInPolygon(p, pool) && distToLoop(p, pool) < gap);
  const start = near.findIndex((v, i) => v && !near[(i - 1 + n) % n]);
  if (start < 0) return loop;
  let end = start;
  while (near[(end + 1) % n] && (end + 1) % n !== start) end = (end + 1) % n;
  const seg = subPath(ring, closestFraction(ring, loop[start]), closestFraction(ring, loop[end]), 0.15);
  const rest: P2[] = [];
  for (let k = 1; k < n; k++) {
    const i = (end + k) % n;
    if (i === start) break;
    rest.push(loop[i]);
  }
  return [...seg, ...rest];
}

/** Upper deck/slab outline (CCW): showroom balcony, bridge landing, terrace, pool edge. */
export const upperDeckLoop = ensureCCW(hugPool(deckClearOfRooms, poolLoop, 1.3, POOL.wall + 0.01));

/** Opening cut in the deck surface for the pool (just inside its outer wall). */
export const poolFootprint = ensureCCW(offsetPath(resample(poolLoop, 0.15, true), POOL.wall - 0.02, true));

// ---------------------------------------------------------------- site

function bounds(loop: P2[]) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of loop) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  return { x0, x1, z0, z1 };
}

/** Overall house footprint, used to size the surrounding site. */
export const SITE = (() => {
  const b = bounds([...lowerDeckLoop, ...upperDeckLoop]);
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  return { ...b, cx, cz, r: Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2, k: PLAN_SCALE / 0.8 };
})();

const bridgeZ = (SHOWROOM.z1 + THEATRE.z0) / 2;
const bridgeX = M(-17.7, 0).x;
export const BRIDGE = {
  start: { x: bridgeX, z: bridgeZ, y: LEVEL.upper },
  end: { x: bridgeX - 34, z: bridgeZ - 1.1, y: LEVEL.upper },
  width: 1.7,
  sag: 1.3,
};

export interface TreeDef {
  id: string;
  name: string;
  x: number;
  z: number;
  /** trunk radius at floor level */
  r: number;
  /** base (ground) height */
  base: number;
  /** trunk top / crown start */
  top: number;
  lean: number;
  seed: number;
}

function tree(id: string, name: string, tx: number, tz: number, r: number, base: number, top: number, lean: number, seed: number): TreeDef {
  const p = M(tx, tz);
  return { id, name, x: p.x, z: p.z, r, base, top, lean, seed };
}

export const TREES: TreeDef[] = [
  tree("treeWestCentral", "Central trunk (west)", -5.0, 10.4, 1.15, -6, 17, -0.08, 11),
  tree("treeEastCentral", "Central trunk (east)", 5.3, 10.3, 1.2, -6, 18, 0.1, 23),
  tree("treeTerrace", "Terrace trunk (between the arcade and the studio)", 15.28, 12.95, 1.05, -8, 17, 0.06, 131),
  tree("treeWest", "Bridge tree", -21.6, 9.6, 1.0, -14, 15, -0.12, 37),
  tree("treeEast", "Sail tree", 21.6, 18.4, 1.05, -14, 16, 0.15, 51),
  tree("treeFrontLeft", "Front-left tree", -29, 4, 1.3, -8, 16, -0.2, 67),
  tree("treeFrontRight", "Front-right tree", 31, 6, 1.2, -10, 15, 0.2, 79),
  tree("treeRearLeft", "Rear-left tree", -22, 31, 1.4, -26, 14, -0.1, 91),
  tree("treeRearRight", "Rear-right tree", 20, 32, 1.4, -26, 14, 0.1, 103),
  { id: "bridgeAnchor", name: "Bridge anchor tree", x: BRIDGE.end.x - 3.8, z: BRIDGE.end.z - 0.4, r: 1.6, base: -40, top: 16, lean: 0.0, seed: 117 },
];

/**
 * Trees whose trunks rise through the house's floors and roofs. Their (x, z) is
 * where the trunk leaves the ground; it leans and sways above that, and the
 * openings around it follow its real outline (structure/trunks.ts).
 */
export const HOUSE_TRUNKS = TREES.filter((t) => t.id === "treeWestCentral" || t.id === "treeEastCentral" || t.id === "treeTerrace");

export const FRONT_STAIR = { x0: -2.8 * HALL_SCALE, x1: 2.8 * HALL_SCALE, risers: 12, riser: 0.2, tread: 0.46 };

/**
 * Theatre entrance: double doors in the theatre's south wall at its east end,
 * opening off the upper corridor beside the stair hall (as on the floor plan).
 */
export const THEATRE_DOOR = { x: THEATRE.x1 - 1.95, w: 1.9, h: 2.7 };
/** Entrance to the Community Builds Showroom: its east glazing, facing the gallery, under the sign. */
export const SHOWROOM_DOOR = { z: SHOWROOM.cz, w: 1.9, h: 2.7 };
/** Door into MixChimp Studio, on the middle of its rounded corner (angle about MIX_CORNER), facing the hall. */
export const MIX_DOOR = (() => {
  const a = (225 * Math.PI) / 180;
  return { x: MIX_CORNER.x + Math.cos(a) * MIX_CORNER.R, z: MIX_CORNER.z + Math.sin(a) * MIX_CORNER.R, angle: a, w: 1.3, h: 2.5 };
})();
/**
 * Windows looking into the studio, either side of the door. The south band
 * starts just past the door on the rounded corner (a0, degrees about
 * MIX_CORNER) and runs along the south wall to x1. The west band runs from the
 * top of the west wall's straight part (z1) around the curve to a1, facing the
 * lift lobby. On the lower level the stair core's east wall stops at coreZ, so
 * the lobby opens onto the curve.
 */
export const MIX_WINDOWS = { a0: 252, a1: 198, x1: MIX_CORNER.x + 3.3, z1: MIX_CORNER.z + 0.9, coreZ: MIX_CORNER.z + 1.0, sill: 0.9, head: 2.6 };
/** Door into the Trading Room: south wall, beside the stair core, off the passage from the hall. */
export const TRADING_DOOR = { x: TRADING.x1 - 1.05, w: 1.15, h: 2.45 };

/** Upper corridor between the showroom and the theatre, from the gallery out to the side entrance. */
export const CORRIDOR = { x0: SHOWROOM.x0 + 0.3, x1: core.x0, z0: SHOWROOM.z1, z1: THEATRE.z0 };

/** Side entrance at the west end of the upper corridor between showroom and theatre. */
export const SIDE_ENTRANCE = { x: SHOWROOM.x0 - 0.05, z0: SHOWROOM.z1, z1: THEATRE.z0 };

/** Exterior canopy stair beside the west deck, rising north from the lower deck to the upper side deck. */
/**
 * Exterior stair on the west side, from the lower deck up to the bridge deck.
 * Each end has a landing `landing` deep (bottom: zBottom - landing..zBottom,
 * top: zTop..zTop + landing) running east to meet the deck.
 */
export const CANOPY_STAIR = { x: M(-19.0, 0).x, zBottom: M(0, 12.9).z, zTop: M(0, 12.9).z + 26 * 0.25, width: 1.4, landing: 1.9 };

/** x where a deck outline's west edge crosses z (its westmost crossing). */
export function deckWestX(loop: P2[], z: number): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if ((a.z - z) * (b.z - z) > 0 || a.z === b.z) continue;
    best = Math.min(best, a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z));
  }
  return best;
}

/**
 * The bridge deck relative to plan point p: lateral distance d from its centre
 * line, position t along it (0 at the house, 1 at the anchor tree) and the deck
 * height y there (the deck sags between its ends).
 */
export function bridgeAt(p: P2): { d: number; t: number; y: number } {
  const S = BRIDGE.start;
  const E = BRIDGE.end;
  const dx = E.x - S.x;
  const dz = E.z - S.z;
  const t = ((p.x - S.x) * dx + (p.z - S.z) * dz) / (dx * dx + dz * dz);
  const tc = Math.max(0, Math.min(1, t));
  const d = Math.hypot(p.x - (S.x + dx * tc), p.z - (S.z + dz * tc));
  return { d, t, y: S.y + (E.y - S.y) * tc - BRIDGE.sag * 4 * tc * (1 - tc) };
}

export interface RoomDef {
  id: string;
  name: string;
  level: "lower" | "upper";
  /** interior footprint (CCW) */
  loop: P2[];
}

const rect = (x0: number, z0: number, x1: number, z1: number) => roundedRect(x0, z0, x1, z1, [0, 0, 0, 0]);

export const ROOMS: RoomDef[] = [
  { id: "arrivalLounge", name: "Arrival Lounge", level: "lower", loop: loungeLoop },
  { id: "gameRoom", name: "ChimpVibe Game Room", level: "lower", loop: gameLoop },
  { id: "tradingRoom", name: "Trading Room", level: "lower", loop: tradingLoop },
  { id: "mixchimp", name: "MixChimp Studio", level: "lower", loop: mixLoop },
  { id: "core", name: "Stair & Lift", level: "lower", loop: rect(core.x0, core.z0, core.x1, core.z1) },
  { id: "entryHall", name: "Entry Hall", level: "lower", loop: rect(hall.x0, -0.8, hall.x1, hall.z1) },
  { id: "showroom", name: "Community Builds Showroom", level: "upper", loop: showroomLoop },
  { id: "theatre", name: "Theatre", level: "upper", loop: theatreLoop },
  { id: "barLounge", name: "Bar & Lounge", level: "upper", loop: barLoop },
  { id: "core", name: "Stair & Lift", level: "upper", loop: rect(core.x0, core.z0, core.x1, core.z1) },
  { id: "gallery", name: "Gallery & Stair Landing", level: "upper", loop: rect(-HALL_HALF - 1, -0.8, HALL_HALF + 1, core.z0) },
  { id: "sideEntrance", name: "Side Entrance & Corridor", level: "upper", loop: rect(SHOWROOM.x0 - 1.2, SHOWROOM.z1, core.x0, THEATRE.z0) },
  { id: "poolTerrace", name: "Pool Terrace", level: "upper", loop: rect(HALL_HALF + 0.5, -2.0, 20, BAR.z0) },
];

/** The level containing height y, if inside the house's height. */
export function levelAt(y: number): "lower" | "upper" | null {
  return y < LEVEL.lowerCeil + 0.2 ? "lower" : y < LEVEL.roof ? "upper" : null;
}

/** The room containing p, if any. */
export function roomAt(p: { x: number; y: number; z: number }): RoomDef | null {
  const level = levelAt(p.y);
  return ROOMS.find((r) => r.level === level && pointInPolygon({ x: p.x, z: p.z }, r.loop)) ?? null;
}
