// A game of pinball, as pure functions of the table's physics events (no
// Babylon): the score, three balls, a ball save after each launch, tilt, the
// end-of-ball bonus, extra balls, and each table's own rules.
//
// JUNGLE QUEST: T-E-M top lanes raise the bonus multiplier (the flipper buttons
// move the lit lanes; the lane lit at the plunge is a skill shot); the IDOL drop
// targets light the TEMPLE scoop and the kickback; the TEMPLE starts the next
// of four timed quests (VINE SWING: ramps; SNAKE PIT: bumpers; LOST IDOL: drop
// targets; RIVER RUN: the right orbit); all four start JUNGLE KING, where
// everything scores big. The TEMPLE RAMP back to back is a combo.
//
// BANANA BLITZ: B-A-N-A-N-A standup targets light the lock at the MONKEY
// MOUTH; lock two balls there and the third shot starts three-ball BLITZ
// MULTIBALL, when the mouth scores jackpots worth more each time. Major shots
// (the orbit over the top, the mouth) within a few seconds of each other score
// combos up to 5X. The spinner scores per turn.

import { TableDef } from "../world/props/pinballTables";
import { PhysEvent, Table } from "./pinballPhysics";

/** A lamp's state: off, on, blinking slowly, blinking fast. */
export type Blink = 0 | 1 | 2 | 3;

export interface Message {
  top: string;
  bottom?: string;
  until: number;
  /** a big single line, flashing */
  big?: boolean;
}

/** What the game asks the page to play. */
export type Cue = "flipper" | "bumper" | "sling" | "target" | "drop" | "rollover" | "spin" | "scoop" | "eject" | "ramp" | "launch" | "drain" | "award" | "jackpot" | "multiball" | "tilt" | "warning" | "kickback" | "start" | "gameOver" | "post" | "wall";

const BALLS = 3;

export class Game {
  state: "over" | "play" | "bonus" = "over";
  score = 0;
  ball = 1;
  /** extra balls earned and not yet played */
  extra = 0;
  bonusX = 1;
  tilted = false;
  warnings = 0;
  private tiltMeter = 0;
  /** the game's clock, s */
  t = 0;
  /** the ball save lasts until this; it starts when a ball is launched */
  saveUntil = 0;
  private saveArmed = true;
  multiball = false;
  readonly messages: Message[] = [];
  readonly cues: Cue[] = [];
  readonly lamps = new Map<string, Blink>();
  /** lamps flashed for a moment (a bumper's cap when it fires) */
  private flashes = new Map<string, number>();
  /** saucers to kick out, and balls to serve and launch (multiball, ball saves) */
  private ejects: { ball: number; at: number }[] = [];
  private serves: { at: number; strength: number }[] = [];
  private bonusItems: [string, number][] = [];
  private bonusAt = 0;
  readonly rules: TableRules;

  constructor(
    readonly def: TableDef,
    readonly table: Table,
  ) {
    this.rules = def.id === "jungleQuest" ? new JungleQuest(this) : new BananaBlitz(this);
  }

  /** A new game: ball 1 on the plunger. */
  start(): void {
    this.table.clear();
    this.table.dead = false;
    this.state = "play";
    this.score = 0;
    this.ball = 1;
    this.extra = 0;
    this.multiball = false;
    this.messages.length = 0;
    this.ejects.length = 0;
    this.serves.length = 0;
    this.rules.reset();
    this.cue("start");
    this.say(this.def.title, "BALL 1", 2.2, true);
    this.newBall();
  }

  private newBall(): void {
    this.bonusX = 1;
    this.tilted = false;
    this.warnings = 0;
    this.tiltMeter = 0;
    this.table.dead = false;
    this.saveArmed = true;
    this.saveUntil = 0;
    this.multiball = false;
    this.rules.newBall();
    this.table.serve();
  }

  /** Points, unless tilted; with a message when there's something to say. */
  add(points: number, top?: string, bottom?: string, secs = 1.4): void {
    if (this.tilted || this.state !== "play") return;
    this.score += points;
    if (top) this.say(top, bottom ?? points.toLocaleString("en-US"), secs);
  }

