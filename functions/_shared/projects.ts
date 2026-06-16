import type { Env, ProjectData, ProjectMode, ProjectRow } from './types';
import { HttpError } from './http';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

const frameKey = (id: string, index: number) =>
  `projects/${id}/frames/sd/${String(index).padStart(4, '0')}.glb`;

const defaultData = (): ProjectData => ({
  defaults: { frame: 0, playing: true, material: 'flat', lightingPreset: 'three_point' },
  camera: { autoFrame: true },
  stages: [],
  frames: [],
});

export async function listProjects(env: Env): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, title, mode, fps, updated_at FROM projects ORDER BY updated_at DESC',
  ).all();
  return results;
}

export function getProjectRow(env: Env, id: string): Promise<ProjectRow | null> {
  return env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>();
}

/** Shape a row into the manifest the viewer consumes (design doc §11). */
export function toManifest(row: ProjectRow): unknown {
  const data = JSON.parse(row.data) as ProjectData;
  const frames = [...data.frames].sort((a, b) => a.index - b.index);
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    config: { frameCount: frames.length, fps: row.fps, ext: 'glb', tiers: ['sd'], frameStartIndex: 0 },
    defaults: data.defaults,
    camera: data.camera,
    lighting: data.lighting ?? null,
    frames: frames.map((f) => ({
      index: f.index,
      sd: `/media/${row.id}/frames/sd/${String(f.index).padStart(4, '0')}.glb`,
      hd: null,
      tris: f.tris,
    })),
    stages: data.stages,
  };
}

export interface CreateInput {
  id?: string;
  title?: string;
  mode?: ProjectMode;
  fps?: number;
}

export async function createProject(env: Env, input: CreateInput): Promise<ProjectRow> {
  const id = String(input.id ?? '').trim().toLowerCase();
  if (!SLUG.test(id)) throw new HttpError('Invalid id (use a-z, 0-9, hyphen; max 63 chars)');
  if (await getProjectRow(env, id)) throw new HttpError('A project with that id already exists', 409);

  const now = Date.now();
  const mode: ProjectMode = input.mode === 'model' ? 'model' : 'timelapse';
  const fps = Number(input.fps ?? 4) || 4;
  await env.DB.prepare(
    'INSERT INTO projects (id, title, mode, fps, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, input.title?.trim() || id, mode, fps, JSON.stringify(defaultData()), now, now)
    .run();
  return (await getProjectRow(env, id))!;
}

export async function updateProject(env: Env, id: string, patch: Record<string, unknown>): Promise<ProjectRow> {
  const row = await getProjectRow(env, id);
  if (!row) throw new HttpError('Not found', 404);

  const data = JSON.parse(row.data) as ProjectData;
  const next: ProjectData = {
    defaults: { ...data.defaults, ...((patch.defaults as object) ?? {}) },
    camera: { ...data.camera, ...((patch.camera as object) ?? {}) },
    lighting: 'lighting' in patch ? patch.lighting : data.lighting,
    stages: Array.isArray(patch.stages) ? (patch.stages as ProjectData['stages']) : data.stages,
    frames: Array.isArray(patch.frames) ? (patch.frames as ProjectData['frames']) : data.frames,
  };
  const title = typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : row.title;
  const mode: ProjectMode = patch.mode === 'model' || patch.mode === 'timelapse' ? patch.mode : row.mode;
  const fps = Number(patch.fps ?? row.fps) || row.fps;

  await env.DB.prepare('UPDATE projects SET title = ?, mode = ?, fps = ?, data = ?, updated_at = ? WHERE id = ?')
    .bind(title, mode, fps, JSON.stringify(next), Date.now(), id)
    .run();
  return (await getProjectRow(env, id))!;
}

export async function deleteProject(env: Env, id: string): Promise<void> {
  const row = await getProjectRow(env, id);
  if (!row) throw new HttpError('Not found', 404);

  // Remove all of the project's R2 objects, then the row.
  const prefix = `projects/${id}/`;
  let cursor: string | undefined;
  do {
    const listing = await env.BUCKET.list({ prefix, cursor });
    if (listing.objects.length > 0) {
      await env.BUCKET.delete(listing.objects.map((o) => o.key));
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
}

export async function putFrame(env: Env, id: string, index: number, body: ArrayBuffer): Promise<string> {
  if (!(await getProjectRow(env, id))) throw new HttpError('Not found', 404);
  const key = frameKey(id, index);
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: 'model/gltf-binary' } });
  return key;
}
