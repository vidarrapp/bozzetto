/**
 * Replaces SculptGL's gui/GuiTR translation table for the vendored code. The
 * only vendored consumer is math3d/Picking.js, which uses TR for a handful of
 * alpha-brush display names; returning the key keeps those paths inert.
 */
export default function TR(key: string): string {
  return key;
}
