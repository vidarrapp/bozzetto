import type { AspectId } from '../CaptureGuide';

export type ReelFormat = 'mp4' | 'gif';

/** A frame consumer that encodes canvases into a downloadable clip. */
export interface VideoSink {
  /** Encode one frame (the canvas is reused, so read it before returning). */
  addFrame(canvas: HTMLCanvasElement, index: number): Promise<void>;
  /** Flush the encoder and produce the finished file. */
  finalize(): Promise<Blob>;
}

export interface ReelOptions {
  aspect: AspectId;
  format: ReelFormat;
  /** Shorter output edge in pixels (e.g. 1080); the long edge follows the aspect. */
  size: number;
  /** Playback frame rate of the clip. */
  fps: number;
  /** Inclusive source-frame range to capture. */
  from: number;
  to: number;
}

export type ReelProgress = (done: number, total: number) => void;