  say(top: string, bottom?: string, secs = 1.5, big = false): void {
    this.messages.length = 0;
    this.messages.push({ top, bottom, until: this.t + secs, big });
  }

  /** The message showing now, if any. */
  get message(): Message | null {
    const m = this.messages[this.messages.length - 1];
    return m && m.until > this.t ? m : null;
  }

  cue(c: Cue): void {
    if (this.cues.length < 32) this.cues.push(c);
  }

  flash(lamp: string, secs = 0.12): void {
    this.flashes.set(lamp, this.t + secs);
  }

  /** Hold a ball in its saucer for a while, then kick it out. */
  hold(ball: number, secs: number): void {
    this.ejects.push({ ball, at: this.t + secs });
  }

  /** Add balls to play: each served to the plunger and launched in turn. */
  addBalls(n: number, strength = 0.8): void {
    for (let i = 0; i < n; i++) this.serves.push({ at: this.t + 0.6 + i * 1.6, strength });
  }

  /** Save balls drained in the next `secs`. */
  ballSave(secs: number): void {
    this.saveUntil = Math.max(this.saveUntil, this.t + secs);
  }

  get saving(): boolean {
    return this.state === "play" && this.t < this.saveUntil && !this.tilted;
  }

  /** A flipper button pressed (the rules may move lit lanes). */
  flipper(button: "L" | "R"): void {
    if (this.state === "play" && !this.tilted) this.rules.flipper?.(button);
  }

  /** The cabinet bumped: the ball gets a push, and the tilt bob swings. Two warnings, then tilt. */
  nudge(): void {
    if (this.state !== "play" || this.tilted) return;
    this.tiltMeter += 1;
    if (this.tiltMeter > 2.4) {
      this.tiltMeter = 1.2;
      this.warnings++;
      if (this.warnings > 2) {
        this.tilted = true;
        this.table.dead = true;
        this.multiball = false;
        this.cue("tilt");
        this.messages.length = 0;
        this.messages.push({ top: "TILT", until: this.t + 1e9, big: true });
      } else {
        this.cue("warning");
        this.say(this.warnings === 1 ? "DANGER" : "DANGER  DANGER", undefined, 1.2, true);
      }
    }
  }

  /** Move the game on: the table's events, timers, the bonus count, lamps. */
  update(dt: number): void {
    this.t += dt;
    this.tiltMeter = Math.max(0, this.tiltMeter - 0.55 * dt);
    const evs = this.table.events.splice(0);
    if (this.state === "play") for (const e of evs) this.event(e);
    for (let i = this.ejects.length - 1; i >= 0; i--)
      if (this.t >= this.ejects[i].at) {
        this.table.eject(this.ejects[i].ball);
        this.ejects.splice(i, 1);
        this.cue("eject");
      }
    if (this.serves.length && this.t >= this.serves[0].at && !this.table.ballInLane()) {
      const s = this.serves.shift()!;
      if (this.table.serve() >= 0) {
        this.table.autoLaunch(s.strength);
        this.cue("launch");
      }
    }
    if (this.state === "play") this.rules.update(dt);
    if (this.state === "bonus") this.countBonus();
    this.updateLamps();
  }

  private event(e: PhysEvent): void {
    if (e.type === "drain") return this.drained();
    if (e.type === "launch") {
      this.cue("launch");
      if (this.saveArmed) {
        this.saveArmed = false;
        this.ballSave(this.rules.saveSecs);
      }
    }
    if (this.tilted) return;
    if (e.type === "bumper") this.cue("bumper");
    else if (e.type === "sling") {
      this.cue("sling");
      this.add(110);
    } else if (e.type === "flip") this.cue("post");
    else if (e.type === "wall" || e.type === "post") {
      if (e.speed > 0.6) this.cue(e.type);
    } else if (e.type === "target") this.cue("target");
    else if (e.type === "drop") this.cue("drop");
    else if (e.type === "rollover") this.cue("rollover");
    else if (e.type === "spin") this.cue("spin");
    else if (e.type === "scoop") this.cue("scoop");
    else if (e.type === "rampDone") this.cue("ramp");
    else if (e.type === "kickback") this.cue("kickback");
    this.rules.event(e);
  }

