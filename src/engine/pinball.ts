// The Game Room's two pinball machines in the page: their moving parts, lamps
// and displays, attract mode while nobody plays, and playing one.
//
// Machines are found by role and slot (world/roles.ts): the playfield node
// (pinball-machine) carries the moving parts, the display (pinball-dmd) shows
// the score. The table each runs is its definition (world/props/pinballTables.ts),
// its physics and rules pure modules (pinballPhysics.ts, pinballRules.ts).
//
// Walking up to a machine and looking at it offers it (E). Playing, the camera
// stands at the front looking down the playfield with the backbox's display in
// view, ChimpHouse's own keys stop (engine/focus.ts) and the machine's keys work:
// the flippers (Shift or Z and /), the plunger (hold Space or Down), nudging
// (X and . or the arrows), a new game (Enter), and Esc to leave.
//
// Shared through the room (engine/room.ts): who is playing each machine, so
// one visitor plays it at a time, and each machine's high scores.

import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { SlotMeta } from "../world/context";
import { Materials } from "../world/materials/library";
import { PinballParts, buildPinballParts } from "../world/props/pinball";
import { PF, TABLES, TableDef, tableName } from "../world/props/pinballTables";
import { ROLE, find, findAll } from "../world/roles";
import { Dmd, DMD_H, DMD_W } from "./pinballDmd";
import { FlyCamera, Pose, isTyping } from "./flyCamera";
import { ScreenFocus, pickAt } from "./focus";
import { Lighting } from "./lighting";
import { Table } from "./pinballPhysics";
import { Blink, Game } from "./pinballRules";
import { playCue } from "./pinballSound";
import { ME, room } from "./room";
import { PinballHud, VIEWER, store } from "./store";

/** How near (m) the camera must be for a machine's attract mode to run. */
const ATTRACT_NEAR = 9;
/** How near a machine's front a walker must stand to play it (m), and how squarely they must look at it. */
const REACH = 1.3;
const LOOK = Math.cos((50 * Math.PI) / 180);
const GLIDE_IN = 0.9;
const GLIDE_OUT = 0.7;
/** The player's eye and where they look, in the playfield's frame (x across, y out of it, z up it), and the view's height (fov). */
const EYE = new Vector3(0, 0.78, -0.3);
const AIM = new Vector3(0, 0, 0.65);
const FOV = 1.0;
const HIGH_KEY = (id: string) => `chimphouse.pinball.${id}.high.v1`;

export type HighScore = { name: string; score: number };

interface Machine {
  def: TableDef;
  node: TransformNode;
  screen: Mesh;
  parts: PinballParts;
  dmd: Dmd;
  table: Table;
  game: Game;
  /** attract mode's clock and the last lamp step drawn */
  t: number;
  step: number;
  dmdAt: number;
  high: HighScore[];
  /** who is playing it (a visitor id), shared */
  player: { id: string; name: string } | null;
  setPlayer: (p: { id: string; name: string } | null) => void;
  setHigh: (h: HighScore[]) => void;
}

export class Pinball {
  readonly machines: Machine[] = [];
  /** the machine this visitor is playing */
  private playing: Machine | null = null;
  private fovBefore = 1;
  private keys = new Set<string>();

  constructor(
    private scene: Scene,
    mats: Materials,
    lighting: Lighting,
    private fly: FlyCamera,
    private focus: ScreenFocus,
    private canvas: HTMLCanvasElement,
  ) {
    for (const node of findAll(scene, ROLE.pinballMachine)) {
      if (!(node instanceof TransformNode)) continue;
      const n = (node.metadata as SlotMeta).slot;
      const def = TABLES.find((t) => t.slot === n);
      const screen = find(scene, ROLE.pinballDmd, n);
      if (!def || !(screen instanceof Mesh)) continue;
      node.computeWorldMatrix(true);
      const parts = buildPinballParts(mats, node, def);
      lighting.addMeshes(parts.meshes, []);
      const dmd = new Dmd(mats, screen, `pin${n}:dmd`, def.theme.dmd);
      const table = new Table(def);
      const m: Machine = { def, node, screen, parts, dmd, table, game: new Game(def, table), t: Math.random() * 10, step: -1, dmdAt: 0, high: loadHigh(def), player: null, setPlayer: () => {}, setHigh: () => {} };
      m.setPlayer = room.share<{ id: string; name: string } | null>(`pinball/${n}/player`, null, (p) => {
        m.player = p;
        // someone else took the machine this visitor is playing (both pressed E at once; the room picks one)
        if (this.playing === m && p && p.id !== VIEWER) void this.leave();
      });
      m.setHigh = room.share<HighScore[]>(`pinball/${n}/high`, m.high, (h) => {
        const merged = mergeHigh(m.high, h);
        m.high = merged;
        saveHigh(def, merged);
        if (merged.length !== h.length || merged.some((e, i) => e.score !== h[i]?.score)) queueMicrotask(() => m.setHigh(merged));
      });
      this.machines.push(m);
    }
    room.onGone((id) => {
      for (const m of this.machines) if (m.player?.id === id) m.setPlayer(null);
    });
    window.addEventListener("keydown", (e) => this.key(e, true), true);
    window.addEventListener("keyup", (e) => this.key(e, false), true);
    window.addEventListener("blur", () => this.releaseAll());
  }

