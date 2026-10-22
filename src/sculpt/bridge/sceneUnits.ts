import { CM_PER_M, UNITS } from '../../viewer/units';
import { lookTimes } from '../../viewer/lookUnits';
import type { SavedScene } from './ScenePersist';

/**
 * A scene record saved while a unit was a metre (`units: 'm'`), brought to
 * centimetres in place (owner decision: one conversion, on open): every
 * object's matrix times 100 about the world origin (its place and its
 * scale alike; SculptSession.replaceScene then folds the scale into the
 * vertices), the look's camera, focus lock and Floor offset times 100, and
 * the brushes' world radii times 100 where world scale is on. What else a
 * record holds is a share, a count or a direction (the voxel resolution,
 * the dynamic topology detail, symmetry). Marked 'cm' after. A record on
 * any other scale is left alone.
 */
export function sceneOnCentimetres(scene: SavedScene): void {
  if (scene.units !== 'm') return;
  const k = CM_PER_M;
  for (const mesh of scene.meshes) {
    // S * M: the top three rows, every column (the translation's too).
    const m = mesh.matrix;
    for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= k;
  }
  if (scene.look) scene.look = lookTimes(scene.look, k);
  const settings = scene.settings;
  if (settings?.worldScale) {
    if (typeof settings.worldRadius === 'number') settings.worldRadius *= k;
    if (settings.radius) {
      settings.radius = Object.fromEntries(Object.entries(settings.radius).map(([tool, r]) => [tool, r * k]));
    }
  }
  scene.units = UNITS;
}
