import { selectEl } from './dom';

/**
 * Layer blend modes, in the order and groups of Photoshop's layer menu.
 * One list for everything that blends a picture over another: the
 * Reference panel's picture over the view, and the Paint workspace's layers.
 *
 * `css` is the mix-blend-mode that matches the mode where the browser has
 * one, so a picture can blend live over the 3D view as an element; null
 * for the modes it has no equal of (they need a renderer or a canvas pass).
 */
export interface BlendMode {
  id: string;
  label: string;
  /** Photoshop's group: 0 Normal, 1 Darken, 2 Lighten, 3 Contrast, 4 Comparative, 5 Colour. */
  group: number;
  css: string | null;
}

export const BLEND_MODES: readonly BlendMode[] = [
  { id: 'normal', label: 'Normal', group: 0, css: 'normal' },
  { id: 'dissolve', label: 'Dissolve', group: 0, css: null },

  { id: 'darken', label: 'Darken', group: 1, css: 'darken' },
  { id: 'multiply', label: 'Multiply', group: 1, css: 'multiply' },
  { id: 'color-burn', label: 'Color Burn', group: 1, css: 'color-burn' },
  { id: 'linear-burn', label: 'Linear Burn', group: 1, css: null },
  { id: 'darker-color', label: 'Darker Color', group: 1, css: null },

  { id: 'lighten', label: 'Lighten', group: 2, css: 'lighten' },
  { id: 'screen', label: 'Screen', group: 2, css: 'screen' },
  { id: 'color-dodge', label: 'Color Dodge', group: 2, css: 'color-dodge' },
  { id: 'linear-dodge', label: 'Linear Dodge (Add)', group: 2, css: 'plus-lighter' },
  { id: 'lighter-color', label: 'Lighter Color', group: 2, css: null },

  { id: 'overlay', label: 'Overlay', group: 3, css: 'overlay' },
  { id: 'soft-light', label: 'Soft Light', group: 3, css: 'soft-light' },
  { id: 'hard-light', label: 'Hard Light', group: 3, css: 'hard-light' },
  { id: 'vivid-light', label: 'Vivid Light', group: 3, css: null },
  { id: 'linear-light', label: 'Linear Light', group: 3, css: null },
  { id: 'pin-light', label: 'Pin Light', group: 3, css: null },
  { id: 'hard-mix', label: 'Hard Mix', group: 3, css: null },

  { id: 'difference', label: 'Difference', group: 4, css: 'difference' },
  { id: 'exclusion', label: 'Exclusion', group: 4, css: 'exclusion' },
  { id: 'subtract', label: 'Subtract', group: 4, css: null },
  { id: 'divide', label: 'Divide', group: 4, css: null },

  { id: 'hue', label: 'Hue', group: 5, css: 'hue' },
  { id: 'saturation', label: 'Saturation', group: 5, css: 'saturation' },
  { id: 'color', label: 'Color', group: 5, css: 'color' },
  { id: 'luminosity', label: 'Luminosity', group: 5, css: 'luminosity' },
];

/** The modes a browser can blend live as an element (those with a CSS match). */
export const CSS_BLEND_MODES: readonly BlendMode[] = BLEND_MODES.filter((m) => m.css !== null);

export const blendModeById = (id: string): BlendMode | undefined => BLEND_MODES.find((m) => m.id === id);

/** The value of a select row that is a line between groups. */
const SEPARATOR = '-';

/**
 * A select of these modes, grouped as Photoshop's menu is: a line (a
 * disabled row) between groups, no group names. `leading` entries come
 * first, in the first group (the Reference panel's "Behind").
 */
export function blendSelect(
  modes: readonly BlendMode[],
  value: string,
  leading: readonly (readonly [string, string])[] = [],
): HTMLSelectElement {
  const rows: [string, string][] = leading.map(([v, l]) => [v, l]);
  let group = -1;
  for (const m of modes) {
    if (group !== -1 && m.group !== group) rows.push([SEPARATOR, '──────────']);
    group = m.group;
    rows.push([m.id, m.label]);
  }
  const sel = selectEl(rows, value);
  for (const o of sel.options) {
    if (o.value === SEPARATOR) {
      o.disabled = true;
      o.setAttribute('role', 'separator');
    }
  }
  sel.value = value;
  return sel;
}
