import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { VideoSink } from './types';

/**
 * Animated-GIF sink via gifenc. Each frame is quantised to its own 256-colour
 * palette (a local colour table), which keeps gradients clean on shaded clay
 * renders at the cost of a little size. gifenc loops forever by default.
 * Frames are quantised one at a time as they come: only the encoded bytes
 * are kept.
 */
export function createGifSink(canvas: HTMLCanvasElement, fps: number): VideoSink {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for GIF capture.');
  const gif = GIFEncoder();
  // GIF delays are in hundredths of a second: each frame's is the step to
  // where it should end, so the delays add up to the clip's length (15 fps
  // alternates 70 and 60 ms) instead of all rounding one way.
  const centis = (n: number): number => Math.round((n * 100) / fps);
  const delayOf = (index: number): number => Math.max(2, centis(index + 1) - centis(index)) * 10;

  return {
    async addFrame(index) {
      const { data } = ctx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256, { format: 'rgb565' });
      const pixels = applyPalette(data, palette, 'rgb565');
      gif.writeFrame(pixels, width, height, { palette, delay: delayOf(index) });
    },
    async finalize() {
      gif.finish();
      // Copy out of gifenc's internal buffer so the Blob owns its bytes.
      return new Blob([gif.bytes().slice()], { type: 'image/gif' });
    },
  };
}