  /** The machine in a slot. */
  machine(slot: number): Machine | undefined {
    return this.machines.find((m) => m.def.slot === slot);
  }

  /** Each frame: the game being played, attract mode on the machines near the camera, and the prompt. */
  update(dt: number): void {
    const cam = this.fly.camera.position;
    for (const m of this.machines) {
      if (m === this.playing) this.play(m, dt);
      else if (m.node.getAbsolutePosition().subtract(cam).length() <= ATTRACT_NEAR) {
        m.t += dt;
        this.attract(m);
      }
    }
    const s = store.get();
    if (s.focus) return;
    const at = s.walking && this.fly.enabled ? this.machineAt() : null;
    const busy = at && at.player && at.player.id !== VIEWER ? at.player.name : null;
    const was = s.pinballPrompt;
    if ((at?.def.slot ?? null) !== (was?.slot ?? null) || busy !== (was?.busy ?? null)) store.set({ pinballPrompt: at ? { slot: at.def.slot, name: tableName(at.def), busy } : null });
  }

  /** Play a machine: walk mode only, and not while someone else is playing it. Resolves once the camera is there. */
  async use(slot: number): Promise<boolean> {
    const m = this.machine(slot);
    const s = store.get();
    if (!m || s.focus || !this.fly.walker || !s.walking) return false;
    if (m.player && m.player.id !== VIEWER) return false;
    m.setPlayer({ id: VIEWER, name: ME.name });
    this.playing = m;
    this.fovBefore = this.fly.camera.fov;
    store.set({ pinballPrompt: null });
    const ok = await this.focus.enter({ kind: "pinball", slot, name: tableName(m.def) }, m.screen, () => this.pose(m), GLIDE_IN);
    if (ok && m.game.state === "over") this.start(m);
    else if (!ok && store.get().focus?.kind !== "pinball" && this.playing === m) {
      this.playing = null;
      if (m.player?.id === VIEWER) m.setPlayer(null);
    }
    return ok;
  }

  /** Stop playing: the game ends there, the machine is free, and the camera glides back to where a player stands. */
  async leave(): Promise<void> {
    const m = this.playing;
    const f = store.get().focus;
    if (!m || f?.kind !== "pinball" || f.phase === "out") return;
    this.releaseAll();
    this.endGame(m);
    m.table.clear();
    m.game.state = "over";
    this.playing = null;
    if (m.player?.id === VIEWER) m.setPlayer(null);
    store.set({ pinball: null });
    const wm = m.node.computeWorldMatrix(true);
    const stand = Vector3.TransformCoordinates(Vector3.FromArray((m.node.metadata as SlotMeta).stand), wm);
    const look = Vector3.TransformCoordinates(new Vector3(0, 0.3, 0.5), wm);
    const walker = this.fly.walker;
    let pose: Pose | null = null;
    if (walker && walker.place(stand.x, stand.y + 0.5, stand.z, 2)) {
      const ft = walker.feet;
      const dx = look.x - ft.x;
      const dz = look.z - ft.z;
      pose = { x: ft.x, y: walker.eyeY, z: ft.z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(look.y - walker.eyeY, Math.hypot(dx, dz)), fov: this.fovBefore };
    }
    await this.focus.leave(pose, GLIDE_OUT);
  }

  /** A canvas click on a machine within reach plays it. */
  click(e: MouseEvent): boolean {
    if (!store.get().walking || store.get().focus) return false;
    const hit = pickAt(this.scene, this.canvas, e);
    if (!hit || hit.distance > REACH + 1.2) return false;
    const label = (hit.mesh.metadata as { labels?: { label: string }[]; role?: string; slot?: number } | undefined) ?? {};
    const m = label.role === ROLE.pinballDmd ? this.machine(label.slot ?? 0) : this.machineAt();
    if (!m || !store.get().pinballPrompt || m.def.slot !== store.get().pinballPrompt!.slot) return false;
    void this.use(m.def.slot);
    return true;
  }

