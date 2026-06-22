import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { VideoSink } from './types';

/**
 * Animated-GIF sink via gifenc. Each frame is quantised to its own 256-colour
 * palette (a local colour table), which keeps gradients clean on shaded clay
 * renders at the cost of a little size. gifenc loops forever by default.
 */
export function createGifSink(canvas: HTMLCanvasElement, fps: number): VideoSink {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for GIF capture.');
  const gif = GIFEncoder();
  const frameDelay = Math.max(20, Math.round(1000 / fps)); // ms; GIF granularity is 10ms

  return {
    async addFrame(_index) {
      const { data } = ctx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256, { format: 'rgb565' });
      const index = applyPalette(data, palette, 'rgb565');
      gif.writeFrame(index, width, height, { palette, delay: frameDelay });
    },
    async finalize() {
      gif.finish();
      // Copy out of gifenc's internal buffer so the Blob owns its bytes.
      return new Blob([gif.bytes().slice()], { type: 'image/gif' });
    },
  };
}
