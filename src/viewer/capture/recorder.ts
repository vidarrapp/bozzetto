import type { Viewer } from '../Viewer';
import { aspectRatio, type AspectId } from '../CaptureGuide';
import { createMp4Sink, mp4Supported } from './mp4';
import { createGifSink } from './gif';
import type { ReelFormat, ReelOptions, ReelProgress, VideoSink } from './types';

export { mp4Supported };
export type { ReelFormat, ReelOptions };

/** Render denser than the output, then downscale on draw, for cheap anti-aliasing. */
const SUPERSAMPLE = 1.5;
/** Cap on the renderer's larger dimension during capture (GPU + perf safety). */
const MAX_RENDER_DIM = 4096;

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Capture a frame range to an MP4 or GIF blob. Renders the live framing at a
 * higher resolution and crops the guide rectangle, so the result matches the
 * on-screen crop guide exactly. The viewer's render loop is paused throughout.
 */
export async function recordReel(
  viewer: Viewer,
  opts: ReelOptions,
  onProgress?: ReelProgress,
): Promise<Blob> {
  const { outW, outH } = outputDims(opts.aspect, opts.size);
  const view = viewer.viewportSize();
  const { capW, capH, crop } = captureGeometry(view.w, view.h, opts.aspect, outW, outH);

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for capture.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const sink: VideoSink =
    opts.format === 'mp4'
      ? await createMp4Sink(outW, outH, opts.fps)
      : createGifSink(outW, outH, opts.fps);

  const from = Math.max(0, Math.min(opts.from, opts.to));
  const to = Math.max(opts.from, opts.to);
  const total = to - from + 1;

  viewer.beginCapture(capW, capH);
  try {
    for (let i = from, n = 0; i <= to; i++, n++) {
      await viewer.renderCaptureFrame(i);
      ctx.drawImage(viewer.captureCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
      await sink.addFrame(out, n);
      onProgress?.(n + 1, total);
      await tick(); // yield so the progress bar paints and the tab stays responsive
    }
  } finally {
    viewer.endCapture();
  }

  return sink.finalize();
}

/** Output pixel dimensions for an aspect, given the shorter edge length. */
export function outputDims(aspect: AspectId, size: number): { outW: number; outH: number } {
  const ta = aspectRatio(aspect);
  if (ta <= 1) {
    // Portrait or square: the shorter edge is the width.
    return { outW: even(size), outH: even(size / ta) };
  }
  // Landscape: the shorter edge is the height.
  return { outW: even(size * ta), outH: even(size) };
}

/**
 * Resolve the capture render size (live aspect, scaled up) and the centred crop
 * rectangle within it for the target aspect. The scale makes the crop at least
 * the supersampled output, capped so the renderer stays within GPU limits.
 */
function captureGeometry(
  viewW: number,
  viewH: number,
  aspect: AspectId,
  outW: number,
  outH: number,
): { capW: number; capH: number; crop: CropRect } {
  const viewAspect = viewW / viewH;
  const ta = aspectRatio(aspect);

  let baseCropW: number;
  let baseCropH: number;
  if (ta <= viewAspect) {
    baseCropH = viewH;
    baseCropW = viewH * ta;
  } else {
    baseCropW = viewW;
    baseCropH = viewW / ta;
  }

  let k = SUPERSAMPLE * Math.max(outW / baseCropW, outH / baseCropH);
  k = Math.min(k, MAX_RENDER_DIM / Math.max(viewW, viewH));
  const capW = Math.max(2, Math.round(viewW * k));
  const capH = Math.max(2, Math.round(viewH * k));

  const capAspect = capW / capH;
  let cropW: number;
  let cropH: number;
  if (ta <= capAspect) {
    cropH = capH;
    cropW = Math.round(capH * ta);
  } else {
    cropW = capW;
    cropH = Math.round(capW / ta);
  }
  const crop: CropRect = {
    x: Math.round((capW - cropW) / 2),
    y: Math.round((capH - cropH) / 2),
    w: cropW,
    h: cropH,
  };
  return { capW, capH, crop };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

/** Nearest even integer ≥ 2 (H.264 requires even dimensions). */
function even(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v - (v % 2);
}

/** A filesystem-friendly name like `my-sculpt_9x16.mp4`. */
export function reelFilename(title: string, aspect: AspectId, format: ReelFormat): string {
  const slug = (title || 'reel')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'reel';
  return `${slug}_${aspect.replace(':', 'x')}.${format}`;
}

/** Trigger a browser download for a generated blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
