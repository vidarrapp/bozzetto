import Picking from '@sculpt-vendor/math3d/Picking';
import Enums from '@sculpt-vendor/misc/Enums';

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
 * The rake set: the two ZBrush stock rake alphas that comb at a default
 * brush on an unsubdivided sphere (owner call: the rest of the first batch
 * is set aside until hand-authored stencils replace it).
 *
 * What made these two the keepers was measured, not guessed - a stroke
 * rendered per stencil against the tine width each one puts on the model.
 * getAlpha maps the stencil onto the square inscribed in the brush disc,
 * so that width is about 0.7x the tine's width in the image:
 *
 *   rake06 10.7% -> three clean grooves
 *   rake07  6.7% -> fine chattery tines
 *
 * Below roughly 6% a tine is thinner than the gap between vertices, so it
 * lands between them and the stroke comes out looking like plain clay;
 * and shape matters too - dots cover little of the stroke's length, where
 * full-height bars comb. The retired stencils' PNGs stay in
 * public/assets/alphas for when the set is revisited.
 */
export const RAKE_ALPHAS: AlphaInfo[] = [
  { id: 'rake06', label: 'Broad tines' },
  { id: 'rake07', label: 'Tines' },
];

/**
 * The clay set: one stencil for now (owner call), the hand-drawn one whose
 * strands wander laterally as they run. On a rake that reads as chatter
 * rather than grooves; on clay, where the job is surface texture rather
 * than separated tines, that is exactly the point. Its own list, so the
 * clay stencils the owner is authoring slot in here without touching the
 * rake's.
 */
export const CLAY_ALPHAS: AlphaInfo[] = [{ id: 'rake05', label: 'Chatter' }];

/**
 * The widest tines in the set (10.7% of the brush) and the most of the dab
 * doing work (mean value 68/255) - the one that laid down three clean,
 * separated grooves at a default brush when every stencil was rendered
 * side by side.
 */
export const DEFAULT_RAKE_ALPHA = 'rake06';

/**
 * Which stencils a tool offers, and what it starts with.
 *
 * Any tool that stamps along a stroke can take an alpha - the vendored
 * core samples picking.getAlpha() per vertex inside every tool's loop, so
 * this is a question of what the panel offers, not of what the engine can
 * do. Two tools declare a set today:
 *
 *   Rake  - the stencil IS the tool, so it always has one.
 *   Clay  - off by default (owner call): Standard clay's job is a clean
 *           ribbon, and an alpha turns it into a textured one. Worth
 *           reaching for, not worth having to switch off.
 *
 * Each has its own list, so the stencils being authored for clay slot in
 * without touching the rake's.
 */
export interface AlphaSet {
  /** The stencils, in the order the picker shows them. */
  alphas: AlphaInfo[];
  /** What the tool starts with. null means no stencil - a plain brush. */
  initial: string | null;
  /** Whether the picker offers an "off" swatch. */
  allowNone: boolean;
}

export const ALPHA_SETS: Record<number, AlphaSet> = {
  [Enums.Tools.RAKE]: { alphas: RAKE_ALPHAS, initial: DEFAULT_RAKE_ALPHA, allowNone: false },
  [Enums.Tools.BRUSH]: { alphas: CLAY_ALPHAS, initial: null, allowNone: true },
};

/** Every stencil any tool can ask for, deduplicated. */
function allAlphaIds(): string[] {
  const ids = new Set<string>();
  for (const set of Object.values(ALPHA_SETS)) for (const a of set.alphas) ids.add(a.id);
  return [...ids];
}

const loaded = new Set<string>();
let loading: Promise<void> | null = null;

/** The alpha's image, for the picker thumbnails. */
export function alphaThumbUrl(id: string): string {
  return `/assets/alphas/thumbs/${id}.png`;
}

/**
 * Decode and register every stencil any tool offers, once. Runs in the
 * background at mount: until it resolves a stroke simply has no alpha
 * (getAlpha returns 1), which is a plain dab rather than an error.
 *
 * Registering once matters beyond the wasted work: Picking.addAlpha
 * appends a suffix on a name collision rather than replacing, so a second
 * registration of "rake06" silently becomes "rake061" and the id the
 * panel hands out stops resolving.
 */
export function loadBrushAlphas(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    await Promise.all(
      allAlphaIds().map(async (id) => {
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
