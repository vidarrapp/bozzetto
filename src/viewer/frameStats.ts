/**
 * Where each frame's time goes, for the frame meter (P, or Preferences >
 * Diagnostics). The owner's question was why a laptop sculpts at a locked
 * 30 fps where a desktop makes 60: browsers always wait for the display, so
 * a frame a little over one refresh waits for the next and the rate halves.
 * Whether that is the CPU's fault, the GPU's, or a cap set by the browser or
 * the system (Chrome's Energy Saver holds pages to 30 fps on battery) is the
 * first thing to know, and this is what tells them apart.
 *
 * Always on: a few performance.now() reads and typed-array writes a frame,
 * no allocation. The GPU's share is fed in from outside (Viewer.sampleGpu),
 * and only while the meter is up, because reading it back costs a little.
 */

/** Frames kept: two seconds at 60 Hz, more than a second at 120. */
const N = 120;
/**
 * A gap this long is the tab hidden, a capture or a freeze, not a frame.
 * Generous, because a slow device (or a software renderer) can take a few
 * hundred milliseconds over every frame, and those still count.
 */
const GAP_MS = 1000;
/** How many frames between refresh-rate estimates. */
const ESTIMATE_EVERY = 30;
/** Frames an estimate looks back over. */
const ESTIMATE_WINDOW = 60;
/** A slower refresh is believed only after this long (a cap, or another display). */
const SLOWER_AFTER_MS = 10_000;
/**
 * The summary covers the last second, or the last this many frames when
 * that is longer: a device managing three frames a second still gets a
 * verdict, from the last few seconds.
 */
const SUMMARY_FRAMES = 8;
/** "Short" is a share of the budget this large or more, on average. */
const SHORT = 0.85;
/** Refresh rates displays and browser caps actually use, for the label. */
const KNOWN_HZ = [24, 25, 30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 180, 200, 240, 280, 360];

export type GpuSource = 'timestamps' | 'submit';

export interface FrameSummary {
  /** Frames counted in the summary's window (the last second, or SUMMARY_FRAMES). */
  frames: number;
  fps: number;
  /** The display's refresh period, ms; 0 until there is enough to go on. */
  periodMs: number;
  /** The refresh rate as a display would name it (59.94 reads 60). */
  refreshHz: number;
  /** Refreshes in the window the page let pass without a new frame. */
  missed: number;
  /** Refreshes in the window. */
  refreshes: number;
  /** Main-thread ms per frame: input + loop + encode, means over the window. */
  cpuMs: number;
  /** Stroke or pose-drag handlers that fed the frame (pointer events). */
  inputMs: number;
  /** The vendored stroke step alone (picking, sculpting, normals). */
  stepMs: number;
  /** The loop's own work: timeline, controls, the per-frame hooks. */
  loopMs: number;
  /** renderOnce: three's encoding and submission of every pass. */
  encodeMs: number;
  /** Pointer moves handled per frame, over frames that had any. */
  movesPerFrame: number;
  /** GPU ms per frame, null when not measured. */
  gpuMs: number | null;
  gpuSource: GpuSource | null;
  /** From the oldest input event a frame used to the end of its submission. */
  inputToSubmitMs: number | null;
  /** From that event to the GPU finishing the frame (WebGPU only). */
  inputToReadyMs: number | null;
  verdict: string;
}

export class FrameStats {
  private readonly interval = new Float32Array(N);
  private readonly input = new Float32Array(N);
  private readonly step = new Float32Array(N);
  private readonly loop = new Float32Array(N);
  private readonly encode = new Float32Array(N);
  private readonly moves = new Uint16Array(N);
  private readonly latency = new Float32Array(N);
  private head = 0;
  private count = 0;
  private lastRaf = -1;
  private sinceEstimate = 0;
  private readonly scratch = new Float32Array(ESTIMATE_WINDOW);

  /** The refresh period in ms (0 = not yet known). */
  periodMs = 0;
  /** When a slower refresh than the believed one was first seen, or -1. */
  private slowerSince = -1;

  // Input handled since the last frame, which the next frame carries.
  private pendingInput = 0;
  private pendingStep = 0;
  private pendingMoves = 0;
  private pendingEarliest = -1;

