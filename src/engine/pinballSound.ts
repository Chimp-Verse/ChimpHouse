// A pinball machine's sounds, made in the browser (nothing recorded): the
// flippers' solenoid clack, the pop bumpers' thump, the slingshots' snap, the
// plunger's spring, the drain, and the score chimes and fanfares of awards.
// Browsers only allow sound after a key press or click, which playing is.

import { Cue } from "./pinballRules";

let ac: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!ac) {
    try {
      ac = new AudioContext();
    } catch {
      return null;
    }
    out = ac.createGain();
    out.gain.value = 0.32;
    out.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === "suspended") void ac.resume();
  return ac;
}

/** A burst of filtered noise. */
function hiss(a: AudioContext, t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass") {
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out!);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** A tone gliding from f0 to f1. */
function tone(a: AudioContext, t: number, dur: number, f0: number, f1: number, gain: number, type: OscillatorType = "sine") {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const lastAt = new Map<Cue, number>();

/** Play what the game asked for (the same sound at most every 30 ms). */
export function playCue(c: Cue): void {
  const a = audio();
  if (!a || !out) return;
  const t = a.currentTime;
  if ((lastAt.get(c) ?? -1) > t - 0.03) return;
  lastAt.set(c, t);
  switch (c) {
    case "flipper":
      hiss(a, t, 0.05, 900, 1.2, 0.5);
      tone(a, t, 0.06, 140, 60, 0.35, "square");
      break;
    case "bumper":
      tone(a, t, 0.09, 220, 70, 0.6, "triangle");
      hiss(a, t, 0.05, 2400, 2, 0.35);
      break;
    case "sling":
      hiss(a, t, 0.06, 1500, 1.5, 0.55);
      tone(a, t, 0.05, 180, 90, 0.3, "square");
      break;
    case "target":
    case "post":
    case "wall":
      hiss(a, t, 0.025, 3200, 3, c === "wall" ? 0.15 : 0.3);
      break;
    case "drop":
      hiss(a, t, 0.05, 1800, 2, 0.4);
      tone(a, t, 0.05, 400, 200, 0.2);
      break;
    case "rollover":
      tone(a, t, 0.12, 1320, 1320, 0.18);
      break;
    case "spin":
      hiss(a, t, 0.015, 4500, 4, 0.18);
      tone(a, t, 0.03, 2600, 2400, 0.06);
      break;
    case "scoop":
      tone(a, t, 0.18, 300, 120, 0.4, "triangle");
      break;
    case "eject":
    case "kickback":
      hiss(a, t, 0.08, 700, 1, 0.6);
      tone(a, t, 0.08, 160, 50, 0.4, "square");
      break;
    case "ramp":
      [660, 880, 1100].forEach((f, i) => tone(a, t + i * 0.07, 0.12, f, f, 0.18, "triangle"));
      break;
    case "launch":
      hiss(a, t, 0.12, 500, 0.8, 0.5);
      tone(a, t, 0.25, 90, 300, 0.25, "sawtooth");
      break;
    case "drain":
      tone(a, t, 0.6, 330, 80, 0.3, "sawtooth");
      break;
    case "award":
      [523, 659, 784, 1046].forEach((f, i) => tone(a, t + i * 0.06, 0.16, f, f, 0.18, "square"));
      break;
    case "jackpot":
    case "multiball":
      for (let i = 0; i < 8; i++) tone(a, t + i * 0.09, 0.14, i % 2 ? 1046 : 784, i % 2 ? 1046 : 784, 0.2, "square");
      break;
    case "warning":
      tone(a, t, 0.3, 200, 180, 0.4, "square");
      break;
    case "tilt":
      tone(a, t, 1.0, 120, 60, 0.45, "sawtooth");
      break;
    case "start":
      [392, 523, 659, 784].forEach((f, i) => tone(a, t + i * 0.1, 0.2, f, f, 0.2, "triangle"));
      break;
    case "gameOver":
      [523, 392, 330, 262].forEach((f, i) => tone(a, t + i * 0.18, 0.3, f, f, 0.2, "triangle"));
      break;
  }
}