  /** Start a new game on the machine being played. */
  start(m = this.playing): void {
    if (!m || m.game.state !== "over") return;
    m.game.start();
  }

  /** The camera at the front of the machine, looking down its playfield with the display in view. */
  pose(m: Machine): Pose {
    const wm = m.node.computeWorldMatrix(true);
    const eye = Vector3.TransformCoordinates(EYE, wm);
    const aim = Vector3.TransformCoordinates(AIM, wm);
    const d = aim.subtract(eye);
    return { x: eye.x, y: eye.y, z: eye.z, yaw: Math.atan2(d.x, d.z), pitch: -Math.atan2(d.y, Math.hypot(d.x, d.z)), fov: FOV };
  }

  /** The machine the walker can play: standing at its front and looking at it. */
  private machineAt(): Machine | null {
    const walker = this.fly.walker;
    if (!walker) return null;
    const feet = walker.feet;
    const fwd = this.fly.camera.getDirection(Vector3.Forward());
    let best: Machine | null = null;
    let bestD = REACH;
    for (const m of this.machines) {
      const wm = m.node.computeWorldMatrix(true);
      const stand = Vector3.TransformCoordinates(Vector3.FromArray((m.node.metadata as SlotMeta).stand), wm);
      if (Math.abs(feet.y - stand.y) > 0.6) continue;
      const d = Math.hypot(stand.x - feet.x, stand.z - feet.z);
      if (d >= bestD) continue;
      const c = Vector3.TransformCoordinates(new Vector3(0, 0.1, 0.5), wm);
      const to = c.subtract(this.fly.camera.position).normalize();
      if (Vector3.Dot(to, fwd) < LOOK) continue;
      best = m;
      bestD = d;
    }
    return best;
  }

  // ------------------------------------------------ input

  private key(e: KeyboardEvent, down: boolean): void {
    const m = this.playing;
    const f = store.get().focus;
    if (!m || f?.kind !== "pinball" || isTyping(e)) return;
    const k = e.code;
    const known = ["ShiftLeft", "ShiftRight", "KeyZ", "Slash", "Space", "ArrowDown", "KeyX", "Period", "ArrowLeft", "ArrowRight", "ArrowUp", "Enter", "NumpadEnter", "Digit1", "Escape"];
    if (!known.includes(k)) return;
    e.preventDefault();
    e.stopPropagation();
    if (f.phase !== "on") return;
    if (down && e.repeat) return;
    if (k === "Escape") {
      if (down) void this.leave();
      return;
    }
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    this.input(m, k, down);
  }

  /** A control on the machine pressed or let go. */
  input(m: Machine, k: string, down: boolean): void {
    const g = m.game;
    if (k === "ShiftLeft" || k === "KeyZ" || k === "ShiftRight" || k === "Slash") {
      const side = k === "ShiftLeft" || k === "KeyZ" ? "L" : "R";
      const held = side === "L" ? this.keys.has("ShiftLeft") || this.keys.has("KeyZ") : this.keys.has("ShiftRight") || this.keys.has("Slash");
      if (g.state === "over") return;
      m.table.setFlipper(side, down || held);
      if (down && !m.table.dead) {
        playCue("flipper");
        g.flipper(side);
      }
    } else if (k === "Space" || k === "ArrowDown") {
      if (g.state === "over" && down) return this.start(m);
      m.table.setPlunger(down || this.keys.has("Space") || this.keys.has("ArrowDown"));
    } else if (down && (k === "Enter" || k === "NumpadEnter" || k === "Digit1")) this.start(m);
    else if (down && g.state === "play") {
      const [dx, dy] = k === "KeyX" || k === "ArrowLeft" ? [-0.2, 0.1] : k === "Period" || k === "ArrowRight" ? [0.2, 0.1] : [0, 0.22];
      m.table.nudge(dx, dy);
      g.nudge();
      playCue("post");
    }
  }

  private releaseAll(): void {
    this.keys.clear();
    const m = this.playing;
    if (!m) return;
    m.table.setFlipper("L", false);
    m.table.setFlipper("R", false);
    m.table.setPlunger(false);
  }

  // ------------------------------------------------ playing

