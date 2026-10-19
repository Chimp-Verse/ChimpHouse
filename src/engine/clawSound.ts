// The claw machine's sounds, made with the Web Audio API: the gantry motors' hum while the
// trolley moves, the winch's whine as the claw lowers and winds up, the clack of the prongs
// shutting, the clunk of the claw stopping at the top, the thump of a prize landing in the
// pickup bin, a jingle for a win and a falling "aww" for a prize slipping out. Only the
// player hears them (and anyone watching from the deck), from their first key press or click,
// which is when browsers allow sound. Without Web Audio the machine plays silently.

export class ClawSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private motor: { osc: OscillatorNode; gain: GainNode } | null = null;
  private winch: { osc: OscillatorNode; gain: GainNode } | null = null;
  private noise: AudioBuffer | null = null;

  /** Start the sound (or wake it): on a key press or click while at the machine. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);
      const n = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const hum = (type: OscillatorType, f: number, cut: number) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = cut;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(lp).connect(gain).connect(this.master!);
        osc.start();
        return { osc, gain };
      };
      this.motor = hum("sawtooth", 92, 420);
      this.winch = hum("square", 170, 900);
    } catch {
      this.ctx = null;
    }
  }

  /** Each frame while heard: how fast the trolley moves (m/s) and the cable runs (m/s, + lowering). */
  drive(trolley: number, cable: number, heard: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.motor || !this.winch) return;
    const t = ctx.currentTime;
    const m = heard ? Math.min(1, trolley / 0.19) * 0.22 : 0;
    const w = heard ? Math.min(1, Math.abs(cable) / 0.3) * 0.12 : 0;
    this.motor.gain.gain.setTargetAtTime(m, t, 0.05);
    this.motor.osc.frequency.setTargetAtTime(80 + 40 * Math.min(1, trolley / 0.19), t, 0.08);
    this.winch.gain.gain.setTargetAtTime(w, t, 0.05);
    this.winch.osc.frequency.setTargetAtTime(cable > 0 ? 150 : 210, t, 0.1);
  }

  /** A burst of filtered noise: a clack, a clunk, a thump. */
  private hit(freq: number, q: number, dur: number, vol: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  /** Notes in turn: [frequency Hz, start s, length s]. */
  private tune(notes: [number, number, number][], type: OscillatorType, vol: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    for (const [f, at, len] of notes) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t0 + at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(vol, t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + at + len);
      o.connect(g).connect(this.master);
      o.start(t0 + at);
      o.stop(t0 + at + len + 0.05);
    }
  }

  start(): void {
    this.tune([[660, 0, 0.12], [880, 0.1, 0.18]], "square", 0.08);
  }
  close(): void {
    this.hit(2400, 3, 0.08, 0.5);
    this.hit(900, 2, 0.12, 0.35);
  }
  top(): void {
    this.hit(180, 1.5, 0.22, 0.8);
  }
  land(): void {
    this.hit(260, 1, 0.25, 0.7);
  }
  won(): void {
    this.tune([[523, 0, 0.15], [659, 0.12, 0.15], [784, 0.24, 0.15], [1047, 0.36, 0.45]], "square", 0.09);
  }
  slip(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = "triangle";
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.7);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.85);
  }
}
