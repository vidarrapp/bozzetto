import { Color } from 'three';

/**
 * Colours that arrive from outside: a .bozz file, the autosave, a saved
 * look, a project's manifest, a single-file export's registry.
 *
 * Every colour the app writes is `#rrggbb`, but nothing made the ones it
 * reads be. A light's or the backdrop's colour went straight into a panel
 * swatch's `style.background`, so a look carrying
 * `"bgColor": "url(https://elsewhere/p)"` had the browser of everyone who
 * opened it fetch that address, single-file exports included. So a colour
 * is read through three.js, which understands every form the app could
 * have meant (hex, `rgb()`, `hsl()`, the CSS names), and written back as
 * `#rrggbb`; anything three.js cannot read is `fallback` instead.
 */

const HEX = /^#[0-9a-f]{6}$/i;

/** The only colour form the app writes, and the only one it paints. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** `value` as `#rrggbb` (lower case), or `fallback` when it is no colour. */
export function hexColor<F extends string | undefined>(value: unknown, fallback: F): string | F {
  if (isHexColor(value)) return value.toLowerCase();
  // A CSS colour is short; a long string is no colour, whatever it holds.
  if (typeof value !== 'string' || value.length > 64) return fallback;
  // three.js leaves a colour it cannot read as it was and only warns, so
  // the colour starts as NaN: still NaN afterwards means not understood.
  const c = new Color(NaN, NaN, NaN);
  c.setStyle(value.trim());
  return Number.isNaN(c.r) ? fallback : `#${c.getHexString()}`;
}
