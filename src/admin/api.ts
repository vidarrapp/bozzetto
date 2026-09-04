/**
 * Editor API client. Reads go through the public endpoints; writes go through
 * the Access-gated `/admin/api/*` routes (Cloudflare Access supplies the
 * identity in production; the local `DEV_ADMIN` var stands in for it in dev).
 */

import { apiFetch } from '../net/origin';

export interface ProjectSummary {
  id: string;
  title: string;
  mode: string;
  fps: number;
  updated_at: number;
  frameCount: number;
}

export interface CreateInput {
  id: string;
  title?: string;
  mode?: string;
  fps?: number;
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
    throw new Error(message);
  }
  return (res.bytes ? JSON.parse(new TextDecoder().decode(res.bytes)) : null) as T;
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

export const api = {
  list: () => call<ProjectSummary[]>('/api/projects'),

  get: (id: string) => call(`/api/projects/${encodeURIComponent(id)}`),

  create: (input: CreateInput) => call('/admin/api/projects', { method: 'POST', ...asJson(input) }),

  update: (id: string, patch: unknown) =>
    call(`/admin/api/projects/${encodeURIComponent(id)}`, { method: 'PUT', ...asJson(patch) }),

  remove: (id: string) => call(`/admin/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  uploadFrame: (id: string, index: number, glb: ArrayBuffer) =>
    call<{ key: string; index: number; size: number }>(
      `/admin/api/projects/${encodeURIComponent(id)}/frames?index=${index}`,
      { method: 'POST', body: glb },
    ),

  uploadThumb: async (id: string, blob: Blob) =>
    call<{ ok: boolean }>(`/admin/api/projects/${encodeURIComponent(id)}/thumb`, {
      method: 'POST',
      body: await blob.arrayBuffer(),
      contentType: blob.type || 'image/jpeg',
    }),
};
