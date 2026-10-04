/**
 * Editor API client. Writes, and every read of the owner's own projects, go
 * through the Access-gated `/admin/api/*` routes (Cloudflare Access supplies
 * the identity in production; the local `DEV_ADMIN` var stands in for it in
 * dev); the public list stays on `/api/projects`.
 */

import { apiFetch } from '../net/origin';

export type Visibility = 'public' | 'private';

/** What a scene card shows: recorded by the server when the file landed. */
export interface SceneMeta {
  objects: number;
  tris: number;
  bytes: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  /** 'timelapse' | 'model' | 'scene' - a string, so a newer mode is still listed. */
  mode: string;
  fps: number;
  updated_at: number;
  frameCount: number;
  /** Absent from a server older than the visibility migration, where all was public. */
  visibility?: Visibility;
  /** A scene's counts and size; null until its first upload has completed. */
  scene?: SceneMeta | null;
}

/** The owner's manifest of a scene project, as GET /admin/api/projects/:id returns it. */
export interface SceneProject {
  id: string;
  title: string;
  mode: string;
  visibility?: Visibility;
  updated_at: number;
  scene?: (SceneMeta & { file: string }) | null;
}

export interface CreateInput {
  /** Optional for a scene, whose id the server picks. */
  id?: string;
  title?: string;
  mode?: string;
  fps?: number;
  visibility?: Visibility;
}

/**
 * Where one of a project's files is read from. A private project's files
 * are only served through the Access-gated mount; a public one's come off
 * the open route, which anyone may cache.
 */
export function mediaPath(p: Pick<ProjectSummary, 'id' | 'visibility'>, file: string): string {
  const base = p.visibility === 'private' ? '/admin/api/media' : '/media';
  return `${base}/${encodeURIComponent(p.id)}/${file}`;
}

/**
 * Every admin call goes through here, so the browser's same-origin fetch and
 * the desktop's main-process proxy stay one code path. The proxy exists
 * because a renderer on bozzetto://app cannot reach a deployment at all: no
 * CORS headers, no OPTIONS handler, and an auth header that Cloudflare
 * Access injects only after a cookie login.
 */
async function call<T>(
  pathname: string,
  init?: { method?: string; body?: ArrayBuffer; contentType?: string },
): Promise<T> {
  const res = await apiFetch(pathname, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (res.bytes) {
      try {
        const body = JSON.parse(new TextDecoder().decode(res.bytes)) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* non-JSON error body */
      }
    }
    if (res.status === 403) message = 'Not authorized — sign in via Cloudflare Access.';
    // The desktop reports "no server configured" as status 0; saying that is
    // more use than a generic failure.
    if (res.status === 0) message = res.error ?? 'No server configured.';
    throw new ApiError(message, res.status);
  }
  // An Access login page answering in the API's place is a sign-in problem,
  // not a reply: parsing it would throw "Unexpected token '<'".
  if (res.contentType.includes('text/html')) throw new ApiError('Not signed in', 401);
  return (res.bytes ? JSON.parse(new TextDecoder().decode(res.bytes)) : null) as T;
}

/** A refused call, with the status kept for callers that branch on it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const asJson = (body: unknown): { body: ArrayBuffer; contentType: string } => ({
  body: new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer,
  contentType: 'application/json',
});

/**
 * Whether this session holds an admin identity, and for whom. Null for
 * guests. Cloudflare Access answers unauthenticated callers with a redirect
 * to its login page or an HTML interstitial, never JSON - so anything but a
 * JSON 200 reads as "guest", and so do transport failures.
 */
export async function probeAdmin(): Promise<string | null> {
  try {
    const res = await apiFetch('/admin/api/whoami');
    if (!res.ok || !res.bytes) return null;
    if (!res.contentType.includes('application/json')) return null;
    const body = JSON.parse(new TextDecoder().decode(res.bytes)) as { email?: string };
    return typeof body.email === 'string' ? body.email : null;
  } catch {
    return null;
  }
}

const project = (id: string): string => `/admin/api/projects/${encodeURIComponent(id)}`;

export const api = {
  /** The public list: what a guest's gallery shows. */
  list: () => call<ProjectSummary[]>('/api/projects'),

  /** Every project, private ones and scenes included, each with its visibility. */
  adminList: () => call<ProjectSummary[]>('/admin/api/projects'),

  /** The owner's manifest: any project, with paths to where its files are served to the owner. */
  get: (id: string) => call(project(id)),

  create: (input: CreateInput) => call<ProjectSummary>('/admin/api/projects', { method: 'POST', ...asJson(input) }),

  update: (id: string, patch: unknown) => call<ProjectSummary>(project(id), { method: 'PUT', ...asJson(patch) }),

  setVisibility: (id: string, visibility: Visibility) => api.update(id, { visibility }),

  rename: (id: string, title: string) => api.update(id, { title }),

  remove: (id: string) => call(project(id), { method: 'DELETE' }),

  uploadFrame: (id: string, index: number, glb: ArrayBuffer) =>
    call<{ key: string; index: number; size: number }>(`${project(id)}/frames?index=${index}`, {
      method: 'POST',
      body: glb,
    }),

  uploadThumb: async (id: string, blob: Blob) =>
    call<{ ok: boolean }>(`${project(id)}/thumb`, {
      method: 'POST',
      body: await blob.arrayBuffer(),
      contentType: blob.type || 'image/jpeg',
    }),

  /** Begin a scene file upload; the server says how big each part should be. */
  sceneStart: (id: string) =>
    call<{ uploadId: string; partSize: number }>(`${project(id)}/scene`, { method: 'POST' }),

  scenePart: (id: string, uploadId: string, part: number, bytes: ArrayBuffer) =>
    call<{ part: number; etag: string }>(
      `${project(id)}/scene?upload=${encodeURIComponent(uploadId)}&part=${part}`,
      { method: 'PUT', body: bytes, contentType: 'application/octet-stream' },
    ),

  sceneComplete: (
    id: string,
    uploadId: string,
    body: { parts: { part: number; etag: string }[]; objects: number; tris: number },
  ) =>
    call<SceneProject>(`${project(id)}/scene?upload=${encodeURIComponent(uploadId)}`, {
      method: 'POST',
      ...asJson(body),
    }),

  sceneAbort: (id: string, uploadId: string) =>
    call(`${project(id)}/scene?upload=${encodeURIComponent(uploadId)}`, { method: 'DELETE' }),
};
