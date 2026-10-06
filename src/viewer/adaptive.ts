import type { FrameSummary } from './frameStats';

/**
 * The knobs adaptive quality turns, each to a level of its own; the viewer
 * implements them (Viewer.qualityKnobs). None of them rebuilds a shader:
 * uniforms, update schedules, and at most a render target resized.
 */
export interface QualityKnobs {
  /** Whether GTAO is drawn at all (its two steps change nothing otherwise). */
  hasAo(): boolean;
  /** GTAO's sample count, as a share of the tier's (1 or 0.5): a uniform. */
  setAoSamples(share: number): void;
  /** GTAO's target, as a share of the tier's resolution (1 or 0.5). */
  setAoResolution(share: number): void;
  /** Softer, cheaper shadows: blur samples halved, fill and rim every other frame. */
  setShadowEconomy(on: boolean): void;
  /** The device-pixel-ratio caps below the starting one, highest first. */
  pixelRatioSteps(): number[];
  /** Cap the device pixel ratio (Infinity: the starting one). */
  setPixelRatioCap(cap: number): void;
  /** Shadow maps as a share of the tier's size (1 or 0.5), their blur kept to scale. */
  setShadowMapScale(share: number): void;
}

/** Windows a step down needs, in a row, with a fifth or more of the refreshes missed. */
const DOWN_AFTER = 2;
const DOWN_MISSED = 0.2;
/** Windows a step back up needs, in a row, with next to nothing missed and room to spare. */
const UP_AFTER = 8;
const UP_MISSED = 0.02;
const UP_ROOM = 0.6;
/** CPU at this share of the budget is CPU-short: lighter GPU work would not help. */
const CPU_SHORT = 0.9;
/**
 * A level stepped back up to and dropped from again within FLIP_MS waits
 * this long before it is tried again, doubled at every further flip.
 */
const FLIP_MS = 10_000;
const BACKOFF_MS = 30_000;
/** How often a window is judged. */
const WINDOW_MS = 1000;

/**
 * Adaptive quality: lighter frames, a step at a time, while they keep
 * missing the display, and back again once there is room. It watches the
 * frame meter's own numbers (frameStats), judges a window a second, and
 * applies a change only between strokes and drags, with the view still
 * (the viewer says when: Viewer.updateAdaptive), never in the middle of
 * one. It never touches anti-aliasing, MSAA, the shadow type, which lights
 * cast or anything else that would rebuild shaders.
 *
 * The ladder, cheapest to see first: GTAO samples halved, GTAO at half
 * resolution (both only where GTAO is drawn), softer shadows (fewer blur
 * samples, fill and rim every other frame), the pixel-ratio cap down a
 * quarter at a time to 1, and last the shadow maps halved.
 */
export class AdaptiveQuality {
  /** The level in force (0: the tier as it is). */
  level = 0;
  /** The level the windows have asked for, applied when the viewer is idle. */
  private target = 0;
  private bad = 0;
  private good = 0;
  private lastWindow = 0;
  private enabledFlag = true;
  private readonly heldUntil = new Map<number, number>();
  private readonly backoff = new Map<number, number>();
  private lastUp: { level: number; at: number } = { level: -1, at: 0 };

  constructor(private readonly knobs: QualityKnobs) {}

  get enabled(): boolean {
    return this.enabledFlag;
  }

  /** Off: the next idle moment goes back to the tier as it is. */
  setEnabled(on: boolean): void {
    this.enabledFlag = on;
    if (!on) this.target = 0;
    this.bad = 0;
    this.good = 0;
  }

  /** Steps on the ladder for this device: two for AO, one for shadows, the pixel-ratio caps, the maps. */
  private top(): number {
    return 4 + this.knobs.pixelRatioSteps().length;
  }

  /** Whether a level changes nothing here (GTAO's steps with GTAO off). */
  private noop(level: number): boolean {
    return (level === 1 || level === 2) && !this.knobs.hasAo();
  }

