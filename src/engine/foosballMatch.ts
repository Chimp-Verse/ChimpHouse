// A foosball match's rules and shared state, as pure functions (no Babylon), like
// liftState.ts: who plays each side, the score, the phase (a serve, play, a goal,
// the end of a match), and the ball as last simulated.
//
// The state is shared through the room (engine/room.ts) in topics of one writer
// each: each side's seat and rods from the visitor playing it, and the game (the
// ball, the score, the phase) from the host, the visitor whose page simulates the
// ball: red's player, or blue's when red is the robot. When a side has nobody,
// the host's page plays it with the robot.

import { BallState, newBall } from "./foosballPhysics";
import { BALL_R, FIELD, SIDE, Team, WIN_SCORE } from "../world/props/foosballSpec";

/** A side's player, as the seat topic holds them, or null when the robot plays it (or nobody does). */
export type Seat = { id: string; name: string } | null;

/** "idle": nobody is playing. "serve": the ball drops in at a side's serve cup. "play". "goal": it's in, and comes out of the ball return. "over": a side has won. */
export type Phase = "idle" | "serve" | "play" | "goal" | "over";

export interface FoosGame {
  /** the visitor whose page simulates the ball, "" while nobody plays */
  host: string;
  phase: Phase;
  /** when the phase began (the room's time, ms) */
  since: number;
  red: number;
  blue: number;
  /** the side serving now, or next */
  serve: Team;
  /** the goal the last goal went into */
  into: Team | null;
  /** the side whose man last touched the ball */
  touch: Team | null;
  ball: BallState;
  /** when the ball was where `ball` says (the room's time, ms) */
  at: number;
  /** counts the serves, so a page can tell a new one from the same one sent again */
  serial: number;
}

/** How long each phase lasts (ms). */
export const TIMING = {
  /** from the ball dropping into the serve cup to it rolling out onto the field */
  serve: 900,
  /** from a goal to the ball resting in the return cup, then to the next serve */
  goalDrop: 450,
  goalReturn: 1200,
  goal: 2300,
  /** a ball that has stopped dead for this long is served again */
  dead: 5000,
};

/** How fast a served ball rolls out of the serve hole (m/s), and how much it can wander along the table. */
const SERVE_SPEED = 0.62;
const SERVE_WANDER = 0.12;

export function initialGame(now: number): FoosGame {
  return { host: "", phase: "idle", since: now, red: 0, blue: 0, serve: "red", into: null, touch: null, ball: newBall(), at: now, serial: 0 };
}

/** Who simulates the ball for these seats: red's player, else blue's, else nobody. */
export function hostFor(red: Seat, blue: Seat): string {
  return red?.id ?? blue?.id ?? "";
}

/** A new match: nil-nil, `serve` serving. */
export function startMatch(g: FoosGame, host: string, serve: Team, now: number, rand: number): FoosGame {
  return serveBall({ ...g, host, red: 0, blue: 0, into: null, touch: null }, serve, now, rand);
}

/** The ball served from `team`'s cup: it rolls out of the hole at the foot of their wall, across the middle. */
export function serveBall(g: FoosGame, team: Team, now: number, rand: number): FoosGame {
  return { ...g, phase: "serve", since: now, serve: team, touch: null, ball: servedBall(team, rand), at: now, serial: g.serial + 1 };
}

/** Where a served ball comes onto the field, and how it rolls. */
export function servedBall(team: Team, rand: number): BallState {
  const s = SIDE[team];
  return newBall(0, s * (FIELD.width / 2 - BALL_R - 0.002), (rand - 0.5) * 2 * SERVE_WANDER, -s * SERVE_SPEED);
}

/** The ball has gone into `into`'s goal: the other side scores. */
export function scoreGoal(g: FoosGame, into: Team, now: number): FoosGame {
  const red = g.red + (into === "blue" ? 1 : 0);
  const blue = g.blue + (into === "red" ? 1 : 0);
  return { ...g, phase: "goal", since: now, red, blue, into, serve: into, at: now };
}

/** The winner, once a side has WIN_SCORE. */
export function winner(g: { red: number; blue: number }): Team | null {
  return g.red >= WIN_SCORE ? "red" : g.blue >= WIN_SCORE ? "blue" : null;
}

/**
 * The steps a phase takes on its own, by the clock: a serve ends with the ball
 * in play, a goal with the next serve (or the end of the match). The host calls
 * this every frame; `rand` is in 0..1.
 */
export function advanceGame(g: FoosGame, now: number, rand: number): FoosGame {
  if (g.phase === "serve" && now - g.since >= TIMING.serve) return { ...g, phase: "play", since: now, at: now };
  if (g.phase === "goal" && now - g.since >= TIMING.goal) {
    if (winner(g)) return { ...g, phase: "over", since: now };
    return serveBall(g, g.serve, now, rand);
  }
  return g;
}

/** Nobody plays any more: the table goes quiet, keeping the score until a new match. */
export function idleGame(g: FoosGame, now: number): FoosGame {
  return { ...g, host: "", phase: "idle", since: now };
}

/** The side of the table the ball is on (the half it's in), to serve a dead ball from. */
export function halfOf(ball: BallState): Team {
  return ball.x < 0 ? "red" : "blue";
}

/** Walking up to the table: the side E plays and who's across (a visitor's name, or the robot), or who's playing when both sides are taken. */
export type FoosballPrompt = { side: Team; against: string } | { full: string };

/** What the HUD shows while you play. */
export interface FoosballView {
  you: Team;
  names: Record<Team, string>;
  red: number;
  blue: number;
  phase: Phase;
  winner: Team | null;
  /** the rod you kick with: its slot (1-8), what it is, and whether you picked it or it follows the ball */
  active: { slot: number; name: string; picked: boolean };
  /** a word for a moment: "GOAL!", "Serve" */
  callout: string | null;
  /** your first match on this page: how to play */
  coach: boolean;
}
