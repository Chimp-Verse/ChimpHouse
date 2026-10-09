// The lift's music: the easy-listening bossa nova that lifts are known for, played through the
// car's little speaker. Like the lift's other sounds it is made with the Web Audio API rather
// than a recording, and the tune is the house's own: an eight-bar loop in F of a vibraphone
// over an electric piano, a string pad, a walking bossa bass and brushes, at a gentle tempo.
//
// It is scheduled a little ahead of time (the usual Web Audio look-ahead), so a busy frame
// doesn't make it stumble. The lift's shared state says when it plays and how far into the
// tune it is (engine/liftState.ts), so a visitor who arrives part way through joins in at
// the same point; notes that would have started before then are left out.

const BPM = 112;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
const BARS = 8;
/** How far ahead (s) notes are scheduled, and how often (ms) the scheduler looks. */
const AHEAD = 0.25;
const TICK = 50;
/** The music's level against the lift's other sounds. */
const VOLUME = 0.32;

type Chord = { root: number; voicing: number[] };

/** The changes, a bar each, as MIDI notes: Fmaj7 D7 Gm7 C9 Am7 Dm7 Gm7 C9. */
const CHORDS: Chord[] = [
  { root: 41, voicing: [57, 60, 64, 65] },
  { root: 38, voicing: [54, 57, 60, 62] },
  { root: 43, voicing: [55, 58, 62, 65] },
  { root: 36, voicing: [52, 55, 58, 62] },
  { root: 45, voicing: [55, 60, 64, 67] },
  { root: 38, voicing: [57, 60, 62, 65] },
  { root: 43, voicing: [55, 58, 62, 65] },
  { root: 36, voicing: [52, 55, 58, 62] },
];

/** The tune, a bar at a time: [MIDI note, beat it starts on, beats it lasts]. */
const MELODY: [number, number, number][][] = [
  [[69, 0, 1.5], [72, 1.5, 0.5], [76, 2, 1.5], [74, 3.5, 0.5]],
  [[72, 0, 1], [69, 1, 0.5], [66, 1.5, 1.5], [69, 3, 1]],
  [[70, 0, 1.5], [74, 1.5, 0.5], [77, 2, 1], [76, 3, 0.5], [74, 3.5, 0.5]],
  [[76, 0, 2], [72, 2, 0.5], [70, 2.5, 0.5], [67, 3, 1]],
  [[69, 0, 1], [72, 1, 0.5], [76, 1.5, 1.5], [79, 3, 1]],
  [[77, 0, 2], [76, 2, 0.5], [74, 2.5, 0.5], [72, 3, 1]],
  [[70, 0, 1], [74, 1, 0.5], [72, 1.5, 0.5], [70, 2, 1], [69, 3, 1]],
  [[67, 0, 2.5], [64, 3, 0.5], [67, 3.5, 0.5]],
];