  // The GPU side, fed asynchronously and only while the meter is up.
  private gpu = 0;
  private gpuAt = -1;
  private gpuSource: GpuSource | null = null;
  private ready = 0;
  private readyAt = -1;

  /**
   * A pointer handler did work for the coming frame: its whole time, the
   * vendored step's part of it (0 for a pose drag), and the event's own
   * timestamp, for the input-to-frame latency.
   */
  noteInput(ms: number, eventTime: number, stepMs = 0): void {
    this.pendingInput += ms;
    this.pendingStep += stepMs;
    this.pendingMoves++;
    if (eventTime > 0 && (this.pendingEarliest < 0 || eventTime < this.pendingEarliest)) {
      this.pendingEarliest = eventTime;
    }
  }

  /**
   * Close a frame. `rafTime` is the timestamp rAF handed the loop, which
   * both browsers align to the display's refresh, so its spacing measures
   * the refresh itself whenever a frame is on time. Returns the oldest
   * input event the frame used (performance.now() time), or -1.
   */
  endFrame(rafTime: number, loopMs: number, encodeMs: number, submittedAt: number): number {
    const i = this.head;
    this.interval[i] = this.lastRaf >= 0 ? rafTime - this.lastRaf : 0;
    this.lastRaf = rafTime;
    this.input[i] = this.pendingInput;
    this.step[i] = this.pendingStep;
    this.loop[i] = loopMs;
    this.encode[i] = encodeMs;
    this.moves[i] = Math.min(this.pendingMoves, 65535);
    const earliest = this.pendingEarliest;
    this.latency[i] = earliest >= 0 ? submittedAt - earliest : -1;
    this.pendingInput = 0;
    this.pendingStep = 0;
    this.pendingMoves = 0;
    this.pendingEarliest = -1;
    this.head = (i + 1) % N;
    if (this.count < N) this.count++;
    if (++this.sinceEstimate >= ESTIMATE_EVERY) {
      this.sinceEstimate = 0;
      this.estimateRefresh(rafTime);
    }
    return earliest;
  }

  /** The loop was paused (a capture, a hidden tab): the next gap is not a frame. */
  resetClock(): void {
    this.lastRaf = -1;
  }

  /** GPU time for a recent frame, from timestamp queries or submit-to-done. */
  noteGpu(ms: number, source: GpuSource): void {
    // Smoothed: a resolve lands a frame or two late and each is one frame.
    this.gpu = this.gpuAt < 0 || this.gpuSource !== source ? ms : this.gpu + (ms - this.gpu) * 0.2;
    this.gpuSource = source;
    this.gpuAt = performance.now();
  }

  /** Input event to the GPU finishing the frame that used it. */
  noteReady(ms: number): void {
    this.ready = this.readyAt < 0 ? ms : this.ready + (ms - this.ready) * 0.2;
    this.readyAt = performance.now();
  }

  /** Forget the GPU side (the meter closed, so nothing keeps it current). */
  clearGpu(): void {
    this.gpuAt = -1;
    this.gpuSource = null;
    this.readyAt = -1;
  }

  /**
   * The refresh period: the shortest interval that keeps coming back. Taken
   * from a low percentile of recent frames, so one late frame or a run of
   * them cannot raise it, and a faster reading is believed at once (a frame
   * can be late, never early). A slower one is believed only after it has
   * held for SLOWER_AFTER_MS: a display swap, or a cap switched on.
   */
  private estimateRefresh(now: number): void {
    const n = Math.min(this.count, ESTIMATE_WINDOW);
    let k = 0;
    for (let j = 1; j <= n; j++) {
      const d = this.interval[(this.head - j + N) % N];
      if (d > 0 && d < GAP_MS) this.scratch[k++] = d;
    }
    if (k < ESTIMATE_WINDOW / 2) return;
    const sorted = this.scratch.subarray(0, k).sort();
    const candidate = sorted[Math.floor(k * 0.05)];
    if (this.periodMs === 0 || candidate < this.periodMs * 0.9) {
      this.periodMs = candidate;
      this.slowerSince = -1;
    } else if (candidate > this.periodMs * 1.15) {
      if (this.slowerSince < 0) this.slowerSince = now;
      else if (now - this.slowerSince > SLOWER_AFTER_MS) {
        this.periodMs = candidate;
        this.slowerSince = -1;
      }
    } else {
      this.periodMs += (candidate - this.periodMs) * 0.25;
      this.slowerSince = -1;
    }
  }