  private play(m: Machine, dt: number): void {
    const was = m.game.state;
    m.table.advance(Math.min(dt, 0.05));
    m.game.update(Math.min(dt, 0.05));
    for (const c of m.game.cues.splice(0)) playCue(c);
    if (was !== "over" && m.game.state === "over") this.endGame(m);
    this.show(m);
    // the display at about 25 frames a second
    m.dmdAt -= dt;
    if (m.dmdAt <= 0) {
      m.dmdAt = 0.04;
      this.drawPlay(m);
    }
    const g = m.game;
    const hud: PinballHud = {
      slot: m.def.slot,
      name: tableName(m.def),
      state: g.state,
      score: g.score,
      ball: g.ball,
      status: g.status,
      high: m.high,
      pull: m.table.plunger.pull / PF.plungerPull,
      tilted: g.tilted,
      extra: g.extra,
    };
    const was2 = store.get().pinball;
    if (!was2 || was2.score !== hud.score || was2.ball !== hud.ball || was2.state !== hud.state || was2.status !== hud.status || Math.abs(was2.pull - hud.pull) > 0.04 || was2.high !== hud.high || was2.tilted !== hud.tilted || was2.extra !== hud.extra) store.set({ pinball: hud });
  }

  /** A finished game's score into the machine's high scores (shared through the room). */
  private endGame(m: Machine): void {
    const score = m.game.score;
    if (score <= 0) return;
    const merged = mergeHigh(m.high, [{ name: ME.name, score }]);
    if (merged.some((e) => e.score === score && e.name === ME.name)) {
      m.high = merged;
      saveHigh(m.def, merged);
      m.setHigh(merged);
      if (merged[0].score === score) m.game.say("NEW HIGH SCORE", score.toLocaleString("en-US"), 4, true);
    }
  }

  /** The table's moving parts where the physics has them, and the lamps as the rules light them. */
  private show(m: Machine): void {
    const { parts, table } = m;
    table.balls.forEach((b, i) => {
      const mesh = parts.balls[i];
      const on = b.mode === "free" || b.mode === "ramp" || b.mode === "held";
      if (mesh.isEnabled(false) !== on) mesh.setEnabled(on);
      if (on) mesh.position.set(b.x, b.h, b.y);
    });
    table.flippers.forEach((f, i) => (parts.flippers[i].rotation.y = -f.angle));
    parts.plunger.position.z = PF.plungerY - table.plunger.pull;
    table.spinners.forEach((s, i) => (parts.spinners[i].rotation.x = s.angle));
    m.def.targets
      .filter((t) => t.drop)
      .forEach((t, i) => {
        const mesh = parts.drops[i];
        const want = table.dropped(t.id) ? -0.03 : 0.013;
        mesh.position.y += (want - mesh.position.y) * 0.5;
      });
    const g = m.game;
    if (g.state === "over") {
      // between games the lamps chase, as in attract mode
      m.t += 1 / 60;
      this.chase(m);
      return;
    }
    const slow = Math.floor(g.t * 4) % 2 === 0;
    const fast = Math.floor(g.t * 12) % 2 === 0;
    parts.lamps.names.forEach((name, i) => {
      const b: Blink = g.lamps.get(name) ?? 0;
      parts.lamps.set(i, b === 1 || (b === 2 && slow) || (b === 3 && fast));
    });
    parts.lamps.flush();
  }

  /** The display while playing: a message, the score, or the end of the game. */
  private drawPlay(m: Machine): void {
    const d = m.dmd;
    const g = m.game;
    d.clear();
    const msg = g.message;
    if (msg) {
      if (msg.big) {
        const on = msg.top === "TILT" || Math.floor(g.t * 6) % 6 !== 0;
        if (on) d.fit(msg.top, DMD_W / 2, msg.bottom ? 11 : 16, msg.bottom ? 14 : 20, 124);
        if (msg.bottom) d.fit(msg.bottom, DMD_W / 2, 26, 7, 124, { shade: 0.75 });
      } else {
        d.fit(msg.top, DMD_W / 2, 9, 9, 124);
        if (msg.bottom) d.fit(msg.bottom, DMD_W / 2, 23, 12, 124);
      }
    } else if (g.state === "over") {
      const page = Math.floor(g.t / 3) % 2;
      if (page === 0) {
        d.text("GAME OVER", DMD_W / 2, 9, 8, { shade: 0.7 });
        d.text(g.score.toLocaleString("en-US"), DMD_W / 2, 23, 12);
      } else {
        d.text("PRESS ENTER", DMD_W / 2, 10, 9);
        d.text("TO PLAY AGAIN", DMD_W / 2, 23, 7, { shade: 0.7 });
      }
    } else {
      d.text(`BALL ${g.ball}`, 2, 4, 5, { align: "left", shade: 0.6 });
      if (g.bonusX > 1) d.text(`${g.bonusX}X`, DMD_W - 2, 4, 5, { align: "right", shade: 0.6 });
      d.fit(g.score.toLocaleString("en-US"), DMD_W / 2, 15, 18, 120);
      // the bottom line: the mode running, or the best score to beat
      const mode = g.rules.status();
      const best = m.high[0];
      d.fit(mode || (best ? `HIGH SCORE ${best.score.toLocaleString("en-US")}` : g.saving ? "BALL SAVE" : ""), DMD_W / 2, DMD_H - 4, 5, 124, { shade: 0.7 });
    }
    d.present();
  }

