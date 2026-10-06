import type { Env, ProjectData, ProjectMode, ProjectRow, SceneMeta, Visibility } from './types';
import { HttpError } from './http';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_TITLE = 200;
/**
 * Frames in a project, and so one past the highest index a frame may be
 * stored under. The capture clients stop at this many (GallerySave,
 * SnapshotRecorder); a reel at 4 fps is over 40 minutes of it.
 */
export const MAX_FRAMES = 10000;
const MAX_STAGES = 500;
/**
 * The serialised `data` column. D1 refuses a row past 2,000,000 bytes with
 * a bare 500; this refuses earlier, with a reason, and leaves room for
 * the other columns. 10,000 frames and 500 full-length stages fit.
 */
export const MAX_DATA_BYTES = 1_500_000;
const MAX_FPS = 240;

/** Who may see a project; absent means the caller's default, anything else is refused. */
function validVisibility(v: unknown, fallback: Visibility): Visibility {
  if (v === undefined || v === null) return fallback;
  if (v === 'public' || v === 'private') return v;
  throw new HttpError("visibility: expected 'public' or 'private'");
}

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

/** One gallery card's worth of a project. */
export interface ProjectSummary {
  id: string;
  title: string;
  mode: ProjectMode;
  fps: number;
  updated_at: number;
  frameCount: number;
  visibility: Visibility;
  /** A scene's counts and size; null for other modes and for a scene still uploading. */
  scene: SceneMeta | null;
}

/**
 * The gallery's list. `all` is the owner's view, private projects
 * included. Without it the filter is in the query, not the page: a private
 * project is never sent to a guest's browser to be hidden there.
 */
export async function listProjects(env: Env, opts: { all?: boolean } = {}): Promise<ProjectSummary[]> {
  const { results } = await env.DB.prepare(
    // Sort by creation date so the gallery order is stable — editing a project
    // (which bumps updated_at) no longer reshuffles the grid. updated_at is still
    // selected for the thumbnail cache-buster.
    `SELECT id, title, mode, fps, updated_at, visibility,
            COALESCE(json_array_length(data, '$.frames'), 0) AS frameCount,
            json_extract(data, '$.scene') AS scene
     FROM projects ${opts.all ? '' : "WHERE visibility = 'public'"}
     ORDER BY created_at DESC`,
  ).all<Omit<ProjectSummary, 'scene'> & { scene: string | null }>();
  return results.map((r) => ({ ...r, scene: parseScene(r.scene) }));
}

/** json_extract hands an object back as JSON text. */
function parseScene(raw: string | null): SceneMeta | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SceneMeta;
  } catch {
    return null;
  }
}

export function getProjectRow(env: Env, id: string): Promise<ProjectRow | null> {
  return env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>();
}

/**
 * A project anyone may read, or null. The visibility is part of the query
 * rather than a check on the row afterwards, so a private row never reaches
 * a public route's code at all, and a later edit there cannot leak one.
 */
export function getPublicProjectRow(env: Env, id: string): Promise<ProjectRow | null> {
  return env.DB.prepare("SELECT * FROM projects WHERE id = ? AND visibility = 'public'")
    .bind(id)
    .first<ProjectRow>();
}

/**
 * Where a project's files are read from. A public project's come off the
 * open /media route, cacheable by anyone. A private project's come only
 * through /admin/api/media, which Cloudflare Access fronts, so its manifest
 * points there - and only the owner is ever handed that manifest.
 */
export function mediaBase(row: { id: string; visibility: Visibility }): string {
  return `${row.visibility === 'private' ? '/admin/api/media' : '/media'}/${row.id}`;
}

/** Shape a row into the manifest the viewer consumes (design doc §11). */
export function toManifest(row: ProjectRow): unknown {
  const data = JSON.parse(row.data) as ProjectData;
  const frames = [...data.frames].sort((a, b) => a.index - b.index);
  const base = mediaBase(row);
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    visibility: row.visibility,
    updated_at: row.updated_at,
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
      sd: `${base}/frames/sd/${String(f.index).padStart(4, '0')}.glb?v=${row.updated_at}`,
      hd: null,
      tris: f.tris,
    })),
    stages: data.stages,
    // A scene is a file to open in Sculpt, not frames to play: what is in
    // it and where it is. Null until its first upload has completed.
    ...(row.mode === 'scene'
      ? {
          scene: data.scene
            ? { ...data.scene, file: `${base}/scene.bozz?v=${row.updated_at}` }
            : null,
        }
      : {}),
  };
}

