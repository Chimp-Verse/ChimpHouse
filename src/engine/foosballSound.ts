// The foosball table's sounds, made in the browser like the lift's (no
// recordings): the knock of a man striking the ball, the clack of the ball off a
// wall, the thud of a goal and the rattle of the ball down the return, and the
// ball dropping into the serve cup. Louder the harder the hit, quieter further
// from the table. Browsers only allow sound after a key press or click, so it
// starts at the player's first one (`wake`).

export class FoosballSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Start the sound (called from a key press or click). */
  wake(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.55;
    this.out.connect(this.ctx.destination);
    const n = Math.floor(this.ctx.sampleRate * 0.25);
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  /** A man striking the ball: a hard plastic knock, `k` 0..1 how hard, `dist` (m) from the listener. */
  knock(k: number, dist: number): void {
    this.hit(0, 0.35 + 0.65 * k, 1800 + 1400 * k, 0.045, 520 + 260 * k, dist);
  }

  /** The ball off a wall: a duller, woodier clack. */
  clack(k: number, dist: number): void {
    this.hit(0, 0.25 + 0.6 * k, 1100 + 600 * k, 0.06, 300, dist);
  }

  /** A goal: the ball slams the back of the goal box, then rattles down to the return. */
  goal(dist: number): void {
    this.hit(0, 1, 420, 0.16, 110, dist);
    for (let i = 0; i < 7; i++) this.hit(0.25 + i * 0.09 + Math.random() * 0.03, 0.35 - i * 0.03, 1500 + Math.random() * 500, 0.03, 600, dist);
  }

  /** The ball dropping into the serve cup and through the wall. */
  serve(): void {
    for (let i = 0; i < 4; i++) this.hit(i * 0.11, 0.3 - i * 0.05, 1700, 0.03, 650, 1.5);
  }

  /** A burst of filtered noise with a short pitched body, `delay` s from now. */
  private hit(delay: number, gain: number, freq: number, len: number, body: number, dist: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.noise || ctx.state !== "running") return;
    const near = 1 / (1 + (dist / 1.8) ** 2);
    const g = gain * near;
    if (g < 0.01) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(g, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0005, t + len);
    src.connect(bp).connect(env).connect(this.out);
    src.start(t);
    src.stop(t + len + 0.02);
    // the body: a quick falling tone
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(body, t);
    osc.frequency.exponentialRampToValueAtTime(body * 0.6, t + len);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(g * 0.5, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0005, t + len * 1.4);
    osc.connect(og).connect(this.out);
    osc.start(t);
    osc.stop(t + len * 1.4 + 0.02);
  }
}
