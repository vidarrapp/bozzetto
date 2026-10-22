/**
 * Real-world units (owner decision): one world unit is one metre, in every
 * mode, and the interface speaks centimetres - millimetres below one. A
 * scene, a project and an armature say they are on this scale with a
 * marker, `units: 'm'`; one without it is from before, sized to the old
 * canonical sculpt scale (a sphere about 48 units across), and opens as it
 * was until Set scale puts it on this one (sculpt/ui/SetScale.ts).
 */

/** The marker a scene record, an armature file and a manifest carry. */
export type Units = 'm';

/** The one value the marker takes; anything else is no marker at all. */
export const isUnits = (v: unknown): v is Units => v === 'm';

/**
 * The figure the old scales stood on: Armature mode drew a metre as 50
 * scene units, and its saved positions and cameras are on that scale. An
 * armature record without the marker is read through it (armature/units).
 */
export const LEGACY_ARMATURE_SCALE = 50;

/** The farthest the Floor offset may put a fixed floor from 0, in metres. */
export const FLOOR_OFFSET_LIMIT = 100;

/**
 * A length in metres as the interface says it: centimetres, to a tenth
 * under ten metres and whole past that, or millimetres under a centimetre,
 * to a tenth. "25 cm", "169.4 cm", "4.5 mm", "0.2 mm".
 */
export function formatLength(metres: number): string {
  if (!Number.isFinite(metres)) return '–';
  const a = Math.abs(metres);
  if (a > 0 && a < 0.00995) return `${trim((metres * 1000).toFixed(1))} mm`;
  return `${trim((metres * 100).toFixed(a < 10 ? 1 : 0))} cm`;
}

/**
 * A length in an unmarked scene: its own units, unnamed, since nobody knows
 * what they stand for until Set scale says (two significant decimals).
 */
export function formatUnitless(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  return `${trim(v.toFixed(a >= 100 ? 0 : a >= 1 ? 1 : 3))} units`;
}

/** A length as the scene's units say it: cm and mm with the marker, plain units without. */
export function formatSceneLength(v: number, units: Units | null): string {
  return units ? formatLength(v) : formatUnitless(v);
}

/** Three sizes, "25 × 25 × 25 cm" (one unit at the end where they share it). */
export function formatDimensions(size: [number, number, number], units: Units | null): string {
  const parts = size.map((v) => formatSceneLength(v, units));
  const unit = (p: string): string => p.replace(/^[^ ]+ /, '');
  if (parts.every((p) => unit(p) === unit(parts[0]))) {
    return `${parts.map((p) => p.replace(/ .*$/, '')).join(' × ')} ${unit(parts[0])}`;
  }
  return parts.join(' × ');
}

/**
 * A number to a fixed count of decimals with the trailing zeros dropped,
 * and never "-0": "12.5", "0", "1.25". What a typed field shows.
 */
export function trimDecimals(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '';
  const s = trim(v.toFixed(decimals));
  return s === '-0' ? '0' : s;
}

/**
 * A length in metres as a bare number of centimetres, to a tenth: what a
 * field labelled in cm holds ("25", "169.4", "0.5"). No millimetres, so a
 * field keeps one unit whatever it holds.
 */
export function formatCentimetres(metres: number): string {
  return trimDecimals(metres * 100, 1);
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
