// Playing air hockey at the Game Room's table (world/props/airHockey.ts).
//
// A walker who comes up to the table and looks at it is offered an end (E). Playing,
// the camera stands behind that end looking down the table, the mouse is free, and
// the player's mallet follows the cursor across their half: the cursor is cast onto
// the table, and the mallet sweeps after it no faster than a hand, so it strikes the
// puck rather than jumping past it. With one player the other mallet is the robot's,
// an invisible hand driving it; a second visitor who comes up takes the robot's end.
// First to 7 wins; then a rematch, or Leave (or Esc).
//
// Shared through the room (engine/room.ts), one writer to each topic:
// - "airHockey/seat/<end>": who plays at an end, refreshed every few seconds while
//   they do (a claim not refreshed lapses, so a closed page frees its end)
// - "airHockey/mallet/<end>": that player's mallet, from their page, as they move it
// - "airHockey/game": the puck, the score and the match, and the robot's mallet, from
//   the page that runs the game: the first player to sit down, handing over to the
//   other player if they leave (or their page stops)
// Every page near the table runs the same physics (engine/airHockeyPhysics.ts): a
// player's own mallet is drawn from their own cursor at once and strikes the puck at
// once, and the game's page keeps everyone's puck in step with its own.
//
// The table, its playfield, its ends, scoreboard faces and puck returns are found by
// role; the mallets and the puck are built on it at run time.

