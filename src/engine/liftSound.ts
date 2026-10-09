// The lift's sounds, made with the Web Audio API rather than recordings: the beep of a
// button, the arrival chime (one ding going up, two going down), the door operator's whirr
// with the rollers' rumble and the thud of the doors meeting, the brake's clunk as the car
// sets off and stops, and while it travels the motor's hum, the drive's rising whine, the
// air rushing past the car and the guide rails' ticks.
//
// The sound starts at the visitor's first key press or click, since browsers only allow
// sound after one. It all comes from the car, placed in 3D (a Web Audio panner): it falls
// away as the visitor walks off and comes from the car's side of them. It plays through a
// little reverb, the sound of the lobby and the shaft, and a compressor that keeps it full
// without clipping. Heard from outside the car with its doors shut, the car's own sounds are
// muffled by the shaft. Without Web Audio the lift runs silently.
//
// The car also has its music (engine/liftMusic.ts), from the car's speaker, so outside a shut
// car it is muffled with the car's other sounds.

import { LiftMusic } from "./liftMusic";

/** Loudness at the lift, and how it falls away: full within NEAR metres of the car's middle, then a third as loud for each doubling of the distance. */
const FULL_VOLUME = 0.9;
const NEAR = 1.2;
const ROLLOFF = 1.6;
/** The drive's sounds while the car travels, against the rest: a quiet hum under the music. */
const DRIVE = 0.3;

/** A door's travel: its speed through the stroke, rising and falling (the derivative of the doors' ease). */
const STROKE = Array.from({ length: 33 }, (_, i) => {
  const x = i / 32;
  return Math.max(0.0001, 6 * x * (1 - x) / 1.5);
});

/** A point or direction in the house (x, y, z). */
type Vec = [number, number, number];

interface DoorSound {
  group: GainNode;
  sources: AudioScheduledSourceNode[];
}

export class LiftSound {
  private ctx: AudioContext | null = null;
  /** everything goes through master; the car's own sounds through the car bus and its muffle first */
  private master: GainNode | null = null;
  private panner: PannerNode | null = null;
  private carBus: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private drive: { hum: GainNode; whine: OscillatorNode; whineGain: GainNode; wind: GainNode; windFilter: BiquadFilterNode; rumble: GainNode } | null = null;
  private door: DoorSound | null = null;
  private nextTick = 0;
  private tune: LiftMusic | null = null;

  /** Start the sound (or wake it): on the visitor's first key press or click, and on every press of a lift button. */
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
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = FULL_VOLUME;
    // the car, placed where it is (Babylon's z is flipped for Web Audio's right-handed space)
    const p = c.createPanner();
    p.panningModel = "equalpower";
    p.distanceModel = "exponential";
    p.refDistance = NEAR;
    p.rolloffFactor = ROLLOFF;
    p.maxDistance = 60;
    this.panner = p;
    this.master.connect(p).connect(comp);
    const verb = c.createConvolver();
    verb.buffer = this.impulse(1.1);
    const wet = c.createGain();
    wet.gain.value = 0.22;
    p.connect(verb).connect(wet).connect(comp);

    this.muffle = c.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 18000;
    this.carBus = c.createGain();
    this.carBus.connect(this.muffle).connect(this.master);

