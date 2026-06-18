import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { VideoSink } from './types';

/**
 * H.264/MP4 sink backed by the platform WebCodecs VideoEncoder and mp4-muxer.
 * Profiles are tried high-to-low so 1080p+ portrait works where supported while
 * still falling back to baseline on lighter devices.
 */
const H264_CANDIDATES = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f'];

export function mp4Supported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function createMp4Sink(
  width: number,
  height: number,
  fps: number,
): Promise<VideoSink> {
  if (!mp4Supported()) {
    throw new Error('This browser has no WebCodecs MP4 encoder — try the GIF format.');
  }

  const bitrate = targetBitrate(width, height, fps);
  let config: VideoEncoderConfig | null = null;
  for (const codec of H264_CANDIDATES) {
    const candidate: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: 'quality',
    };
    const support = await VideoEncoder.isConfigSupported(candidate);
    if (support.supported) {
      config = support.config ?? candidate;
      break;
    }
  }
  if (!config) {
    throw new Error(`No supported H.264 encoder configuration for ${width}×${height}.`);
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encodeError = err instanceof Error ? err : new Error(String(err));
    },
  });
  encoder.configure(config);

  const frameDuration = 1_000_000 / fps; // microseconds
  const keyInterval = Math.max(1, Math.round(fps)); // a keyframe roughly each second

  return {
    async addFrame(canvas, index) {
      if (encodeError) throw encodeError;
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(index * frameDuration),
        duration: Math.round(frameDuration),
      });
      encoder.encode(frame, { keyFrame: index % keyInterval === 0 });
      frame.close();
      // Backpressure: let the encoder drain so its queue can't grow unbounded.
      while (encoder.encodeQueueSize > 4) {
        await delay(0);
        if (encodeError) throw encodeError;
      }
    },
    async finalize() {
      await encoder.flush();
      encoder.close();
      if (encodeError) throw encodeError;
      muxer.finalize();
      return new Blob([muxer.target.buffer], { type: 'video/mp4' });
    },
  };
}

/** ~0.1 bits per pixel·frame, clamped to a sane range for 3D turntable clips. */
function targetBitrate(width: number, height: number, fps: number): number {
  const bits = width * height * fps * 0.1;
  return Math.round(Math.min(16_000_000, Math.max(2_000_000, bits)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
