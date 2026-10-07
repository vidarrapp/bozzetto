import {
  ApiError,
  AuthExpiredError,
  UnreachableError,
  api,
  libraryProjects,
  mediaPath,
  memberProjects,
  ownerProjects,
  signedInHereBefore,
  type ProjectsClient,
  type SceneProject,
} from '../../admin/api';
import { accountsOn } from '../../net/account';
import { apiFetch, isDesktop, type ApiResult } from '../../net/origin';
import { ownerSignedIn } from '../../desktop/serverAccount';
import type { SceneLink } from './ScenePersist';

/**
 * Scenes as server projects: where Save to library puts a sculpt when
 * someone is signed in, so it outlives the device it was made on - the
 * owner's Projects with accounts off, and with them on the account's own
 * My projects (docs/accounts.md §7), the owner's included.
 *
 * A scene project is the same bytes as a saved .bozz file or a library
 * entry, stored in R2 with a thumbnail beside it, private. Uploading one
 * is the publishing sequence with a file instead of frames: create the
 * project (or reuse the one the scene came from), send the file in parts,
 * complete, then a best-effort thumbnail.
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
  /** The routes that project is on: 'admin' for the owner tools' (SceneLink.scope). */
  scope?: 'admin';
}

/** The longest title a project keeps (functions/_shared/projects.ts). */
const MAX_TITLE = 200;

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
 * Upload a scene, creating its project or re-saving the one it came from,
 * on the routes its scope says (libraryProjects). Resolves to the project
 * the scene now belongs to. A project created for this upload is taken
 * back if the upload fails, so a failed save never leaves a card behind
 * that opens nothing.
 */
export async function uploadScene(
  u: SceneUpload,
  onProgress: (text: string) => void = () => {},
): Promise<SceneLink> {
  try {
    const client = await libraryProjects(u.scope);
    const link = await upload(client, u, onProgress);
    return u.scope === 'admin' ? { ...link, scope: 'admin' } : link;
  } catch (err) {
    throw unreachable(err);
  }
}

async function upload(client: ProjectsClient, u: SceneUpload, onProgress: (text: string) => void): Promise<SceneLink> {
  const total = u.bytes.byteLength;
  if (total === 0) throw new Error('Nothing to save');
  let id = u.projectId ?? null;
  let title = u.title.slice(0, MAX_TITLE);
  let start: { uploadId: string; partSize: number } | null = null;
  if (id) {
    onProgress('Starting upload...');
    try {
      start = await client.sceneStart(id, total);
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
    const made = await client.create({ mode: 'scene', title });
    id = made.id;
    title = made.title;
    created = true;
  }
  const project = id;
  try {
    start ??= await client.sceneStart(project, total);
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
        parts.push(await sendPart(() => client.scenePart(project, uploadId, i + 1, chunk)));
      }
      onProgress('Finishing...');
      const done = await client.sceneComplete(project, uploadId, { parts, objects: u.objects, tris: u.tris });
      title = done.title || title;
    } catch (err) {
      void client.sceneAbort(project, uploadId).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    if (created) await client.remove(project).catch(() => undefined);
    throw err;
  }
  if (u.thumb) {
    try {
      await client.uploadThumb(project, u.thumb);
    } catch {
      // The card shows without a picture until the next save.
    }
  }
  return { id: project, title };
}

/** A fetch that threw never reached a server (UnreachableError says so). */
function unreachable(err: unknown): unknown {
  return err instanceof TypeError ? new UnreachableError() : err;
}

/**
 * A scene project's manifest, and whether it came as the reader's own -
 * `owner`, whose device then keeps a copy - rather than off the public
 * route. With accounts off, the owner's routes first, since scenes start
 * private, then the public one, which is how a guest opens a scene the
 * owner has made public. With them on, the account's own first (My
 * projects, the owner's work included), or - asked for through the owner
 * tools, `scope` 'admin' (Edit in Sculpt from Projects, docs/accounts.md
 * §5) - theirs, which answers it with the same scope, so it saves back
 * there; then the public one. Throws when neither answers.
 */