  private below(level: number): number {
    let l = level + 1;
    while (l <= this.top() && this.noop(l)) l++;
    return l <= this.top() ? l : level;
  }

  private above(level: number): number {
    let l = level - 1;
    while (l > 0 && this.noop(l)) l--;
    return Math.max(0, l);
  }

  /**
   * Once a frame: judge a window when one has passed, and apply what it
   * asked for if the viewer is idle (no stroke, drag or camera move).
   */
  tick(now: number, summary: () => FrameSummary, idle: boolean): void {
    if (this.enabledFlag && now - this.lastWindow >= WINDOW_MS) {
      this.lastWindow = now;
      this.judge(now, summary());
    }
    if (idle && this.target !== this.level) this.apply(this.target);
  }

  /** Test hook: judge a window from the given numbers. */
  judge(now: number, s: FrameSummary): void {
    const P = s.periodMs;
    if (!P || s.frames < 3 || !s.refreshes) return;
    const missed = s.missed / s.refreshes;
    const capped = s.verdict.startsWith('capped');
    const work = s.cpuMs + (s.gpuMs ?? 0);
    const bad = missed >= DOWN_MISSED && !capped && s.cpuMs < P * CPU_SHORT;
    const good = missed <= UP_MISSED && work <= P * UP_ROOM;
    this.bad = bad ? this.bad + 1 : 0;
    this.good = good ? this.good + 1 : 0;
    if (this.bad >= DOWN_AFTER) {
      this.bad = 0;
      this.good = 0;
      const next = this.below(this.target);
      if (next === this.target) return;
      // Straight back down from a level just stepped up to: that level is
      // too much for now, and waits longer each time before another try.
      if (this.lastUp.level === this.target && now - this.lastUp.at < FLIP_MS) {
        const wait = (this.backoff.get(this.target) ?? BACKOFF_MS / 2) * 2;
        this.backoff.set(this.target, wait);
        this.heldUntil.set(this.target, now + wait);
      }
      this.target = next;
    } else if (this.good >= UP_AFTER) {
      this.good = 0;
      const prev = this.above(this.target);
      if (prev === this.target || now < (this.heldUntil.get(prev) ?? 0)) return;
      this.lastUp = { level: prev, at: now };
      this.target = prev;
    }
  }

  /** Turn every knob to where `level` puts it. */
  apply(level: number): void {
    const k = this.knobs;
    const caps = k.pixelRatioSteps();
    this.level = level;
    this.target = level;
    k.setAoSamples(level >= 1 ? 0.5 : 1);
    k.setAoResolution(level >= 2 ? 0.5 : 1);
    k.setShadowEconomy(level >= 3);
    const capSteps = Math.min(Math.max(level - 3, 0), caps.length);
    k.setPixelRatioCap(capSteps > 0 ? caps[capSteps - 1] : Infinity);
    k.setShadowMapScale(level >= 4 + caps.length ? 0.5 : 1);
  }

  /** What the level in force has turned down, for the meter. */
  describe(): string {
    if (!this.enabledFlag && this.level === 0) return 'off';
    const k = this.knobs;
    const caps = k.pixelRatioSteps();
    const parts: string[] = [];
    if (this.level >= 1 && k.hasAo()) parts.push('AO samples ½');
    if (this.level >= 2 && k.hasAo()) parts.push('AO ½ res');
    if (this.level >= 3) parts.push('softer shadows');
    const capSteps = Math.min(Math.max(this.level - 3, 0), caps.length);
    if (capSteps > 0) parts.push(`pixel ratio ${caps[capSteps - 1]}`);
    if (this.level >= 4 + caps.length) parts.push('shadow maps ½');
    const state = parts.length ? parts.join(' · ') : 'full quality';
    return `${state}${this.target !== this.level ? ' (a change waits for a still moment)' : ''}`;
  }
}
