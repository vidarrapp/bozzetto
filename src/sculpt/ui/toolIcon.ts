// Flaticon uicons, solid straight (fi-ss-*), for the tools. Whole style sheets
// are imported for upgrade-proof font URLs; each font only downloads when one
// of its glyphs first renders. Attribution lives in the README.
import '../../ui/icons';

// Inline-SVG overrides: an ./icons/<slot>.svg (slots below, e.g. flatten.svg
// or negative.svg) replaces that button's font glyph at build time. This is
// the route for icons the npm uicons release does not ship; see icons/README.
const svgIcons = import.meta.glob('./icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function svgFor(slot: string): string | null {
  return svgIcons[`./icons/${slot}.svg`] ?? null;
}

/**
 * The picture of a tool: its inline SVG where it has one, else the Uicons
 * glyph. The tool bar's tiles, the Asset library's tiles and the lifted
 * ghost all draw it this way, so what you drag looks like what lands.
 */
export function toolIcon(slot: string, icon: string): HTMLElement {
  const svg = svgFor(slot);
  if (svg) {
    // Inline SVG from the repo (trusted content); CSS recolors it via
    // currentColor and sizes it like the font glyphs.
    const holder = document.createElement('span');
    holder.className = 'sculpt-toolbar__svg';
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = svg;
    return holder;
  }
  const glyph = document.createElement('i');
  glyph.className = `fi ${icon}`;
  glyph.setAttribute('aria-hidden', 'true');
  return glyph;
}