export interface CreateInput {
  id?: string;
  title?: string;
  mode?: ProjectMode;
  fps?: number;
  visibility?: Visibility;
}

/**
 * An id for a scene. Nobody types one: a scene is saved from a menu, not
 * published under a chosen slug, so the server picks it.
 */
function newSceneId(): string {
  const rand = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => (b % 36).toString(36)).join('');
  return `scene-${Date.now().toString(36)}-${rand}`;
}

export async function createProject(env: Env, input: CreateInput): Promise<ProjectRow> {
  const mode: ProjectMode = input.mode === 'model' || input.mode === 'scene' ? input.mode : 'timelapse';
  const given = String(input.id ?? '').trim().toLowerCase();
  const id = mode === 'scene' && !given ? newSceneId() : given;
  if (!SLUG.test(id)) throw new HttpError('Invalid id (use a-z, 0-9, hyphen; max 63 chars)');
  if (await getProjectRow(env, id)) throw new HttpError('A project with that id already exists', 409);

  const now = Date.now();
  const fps = validFps(input.fps, 4);
  // Publishing has always been public and stays so by default; a scene is
  // work kept for yourself, so it starts private.
  const visibility = validVisibility(input.visibility, mode === 'scene' ? 'private' : 'public');
  const title = (typeof input.title === 'string' && input.title.trim()) || id;
  await env.DB.prepare(
    'INSERT INTO projects (id, title, mode, fps, data, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      title.slice(0, MAX_TITLE),
      mode,
      fps,
      JSON.stringify(defaultData()),
      visibility,
      now,
      now,
    )
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
      // An index no upload can be stored under would point the manifest
      // at a frame that can never exist (frames.ts has the same bound).
      index >= MAX_FRAMES ||
      typeof tris !== 'number' ||
      !Number.isFinite(tris) ||
      tris < 0
    ) {
      throw new HttpError(`frames: each entry needs an integer index below ${MAX_FRAMES} and non-negative tris`);
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
    // Written by a completed upload only, never by a patch.
    ...(data.scene ? { scene: data.scene } : {}),
  };
  const title =
    typeof patch.title === 'string' && patch.title.trim()
      ? patch.title.trim().slice(0, MAX_TITLE)
      : row.title;
  // A scene stays a scene and nothing else becomes one: the one has a
  // file and no frames, the others frames and no file, and the editor's
  // mode switch must not turn either into a project nothing can open.
  const mode: ProjectMode =
    row.mode !== 'scene' && (patch.mode === 'model' || patch.mode === 'timelapse') ? patch.mode : row.mode;
  const fps = validFps(patch.fps, row.fps);
  const visibility = validVisibility(patch.visibility, row.visibility);
  // The look blocks (lighting, environment, ...) are stored as sent, so
  // the row as a whole is what gets bounded - in bytes, as D1 counts it: a
  // string's length counts UTF-16 units, and a title or stage note in
  // another script is two or three bytes to each of them.
  const serialised = JSON.stringify(next);
  if (new TextEncoder().encode(serialised).byteLength > MAX_DATA_BYTES) {
    throw new HttpError('project data too large', 413);
  }

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

  await env.DB.prepare(
    'UPDATE projects SET title = ?, mode = ?, fps = ?, data = ?, visibility = ?, updated_at = ? WHERE id = ?',
  )
    .bind(title, mode, fps, serialised, visibility, Date.now(), id)
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

/**
 * Store a project's gallery thumbnail. Every client encodes it as a JPEG
 * (Viewer.captureThumbnail), and it is served back as image/jpeg, so
 * anything that does not start like one is refused: the stored type is
 * then always true of the bytes behind it.
 */
