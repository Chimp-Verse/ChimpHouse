// Who sits on which seat: one object the room server owns (server/house.ts), as it owns the lift
// and the theatre, so two visitors can't sit on one seat. Pages send commands (sit on seat n,
// stand up); the server runs them one at a time with these rules and sends everyone the result. A
// page runs the same rules on its own copy as it sends a command (engine/seats.ts), so its visitor
// sits at once; a refused one is put back as the server has it, and they stand up again. With no
// room server, each page has seats of its own.
//
// Seats are known by number (world/props/seats.ts numbers them room by room); the server doesn't
// know the house, so it only checks a number is a seat number at all. A visitor who leaves the
// house gets up from their seat; one whose connection drops keeps it while their page reconnects.
//
// Pure functions, no Babylon: the server runs them too.

/** The topic the seats are shared as. */
export const SEATS_TOPIC = "seats";
/** The highest seat number there can be (a room's place in ROOM_NAMES times 100, plus up to 99). */
export const MAX_SEAT = 9999;

export interface SeatsState {
  /** who sits on each seat taken, by seat number: their visitor id */
  taken: Record<string, string>;
}

export function initialSeats(): SeatsState {
  return { taken: {} };
}

export type SeatCommand =
  /** sit on seat n (getting up from any other first) */
  | { name: "sit"; args: { seat: number } }
  /** get up */
  | { name: "stand"; args?: undefined }
  /** every seat free, as the house opens, for tests (only when the server allows it) */
  | { name: "reset"; args?: undefined };

/** The command checked: one of SeatCommand, or null when it isn't one. */
export function parseSeatCommand(name: unknown, args: unknown): SeatCommand | null {
  const a = (args ?? {}) as Record<string, unknown>;
  if (typeof a !== "object" || Array.isArray(a)) return null;
  switch (name) {
    case "sit":
      return typeof a.seat === "number" && Number.isInteger(a.seat) && a.seat >= 1 && a.seat <= MAX_SEAT ? { name, args: { seat: a.seat } } : null;
    case "stand":
    case "reset":
      return { name };
    default:
      return null;
  }
}

/** Who sits on seat n, or null. */
export function sitterOf(s: SeatsState, n: number): string | null {
  return s.taken[String(n)] ?? null;
}

/** The seat `who` sits on, or null. */
export function seatOf(s: SeatsState, who: string): number | null {
  for (const [n, id] of Object.entries(s.taken)) if (id === who) return Number(n);
  return null;
}

/** `who` gets up (from whatever seat they sit on). */
export function standUp(s: SeatsState, who: string): SeatsState {
  const n = seatOf(s, who);
  if (n === null) return s;
  const taken = { ...s.taken };
  delete taken[String(n)];
  return { taken };
}

/** The seats after `who`'s command, or why it is refused (in plain words). */
export function runSeatCommand(s: SeatsState, who: string, cmd: SeatCommand): SeatsState | string {
  switch (cmd.name) {
    case "reset":
      return initialSeats();
    case "stand":
      return standUp(s, who);
    case "sit": {
      const by = sitterOf(s, cmd.args.seat);
      if (by === who) return s;
      if (by !== null) return "someone is already sitting there";
      const taken = { ...standUp(s, who).taken };
      taken[String(cmd.args.seat)] = who;
      return { taken };
    }
  }
}

/** A visitor has left the house: their seat is free. */
export function letGoOfSeats(s: SeatsState, who: string): SeatsState {
  return standUp(s, who);
}
