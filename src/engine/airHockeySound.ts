// The air hockey table's sounds, made with the Web Audio API rather than recordings, as the
// lift's are (engine/liftSound.ts): the sharp clack of the puck on a mallet, the duller bang
// of it on a rail and the ping of a goal post, each as loud as the puck was fast; the puck
// dropping into a goal and rattling down to its return, and the scoreboard's horn; the air
// table's hiss and its blower's hum while a match is on; and a short jingle as a match
// starts and a fanfare when one is won.
//
// It all comes from the table, placed in 3D (a Web Audio panner): it falls away as the
// visitor walks off and comes from the table's side of them, through a little reverb (the
// Game Room) and a compressor that keeps it full without clipping. The sound starts at the
// visitor's first key press or click, since browsers only allow sound after one. Without
// Web Audio the table plays silently.

/** A point or direction in the house (x, y, z). */
type Vec = [number, number, number];

/** Loudness at the table, and how it falls away: full within NEAR metres, then a little under half as loud for each doubling. */
const FULL_VOLUME = 0.85;
const NEAR = 1.6;
const ROLLOFF = 1.3;

export class AirHockeySound {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private panner: PannerNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private blower: { sources: AudioScheduledSourceNode[]; gain: GainNode } | null = null;
  /** how many of each sound have played, for the tests (they can't listen) */
  readonly played: Record<string, number> = {};

  /** Whether the air table's hiss is on. */
  get airOn(): boolean {
    return !!this.blower;
  }

  /** Whether the sound has started (after the visitor's first key press or click). */
  get running(): boolean {
    return this.ctx?.state === "running";
  }

  private count(kind: string): void {
    this.played[kind] = (this.played[kind] ?? 0) + 1;
  }

  constructor(wakeOnInput = true) {
    if (!wakeOnInput) return;
    const wake = () => this.unlock();
    addEventListener("pointerdown", wake, { capture: true });
    addEventListener("keydown", wake, { capture: true });
  }

