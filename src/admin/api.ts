/**
 * Editor API client. Reads go through the public endpoints; writes go through
 * the Access-gated `/admin/api/*` routes (Cloudflare Access supplies the
 * identity in production; the local `DEV_ADMIN` var stands in for it in dev).
 */

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

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 403) message = 'Not authorized — sign in via Cloudflare Access.';
    throw new Error(message);
  }
  return (await res.json()) as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  list: () => fetch('/api/projects').then((r) => unwrap<ProjectSummary[]>(r)),

  get: (id: string) => fetch(`/api/projects/${encodeURIComponent(id)}`).then((r) => unwrap(r)),

  create: (input: CreateInput) =>
    fetch('/admin/api/projects', jsonInit('POST', input)).then((r) => unwrap(r)),

  update: (id: string, patch: unknown) =>
    fetch(`/admin/api/projects/${encodeURIComponent(id)}`, jsonInit('PUT', patch)).then((r) =>
      unwrap(r),
    ),

  remove: (id: string) =>
    fetch(`/admin/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) =>
      unwrap(r),
    ),

  uploadFrame: (id: string, index: number, glb: ArrayBuffer) =>
    fetch(`/admin/api/projects/${encodeURIComponent(id)}/frames?index=${index}`, {
      method: 'POST',
      body: glb,
    }).then((r) => unwrap<{ key: string; index: number; size: number }>(r)),
};
