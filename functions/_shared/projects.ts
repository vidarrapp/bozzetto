import type { Env, ProjectData, ProjectMode, ProjectRow } from './types';
import { HttpError } from './http';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_TITLE = 200;
const MAX_FRAMES = 10000;
const MAX_STAGES = 500;
/**
 * The serialised `data` column. D1 refuses a row past 2,000,000 bytes with
 * a bare 500; this refuses earlier, with a reason, and leaves room for
 * the other columns. 10,000 frames and 500 full-length stages fit.
 */
export const MAX_DATA_BYTES = 1_500_000;
const MAX_FPS = 240;

/** Playback rate: the viewer refuses a manifest whose fps is not positive. */
function validFps(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_FPS) {
    throw new HttpError(`fps: expected a number between 0 and ${MAX_FPS}`);
  }
  return n;
}

const frameKey = (id: string, index: number) =>
  `projects/${id}/frames/sd/${String(index).padStart(4, '0')}.glb`;

const defaultData = (): ProjectData => ({
  defaults: { frame: 0, playing: true, material: 'lit', lightingPreset: 'three_point' },
  camera: { autoFrame: true },
  stages: [],
  frames: [],
});

export async function listProjects(env: Env): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    // Sort by creation date so the gallery order is stable — editing a project
    // (which bumps updated_at) no longer reshuffles the grid. updated_at is still
    // selected for the thumbnail cache-buster.
    `SELECT id, title, mode, fps, updated_at,
            COALESCE(json_array_length(data, '$.frames'), 0) AS frameCount
     FROM projects ORDER BY created_at DESC`,
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
    material: data.material ?? null,
    environment: data.environment ?? null,
    ao: data.ao ?? null,
    presentation: data.presentation ?? null,
    frames: frames.map((f) => ({
      index: f.index,
      // ?v busts the immutable CDN cache when the project is re-saved/re-uploaded.
      sd: `/media/${row.id}/frames/sd/${String(f.index).padStart(4, '0')}.glb?v=${row.updated_at}`,
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
  const fps = validFps(input.fps, 4);
  await env.DB.prepare(
    'INSERT INTO projects (id, title, mode, fps, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, (input.title?.trim() || id).slice(0, MAX_TITLE), mode, fps, JSON.stringify(defaultData()), now, now)
    .run();
  return (await getProjectRow(env, id))!;
}

/**
 * The pieces of a patch that the viewer later reads back through
 * validateManifest: a bad shape stored here would make the project
 * unloadable, so it is refused at the door instead.
 */
function validFrames(v: unknown): ProjectData['frames'] {
  if (!Array.isArray(v)) throw new HttpError('frames: expected an array');
  if (v.length > MAX_FRAMES) throw new HttpError(`frames: at most ${MAX_FRAMES} frames`);
  const seen = new Set<number>();
  return v.map((f) => {
    const o = f as { index?: unknown; tris?: unknown };
    const index = o?.index;
    const tris = o?.tris ?? 0;
    // Numbers, not things Number() would coerce: null, [] and true all
    // became a valid-looking 0 or 1 and pointed the manifest at a frame
    // that was never uploaded.
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      typeof tris !== 'number' ||
      !Number.isFinite(tris) ||
      tris < 0
    ) {
      throw new HttpError('frames: each entry needs a non-negative integer index and tris');
    }
    // Two entries for one index would make frameCount overstate the reel
    // and the viewer fetch the same file twice under different positions.
    if (seen.has(index)) throw new HttpError(`frames: index ${index} appears twice`);
    seen.add(index);
    return { index, tris };
  });
}

function validStages(v: unknown): ProjectData['stages'] {
  if (!Array.isArray(v) || v.length > MAX_STAGES) throw new HttpError('stages: expected an array');
  return v.map((s) => {
    const o = s as { name?: unknown; frame?: unknown; desc?: unknown };
    const frame = Number(o?.frame);
    if (!Number.isInteger(frame) || frame < 0) throw new HttpError('stages: frame must be a non-negative integer');
    return {
      name: String(o?.name ?? '').slice(0, MAX_TITLE),
      frame,
      desc: String(o?.desc ?? '').slice(0, 2000),
    };
  });
}

export async function updateProject(env: Env, id: string, patch: Record<string, unknown>): Promise<ProjectRow> {
  const row = await getProjectRow(env, id);
  if (!row) throw new HttpError('Not found', 404);

  const data = JSON.parse(row.data) as ProjectData;
  const next: ProjectData = {
    defaults: { ...data.defaults, ...((patch.defaults as object) ?? {}) },
    camera: { ...data.camera, ...((patch.camera as object) ?? {}) },
    lighting: 'lighting' in patch ? patch.lighting : data.lighting,
    material: 'material' in patch ? patch.material : data.material,
    environment: 'environment' in patch ? patch.environment : data.environment,
    ao: 'ao' in patch ? patch.ao : data.ao,
    presentation: 'presentation' in patch ? patch.presentation : data.presentation,
    stages: 'stages' in patch ? validStages(patch.stages) : data.stages,
    frames: 'frames' in patch ? validFrames(patch.frames) : data.frames,
  };
  const title =
    typeof patch.title === 'string' && patch.title.trim()
      ? patch.title.trim().slice(0, MAX_TITLE)
      : row.title;
  const mode: ProjectMode = patch.mode === 'model' || patch.mode === 'timelapse' ? patch.mode : row.mode;
  const fps = validFps(patch.fps, row.fps);
  // The look blocks (lighting, environment, ...) are stored as sent, so
  // the row as a whole is what gets bounded.
  const serialised = JSON.stringify(next);
  if (serialised.length > MAX_DATA_BYTES) throw new HttpError('project data too large', 413);

  // Re-upload with fewer frames? Drop the now-orphaned meshes from R2.
  if ('frames' in patch) {
    const keep = new Set(next.frames.map((f) => f.index));
    const orphans = data.frames.filter((f) => !keep.has(f.index)).map((f) => frameKey(id, f.index));
    if (orphans.length > 0) {
      try {
        await env.BUCKET.delete(orphans);
      } catch {
        /* best-effort; the metadata save still proceeds */
      }
    }
  }

  await env.DB.prepare('UPDATE projects SET title = ?, mode = ?, fps = ?, data = ?, updated_at = ? WHERE id = ?')
    .bind(title, mode, fps, serialised, Date.now(), id)
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

export async function putThumb(env: Env, id: string, body: ArrayBuffer): Promise<void> {
  if (!(await getProjectRow(env, id))) throw new HttpError('Not found', 404);
  await env.BUCKET.put(`projects/${id}/thumb.jpg`, body, {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  // Bump updated_at so the gallery's ?v cache-buster picks up the new thumbnail.
  await env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(Date.now(), id).run();
}
