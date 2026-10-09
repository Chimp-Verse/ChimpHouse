// The lift's shared state: where the car is and where it is going, its doors, the floors
// called, and who stands in a doorway. It is one object (store.lift), like the theatre's
// and the TV's, so the room server can share it and everyone sees the same car.
//
// Nothing about it is sent every frame. Positions and door states are worked out from the
// times the state began (Date.now(), ms), as the theatre's playback position is, so the car
// is where it is for whoever looks, whenever they look. The functions here are pure: the
// same commands at the same times give the same state, on any visitor's page or the server.
//
// The commands are callLift (a call or a car button), holdDoors and shutDoorsNow (the car's
// door-open and door-close buttons) and setDoorway (someone in or out of a doorway); advanceLift moves the state on through its timed steps (the car arriving, the
// doors opening, dwelling, shutting, and setting off for the next floor called).
//
// The car's music is shared too, so everyone at the lift hears the same tune at the same
// bar: playMusic (a button pressed) starts it a moment later, and it plays on until the last
// visitor at the lift has walked away (setNearby).

import { LEVEL } from "../world/layout";
import type { Floor } from "../world/structure/lift";

export type { Floor };
export type LiftPhase = "parked" | "moving" | "arriving" | "open" | "closing";
/** A call from the landing's button, or a button pressed inside the car: an inside press shuts the doors sooner. */
export type CallSource = "call" | "car";

export interface LiftState {
  /** the floor the car is at, or last left, or has just arrived at */
  floor: Floor;
  /** the floor the car is travelling to, or null */
  dest: Floor | null;
  phase: LiftPhase;
  /** when the current phase began (ms): leaving the floor while moving, arriving, or the doors' start while open or closing */
  at: number;
  /** the doors' position at `doorAt` (0 shut, 1 open), heading for `doorTarget` */
  doorPos: number;
  doorTarget: 0 | 1;
  doorAt: number;
  /** while the doors are open, when they start to shut (ms), unless someone holds them */
  shutAt: number | null;
  /** floors called and not yet reached: their buttons are lit */
  pending: Floor[];
  /** the visitors standing in the doorway, who hold the doors open */
  inDoorway: string[];
  /** when the car's music started, or starts (ms); null while it is off */
  musicAt: number | null;
  /** the visitors at the lift (in the car, or near a landing's doors): the music plays while there are any */
  nearby: string[];
}

/** The timing, in seconds (speeds in m/s): the car takes a few seconds between floors, and the doors give people time to get in. */
export const LIFT_TIMING = {
  topSpeed: 1.0,
  accel: 0.6,
  /** the doors' travel, fully open or fully shut */
  openTime: 1.5,
  shutTime: 2.0,
  /** the car stopped at a floor before its doors open */
  arrivePause: 0.6,
  /** the doors stay open this long, for people to get in */
  dwell: 4.5,
  /** an inside button pressed while the doors are open: they shut this soon after */
  shutSoon: 1.5,
  /** after someone clears the doorway, the doors wait this long before they shut again */
  clearHold: 1.5,
  /** the car's door-open button keeps the doors open at least this long after it is pressed */
  holdOpen: 3,
  /** the music starts this long after a button is pressed */
  musicDelay: 1,
} as const;

const MS = 1000;

export function initialLift(now: number): LiftState {
  return { floor: 1, dest: null, phase: "parked", at: now, doorPos: 0, doorTarget: 0, doorAt: now, shutAt: null, pending: [], inDoorway: [], musicAt: null, nearby: [] };
}

/** The height of a floor's top above the lower floor's (m). */
export function floorHeight(f: Floor): number {
  return f === 1 ? 0 : LEVEL.upper - LEVEL.lower;
}

// ------------------------------------------------ the car's travel

interface Trip {
  /** the distance (m) and the time (s) of the trip, and how it splits: accelerating, cruising, slowing */
  D: number;
  time: number;
  tAcc: number;
  tCruise: number;
  dAcc: number;
  cruise: boolean;
}