import { DynamicTexture, Matrix, Mesh, PBRMaterial, Ray, Scene, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import { SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { AIR_HOCKEY, AirHockeyPieces, SCOREBOARD_SIZE, buildAirHockeyPieces, paintScoreboard, scoreSides } from "../world/props/airHockey";
import { ROLE, find, findAll } from "../world/roles";
import { AirHockeySound } from "./airHockeySound";
import { RobotMind, Sim, TableSpec, WIN_SCORE, coast, makeRobot, makeSim, placePuck, robotMove, step, winner } from "./airHockeyPhysics";
import { FlyCamera, Pose } from "./flyCamera";
import { ScreenFocus, pickPoint } from "./focus";
import { Lighting } from "./lighting";
import { ME, room } from "./room";
import { AirHockeyHud, VIEWER, store } from "./store";

/** The playfield in the table's own space: its centre, half-sizes along X and Z, and its height. */
export interface Playfield {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  y: number;
}

type End = 1 | 2;
type Phase = AirHockeyHud["phase"];

/** Who plays at an end: refreshed while they do; a claim older than SEAT_LAPSE has lapsed. */
interface Seat {
  by: string | null;
  name: string;
  /** when it was last refreshed (the room's clock, ms) */
  at: number;
}

/** A player's mallet, from their page. */
interface MalletMsg {
  by: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** when (the room's clock, ms) */
  t: number;
  /** the match this player wants a rematch of, or -1 */
  rematch: number;
}

/** The game, from the page that runs it. */
interface GameMsg {
  /** the visitor running it */
  sim: string | null;
  /** when (the room's clock, ms) */
  t: number;
  phase: Phase;
  /** the match's number: a new one starts at 0-0 */
  match: number;
  /** the players it started with (end 1, end 2; null for the robot or nobody) */
  players: [string | null, string | null];
  /** the puck: x, z, vx, vz on the playfield; live false while it is in a goal or a return */
  puck: [number, number, number, number];
  live: boolean;
  score: [number, number];
  winner: 0 | 1 | 2;
  /** the end the last goal went into, and when (ms) */
  scored: 0 | 1 | 2;
  scoredAt: number;
  /** the robot's mallet, x and z, while it plays */
  robot: [number, number] | null;
}

/** How near an end a walker must stand to be offered it (m), and how directly at the table they must look. */
const REACH = 2.0;
const LOOK = Math.cos((60 * Math.PI) / 180);
/** A seat not refreshed for this long has lapsed (ms); its holder refreshes it every SEAT_BEAT. */
const SEAT_LAPSE = 12_000;
const SEAT_BEAT = 4_000;
/** The game's page hands over when it has said nothing for this long (ms). */
const GAME_LAPSE = 2_000;
/** How often the game and a mallet are sent while moving (ms), and while still. */
const SEND_MOVING = 33;
const SEND_STILL = 500;
/** How long a goal shows before the puck comes back (s), and the drop into the pocket. */
const GOAL_PAUSE = 1.7;
const DROP = 0.22;
/** After a player's own mallet strikes the puck, their page trusts its own puck this long (s) before the game's page's. */
const TRUST_OWN_HIT = 0.25;
/** How far off the game's page a puck can be before it is snapped there, not eased (m). */
const SNAP = 0.35;
/** Only near the table does anything happen each frame (m). */
const NEAR = 16;
const GLIDE_IN = 0.9;
const GLIDE_OUT = 0.8;

const noSeat = (): Seat => ({ by: null, name: "", at: 0 });

/** The playfield's bounds in the table's space, read from its mesh. */
function readPlayfield(table: TransformNode, surface: Mesh): Playfield {
  const inv = table.computeWorldMatrix(true).clone().invert();
  const wm = surface.computeWorldMatrix(true).multiply(inv);
  const P = surface.getVerticesData(VertexBuffer.PositionKind) ?? [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let y = 0;
  const v = new Vector3();
  for (let i = 0; i < P.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(P[i], P[i + 1], P[i + 2], wm, v);
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    z0 = Math.min(z0, v.z);
    z1 = Math.max(z1, v.z);
    y = v.y;
  }
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y };
}

export class AirHockey {
  readonly table: TransformNode | null;
  readonly field: Playfield | null = null;
  private surface: Mesh | null = null;
  private pieces: AirHockeyPieces | null = null;
  private sim: Sim | null = null;
  private spec: TableSpec | null = null;
  private robot: RobotMind = makeRobot();
  private sound = new AirHockeySound();
  /** the table's world matrix and its inverse */
  private world = Matrix.Identity();
  private inv = Matrix.Identity();
  /** each end's node, and where a puck put into its goal comes out (in the table's space) */
  private ends: TransformNode[] = [];
  private returns: Vector3[] = [];
  private boards: { end: End; tex: DynamicTexture; canvas: HTMLCanvasElement }[] = [];
  private boardKey = "";

  private seats: [Seat, Seat] = [noSeat(), noSeat()];
  private mallets: [MalletMsg | null, MalletMsg | null] = [null, null];
  private game: GameMsg;
  private publishSeat: ((s: Seat) => void)[] = [];
  private publishMallet: ((m: MalletMsg) => void)[] = [];
  private publishGame: (g: GameMsg) => void;
  /** a game state from the game's page not yet taken into this page's puck */
  private fresh = false;

  /** the end this visitor plays, while they do */
  private myEnd: End | null = null;
  private fovBefore = 1.0;
  private seatSent = 0;
  private malletSent = 0;
  private gameSent = 0;
  private lastMalletSent = { x: NaN, z: NaN };
  private rematch = -1;
  /** the simulation's clock (s), and when this page's own mallet last struck the puck */
  private clock = 0;
  private ownHit = -1;
  /** the drawn puck's offset from the simulated one, eased away after a correction */
  private offX = 0;
  private offZ = 0;
  /** the cursor on the page (CSS px), while it is over the view */
  private cursor: { x: number; y: number } | null = null;
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 100);
  private identity = Matrix.Identity();
  private v = new Vector3();
  private airLevel = 0;
  private lastFrame = performance.now();
  private hudKey = "";

  constructor(
    private scene: Scene,
    mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    private focus: ScreenFocus,
    private canvas: HTMLCanvasElement,
    /** shows a short message */
    private flash: (msg: string) => void,
  ) {
    const table = find(scene, ROLE.airHockeyTable);
    const surface = find(scene, ROLE.airHockeySurface);
    this.table = table instanceof TransformNode ? table : null;
    this.game = this.idleGame();
    this.publishGame = () => {};
    if (!this.table || !(surface instanceof Mesh)) return;
    this.surface = surface;
    this.world = this.table.computeWorldMatrix(true).clone();
    this.inv = this.world.clone().invert();
    const f = (this.field = readPlayfield(this.table, surface));
    this.spec = { hx: f.hx, hz: f.hz, goalHalf: AIR_HOCKEY.goalW / 2, cornerR: AIR_HOCKEY.cornerR, puckR: AIR_HOCKEY.puckR, malletR: AIR_HOCKEY.malletR };
    this.sim = makeSim(this.spec);
    this.sim.air = false;
    placePuck(this.sim, 0, 0);
    this.pieces = buildAirHockeyPieces(mats, this.table);
    lighting.addMeshes(this.pieces.meshes, []);
    this.ends = [1, 2].map((n) => find(scene, ROLE.airHockeyEnd, n)).filter((n): n is TransformNode => n instanceof TransformNode);
    this.returns = [1, 2].map((n) => {
      const node = find(scene, ROLE.airHockeyReturn, n);
      return node instanceof TransformNode ? Vector3.TransformCoordinates(node.getAbsolutePosition(), this.inv) : new Vector3((n === 1 ? -1 : 1) * (f.hx + 0.15), f.y - 0.17, 0);
    });
    for (const mesh of findAll(scene, ROLE.airHockeyScore)) {
      const end = (mesh.metadata as { slot?: number }).slot === 2 ? 2 : 1;
      const canvas = document.createElement("canvas");
      canvas.width = SCOREBOARD_SIZE.w;
      canvas.height = SCOREBOARD_SIZE.h;
      const tex = new DynamicTexture(`airHockeyScore${end}`, canvas, scene, true);
      const mat = new PBRMaterial(`airHockeyScore${end}`, scene);
      mat.unlit = true;
      mat.albedoColor.set(0, 0, 0);
      mat.emissiveColor.set(1.1, 1.1, 1.1);
      mat.emissiveTexture = tex;
      (mesh as Mesh).material = mat;
      this.boards.push({ end, tex, canvas });
    }
    this.place();
    this.paintBoards();

    // the shared state
    for (const end of [1, 2] as const) {
      this.publishSeat[end - 1] = room.share<Seat>(`airHockey/seat/${end}`, noSeat(), (s) => (this.seats[end - 1] = s));
      this.publishMallet[end - 1] = room.share<MalletMsg | null>(`airHockey/mallet/${end}`, null, (m) => (this.mallets[end - 1] = m)) as (m: MalletMsg) => void;
    }
    this.publishGame = room.share<GameMsg>("airHockey/game", this.game, (g) => {
      this.game = g;
      this.fresh = true;
    });
    room.onGone((id) => {
      this.seats.forEach((s, i) => {
        if (s.by === id) this.publishSeat[i](noSeat());
      });
    });

    // the cursor, and Esc to leave
    canvas.addEventListener("pointermove", (e) => (this.cursor = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointerleave", () => (this.cursor = null));
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && store.get().focus?.kind === "airHockey") void this.leave();
    });
  }

  // ---------------------------------------------------------------- who plays

  private seated(end: End, now = room.now()): boolean {
    const s = this.seats[end - 1];
    return !!s.by && (s.by === ME.id || now - s.at < SEAT_LAPSE);
  }

  /** The players now: each end's visitor, or null. */
  private players(now = room.now()): [string | null, string | null] {
    return [this.seated(1, now) ? this.seats[0].by : null, this.seated(2, now) ? this.seats[1].by : null];
  }

  /** Whether this page runs the game: the game's page while it is seated and heard from, else the first player seated. */
  private runsGame(now: number): boolean {
    if (this.myEnd === null) return false;
    const players = this.players(now);
    const g = this.game;
    const simOk = !!g.sim && players.includes(g.sim) && (g.sim === ME.id || now - g.t < GAME_LAPSE);
    if (simOk) return g.sim === ME.id;
    // hand over: to the player at the lower end, passing over a game's page that has gone quiet
    const candidates = players.filter((p): p is string => !!p && (p !== g.sim || now - g.t < GAME_LAPSE));
    return (candidates[0] ?? ME.id) === ME.id;
  }

  private idleGame(): GameMsg {
    return { sim: null, t: 0, phase: "idle", match: 0, players: [null, null], puck: [0, 0, 0, 0], live: true, score: [0, 0], winner: 0, scored: 0, scoredAt: 0, robot: null };
  }

  /** The end a walker here would be offered, and against whom; end null while both are taken. Null when not at the table. */
  private offer(): { end: End | null; opponent: string } | null {
    const walker = this.fly.walker;
    if (!walker || !this.table || this.ends.length < 2) return null;
    const feet = walker.feet;
    const c = this.table.getAbsolutePosition();
    const dx = c.x - feet.x;
    const dz = c.z - feet.z;
    const d = Math.hypot(dx, dz);
    if (d > REACH + 1.2 || Math.abs(feet.y - c.y) > 0.8) return null;
    const fwd = this.fly.camera.getDirection(Vector3.Forward());
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    if ((fwd.x * dx + fwd.z * dz) / (fl * (d || 1)) < LOOK) return null;
    // the nearer end, or the other if it's taken
    const dist = this.ends.map((n) => {
      const p = n.getAbsolutePosition();
      return Math.hypot(p.x - feet.x, p.z - feet.z);
    });
    if (Math.min(...dist) > REACH) return null;
    const near: End = dist[0] <= dist[1] ? 1 : 2;
    const order: End[] = [near, near === 1 ? 2 : 1];
    const end = order.find((e) => !this.seated(e)) ?? null;
    const otherEnd: End = end === 1 ? 2 : 1;
    const opponent = end !== null && this.seated(otherEnd) ? this.seats[otherEnd - 1].name : "the robot";
    return { end, opponent };
  }

  /** Do what E offers here: play at that end. */
  act(): void {
    const p = store.get().airHockeyPrompt;
    if (p?.end) void this.sit(p.end);
  }

  /** Play at an end (walk mode): take it, and glide to stand behind it. Resolves once there. */
  async sit(end: End): Promise<boolean> {
    if (!this.table || store.get().focus || this.seated(end) || !this.surface) return false;
    const now = room.now();
    this.myEnd = end;
    this.rematch = -1;
    this.publishSeat[end - 1]({ by: ME.id, name: ME.name, at: now });
    this.seatSent = now;
    this.fovBefore = this.fly.camera.fov;
    store.set({ airHockeyPrompt: null });
    const ok = await this.focus.enter({ kind: "airHockey", end }, this.surface, () => this.playPose(end), GLIDE_IN);
    // two visitors who took the same end at once: the room keeps one of them
    if (this.seats[end - 1].by !== ME.id) {
      this.flash("Someone else took that end");
      await this.leave();
      return false;
    }
    return ok;
  }

  /** Stop playing: free the end, and glide back to stand behind it. */
  async leave(): Promise<void> {
    const end = this.myEnd;
    const f = store.get().focus;
    if (end === null || f?.kind !== "airHockey" || f.phase === "out") return;
    this.myEnd = null;
    this.publishSeat[end - 1](noSeat());
    this.publishMallet[end - 1]({ by: ME.id, x: NaN, z: NaN, vx: 0, vz: 0, t: room.now(), rematch: -1 });
    // the last player away: the game stops, the blower with it
    if (!this.players().some((p) => p && p !== ME.id)) this.sendGame({ ...this.idleGame(), match: this.game.match, puck: this.puckState(), t: room.now() });
    this.canvas.style.cursor = "";
    store.set({ airHockey: null });
    await this.focus.leave(this.backPose(end), GLIDE_OUT);
  }

  /** Ask for a rematch once a match is over: against the robot it starts at once, against a visitor when both have asked. */
  askRematch(): void {
    if (this.myEnd === null || this.game.phase !== "over") return;
    this.rematch = this.game.match;
    this.malletSent = 0;
  }

  // ---------------------------------------------------------------- poses

  /** Behind an end, looking down the table at a steep angle, the whole table and the scoreboard in view. */
  private playPose(end: End): Pose {
    const f = this.field!;
    const s = end === 1 ? -1 : 1;
    const eye = Vector3.TransformCoordinates(new Vector3(f.cx + s * (f.hx + 0.75), f.y + 1.0, f.cz), this.world);
    const at = Vector3.TransformCoordinates(new Vector3(f.cx + s * 0.1, f.y, f.cz), this.world);
    const engine = this.scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const fov = Math.max(1.0, 2 * Math.atan(0.62 / aspect));
    const dx = at.x - eye.x;
    const dz = at.z - eye.z;
    return { x: eye.x, y: eye.y, z: eye.z, yaw: Math.atan2(dx, dz), pitch: Math.atan2(eye.y - at.y, Math.hypot(dx, dz)), fov };
  }

  /** Standing behind an end, on the floor, looking at the table. */
  private backPose(end: End): Pose | null {
    const node = this.ends[end - 1];
    const walker = this.fly.walker;
    if (!node || !walker) return null;
    const stand = Vector3.TransformCoordinates(Vector3.FromArray((node.metadata as SlotMeta).stand), node.computeWorldMatrix(true));
    if (!walker.place(stand.x, stand.y + 0.5, stand.z, 2)) return null;
    const c = this.table!.getAbsolutePosition();
    const feet = walker.feet;
    const dx = c.x - feet.x;
    const dz = c.z - feet.z;
    return { x: feet.x, y: walker.eyeY, z: feet.z, yaw: Math.atan2(dx, dz), pitch: Math.atan2(walker.eyeY - (c.y + 0.8), Math.hypot(dx, dz)), fov: this.fovBefore };
  }

  // ---------------------------------------------------------------- each frame

  update(): void {
    const sim = this.sim;
    const f = this.field;
    if (!sim || !f || !this.table) return;
    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    const s = store.get();
    // offer the table to a walker who comes up to it
    if (!s.focus) {
      const o = s.walking && this.fly.enabled ? this.offer() : null;
      const was = s.airHockeyPrompt;
      if (o?.end !== was?.end || o?.opponent !== was?.opponent) store.set({ airHockeyPrompt: o });
    }
    const cam = this.fly.camera.position;
    const c = this.table.getAbsolutePosition();
    const near = this.myEnd !== null || Math.hypot(cam.x - c.x, cam.y - c.y, cam.z - c.z) < NEAR;
    if (!near) {
      this.setAir(0);
      return;
    }
    const now = room.now();
    this.clock += dt;
    const players = this.players(now);
    const running = this.runsGame(now);

    // the mallets' targets: this player's cursor, the robot, the other player's mallet, or at rest
    const robotEnd: End | null = players[0] && !players[1] ? 2 : players[1] && !players[0] ? 1 : null;
    for (const end of [1, 2] as const) {
      const i = end - 1;
      const t = sim.targets[i];
      sim.malletMax[i] = 6.5;
      if (end === this.myEnd) {
        if (s.focus?.phase === "on") this.cursorTarget(t);
      } else if (end === robotEnd) {
        if (running) robotMove(sim, i as 0 | 1, this.robot, this.clock, Math.random);
        else if (this.game.robot) {
          t.x = this.game.robot[0];
          t.z = this.game.robot[1];
        }
      } else if (players[i] && this.mallets[i]?.by === players[i] && Number.isFinite(this.mallets[i]!.x)) {
        // the other player's mallet as they last sent it, carried on a moment by its speed
        const m = this.mallets[i]!;
        const age = Math.min(0.1, Math.max(0, (now - m.t) / 1000));
        t.x = m.x + m.vx * age;
        t.z = m.z + m.vz * age;
      } else {
        t.x = (end === 1 ? -1 : 1) * f.hx * 0.8;
        t.z = 0;
      }
    }

    if (running) this.runGame(now, players, robotEnd);
    else this.followGame(now);
    sim.air = this.game.phase !== "idle" && players.some((p) => !!p);
    step(sim, dt);
    // the sounds of what the puck struck
    const dist = this.myEnd !== null ? 1.2 : Math.hypot(cam.x - c.x, cam.z - c.z);
    for (let k = 0; k < sim.nEvents; k++) {
      const e = sim.events[k];
      if (e.kind === "goal") {
        if (!running) this.sound.goal(dist);
        continue;
      }
      if (e.kind === "mallet" && this.myEnd !== null && e.mallet === this.myEnd - 1) this.ownHit = this.clock;
      this.sound.hit(e.kind, e.strength, dist);
    }
    this.setAir(sim.air ? 1 / (1 + Math.max(0, dist - 1.5) * 0.8) : 0);

    // this player's mallet, for the others
    if (this.myEnd !== null) {
      this.refreshSeat(now);
      this.sendMallet(now);
    }
    this.place();
    this.paintBoards();
    this.updateHud(players, robotEnd);
  }

  /** Run the match on this page: goals, the score, the puck put back, rematches; and send it. */
  private runGame(now: number, players: [string | null, string | null], robotEnd: End | null): void {
    const sim = this.sim!;
    const f = this.field!;
    let g = this.game;
    // take over from where the last game's page left it
    if (g.sim !== ME.id) {
      g = { ...g, sim: ME.id };
      if (this.fresh) this.takePuck(g);
      this.fresh = false;
    }
    const want = (i: number) => (players[i] === ME.id ? this.rematch : this.mallets[i]?.by === players[i] ? this.mallets[i]!.rematch : -1);
    const newPlayers = players[0] !== g.players[0] || players[1] !== g.players[1];
    const rematch = g.phase === "over" && players.every((p, i) => !p || want(i) === g.match);
    if (newPlayers || rematch || g.phase === "idle") {
      // a new match: 0-0, the puck on a random end's side
      const serve = Math.random() < 0.5 ? -1 : 1;
      placePuck(sim, serve * f.hx * 0.45, 0);
      this.robot = makeRobot();
      g = { ...g, phase: "play", match: g.match + 1, players, score: [0, 0], winner: 0, scored: 0, scoredAt: 0 };
      this.gameSent = 0;
    }
    if (sim.scored && g.phase === "play") {
      // a goal: the other end scores
      const score: [number, number] = [g.score[0], g.score[1]];
      score[sim.scored === 1 ? 1 : 0]++;
      const w = winner(score);
      g = { ...g, score, scored: sim.scored, scoredAt: now, phase: w ? "over" : "goal", winner: w };
      this.sound.goal(this.myEnd !== null ? 1.2 : 4);
      this.gameSent = 0;
    } else if (g.phase === "goal" && now - g.scoredAt > GOAL_PAUSE * 1000) {
      // the player scored on puts the puck back on their side, from their puck return
      const s = g.scored === 1 ? -1 : 1;
      placePuck(sim, s * f.hx * 0.45, 0);
      g = { ...g, phase: "play", scored: 0 };
      this.gameSent = 0;
    }
    const moving = sim.live && Math.hypot(sim.puck.vx, sim.puck.vz) > 0.01;
    const robot = robotEnd ? sim.mallets[robotEnd - 1] : null;
    if (now - this.gameSent >= (moving || robot ? SEND_MOVING : SEND_STILL)) {
      this.sendGame({ ...g, t: now, puck: this.puckState(), live: sim.live, robot: robot ? [robot.x, robot.z] : null });
    } else this.game = g;
  }

  private sendGame(g: GameMsg): void {
    this.game = g;
    this.gameSent = g.t;
    this.publishGame(g);
  }

  private puckState(): [number, number, number, number] {
    const p = this.sim!.puck;
    return [p.x, p.z, p.vx, p.vz];
  }

  /** Keep this page's puck with the game's page's, brought up to now; after this player's own hit, trust their own a moment. */
  private followGame(now: number): void {
    if (!this.fresh) return;
    this.fresh = false;
    const g = this.game;
    const sim = this.sim!;
    const p = sim.puck;
    const age = Math.min(0.25, Math.max(0, (now - g.t) / 1000));
    const bx = p.x;
    const bz = p.z;
    const wasLive = sim.live;
    // the game's page decides, unless this player has just struck the puck themselves and it is near enough
    if (this.clock - this.ownHit < TRUST_OWN_HIT && g.live && wasLive) {
      const err = Math.hypot(g.puck[0] + g.puck[2] * age - bx, g.puck[1] + g.puck[3] * age - bz);
      if (err < SNAP) return;
    }
    this.takePuck(g);
    coast(sim, age);
    sim.nEvents = 0;
    if (wasLive && sim.live) {
      const ex = bx - p.x;
      const ez = bz - p.z;
      if (Math.hypot(ex, ez) < SNAP) {
        this.offX += ex;
        this.offZ += ez;
      } else this.offX = this.offZ = 0;
    } else this.offX = this.offZ = 0;
  }

  private takePuck(g: GameMsg): void {
    const sim = this.sim!;
    const p = sim.puck;
    [p.x, p.z, p.vx, p.vz] = g.puck;
    sim.live = g.live;
    sim.scored = g.live ? 0 : g.scored;
  }

  /** Where the cursor is on the table, as a target for this player's mallet; also hides the cursor over their half. */
  private cursorTarget(t: { x: number; z: number }): void {
    const f = this.field!;
    if (!this.cursor) return;
    // the ray takes the cursor in CSS pixels over the canvas (Babylon scales them to the render size itself)
    const at = pickPoint(this.canvas, this.cursor);
    this.scene.createPickingRayToRef(at.x, at.y, this.identity, this.ray, this.fly.camera);
    // the plane a hand holds the mallet at, a little above the playfield
    const planeY = Vector3.TransformCoordinatesFromFloatsToRef(0, f.y + 0.05, 0, this.world, this.v).y;
    const o = this.ray.origin;
    const d = this.ray.direction;
    if (d.y > -1e-4) return;
    const k = (planeY - o.y) / d.y;
    Vector3.TransformCoordinatesFromFloatsToRef(o.x + d.x * k, planeY, o.z + d.z * k, this.inv, this.v);
    t.x = this.v.x - f.cx;
    t.z = this.v.z - f.cz;
    const s = this.myEnd === 1 ? -1 : 1;
    const over = s * t.x > 0 && s * t.x < f.hx && Math.abs(t.z) < f.hz;
    const cur = over ? "none" : "";
    if (this.canvas.style.cursor !== cur) this.canvas.style.cursor = cur;
  }

  private refreshSeat(now: number): void {
    const end = this.myEnd!;
    if (now - this.seatSent < SEAT_BEAT) return;
    this.seatSent = now;
    this.publishSeat[end - 1]({ by: ME.id, name: ME.name, at: now });
  }

  private sendMallet(now: number): void {
    const end = this.myEnd!;
    const m = this.sim!.mallets[end - 1];
    const moved = Math.hypot(m.x - this.lastMalletSent.x, m.z - this.lastMalletSent.z) > 0.001 || !Number.isFinite(this.lastMalletSent.x);
    if (now - this.malletSent < (moved ? SEND_MOVING : SEND_STILL)) return;
    this.malletSent = now;
    this.lastMalletSent.x = m.x;
    this.lastMalletSent.z = m.z;
    this.publishMallet[end - 1]({ by: ME.id, x: m.x, z: m.z, vx: m.vx, vz: m.vz, t: now, rematch: this.rematch });
  }

  private setAir(level: number): void {
    if (Math.abs(level - this.airLevel) < 0.03 && (level > 0 || this.airLevel === 0)) return;
    this.airLevel = level;
    this.sound.air(level);
  }

  // ---------------------------------------------------------------- drawing

  /** Put the mallets and the puck where the simulation has them (a puck in a goal drops in, then waits on its return). */
  private place(): void {
    const sim = this.sim;
    const f = this.field;
    const p = this.pieces;
    if (!sim || !f || !p) return;
    for (const i of [0, 1] as const) p.mallets[i].position.set(f.cx + sim.mallets[i].x, f.y, f.cz + sim.mallets[i].z);
    // ease away a correction from the game's page
    this.offX *= 0.86;
    this.offZ *= 0.86;
    const puck = p.puck.position;
    if (sim.live) {
      puck.set(f.cx + sim.puck.x + this.offX, f.y + 0.0006, f.cz + sim.puck.z + this.offZ);
      p.puck.setEnabled(true);
      return;
    }
    const end = sim.scored || this.game.scored;
    const since = this.game.scoredAt ? (room.now() - this.game.scoredAt) / 1000 : 1;
    if (end && since < DROP) {
      // into the pocket and down
      const s = end === 1 ? -1 : 1;
      const k = since / DROP;
      puck.set(f.cx + s * (f.hx + AIR_HOCKEY.puckR + 0.05 * k), f.y - 0.06 * k * k, f.cz + sim.puck.z * (1 - k));
      p.puck.setEnabled(true);
    } else if (end) {
      puck.copyFrom(this.returns[end - 1]);
      p.puck.setEnabled(since > DROP + 0.35);
    }
  }

  /** Redraw the scoreboard's faces when the score or the match changes. */
  private paintBoards(): void {
    const g = this.game;
    const live = this.players().some((p) => !!p) && g.phase !== "idle";
    const msg = !live ? `FIRST\nTO ${WIN_SCORE}` : g.phase === "goal" ? "GOAL!" : g.phase === "over" ? `${g.winner === 1 ? "RED" : "BLUE"}\nWINS` : `FIRST\nTO ${WIN_SCORE}`;
    const score = live ? g.score : [0, 0];
    const key = `${score.join()}|${msg}`;
    if (key === this.boardKey) return;
    this.boardKey = key;
    for (const b of this.boards) {
      paintScoreboard(b.canvas, ...scoreSides(b.end, score[0], score[1]), msg);
      b.tex.update(true);
    }
  }

  private updateHud(players: [string | null, string | null], robotEnd: End | null): void {
    const end = this.myEnd;
    if (end === null || store.get().focus?.kind !== "airHockey") return;
    const g = this.game;
    const other: End = end === 1 ? 2 : 1;
    const opponent = robotEnd === other ? "the robot" : this.seats[other - 1].name || "another visitor";
    const hud: AirHockeyHud = {
      end,
      score: g.phase === "idle" ? [0, 0] : g.score,
      phase: g.phase,
      winner: g.winner,
      opponent,
      scored: g.phase === "goal" ? g.scored : 0,
      waiting: g.phase === "over" && this.rematch === g.match && !!players[other - 1],
    };
    const key = JSON.stringify(hud);
    if (key === this.hudKey) return;
    this.hudKey = key;
    store.set({ airHockey: hud });
  }

  // ---------------------------------------------------------------- for the tests

  /** Where the table is in the world: its base, and the turn of its long axis. */
  where(): { at: number[]; yaw: number } | null {
    if (!this.table) return null;
    const at = Vector3.TransformCoordinates(Vector3.Zero(), this.world);
    const ax = Vector3.TransformNormal(Vector3.Right(), this.world);
    return { at: at.asArray(), yaw: Math.atan2(-ax.z, ax.x) };
  }

  /** The game as this page has it. */
  describe() {
    const sim = this.sim!;
    const now = room.now();
    return {
      end: this.myEnd,
      runs: this.runsGame(now),
      phase: this.game.phase,
      match: this.game.match,
      score: this.game.score,
      winner: this.game.winner,
      players: this.players(now),
      seats: this.seats.map((s) => s.by),
      puck: [sim.puck.x, sim.puck.z, sim.puck.vx, sim.puck.vz],
      live: sim.live,
      mallets: sim.mallets.map((m) => [m.x, m.z, m.vx, m.vz]),
      robot: this.robot.plan,
      me: VIEWER,
      /** the page running the game, and how long since it was last heard from (ms) */
      sim: this.game.sim,
      gameAge: Math.round(now - this.game.t),
      visible: document.visibilityState,
      /** the simulation's clock (s), which stands still while the page isn't drawing; and the room's time (ms) */
      clock: this.clock,
      now,
    };
  }

  /** Point the cursor at a spot on the playfield (its own coordinates), as a player's mouse would; returns that spot on the page. */
  aim(x: number, z: number): { x: number; y: number } | null {
    const f = this.field;
    if (!f) return null;
    const w = Vector3.TransformCoordinates(new Vector3(f.cx + x, f.y + 0.05, f.cz + z), this.world);
    const cam = this.scene.activeCamera!;
    const engine = this.scene.getEngine();
    const rw = engine.getRenderWidth();
    const rh = engine.getRenderHeight();
    const q = Vector3.Project(w, Matrix.IdentityReadOnly, cam.getViewMatrix(true).multiply(cam.getProjectionMatrix(true)), cam.viewport.toGlobal(rw, rh));
    const box = this.canvas.getBoundingClientRect();
    this.cursor = { x: box.left + (q.x / rw) * box.width, y: box.top + (q.y / rh) * box.height };
    return this.cursor;
  }

  /** Put the puck at (x, z) moving at (vx, vz), on the page running the game. */
  setPuck(x: number, z: number, vx: number, vz: number): void {
    const sim = this.sim;
    if (!sim) return;
    placePuck(sim, x, z);
    sim.puck.vx = vx;
    sim.puck.vz = vz;
    this.gameSent = 0;
  }

  /** Free both ends and stop the game, for everyone in the room (tests start from it). */
  reset(): void {
    for (const i of [0, 1]) this.publishSeat[i](noSeat());
    this.sendGame({ ...this.idleGame(), match: this.game.match, t: room.now() });
  }

  /** Set the score of the match on the page running the game (to test its end). */
  setScore(red: number, blue: number): void {
    this.game = { ...this.game, score: [red, blue] };
    this.gameSent = 0;
  }
}
