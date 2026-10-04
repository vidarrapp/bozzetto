import { ApiError, api, type SceneProject } from '../../admin/api';
import { apiFetch } from '../../net/origin';
import type { SceneLink } from './ScenePersist';

/**
 * Scenes as server projects: where Save to library puts a sculpt when the
 * owner is signed in, so it outlives the device it was made on.
 *
 * A scene project is the same bytes as a saved .bozz file or a library
 * entry, stored in R2 with a thumbnail beside it, private until made
 * public. Uploading one is the publishing sequence with a file instead of
 * frames: create the project (or reuse the one the scene came from), send
 * the file in parts, complete, then a best-effort thumbnail.
 */

export interface SceneUpload {
  bytes: ArrayBuffer;
  /** The title a new project gets; a re-save keeps the project's own. */
  title: string;
  objects: number;
  tris: number;
  thumb?: Blob;
  /** Re-save this project in place; absent makes a new one. */
  projectId?: string;
}

const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);

/**
 * One part, tried twice. A dropped connection or a server hiccup costs a
 * retry of that part alone; a refusal (4xx) is an answer and stands.
 */
async function sendPart<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
    return send();
  }
}

/**
 * Upload a scene, creating its project or re-saving the one it came from.
 * Resolves to the project the scene now belongs to. A project created for
 * this upload is taken back if the upload fails, so a failed save never
 * leaves a card behind that opens nothing.
 */
export async function uploadScene(
  u: SceneUpload,
  onProgress: (text: string) => void = () => {},
): Promise<SceneLink> {
  try {
    return await upload(u, onProgress);
  } catch (err) {
    throw unreachable(err);
  }
}

async function upload(u: SceneUpload, onProgress: (text: string) => void): Promise<SceneLink> {
  const total = u.bytes.byteLength;
  if (total === 0) throw new Error('Nothing to save');
  let id = u.projectId ?? null;
  let title = u.title;
  let start: { uploadId: string; partSize: number } | null = null;
  if (id) {
    onProgress('Starting upload...');
    try {
      start = await api.sceneStart(id);
    } catch (err) {
      // Deleted from another device since it was opened here. Saving it
      // as a new project keeps the work; refusing would only lose it.
      if (!(err instanceof ApiError && err.status === 404)) throw err;
      id = null;
    }
  }
  let created = false;
  if (!id) {
    onProgress('Creating project...');
    const made = await api.create({ mode: 'scene', title });
    id = made.id;
    title = made.title;
    created = true;
  }
  const project = id;
  try {
    start ??= await api.sceneStart(project);
    const { uploadId, partSize } = start;
    const count = Math.max(1, Math.ceil(total / partSize));
    const parts: { part: number; etag: string }[] = [];
    try {
      for (let i = 0; i < count; i++) {
        const from = i * partSize;
        onProgress(
          count === 1 ? `Uploading ${mb(total)} MB...` : `Uploading ${mb(from)} of ${mb(total)} MB...`,
        );
        const chunk = u.bytes.slice(from, Math.min(total, from + partSize));
        parts.push(await sendPart(() => api.scenePart(project, uploadId, i + 1, chunk)));
      }
      onProgress('Finishing...');
      const done = await api.sceneComplete(project, uploadId, { parts, objects: u.objects, tris: u.tris });
      title = done.title || title;
    } catch (err) {
      void api.sceneAbort(project, uploadId).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    if (created) await api.remove(project).catch(() => undefined);
    throw err;
  }
  if (u.thumb) {
    try {
      await api.uploadThumb(project, u.thumb);
    } catch {
      // The card shows without a picture until the next save.
    }
  }
  return { id: project, title };
}

/**
 * A fetch that threw never reached a server - offline, or a sign-in page
 * on another origin the browser would not follow to. "Failed to fetch"
 * says neither.
 */
function unreachable(err: unknown): unknown {
  return err instanceof TypeError ? new Error('the server could not be reached') : err;
}

/**
 * A scene project's manifest: the owner's first, since scenes start
 * private, then the public one, which is how a guest opens a scene the
 * owner has made public. Throws when neither answers.
 */
async function sceneManifest(id: string): Promise<{ project: SceneProject; owner: boolean }> {
  try {
    return { project: (await api.get(id)) as SceneProject, owner: true };
  } catch (ownerErr) {
    let res: Awaited<ReturnType<typeof apiFetch>>;
    try {
      res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`);
    } catch {
      throw unreachable(ownerErr); // say what the first try met
    }
    if (res.ok && res.bytes && !res.contentType.includes('text/html')) {
      return { project: JSON.parse(new TextDecoder().decode(res.bytes)) as SceneProject, owner: false };
    }
    throw new Error(
      res.status === 404
        ? 'Not found. It may have been deleted, or be private while you are signed out.'
        : `Could not reach it (${res.status || (ownerErr as Error).message})`,
    );
  }
}

/**
 * A scene project's .bozz bytes and its manifest, for opening in Sculpt;
 * `owner` when it came through the owner's routes rather than the public
 * ones.
 */
export async function fetchSceneProject(
  id: string,
): Promise<{ bytes: ArrayBuffer; project: SceneProject; owner: boolean }> {
  const { project, owner } = await sceneManifest(id);
  if (project.mode !== 'scene') throw new Error(`"${project.title}" is not a scene`);
  const file = project.scene?.file;
  if (!file) throw new Error(`"${project.title}" has no file: its upload did not finish`);
  // Through the media route the manifest names: the Access-gated one for a
  // private scene, which the session cookie (or the desktop's proxy) opens.
  const res = await apiFetch(file).catch((err: unknown) => {
    throw unreachable(err);
  });
  if (!res.ok || !res.bytes || res.contentType.includes('text/html')) {
    throw new Error(`Could not download "${project.title}" (${res.status})`);
  }
  return { bytes: res.bytes, project, owner };
}