async function sceneManifest(
  id: string,
  scope?: 'admin',
): Promise<{ project: SceneProject; owner: boolean; scope?: 'admin' }> {
  const accounts = await accountsOn();
  const own = accounts && scope !== 'admin' ? memberProjects : ownerProjects;
  try {
    const project = (await own.get(id)) as SceneProject;
    return { project, owner: true, ...(accounts && own === ownerProjects ? { scope: 'admin' as const } : {}) };
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
    // Not public, and the reader's own route wanted a sign-in: for whoever
    // had signed in here and whose session ran out, that is the whole
    // story, and the thing to fix.
    if (ownerErr instanceof AuthExpiredError && signedInHereBefore()) throw ownerErr;
    throw new Error(
      res.status === 404
        ? 'Not found. It may have been deleted, or be private while you are signed out.'
        : `Could not reach it (${res.status || (ownerErr as Error).message})`,
    );
  }
}

/**
 * A scene project's .bozz bytes and its manifest, for opening in Sculpt;
 * `owner` when it came as the reader's own rather than off the public
 * route, and `scope` the routes it came through (sceneManifest).
 */
export async function fetchSceneProject(
  id: string,
  scope?: 'admin',
): Promise<{ bytes: ArrayBuffer; project: SceneProject; owner: boolean; scope?: 'admin' }> {
  const found = await sceneManifest(id, scope);
  return { ...found, bytes: await sceneBytes(found.project) };
}

/**
 * A template's .bozz bytes and its manifest, for opening as a copy
 * (`/?sculpt=1&template=<id>`, docs/accounts.md §5). Its manifest is the
 * public one, which every template the gallery lists has, and its file
 * comes from the base that names: an open route here, or the files host.
 * A template the owner has taken off the gallery is not on the public
 * route; the owner's own gallery still shows it, so for an owner signed in
 * here a copy of that one comes through the owner's routes.
 */
export async function fetchTemplateScene(id: string): Promise<{ bytes: ArrayBuffer; project: SceneProject }> {
  const project = await templateManifest(id);
  return { bytes: await sceneBytes(project), project };
}

/**
 * Whether the owner may be signed in here: on the web, as far as this
 * device can say without asking; in the desktop app, as its server says -
 * with accounts, the session the app holds is the owner's account (GET
 * /api/me), and without them Access's cookie is in its jar.
 */
const ownerHere = async (): Promise<boolean> =>
  isDesktop() ? ownerSignedIn().catch(() => false) : signedInHereBefore();

/**
 * A template's manifest: the public one, or for the owner, one the gallery
 * no longer lists, through the owner's routes. Only a template: the
 * owner's own project, asked for by this address, is not found here, as
 * it is not one to copy.
 */
async function templateManifest(id: string): Promise<SceneProject> {
  let res: ApiResult;
  try {
    res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`);
  } catch (err) {
    throw unreachable(err);
  }
  if (res.ok && res.bytes && !res.contentType.includes('text/html')) {
    return JSON.parse(new TextDecoder().decode(res.bytes)) as SceneProject;
  }
  if (res.status === 404 && (await ownerHere())) {
    try {
      const own = (await api.get(id)) as SceneProject;
      if (own.template !== false) return own;
    } catch {
      // Not the owner's to read either: not found, as the public route said.
    }
  }
  // Status 0 is the desktop's "no server", which the proxy words itself.
  throw new Error(
    res.status === 404
      ? 'Not found. It may have been deleted, or taken off the gallery.'
      : `Could not reach it (${res.status || res.error || 'no answer'})`,
  );
}

/**
 * A scene's .bozz bytes, from under the base its manifest names (mediaPath,
 * which builds every file address the client asks for): the Access-gated
 * media route for the owner's own scene, which the session cookie (or the
 * desktop's proxy) opens, an account's own private one (/api/me/media),
 * or a template's open one - here, or the files host, which answers this
 * site's pages. `?v=` is the manifest's
 * updated_at, as the server writes it into the file's own address.
 */
async function sceneBytes(project: SceneProject): Promise<ArrayBuffer> {
  if (project.mode !== 'scene') throw new Error(`"${project.title}" is not a scene`);
  if (!project.scene) throw new Error(`"${project.title}" has no file: its upload did not finish`);
  const file = mediaPath(project, `scene.bozz?v=${project.updated_at}`);
  const res = await apiFetch(file).catch((err: unknown) => {
    throw unreachable(err);
  });
  if (res.signedOut) throw new AuthExpiredError();
  if (!res.ok || !res.bytes || res.contentType.includes('text/html')) {
    throw new Error(`Could not download "${project.title}" (${res.status})`);
  }
  return res.bytes;
}
