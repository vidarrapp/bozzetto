import { api } from '../../admin/api';
import { mergeSceneArrays } from './SceneFile';
import type { SnapshotRecorder } from './SnapshotRecorder';
import type { SculptSession } from './SculptSession';
import type { LookState } from '../../viewer/Viewer';

/**
 * Publishing sculpts to the gallery (WS5, admin only - Cloudflare Access
 * gates every endpoint used here, so a guest reaching these calls just gets
 * refusals). Both flows follow the editor's sequence exactly: create the
 * project, upload GLBs, patch the frame list, then a best-effort thumbnail.
 */

/** Matches the server's slug rule so failures happen before any upload. */
/**
 * The server's frames cap (functions/_shared/projects.ts MAX_FRAMES). It is
 * enforced on the metadata PUT, which lands AFTER every frame is already in
 * R2 - so it is checked here, before a single byte goes up, or a long reel
 * would upload for minutes and then fail with an orphaned project left
 * behind.
 */
export const MAX_GALLERY_FRAMES = 10000;

export const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface GalleryHooks {
  /** Current-view JPEG for the gallery card (Viewer.captureThumbnail). */
  thumbnail(): Promise<Blob>;
  /** The look to publish with, so the project opens as it was sculpted. */
  look(): LookState;
}

/**
 * Publish the look alongside the frames, exactly as the editor's "Save look"
 * does. Without it a published sculpt opened under the viewer's defaults
 * rather than the lighting it was made in.
 */
function lookPatch(hooks: GalleryHooks): Record<string, unknown> {
  const look = hooks.look();
  return {
    lighting: look.lighting,
    material: look.material,
    environment: look.environment,
    ao: look.ao,
    presentation: look.presentation,
    camera: look.camera,
    defaults: { material: look.materialMode },
  };
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
  if (metas.length > MAX_GALLERY_FRAMES) {
    throw new Error(
      `Too many frames (${metas.length}); the gallery takes at most ${MAX_GALLERY_FRAMES}. ` +
        'Clear frames and re-record.',
    );
  }
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
  await api.update(id, { frames, ...lookPatch(hooks) });
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
  // With colours: a painted model publishes as painted (owner decision).
  // Timelapse frames stay colour-free - paint was never envisioned there.
  const merged = mergeSceneArrays(session, true);
  if (!merged) throw new Error('Nothing to save');
  if (!PROJECT_SLUG.test(id)) throw new Error('Id must be a-z, 0-9, hyphens');
  onProgress('Encoding model...');
  const glb = await recorder.encodeFrame(merged.positions, merged.indices, merged.colors);
  onProgress('Creating project...');
  await api.create({ id, title: title || id, mode: 'model', fps: 4 });
  onProgress('Uploading...');
  await api.uploadFrame(id, 0, glb);
  await api.update(id, {
    frames: [{ index: 0, tris: merged.tris }],
    ...lookPatch(hooks),
  });
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
