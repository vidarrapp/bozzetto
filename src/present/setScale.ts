import { api, failureText } from '../admin/api';
import { lookPatch } from '../admin/projectEdit';
import { ScaleBanner } from '../sculpt/ui/SetScale';
import { UNITS } from '../viewer/units';
import { failNotice } from '../sculpt/ui/statusToast';
import type { Viewer } from '../viewer/Viewer';

/** Not now on Set scale: kept for this tab's session, per project, and nothing stored on the server. */
const SCALE_NOT_NOW = 'bz.scale.notnow.';
const notNowHere = new Set<string>();
function scaleDismissed(id: string): boolean {
  if (notNowHere.has(id)) return true;
  try {
    return sessionStorage.getItem(SCALE_NOT_NOW + id) === '1';
  } catch {
    return false;
  }
}
function dismissScale(id: string): void {
  notNowHere.add(id);
  try {
    sessionStorage.setItem(SCALE_NOT_NOW + id, '1');
  } catch {
    // Blocked storage: the set above holds it until the page goes.
  }
}

/**
 * Set scale for a project published before real units (owner decision):
 * the same banner Sculpt offers a scene from before, here over the one
 * model. The typed height is the current frame's; every frame is played
 * by the one factor that makes it so (presentation.scale, lifted to stand
 * on the floor at 0), the project is marked `units: 'cm'`, and both are
 * saved at once, with the look, so the viewer plays it at that size for
 * everyone. A refusal puts the preview back as it was. Moved here from the
 * old frame editor, for the owner's Present workspace; it writes at once,
 * as it did there, and `onSaved` says so (the page's Edited mark follows).
 */
export function mountScaleBanner(p: Viewer, id: string, title: string, onSaved?: () => void): ScaleBanner<string> {
  const subject = title || id;
  const height = (): number => {
    const b = p.frameLocalBounds();
    return b.isEmpty() ? 0 : (b.max.y - b.min.y) * p.getSubjectTransform().scale;
  };
  const banner: ScaleBanner<string> = new ScaleBanner<string>(
    {
      list: () => [subject],
      name: (s) => s,
      height,
      size: height,
      needed: () => !p.manifest.units && !scaleDismissed(id),
    },
    {
      apply: (_s, cm) => void setScale(cm),
      dismissed: () => dismissScale(id),
    },
    {
      intro: 'This project has no real-world scale yet. Set it to play in centimetres.',
      dismiss: 'Keep the project as it is; not offered again in this tab',
      hint: 'Every frame is scaled by the same amount and stood on the floor, then saved with the look.',
    },
  );
  const setScale = async (cm: number): Promise<void> => {
    const box = p.frameLocalBounds();
    const f = cm / (box.max.y - box.min.y);
    if (!(f > 0) || !Number.isFinite(f)) return;
    const was = { ...p.getSubjectTransform(), units: p.manifest.units, offset: p.getFloorOffset() };
    // Marked first, so the refit below lays the floor out fixed at 0.
    p.setUnits(UNITS);
    p.setFloorOffset(0);
    p.setSubjectTransform(f, -f * box.min.y);
    // A focus lock was a point on the old scale.
    p.setDoF({ focus: p.getDoFState().focus });
    window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
    banner.refresh();
    try {
      await api.update(id, { ...lookPatch(p), units: UNITS });
      onSaved?.();
    } catch (err) {
      p.setUnits(was.units);
      p.setFloorOffset(was.offset);
      p.setSubjectTransform(was.scale, was.lift);
      window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
      banner.refresh();
      failNotice(`Set scale failed: ${failureText(err)}`);
    }
  };
  return banner;
}