  private drained(): void {
    this.cue("drain");
    const left = this.table.inPlay + this.serves.length;
    if (this.saving) {
      this.say("BALL SAVED", undefined, 1.6, true);
      this.serves.push({ at: this.t + 0.4, strength: 0.72 });
      return;
    }
    if (left > 0) {
      if (this.multiball && left === 1) {
        this.multiball = false;
        this.rules.multiballOver?.();
      }
      return;
    }
    this.endBall();
  }

  private endBall(): void {
    this.state = "bonus";
    this.multiball = false;
    this.bonusItems = this.tilted ? [] : this.rules.bonus().filter(([, v]) => v > 0);
    this.bonusAt = this.t + 0.4;
    this.messages.length = 0;
  }

  /** The end-of-ball bonus, a line at a time; then the next ball or the end of the game. */
  private countBonus(): void {
    if (this.t < this.bonusAt) return;
    const item = this.bonusItems.shift();
    if (item) {
      this.say(item[0], item[1].toLocaleString("en-US"), 0.8);
      this.score += item[1] * this.bonusX;
      this.cue("award");
      this.bonusAt = this.t + 0.8;
      if (!this.bonusItems.length && this.bonusX > 1) this.bonusItems.push([`BONUS ${this.bonusX}X`, 0]);
      return;
    }
    this.tilted = false;
    this.table.dead = false;
    if (this.extra > 0) {
      this.extra--;
      this.state = "play";
      this.say("SHOOT AGAIN", `BALL ${this.ball}`, 2, true);
      this.newBall();
    } else if (this.ball < BALLS) {
      this.ball++;
      this.state = "play";
      this.say(`BALL ${this.ball}`, undefined, 1.6, true);
      this.newBall();
    } else {
      this.state = "over";
      this.table.clear();
      this.cue("gameOver");
      this.say("GAME OVER", this.score.toLocaleString("en-US"), 4, true);
    }
  }

  private updateLamps(): void {
    this.lamps.clear();
    if (this.state === "over") return;
    if (!this.tilted) this.rules.lamps((name, b) => this.lamps.set(name, b));
    this.lamps.set("shootAgain", this.saving ? 3 : this.extra > 0 ? 1 : 0);
    for (const [lamp, until] of this.flashes) {
      if (this.t < until) this.lamps.set(lamp, 1);
      else this.flashes.delete(lamp);
    }
  }

  /** What the bottom line of the score screen says (ball, mode). */
  get status(): string {
    if (this.state === "over") return "PRESS ENTER TO PLAY";
    return this.rules.status() || `BALL ${this.ball}${this.bonusX > 1 ? `   BONUS ${this.bonusX}X` : ""}`;
  }
}

export interface TableRules {
  /** seconds of ball save after a launch */
  readonly saveSecs: number;
  reset(): void;
  newBall(): void;
  event(e: PhysEvent): void;
  update(dt: number): void;
  lamps(set: (name: string, b: Blink) => void): void;
  /** the score screen's bottom line during a mode, or "" */
  status(): string;
  bonus(): [string, number][];
  flipper?(button: "L" | "R"): void;
  multiballOver?(): void;
}

const fmt = (n: number) => n.toLocaleString("en-US");

// ---------------------------------------------------------------- JUNGLE QUEST

const QUESTS = [
  { name: "VINE SWING", what: "SHOOT THE RAMP", need: 3, value: 50_000 },
  { name: "SNAKE PIT", what: "HIT THE BUMPERS", need: 15, value: 25_000 },
  { name: "LOST IDOL", what: "HIT THE IDOLS", need: 3, value: 40_000 },
  { name: "RIVER RUN", what: "SHOOT THE ORBIT", need: 3, value: 75_000 },
] as const;
const QUEST_SECS = 35;

