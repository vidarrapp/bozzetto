import type { StageEntry } from '../types/manifest';

export interface TimelineOptions {
  loop?: boolean;
  playing?: boolean;
}

/**
 * Playback clock (design doc §10).
 *
 * Accumulates real time and advances the playhead by `fps`, resolving to an
 * integer frame ordinal. Rendering runs at display refresh independent of this
 * low, deliberate timeline rate.
 */
export class Timeline {
  readonly frameCount: number;
  fps: number;
  loop: boolean;
  playing: boolean;

  /** Floating-point playhead in frame units. */
  private playhead = 0;

  private readonly stages: StageEntry[];

  constructor(
    frameCount: number,
    fps: number,
    stages: StageEntry[] = [],
    opts: TimelineOptions = {},
  ) {
    this.frameCount = Math.max(1, frameCount);
    this.fps = fps;
    this.loop = opts.loop ?? true;
    this.playing = opts.playing ?? true;
    // Stages sorted so stage resolution is a simple backwards scan.
    this.stages = [...stages].sort((a, b) => a.frame - b.frame);
  }

  /** Advance the playhead. `dt` is elapsed seconds since the last tick. */
  update(dt: number): void {
    if (!this.playing) return;
    this.playhead += dt * this.fps;
    if (this.playhead >= this.frameCount) {
      if (this.loop) {
        this.playhead %= this.frameCount;
      } else {
        this.playhead = this.frameCount - 1;
        this.playing = false;
      }
    }
  }

  /** Current integer frame ordinal in [0, frameCount). */
  frameIndex(): number {
    return Math.min(this.frameCount - 1, Math.max(0, Math.floor(this.playhead)));
  }

  /** Jump to a frame ordinal (used by the scrubber and stage jumps). */
  setFrame(index: number): void {
    this.playhead = Math.min(this.frameCount - 1, Math.max(0, index));
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  togglePlay(): void {
    this.playing = !this.playing;
  }

  /** Step one frame forward, pausing playback (transport control). */
  stepForward(): void {
    this.pause();
    this.setFrame((this.frameIndex() + 1) % this.frameCount);
  }

  /** Step one frame back, pausing playback. */
  stepBack(): void {
    this.pause();
    this.setFrame((this.frameIndex() - 1 + this.frameCount) % this.frameCount);
  }

  setFps(fps: number): void {
    this.fps = Math.max(0.1, fps);
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  /** The stage active at the given frame, or null before the first stage. */
  stageAt(index: number): StageEntry | null {
    let active: StageEntry | null = null;
    for (const stage of this.stages) {
      if (stage.frame <= index) active = stage;
      else break;
    }
    return active;
  }
}
