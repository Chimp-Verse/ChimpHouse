// The lift's commands: what a page may ask of the lift, and how the room server (server/house.ts)
// runs each one with the pure rules in liftState.ts. The server owns the lift: pages send these
// and show the state it sends back, so two presses at the same moment are both kept.
//
// The server checks every command here: an unknown name or a malformed argument is refused,
// and who pressed or stood is the visitor the server knows the page as, never a name the page gives.

import { LiftState, advanceLift, callLift, holdDoors, initialLift, playMusic, setDoorway, setNearby, shutDoorsNow } from "./liftState";
import type { Floor } from "./liftState";

/** The lift's buttons: a landing's call button, a car button for a floor, and the car's door buttons. */
export const LIFT_BUTTONS = ["call1", "call2", "car1", "car2", "open", "close"] as const;
export type ButtonId = (typeof LIFT_BUTTONS)[number];

/** The topic the lift is shared as. */
export const LIFT_TOPIC = "lift";

export type LiftCommand =
  /** a button pressed: it calls the car, holds or shuts the doors, and starts the music */
  | { name: "press"; args: { button: ButtonId } }
  /** the visitor stepped into or out of the doorway */
  | { name: "doorway"; args: { inside: boolean } }
  /** the visitor came to the lift or walked away from it */
  | { name: "nearby"; args: { near: boolean } }
  /** the lift as the house opens with it, for tests (only when the server allows it) */
  | { name: "reset"; args?: undefined };

/** The command checked: one of LiftCommand, or null when it isn't one. */
export function parseLiftCommand(name: unknown, args: unknown): LiftCommand | null {
  const a = (args ?? {}) as Record<string, unknown>;
  if (typeof a !== "object" || Array.isArray(a)) return null;
  switch (name) {
    case "press":
      return typeof a.button === "string" && (LIFT_BUTTONS as readonly string[]).includes(a.button) ? { name, args: { button: a.button as ButtonId } } : null;
    case "doorway":
      return typeof a.inside === "boolean" ? { name, args: { inside: a.inside } } : null;
    case "nearby":
      return typeof a.near === "boolean" ? { name, args: { near: a.near } } : null;
    case "reset":
      return { name };
    default:
      return null;
  }
}

/** The lift after `who`'s command at `now` (the state is moved on to `now` first). */
export function runLiftCommand(s: LiftState, who: string, cmd: LiftCommand, now: number): LiftState {
  if (cmd.name === "reset") return initialLift(now);
  const cur = advanceLift(s, now);
  switch (cmd.name) {
    case "press": {
      const b = cmd.args.button;
      let next: LiftState;
      if (b === "open") next = holdDoors(cur, now);
      else if (b === "close") next = shutDoorsNow(cur, now);
      else next = callLift(cur, Number(b.slice(-1)) as Floor, b.startsWith("call") ? "call" : "car", now);
      return playMusic(next, who, now);
    }
    case "doorway":
      return setDoorway(cur, who, cmd.args.inside, now);
    case "nearby":
      return setNearby(cur, who, cmd.args.near);
  }
}

/** A visitor has left (or dropped): out of the doorway, and away from the lift. */
export function letGoOfLift(s: LiftState, who: string, now: number): LiftState {
  const cur = advanceLift(s, now);
  return setNearby(setDoorway(cur, who, false, now), who, false);
}
