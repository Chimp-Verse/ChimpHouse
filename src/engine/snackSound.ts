// The snack machine's sounds, made with the Web Audio API as the lift's are (liftSound.ts):
// a key's beep, the coil motor's whirr as it turns, the snack knocking against the glass and
// landing in the bin, the flap's clack, and eating: the wrapper torn open and a crunch for
// every bite.
//
// The machine's sounds come from the machine, quieter the further off the visitor is; eating
// is the visitor's own, at full volume. Sound starts at the visitor's first key press or click,
// since browsers only allow it after one. Without Web Audio the machine is silent.

/** Full volume within NEAR metres of the machine, then a third as loud for each doubling of the distance. */
const NEAR = 1.5;

export class SnackSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private motor: { stop: (at: number) => void } | null = null;
  /** how far the visitor is from the machine (m), for its loudness */
  distance = 10;

  /** Start the sound (or wake it): on a key press or click at the machine. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(c.destination);
    this.out = c.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(comp);
    const n = c.sampleRate;
    this.noise = c.createBuffer(1, n, n);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  /** The machine's loudness where the visitor is. */
  private get far(): number {
    return this.distance <= NEAR ? 1 : Math.pow(NEAR / this.distance, 1.6);
  }

  private gain(level: number, at: number): GainNode | null {
    if (!this.ctx || !this.out) return null;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.connect(this.out);
    return g;
  }

  private burst(at: number, dur: number, level: number, filter: { type: BiquadFilterType; f: number; q?: number }, decay = dur): void {
    const c = this.ctx;
    if (!c || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bq = c.createBiquadFilter();
    bq.type = filter.type;
    bq.frequency.value = filter.f;
    bq.Q.value = filter.q ?? 1;
    const g = this.gain(0, at);
    if (!g) return;
    g.gain.linearRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, at + decay);
    src.connect(bq).connect(g);
    src.start(at, Math.random() * 0.5, dur + 0.05);
  }

  private tone(at: number, f: number, dur: number, level: number, type: OscillatorType = "sine", to?: number): void {
    const c = this.ctx;
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = this.gain(0, at);
    if (!g) return;
    g.gain.linearRampToValueAtTime(level, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    o.connect(g);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** A key's beep, higher for a code the machine takes, low for one it doesn't. */
  beep(ok = true): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.burst(t, 0.02, 0.25 * this.far, { type: "highpass", f: 3000 }, 0.02);
    if (ok) this.tone(t + 0.01, 1568, 0.09, 0.12 * this.far, "square");
    else {
      this.tone(t + 0.01, 330, 0.16, 0.12 * this.far, "square");
      this.tone(t + 0.2, 247, 0.22, 0.12 * this.far, "square");
    }
  }

  /** The coil's motor turning for `dur` seconds: a geared whirr that winds up and down, with a click as the coil comes home. */
  motorRun(dur: number): void {
    const c = this.ctx;
    if (!c || !this.noise) return;
    this.motor?.stop(c.currentTime);
    const t = c.currentTime;
    const v = 0.22 * this.far;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(118, t + dur * 0.3);
    o.frequency.setValueAtTime(118, t + dur * 0.7);
    o.frequency.linearRampToValueAtTime(70, t + dur);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = this.gain(0, t);
    if (!g) return;
    g.gain.linearRampToValueAtTime(v, t + 0.12);
    g.gain.setValueAtTime(v, t + dur - 0.15);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
    // the gearbox's buzz on top
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 3;
    const g2 = this.gain(0, t);
    if (!g2) return;
    g2.gain.linearRampToValueAtTime(v * 0.25, t + 0.15);
    g2.gain.setValueAtTime(v * 0.25, t + dur - 0.15);
    g2.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp).connect(g2);
    src.start(t);
    src.stop(t + dur + 0.05);
    this.burst(t + dur, 0.03, 0.3 * this.far, { type: "bandpass", f: 2500, q: 2 }, 0.04);
    this.motor = {
      stop: (at) => {
        g.gain.cancelScheduledValues(at);
        g.gain.setValueAtTime(0, at);
        g2.gain.cancelScheduledValues(at);
        g2.gain.setValueAtTime(0, at);
      },
    };
  }

  /** A pack knocking into something as it falls: a light tick on the glass, a thud on the bin's floor. */
  hit(what: "glass" | "floor" | "pack" | "tray", speed: number, delay = 0): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + Math.max(0, delay);
    const v = Math.min(1, speed / 2.5) * this.far;
    if (what === "glass") {
      this.tone(t, 2400, 0.06, 0.12 * v, "sine");
      this.burst(t, 0.03, 0.25 * v, { type: "highpass", f: 2000 }, 0.04);
    } else if (what === "tray") this.burst(t, 0.04, 0.3 * v, { type: "bandpass", f: 1200, q: 1.5 }, 0.05);
    else {
      // the bin's metal floor booms a little under the crinkle of the pack
      this.tone(t, 140, 0.18, 0.55 * v, "sine", 80);
      this.burst(t, 0.08, 0.45 * v, { type: "bandpass", f: what === "pack" ? 2200 : 900, q: 0.9 }, 0.1);
    }
  }

  /** The PUSH flap swinging in and clacking shut. */
  flap(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.burst(t, 0.03, 0.3 * this.far, { type: "bandpass", f: 1600, q: 2 }, 0.04);
    this.burst(t + 0.5, 0.04, 0.45 * this.far, { type: "bandpass", f: 900, q: 1.4 }, 0.06);
    this.tone(t + 0.5, 220, 0.08, 0.15 * this.far, "triangle", 160);
  }

  /** The pack torn open. */
  rip(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 9; i++) this.burst(t + i * 0.022 + Math.random() * 0.01, 0.02, 0.3, { type: "highpass", f: 2500 + Math.random() * 2000 }, 0.025);
  }

  /** A bite: a crunch, many little cracks at once, and the chewing after it. */
  crunch(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.burst(t, 0.06, 0.55, { type: "bandpass", f: 1400, q: 0.7 }, 0.08);
    for (let i = 0; i < 14; i++) this.burst(t + Math.random() * 0.12, 0.012, 0.35 + Math.random() * 0.3, { type: "bandpass", f: 1800 + Math.random() * 3500, q: 2 }, 0.015 + Math.random() * 0.02);
    // chewing: softer crunches dying away
    for (let k = 1; k <= 3; k++) {
      const at = t + 0.18 + k * 0.13;
      for (let i = 0; i < 5; i++) this.burst(at + Math.random() * 0.05, 0.01, (0.25 - k * 0.06) * (0.5 + Math.random()), { type: "bandpass", f: 1500 + Math.random() * 2500, q: 2 }, 0.02);
    }
  }
}