/** The piano's comping, a two-bar bossa figure: [beat, beats it lasts]. */
const COMP: [number, number][][] = [
  [[0, 1], [1.5, 0.5], [3, 0.5]],
  [[0.5, 0.5], [2, 1], [3.5, 0.5]],
];
/** The rim click, the bossa's clave over two bars. */
const CLAVE = [[0, 1.5, 3], [1, 2.5]];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class LiftMusic {
  /** the speaker, and the current play's own level into it: a play's notes go through its bus, faded and dropped when it stops */
  private speaker: AudioNode;
  private bus: GainNode;
  private noise: AudioBuffer;
  private timer: number | null = null;
  /** the audio time the loop began, and the next bar to schedule */
  private t0 = 0;
  private nextBar = 0;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
  ) {
    // a small speaker in the car's ceiling: no deep bass, no sparkle
    const c = ctx;
    const low = c.createBiquadFilter();
    low.type = "highpass";
    low.frequency.value = 110;
    const high = c.createBiquadFilter();
    high.type = "lowpass";
    high.frequency.value = 5200;
    low.connect(high).connect(out);
    this.speaker = low;
    this.bus = this.freshBus();
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** Start the tune `into` seconds in (where everyone else at the lift is hearing it), fading in. */
  start(into = 0): void {
    if (this.timer !== null) return;
    const now = this.ctx.currentTime;
    this.bus.gain.setValueAtTime(0, now);
    this.bus.gain.linearRampToValueAtTime(VOLUME, now + 0.4);
    this.t0 = now + 0.05 - into;
    this.nextBar = Math.max(0, Math.floor(into / BAR));
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), TICK);
  }

  /** Fade the tune out over `fade` seconds, and stop. */
  stop(fade = 1.2): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(this.bus.gain.value, now);
    this.bus.gain.linearRampToValueAtTime(0, now + fade);
    // the notes already scheduled play out silently; cut the ones that would start after the fade
    // the notes already scheduled play on into the faded bus, which is then dropped; the next play gets its own
    const old = this.bus;
    setTimeout(() => old.disconnect(), (fade + AHEAD + 3) * 1000);
    this.bus = this.freshBus();
  }

  private freshBus(): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.speaker);
    return g;
  }

  // ------------------------------------------------ scheduling

  /** Every bar that begins within the look-ahead, scheduled. */
  private schedule(): void {
    const horizon = this.ctx.currentTime + AHEAD;
    while (this.t0 + this.nextBar * BAR < horizon) {
      this.bar(this.nextBar % BARS, this.t0 + this.nextBar * BAR, this.nextBar);
      this.nextBar++;
    }
  }

  private bar(i: number, t: number, n: number): void {
    const chord = CHORDS[i];
    const at = (beat: number) => t + beat * BEAT;
    // the bass: root on one, again on the and of two, the fifth on three and the and of four
    const r = chord.root;
    for (const [note, beat, len] of [[r, 0, 1.5], [r, 1.5, 0.5], [r + 7, 2, 1.5], [r + 7, 3.5, 0.5]] as const) this.bass(hz(note), at(beat), len * BEAT);
    // the piano comps the chord
    for (const [beat, len] of COMP[n % 2]) for (const note of chord.voicing) this.piano(hz(note), at(beat), len * BEAT + 0.15, 0.05);
    // the strings hold it under everything
    for (const note of chord.voicing.slice(1)) this.pad(hz(note + 12), t, BAR);
    // the vibraphone sings the tune
    for (const [note, beat, len] of MELODY[i]) this.vibes(hz(note), at(beat), len * BEAT);
    // brushes on the eighths, leaning on the offbeats; a soft kick on one and three; the rim's clave
    for (let e = 0; e < 8; e++) this.brush(at(e / 2), e % 2 ? 0.05 : 0.025);
    this.kick(at(0));
    this.kick(at(2));
    for (const beat of CLAVE[n % 2]) this.rim(at(beat));
  }

  // ------------------------------------------------ the instruments

  /** A vibraphone bar: its fundamental and the fourth partial that gives it its ring, with the motor's tremolo. */
  private vibes(f: number, t: number, len: number): void {
    if (t < this.ctx.currentTime) return;
    const c = this.ctx;
    const ring = Math.max(len + 0.6, 1.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    const trem = c.createGain();
    trem.gain.value = 0.75;
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = c.createGain();
    depth.gain.value = 0.25;
    lfo.connect(depth).connect(trem.gain);
    g.connect(trem).connect(this.bus);
    for (const [ratio, amp, decay] of [[1, 1, ring], [4, 0.22, 0.35], [10, 0.05, 0.08]] as const) {
      const o = c.createOscillator();
      o.frequency.value = f * ratio;
      const a = c.createGain();
      a.gain.setValueAtTime(amp, t);
      a.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + ring + 0.05);
    }
    lfo.start(t);
    lfo.stop(t + ring + 0.05);
  }

  /** An electric piano note: a sine with a sine modulating it, bright at the strike and mellowing. */
  private piano(f: number, t: number, len: number, vol: number): void {
    if (t < this.ctx.currentTime) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.value = f;
    const mod = c.createOscillator();
    mod.frequency.value = f;
    const index = c.createGain();
    index.gain.setValueAtTime(f * 1.4, t);
    index.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.4);
    mod.connect(index).connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.5);
    g.gain.setValueAtTime(vol * 0.35, t + len);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.25);
    o.connect(g).connect(this.bus);
    for (const s of [o, mod]) {
      s.start(t);
      s.stop(t + len + 0.3);
    }
  }

  /** A string pad: two detuned saws through a soft filter, swelling in and out across the bar. */
  private pad(f: number, t: number, len: number): void {
    if (t < this.ctx.currentTime) return;
    const c = this.ctx;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.012, t + 0.5);
    g.gain.setValueAtTime(0.012, t + len - 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.1);
    filter.connect(g).connect(this.bus);
    for (const cents of [-7, 7]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(filter);
      o.start(t);
      o.stop(t + len + 0.15);
    }
  }

  /** A plucked bass note: a triangle, rounded off. */
  private bass(f: number, t: number, len: number): void {
    if (t < this.ctx.currentTime) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = f * 2; // up an octave, where the car's speaker can play it
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.06, t + len * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.08);
    o.connect(filter).connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + len + 0.1);
  }

  /** A brush on the snare: a short breath of high noise. */
  private brush(t: number, vol: number): void {
    this.hit(t, 0.09, vol, "bandpass", 6000, 0.8);
  }

  /** The rim's click. */
  private rim(t: number): void {
    this.hit(t, 0.03, 0.09, "bandpass", 1800, 6);
  }

  /** A soft kick, felt more than heard. */
  private kick(t: number): void {
    if (t < this.ctx.currentTime) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.22);
  }

  private hit(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q: number): void {
    if (t < this.ctx.currentTime) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.bus);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.02);
  }
}
