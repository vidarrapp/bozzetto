import { api, memberProjects, type ProjectsClient, type Visibility } from '../../admin/api';
import { mergeSceneArrays } from './SceneFile';
import type { SnapshotRecorder } from './SnapshotRecorder';
import type { SculptSession } from './SculptSession';
import { aoWithoutCavity, type LookState } from '../../viewer/Viewer';

/**
 * Publishing sculpts from the Capture window. With accounts off it is the
 * owner's, to the gallery (WS5 - Cloudflare Access gates every endpoint
 * used here, so a guest reaching these calls just gets refusals, and an
 * owner whose session ran out an AuthExpiredError, which the form answers
 * with Sign in again), under an id and with a visibility chosen. With
 * accounts on it is anyone's signed in, the owner's included, to their own
 * My projects (docs/accounts.md §7): the server picks the id, and the
 * project is private. Both flows follow the editor's sequence exactly:
 * create the project, upload GLBs, patch the frame list, then a
 * best-effort thumbnail.
 */

/**
 * Where a publish goes: the gallery, as the owner tools publish (accounts
 * off), or the account's own projects (accounts on), which take a title
 * alone.
 */
export type PublishTo =
  | { to: 'gallery'; id: string; title: string; visibility: Visibility }
  | { to: 'mine'; title: string };

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
  /**
   * Whether this publish is from Present mode, whose view is the project's
   * presentation: then the look's tone mapping goes too (presentationPatch).
   */
  presented?(): boolean;
}

/**
 * Publish the look alongside the frames, exactly as the editor's "Save look"
 * does. Without it a published sculpt opened under the viewer's defaults
 * rather than the lighting it was made in. The AO is the one the viewer
 * can draw: a sculpt made on the cavity, which only sculpt mode has,
 * publishes on GTAO - it went out with no AO at all.
 */
function lookPatch(hooks: GalleryHooks): Record<string, unknown> {
  return presentationPatch(hooks.look(), hooks.presented?.() ?? false);
}

/**
 * A look as a project's manifest blocks: camera (position, target, lens,
 * depth of field), lighting, material (the Sculpt colours / Plain colour
 * switch included), environment (the background with it), AO, the stage
 * (`presentation`) and the material mode (`defaults.material`), which the
 * viewer applies at boot. From Present mode (`presented`) the output grade
 * goes too, as `defaults.toneMapping`, so the project opens graded as it
 * was presented; outside it a publish stays as it was. The server stores
 * these blocks as sent (functions/_shared/projects.ts), `defaults` and
 * `camera` merged over what the project had.
 */
export function presentationPatch(look: LookState, presented: boolean): Record<string, unknown> {
  return {
    lighting: look.lighting,
    material: look.material,
    environment: look.environment,
    ao: aoWithoutCavity(look),
    presentation: look.presentation,
    camera: look.camera,
    defaults: {
      material: look.materialMode,
      ...(presented && look.toneMapping ? { toneMapping: look.toneMapping } : {}),
    },
  };
}

/** "Timelapse 7 Oct 14:05": the title a publish to My projects gets when none is typed. */
function defaultTitle(kind: string, when = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const month = when.toLocaleString(undefined, { month: 'short' });
  return `${kind} ${when.getDate()} ${month} ${p(when.getHours())}:${p(when.getMinutes())}`;
}

/**
 * The project a publish fills: on the gallery, under the id typed, as the
 * owner tools make one; in My projects, under the server's id, private.
 * `client` is set for one in My projects, which is taken back through it
 * if the rest fails (filling), since what it holds counts against the
 * quota. The gallery's keeps today's way: what landed stays for the
 * editor.
 */
async function createFor(
  target: PublishTo,
  mode: 'timelapse' | 'model',
): Promise<{ client: ProjectsClient | null; id: string }> {
  if (target.to === 'gallery') {
    const { id, title, visibility } = target;
    if (!PROJECT_SLUG.test(id)) throw new Error('Id must be a-z, 0-9, hyphens');
    await api.create({ id, title: title || id, mode, fps: 4, visibility });
    return { client: null, id };
  }
  const title = (target.title || defaultTitle(mode === 'model' ? 'Model' : 'Timelapse')).slice(0, 200);
  const made = await memberProjects.create({ title, mode, fps: 4 });
  return { client: memberProjects, id: made.id };
}

/** A publish's calls, on the routes its project is on. */
const routesFor = (client: ProjectsClient | null) => client ?? api;

/**
 * Run the rest of a publish on its new project; a failure in My projects
 * takes the project back first, so a publish that did not finish leaves
 * nothing behind holding the quota. Best effort: a session that has gone
 * cannot delete either.
 */
async function filling<T>(made: { client: ProjectsClient | null; id: string }, fill: () => Promise<T>): Promise<T> {
  try {
    return await fill();
  } catch (err) {
    if (made.client) await made.client.remove(made.id).catch(() => undefined);
    throw err;
  }
}

/** Walk the capture store into a new timelapse project. */
export async function saveTimelapseToGallery(
  recorder: SnapshotRecorder,
  hooks: GalleryHooks,
  target: PublishTo,
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
  onProgress('Creating project...');
  const made = await createFor(target, 'timelapse');
  const routes = routesFor(made.client);
  const { id } = made;
  return filling(made, async () => {
    const frames: { index: number; tris: number }[] = [];
    for (let i = 0; i < metas.length; i++) {
      onProgress(`Uploading frame ${i + 1}/${metas.length}...`);
      const bytes = await recorder.readFrame(metas[i].seq);
      if (!bytes) throw new Error(`Frame ${i} missing from local storage`);
      await routes.uploadFrame(id, i, bytes);
      frames.push({ index: i, tris: metas[i].tris });
    }
    onProgress('Finishing...');
    await routes.update(id, { frames, ...lookPatch(hooks) });
    await uploadThumbBestEffort(routes, id, hooks);
    return `/?tl=${id}`;
  });
}

/** The current merged scene as a one-frame 'model' project. */
export async function saveModelToGallery(
  session: SculptSession,
  recorder: SnapshotRecorder,
  hooks: GalleryHooks,
  target: PublishTo,
  onProgress: (text: string) => void,
): Promise<string> {
  // With colours: a painted model publishes as painted (owner decision).
  // Timelapse frames stay colour-free - paint was never envisioned there.
  const merged = mergeSceneArrays(session, true);
  if (!merged) throw new Error('Nothing to save');
  if (target.to === 'gallery' && !PROJECT_SLUG.test(target.id)) throw new Error('Id must be a-z, 0-9, hyphens');
  onProgress('Encoding model...');
  const glb = await recorder.encodeFrame(merged.positions, merged.indices, merged.colors);
  onProgress('Creating project...');
  const made = await createFor(target, 'model');
  const routes = routesFor(made.client);
  const { id } = made;
  return filling(made, async () => {
    onProgress('Uploading...');
    await routes.uploadFrame(id, 0, glb);
    await routes.update(id, {
      frames: [{ index: 0, tris: merged.tris }],
      ...lookPatch(hooks),
    });
    await uploadThumbBestEffort(routes, id, hooks);
    return `/?tl=${id}`;
  });
}

async function uploadThumbBestEffort(
  routes: Pick<ProjectsClient, 'uploadThumb'>,
  id: string,
  hooks: GalleryHooks,
): Promise<void> {
  try {
    await routes.uploadThumb(id, await hooks.thumbnail());
  } catch {
    // The card just shows without a picture until one is saved in the editor.
  }
}
