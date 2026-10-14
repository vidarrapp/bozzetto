import type { LookState } from '../viewer/Viewer';
import { LEGACY_ARMATURE_SCALE } from '../viewer/units';
import type { ArmatureFile } from './persist';

/**
 * An armature record on metres (src/viewer/units.ts). A figure is rebuilt
 * from its preset each time, at its file's own size now; what a record
 * holds in world units is where it was put - the root's position, the
 * pins - and the camera that looked at it. A record without the marker
 * wrote those at the old 50 units a metre (LEGACY_ARMATURE_SCALE), so
 * they are divided by that, which puts the figure and its view exactly
 * where they were: the same pose seen the same way, now in metres. No Set
 * scale is needed here, as the figure's real size was always known.
 * Records that have the marker come back as they are.
 */
export function onMetres(file: ArmatureFile): ArmatureFile {
  if (file.units === 'm') return file;
  const k = 1 / LEGACY_ARMATURE_SCALE;
  const scaled = (v: number[]): [number, number, number] => [v[0] * k, v[1] * k, v[2] * k];
  const state = { ...file.state };
  if (state.root) state.root = { ...state.root, position: scaled(state.root.position) };
  if (state.pins) {
    state.pins = Object.fromEntries(Object.entries(state.pins).map(([id, p]) => [id, scaled(p)]));
  }
  return { ...file, state, ...(file.look ? { look: lookOnMetres(file.look) } : {}), units: 'm' };
}

/** A look saved at the old armature scale: its camera and focus lock in metres. */
function lookOnMetres(look: LookState): LookState {
  const k = 1 / LEGACY_ARMATURE_SCALE;
  const camera = look.camera;
  if (!camera) return look;
  const scaled = (v: number[] | undefined): number[] | undefined => (v?.length === 3 ? v.map((x) => x * k) : v);
  const fp = camera.dof?.focusPoint;
  return {
    ...look,
    camera: {
      ...camera,
      position: scaled(camera.position) ?? camera.position,
      target: scaled(camera.target) ?? camera.target,
      ...(camera.dof
        ? { dof: { ...camera.dof, ...(fp ? { focusPoint: scaled(fp) as [number, number, number] } : {}) } }
        : {}),
    },
  };
}
