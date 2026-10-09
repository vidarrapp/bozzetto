import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  QUALITY_HIGH,
  getFirstEncodableVideoCodec,
  type VideoCodec,
} from 'mediabunny';
import type { VideoSink } from './types';

/**
 * H.264/MP4 sink backed by mediabunny. Mediabunny drives the platform WebCodecs
 * encoder and muxes the result; the output canvas is captured per frame via
 * CanvasSource.add(), and awaiting it respects encoder/writer backpressure, so
 * no frame is held once it is encoded: only the encoded bytes accumulate.
 *
 * `codecs` is what may be tried, in order (H.264 alone by default). Present's
 * Save turntable lets a browser that cannot encode H.264 - Chromium without
 * its proprietary codecs - fall back to VP9 or AV1, which MP4 carries too.
 */
export async function createMp4Sink(
  canvas: HTMLCanvasElement,
  fps: number,
  codecs: VideoCodec[] = ['avc'],
): Promise<VideoSink> {
  const { width, height } = canvas;
  const codec = await getFirstEncodableVideoCodec(codecs, { width, height });
  if (!codec) {
    throw new Error(
      `This browser can't encode ${codecs.length > 1 ? 'MP4 video' : 'H.264'} at ${width}×${height} — try the GIF format.`,
    );
  }

  const output = new Output({
    // Fast Start places the moov atom up front for immediate web playback.
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec,
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
    async cancel() {
      await output.cancel();
    },
  };
}