export async function putThumb(env: Env, id: string, body: ArrayBuffer): Promise<void> {
  const head = new Uint8Array(body, 0, Math.min(3, body.byteLength));
  if (head.length < 3 || head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) {
    throw new HttpError('thumbnail: expected a JPEG', 415);
  }
  if (!(await getProjectRow(env, id))) throw new HttpError('Not found', 404);
  await env.BUCKET.put(`projects/${id}/thumb.jpg`, body, {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  // Bump updated_at so the gallery's ?v cache-buster picks up the new thumbnail.
  await env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(Date.now(), id).run();
}

// --- scene files --------------------------------------------------------

const sceneKey = (id: string) => `projects/${id}/scene.bozz`;
const SCENE_TYPE = 'application/x-bozzetto';
/**
 * The part size clients are asked to send. R2 wants every part but the
 * last at least 5 MiB and all of them the same size; 8 MiB keeps a small
 * scene to one request and a large one to a few dozen.
 */
export const SCENE_PART_BYTES = 8 * 1024 * 1024;
/** A part as received: comfortably over the size asked for, well under the 100 MB request cap. */
export const MAX_SCENE_PART_BYTES = 32 * 1024 * 1024;
/** R2's own limit on parts per upload. */
const MAX_SCENE_PARTS = 10000;

async function sceneRow(env: Env, id: string): Promise<ProjectRow> {
  const row = await getProjectRow(env, id);
  if (!row) throw new HttpError('Not found', 404);
  if (row.mode !== 'scene') throw new HttpError('Not a scene project');
  return row;
}

/**
 * R2 reports an upload it no longer has (aborted, completed, expired) as
 * error 10024; that is the client's stale id, not an outage, and says so.
 * Anything else stays a 500.
 */
function uploadError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/\(10024\)|NoSuchUpload|upload does not exist/i.test(message)) throw new HttpError('Unknown upload', 404);
  throw err;
}

/** Begin replacing a scene's file. The old one stays readable until complete. */
export async function startSceneUpload(env: Env, id: string): Promise<{ uploadId: string; partSize: number }> {
  await sceneRow(env, id);
  const upload = await env.BUCKET.createMultipartUpload(sceneKey(id), {
    httpMetadata: { contentType: SCENE_TYPE },
  });
  return { uploadId: upload.uploadId, partSize: SCENE_PART_BYTES };
}

export async function putScenePart(
  env: Env,
  id: string,
  uploadId: string,
  part: number,
  body: ArrayBuffer,
): Promise<{ part: number; etag: string }> {
  await sceneRow(env, id);
  if (!Number.isInteger(part) || part < 1 || part > MAX_SCENE_PARTS) {
    throw new HttpError(`part: expected an integer from 1 to ${MAX_SCENE_PARTS}`);
  }
  try {
    const done = await env.BUCKET.resumeMultipartUpload(sceneKey(id), uploadId).uploadPart(part, body);
    return { part: done.partNumber, etag: done.etag };
  } catch (err) {
    uploadError(err);
  }
}

function validCount(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new HttpError(`${name}: expected a non-negative integer`);
  }
  return v;
}

/**
 * Finish an upload: the parts become the scene's file in one step, and the
 * row records what is in it. The size is R2's measure of what landed, not
 * the client's claim, since it is what the gallery reports the scene costs.
 */
export async function completeSceneUpload(
  env: Env,
  id: string,
  uploadId: string,
  body: { parts?: unknown; objects?: unknown; tris?: unknown },
): Promise<ProjectRow> {
  const row = await sceneRow(env, id);
  if (!Array.isArray(body.parts) || body.parts.length === 0 || body.parts.length > MAX_SCENE_PARTS) {
    throw new HttpError('parts: expected a non-empty array');
  }
  const parts = body.parts.map((p) => {
    const o = p as { part?: unknown; etag?: unknown };
    if (typeof o?.part !== 'number' || !Number.isInteger(o.part) || typeof o.etag !== 'string' || !o.etag) {
      throw new HttpError('parts: each entry needs a part number and its etag');
    }
    return { partNumber: o.part, etag: o.etag };
  });
  const objects = validCount(body.objects, 'objects');
  const tris = validCount(body.tris, 'tris');
  let stored: R2Object;
  try {
    stored = await env.BUCKET.resumeMultipartUpload(sceneKey(id), uploadId).complete(parts);
  } catch (err) {
    uploadError(err);
  }
  const data = JSON.parse(row.data) as ProjectData;
  data.scene = { objects, tris, bytes: stored.size };
  // updated_at is the file's ?v=, so a re-save reaches every reader.
  await env.DB.prepare('UPDATE projects SET data = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(data), Date.now(), id)
    .run();
  return (await getProjectRow(env, id))!;
}

/** Drop an unfinished upload. Best effort: R2 expires abandoned ones on its own. */
export async function abortSceneUpload(env: Env, id: string, uploadId: string): Promise<void> {
  await sceneRow(env, id);
  try {
    await env.BUCKET.resumeMultipartUpload(sceneKey(id), uploadId).abort();
  } catch {
    // Already completed, aborted or expired: nothing left to drop.
  }
}
