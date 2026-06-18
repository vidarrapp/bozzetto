import type { AspectId } from '../CaptureGuide';

export type ReelFormat = 'mp4' | 'gif';

/**
 * A frame consumer that encodes a clip. The source canvas is bound when the
 * sink is created; addFrame encodes its current contents for the given index.
 */
export interface VideoSink {
  /** Encode the source canvas's current contents as frame `index`. */
  addFrame(index: number): Promise<void>;
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
