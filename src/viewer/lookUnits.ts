import type { LookState } from './Viewer';

/**
 * A look's world numbers times `k` (src/viewer/units.ts): the camera's
 * place and what it looks at, a focus lock, the Floor offset and a played
 * lift. Everything else in a look is a direction, a colour or a share of
 * the subject, which a change of unit leaves alone. Used to bring a look
 * saved in metres to centimetres (k = 100), and an armature look from the
 * old 50 units a metre (armature/units.ts). Returns a new look; fields a
 * look does not have stay absent.
 */
export function lookTimes<T extends Partial<LookState>>(look: T, k: number): T {
  if (k === 1) return look;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const times = <V>(v: V): V =>
    (Array.isArray(v) && v.length === 3 && v.every(num) ? v.map((x: number) => x * k) : v) as V;
  const out: T = { ...look };
  const camera = look.camera;
  if (camera) {
    const dof = camera.dof;
    out.camera = {
      ...camera,
      position: times(camera.position),
      target: times(camera.target),
      ...(dof ? { dof: { ...dof, ...(dof.focusPoint ? { focusPoint: times(dof.focusPoint) } : {}) } } : {}),
    };
  }
  const stage = look.presentation;
  if (stage) {
    out.presentation = {
      ...stage,
      ...(num(stage.floorOffset) ? { floorOffset: stage.floorOffset * k } : {}),
      ...(num(stage.lift) ? { lift: stage.lift * k } : {}),
    };
  }
  return out;
}