  /** Start the sound (or wake it): on the visitor's first key press or click. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && this.ctx instanceof AudioContext) void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.build(new AC());
    } catch {
      return;
    }
  }

  /**
   * Render sounds offline and measure them, for the tests (a headless browser can't listen):
   * `play` makes the sounds on a fresh set, heard from the table itself; returns the peak and the
   * loudness (RMS) of what came out over `secs` seconds.
   */
  static async sample(play: (s: AirHockeySound) => void, secs = 2): Promise<{ peak: number; rms: number }> {
    const rate = 22050;
    const off = new OfflineAudioContext(1, Math.round(rate * secs), rate);
    const s = new AirHockeySound(false);
    s.build(off);
    play(s);
    const out = (await off.startRendering()).getChannelData(0);
    let peak = 0;
    let sum = 0;
    for (const v of out) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / out.length) };
  }

  private build(c: BaseAudioContext): void {
    this.ctx = c;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = FULL_VOLUME;
    // the table, placed where it is (Babylon's z is flipped for Web Audio's right-handed space)
    const p = c.createPanner();
    p.panningModel = "equalpower";
    p.distanceModel = "exponential";
    p.refDistance = NEAR;
    p.rolloffFactor = ROLLOFF;
    p.maxDistance = 40;
    this.panner = p;
    this.master.connect(p).connect(comp);
    const verb = c.createConvolver();
    verb.buffer = this.impulse(0.8);
    const wet = c.createGain();
    wet.gain.value = 0.16;
    p.connect(verb).connect(wet).connect(comp);
    this.white = this.noiseBuffer(false);
    this.brown = this.noiseBuffer(true);
  }

  /** Where the visitor hears the table from: their ear and which way they face (forward and up), and the table's playfield. */
  listen(ear: Vec, forward: Vec, up: Vec, table: Vec): void {
    if (!this.ctx || !this.panner) return;
    const now = this.ctx.currentTime;
    const l = this.ctx.listener;
    const set = (param: AudioParam | undefined, v: number) => param?.setTargetAtTime(v, now, 0.03);
    set(this.panner.positionX, table[0]);
    set(this.panner.positionY, table[1]);
    set(this.panner.positionZ, -table[2]);
    if (l.positionX) {
      set(l.positionX, ear[0]);
      set(l.positionY, ear[1]);
      set(l.positionZ, -ear[2]);
      set(l.forwardX, forward[0]);
      set(l.forwardY, forward[1]);
      set(l.forwardZ, -forward[2]);
      set(l.upX, up[0]);
      set(l.upY, up[1]);
      set(l.upZ, -up[2]);
    } else {
      // older Safari: the listener's setters
      l.setPosition(ear[0], ear[1], -ear[2]);
      l.setOrientation(forward[0], forward[1], -forward[2], up[0], up[1], -up[2]);
    }
  }

  /** The puck struck something at `speed` m/s: a mallet's clack, a rail's bang, a goal post's ping. */
  hit(kind: "mallet" | "rail" | "post", speed: number): void {
    if (!this.ctx || speed < 0.08) return;
    this.count(kind);
    // as loud as the blow was hard, a soft tap barely there
    const k = Math.min(1, Math.pow(speed / 7, 0.8));
    const vary = 0.94 + Math.random() * 0.12;
    if (kind === "mallet") {
      // hard plastic on plastic: a bright click with a short hollow knock under it
      this.noise(this.white, 0.025, 0.9 * k, 3200 * vary, 1.4, "bandpass");
      this.tone(1650 * vary, 0.045, 0.32 * k, "triangle", 0, 0.7);
      this.tone(520 * vary, 0.06, 0.22 * k, "sine", 0, 0.8);
    } else if (kind === "rail") {
      // the puck's edge on the rail's rubber and the wooden cabinet behind it: a duller bang
      this.noise(this.white, 0.04, 0.55 * k, 1300 * vary, 1.0, "bandpass");
      this.noise(this.brown, 0.09, 0.8 * k, 260 * vary, 0.9, "lowpass");
      this.tone(170 * vary, 0.12, 0.3 * k, "sine", 0, 0.6);
    } else {
      // a goal post's corner: a sharper ping
      this.noise(this.white, 0.02, 0.7 * k, 2400 * vary, 3, "bandpass");
      this.tone(980 * vary, 0.16, 0.25 * k, "sine", 0, 0.96);
      this.tone(1960 * vary, 0.08, 0.08 * k, "sine", 0, 0.96);
    }
  }

  /** A goal: the puck drops into the pocket and rattles down the return chute, then the scoreboard's horn. */
  goal(): void {
    if (!this.ctx || !this.master) return;
    this.count("goal");
    // the drop: a hollow clunk in the pocket
    this.noise(this.brown, 0.12, 0.9, 340, 1.2, "lowpass");
    this.tone(140, 0.22, 0.45, "sine", 0, 0.5);
    // the rattle down the chute: knocks closing up and dying away
    let t = 0.1;
    for (let i = 0; i < 6; i++) {
      t += 0.075 * Math.pow(0.82, i);
      this.noise(this.white, 0.02, 0.32 * Math.pow(0.78, i), 1500 + Math.random() * 500, 2, "bandpass", t);
      this.tone(600 + Math.random() * 120, 0.04, 0.1 * Math.pow(0.78, i), "triangle", t, 0.8);
    }
    this.horn(0.35, 0.85);
  }

  /** The scoreboard's horn: a brassy chord with a little waver, `len` seconds long. */
  private horn(at: number, len: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t0 = c.currentTime + at;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(0.16, t0 + 0.04);
    out.gain.setValueAtTime(0.16, t0 + len - 0.12);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1800;
    lp.Q.value = 2;
    lp.connect(out).connect(this.master);
    const lfo = c.createOscillator();
    lfo.frequency.value = 6;
    const depth = c.createGain();
    depth.gain.value = 3;
    lfo.connect(depth);
    for (const f of [233, 294, 349]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      depth.connect(o.frequency);
      o.connect(lp);
      o.start(t0);
      o.stop(t0 + len + 0.05);
    }
    lfo.start(t0);
    lfo.stop(t0 + len + 0.05);
  }

  /** A match starts: a quick rising chirp from the scoreboard. */
  start(): void {
    if (this.ctx) this.count("start");
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.11, 0.14, "square", i * 0.085, 1, 2400));
  }

  /** A match is won: a short fanfare from the scoreboard. */
  win(): void {
    if (this.ctx) this.count("win");
    const notes: [number, number, number][] = [
      [523, 0.0, 0.12],
      [659, 0.12, 0.12],
      [784, 0.24, 0.12],
      [1047, 0.36, 0.28],
      [784, 0.66, 0.12],
      [1047, 0.8, 0.6],
    ];
    for (const [f, at, len] of notes) {
      this.tone(f, len, 0.13, "square", at, 1, 2600);
      this.tone(f / 2, len, 0.08, "triangle", at, 1);
    }
  }

  /** The air table's hiss and its blower's hum while a match is on, at a loudness of 0 (off) to 1. */
  air(level: number): void {
    const c = this.ctx;
    if (!c || !this.master || !this.white || !this.brown) return;
    if (level > 0.001 && !this.blower) {
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      // the hiss of air through the playfield's holes
      const hiss = c.createBufferSource();
      hiss.buffer = this.white;
      hiss.loop = true;
      const hp = c.createBiquadFilter();
      hp.type = "bandpass";
      hp.frequency.value = 5200;
      hp.Q.value = 0.6;
      const hissGain = c.createGain();
      hissGain.gain.value = 0.05;
      hiss.connect(hp).connect(hissGain).connect(gain);
      // the blower under the table: a low hum with its motor's whine
      const hum = c.createBufferSource();
      hum.buffer = this.brown;
      hum.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 180;
      const humGain = c.createGain();
      humGain.gain.value = 0.18;
      hum.connect(lp).connect(humGain).connect(gain);
      const whine = c.createOscillator();
      whine.frequency.value = 118;
      const whineGain = c.createGain();
      whineGain.gain.value = 0.012;
      whine.connect(whineGain).connect(gain);
      for (const s of [hiss, hum, whine]) s.start();
      this.blower = { sources: [hiss, hum, whine], gain };
    }
    if (!this.blower) return;
    // the blower spins up and down rather than snapping on and off
    this.blower.gain.gain.setTargetAtTime(level, c.currentTime, level > 0.001 ? 0.35 : 0.6);
    if (level <= 0.001) {
      const b = this.blower;
      this.blower = null;
      for (const s of b.sources) s.stop(c.currentTime + 3);
    }
  }

  // ---------------------------------------------------------------- building blocks

  /** A tone with a quick attack and a decay (`hold` keeps it near full for that share of its length). */
  private tone(freq: number, len: number, level: number, type: OscillatorType, at = 0, hold = 0, lowpass = 0): void {
    const c = this.ctx;
    if (!c || !this.master || level < 0.002) return;
    const t0 = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + 0.004);
    if (hold > 0) g.gain.setValueAtTime(level, t0 + len * hold * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    let node: AudioNode = o;
    if (lowpass) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lowpass;
      node = node.connect(f);
    }
    node.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + len + 0.02);
  }

  /** A burst of filtered noise. */
  private noise(buf: AudioBuffer | null, len: number, level: number, freq: number, q: number, type: BiquadFilterType, at = 0): void {
    const c = this.ctx;
    if (!c || !this.master || !buf || level < 0.002) return;
    const t0 = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(level, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * (buf.duration - len - 0.05));
    src.stop(t0 + len + 0.02);
  }

  /** Two seconds of white noise, or brown (deep, rumbling) noise. */
  private noiseBuffer(brown: boolean): AudioBuffer {
    const c = this.ctx!;
    const n = c.sampleRate * 2;
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return b;
  }

  /** A short room reverb's impulse: decaying noise, `secs` long. */
  private impulse(secs: number): AudioBuffer {
    const c = this.ctx!;
    const n = Math.floor(c.sampleRate * secs);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    }
    return b;
  }
}
