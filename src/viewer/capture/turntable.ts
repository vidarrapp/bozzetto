import type { Vector3 } from 'three';
import type { Viewer } from '../Viewer';
import { createMp4Sink } from './mp4';
import { createGifSink } from './gif';
import type { ReelFormat, VideoSink } from './types';

/**
 * Present mode's Save turntable: one full turn of the camera about the
 * subject's vertical axis, from the view as it stands, at the turntable's
 * own speed (so 36°/s is a ten-second clip), rendered offline frame by
 * frame - never grabbed from the live loop. Each frame sets the camera's
 * angle from one mark (Viewer.placeCameraTurned), is drawn with the still
 * frame's smoothing finished (Viewer.drawStill, at TURNTABLE_SAMPLES) and
 * goes straight to the encoder, which keeps only encoded bytes: the MP4
 * encoder streams frames through WebCodecs with backpressure, and each GIF
 * frame is quantised as it comes. The camera is put back exactly at the
 * end, finished or cancelled, and the live loop resumes.
 */

/** Frames a second: smooth for MP4, half that for a GIF's size. */
export const TURNTABLE_FPS: Record<ReelFormat, number> = { mp4: 30, gif: 15 };
/** The clip's long side at most, in pixels. */
export const TURNTABLE_LONG_SIDE: Record<ReelFormat, number> = { mp4: 1920, gif: 1080 };
/**
 * Smoothing samples a frame. Eight costs well under half the still
 * image's sixteen, and in motion the difference does not show: measured
 * in the test harness (software WebGL), a 1920x1080 frame took 2.1 s at
 * eight and 4.8 s at sixteen.
 */
export const TURNTABLE_SAMPLES = 8;
/** H.264 first; a browser without it (Chromium's own builds) falls back to VP9 or AV1 in the MP4. */
const MP4_CODECS = ['avc', 'vp9', 'av1'] as const;

export interface TurntablePlan {
  fps: number;
  /** Frames in the clip: one turn, the last a step short of where the first is. */
  frames: number;
  /** Its length, frames over fps. */
  seconds: number;
  /** Device pixels to the viewport's CSS pixel while it renders. */
  ratio: number;
}

/** What a clip will be, for a viewport, format, size (1x or 2x the window) and speed. */
export function turntablePlan(
  view: { w: number; h: number },
  format: ReelFormat,
  scale: number,
  degPerSecond: number,
): TurntablePlan {
  const fps = TURNTABLE_FPS[format];
  const frames = Math.max(2, Math.round((360 / Math.max(1e-3, degPerSecond)) * fps));
  const ratio = Math.min(Math.max(1, scale), TURNTABLE_LONG_SIDE[format] / Math.max(1, view.w, view.h));
  return { fps, frames, seconds: frames / fps, ratio };
}

export interface TurntableClipOptions {
  format: ReelFormat;
  /** The window at 1x or 2x. */
  scale: number;
  /** The turntable's speed: the clip turns at it. */
  degPerSecond: number;
  /** A point on the vertical axis it turns about. */
  centre: Vector3;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Render and encode the clip; null when it was cancelled (the signal). */
export async function recordTurntable(viewer: Viewer, opts: TurntableClipOptions): Promise<Blob | null> {
  const plan = turntablePlan(viewer.viewportSize(), opts.format, opts.scale, opts.degPerSecond);
  const mark = viewer.cameraMark();
  const buffer = viewer.beginStills(plan.ratio);
  let sink: VideoSink | null = null;
  let finished = false;
  try {
    const out = document.createElement('canvas');
    // H.264 wants even sides; drawStill crops the odd pixel about the centre.
    out.width = even(buffer.width);
    out.height = even(buffer.height);
    const ctx = out.getContext('2d', { willReadFrequently: opts.format === 'gif' });
    if (!ctx) throw new Error('2D context unavailable for capture.');
    sink = opts.format === 'mp4' ? await createMp4Sink(out, plan.fps, [...MP4_CODECS]) : createGifSink(out, plan.fps);
    const step = 360 / plan.frames;
    for (let n = 0; n < plan.frames; n++) {
      if (opts.signal?.aborted) return null;
      viewer.placeCameraTurned(mark, opts.centre, n * step);
      await viewer.drawStill(ctx, TURNTABLE_SAMPLES);
      await sink.addFrame(n);
      opts.onProgress?.(n + 1, plan.frames);
      // The progress bar paints, and a Cancel press is heard.
      await new Promise((resolve) => setTimeout(resolve));
    }
    if (opts.signal?.aborted) return null;
    const blob = await sink.finalize();
    finished = true;
    return blob;
  } finally {
    if (!finished) await sink?.cancel?.().catch(() => {});
    viewer.placeCameraTurned(mark, opts.centre, 0);
    viewer.endStills();
  }
}

/** The largest even integer ≤ n, at least 2. */
function even(n: number): number {
  const v = Math.max(2, Math.floor(n));
  return v - (v % 2);
}