class JungleQuest implements TableRules {
  readonly saveSecs = 8;
  private lanes = [false, false, false];
  private skill = -1;
  private skillUntil = 0;
  private questLit = false;
  private next = 0;
  private done = [false, false, false, false];
  private quest: { i: number; left: number; got: number } | null = null;
  private king = 0;
  private lastRamp = -10;
  private ramps = 0;
  private idols = 0;
  private bumps = 0;
  private quests = 0;
  private extraGiven = false;
  private raiseAt = 0;

  constructor(private g: Game) {}

  reset(): void {
    this.questLit = false;
    this.next = 0;
    this.done = [false, false, false, false];
    this.quest = null;
    this.king = 0;
    this.extraGiven = false;
    this.quests = 0;
    this.g.table.kickLit.add("kickback");
  }

  newBall(): void {
    this.lanes = [false, false, false];
    this.skill = Math.floor(Math.random() * 3);
    this.skillUntil = Infinity;
    this.ramps = this.idols = this.bumps = 0;
    this.quest = null;
    this.king = 0;
    this.g.table.raiseDrops(["idol1", "idol2", "idol3"]);
  }

  flipper(button: "L" | "R"): void {
    // lane change: the lit lanes (and the skill shot's) move with the flipper buttons
    const l = this.lanes;
    this.lanes = button === "L" ? [l[1], l[2], l[0]] : [l[2], l[0], l[1]];
    if (this.skill >= 0 && this.skillUntil === Infinity) this.skill = (this.skill + (button === "L" ? 2 : 1)) % 3;
  }

  private kingScore(): number {
    return this.king > 0 ? 100_000 : 0;
  }

  event(e: PhysEvent): void {
    const g = this.g;
    if (e.type === "launch" && this.skillUntil === Infinity) this.skillUntil = g.t + 4;
    if (e.type === "rollover") {
      const lane = ["laneT", "laneE", "laneM"].indexOf(e.id);
      if (lane >= 0) {
        if (lane === this.skill && g.t < this.skillUntil) {
          g.add(50_000, "SKILL SHOT", "50,000", 2);
          g.cue("award");
        } else g.add(5_000 + this.kingScore());
        this.skill = -1;
        this.lanes[lane] = true;
        if (this.lanes.every(Boolean)) {
          this.lanes = [false, false, false];
          if (g.bonusX < 5) {
            g.bonusX++;
            g.add(25_000, `BONUS ${g.bonusX}X`, undefined, 1.6);
          } else g.add(50_000, "TEMPLE LANES", "50,000");
          g.cue("award");
        }
      } else if (e.id === "orbit") {
        const b = g.table.balls[e.ball];
        if (b.vy > 0.3) this.orbit();
      } else g.add(e.id.startsWith("out") ? 3_000 : 1_000);
    } else if (e.type === "bumper") {
      g.flash(e.id, 0.15);
      this.bumps++;
      if (this.quest?.i === 1) this.progress(`SNAKE ${this.quest.got + 1}`);
      else g.add(3_000 + this.kingScore());
    } else if (e.type === "drop") {
      this.idols++;
      if (this.quest?.i === 2) this.progress("IDOL");
      else g.add(2_500 + this.kingScore());
      if (["idol1", "idol2", "idol3"].every((id) => g.table.dropped(id))) {
        g.add(25_000, "IDOLS COMPLETE", "TEMPLE IS LIT", 2);
        g.cue("award");
        this.questLit = this.quest === null && this.next < 4;
        g.table.kickLit.add("kickback");
        this.raiseAt = g.t + 1.2;
      }
    } else if (e.type === "scoop") {
      g.hold(e.ball, 1.6);
      if (this.questLit && this.quest === null && this.king === 0) {
        this.questLit = false;
        const q = QUESTS[this.next];
        this.quest = { i: this.next, left: QUEST_SECS, got: 0 };
        g.say(q.name, q.what, 2.4, true);
        g.cue("multiball");
        if (this.next === 2) g.table.raiseDrops(["idol1", "idol2", "idol3"]);
      } else if (this.king > 0) g.add(500_000, "KING'S TREASURE", "500,000", 1.6);
      else {
        // the temple's treasure: a mystery award
        const awards: [string, () => void][] = [
          ["25,000", () => g.add(25_000)],
          ["LIGHT KICKBACK", () => g.table.kickLit.add("kickback")],
          ["BONUS +1X", () => (g.bonusX = Math.min(5, g.bonusX + 1))],
          ["50,000", () => g.add(50_000)],
        ];
        const [name, fn] = awards[Math.floor(Math.random() * awards.length)];
        g.add(10_000);
        fn();
        g.say("TEMPLE TREASURE", name, 1.6);
      }
    } else if (e.type === "rampDone") {
      this.ramps++;
      const combo = g.t - this.lastRamp < 4;
      this.lastRamp = g.t;
      if (this.quest?.i === 0) this.progress("VINE SWING");
      else g.add((combo ? 50_000 : 25_000) + this.kingScore(), combo ? "RAMP COMBO" : "TEMPLE RAMP");
    } else if (e.type === "rampFail") g.say("SO CLOSE", undefined, 0.8);
    else if (e.type === "kickback") g.add(5_000, "KICKBACK", undefined, 1.2);
    else if (e.type === "target") g.add(1_000);
  }