function trip(D: number): Trip {
  const { topSpeed: v, accel: a } = LIFT_TIMING;
  const dAcc = (v * v) / (2 * a);
  if (D >= 2 * dAcc) {
    const tAcc = v / a;
    const tCruise = (D - 2 * dAcc) / v;
    return { D, time: 2 * tAcc + tCruise, tAcc, tCruise, dAcc, cruise: true };
  }
  // too short to reach top speed: accelerate to the middle, then slow
  const tAcc = Math.sqrt(D / a);
  return { D, time: 2 * tAcc, tAcc, tCruise: 0, dAcc: D / 2, cruise: false };
}

/** The distance covered (m) after `t` seconds of a trip. */
function covered(p: Trip, t: number): number {
  const { topSpeed: v, accel: a } = LIFT_TIMING;
  if (t <= 0) return 0;
  if (t >= p.time) return p.D;
  if (t <= p.tAcc) return 0.5 * a * t * t;
  if (p.cruise && t <= p.tAcc + p.tCruise) return p.dAcc + v * (t - p.tAcc);
  const left = p.time - t;
  return p.D - 0.5 * a * left * left;
}

/** Seconds the car takes between two floors. */
export function travelTime(from: Floor, to: Floor): number {
  return trip(Math.abs(floorHeight(to) - floorHeight(from))).time;
}

/** Where the car is (height of its floor above the lower floor's, m) at time `now`. */
export function carHeight(s: LiftState, now: number): number {
  if (s.phase !== "moving" || s.dest === null) return floorHeight(s.floor);
  const from = floorHeight(s.floor);
  const to = floorHeight(s.dest);
  const sign = Math.sign(to - from);
  return from + sign * covered(trip(Math.abs(to - from)), (now - s.at) / MS);
}

/** How fast the car is going (m/s) at `now`, for its motor's sound. */
export function carSpeed(s: LiftState, now: number): number {
  return Math.abs(carHeight(s, now + 20) - carHeight(s, now)) / 0.02;
}

// ------------------------------------------------ the doors

/** The doors' position (0 shut, 1 open) at `now`. */
export function doorPosAt(s: LiftState, now: number): number {
  const dt = Math.max(0, now - s.doorAt) / MS;
  if (s.doorTarget === 1) return Math.min(1, s.doorPos + dt / LIFT_TIMING.openTime);
  return Math.max(0, s.doorPos - dt / LIFT_TIMING.shutTime);
}

function openDoors(s: LiftState, t: number): LiftState {
  return {
    ...s,
    phase: "open",
    doorPos: doorPosAt(s, t),
    doorTarget: 1,
    doorAt: t,
    shutAt: t + (LIFT_TIMING.openTime + LIFT_TIMING.dwell) * MS,
    pending: s.pending.filter((f) => f !== s.floor),
  };
}

function shutDoors(s: LiftState, t: number): LiftState {
  return { ...s, phase: "closing", doorPos: doorPosAt(s, t), doorTarget: 0, doorAt: t, shutAt: null };
}

/** The doors meet someone in the doorway while they shut: they open again, and wait for it to clear. */
function reopen(s: LiftState, now: number): LiftState {
  return { ...s, phase: "open", doorPos: doorPosAt(s, now), doorTarget: 1, doorAt: now, shutAt: now + LIFT_TIMING.clearHold * MS };
}

// ------------------------------------------------ the timed steps

/** One timed step on from the state, if one is due at `now`; the same state if none is. */
function step(s: LiftState, now: number): LiftState {
  switch (s.phase) {
    case "moving": {
      if (s.dest === null) return s;
      const end = s.at + travelTime(s.floor, s.dest) * MS;
      if (now < end) return s;
      return { ...s, floor: s.dest, dest: null, phase: "arriving", at: end, pending: s.pending.filter((f) => f !== s.dest) };
    }
    case "arriving": {
      const end = s.at + LIFT_TIMING.arrivePause * MS;
      return now < end ? s : openDoors(s, end);
    }
    case "open": {
      if (s.inDoorway.length > 0) {
        const hold = now + LIFT_TIMING.clearHold * MS;
        return (s.shutAt ?? 0) >= hold ? s : { ...s, shutAt: hold };
      }
      if (s.shutAt === null || now < s.shutAt) return s;
      return shutDoors(s, s.shutAt);
    }
    case "closing": {
      if (s.inDoorway.length > 0) return reopen(s, now);
      const end = s.doorAt + LIFT_TIMING.shutTime * MS;
      if (now < end) return s;
      // shut: off to the next floor called, or parked where it is
      const next = s.pending[0];
      if (next === undefined) return { ...s, phase: "parked", doorPos: 0, at: end };
      return { ...s, phase: "moving", dest: next, at: end };
    }
    case "parked":
      return s;
  }
}

