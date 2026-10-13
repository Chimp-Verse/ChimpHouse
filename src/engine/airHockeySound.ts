// The air hockey table's sounds, made with the Web Audio API as the lift's are: the
// sharp clack of a mallet on the puck, the duller knock of the puck on a rail, the
// clunk of the puck dropping into a goal with the scoreboard's buzzer, and the
// blower's soft rush while a game is on. They play to the player at the table and
// to anyone standing near it, louder the harder the blow, quieter further away.
// Browsers allow sound only after a key press or click; until then it is silent.

export class AirHockeySound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private blower: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private unlocked = false;

  constructor() {
    const unlock = () => {
      this.unlocked = true;
      if (this.ctx?.state === "suspended") void this.ctx.resume();
    };
    addEventListener("pointerdown", unlock, { capture: true });
    addEventListener("keydown", unlock, { capture: true });
  }

  private audio(): AudioContext | null {
    if (!this.unlocked) return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      this.out.connect(comp).connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.ctx;
  }

  /** A short filtered burst: the body of every knock. */
  private knock(freq: number, q: number, decay: number, level: number, tone = 0): void {
    const ctx = this.audio();
    if (!ctx || !this.out || !this.noise || level < 0.003) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq * (0.92 + Math.random() * 0.16);
    f.Q.value = q;
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5, decay + 0.05);
    if (tone) {
      const o = ctx.createOscillator();
      o.frequency.value = tone;
      const og = ctx.createGain();
      og.gain.setValueAtTime(level * 0.5, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.8);
      o.connect(og).connect(this.out);
      o.start(t);
      o.stop(t + decay);
    }
  }

  /** A blow of `speed` m/s, heard from `distance` m away. */
  hit(kind: "mallet" | "rail" | "post", speed: number, distance: number): void {
    const k = Math.min(1, speed / 6) / (1 + Math.max(0, distance - 1.5) * 0.6);
    if (kind === "mallet") this.knock(2600, 3, 0.06, 0.9 * k, 1500);
    else if (kind === "rail") this.knock(900, 2.2, 0.09, 0.7 * k, 320);
    else this.knock(1600, 4, 0.07, 0.8 * k, 820);
  }

  /** The puck drops into a goal, and the scoreboard buzzes. */
  goal(distance: number): void {
    const ctx = this.audio();
    if (!ctx || !this.out) return;
    const k = 1 / (1 + Math.max(0, distance - 1.5) * 0.6);
    this.knock(380, 1.5, 0.22, 0.9 * k, 140);
    const t = ctx.currentTime + 0.12;
    for (const [f, d] of [
      [196, 0.0],
      [98, 0.0],
    ]) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.linearRampToValueAtTime(0.09 * k, t + d + 0.02);
      g.gain.setValueAtTime(0.09 * k, t + 0.62);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      o.connect(lp).connect(g).connect(this.out);
      o.start(t + d);
      o.stop(t + 0.8);
    }
  }

  /** The blower's rush, at a loudness of 0 (off) to 1 (at the table). */
  air(level: number): void {
    if (level <= 0.001 && !this.blower) return;
    const ctx = this.audio();
    if (!ctx || !this.out || !this.noise) return;
    if (!this.blower) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 420;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(lp).connect(gain).connect(this.out);
      src.start();
      this.blower = { src, gain };
    }
    this.blower.gain.gain.setTargetAtTime(level * 0.05, ctx.currentTime, 0.3);
    if (level <= 0.001) {
      const b = this.blower;
      this.blower = null;
      b.src.stop(ctx.currentTime + 1.5);
    }
  }
}
