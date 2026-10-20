import type { Pose } from "../engine/flyCamera";
import { COURTYARD, LEVEL, M, PLAN_SCALE, SITE } from "./layout";
import arrivalLounge from "../../Reference Images/ArrivalLounge.png";
import communityShowRoom from "../../Reference Images/CommunityShowRoom.png";
import entryWay from "../../Reference Images/EntryWay.png";
import floorPlan from "../../Reference Images/FloorPlan.png";
import frontExterior from "../../Reference Images/FrontExterior.png";
import gameRoom from "../../Reference Images/GameRoom.png";
import musicRoom from "../../Reference Images/MusicRoom.png";
import nightFrontExterior from "../../Reference Images/NightFrontExterior.png";
import poolAndBar from "../../Reference Images/PoolAndBar.png";
import rearExterior from "../../Reference Images/RearExterior.png";
import secondFloorAtrium from "../../Reference Images/SecondFloorAtrium.png";
import sideEntrance from "../../Reference Images/SideEntrance.png";
import theatreRoom from "../../Reference Images/TheatreRoom.png";
import tradingRoom from "../../Reference Images/TradingRoom.png";

export interface Viewpoint {
  id: string;
  label: string;
  key?: string;
  ref?: string;
  refName?: string;
  pose: Pose;
  night?: boolean;
  hideUpper?: boolean;
  hideRoof?: boolean;
  planOverlay?: "lower" | "upper";
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Camera at traced-plan coordinates (tx, tz), mapped through the layout scale. */
function V(tx: number, y: number, tz: number, yawDeg: number, pitchDeg: number, fov: number): Pose {
  const p = M(tx, tz);
  return { x: p.x, y, z: p.z, yaw: deg(yawDeg), pitch: deg(pitchDeg), fov };
}

/** Top-down orthographic plan view centred on traced (tx, tz). */
function plan(tx: number, tz: number): Pose {
  const p = M(tx, tz);
  return { x: p.x, y: 120, z: p.z, yaw: 0, pitch: Math.PI / 2, fov: 0.8, ortho: { cx: p.x, cz: p.z, halfHeight: 16.25 * PLAN_SCALE } };
}

export const VIEWPOINTS: Viewpoint[] = [
  {
    id: "front",
    label: "Front exterior",
    key: "1",
    ref: frontExterior,
    refName: "FrontExterior.png",
    pose: V(0.8, -0.4, -26.9, 1, -11, 1.0),
  },
  {
    id: "front-night",
    label: "Front exterior (night)",
    key: "2",
    ref: nightFrontExterior,
    refName: "NightFrontExterior.png",
    night: true,
    pose: V(0.8, -0.4, -26.9, 1, -11, 1.0),
  },
  {
    id: "rear",
    label: "Rear exterior",
    key: "3",
    ref: rearExterior,
    refName: "RearExterior.png",
    pose: V(-0.5, LEVEL.upper - 0.4, 55, 180, 1, 0.78),
  },
  {
    id: "side",
    label: "Canopy bridge & side entrance",
    key: "4",
    ref: sideEntrance,
    refName: "SideEntrance.png",
    pose: V(-29.1, LEVEL.upper + 1.65, 12.4, 91, 4, 1.05),
  },
  {
    id: "entry",
    label: "Entry hall & atrium",
    key: "5",
    ref: entryWay,
    refName: "EntryWay.png",
    pose: V(0, 1.6, -1.4, 0, -9, 1.15),
  },
  {
    id: "gallery",
    label: "Upper gallery",
    key: "6",
    ref: secondFloorAtrium,
    refName: "SecondFloorAtrium.png",
    pose: V(0, LEVEL.upper + 3.0, 10.73, 180, 40, 1.3),
  },
  {
    id: "lounge",
    label: "Arrival Lounge",
    key: "7",
    ref: arrivalLounge,
    refName: "ArrivalLounge.png",
    pose: V(-12.92, 1.55, 2.64, 28, 2, 1.2),
  },
  {
    id: "game",
    label: "ChimpVibe Game Room",
    key: "8",
    ref: gameRoom,
    refName: "GameRoom.png",
    pose: V(6.19, 1.65, 3.27, 72, 2, 1.2),
  },
  {
    id: "trading",
    label: "Trading Room",
    key: "9",
    ref: tradingRoom,
    refName: "TradingRoom.png",
    pose: V(-10.55, 1.7, 15.25, 62, 7, 1.2),
  },
  {
    id: "mixchimp",
    label: "MixChimp Studio",
    key: "0",
    ref: musicRoom,
    refName: "MusicRoom.png",
    pose: V(4.28, 1.6, 16.64, -14, 2, 1.25),
  },
  {
    id: "showroom",
    label: "Community Builds Showroom",
    ref: communityShowRoom,
    refName: "CommunityShowRoom.png",
    pose: V(-10.01, LEVEL.upper + 1.4, 1.64, 8, 5, 1.2),
  },
  {
    id: "theatre",
    label: "Theatre",
    ref: theatreRoom,
    refName: "TheatreRoom.png",
    pose: V(-12.19, LEVEL.upper + 2.1, 16.73, 68, 9, 1.2),
  },
  {
    id: "poolbar",
    label: "Pool & Bar",
    ref: poolAndBar,
    refName: "PoolAndBar.png",
    pose: V(3.652, LEVEL.upper + 1.55, 12.909, 72, 4, 1.25),
  },
  {
    id: "aerial",
    label: "Aerial overview",
    pose: V(-54, 36 * SITE.k, -60, 42, 28, 0.85),
  },
  {
    id: "plan-lower",
    label: "Lower level plan",
    ref: floorPlan,
    refName: "FloorPlan.png",
    hideUpper: true,
    hideRoof: true,
    planOverlay: "lower",
    pose: plan(0, 11.25),
  },
  {
    id: "plan-upper",
    label: "Upper level plan",
    ref: floorPlan,
    refName: "FloorPlan.png",
    hideRoof: true,
    planOverlay: "upper",
    pose: plan(2, 11.25),
  },
];

/**
 * Where every visitor arrives as their chimp (engine/preview.ts): out in the front courtyard, on the
 * paving south of the fountain, facing the house's front doors past it, looking a little down at
 * the chimp from behind it, so the fountain and the house front are the first thing they see. The
 * walker stands the chimp on the paving under this eye point; the camera goes behind it, towards
 * the courtyard's south gate. The courtyard's spawn-point slot (roles.ts) marks the same place,
 * and spawning goes by the slot when there is one.
 */
export const SPAWN: Pose = {
  x: COURTYARD.spawn.x,
  y: LEVEL.ground + 1.6,
  z: COURTYARD.spawn.z,
  yaw: Math.atan2(COURTYARD.spawn.faces.x - COURTYARD.spawn.x, COURTYARD.spawn.faces.z - COURTYARD.spawn.z),
  pitch: deg(4),
  fov: 1.15,
};

export function findView(id: string | null | undefined): Viewpoint | undefined {
  return VIEWPOINTS.find((v) => v.id === id);
}
