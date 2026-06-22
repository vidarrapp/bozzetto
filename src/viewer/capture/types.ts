import type { AspectId } from '../CaptureGuide';

export type ReelFormat = 'mp4' | 'gif';

/** Where the motion comes from: stepping the timeline, or spinning in place. */
export type ReelMotion = 'timeline' | 'turntable';

/** A frame consumer that encodes a clip. The source canvas is bound when the
 * sink is created; addFrame encodes its current contents for the given index. */
export interface VideoSink {
  /** Encode the source canvas's current contents as frame `index`. */
  addFrame(index: number): Promise<void>;
  /** Flush the encoder and produce the finished file. */
  finalize(): Promise<Blob>;
}

interface ReelCommon {
  aspect: AspectId;
  format: ReelFormat;
  /** Shorter output edge in pixels (e.g. 1080); the long edge follows the aspect. */
  size: number;
  /** Playback frame rate of the clip. */
  fps: number;
}

export type ReelOptions =
  // Step the timeline across an inclusive source-frame range.
  | (ReelCommon & { motion: 'timeline'; from: number; to: number })
  // Hold the current frame and spin it one full turn in place.
  | (ReelCommon & { motion: 'turntable'; spinSeconds: number; direction: 1 | -1 });

export type ReelProgress = (done: number, total: number) => void;
