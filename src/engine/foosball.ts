// The Game Room's foosball table in the page: its rods, ball and score counters,
// built at run time on the table's slots (world/props/foosball.ts) and found by
// role (world/roles.ts), never by how the room code builds them; walking up to
// it, playing it, and the robot that plays a side nobody else is playing.
//
// Playing: walk up to a long side and press E. The camera glides behind that
// side's grips (engine/focus.ts) and the mouse is the player's hands:
//   - up and down: every one of your rods slides a man under the cursor's line
//     across the table, so your men line up where you point;
//   - a flick to the right (towards the goal you attack) swings the lit rod's men
//     through the ball, harder the faster the flick; a click (or Space) whips it
//     round in a full spin;
//   - the lit rod is the one of yours nearest the ball, picked as the ball moves;
//     the wheel or 1-4 (goalie, defence, midfield, attack) picks another until
//     the ball moves on to another rod;
//   - hold the right button (or Shift) to lift all your men, letting the ball
//     roll under; your rods ahead of a hard shot of your own lift by themselves.
// Esc or Leave leaves. A match is first to WIN_SCORE, then Rematch or Leave.
//
// Shared through the room (engine/room.ts, foosballMatch.ts): each side's seat
// and rods from the visitor playing it, and the game (ball, score, phase) from
// the host, whose page simulates the ball (foosballPhysics.ts) and plays the
// robot's side (foosballRobot.ts). The other player's page runs the same physics
// ahead of the host's word, so their own kicks answer at once, and is corrected
// smoothly as the host's word comes in. Nothing runs per frame unless someone
// is near the table or playing.