  private orbit(): void {
    if (this.quest?.i === 3) this.progress("RIVER RUN");
    else this.g.add(10_000 + this.kingScore(), "RIVER ORBIT");
  }

  /** A shot for the quest running: its points, and the quest won when there are enough. */
  private progress(label: string): void {
    const g = this.g;
    const q = this.quest!;
    const def = QUESTS[q.i];
    q.got++;
    if (q.got >= def.need) {
      this.done[q.i] = true;
      this.quests++;
      this.quest = null;
      this.next = this.done.indexOf(false);
      g.add(def.value + 250_000 * this.quests, "QUEST COMPLETE", def.name, 2.4);
      g.cue("jackpot");
      if (this.quests === 2 && !this.extraGiven) {
        this.extraGiven = true;
        g.extra++;
        g.say("EXTRA BALL", "SHOOT AGAIN LIT", 2.4, true);
      }
      if (this.next < 0) {
        this.king = 30;
        this.done = [false, false, false, false];
        this.next = 0;
        g.say("JUNGLE KING", "EVERYTHING SCORES 100,000", 3, true);
        g.cue("multiball");
      }
    } else g.add(def.value, label, `${fmt(def.value)} · ${def.need - q.got} MORE`);
  }

  update(dt: number): void {
    const g = this.g;
    if (this.raiseAt && g.t > this.raiseAt) {
      this.raiseAt = 0;
      g.table.raiseDrops(["idol1", "idol2", "idol3"]);
    }
    if (this.quest) {
      this.quest.left -= dt;
      if (this.quest.left <= 0) {
        g.say("QUEST OVER", QUESTS[this.quest.i].name, 1.8);
        this.quest = null;
      }
    }
    if (this.king > 0) {
      this.king -= dt;
      if (this.king <= 0) g.say("LONG LIVE THE KING", undefined, 2);
    }
  }

