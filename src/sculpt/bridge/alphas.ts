import Picking from '@sculpt-vendor/math3d/Picking';

/**
 * Brush alphas: greyscale stencils the stroke stamps through.
 *
 * The vendored core already had the hard half of this - Picking keeps a
 * lookAt matrix built from the stroke's own direction, so an alpha ROTATES
 * to follow the stroke, and every tool already multiplies its falloff by
 * picking.getAlpha(). All that was missing was images and a way to pick
 * one. Registration is Picking.addAlpha(bytes, w, h, name), and a tool
 * selects one by setting its _idAlpha to that name.
 *
 * The images are single-channel PNGs; only the red channel is read, so a
 * greyscale source is exactly what is wanted (white = full effect).
 */
export interface AlphaInfo {
  id: string;
  label: string;
}

/** The rake set (owner-supplied): coarse to fine, then a hand-drawn one. */
export const RAKE_ALPHAS: AlphaInfo[] = [
  { id: 'rake01', label: 'Broad' },
  { id: 'rake02', label: 'Dots' },
  { id: 'rake03', label: 'Bars' },
  { id: 'rake04', label: 'Fine bars' },
  { id: 'rake05', label: 'Hand-drawn' },
];

/**
 * The hand-drawn one, by measurement: with a stroke across the default
 * sphere it moved ~1100 vertices in a strongly bimodal profile (real
 * tines), where the machine-drawn bars moved 12-300 and read as a faint
 * smudge. The bar stencils are 2-3% white, so nearly every alpha sample
 * in a dab comes back zero; they want a much larger brush to read.
 */
export const DEFAULT_RAKE_ALPHA = 'rake05';

const loaded = new Set<string>();
let loading: Promise<void> | null = null;

/** The alpha's image, for the picker thumbnails. */
export function alphaThumbUrl(id: string): string {
  return `/assets/alphas/thumbs/${id}.png`;
}

/**
 * Decode and register every rake alpha, once. Runs in the background at
 * mount: until it resolves, a rake stroke simply has no alpha (getAlpha
 * returns 1), which is a plain clay dab rather than an error.
 */
export function loadRakeAlphas(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    await Promise.all(
      RAKE_ALPHAS.map(async ({ id }) => {
        if (loaded.has(id)) return;
        try {
          const res = await fetch(`/assets/alphas/${id}.png`);
          if (!res.ok) throw new Error(`${res.status}`);
          const bitmap = await createImageBitmap(await res.blob());
          const { width, height } = bitmap;
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('no 2d context');
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const rgba = ctx.getImageData(0, 0, width, height).data;
          const gray = new Uint8Array(width * height);
          for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
          Picking.addAlpha(gray, width, height, id);
          loaded.add(id);
        } catch (err) {
          // A missing alpha costs the texture, not the brush.
          console.warn(`brush alpha "${id}" failed to load:`, err);
        }
      }),
    );
  })();
  return loading;
}