  /** Attract mode: the lamps chase, and the display cycles its pages (high scores among them). */
  private attract(m: Machine): void {
    const step = Math.floor(m.t * 8);
    if (step === m.step) return;
    this.chase(m);
    if (step % 2) return;
    this.attractDmd(m);
  }

  /** The lamps' chase patterns. */
  private chase(m: Machine): void {
    const step = Math.floor(m.t * 8);
    if (step === m.step) return;
    m.step = step;
    const { lamps } = m.parts;
    const n = lamps.names.length;
    const phase = Math.floor(step / 48) % 3;
    for (let i = 0; i < n; i++) {
      let on: boolean;
      if (phase === 0) on = (i + step) % 6 < 2;
      else if (phase === 1) on = step % 4 < 2 ? i % 2 === 0 : i % 2 === 1;
      else on = (i * 7 + step) % 11 < 4;
      lamps.set(i, on);
    }
    lamps.flush();
  }

  /** The display's attract pages. */
  private attractDmd(m: Machine): void {
    const d = m.dmd;
    d.clear();
    const page = Math.floor(m.t / 4) % 5;
    const busy = m.player && m.player.id !== VIEWER ? m.player.name : null;
    if (busy) {
      d.fit(m.def.title, DMD_W / 2, 10, 10, 124);
      d.fit(`${busy.toUpperCase()} IS PLAYING`, DMD_W / 2, 24, 7, 124, { shade: 0.75 });
    } else if (page === 0) d.fit(m.def.title, DMD_W / 2, 16, 20, 124);
    else if (page === 1) {
      d.text("PRESS START", DMD_W / 2, 10, 9);
      d.text("WALK UP AND PRESS E", DMD_W / 2, 24, 6, { shade: 0.7 });
    } else if (page === 2 || page === 3) {
      const top = m.high.slice((page - 2) * 2, (page - 2) * 2 + 2);
      if (!top.length) {
        d.text("HIGH SCORE", DMD_W / 2, 9, 7, { shade: 0.7 });
        d.text("BE THE FIRST", DMD_W / 2, 23, 10);
      } else
        top.forEach((h, i) => {
          const rank = (page - 2) * 2 + i + 1;
          d.fit(`${rank}  ${h.name.toUpperCase()}`, 2, 8 + i * 15, 6, 70, { align: "left", shade: 0.75 });
          d.fit(h.score.toLocaleString("en-US"), DMD_W - 2, 8 + i * 15, 9, 60, { align: "right" });
        });
    } else {
      const text = `${tableName(m.def).toUpperCase()}  ·  CHIMPHOUSE ARCADE`;
      d.ctx.font = "800 11px Montserrat";
      const w = d.ctx.measureText(text).width;
      const x = DMD_W - ((m.t % 4) / 4) * (DMD_W + w);
      d.text(text, x, 16, 9, { align: "left" });
    }
    d.present();
  }
}

// ---------------------------------------------------------------- high scores

function loadHigh(def: TableDef): HighScore[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIGH_KEY(def.id)) ?? "[]") as HighScore[];
    return Array.isArray(v) ? v.filter((e) => typeof e?.score === "number" && typeof e?.name === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveHigh(def: TableDef, list: HighScore[]): void {
  try {
    localStorage.setItem(HIGH_KEY(def.id), JSON.stringify(list));
  } catch {
    /* private window: the room keeps them while it runs */
  }
}

/** Two high-score lists as one: the best five, each name and score once. */
export function mergeHigh(a: HighScore[], b: HighScore[]): HighScore[] {
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((e) => e && typeof e.score === "number")
    .sort((x, y) => y.score - x.score)
    .filter((e) => {
      const k = `${e.name}|${e.score}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 5);
}
