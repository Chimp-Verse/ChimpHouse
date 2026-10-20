// Adaptive render sharpness: at "high" quality the picture is drawn at 1.25 pixels per CSS pixel
// (engine/preview.ts applyScale). That costs about 1.56x the pixels of 1.0, which only matters when
// the computer is struggling. This drops to the softer scale while it is, and goes back once the
// sharper picture would clearly hold 60 fps again. Medium and low are never touched.
//
// Changing the scale re-creates the render targets (memory churn, a hitch), so every switch is rare:
// long holds before it, a cooldown after it, and a wait that doubles each time a switch had to be undone.
//
// This file has no browser or Babylon imports, so tools/test-adaptive.mjs runs it on a simulated clock.

/** Every threshold in one place (milliseconds unless the name says otherwise). */
export const ADAPTIVE = {
  /** Drop when the smoothed frame time stays above this (under 50 fps) ... */
  DROP_MS: 20,
  /** ... for this long. Short enough to help soon, long enough that one busy moment never does it. */
  DROP_HOLD_MS: 2500,
  /** Go back up when the picture at the softer scale, scaled up to the sharper one, would take less than this (60 fps is 16.7). */
  RAISE_MS: 12,
  /** ... and has done for this long. Slower than the drop on purpose: a wrong raise costs a second bad stretch. */
  RAISE_HOLD_MS: 5000,
  /** The sharper picture has this many times the pixels of the softer one (1.25 squared): the worst case for what it would cost. */
  PIXEL_RATIO: 1.25 * 1.25,
  /** A drop only helps when the graphics chip alone takes this long a frame. Less means slow frames come from elsewhere (the display's own cap, the processor). */
  GPU_BUSY_MS: 12,
  /** No timer on the graphics chip (Safari, Firefox): frames under this are on time, so the display is holding 60 and could not show more ... */
  LOCKED_MS: 19,
  /** ... which is no proof of headroom, so then the sharper picture is only tried after this long, and the backoff below keeps failed tries rare. */
  TRIAL_HOLD_MS: 20000,
  TRIAL_WAIT_MS: 30000,
  /** At least this long between two switches, and the first wait before going back up. */
  COOLDOWN_MS: 10000,
  /** The wait before going back up doubles each time a raise had to be undone, up to this. */
  BACKOFF_MAX_MS: 300000,
  /** A raise that held this long was a good one: the wait starts again from the cooldown. */
  STABLE_MS: 60000,
  /** Smoothing (exponential average) time constant: about 2 s to follow a change in full. */
  TAU_MS: 750,
  /** A frame longer than this is a hitch (a teleport, shaders compiling, a stalled tab), not load: it is left out and the next second too. */
  SPIKE_MS: 120,
  SPIKE_GRACE_MS: 1000,
  /** This many long frames in a row are not a hitch but a computer that is that slow: they count (each as at most SLOW_FRAME_CAP_MS). */
  SLOW_RUN: 3,
  SLOW_FRAME_CAP_MS: 250,
  /** Ignored after the page has loaded (the first view's shaders and textures settle) and after a quality change. */
  LOAD_GRACE_MS: 8000,
  CHANGE_GRACE_MS: 3000,
  /** After a switch the picture is given this long to settle, then judged for CHECK_MS. */
  SETTLE_MS: 1500,
  CHECK_MS: 3000,
  /** A drop that did not make the frames at least this much shorter (a share of what they were) did nothing useful: undone. */
  FUTILE_RATIO: 0.9,
  /** After a useless drop, drops wait this long, doubling each time, up to BACKOFF_MAX_MS. */
  FUTILE_WAIT_MS: 30000,
  /** A smoothed average needs this long after a restart before it is believed. */
  WARM_MS: 1000,
  /** Waiting this long for the graphics timer's first reading before taking it as absent. */
  GPU_WAIT_MS: 2000,
};

export interface AdaptiveHooks {
  /** Show the picture at the softer scale (true) or the full one (false). */
  apply(soft: boolean): void;
  /** Turn the graphics chip's frame timer on or off: it is only worth its cost while it is needed. */
  gpuCapture(on: boolean): void;
  now(): number;
}

export interface AdaptiveState {
  enabled: boolean;
  /** whether it may switch at all: at high quality, a screen with something to drop, not forced */
  active: boolean;
  soft: boolean;
  forced: boolean | null;
  scale: number;
  frameMs: number;
  gpuMs: number | null;
  /** switches so far this visit, and why the last one happened */
  switches: number;
  lastReason: string;
  /** how long the soft picture waits before the sharper is tried again (grows when a raise is undone) */
  upWaitMs: number;
  dropWaitMs: number;
}