  summary(): FrameSummary {
    const P = this.periodMs;
    // The last second, or the last SUMMARY_FRAMES if that is longer,
    // newest first, gaps left out.
    let frames = 0;
    let spent = 0;
    let missed = 0;
    let refreshes = 0;
    let input = 0;
    let step = 0;
    let loop = 0;
    let encode = 0;
    let moves = 0;
    let movingFrames = 0;
    let lat = 0;
    let latFrames = 0;
    for (let j = 1; j <= this.count && (spent < 1000 || frames < SUMMARY_FRAMES); j++) {
      const i = (this.head - j + N) % N;
      const d = this.interval[i];
      if (d <= 0 || d >= GAP_MS) continue;
      frames++;
      spent += d;
      if (P > 0) {
        const r = Math.max(1, Math.round(d / P));
        refreshes += r;
        missed += r - 1;
      }
      input += this.input[i];
      step += this.step[i];
      loop += this.loop[i];
      encode += this.encode[i];
      if (this.moves[i] > 0) {
        moves += this.moves[i];
        movingFrames++;
      }
      if (this.latency[i] >= 0) {
        lat += this.latency[i];
        latFrames++;
      }
    }
    const per = (v: number): number => (frames ? v / frames : 0);
    const cpuMs = per(input + loop + encode);
    const now = performance.now();
    const gpuFresh = this.gpuAt >= 0 && now - this.gpuAt < 2000;
    const gpuMs = gpuFresh ? this.gpu : null;
    const gpuSource = gpuFresh ? this.gpuSource : null;
    const summary: FrameSummary = {
      frames,
      fps: spent > 0 ? (frames * 1000) / spent : 0,
      periodMs: P,
      refreshHz: P > 0 ? nameRate(1000 / P) : 0,
      missed,
      refreshes,
      cpuMs,
      inputMs: per(input),
      stepMs: per(step),
      loopMs: per(loop),
      encodeMs: per(encode),
      movesPerFrame: movingFrames ? moves / movingFrames : 0,
      gpuMs,
      gpuSource,
      inputToSubmitMs: latFrames ? lat / latFrames : null,
      inputToReadyMs: this.readyAt >= 0 && now - this.readyAt < 2000 ? this.ready : null,
      verdict: '',
    };
    summary.verdict = verdictOf(summary);
    return summary;
  }
}

/**
 * Which side is short, in words. "Capped" is the case worth catching
 * first: a refresh under 40 Hz with the work well inside it is a limit
 * set by the browser or the system (or a slow display), and nothing in
 * the page will lift it.
 */
export function verdictOf(s: FrameSummary): string {
  const P = s.periodMs;
  if (!P || s.frames < 3) return 'measuring';
  const gpu = s.gpuMs ?? 0;
  if (P > 25 && s.cpuMs < P * 0.6 && gpu < P * 0.6) {
    return `capped at ${s.refreshHz} Hz by the browser, the system or the display`;
  }
  if (s.refreshes > 0 && s.missed / s.refreshes < 0.05) return 'within budget';
  if (s.gpuMs !== null && s.gpuSource === 'timestamps' && s.gpuMs > P * SHORT) return 'GPU short';
  if (s.cpuMs > P * SHORT) return 'CPU short';
  if (s.gpuMs !== null && s.gpuMs > P * SHORT) return 'GPU short (estimated)';
  return 'missing frames with time to spare: the browser or the system';
}

/** 59.94 reads 60 and 143.8 reads 144; anything else, to the nearest hertz. */
function nameRate(hz: number): number {
  for (const k of KNOWN_HZ) if (Math.abs(hz - k) / k < 0.03) return k;
  return Math.round(hz);
}

/** "9.1", or "0.32" under a millisecond: the meter's own number format. */
export function ms(v: number): string {
  return v < 1 ? v.toFixed(2) : v.toFixed(1);
}
