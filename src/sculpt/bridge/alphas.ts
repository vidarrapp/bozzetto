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

/**
 * The rake set, ordered as the picker shows it: broad tines first, finest
 * last. rake06-09 came from ZBrush's stock alphas (owner-supplied, for
 * testing until hand-authored ones land); the rest are the first batch.
 *
 * What separates the ones that cut from the ones that do not is the width
 * of a tine relative to the brush, measured as (stencil fraction * 0.707,
 * since the stencil covers the square inscribed in the brush disc):
 *
 *   rake06 10.7% of the brush | rake01 10.6% | rake07 6.7% | rake09 6.2%
 *   rake08  6.0%              | rake02  3.6% | rake03 3.3% | rake04 2.5%
 *   rake05  1.4%
 *
 * Below ~6% a tine is thinner than the gap between vertices on an
 * unsubdivided sphere, so it lands between them and the stroke reads as a
 * plain clay ribbon. The bottom of that list wants either a much larger
 * brush or a subdivided mesh; they are kept because they do come alive
 * there, not because they work everywhere.
 */
export const RAKE_ALPHAS: AlphaInfo[] = [
  { id: 'rake06', label: 'Broad tines' },
  { id: 'rake01', label: 'Broad' },
  { id: 'rake07', label: 'Tines' },
  { id: 'rake03', label: 'Bars' },
  { id: 'rake04', label: 'Fine bars' },
  { id: 'rake08', label: 'Graduated' },
  { id: 'rake09', label: 'Beads' },
  { id: 'rake02', label: 'Dots' },
  { id: 'rake05', label: 'Hand-drawn' },
];

/**
 * The broadest tines, by measurement: widest tine relative to the brush
 * (10.7%) and the most of the dab doing work (mean value 68/255 against
 * 11-34 for the first batch), which is the combination that reads as a
 * comb at a default brush on an unsubdivided sphere.
 */
export const DEFAULT_RAKE_ALPHA = 'rake06';

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
