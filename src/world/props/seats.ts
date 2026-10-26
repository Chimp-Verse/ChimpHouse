// Seats: the places a chimp can sit (engine/seats.ts). Every seat-type prop (a sofa's places,
// an armchair, a stool, a pouf, a bench's places, a lounger, the toilet…) adds a seat slot with
// this, found at run time by its role (roles.ts ROLE.seat) and number, never by how its prop is
// built, so a seat modelled in Blender is found the same way.
//
// The slot sits on the seat's top where a sitter's hips go, its front (-Z) the way they face. Its
// number is the room's (its place in ROOM_NAMES, times 100) plus its order in that room, so a
// change to one room's seats leaves every other room's numbers as they were. Visitors' pages build
// the same house, so the same number is the same seat for everyone (the room server keeps who sits
// on each by number).

import { Matrix, TransformNode, Vector3 } from "@babylonjs/core";
import { ROOM_NAMES, SeatInfo, SeatMeta, WorldCtx, Zone } from "../context";
import { xf } from "../geometry/geo";
import { ROLE } from "../roles";

/** How many seats each house has given out in each room so far. */
const counts = new WeakMap<WorldCtx, Map<string, number>>();
/** How far in front of a seat a sitter stands up to, on the floor (m). */
const STAND_OFF = 0.55;

/** The next seat number in a zone's room. */
function nextNumber(ctx: WorldCtx, z: Zone): number {
  let m = counts.get(ctx);
  if (!m) counts.set(ctx, (m = new Map()));
  const k = (m.get(z.room) ?? 0) + 1;
  m.set(z.room, k);
  const i = Object.keys(ROOM_NAMES).indexOf(z.room);
  if (k > 99) console.warn(`[seats] more than 99 seats in ${z.room}: their numbers run into the next room's`);
  return (i >= 0 ? i + 1 : 90) * 100 + k;
}

/**
 * Add a seat: a slot at `m` (on the seat's top, front -Z the way the sitter faces) with how it is
 * sat on. `label` names it for the builder's tools and the Blender files.
 */
export function seat(ctx: WorldCtx, z: Zone, m: Matrix, info: SeatInfo, label: string): TransformNode {
  const n = nextNumber(ctx, z);
  const node = ctx.slot(z, ROLE.seat, n, m, new Vector3(0, -info.height, -STAND_OFF), `${label} seat ${n}`);
  (node.metadata as SeatMeta).seat = { ...info };
  return node;
}

/** A seat at (x, y, z) in the world (y its top), facing (yaw as xf's: its front -Z turned by it). */
export function seatAt(ctx: WorldCtx, z: Zone, x: number, y: number, zz: number, yaw: number, info: SeatInfo, label: string): TransformNode {
  return seat(ctx, z, xf(x, y, zz, yaw), info, label);
}
