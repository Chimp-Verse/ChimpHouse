// The courtyard fountain's sound: a recording of a small fountain's splashing, looped. Unlike the
// lift's and the machines' sounds (made with the Web Audio API) it is a recording, since running
// water is hard to make convincingly: "Water Stream - Small Fountain - Close Recording (loop)" by
// Nox_Sound on Freesound, CC0 (public/sounds/CREDITS.md).
//
// The loop's tail is crossfaded into its head when it is decoded, so it loops without a seam. It
// plays from the fountain, placed in 3D (a Web Audio panner): heard across the courtyard, falling
// away down the approach path and gone past about 30 m, and muffled inside the house. The sound
// starts at the visitor's first key press or click, since browsers only allow sound after one.
// Without Web Audio, or if the recording can't be fetched, the fountain runs silently.

/** A point or direction in the house (x, y, z). */
type Vec = [number, number, number];

/** Loudness at the fountain; full within NEAR metres, then falling as 1/distance. */
const FULL_VOLUME = 0.6;
const NEAR = 3;
/** Faded out between these distances (m), on top of the falloff. */
const FADE_FROM = 20;
const FADE_TO = 32;
/** The crossfade between the loop's tail and its head (s). */
const SEAM = 0.6;

export class FountainSound {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private panner: PannerNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** the loudness the distance and the house give it now (0..1), for the tests (they can't listen) */
  level = 0;

  constructor(private url: string) {
    const wake = () => this.unlock();
    addEventListener("pointerdown", wake, { capture: true });
    addEventListener("keydown", wake, { capture: true });
  }

  /** Whether the loop is playing (after the visitor's first key press or click). */
  get playing(): boolean {
    return !!this.source && this.ctx?.state === "running";
  }

  /** Start the sound (or wake it). */
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
    const p = c.createPanner();
    p.panningModel = "equalpower";
    p.distanceModel = "inverse";
    p.refDistance = NEAR;
    p.rolloffFactor = 1;
    p.maxDistance = 200;
    this.panner = p;
    this.muffle = c.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 18000;
    this.gain = c.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.muffle).connect(p).connect(c.destination);
    void this.load(c);
  }

  private async load(c: AudioContext): Promise<void> {
    try {
      const res = await fetch(this.url);
      if (!res.ok) throw new Error(`${res.status}`);
      const buf = seamless(c, await c.decodeAudioData(await res.arrayBuffer()));
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.gain!);
      // start at a random point, so two visitors side by side don't hear it in step
      src.start(0, Math.random() * buf.duration);
      this.source = src;
    } catch (e) {
      console.warn("[fountain] no sound:", e);
    }
  }

  /**
   * Where the visitor hears the fountain from: their ear and which way they face (forward and
   * up, in the house's coordinates), where the fountain's water is, and whether they are inside
   * the house (which muffles it).
   */
  listen(ear: Vec, forward: Vec, up: Vec, at: Vec, indoors: boolean): void {
    if (!this.ctx || !this.panner || !this.gain || !this.muffle) return;
    const now = this.ctx.currentTime;
    const l = this.ctx.listener;
    const set = (param: AudioParam | undefined, v: number) => param?.setTargetAtTime(v, now, 0.05);
    // Web Audio's space is right-handed: Babylon's z runs the other way
    set(this.panner.positionX, at[0]);
    set(this.panner.positionY, at[1]);
    set(this.panner.positionZ, -at[2]);
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
    const d = Math.hypot(ear[0] - at[0], ear[1] - at[1], ear[2] - at[2]);
    const fade = Math.min(1, Math.max(0, (FADE_TO - d) / (FADE_TO - FADE_FROM)));
    this.level = fade * (indoors ? 0.5 : 1);
    this.gain.gain.setTargetAtTime(FULL_VOLUME * this.level, now, 0.25);
    this.muffle.frequency.setTargetAtTime(indoors ? 700 : 18000, now, 0.25);
  }
}

/** The recording made to loop without a seam: its last SEAM seconds crossfaded (equal power) into its first. */
function seamless(c: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const f = Math.min(Math.floor(SEAM * src.sampleRate), Math.floor(src.length / 3));
  const n = src.length - f;
  const out = c.createBuffer(src.numberOfChannels, n, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const a = src.getChannelData(ch);
    const b = out.getChannelData(ch);
    b.set(a.subarray(0, n));
    for (let i = 0; i < f; i++) {
      const k = (i / f) * (Math.PI / 2);
      b[i] = a[i] * Math.sin(k) + a[n + i] * Math.cos(k);
    }
  }
  return out;
}
