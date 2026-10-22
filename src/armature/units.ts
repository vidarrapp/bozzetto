import { CM_PER_M, LEGACY_ARMATURE_SCALE, UNITS } from '../viewer/units';
import { lookTimes } from '../viewer/lookUnits';
import type { ArmatureFile } from './persist';

/**
 * An armature record on centimetres (src/viewer/units.ts). A figure is
 * rebuilt from its preset each time, at its file's own size; what a record
 * holds in world units is where it was put - the root's position, the
 * pins - and the camera that looked at it. Those are multiplied into
 * centimetres from whatever the record was written on: times 100 for one
 * marked 'm' (a unit was a metre then), and times 2 for one without the
 * marker, written at the old 50 units a metre (LEGACY_ARMATURE_SCALE). That
 * puts the figure and its view exactly where they were: the same pose
 * seen the same way. No Set scale is needed here, as the figure's real
 * size was always known. Records marked 'cm' come back as they are.
 */
export function onCentimetres(file: ArmatureFile): ArmatureFile {
  if (file.units === UNITS) return file;
  const k = file.units === 'm' ? CM_PER_M : CM_PER_M / LEGACY_ARMATURE_SCALE;
  const scaled = (v: number[]): [number, number, number] => [v[0] * k, v[1] * k, v[2] * k];
  const state = { ...file.state };
  if (state.root) state.root = { ...state.root, position: scaled(state.root.position) };
  if (state.pins) {
    state.pins = Object.fromEntries(Object.entries(state.pins).map(([id, p]) => [id, scaled(p)]));
  }
  return { ...file, state, ...(file.look ? { look: lookTimes(file.look, k) } : {}), units: UNITS };
}
