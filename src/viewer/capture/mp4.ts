import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  QUALITY_HIGH,
  canEncodeVideo,
} from 'mediabunny';
import type { VideoSink } from './types';

/**
 * H.264/MP4 sink backed by mediabunny. Mediabunny drives the platform WebCodecs
 * encoder and muxes the result; the output canvas is captured per frame via
 * CanvasSource.add(), and awaiting it respects encoder/writer backpressure.
 */
export async function createMp4Sink(
  canvas: HTMLCanvasElement,
  fps: number,
): Promise<VideoSink> {
  const { width, height } = canvas;
  if (!(await canEncodeVideo('avc', { width, height }))) {
    throw new Error(
      `This browser can't encode H.264 at ${width}×${height} — try the GIF format.`,
    );
  }

  const output = new Output({
    // Fast Start places the moov atom up front for immediate web playback.
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 1, // a keyframe each second for reasonable seeking
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const frameDuration = 1 / fps; // seconds

  return {
    async addFrame(index) {
      // Encodes the canvas's current contents; the await applies backpressure.
      await source.add(index * frameDuration, frameDuration);
    },
    async finalize() {
      await output.finalize();
      const { buffer } = output.target;
      if (!buffer) throw new Error('MP4 finalization produced no data.');
      return new Blob([buffer], { type: 'video/mp4' });
    },
  };
}
