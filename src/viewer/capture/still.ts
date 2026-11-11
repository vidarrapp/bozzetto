import type { Viewer } from '../Viewer';

/**
 * Save image's resolution: twice the window, or twice the device's pixel
 * ratio, held to this many pixels on the long side - a drawing buffer and
 * the still frame's sum past it would cost an iPad more memory than it has.
 */
export const STILL_MAX_SIDE = 4096;

/** Device pixels to a CSS pixel for Save image: twice the window's, within STILL_MAX_SIDE. */
export function stillRatio(viewer: Viewer): number {
  const { w, h } = viewer.viewportSize();
  return Math.min(Math.max(1, window.devicePixelRatio || 1) * 2, STILL_MAX_SIDE / Math.max(1, w, h));
}

/** A title as a file name: what a file system refuses goes, and an empty one is `fallback`. */
export function imageName(title: string, fallback = 'Sculpt'): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/^[.-]+|[.-]+$/g, '');
  return base || fallback;
}