/** Move the state on through every step due by `now`. */
export function advanceLift(s: LiftState, now: number): LiftState {
  let cur = s;
  for (let i = 0; i < 32; i++) {
    const next = step(cur, now);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

// ------------------------------------------------ the commands

/**
 * A button pressed: on the landing (call) or inside the car (car), for floor `f`. At the
 * floor the car is at, its doors open (or are kept open, or reopen); for another floor,
 * the floor joins those called, and the car sets off once its doors have shut.
 */
export function callLift(s: LiftState, f: Floor, source: CallSource, now: number): LiftState {
  if (f === s.floor) {
    switch (s.phase) {
      case "parked":
        return openDoors(s, now);
      case "open":
        // a press inside shuts the doors soon; a call from the landing keeps them open a full dwell
        return { ...s, shutAt: source === "car" ? Math.min(s.shutAt ?? Infinity, now + LIFT_TIMING.shutSoon * MS) : now + LIFT_TIMING.dwell * MS };
      case "closing":
        return reopen(s, now);
      case "arriving":
        return s;
      case "moving":
        break; // leaving this floor: the call is queued below
    }
  }
  let next: LiftState = s.pending.includes(f) ? s : { ...s, pending: [...s.pending, f] };
  if (source === "car" && next.phase === "open") next = { ...next, shutAt: Math.min(next.shutAt ?? Infinity, now + LIFT_TIMING.shutSoon * MS) };
  if (next.phase === "parked") next = { ...next, phase: "moving", dest: f, at: now };
  return next;
}

/** The car's door-open button: shut or shutting doors open again, open ones stay open a while longer. Nothing while the car travels. */
export function holdDoors(s: LiftState, now: number): LiftState {
  const until = now + LIFT_TIMING.holdOpen * MS;
  switch (s.phase) {
    case "parked":
      return { ...openDoors(s, now), shutAt: now + (LIFT_TIMING.openTime + LIFT_TIMING.holdOpen) * MS };
    case "closing":
      return { ...reopen(s, now), shutAt: until };
    case "open":
      return { ...s, shutAt: Math.max(s.shutAt ?? 0, until) };
    default:
      return s;
  }
}

/** The car's door-close button: open doors start to shut now, unless someone stands in the doorway. */
export function shutDoorsNow(s: LiftState, now: number): LiftState {
  if (s.phase !== "open") return s;
  return advanceLift({ ...s, shutAt: now }, now);
}

/** A visitor goes into or out of the doorway (who is their id, see store.VIEWER). */
export function setDoorway(s: LiftState, who: string, inside: boolean, now: number): LiftState {
  if (inside === s.inDoorway.includes(who)) return s;
  const inDoorway = inside ? [...s.inDoorway, who] : s.inDoorway.filter((w) => w !== who);
  return advanceLift({ ...s, inDoorway }, now);
}

/** A lift button pressed by `who`: the car's music starts a moment later, or plays on if it is playing. */
export function playMusic(s: LiftState, who: string, now: number): LiftState {
  const nearby = s.nearby.includes(who) ? s.nearby : [...s.nearby, who];
  return { ...s, nearby, musicAt: s.musicAt ?? now + LIFT_TIMING.musicDelay * MS };
}

/** A visitor comes to the lift or walks away from it: once nobody is at it, its music stops. */
export function setNearby(s: LiftState, who: string, near: boolean): LiftState {
  if (near === s.nearby.includes(who)) return s;
  const nearby = near ? [...s.nearby, who] : s.nearby.filter((w) => w !== who);
  return { ...s, nearby, musicAt: nearby.length ? s.musicAt : null };
}

/** Whether the car's music is playing at `now`, and how far into the tune (s). */
export function musicAt(s: LiftState, now: number): number | null {
  return s.musicAt !== null && now >= s.musicAt ? (now - s.musicAt) / MS : null;
}