export class AdaptiveScale {
  private hooks: AdaptiveHooks;
  enabled = true;
  private high = false;
  private scales = { full: 1.25, soft: 1.0 };
  soft = false;
  private forced: boolean | null = null;
  private ema = 0;
  private gpu: number | null = null;
  private gpuSupported = true;
  private gpuOn = false;
  private gpuOnAt = 0;
  private last = -1;
  private slowRun = 0;
  private warmAt = 0;
  private graceUntil = 0;
  private lastSwitch = -1e12;
  private dropSince = -1;
  private raiseSince = -1;
  private trialSince = -1;
  private upWait: number = ADAPTIVE.COOLDOWN_MS;
  private dropWait: number = ADAPTIVE.FUTILE_WAIT_MS;
  private dropBlockedUntil = 0;
  private raisedAt = -1;
  private before = 0;
  private checkAt = -1;
  switches = 0;
  lastReason = "";

  constructor(hooks: AdaptiveHooks) {
    this.hooks = hooks;
  }

  private get active(): boolean {
    return this.enabled && this.high && this.forced === null && this.scales.soft < this.scales.full;
  }

  /** The quality was set (also the first time): back to the full picture with a clean slate. `scales` are the two render scales for high quality. */
  setQuality(high: boolean, scales: { full: number; soft: number }): void {
    this.high = high;
    this.scales = scales;
    this.soft = false;
    this.forced = null;
    this.upWait = ADAPTIVE.COOLDOWN_MS;
    this.dropWait = ADAPTIVE.FUTILE_WAIT_MS;
    this.dropBlockedUntil = 0;
    this.raisedAt = -1;
    this.checkAt = -1;
    this.lastSwitch = -1e12;
    this.restart();
    this.graceUntil = this.hooks.now() + ADAPTIVE.CHANGE_GRACE_MS;
    this.setGpu(false);
  }

  /** Whether the graphics chip has a frame timer at all. */
  setGpuSupported(v: boolean): void {
    this.gpuSupported = v;
    if (!v) this.setGpu(false);
  }

  /** Ignore frames for a while (after a teleport, a viewpoint jump, the end of loading). */
  grace(ms: number): void {
    this.graceUntil = Math.max(this.graceUntil, this.hooks.now() + ms);
    this.restart();
  }

  /** Test hook: hold the picture at the soft (true) or full (false) scale, or give it back to the automatic choice (null). */
  force(soft: boolean | null): void {
    this.forced = soft;
    if (soft !== null && this.high) this.set(soft, "forced");
    else this.restart();
  }

  state(): AdaptiveState {
    return {
      enabled: this.enabled,
      active: this.active,
      soft: this.soft,
      forced: this.forced,
      scale: this.soft ? this.scales.soft : this.scales.full,
      frameMs: Math.round(this.ema * 10) / 10,
      gpuMs: this.gpu === null ? null : Math.round(this.gpu * 10) / 10,
      switches: this.switches,
      lastReason: this.lastReason,
      upWaitMs: this.upWait,
      dropWaitMs: this.dropWait,
    };
  }

  /** The graphics timer is wanted (it costs a little each frame, so it is only on while a drop is possible or the picture is soft). */
  get wantsGpu(): boolean {
    return this.gpuOn;
  }

  /**
   * Call once per drawn frame. `ignore` is for frames that say nothing (the tab is hidden, the page is
   * loading); `gpuMs` is the graphics chip's time for the last frame it measured, if it can.
   */
  frame(now: number, ignore: boolean, gpuMs: number | null): void {
    let dt = now - this.last;
    this.last = now;
    if (!this.active) return;
    // a hitch is one or two long frames; a computer that really is that slow has them one after another, and those count
    this.slowRun = dt > ADAPTIVE.SPIKE_MS && !ignore ? this.slowRun + 1 : 0;
    const spike = dt > ADAPTIVE.SPIKE_MS && this.slowRun < ADAPTIVE.SLOW_RUN;
    if (ignore || spike || dt <= 0 || now < this.graceUntil) {
      if (ignore || spike) this.graceUntil = Math.max(this.graceUntil, now + ADAPTIVE.SPIKE_GRACE_MS);
      this.restart();
      return;
    }
    dt = Math.min(dt, ADAPTIVE.SLOW_FRAME_CAP_MS);
    // smoothed frame time (seeded no higher than the drop line, so one slow first frame can't tip it)
    if (this.ema === 0) {
      this.ema = Math.min(dt, ADAPTIVE.DROP_MS);
      this.warmAt = now + ADAPTIVE.WARM_MS;
    } else this.ema += (dt - this.ema) * (1 - Math.exp(-dt / ADAPTIVE.TAU_MS));
    if (this.gpuOn && gpuMs !== null && gpuMs > 0) this.gpu = this.gpu === null ? gpuMs : this.gpu + (gpuMs - this.gpu) * (1 - Math.exp(-dt / ADAPTIVE.TAU_MS));
    if (this.gpuOn && this.gpu === null && this.gpuSupported && now - this.gpuOnAt > ADAPTIVE.GPU_WAIT_MS) this.gpuSupported = false; // no readings came: no timer here
    // the graphics timer runs while a drop looks possible or the picture is soft
    this.setGpu(this.soft || this.ema > ADAPTIVE.DROP_MS * 0.85, now);
    if (now < this.warmAt) return;

    if (this.soft) this.whileSoft(now);
    else this.whileFull(now);
  }