  lamps(set: (name: string, b: Blink) => void): void {
    const g = this.g;
    const skillOn = this.skill >= 0 && g.t < this.skillUntil;
    ["laneT", "laneE", "laneM"].forEach((l, i) => set(l, skillOn && i === this.skill ? 3 : this.lanes[i] ? 1 : 0));
    const kb = g.table.kickLit.has("kickback");
    set("kickback", kb ? 1 : 0);
    set("outlaneL", kb ? 1 : 0);
    set("templeArrow", this.questLit ? 2 : this.king > 0 ? 3 : 0);
    set("temple", this.questLit ? 3 : this.quest ? 1 : 0);
    set("rampArrow", this.quest?.i === 0 ? 3 : g.t - this.lastRamp < 4 ? 2 : 0);
    set("orbitArrow", this.quest?.i === 3 ? 3 : 0);
    set("orbit", this.quest?.i === 3 ? 2 : 0);
    set("idolArrow", this.quest?.i === 2 ? 3 : 0);
    for (let i = 1; i <= 3; i++) set(`idol${i}`, g.table.dropped(`idol${i}`) ? 1 : this.quest?.i === 2 ? 2 : 0);
    for (let i = 0; i < 4; i++) set(`quest${i + 1}`, this.done[i] ? 1 : this.quest?.i === i ? 3 : this.questLit && this.next === i ? 2 : 0);
    set("king", this.king > 0 ? 3 : 0);
    for (let x = 2; x <= 5; x++) set(`x${x}`, g.bonusX >= x ? 1 : 0);
    set("inlaneL", g.t - this.lastRamp < 4 ? 1 : 0);
    set("inlaneR", 0);
    for (let i = 1; i <= 3; i++) set(`bumper${i}`, this.quest?.i === 1 ? 2 : this.king > 0 ? 3 : 0);
  }

  status(): string {
    if (this.king > 0) return `JUNGLE KING  ${Math.ceil(this.king)}`;
    if (this.quest) {
      const q = QUESTS[this.quest.i];
      return `${q.name}  ${Math.ceil(this.quest.left)}  ·  ${q.need - this.quest.got} MORE`;
    }
    return "";
  }

  bonus(): [string, number][] {
    return [
      ["RAMPS", this.ramps * 5_000],
      ["IDOLS", this.idols * 2_500],
      ["SNAKE BITES", this.bumps * 500],
      ["QUESTS", this.quests * 50_000],
    ];
  }
}

// ---------------------------------------------------------------- BANANA BLITZ

const LETTERS = ["banana1", "banana2", "banana3", "banana4", "banana5", "banana6"];
const COMBO_SECS = 3.5;

class BananaBlitz implements TableRules {
  readonly saveSecs = 10;
  private letters = [false, false, false, false, false, false];
  private lockLit = false;
  private locked = 0;
  private jackpot = 250_000;
  private jackpots = 0;
  private lastShot = -10;
  private combo = 1;
  private combos = 0;
  private spins = 0;
  private bananas = 0;
  private comboExtra = false;

  constructor(private g: Game) {}

  reset(): void {
    this.locked = 0;
    this.lockLit = false;
    this.jackpot = 250_000;
    this.comboExtra = false;
    this.combos = 0;
  }

  newBall(): void {
    this.letters = [false, false, false, false, false, false];
    this.spins = this.bananas = this.jackpots = 0;
    this.combo = 1;
    this.lastShot = -10;
  }

  /** A major shot: combos when it follows another quickly. */
  private shot(name: string, base: number): void {
    const g = this.g;
    if (g.t - this.lastShot < COMBO_SECS) {
      this.combo = Math.min(5, this.combo + 1);
      this.combos++;
      g.add(50_000 * this.combo, `COMBO ${this.combo}X`, name, 1.6);
      g.cue("award");
      if (this.combos >= 8 && !this.comboExtra) {
        this.comboExtra = true;
        g.extra++;
        g.say("EXTRA BALL", "COMBO KING", 2.4, true);
      }
    } else {
      this.combo = 1;
      g.add(base, name);
    }
    this.lastShot = g.t;
  }

