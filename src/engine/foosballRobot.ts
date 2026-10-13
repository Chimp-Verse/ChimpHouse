// The robot that plays a side of the foosball table when only one visitor is
// playing, as pure functions (no Babylon). There's no robot to see: it works its
// side's rods as a player's hands would, through the same rods, and is held to
// what a person could do: it sees the ball a moment late, its hands move only so
// fast, and its aim and timing aren't perfect. It plays well but can be beaten:
// a shot that's moved across before it's struck gets past it.
//
// Each of its rods, on its own: where the ball is coming its way, it puts a man
// where the ball will cross; otherwise it follows the ball across, between it
// and its goal. When the ball is just in front of a man it can reach, it strikes:
// a short wind-up and a snap through the ball, aimed off the middle of the man's
// foot now and then to angle the shot. Its rods ahead of a hard shot of its own
// lift out of the way.

import { BallState, RodPose, slideFor } from "./foosballPhysics";
import { ATTACK, BALL_R, FIELD, GOAL, MAN, RODS, Team, manZ } from "../world/props/foosballSpec";

/**
 * How good the robot is: its reaction (s), its hands' top speeds (m/s sliding, rad/s turning),
 * how far off its blocks are (m), how long it takes over a ball at its feet before striking (s,
 * least and most), and how often it angles a shot from its attack rod.
 */
export const ROBOT = { reaction: 0.12, slideSpeed: 1.25, turnSpeed: 42, error: 0.014, settle: [0.12, 0.45], angled: 0.35 };

/** The robot's targets for one rod: a slide, and a turn as the team sees it (+ swings the toes towards the goal it attacks). */
export interface RodTarget {
  slide: number;
  forward: number;
}

interface RodMind {
  /** the man it's using, and its own error for this approach of the ball */
  man: number;
  error: number;
  /** a strike in progress: when it began (s) and how it's aimed (an offset of the ball from the foot's middle) */
  strike: number;
  aim: number;
  slide: number;
  /** when the ball came to this rod's feet, and how long the robot takes over it before striking (s) */
  readyAt: number;
  wait: number;
}

export interface RobotMind {
  team: Team;
  rods: number[];
  minds: RodMind[];
  /** the ball as the robot last saw it, and when */
  seen: BallState;
  seenAt: number;
}

export function newRobot(team: Team): RobotMind {
  const rods = RODS.map((r, i) => (r.team === team ? i : -1)).filter((i) => i >= 0);
  return { team, rods, minds: rods.map(() => ({ man: 0, error: 0, strike: -1, aim: 0, slide: 0, readyAt: -1, wait: 0 })), seen: { x: 0, z: 0, vx: 0, vz: 0 }, seenAt: -1 };
}

/** Where the ball will cross x = `x` across the table, bouncing off the side walls, and how soon (s); null if it isn't coming. */
export function crossing(b: BallState, x: number): { z: number; t: number } | null {
  if (Math.abs(b.vx) < 0.05) return null;
  const t = (x - b.x) / b.vx;
  if (t < 0 || t > 3) return null;
  const half = FIELD.width / 2 - BALL_R;
  let z = b.z + b.vz * t;
  // fold the straight path back inside the walls
  const span = 4 * half;
  z = ((((z + half) % span) + span) % span) - half;
  if (z > half) z = 2 * half - z;
  return { z, t };
}

/**
 * Update the robot for the time `now` (s) and give its rods' targets, in the
 * order of `mind.rods`. `ball` is where the ball really is: the robot only sees
 * it every `ROBOT.reaction`. `touch` is the side that touched the ball last.
 */
export function robotPlay(mind: RobotMind, ball: BallState, poses: RodPose[], touch: Team | null, now: number, rand: () => number): RodTarget[] {
  if (now - mind.seenAt >= ROBOT.reaction || mind.seenAt < 0) {
    mind.seen = { ...ball };
    mind.seenAt = now;
  }
  const a = ATTACK[mind.team];
  // where the ball is now, as the robot reckons from what it saw
  const age = now - mind.seenAt;
  const b: BallState = { x: mind.seen.x + mind.seen.vx * age, z: mind.seen.z + mind.seen.vz * age, vx: mind.seen.vx, vz: mind.seen.vz };
  const ownShot = touch === mind.team && b.vx * a > 1.0;
  return mind.rods.map((i, k) => {
    const rod = RODS[i];
    const m = mind.minds[k];
    const pose = poses[i];
    const ahead = (b.x - rod.x) * a; // > 0: the ball is in front of this rod
    // a hard shot of its own coming through from behind: lift out of its way
    if (ownShot && ahead < 0 && ahead > -0.3) return { slide: pose.slide, forward: 1.5 };
    // striking: wind up, snap through, settle
    if (m.strike >= 0) {
      const t = now - m.strike;
      if (t < 0.07) return { slide: m.slide, forward: -0.55 };
      if (t < 0.16) return { slide: m.slide, forward: 1.7 };
      if (t > 0.32) m.strike = -1;
      return { slide: m.slide, forward: 0 };
    }
    // where to put a man: where the ball will cross, if it's coming; else level with it
    const coming = b.vx * a < -0.2 && ahead > 0;
    const cross = coming ? crossing(b, rod.x) : null;
    let z = cross ? cross.z : b.z;
    if (!cross && ahead < 0) {
      // the ball is behind this rod: stand between it and the goal less, keep level with it
      z = b.z;
    }
    if (rand() < 0.02) m.error = (rand() - 0.5) * 2 * ROBOT.error;
    z += m.error;
    // within reach just in front of a man: strike, aimed straight or off the foot's middle
    const near = ahead > 0.012 && ahead < 0.05 && Math.hypot(b.vx, b.vz) < 1.6;
    const pick = slideFor(i, b.z, m.man);
    const manAt = manZ(rod, pick.man) + pose.slide;
    const ready = near && Math.abs(b.z - manAt) < MAN.halfWidth + BALL_R * 0.4;
    if (!ready) m.readyAt = -1;
    else if (m.readyAt < 0) {
      // the ball has come to its feet: it takes a moment over it, as a person would
      m.readyAt = now;
      m.wait = ROBOT.settle[0] + rand() * (ROBOT.settle[1] - ROBOT.settle[0]);
    }
    if (ready && now - m.readyAt >= m.wait) {
      m.strike = now;
      m.readyAt = -1;
      // aim: the goal's mouth for the attack, now and then off the foot's middle to angle it; anywhere forward for the rest
      const towards = rod.name === "attack" && rand() < ROBOT.angled ? (rand() < 0.5 ? -1 : 1) * (MAN.halfWidth + 0.004) : 0;
      m.aim = towards;
      m.slide = slideFor(i, b.z - towards, pick.man).slide;
      return { slide: m.slide, forward: -0.55 };
    }
    // the goalie stays in its goal's mouth unless the ball is right there
    if (rod.name === "goalie") z = Math.max(-GOAL.half - 0.03, Math.min(GOAL.half + 0.03, z));
    const target = slideFor(i, z, m.man);
    m.man = target.man;
    return { slide: target.slide, forward: 0 };
  });
}