import { Color3, Matrix, Mesh, PBRMaterial, Quaternion, Ray, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { MeshMeta, SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { FoosballRod, RETURN_CUP, STAND_OUT, buildFoosballBall, buildFoosballBeads, buildFoosballRod, setBeads } from "../world/props/foosball";
import { ATTACK, BALL_R, FIELD, GOAL, RODS, SIDE, SIDE_WALL, Team, WALL_TOP, WIN_SCORE } from "../world/props/foosballSpec";
import { ROLE, find, findAll } from "../world/roles";
import { FlyCamera, Pose } from "./flyCamera";
import { ScreenFocus } from "./focus";
import { BallState, Hand, PLAYER_HAND, PhysicsEvent, RodPose, advance, driveRod, newBall, restPose, slideFor } from "./foosballPhysics";
import { FoosGame, FoosballView, Seat, TIMING, advanceGame, halfOf, hostFor, idleGame, initialGame, scoreGoal, serveBall, startMatch, winner } from "./foosballMatch";
import { ROBOT, RobotMind, newRobot, robotPlay } from "./foosballRobot";
import { FoosballSound } from "./foosballSound";
import { Lighting } from "./lighting";
import { room } from "./room";
import { VIEWER, store } from "./store";
import { ME } from "./room";

/** A seat as shared: the player, and when they last said they're still there (the room's time, ms). */
type SeatMsg = (NonNullable<Seat> & { at: number }) | null;
/**
 * A side's rods as shared: when (room ms), and per rod of the side (in RODS order) slide, turn and
 * their speeds; a count of Rematch presses; and, from a player whose page doesn't host, their last
 * strike of the ball as their page saw it (numbered), so the host takes it even if it missed the
 * swing between the messages.
 */
type Strike = { n: number; t: number; x: number; z: number; vx: number; vz: number };
type RodsMsg = { t: number; p: number[]; rematch: number; hit?: Strike | null } | null;

const TEAMS: Team[] = ["red", "blue"];
const OTHER: Record<Team, Team> = { red: "blue", blue: "red" };
const ROD_LABEL = { goalie: "Goalie", defence: "Defence", midfield: "Midfield", attack: "Attack" } as const;
/** within this far (m) of the cabinet's edge, a walker is offered a side */
const NEAR = 1.3;
/** within this far (m) of the table, a spectator's page shows the game */
const WATCH = 14;
/** how often a player's page sends its rods, and the host the game (ms) */
const SEND_MS = 33;
/** a seat not refreshed for this long is empty (ms): its player's page is gone */
const SEAT_FRESH = 15000;
const SEAT_BEAT = 4000;
/** the turn a flick gives, per pixel of mouse movement to the right (rad) */
const FLICK = 0.0115;
/** how quickly the lit rod settles back with its men hanging down once the mouse stops (s) */
const SETTLE = 0.09;
/** how long without sideways movement counts as the mouse having stopped (ms) */
const STILL_MS = 60;
/** the turn of men lifted by the player (feet back, as for a shot) and lifted out of the way of their own shot (feet forward) */
const LIFT_BACK = -1.35;
const LIFT_AHEAD = 1.5;
/** a shot of your own at least this fast (m/s) lifts your rods ahead of it */
const OWN_SHOT = 1.0;
const ROBOT_HAND: Hand = { slideSpeed: ROBOT.slideSpeed, turnSpeed: ROBOT.turnSpeed };
const GLIDE_IN = 0.9;
const GLIDE_OUT = 0.8;
const TAU = Math.PI * 2;
const HL = FIELD.length / 2;
const HW = FIELD.width / 2;
const OZ = HW + SIDE_WALL;

const nearestTurn = (cur: number, base: number) => base + TAU * Math.round((cur - base) / TAU);

export class Foosball {
  /** the table's frame: the playfield's centre, X along it from red's goal, Z along the rods */
  readonly table: TransformNode;
  readonly field: Mesh;
  readonly rods: FoosballRod[] = [];
  readonly ballMesh: Mesh;
  private beads = new Map<Team, Mesh>();
  private beadShown = { red: 0, blue: 0 };
  private tableWM: Matrix;
  private tableInv: Matrix;
  private floorY: number;

  // ------------------------------------------------ shared
  private seats: Record<Team, SeatMsg> = { red: null, blue: null };
  private sendSeat: Record<Team, (s: SeatMsg) => void>;
  private remote: Record<Team, RodsMsg> = { red: null, blue: null };
  private sendRods: Record<Team, (s: RodsMsg) => void>;
  private game: FoosGame;
  private sendGame: (g: FoosGame) => void;
  /** the host's last word on the game, not yet taken in (other pages) */
  private fresh = false;
  private sentAt = 0;
  private seatAt = 0;
  private rematchSeen = { red: 0, blue: 0 };
  /** this page's player's last strike (on a page that doesn't host), and the last of each side's the host took */
  private strike: Strike | null = null;
  private strikeSeen = { red: 0, blue: 0 };
  /** the last few seat changes and why this page stopped playing, for tests */
  private log: string[] = [];

  // ------------------------------------------------ local
  /** the side this visitor plays, while they play */
  side: Team | null = null;
  /** each rod as shown, and as the physics has it this frame; and at the frame's start */
  private poses: RodPose[] = RODS.map(restPose);
  private prev: RodPose[] = RODS.map(restPose);
  private tmp: RodPose[] = RODS.map(restPose);
  /** the ball as this page simulates it, and how far the shown ball still lags a correction */
  private ball: BallState = newBall();
  private lag = { x: 0, z: 0 };
  private rolling = Quaternion.Identity();
  private events: PhysicsEvent[] = [];
  private robot: RobotMind | null = null;
  private stillSince = 0;
  /** the side that touched the ball last, as this page saw it */
  private touch: Team | null = null;
  /** a goal this page's physics saw, waiting on the host's word */
  private held = false;

  // ------------------------------------------------ input
  private mouse: { x: number; y: number } | null = null;
  private flickPx = 0;
  private movedAt = 0;
  private liftHeld = false;
  /** the team-forward turn each of the player's rods is heading for */
  private forward = RODS.map(() => 0);
  private man = RODS.map(() => -1);
  /** the rod the player kicks with, the one picked by hand (or -1), and the automatic choice when it was picked */
  private active = -1;
  private picked = -1;
  private pickedAuto = -1;
  /** where the cursor points across the table (Z in the table's frame) */
  private aimZ = 0;
  /** tests: aim here instead of at the cursor */
  aimOverride: number | null = null;
  private rematches = 0;
  private coachUntil = 0;
  private viewKey = "";
  private nightShown: boolean | null = null;
  private sound = new FoosballSound();
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  private v1 = new Vector3();
  private v2 = new Vector3();
  private q1 = new Quaternion();
  private axis = new Vector3();

  constructor(
    private scene: Scene,
    private mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    private focus: ScreenFocus,
    private canvas: HTMLCanvasElement,
  ) {
    const table = find(scene, ROLE.foosballTable) as TransformNode | null;
    const field = find(scene, ROLE.foosballField) as Mesh | null;
    if (!table || !field) throw new Error("The house has no foosball table");
    this.table = table;
    this.field = field;
    this.tableWM = table.computeWorldMatrix(true).clone();
    this.tableInv = this.tableWM.clone().invert();
    this.floorY = this.tableWM.getTranslation().y - FIELD.y;
    const meshes: Mesh[] = [];
    for (const node of findAll(scene, ROLE.foosballRodSlot) as TransformNode[]) {
      const n = (node.metadata as SlotMeta).slot;
      const rod = buildFoosballRod(mats, node, n);
      rod.men.outlineColor = Color3.FromHexString("#ffe27a");
      rod.men.outlineWidth = 0.0034;
      this.rods[n - 1] = rod;
      meshes.push(...rod.meshes);
    }
    if (this.rods.length !== RODS.length || this.rods.some((r) => !r)) throw new Error("The foosball table is missing rods");
    this.ballMesh = buildFoosballBall(mats, table);
    this.ballMesh.rotationQuaternion = this.rolling;
    this.ballMesh.position.set(0, BALL_R, 0);
    meshes.push(this.ballMesh);
    for (const node of findAll(scene, ROLE.foosballCounter) as TransformNode[]) {
      const team: Team = (node.metadata as SlotMeta).slot === 1 ? "red" : "blue";
      const beads = buildFoosballBeads(mats, node, team);
      this.beads.set(team, beads);
      meshes.push(beads);
    }
    // moving parts don't cast the sun's shadow, which is drawn once
    lighting.addMeshes(meshes, []);

    // the shared state: each side's seat and rods, and the game
    const now = room.now();
    this.game = initialGame(now);
    this.sendGame = room.share<FoosGame>("foosball/game", this.game, (g) => {
      this.game = g;
      this.fresh = true;
    });
    this.sendSeat = { red: () => undefined, blue: () => undefined };
    this.sendRods = { red: () => undefined, blue: () => undefined };
    for (const team of TEAMS) {
      this.sendSeat[team] = room.share<SeatMsg>(`foosball/seat/${team}`, null, (s) => {
        // a new player counts their strikes and Rematch presses from nothing
        if (this.seats[team]?.id !== s?.id) this.strikeSeen[team] = this.rematchSeen[team] = 0;
        this.seats[team] = s;
        this.note(`${team} seat: ${s ? s.name : "free"}`);
      });
      this.sendRods[team] = room.share<RodsMsg>(`foosball/rods/${team}`, null, (r) => (this.remote[team] = r));
    }
    // a player who leaves gives up their side. The room server can say a visitor has gone while
    // they're still here, so their side only goes if they don't say they're still sitting there
    // (they do every SEAT_BEAT) soon after.
    room.onGone((id) => {
      const at = room.now();
      for (const team of TEAMS)
        if (this.seats[team]?.id === id)
          setTimeout(() => {
            const s = this.seats[team];
            if (s?.id !== id || s.at > at) return;
            this.note(`${team} player gone`);
            this.sendSeat[team](null);
          }, SEAT_BEAT * 1.5);
    });

    // the player's hands, while they play
    const playing = () => this.side !== null && store.get().focus?.kind === "foosball" && store.get().focus?.phase === "on";
    window.addEventListener("pointermove", (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!playing()) return;
      if (e.movementX) {
        this.flickPx += e.movementX;
        this.movedAt = performance.now();
      }
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (!playing()) return;
      this.sound.wake();
      if (e.button === 0) this.kick();
      else if (e.button === 2) this.liftHeld = true;
    });
    window.addEventListener("pointerup", (e) => {
      if (e.button === 2) this.liftHeld = false;
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!playing()) return;
        e.preventDefault();
        this.pickStep(e.deltaY < 0 ? 1 : -1);
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      if (this.side === null || store.get().focus?.kind !== "foosball") return;
      if (e.code === "Escape") {
        void this.leave();
        return;
      }
      if (!playing()) return;
      this.sound.wake();
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) this.kick();
      } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.liftHeld = true;
      else if (/^Digit[1-4]$/.test(e.code)) this.pickName(["goalie", "defence", "midfield", "attack"][Number(e.code[5]) - 1] as (typeof RODS)[number]["name"]);
      else if (e.code === "ArrowUp" || e.code === "KeyW") this.pickStep(1);
      else if (e.code === "ArrowDown" || e.code === "KeyS") this.pickStep(-1);
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.liftHeld = false;
    });
    window.addEventListener("blur", () => (this.liftHeld = false));
  }

  // ------------------------------------------------------------------ seats

  /** A seat, unless its player has gone quiet. */
  private seat(team: Team): SeatMsg {
    const s = this.seats[team];
    return s && room.now() - s.at < SEAT_FRESH ? s : null;
  }

  /** Who simulates the ball now. */
  private get host(): string {
    return hostFor(this.seat("red"), this.seat("blue"));
  }

  /** The side a walker at the table is offered, from where they stand: theirs if free, else the other if free. */
  private offer(near: Team): Team | null {
    if (!this.seat(near)) return near;
    if (!this.seat(OTHER[near])) return OTHER[near];
    return null;
  }

  // ------------------------------------------------------------------ walking up, playing, leaving

  /** Play the side offered (or `want`): walk mode only. Resolves once the camera is at the table. */
  async use(want?: Team): Promise<boolean> {
    const s = store.get();
    if (s.focus || !this.fly.walker || !s.walking) return false;
    const near = want ?? this.nearSide();
    const side = near ? (want ? (this.seat(want) ? null : want) : this.offer(near)) : null;
    if (!side) return false;
    this.side = side;
    this.claim(side);
    store.set({ foosballPrompt: null });
    this.fovBefore = this.fly.camera.fov;
    this.man = RODS.map(() => -1);
    this.forward = RODS.map((_, i) => (RODS[i].team === side ? nearestTurn(this.poses[i].turn * ATTACK[side], 0) : 0));
    this.picked = -1;
    this.flickPx = 0;
    this.canvas.style.cursor = "crosshair";
    let coached = false;
    try {
      coached = localStorage.getItem("chimphouse:foosball:coached") === "1";
    } catch {
      /* no storage: coach every time */
    }
    this.coachUntil = coached ? 0 : performance.now() + 12000;
    this.sound.wake();
    return this.focus.enter({ kind: "foosball", side }, this.field, () => this.playPose(side), GLIDE_IN);
  }

  private fovBefore = 1;

  private claim(side: Team): void {
    this.seatAt = room.now();
    this.sendSeat[side]({ id: VIEWER, name: ME.name, at: this.seatAt });
  }

  /** Stop playing: give up the side (the robot or nobody takes it), and glide back to where a player stands. */
  async leave(): Promise<void> {
    const side = this.side;
    const f = store.get().focus;
    if (side === null || f?.kind !== "foosball" || f.phase === "out") return;
    const wasHost = this.host === VIEWER;
    this.side = null;
    this.liftHeld = false;
    this.canvas.style.cursor = "";
    for (const r of this.rods) r.men.renderOutline = false;
    this.sendSeat[side](null);
    this.sendRods[side](null);
    if (wasHost && !this.seat(OTHER[side])) {
      this.game = idleGame(this.game, room.now());
      this.sendGame(this.game);
    }
    store.set({ foosball: null });
    try {
      localStorage.setItem("chimphouse:foosball:coached", "1");
    } catch {
      /* fine */
    }
    await this.focus.leave(this.standPose(side), GLIDE_OUT);
  }

  /** Rematch, once a match is over: the host starts it, or is asked to. */
  rematch(): void {
    if (this.side === null || this.game.phase !== "over") return;
    if (this.host === VIEWER) this.startNew(this.game.red > this.game.blue ? "blue" : "red");
    else this.rematches++;
  }

  private startNew(serve: Team): void {
    this.game = startMatch(this.game, VIEWER, serve, room.now(), Math.random());
    this.ball = { ...this.game.ball };
    this.touch = null;
    this.held = false;
    this.sendGame(this.game);
  }

  /** The camera behind a side's grips, high enough to see the whole field and both goals. */
  private playPose(side: Team): Pose {
    const s = SIDE[side];
    const engine = this.scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    // wide enough for both goals on a narrow window, never wider than a natural view
    const fov = Math.min(1.05, Math.max(0.75, 2 * Math.atan(Math.tan(0.5) * (1.6 / aspect))));
    const eye = this.toWorld(0, 0.78, s * (OZ + 0.42), this.v1);
    const at = this.toWorld(0, -0.03, -s * 0.03, this.v2);
    const dx = at.x - eye.x;
    const dy = at.y - eye.y;
    const dz = at.z - eye.z;
    return { x: eye.x, y: eye.y, z: eye.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)), fov };
  }

  /** Standing at a side's grips, looking at the table. */
  private standPose(side: Team): Pose | null {
    const walker = this.fly.walker;
    if (!walker) return null;
    const stand = this.toWorld(0, -FIELD.y, SIDE[side] * (OZ + STAND_OUT), this.v1).clone();
    const look = this.toWorld(0, 0, 0, this.v2);
    if (!walker.place(stand.x, stand.y + 0.5, stand.z, 2)) return null;
    const f = walker.feet;
    const dx = look.x - f.x;
    const dz = look.z - f.z;
    return { x: f.x, y: walker.eyeY, z: f.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(look.y - walker.eyeY, Math.hypot(dx, dz)), fov: this.fovBefore };
  }

  private toWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
    return Vector3.TransformCoordinatesFromFloatsToRef(x, y, z, this.tableWM, out);
  }

  /** The side of the table a walker is at and looking at, or null. */
  private nearSide(): Team | null {
    const walker = this.fly.walker;
    if (!walker) return null;
    const f = walker.feet;
    if (Math.abs(f.y - this.floorY) > 0.6) return null;
    const p = Vector3.TransformCoordinatesFromFloatsToRef(f.x, f.y, f.z, this.tableInv, this.v1);
    if (Math.abs(p.x) > HL + 0.1 + NEAR || Math.abs(p.z) > OZ + NEAR) return null;
    // looking at the table
    const fwd = this.fly.camera.getDirection(Vector3.Forward());
    const c = this.tableWM.getTranslation();
    const dx = c.x - f.x;
    const dz = c.z - f.z;
    const d = Math.hypot(dx, dz) || 1;
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    if ((fwd.x * dx + fwd.z * dz) / (fl * d) < Math.cos((65 * Math.PI) / 180)) return null;
    return p.z < 0 ? "red" : "blue";
  }

  private name(team: Team): string {
    const s = this.seat(team);
    return s ? (s.id === VIEWER ? "You" : s.name) : "Robot";
  }

  // ------------------------------------------------------------------ choosing the rod

  /** The player's rod nearest the ball, keeping the one in use unless another is clearly nearer. */
  private autoRod(team: Team): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < RODS.length; i++) {
      if (RODS[i].team !== team) continue;
      const d = Math.abs(RODS[i].x - this.ball.x) - (i === this.active ? 0.012 : 0);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private pickStep(dir: number): void {
    if (this.side === null) return;
    const mine = RODS.map((r, i) => (r.team === this.side ? i : -1)).filter((i) => i >= 0);
    // in the direction the side attacks: further forward with dir > 0
    if (ATTACK[this.side] < 0) mine.reverse();
    const k = mine.indexOf(this.active);
    const next = mine[Math.max(0, Math.min(mine.length - 1, k + dir))];
    this.picked = next;
    this.pickedAuto = this.autoRod(this.side);
  }

  private pickName(name: (typeof RODS)[number]["name"]): void {
    const i = RODS.findIndex((r) => r.team === this.side && r.name === name);
    if (i < 0 || this.side === null) return;
    this.picked = i;
    this.pickedAuto = this.autoRod(this.side);
  }

  /** A click or Space: the lit rod whips round in a full spin. */
  kick(): void {
    if (this.side === null || this.active < 0) return;
    this.forward[this.active] = nearestTurn(this.forward[this.active], 0) + TAU;
    this.coachUntil = Math.min(this.coachUntil, performance.now() + 2500);
  }

  /** Tests: a flick of the mouse, `px` pixels to the right. */
  flick(px: number): void {
    this.flickPx += px;
    this.movedAt = performance.now();
  }

  /** Tests: hold or let go of the lift. */
  setLift(on: boolean): void {
    this.liftHeld = on;
  }

  // ------------------------------------------------------------------ each frame

  update(dt: number): void {
    const s = store.get();
    this.showNight(s.night);
    if (this.side === null) this.offerPrompt();
    const playing = this.side !== null;
    // a game is only live while someone sits at the table (one left by a closed page isn't)
    const live = this.game.phase !== "idle" && this.host !== "";
    if (!playing && !(live && this.watching())) return;
    if (dt <= 0) return;
    const now = room.now();
    const host = this.host;
    const amHost = host === VIEWER;
    // lost the side to someone who sat at the same moment: step back
    if (this.side && this.seats[this.side]?.id !== VIEWER && now - this.seatAt > 600) {
      this.note(`lost the ${this.side} side to ${this.seats[this.side]?.name ?? "nobody"}`);
      void this.leave();
      return;
    }
    if (this.side && now - this.seatAt > SEAT_BEAT) this.claim(this.side);

    for (let i = 0; i < RODS.length; i++) copy(this.poses[i], this.prev[i]);
    // the host's word, on other pages: the game, and the ball corrected
    if (!amHost && this.fresh) this.takeWord(now);
    this.fresh = false;
    if (amHost && this.game.host !== VIEWER) this.takeOver(now);

    // the rods: this visitor's from their hands, the robot's (on the host), the rest as shared
    this.drivePlayer(dt);
    for (const team of TEAMS) {
      if (team === this.side) continue;
      const r = this.seat(team) ? this.remote[team] : amHost ? null : this.remote[team];
      if (r) this.followRemote(team, r, now);
      else if (amHost && !this.seat(team)) this.driveRobot(team, dt, now);
    }

    // the ball
    if (amHost) this.hostStep(dt, now);
    else if (this.game.phase === "play" && !this.held) this.predict(dt);
    for (const e of this.events.splice(0)) this.hear(e, now);

    // send what this page owns
    if (now - this.sentAt >= SEND_MS) {
      this.sentAt = now;
      if (this.side) this.sendRods[this.side]({ t: now, p: this.packRods(this.side), rematch: this.rematches, hit: amHost ? null : this.strike });
      if (amHost) {
        for (const team of TEAMS) if (!this.seat(team) && team !== this.side) this.sendRods[team]({ t: now, p: this.packRods(team), rematch: 0 });
        if (this.game.phase === "play") this.sendGame({ ...this.game, ball: { ...this.ball }, at: now, touch: this.touch });
        else if (this.game.phase !== "idle" && now - this.game.at > 1000) this.sendGame((this.game = { ...this.game, at: now }));
      }
    }
    this.show(dt, now);
    this.updateView(now);
  }

  /** Whether this page should show a game it isn't playing: its camera is near the table. */
  private watching(): boolean {
    const c = this.fly.camera.position;
    const t = this.tableWM.getTranslation();
    return Vector3.DistanceSquared(c, t) < WATCH * WATCH;
  }

  private offerPrompt(): void {
    const s = store.get();
    let p: typeof s.foosballPrompt = null;
    if (s.walking && !s.focus) {
      const near = this.nearSide();
      if (near) {
        const side = this.offer(near);
        p = side ? { side, against: this.seat(OTHER[side])?.name ?? "the robot" } : { full: `${this.seat("red")!.name} vs ${this.seat("blue")!.name}` };
      }
    }
    const was = s.foosballPrompt;
    if (JSON.stringify(was) !== JSON.stringify(p)) store.set({ foosballPrompt: p });
  }

  /**
   * This page became the host: carry on a match that was going a moment ago (its host
   * left, or red's player sat down), from where this page has the ball; else start one.
   */
  private takeOver(now: number): void {
    this.note(`hosting from ${this.game.phase}`);
    this.robot = null;
    const going = this.game.phase === "play" || this.game.phase === "serve" || this.game.phase === "goal";
    if (going && this.game.host && now - this.game.at < 3000) {
      this.game = { ...this.game, host: VIEWER, ball: this.game.phase === "play" ? { ...this.ball } : this.game.ball, at: now };
      this.sendGame(this.game);
      return;
    }
    this.startNew(Math.random() < 0.5 ? "red" : "blue");
  }

  /** The host's word on another page: the phase and score as said, and the ball run on from when it was sent to now. */
  private takeWord(now: number): void {
    const g = this.game;
    this.touch = g.touch;
    if (g.phase !== "play") {
      this.held = false;
      this.ball = { ...g.ball };
      this.lag.x = this.lag.z = 0;
      return;
    }
    const was = { ...this.ball };
    const b = { ...g.ball };
    const age = Math.max(0, Math.min(0.15, (now - g.at) / 1000));
    if (age > 0) advance(b, age, (_, out) => copyAll(this.poses, out), this.tmp, []);
    const jump = Math.hypot(b.x - was.x, b.z - was.z);
    if (this.held || jump > 0.12) this.lag.x = this.lag.z = 0;
    else {
      this.lag.x += was.x - b.x;
      this.lag.z += was.z - b.z;
    }
    this.held = false;
    this.ball = b;
  }

  /** The other pages' guess of the ball between the host's words: the same physics with the rods as they are. */
  private predict(dt: number): void {
    const inPlay = advance(this.ball, dt, (t, out) => this.rodsAt(t, dt, out), this.tmp, this.events);
    // a goal is the host's to call: hold the ball where it went in until it says so
    if (!inPlay) this.held = true;
    for (const e of this.events)
      if (e.kind === "man") {
        this.touch = RODS[e.rod].team;
        // the player's own strike: told to the host with their rods
        if (this.side && RODS[e.rod].team === this.side && e.speed > 0.3) {
          const b = this.ball;
          this.strike = { n: (this.strike?.n ?? 0) + 1, t: room.now(), x: b.x, z: b.z, vx: b.vx, vz: b.vz };
        }
      }
  }

  /** On the host: another player's strike, as their page saw it, taken if it's where the ball is here. */
  private takeStrikes(now: number): void {
    if (this.game.phase !== "play") return;
    for (const team of TEAMS) {
      const h = this.seat(team) && team !== this.side ? this.remote[team]?.hit : null;
      if (!h || h.n <= this.strikeSeen[team]) continue;
      this.strikeSeen[team] = h.n;
      const age = Math.max(0, Math.min(0.15, (now - h.t) / 1000));
      const x = h.x + h.vx * age;
      const z = h.z + h.vz * age;
      if (Math.hypot(x - this.ball.x, z - this.ball.z) > 0.1) continue;
      this.ball = { x, z, vx: h.vx, vz: h.vz };
      this.touch = team;
    }
  }

  /** The host's step: the phase by the clock, the ball through the physics, goals, dead balls, rematches. */
  private hostStep(dt: number, now: number): void {
    let g = this.game;
    for (const team of TEAMS) {
      const n = this.remote[team]?.rematch ?? 0;
      if (team !== this.side && this.seat(team) && n > this.rematchSeen[team]) {
        this.rematchSeen[team] = n;
        if (g.phase === "over") {
          this.startNew(g.red > g.blue ? "blue" : "red");
          return;
        }
      }
    }
    const next = advanceGame(g, now, Math.random());
    if (next !== g) {
      if (next.phase === "serve") this.sound.serve();
      if (next.phase === "play" || next.phase === "serve") this.ball = { ...next.ball };
      g = this.game = next;
      this.sendGame(g);
    }
    if (g.phase !== "play") return;
    this.takeStrikes(now);
    const inPlay = advance(this.ball, dt, (t, out) => this.rodsAt(t, dt, out), this.tmp, this.events);
    for (const e of this.events) if (e.kind === "man") this.touch = RODS[e.rod].team;
    if (!inPlay) {
      const goal = this.events.find((e) => e.kind === "goal");
      const into = goal?.kind === "goal" ? goal.into : this.ball.x < 0 ? "red" : "blue";
      this.game = scoreGoal({ ...g, ball: { ...this.ball }, touch: this.touch }, into, now);
      this.sendGame(this.game);
      return;
    }
    // a dead ball: served again from the half it stopped in
    if (Math.hypot(this.ball.vx, this.ball.vz) > 0.03) this.stillSince = now;
    else if (now - this.stillSince > TIMING.dead) {
      this.stillSince = now;
      this.game = serveBall({ ...g, ball: { ...this.ball } }, halfOf(this.ball), now, Math.random());
      this.ball = { ...this.game.ball };
      this.sound.serve();
      this.sendGame(this.game);
    }
  }

  /** The rods at time t into this frame, moving steadily from where they were to where they are. */
  private rodsAt(t: number, dt: number, out: RodPose[]): void {
    const k = Math.max(0, Math.min(1, t / dt));
    for (let i = 0; i < RODS.length; i++) {
      const a = this.prev[i];
      const b = this.poses[i];
      const o = out[i];
      o.slide = a.slide + (b.slide - a.slide) * k;
      o.turn = a.turn + (b.turn - a.turn) * k;
      o.slideV = b.slideV;
      o.turnV = b.turnV;
    }
  }

  /** The player's rods from their hands: slide to the cursor's line, turn the lit rod by the flick. */
  private drivePlayer(dt: number): void {
    const side = this.side;
    if (!side) {
      for (const r of this.rods) r.men.renderOutline = false;
      return;
    }
    const a = ATTACK[side];
    this.aimZ = this.aimOverride ?? this.cursorZ() ?? this.aimZ;
    // the lit rod: the one nearest the ball, unless one was picked and the ball hasn't moved on
    const auto = this.autoRod(side);
    if (this.picked >= 0 && auto !== this.pickedAuto) this.picked = -1;
    const active = this.picked >= 0 ? this.picked : auto;
    if (active !== this.active) {
      if (this.active >= 0) this.rods[this.active].men.renderOutline = false;
      this.active = active;
      this.rods[active].men.renderOutline = true;
    }
    const still = performance.now() - this.movedAt > STILL_MS;
    const settle = 1 - Math.exp(-dt / SETTLE);
    const ownShot = this.touch === side && this.ball.vx * a > OWN_SHOT;
    for (let i = 0; i < RODS.length; i++) {
      if (RODS[i].team !== side) continue;
      const ahead = (RODS[i].x - this.ball.x) * a;
      if (ownShot && ahead > -0.11 && ahead < 0.35) this.forward[i] = nearestTurn(this.forward[i], LIFT_AHEAD);
      else if (this.liftHeld) this.forward[i] = nearestTurn(this.forward[i], LIFT_BACK);
      else {
        if (i === active) this.forward[i] += this.flickPx * FLICK;
        if (i !== active || still) this.forward[i] += (nearestTurn(this.forward[i], 0) - this.forward[i]) * settle;
      }
      const target = slideFor(i, this.aimZ, this.man[i]);
      this.man[i] = target.man;
      driveRod(i, this.poses[i], target.slide, a * this.forward[i], dt, PLAYER_HAND);
    }
    this.flickPx = 0;
  }

  /** The robot's side: its targets, through hands as quick as a person's. */
  private driveRobot(team: Team, dt: number, now: number): void {
    if (!this.robot || this.robot.team !== team) this.robot = newRobot(team);
    const targets = robotPlay(this.robot, this.ball, this.poses, this.touch, now / 1000, Math.random);
    const a = ATTACK[team];
    this.robot.rods.forEach((i, k) => driveRod(i, this.poses[i], targets[k].slide, a * targets[k].forward, dt, ROBOT_HAND));
  }

  /** Another page's rods: where they were sent, run on by their speed for as long as the message took (at most a tenth of a second). */
  private followRemote(team: Team, r: NonNullable<RodsMsg>, now: number): void {
    const age = Math.max(0, Math.min(0.1, (now - r.t) / 1000));
    let k = 0;
    for (let i = 0; i < RODS.length; i++) {
      if (RODS[i].team !== team) continue;
      const p = this.poses[i];
      const travel = RODS[i].travel;
      p.slideV = r.p[k + 2];
      p.turnV = r.p[k + 3];
      p.slide = Math.max(-travel, Math.min(travel, r.p[k] + p.slideV * age));
      p.turn = r.p[k + 1] + p.turnV * age;
      k += 4;
    }
  }

  private packRods(team: Team): number[] {
    const out: number[] = [];
    for (let i = 0; i < RODS.length; i++) {
      if (RODS[i].team !== team) continue;
      const p = this.poses[i];
      out.push(round4(p.slide), round4(p.turn), round4(p.slideV), round4(p.turnV));
    }
    return out;
  }

  /** Where the cursor points across the table: the line across it under the cursor, at the ball's height. */
  private cursorZ(): number | null {
    if (!this.mouse) return null;
    const engine = this.scene.getEngine();
    const box = this.canvas.getBoundingClientRect();
    const x = ((this.mouse.x - box.left) / box.width) * engine.getRenderWidth();
    const y = ((this.mouse.y - box.top) / box.height) * engine.getRenderHeight();
    this.scene.createPickingRayToRef(x, y, null, this.ray, this.fly.camera);
    const o = Vector3.TransformCoordinatesToRef(this.ray.origin, this.tableInv, this.v1);
    const d = Vector3.TransformNormalToRef(this.ray.direction, this.tableInv, this.v2);
    if (Math.abs(d.y) < 1e-4) return null;
    const t = (BALL_R - o.y) / d.y;
    if (t < 0) return null;
    return o.z + d.z * t;
  }

  /** A sound for what happened, and the coach's tip goes once the player has kicked. */
  private hear(e: PhysicsEvent, now: number): void {
    if (e.kind === "man") {
      this.sound.knock(Math.min(1, e.speed / 4), this.distance());
      if (this.side && RODS[e.rod].team === this.side && e.speed > 1) this.coachUntil = Math.min(this.coachUntil, performance.now() + 2500);
    } else if (e.kind === "wall") this.sound.clack(Math.min(1, e.speed / 4), this.distance());
    else if (e.kind === "goal") this.sound.goal(this.distance());
    void now;
  }

  private distance(): number {
    return Vector3.Distance(this.fly.camera.position, this.tableWM.getTranslation());
  }

  // ------------------------------------------------------------------ showing it

  private show(dt: number, now: number): void {
    for (let i = 0; i < RODS.length; i++) {
      const root = this.rods[i].root;
      root.position.z = this.poses[i].slide;
      root.rotation.z = this.poses[i].turn;
    }
    // the ball, by the phase
    const g = this.game;
    const t = now - g.since;
    const b = this.ballMesh;
    b.isVisible = true;
    if (g.phase === "serve") {
      // it drops into the serve cup, through the wall, and rolls out of the hole at the wall's foot
      const s = SIDE[g.serve];
      const k = t / TIMING.serve;
      const cupZ = s * (OZ - SIDE_WALL / 2);
      if (k < 0.35) b.position.set(0, WALL_TOP + 0.03 + BALL_R - (k / 0.35) * 0.05, cupZ);
      else if (k < 0.7) b.isVisible = false;
      else {
        const e = (k - 0.7) / 0.3;
        b.position.set(g.ball.x * e, BALL_R, s * (HW + BALL_R) + (g.ball.z - s * (HW + BALL_R)) * e);
      }
    } else if (g.phase === "goal" || g.phase === "over") {
      // into the goal box and down, then out of the ball return at that end
      const sx = g.into === "red" ? -1 : 1;
      if (g.phase === "goal" && t < TIMING.goalDrop) {
        const e = t / TIMING.goalDrop;
        b.position.set(sx * (HL + BALL_R + 0.05 * e), BALL_R - 0.06 * e * e, Math.max(-GOAL.half + BALL_R, Math.min(GOAL.half - BALL_R, g.ball.z)));
      } else if (g.phase === "goal" && t < TIMING.goalReturn) b.isVisible = false;
      else {
        const e = g.phase === "over" ? 1 : Math.min(1, (t - TIMING.goalReturn) / 250);
        b.position.set(sx * (RETURN_CUP.x - 0.03 * (1 - e)), RETURN_CUP.y, 0);
      }
    } else {
      // in play: where the physics has it, easing off any correction from the host
      const ease = Math.exp(-dt / 0.08);
      this.lag.x *= ease;
      this.lag.z *= ease;
      const x = this.ball.x + this.lag.x;
      const z = this.ball.z + this.lag.z;
      // rolling: about the horizontal line across its path, by the distance it went
      const dx = x - b.position.x;
      const dz = z - b.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-5 && d < 0.2 && g.phase === "play") {
        this.axis.set(dz / d, 0, -dx / d);
        Quaternion.RotationAxisToRef(this.axis, d / BALL_R, this.q1);
        this.q1.multiplyToRef(this.rolling, this.rolling);
        this.rolling.normalize();
      }
      b.position.set(x, BALL_R, z);
    }
    // the counters' beads slide to the score
    for (const team of TEAMS) {
      const want = team === "red" ? g.red : g.blue;
      const cur = this.beadShown[team];
      if (cur !== want) {
        const nxt = want < cur ? want : Math.min(want, cur + dt / 0.35);
        this.beadShown[team] = nxt;
        const m = this.beads.get(team);
        if (m) setBeads(m, team, nxt);
      }
    }
  }

  /** The playfield glows a little more at night, as if lit by the lamp over the table. */
  private showNight(night: boolean): void {
    if (this.nightShown === night) return;
    this.nightShown = night;
    const m = this.mats.get("foosField") as PBRMaterial;
    m.emissiveColor = Color3.FromHexString(night ? "#8a8a8a" : "#2a2a2a");
  }

  /** The HUD's view of the game, set in the store when it changes. */
  private updateView(now: number): void {
    const side = this.side;
    if (!side) return;
    const g = this.game;
    const t = now - g.since;
    const callout =
      g.phase === "goal" ? (g.into === OTHER[side] ? "GOAL!" : t < 1200 ? "Goal for " + this.name(OTHER[side]).replace("You", "you") : null) : g.phase === "serve" ? (g.serve === side ? "Your serve" : "Their serve") : null;
    const view: FoosballView = {
      you: side,
      names: { red: this.name("red"), blue: this.name("blue") },
      red: g.red,
      blue: g.blue,
      phase: g.phase,
      winner: g.phase === "over" ? winner(g) : null,
      active: { slot: this.active + 1, name: this.active >= 0 ? ROD_LABEL[RODS[this.active].name] : "", picked: this.picked >= 0 },
      callout,
      coach: performance.now() < this.coachUntil,
    };
    const key = JSON.stringify(view);
    if (key !== this.viewKey) {
      this.viewKey = key;
      store.set({ foosball: view });
    }
  }

  // ------------------------------------------------------------------ tests

  private note(what: string): void {
    this.log.push(`${Math.round(performance.now())} ${what}`);
    if (this.log.length > 12) this.log.shift();
  }

  /** Where things are and how the game stands, for tests. */
  describe() {
    const t = this.table.getAbsolutePosition();
    return {
      table: [t.x, t.y, t.z],
      side: this.side,
      host: this.host,
      seats: { red: this.seat("red"), blue: this.seat("blue") },
      game: { phase: this.game.phase, red: this.game.red, blue: this.game.blue, serve: this.game.serve, into: this.game.into, host: this.game.host, serial: this.game.serial },
      ball: { ...this.ball },
      shown: this.ballMesh.position.asArray(),
      rods: this.poses.map((p) => ({ ...p })),
      active: this.active + 1,
      picked: this.picked + 1,
      aimZ: this.aimZ,
      touch: this.touch,
      robot: this.robot?.team ?? null,
      log: [...this.log],
    };
  }

  /** Tests, on the host: put the ball somewhere on the field, rolling, in play. */
  place(x: number, z: number, vx = 0, vz = 0): void {
    if (this.host !== VIEWER) return;
    this.ball = newBall(x, z, vx, vz);
    this.stillSince = room.now();
    this.game = { ...this.game, phase: "play", since: room.now(), ball: { ...this.ball }, at: room.now() };
    this.sendGame(this.game);
  }

  /** Tests: everyone's table back as nobody has played it. */
  reset(): void {
    for (const team of TEAMS) {
      this.sendSeat[team](null);
      this.sendRods[team](null);
    }
    this.game = initialGame(room.now());
    this.sendGame(this.game);
  }

  /** Tests, on the host: the score set, as if goals had gone in. */
  setScore(red: number, blue: number): void {
    if (this.host !== VIEWER) return;
    this.game = { ...this.game, red: Math.min(WIN_SCORE, red), blue: Math.min(WIN_SCORE, blue) };
    this.sendGame(this.game);
  }
}

function copy(a: RodPose, out: RodPose): void {
  out.slide = a.slide;
  out.turn = a.turn;
  out.slideV = a.slideV;
  out.turnV = a.turnV;
}

function copyAll(a: RodPose[], out: RodPose[]): void {
  for (let i = 0; i < a.length; i++) copy(a[i], out[i]);
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

export type { MeshMeta };
