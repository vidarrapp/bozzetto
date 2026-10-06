import type { WebGPURenderer } from 'three/webgpu';

/** What the clock reaches inside three r184's renderer. */
interface RendererInternals {
  _animation?: { stop?: () => void };
  _nodes?: { nodeFrame?: { update?: () => void; frameId: number } };
  info: { autoReset: boolean; reset(): void; frame: number };
}

/**
 * The viewer's own frame clock. three r184 starts a requestAnimationFrame
 * loop of its own when the renderer initialises, and that loop is what
 * advances the node frame every pass keyed to a frame (the scene pass, GTAO,
 * the shadow maps) checks before it redraws. Owning it does two things:
 *
 * - the viewer's loop is the only one asking for frames, so an idle desktop
 *   app can actually slow down (Viewer.scheduleNext) rather than keep a
 *   second loop spinning as fast as the display allows;
 * - every render is a new frame, so a readback that renders sixteen
 *   jittered frames in one go (the smooth thumbnail) really draws sixteen,
 *   where three's clock would have let the scene pass draw once.
 *
 * Both reach private members, so the clock checks they exist and, if a
 * three upgrade has moved them, leaves three's own loop running (`owned`
 * false, which the latency suite asserts against).
 */
export class FrameClock {
  readonly owned: boolean;
  private readonly renderer: RendererInternals;

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer as unknown as RendererInternals;
    const animation = this.renderer._animation;
    const frame = this.renderer._nodes?.nodeFrame;
    this.owned = typeof animation?.stop === 'function' && typeof frame?.update === 'function';
    if (this.owned) animation!.stop!();
  }

  /**
   * Start a frame: what three's loop did at the top of each of its own,
   * the per-frame counters reset and the node frame advanced.
   */
  tick(): void {
    if (!this.owned) return;
    const r = this.renderer;
    if (r.info.autoReset) r.info.reset();
    const frame = r._nodes!.nodeFrame!;
    frame.update!();
    r.info.frame = frame.frameId;
  }

  /** The node frame's number (0 when the clock is not owned). */
  frameId(): number {
    return this.renderer._nodes?.nodeFrame?.frameId ?? 0;
  }
}