    this.white = this.noiseBuffer(false);
    this.brown = this.noiseBuffer(true);
    this.startDrive();
    this.tune = new LiftMusic(c, this.carBus);
  }

  /** The car's music on, `into` seconds into the tune, or off (faded out). */
  music(on: boolean, into = 0): void {
    if (on) this.tune?.start(into);
    else this.tune?.stop();
  }

  /** Whether the car's music is playing. */
  get musicPlaying(): boolean {
    return this.tune?.playing ?? false;
  }

  /**
   * Where the visitor hears the car from: their ear and which way they face (forward and up,
   * in the house's coordinates), where the car is, whether they are inside it, and whether the
   * doors between them are shut. Outside a shut car, the shaft muffles its sounds.
   */
  listen(ear: Vec, forward: Vec, up: Vec, car: Vec, inside: boolean, shut: boolean): void {
    if (!this.ctx || !this.panner || !this.muffle || !this.carBus) return;
    const now = this.ctx.currentTime;
    const l = this.ctx.listener;
    const set = (param: AudioParam | undefined, v: number) => param?.setTargetAtTime(v, now, 0.03);
    // Web Audio's space is right-handed: Babylon's z runs the other way
    set(this.panner.positionX, car[0]);
    set(this.panner.positionY, car[1]);
    set(this.panner.positionZ, -car[2]);
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
    const muffled = !inside && shut;
    this.muffle.frequency.setTargetAtTime(muffled ? 650 : 18000, now, 0.2);
    this.carBus.gain.setTargetAtTime(muffled ? 0.75 : 1, now, 0.2);
  }

  /** A button pressed: a crisp beep, with the click of the switch under it. */
  press(): void {
    this.tone(1318, 0.11, 0.22, "sine", 0, 1, this.master);
    this.tone(2636, 0.05, 0.04, "sine", 0, 1, this.master);
    this.noise(this.white, 0.012, 0.25, 4000, 0.9, "highpass", 0, this.master);
  }

  /** The car has arrived: a bell-like chime, struck once for a car that came up and twice for one that came down. */
  chime(strikes: 1 | 2): void {
    this.bell(988, 0, 0.42);
    if (strikes === 2) this.bell(784, 0.5, 0.38);
  }

  /** The doors set off, opening or shutting over `seconds`: the operator's whirr and the rollers, ending at the stops. */
  doors(opening: boolean, seconds: number): void {
    if (!this.ctx || !this.master || !this.white || !this.brown) return;
    this.stopDoors();
    const c = this.ctx;
    const t0 = c.currentTime;
    const group = c.createGain();
    group.connect(this.master);
    const sources: AudioScheduledSourceNode[] = [];
    // the speed envelope through the stroke: every part of the sound follows it
    const follow = (g: GainNode, vol: number) => g.gain.setValueCurveAtTime(STROKE.map((v) => v * vol), t0, seconds);

    // the operator's motor: a geared whirr that rises and falls with the doors' speed
    const motor = c.createOscillator();
    motor.type = "sawtooth";
    motor.frequency.setValueCurveAtTime(STROKE.map((v) => 70 + v * 85), t0, seconds);
    const mf = c.createBiquadFilter();
    mf.type = "bandpass";
    mf.frequency.value = 380;
    mf.Q.value = 1.2;
    const mg = c.createGain();
    follow(mg, 0.11);
    motor.connect(mf).connect(mg).connect(group);
    motor.start(t0);
    sources.push(motor);

    // the hangers' rollers on their track, and the leaves' hiss through the air
    const roll = this.loop(this.brown, t0);
    const rf = c.createBiquadFilter();
    rf.type = "lowpass";
    rf.frequency.value = 520;
    const rg = c.createGain();
    follow(rg, 0.5);
    roll.connect(rf).connect(rg).connect(group);
    const hiss = this.loop(this.white, t0);
    const hf = c.createBiquadFilter();
    hf.type = "bandpass";
    hf.frequency.value = 2400;
    hf.Q.value = 0.7;
    const hg = c.createGain();
    follow(hg, 0.035);
    hiss.connect(hf).connect(hg).connect(group);
    sources.push(roll, hiss);
    for (const s of sources) s.stop(t0 + seconds + 0.6);

    // the end of the stroke: open, a soft bump at the stops; shut, the leaves meet with a thud and a clack
    const end = seconds - 0.02;
    if (opening) {
      this.tone(78, 0.18, 0.28, "sine", end, 0.7, group);
      this.noise(this.brown, 0.08, 0.35, 300, 0.7, "lowpass", end, group);
    } else {
      this.tone(92, 0.32, 0.6, "sine", end, 0.55, group);
      this.noise(this.brown, 0.12, 0.7, 380, 0.7, "lowpass", end, group);
      this.noise(this.white, 0.05, 0.22, 1600, 3, "bandpass", end + 0.005, group);
      this.tone(2100, 0.06, 0.05, "triangle", end + 0.012, 1, group);
    }
    this.door = { group, sources };
  }

  /** The doors stop short (they met someone and reverse): their sound cut where it is. */
  stopDoors(): void {
    if (!this.ctx || !this.door) return;
    const t = this.ctx.currentTime;
    this.door.group.gain.setTargetAtTime(0, t, 0.015);
    const old = this.door;
    setTimeout(() => old.group.disconnect(), 200);
    this.door = null;
  }

  /** The doors' safety edge has met someone: a soft two-note tone as they open again. */
  reopen(): void {
    this.tone(660, 0.22, 0.12, "triangle", 0, 1, this.master);
    this.tone(523, 0.3, 0.1, "triangle", 0.14, 1, this.master);
  }

  /** The brake lets go as the car sets off: a click and a low knock. */
  depart(): void {
    this.noise(this.white, 0.04, 0.25, 900, 2, "bandpass", 0, this.carBus);
    this.tone(62, 0.3, 0.45, "sine", 0.02, 0.8, this.carBus);
  }

  /** The car levels and the brake sets: a heavy clunk with a metallic clack. */
  stop(): void {
    this.tone(55, 0.45, 0.65, "sine", 0, 0.7, this.carBus);
    this.noise(this.brown, 0.16, 0.6, 400, 0.7, "lowpass", 0, this.carBus);
    this.noise(this.white, 0.05, 0.16, 1800, 4, "bandpass", 0.01, this.carBus);
  }

  /** The car's drive, at a speed from 0 (stopped) to 1 (top speed): hum, whine, wind and rumble, and now and then a rail's tick. */
  motor(speed: number): void {
    if (!this.ctx || !this.drive) return;
    const d = this.drive;
    const now = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed));
    const moving = s > 0.001;
    d.hum.gain.setTargetAtTime(moving ? DRIVE * (0.07 + 0.05 * s) : 0, now, 0.12);
    d.whine.frequency.setTargetAtTime(240 + 820 * s, now, 0.08);
    d.whineGain.gain.setTargetAtTime(moving ? DRIVE * (0.012 + 0.02 * s) : 0, now, 0.1);
    d.wind.gain.setTargetAtTime(DRIVE * 0.32 * s * s, now, 0.2);
    d.windFilter.frequency.setTargetAtTime(260 + 500 * s, now, 0.2);
    d.rumble.gain.setTargetAtTime(moving ? DRIVE * (0.25 + 0.35 * s) : 0, now, 0.15);
    // the guide shoes passing the rails' joints
    if (s > 0.35 && now > this.nextTick) {
      this.noise(this.brown, 0.07, DRIVE * 0.25 * s, 260, 1, "lowpass", 0, this.carBus);
      this.tone(1700 + Math.random() * 400, 0.03, DRIVE * 0.025 * s, "triangle", 0, 1, this.carBus);
      this.nextTick = now + 0.7 + Math.random() * 1.1;
    }
  }

  /** The drive's continuous sounds, silent until `motor` raises them. */
  private startDrive(): void {
    const c = this.ctx!;
    const bus = this.carBus!;
    // the mains hum of the motor, with its harmonic
    const hum = c.createGain();
    hum.gain.value = 0;
    for (const [f, v, type] of [[100, 1, "sine"], [200, 0.4, "triangle"], [50, 0.6, "sine"]] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = v;
      o.connect(g).connect(hum);
      o.start();
    }
    hum.connect(bus);
    // the drive's whine, rising with the speed
    const whine = c.createOscillator();
    whine.type = "sine";
    whine.frequency.value = 240;
    const whineGain = c.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain).connect(bus);
    whine.start();
    // the air past the car
    const wind = c.createGain();
    wind.gain.value = 0;
    const windFilter = c.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 300;
    windFilter.Q.value = 0.6;
    this.loop(this.white!, 0).connect(windFilter).connect(wind).connect(bus);
    // the rumble of the rails and the ropes
    const rumble = c.createGain();
    rumble.gain.value = 0;
    const rf = c.createBiquadFilter();
    rf.type = "lowpass";
    rf.frequency.value = 140;
    this.loop(this.brown!, 0).connect(rf).connect(rumble).connect(bus);
    this.drive = { hum, whine, whineGain, wind, windFilter, rumble };
  }

  /** A struck bell: a fundamental and its inharmonic partials, each ringing away at its own rate. */
  private bell(f: number, at: number, vol: number): void {
    const partials: [number, number, number][] = [
      [1, 1, 1.9],
      [2.0, 0.45, 1.2],
      [2.76, 0.25, 0.8],
      [4.07, 0.12, 0.45],
      [5.4, 0.06, 0.3],
    ];
    for (const [ratio, amp, decay] of partials) this.tone(f * ratio, decay, vol * amp, "sine", at, 1, this.master);
  }

  /** A tone with a quick attack and an exponential decay, from `at` seconds from now. */
  private tone(freq: number, dur: number, vol: number, type: OscillatorType, at = 0, slide = 1, out: AudioNode | null = this.master): void {
    if (!this.ctx || !out) return;
    const c = this.ctx;
    const t0 = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** Filtered noise: a quick swell to `vol` and away over `dur` seconds. */
  private noise(buf: AudioBuffer | null, dur: number, vol: number, freq: number, q: number, type: BiquadFilterType, at = 0, out: AudioNode | null = this.master): void {
    if (!this.ctx || !out || !buf) return;
    const c = this.ctx;
    const t0 = c.currentTime + at;
    const src = this.loop(buf, t0);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.stop(t0 + dur + 0.02);
  }

  /** A looping noise source, started at `t0` from a random point in its buffer. */
  private loop(buf: AudioBuffer, t0: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(t0, Math.random() * buf.duration);
    return src;
  }

  /** Two seconds of noise: white, or brown (its low rumble), for the sources that need it. */
  private noiseBuffer(brown: boolean): AudioBuffer {
    const c = this.ctx!;
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  /** The room's echo: a second of decaying noise, a little different in each ear. */
  private impulse(seconds: number): AudioBuffer {
    const c = this.ctx!;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return buf;
  }
}
