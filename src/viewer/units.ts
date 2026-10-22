/**
 * Real-world units (owner decisions): one world unit is one centimetre,
 * Maya's default, in every mode, so an OBJ from Maya comes in at its true
 * size; the interface speaks centimetres, millimetres below one. A scene,
 * a project and an armature say they are on this scale with a marker,
 * `units: 'cm'`. Two older kinds are still read:
 *
 * - `units: 'm'`, from when a unit was a metre (October 2026). Opened, it
 *   is converted once, every world number times 100 (CM_PER_M), and is
 *   'cm' from then on (sculpt/bridge/SculptSession, armature/units,
 *   types/manifest).
 * - no marker, from before real units, sized to the old canonical sculpt
 *   scale (a sphere about 48 units across), which opens as it was until
 *   Set scale puts it on this one (sculpt/ui/SetScale.ts).
 */

/** The marker everything new writes, and the scale everything runs on inside. */
export type Units = 'cm';

/** A marker as a reader may find it: the current one, or the metre one from before. */
export type UnitsMarker = Units | 'm';

/** What everything new is marked with. */
export const UNITS: Units = 'cm';

/** Centimetres in a metre: what an 'm' record's world numbers are multiplied by. */
export const CM_PER_M = 100;

/** A marker a reader accepts ('cm' or 'm'); anything else is no marker at all. */
export const isUnits = (v: unknown): v is UnitsMarker => v === 'cm' || v === 'm';

/** What a record's world numbers are multiplied by to be in centimetres: 100 for 'm', 1 for 'cm'. */
export const toCentimetres = (units: UnitsMarker): number => (units === 'm' ? CM_PER_M : 1);

/**
 * The figure the old scales stood on: Armature mode drew a metre as 50
 * scene units, and its saved positions and cameras are on that scale. An
 * armature record without the marker is read through it (armature/units).
 */
export const LEGACY_ARMATURE_SCALE = 50;

/** The farthest the Floor offset may put a fixed floor from 0, in centimetres (100 m). */
export const FLOOR_OFFSET_LIMIT = 10000;

/**
 * A length in centimetres as the interface says it: centimetres, to a
 * tenth under ten metres and whole past that, or millimetres under a
 * centimetre, to a tenth. "25 cm", "169.4 cm", "4.5 mm", "0.2 mm".
 */
export function formatLength(cm: number): string {
  if (!Number.isFinite(cm)) return '–';
  const a = Math.abs(cm);
  if (a > 0 && a < 0.995) return `${trim((cm * 10).toFixed(1))} mm`;
  return `${trim(cm.toFixed(a < 1000 ? 1 : 0))} cm`;
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
export function formatSceneLength(v: number, units: UnitsMarker | null): string {
  return units ? formatLength(v) : formatUnitless(v);
}

/** Three sizes, "25 × 25 × 25 cm" (one unit at the end where they share it). */
export function formatDimensions(size: [number, number, number], units: UnitsMarker | null): string {
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
 * A length in centimetres as a bare number, to a tenth: what a field
 * labelled in cm holds ("25", "169.4", "0.5"). No millimetres, so a field
 * keeps one unit whatever it holds.
 */
export function formatCentimetres(cm: number): string {
  return trimDecimals(cm, 1);
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
