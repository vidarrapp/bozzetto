import type { Viewer } from './Viewer';
import { statusToast } from '../sculpt/ui/statusToast';

/**
 * File > New sculpt from this, in the viewer of a template: the frame on
 * screen (a model's one frame, a timelapse's frame showing) becomes the
 * one object of a new Sculpt scene, at its real size and standing on the
 * floor. It goes by the gallery's Import OBJ hand-off (sculpt/bridge/
 * objHandoff): the geometry is written as OBJ text, in centimetres with the
 * floor at 0 and marked `units: 'cm'`, put in IndexedDB, and Sculpt takes
 * it on a boot whose address says `?obj=1`. Sculpt asks before replacing the
 * work in progress on this device (the page that sends the tab here does not
 * mark the question as asked, so the boot asks it), as for every entry into it.
 * A project from before real units has no real size: its frame comes in
 * as an unmarked OBJ does, and Set scale asks how tall it is.
 */
export async function newSculptFromFrame(viewer: Viewer, title: string): Promise<void> {
  const snap = viewer.frameSnapshot();
  if (!snap) {
    statusToast('').fail('There is no geometry on screen to start from yet. Try again in a moment.');
    return;
  }
  const { positions, indices } = snap;
  const lines: string[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${positions[i].toFixed(4)} ${positions[i + 1].toFixed(4)} ${positions[i + 2].toFixed(4)}`);
  }
  for (let i = 0; i < indices.length; i += 3) lines.push(`f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`);
  const handoffs = await import('../sculpt/bridge/objHandoff');
  try {
    await handoffs.saveObjHandoff({
      name: title || 'Frame',
      text: lines.join('\n'),
      ...(snap.units === 'cm' ? { units: 'cm' as const } : {}),
    });
  } catch (err) {
    statusToast('').fail(`Could not start a sculpt from this: this browser would not hold the frame (${err instanceof Error ? err.message : String(err)}).`);
    return;
  }
  window.location.href = '/?sculpt=1&obj=1';
}