  private whileFull(now: number): void {
    if (this.raisedAt >= 0 && now - this.raisedAt >= ADAPTIVE.STABLE_MS) {
      this.raisedAt = -1;
      this.upWait = ADAPTIVE.COOLDOWN_MS; // a raise that held
    }
    // slow frames the graphics chip isn't the reason for (the display's own cap, the processor) are not helped by fewer pixels
    const gpuBusy = this.gpuSupported ? this.gpu !== null && this.gpu > ADAPTIVE.GPU_BUSY_MS : true;
    const struggling = this.ema > ADAPTIVE.DROP_MS && gpuBusy && now >= this.dropBlockedUntil && now - this.lastSwitch >= ADAPTIVE.COOLDOWN_MS;
    if (!struggling) {
      this.dropSince = -1;
      return;
    }
    if (this.dropSince < 0) this.dropSince = now;
    if (now - this.dropSince < ADAPTIVE.DROP_HOLD_MS) return;
    this.before = this.ema;
    if (this.raisedAt >= 0 && now - this.raisedAt < ADAPTIVE.STABLE_MS) {
      // went up and had to come down again: wait longer before the next try
      this.upWait = Math.min(this.upWait * 2, ADAPTIVE.BACKOFF_MAX_MS);
    }
    this.raisedAt = -1;
    this.checkAt = now + ADAPTIVE.SETTLE_MS + ADAPTIVE.CHECK_MS;
    this.set(true, `frames ${this.ema.toFixed(1)} ms${this.gpu !== null ? `, gpu ${this.gpu.toFixed(1)} ms` : ""}`);
  }

  private whileSoft(now: number): void {
    if (this.checkAt >= 0) {
      if (now < this.checkAt) return;
      this.checkAt = -1;
      if (this.ema > this.before * ADAPTIVE.FUTILE_RATIO && this.ema > ADAPTIVE.DROP_MS) {
        // the softer picture didn't help: the slowness isn't pixels. Undo it, and don't try again soon.
        this.dropBlockedUntil = now + this.dropWait;
        this.dropWait = Math.min(this.dropWait * 2, ADAPTIVE.BACKOFF_MAX_MS);
        this.set(false, `drop did not help (${this.before.toFixed(1)} to ${this.ema.toFixed(1)} ms)`);
        return;
      }
      this.dropWait = ADAPTIVE.FUTILE_WAIT_MS; // it helped
    }
    if (now - this.lastSwitch < this.upWait) return;
    let clear: boolean;
    let hold: number = ADAPTIVE.RAISE_HOLD_MS;
    let since = this.raiseSince;
    if (this.gpuSupported) {
      // what the graphics chip takes now, scaled up to the sharper picture's pixels
      clear = this.gpu !== null && this.gpu * ADAPTIVE.PIXEL_RATIO < ADAPTIVE.RAISE_MS && this.ema < ADAPTIVE.DROP_MS;
    } else if (this.ema < ADAPTIVE.RAISE_MS) {
      clear = true; // frames well under 60 fps's: a display faster than 60, or no frame limit
    } else {
      clear = this.ema < ADAPTIVE.LOCKED_MS && now - this.lastSwitch >= ADAPTIVE.TRIAL_WAIT_MS;
      hold = ADAPTIVE.TRIAL_HOLD_MS;
      since = this.trialSince;
    }
    if (!clear) {
      this.raiseSince = this.trialSince = -1;
      return;
    }
    if (since < 0) since = now;
    if (hold === ADAPTIVE.RAISE_HOLD_MS) {
      this.raiseSince = since;
      this.trialSince = -1;
    } else {
      this.trialSince = since;
      this.raiseSince = -1;
    }
    if (now - since < hold) return;
    this.raisedAt = now;
    this.set(false, hold === ADAPTIVE.RAISE_HOLD_MS ? `headroom (frames ${this.ema.toFixed(1)} ms${this.gpu !== null ? `, gpu ${this.gpu.toFixed(1)} ms` : ""})` : "trying the sharper picture");
  }

  private set(soft: boolean, why: string): void {
    const changed = soft !== this.soft;
    this.soft = soft;
    this.lastReason = why;
    if (changed) {
      this.switches++;
      this.lastSwitch = this.hooks.now();
      this.graceUntil = this.lastSwitch + ADAPTIVE.SETTLE_MS;
      this.hooks.apply(soft);
    }
    this.restart();
  }

  private restart(): void {
    this.ema = 0;
    this.gpu = null;
    this.dropSince = this.raiseSince = this.trialSince = -1;
  }

  private setGpu(on: boolean, now = this.hooks.now()): void {
    if (on === this.gpuOn) return;
    if (on && !this.gpuSupported) return;
    this.gpuOn = on;
    this.gpuOnAt = now;
    if (!on) this.gpu = null;
    this.hooks.gpuCapture(on);
  }
}
