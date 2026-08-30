import { api } from '../../admin/api';
import { mergeSceneArrays } from './SceneFile';
import type { SnapshotRecorder } from './SnapshotRecorder';
import type { SculptSession } from './SculptSession';

/**
 * Publishing sculpts to the gallery (WS5, admin only - Cloudflare Access
 * gates every endpoint used here, so a guest reaching these calls just gets
 * refusals). Both flows follow the editor's sequence exactly: create the
 * project, upload GLBs, patch the frame list, then a best-effort thumbnail.
 */

/** Matches the server's slug rule so failures happen before any upload. */
export const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface GalleryHooks {
  /** Current-view JPEG for the gallery card (Viewer.captureThumbnail). */
  thumbnail(): Promise<Blob>;
}

/** Walk the capture store into a new timelapse project. */
export async function saveTimelapseToGallery(
  recorder: SnapshotRecorder,
  hooks: GalleryHooks,
  id: string,
  title: string,
  onProgress: (text: string) => void,
): Promise<string> {
  // Freeze the set: capture keeps running, and a frame landing mid-upload
  // must not stretch the walk.
  const metas = [...recorder.frameMetas()];
  if (metas.length === 0) throw new Error('No captured frames yet');
  if (!PROJECT_SLUG.test(id)) throw new Error('Id must be a-z, 0-9, hyphens');
  onProgress('Creating project...');
  await api.create({ id, title: title || id, mode: 'timelapse', fps: 4 });
  const frames: { index: number; tris: number }[] = [];
  for (let i = 0; i < metas.length; i++) {
    onProgress(`Uploading frame ${i + 1}/${metas.length}...`);
    const bytes = await recorder.readFrame(metas[i].seq);
    if (!bytes) throw new Error(`Frame ${i} missing from local storage`);
    await api.uploadFrame(id, i, bytes);
    frames.push({ index: i, tris: metas[i].tris });
  }
  onProgress('Finishing...');
  await api.update(id, { frames });
  await uploadThumbBestEffort(id, hooks);
  return `/?tl=${id}`;
}

/** The current merged scene as a one-frame 'model' project. */
export async function saveModelToGallery(
  session: SculptSession,
  recorder: SnapshotRecorder,
  hooks: GalleryHooks,
  id: string,
  title: string,
  onProgress: (text: string) => void,
): Promise<string> {
  const merged = mergeSceneArrays(session);
  if (!merged) throw new Error('Nothing to save');
  if (!PROJECT_SLUG.test(id)) throw new Error('Id must be a-z, 0-9, hyphens');
  onProgress('Encoding model...');
  const glb = await recorder.encodeFrame(merged.positions, merged.indices);
  onProgress('Creating project...');
  await api.create({ id, title: title || id, mode: 'model', fps: 4 });
  onProgress('Uploading...');
  await api.uploadFrame(id, 0, glb);
  await api.update(id, { frames: [{ index: 0, tris: merged.tris }] });
  await uploadThumbBestEffort(id, hooks);
  return `/?tl=${id}`;
}

async function uploadThumbBestEffort(id: string, hooks: GalleryHooks): Promise<void> {
  try {
    await api.uploadThumb(id, await hooks.thumbnail());
  } catch {
    // The card just shows without a picture until one is saved in the editor.
  }
}