  event(e: PhysEvent): void {
    const g = this.g;
    if (e.type === "target") {
      const i = LETTERS.indexOf(e.id);
      if (i < 0) return;
      this.bananas++;
      if (!this.letters[i]) {
        this.letters[i] = true;
        g.add(5_000, this.letters.map((on, k) => (on ? "BANANA"[k] : "·")).join(" "), "5,000", 1.2);
      } else g.add(1_000);
      if (this.letters.every(Boolean)) {
        this.letters = [false, false, false, false, false, false];
        if (!g.multiball && this.locked < 2) {
          this.lockLit = true;
          g.add(50_000, "LOCK IS LIT", "SHOOT THE MONKEY MOUTH", 2.2);
        } else g.add(75_000, "BANANA BUNCH", "75,000", 1.6);
        g.cue("award");
      }
    } else if (e.type === "scoop") {
      if (g.multiball) {
        g.add(this.jackpot, "JACKPOT", fmt(this.jackpot), 2.4);
        g.cue("jackpot");
        this.jackpots++;
        this.jackpot += 100_000;
        g.hold(e.ball, 1.4);
      } else if (this.locked >= 2) {
        // the third shot: everything locked comes out with it
        this.locked = 0;
        g.multiball = true;
        g.say("BLITZ MULTIBALL", "SHOOT THE MOUTH FOR JACKPOTS", 3, true);
        g.cue("multiball");
        g.addBalls(2, 0.82);
        g.ballSave(12);
        g.hold(e.ball, 2.2);
      } else if (this.lockLit) {
        this.locked++;
        this.lockLit = false;
        g.add(25_000, `BALL ${this.locked} LOCKED`, this.locked >= 2 ? "SHOOT THE MOUTH FOR MULTIBALL" : "SPELL BANANA FOR LOCK 2", 2.2);
        g.cue("award");
        g.hold(e.ball, 1.6);
      } else {
        this.shot("MONKEY MOUTH", 15_000);
        g.hold(e.ball, 1.0);
      }
    } else if (e.type === "spin") {
      this.spins++;
      g.add(g.multiball ? 1_000 : 500);
      if (g.multiball) this.jackpot += 1_000;
    } else if (e.type === "rollover") {
      if (e.id === "orbitTop") {
        this.shot("BANANA ORBIT", 20_000);
        if (g.multiball) this.jackpot += 25_000;
      } else g.add(e.id.startsWith("out") ? 3_000 : 1_000);
    } else if (e.type === "bumper") {
      g.flash(e.id, 0.15);
      g.add(g.multiball ? 5_000 : 1_000);
    }
  }

  multiballOver(): void {
    this.g.say("MULTIBALL OVER", `${this.jackpots} JACKPOTS`, 2);
    this.jackpot = 250_000;
  }

  update(): void {
    if (this.g.t - this.lastShot > COMBO_SECS) this.combo = 1;
  }

  lamps(set: (name: string, b: Blink) => void): void {
    const g = this.g;
    LETTERS.forEach((l, i) => set(l, this.letters[i] ? 1 : g.multiball ? 2 : 0));
    const ready = this.locked >= 2 && !g.multiball;
    set("lock", this.lockLit ? 2 : ready ? 3 : this.locked > 0 ? 1 : 0);
    set("mouth", g.multiball || ready ? 3 : this.lockLit ? 2 : 0);
    set("mouthArrow", g.multiball ? 3 : this.lockLit || ready ? 2 : 0);
    set("jackpot", g.multiball ? 3 : 0);
    const window = g.t - this.lastShot < COMBO_SECS;
    set("spinArrow", window ? 3 : 0);
    set("pitArrow", window ? 2 : 0);
    for (let c = 2; c <= 5; c++) set(`combo${c}`, this.combo >= c && window ? 1 : 0);
    set("orbitTop", window ? 2 : 0);
    set("bumper1", g.multiball ? 2 : 0);
    set("bumper2", g.multiball ? 2 : 0);
  }

  status(): string {
    const g = this.g;
    if (g.multiball) return `MULTIBALL  ·  JACKPOT ${fmt(this.jackpot)}`;
    if (this.locked >= 2) return "MOUTH STARTS MULTIBALL";
    if (this.lockLit) return "LOCK IS LIT";
    if (this.locked) return `${this.locked} LOCKED`;
    return "";
  }

  bonus(): [string, number][] {
    return [
      ["SPINS", this.spins * 100],
      ["BANANAS", this.bananas * 5_000],
      ["COMBOS", this.combos * 25_000],
      ["JACKPOTS", this.jackpots * 50_000],
    ];
  }
}

