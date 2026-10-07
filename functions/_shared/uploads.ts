import type { Env } from './env';
import type { ProjectData, ProjectRow, UserRow } from './types';
import { MEMBER_LIMITS } from './config';
import { checkFrame, checkSceneEnd, checkSceneStart, checkThumb, damagedScene } from './content';
import { base64url } from './crypto';
import { HttpError } from './http';
import {
  FRAMES_DIR,
  SCENE_FILE,
  THUMB_FILE,
  frameFile,
  getProjectRow,
  prefixFor,
  type OwnerScope,
} from './projects';
import { listSizes, quotaExceeded, refundBytes, reserveBytes, usageOf } from './quota';

/**
 * What goes into R2 for a project, and what comes out (docs/accounts.md
 * §4): a scene's file uploaded in parts, for an account (/api/me, held to
 * its quota) or for owner tools (/admin/api, held to nothing but the
 * caps); and an account's frames and thumbnails, its project deletions and
 * the frames a re-upload orphans, each with its bytes counted.
 *
 * A scene upload is a pending_uploads row: one per (project, file), named
 * by its own id (the R2 upload's stays here), with the size declared at
 * the start, what the file it replaces weighs, and `header_ok`, which says
 * what part 1 turned out to be:
 *
 * - 0: part 1 has not passed yet, and no other part is taken;
 * - 1: a bare container (BOZ1), whose size is the declared one;
 * - above 1: gzip, and the size its header says it unpacks to, which the
 *   last part's trailer must say too (a header is at least 12 bytes, so
 *   the two never meet).
 *
 * Each part is admitted, before R2 sees it, by one statement that holds
 * the account's usage - stored, reserved by its other parts and uploads,
 * less what this upload replaces - to its quota, and the upload's parts to
 * the size declared. With the size declared, the parts are laid out by
 * part 1's size: every one but the last exactly that, the last the rest,
 * as R2 wants them; so the last part is known when it comes, and is held
 * to the header there.
 */

/** The one file name a scene's upload is for. */
const FILE = SCENE_FILE;
const SCENE_TYPE = 'application/x-bozzetto';
/**
 * The part size clients are asked to send. R2 wants every part but the
 * last at least 5 MiB and all of them the same size; 8 MiB keeps a small
 * scene to one request and a large one to a few dozen.
 */
export const SCENE_PART_BYTES = MEMBER_LIMITS.partBytes;
/** A part as received: comfortably over the size asked for, well under the 100 MB request cap. */
export const MAX_SCENE_PART_BYTES = MEMBER_LIMITS.partMaxBytes;
/** R2's least part, but for the last. */
const MIN_PART_BYTES = 5 * 1024 * 1024;
/** R2's own limit on parts per upload. */
const MAX_SCENE_PARTS = 10000;
/** An upload left this long is given up when its account starts another (R2 drops it at 7 days). */
export const STALE_UPLOAD = 24 * 60 * 60 * 1000;
/** The most stale uploads one start gives up, so a start's subrequests stay few. */
const STALE_PER_START = 10;

/**
 * Who an upload is for: an account, on /api/me, held to its quota and its
 * own projects; or owner tools, on /admin/api, reaching templates and the
 * owner's own and keeping today's caps.
 */
export type Uploader = { kind: 'member'; user: UserRow } | { kind: 'owner'; scope: OwnerScope };

const userOf = (who: Uploader): string | null => (who.kind === 'member' ? who.user.id : null);

const notFound = (what = 'Not found'): HttpError => new HttpError(what, 404, 'not_found');

/** A project the uploader reaches, or a 404: anyone else's is not there. */
export async function projectFor(env: Env, who: Uploader, id: string): Promise<ProjectRow> {
  const row = await getProjectRow(env, id, who.kind === 'member' ? { member: who.user.id } : who.scope);
  if (!row) throw notFound();
  return row;
}

async function sceneProject(env: Env, who: Uploader, id: string): Promise<ProjectRow> {
  const row = await projectFor(env, who, id);
  if (row.mode !== 'scene') throw new HttpError('Not a scene project', 400, 'bad_request');
  return row;
}

/**
 * R2 reports an upload it no longer has (aborted, completed, expired) as
 * error 10024; that is the client's stale id, not an outage, and says so.
 * Parts named with etags R2 does not hold (10025: a part sent again since)
 * or smaller than it takes (10011) are the client's to send again: 400.
 * Anything else stays a 500.
 */
function uploadError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/\(10024\)|NoSuchUpload|upload does not exist/i.test(message)) throw notFound('Unknown upload');
  if (/\(10025\)|\(10011\)|InvalidPart|EntityTooSmall/i.test(message)) {
    throw new HttpError('The parts named are not the ones stored; send them again', 400, 'bad_request');
  }
  throw err;
}

/** An upload's id, as the client names it: 16 random bytes. */
const newUploadId = (): string => base64url(crypto.getRandomValues(new Uint8Array(16)));

interface PendingRow {
  id: string;
  r2_upload_id: string;
  project_id: string;
  user_id: string | null;
  file: string;
  declared_bytes: number;
  replaces_bytes: number;
  header_ok: number;
  created_at: number;
  /** The bytes part 1 holds, once it has come. */
  first_bytes: number | null;
}

/** The upload `id` of this uploader's on this project, or a 404. */
async function pendingOf(env: Env, who: Uploader, row: ProjectRow, id: string | null): Promise<PendingRow> {
  if (!id) throw new HttpError('?upload=<id> required', 400, 'bad_request');
  const pu = await env.DB.prepare(
    `SELECT pu.*, (SELECT bytes FROM upload_parts WHERE upload_id = pu.id AND part = 1) AS first_bytes
     FROM pending_uploads pu WHERE pu.id = ? AND pu.project_id = ? AND pu.file = ? AND pu.user_id IS ?`,
  )
    .bind(id, row.id, FILE, userOf(who))
    .first<PendingRow>();
  if (!pu) throw notFound('Unknown upload');
  return pu;
}

/** An R2 upload given up, as best it can be: R2 drops one left alone at 7 days anyway. */
async function abortR2(env: Env, key: string, r2UploadId: string): Promise<void> {
  try {
    await env.BUCKET.resumeMultipartUpload(key, r2UploadId).abort();
  } catch {
    // Already completed, aborted or expired: nothing left to drop.
  }
}

/** Pending uploads as the queries below find them: the R2 key is the project's prefix and the file. */
export interface PendingKey {
  id: string;
  r2_upload_id: string;
  file: string;
  pid: string;
  storage_prefix: string | null;
}

/** Give up these uploads: each in R2, then their rows, which take their parts' reservations with them. */
export async function abortPending(env: Env, rows: PendingKey[]): Promise<void> {
  if (rows.length === 0) return;
  await Promise.all(rows.map((r) => abortR2(env, prefixFor({ id: r.pid, storage_prefix: r.storage_prefix }) + r.file, r.r2_upload_id)));
  await env.DB.prepare(`DELETE FROM pending_uploads WHERE id IN (${rows.map(() => '?').join(', ')})`)
    .bind(...rows.map((r) => r.id))
    .run();
}

export const PENDING_KEY = `SELECT pu.id, pu.r2_upload_id, pu.file, p.id AS pid, p.storage_prefix
  FROM pending_uploads pu JOIN projects p ON p.id = pu.project_id`;

/** A declared size: a whole number of bytes, at most `max`. */
function declaredSize(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
    throw new HttpError('size: expected the file size in bytes', 400, 'bad_request');
  }
  if (v > max) throw new HttpError(`A scene may be at most ${max} bytes`, 413, 'file_too_large', { limit: max });
  return v;
}

/** What a scene's stored file weighs, as its completed upload recorded it. */
function sceneBytesOf(row: ProjectRow): number {
  try {
    return (JSON.parse(row.data) as ProjectData).scene?.bytes ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Begin replacing a scene's file; the one stored stays readable until the
 * new one completes. `size` is the file's size in bytes: required of an
 * account (at most MEMBER_LIMITS.sceneBytes, and it must fit the quota as
 * things stand, 413 quota_exceeded if not), optional for owner tools,
 * whose uploads without one are checked as far as can be without it.
 *
 * A start gives up the uploader's uploads left over 24 hours, and any
 * other of this scene's: one at a time per (project, file).
 */
export async function startSceneUpload(
  env: Env,
  who: Uploader,
  id: string,
  body: { size?: unknown },
  now: number,
): Promise<{ uploadId: string; partSize: number }> {
  const row = await sceneProject(env, who, id);
  const declared =
    who.kind === 'member'
      ? declaredSize(body.size, MEMBER_LIMITS.sceneBytes)
      : body.size === undefined || body.size === null
        ? 0
        : declaredSize(body.size, Number.MAX_SAFE_INTEGER);
  const user = userOf(who);
  const { results: stale } = await env.DB.prepare(
    `${PENDING_KEY} WHERE (pu.user_id IS ?1 AND pu.created_at < ?2) OR (pu.project_id = ?3 AND pu.file = ?4)
     ORDER BY (pu.project_id = ?3) DESC LIMIT ?5`,
  )
    .bind(user, now - STALE_UPLOAD, row.id, FILE, STALE_PER_START)
    .all<PendingKey>();
  await abortPending(env, stale);
  const replaces = sceneBytesOf(row);
  if (who.kind === 'member') {
    const usage = await usageOf(env, who.user.id);
    if (usage.used + usage.reserved - replaces + declared > usage.quota) throw quotaExceeded(usage);
  }
  const key = prefixFor(row) + FILE;
  const upload = await env.BUCKET.createMultipartUpload(key, { httpMetadata: { contentType: SCENE_TYPE } });
  const uploadId = newUploadId();
  try {
    await env.DB.prepare(
      `INSERT INTO pending_uploads (id, r2_upload_id, project_id, user_id, file, declared_bytes, replaces_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(uploadId, upload.uploadId, row.id, user, FILE, declared, replaces, now)
      .run();
  } catch (err) {
    await abortR2(env, key, upload.uploadId);
    if (/UNIQUE|PRIMARY KEY/i.test(String((err as Error)?.message ?? err))) {
      throw new HttpError('Another upload of this scene began meanwhile; try again', 409);
    }
    throw err;
  }
  return { uploadId, partSize: SCENE_PART_BYTES };
}

/** How a declared upload's parts are laid out once part 1's size is known: how many, and each one's size. */
function layout(declared: number, first: number): { count: number; size: (part: number) => number } {
  const count = first >= declared ? 1 : Math.ceil(declared / first);
  return { count, size: (part) => (part < count ? first : declared - (count - 1) * first) };
}

/**
 * One part of a scene's file, checked, admitted and handed to R2:
 *
 * - part 1 first, its header read and checked (415 bad_type, 422
 *   bad_scene); sent again, it must be what it was;
 * - with the size declared, each part the size the layout gives it (400),
 *   and the last one's gzip trailer the size the header said (422);
 * - for an account, admitted by the statement of §4: no row is 413
 *   quota_exceeded {used, quota}, or 413 file_too_large past the declared
 *   size. A part sent again replaces its own reservation.
 *
 * Answers R2's {part, etag}, which completion takes back.
 */
export async function putScenePart(
  env: Env,
  who: Uploader,
  id: string,
  uploadId: string | null,
  part: number,
  body: ArrayBuffer,
): Promise<{ part: number; etag: string }> {
  const row = await sceneProject(env, who, id);
  if (!Number.isInteger(part) || part < 1 || part > MAX_SCENE_PARTS) {
    throw new HttpError(`part: expected an integer from 1 to ${MAX_SCENE_PARTS}`, 400, 'bad_request');
  }
  const pu = await pendingOf(env, who, row, uploadId);
  const bytes = new Uint8Array(body);
  const n = bytes.byteLength;
  let declared = pu.declared_bytes;
  let header = pu.header_ok;
  if (part === 1) {
    const start = await checkSceneStart(bytes);
    const mark = start.gzip ? start.size : 1;
    if (!start.gzip) {
      // A bare container is as long as its header says, and no other length.
      if (n > start.size || (declared !== 0 && declared !== start.size)) throw damagedScene('its size is not what its header says');
      declared = start.size;
    }
    if (pu.header_ok !== 0 && (pu.header_ok !== mark || pu.first_bytes !== n)) {
      throw new HttpError('Part 1 is not the one sent before; start the upload again', 400, 'bad_request');
    }
    header = mark;
  } else if (header === 0 || pu.first_bytes === null) {
    throw new HttpError('Send part 1 first', 400, 'bad_request');
  }
  if (declared > 0) {
    if (n > declared) throw new HttpError('Larger than the size declared', 413, 'file_too_large', { declared });
    const first = part === 1 ? n : (pu.first_bytes as number);
    const plan = layout(declared, first);
    if (part === 1 && plan.count > 1 && n < MIN_PART_BYTES) {
      throw new HttpError(`Every part but the last must be at least ${MIN_PART_BYTES} bytes`, 400, 'bad_request');
    }
    if (part > plan.count) throw new HttpError('Past the size declared', 400, 'bad_request');
    if (n !== plan.size(part)) throw new HttpError(`Part ${part} should be ${plan.size(part)} bytes`, 400, 'bad_request');
    if (part === plan.count && header > 1) checkSceneEnd(bytes, header);
  }

  // Admitted before R2 sees it, and part 1's findings with it.
  const admit =
    who.kind === 'member'
      ? env.DB.prepare(
          `INSERT INTO upload_parts (upload_id, part, user_id, bytes)
           SELECT ?1, ?2, u.id, ?3 FROM users u JOIN pending_uploads pu ON pu.id = ?1 AND pu.user_id = u.id
           WHERE u.id = ?4 AND u.status = 'active'
             AND u.bytes_used - pu.replaces_bytes + ?3 + (SELECT COALESCE(SUM(bytes), 0) FROM upload_parts
                   WHERE user_id = ?4 AND NOT (upload_id = ?1 AND part = ?2)) <= u.quota_bytes
             AND ?3 + (SELECT COALESCE(SUM(bytes), 0) FROM upload_parts WHERE upload_id = ?1 AND part <> ?2) <= pu.declared_bytes
           ON CONFLICT (upload_id, part) DO UPDATE SET bytes = excluded.bytes`,
        ).bind(pu.id, part, n, who.user.id)
      : env.DB.prepare(
          `INSERT INTO upload_parts (upload_id, part, user_id, bytes)
           SELECT ?1, ?2, NULL, ?3 FROM pending_uploads pu WHERE pu.id = ?1 AND pu.user_id IS NULL
             AND (?4 = 0 OR ?3 + (SELECT COALESCE(SUM(bytes), 0) FROM upload_parts WHERE upload_id = ?1 AND part <> ?2) <= ?4)
           ON CONFLICT (upload_id, part) DO UPDATE SET bytes = excluded.bytes`,
        ).bind(pu.id, part, n, declared);
  const statements = [admit];
  if (part === 1) {
    statements.push(
      env.DB.prepare(
        `UPDATE pending_uploads SET header_ok = ?, declared_bytes = ?
         WHERE id = ? AND EXISTS (SELECT 1 FROM upload_parts WHERE upload_id = ? AND part = 1 AND bytes = ?)`,
      ).bind(header, declared, pu.id, pu.id, n),
    );
  }
  const [admitted] = await env.DB.batch(statements);
  if (!admitted.meta.changes) {
    if (who.kind === 'member') {
      const usage = await usageOf(env, who.user.id);
      const others = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM upload_parts WHERE upload_id = ? AND part <> ?')
        .bind(pu.id, part)
        .first<{ n: number }>();
      if ((others?.n ?? 0) + n > declared) throw new HttpError('Larger than the size declared', 413, 'file_too_large', { declared });
      throw quotaExceeded(usage);
    }
    throw new HttpError('Larger than the size declared', 413, 'file_too_large', { declared });
  }
  try {
    const done = await env.BUCKET.resumeMultipartUpload(prefixFor(row) + FILE, pu.r2_upload_id).uploadPart(part, body);
    return { part: done.partNumber, etag: done.etag };
  } catch (err) {
    uploadError(err);
  }
}

function validCount(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new HttpError(`${name}: expected a non-negative integer`, 400, 'bad_request');
  }
  return v;
}

/**
 * Finish an upload: the parts become the scene's file in one step, and
 * then one batch moves its bytes - size less what it replaces - onto the
 * project and its owner's usage, records what is in it, and drops the
 * upload with its parts' reservations. The parts named must be all of
 * them, 1 to the last, as admitted (400 otherwise), so the file is what
 * was checked. The size is R2's measure of what landed, not the client's
 * claim. For owner tools no quota applies, but the bytes move the same.
 */
export async function completeSceneUpload(
  env: Env,
  who: Uploader,
  id: string,
  uploadId: string | null,
  body: { parts?: unknown; objects?: unknown; tris?: unknown },
  now: number,
): Promise<ProjectRow> {
  const row = await sceneProject(env, who, id);
  const pu = await pendingOf(env, who, row, uploadId);
  if (!Array.isArray(body.parts) || body.parts.length === 0 || body.parts.length > MAX_SCENE_PARTS) {
    throw new HttpError('parts: expected a non-empty array', 400, 'bad_request');
  }
  const parts = body.parts.map((p, i) => {
    const o = p as { part?: unknown; etag?: unknown };
    if (typeof o?.part !== 'number' || !Number.isInteger(o.part) || typeof o.etag !== 'string' || !o.etag) {
      throw new HttpError('parts: each entry needs a part number and its etag', 400, 'bad_request');
    }
    if (o.part !== i + 1) throw new HttpError('parts: expected parts 1 to the last, in order', 400, 'bad_request');
    return { partNumber: o.part, etag: o.etag };
  });
  const objects = validCount(body.objects, 'objects');
  const tris = validCount(body.tris, 'tris');
  if (pu.header_ok === 0) throw new HttpError('Part 1 never came', 400, 'bad_request');
  const { results: recorded } = await env.DB.prepare('SELECT part, bytes FROM upload_parts WHERE upload_id = ? ORDER BY part')
    .bind(pu.id)
    .all<{ part: number; bytes: number }>();
  if (recorded.length !== parts.length || recorded.some((r, i) => r.part !== i + 1)) {
    throw new HttpError('Not every part came; send the missing ones again', 400, 'bad_request');
  }
  const total = recorded.reduce((a, r) => a + r.bytes, 0);
  if (pu.declared_bytes > 0 && total !== pu.declared_bytes) {
    throw new HttpError(`The parts come to ${total} bytes, not the ${pu.declared_bytes} declared`, 400, 'bad_request');
  }
  let stored: R2Object;
  try {
    stored = await env.BUCKET.resumeMultipartUpload(prefixFor(row) + FILE, pu.r2_upload_id).complete(parts);
  } catch (err) {
    uploadError(err);
  }
  const delta = stored.size - pu.replaces_bytes;
  const scene = JSON.stringify({ objects, tris, bytes: stored.size });
  const live = 'EXISTS (SELECT 1 FROM pending_uploads WHERE id = ?)';
  const statements: D1PreparedStatement[] = [];
  // Its owner's usage follows its bytes: the account's, or for owner
  // tools the owner's own project's (a template is no one's).
  if (row.owner_id) {
    statements.push(
      env.DB.prepare(`UPDATE users SET bytes_used = MAX(0, bytes_used + ?) WHERE id = ? AND ${live}`).bind(delta, row.owner_id, pu.id),
    );
  }
  // updated_at is the file's ?v=, so a re-save reaches every reader.
  statements.push(
    env.DB.prepare(
      `UPDATE projects SET bytes = MAX(0, bytes + ?), data = json_set(data, '$.scene', json(?)), updated_at = ?
       WHERE id = ? AND ${live}`,
    ).bind(delta, scene, now, row.id, pu.id),
    env.DB.prepare('DELETE FROM pending_uploads WHERE id = ?').bind(pu.id),
  );
  await env.DB.batch(statements);
  return projectFor(env, who, id);
}

/** Drop an unfinished upload, and with it what its parts held of the quota. */
export async function abortSceneUpload(env: Env, who: Uploader, id: string, uploadId: string | null): Promise<void> {
  const row = await sceneProject(env, who, id);
  const pu = await pendingOf(env, who, row, uploadId);
  await abortPending(env, [{ id: pu.id, r2_upload_id: pu.r2_upload_id, file: pu.file, pid: row.id, storage_prefix: row.storage_prefix }]);
}

// --- an account's frames and thumbnails ------------------------------------------------

/**
 * Store one of an account's project files whose bytes are counted: the
 * difference from what it replaces is reserved before the put (413
 * quota_exceeded when it does not fit) and given back if the put fails;
 * then the project's bytes follow, in a batch that also gives the bytes
 * back if the project was deleted meanwhile.
 */
async function putCounted(
  env: Env,
  user: UserRow,
  row: ProjectRow,
  file: string,
  body: ArrayBuffer,
  type: string,
  now: number | null,
): Promise<void> {
  const key = prefixFor(row) + file;
  const before = await env.BUCKET.head(key);
  const delta = body.byteLength - (before?.size ?? 0);
  await reserveBytes(env, user.id, delta);
  try {
    await env.BUCKET.put(key, body, { httpMetadata: { contentType: type } });
  } catch (err) {
    await refundBytes(env, user.id, delta).catch((e: unknown) => console.error('refund failed:', e));
    throw err;
  }
  const mine = 'SELECT 1 FROM projects WHERE id = ? AND owner_id = ?';
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE projects SET bytes = MAX(0, bytes + ?)${now === null ? '' : ', updated_at = ?'} WHERE id = ? AND owner_id = ?`,
    ).bind(...[delta, ...(now === null ? [] : [now]), row.id, user.id]),
    // Reserved ahead, a growth is the account's already, unless the
    // project went; a shrink is given now, if the project is still there.
    delta > 0
      ? env.DB.prepare(`UPDATE users SET bytes_used = MAX(0, bytes_used - ?) WHERE id = ? AND NOT EXISTS (${mine})`).bind(
          delta,
          user.id,
          row.id,
          user.id,
        )
      : env.DB.prepare(`UPDATE users SET bytes_used = MAX(0, bytes_used + ?) WHERE id = ? AND EXISTS (${mine})`).bind(
          delta,
          user.id,
          row.id,
          user.id,
        ),
  ]);
}

/** One frame of an account's project: glTF 2.0, as it is or gzipped (415 otherwise), counted against the quota. */
export async function putMemberFrame(env: Env, user: UserRow, id: string, index: number, body: ArrayBuffer): Promise<void> {
  const row = await projectFor(env, { kind: 'member', user }, id);
  await checkFrame(new Uint8Array(body));
  await putCounted(env, user, row, frameFile(index), body, 'model/gltf-binary', null);
}

/**
 * An account's project's thumbnail: a JPEG (415 otherwise), counted. Its
 * updated_at moves, so every ?v= of it changes.
 */
export async function putMemberThumb(env: Env, user: UserRow, id: string, body: ArrayBuffer, now: number): Promise<void> {
  const row = await projectFor(env, { kind: 'member', user }, id);
  checkThumb(new Uint8Array(body));
  await putCounted(env, user, row, THUMB_FILE, body, 'image/jpeg', now);
}

// --- taking files out ---------------------------------------------------------------------

/**
 * Delete these frames of a project, if they are there, and answer what
 * they weighed: their sizes come from listings of its frames folder, a
 * thousand a call, rather than a request per frame.
 */
export async function deleteFrames(env: Env, row: ProjectRow, indices: number[]): Promise<number> {
  if (indices.length === 0) return 0;
  const prefix = prefixFor(row);
  const { sizes } = await listSizes(env, prefix + FRAMES_DIR);
  const keys = indices.map((i) => prefix + frameFile(i)).filter((k) => sizes.has(k));
  for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
  return keys.reduce((a, k) => a + (sizes.get(k) ?? 0), 0);
}

/** Every object under a prefix, deleted a thousand at a time; how many there were. */
export async function deletePrefix(env: Env, prefix: string): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  do {
    const listing = await env.BUCKET.list({ prefix, cursor });
    if (listing.objects.length > 0) await env.BUCKET.delete(listing.objects.map((o) => o.key));
    count += listing.objects.length;
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  return count;
}

/**
 * Whether another row reads its files from the same prefix as this one: a
 * template, which keeps the prefix it was made with (§4), and whose files
 * must outlive the project they came from.
 */
export async function prefixShared(env: Env, row: Pick<ProjectRow, 'id' | 'storage_prefix'>): Promise<boolean> {
  const other = await env.DB.prepare(
    `SELECT 1 AS found FROM projects WHERE id <> ?1 AND COALESCE(storage_prefix, 'projects/' || id || '/') = ?2 LIMIT 1`,
  )
    .bind(row.id, prefixFor(row))
    .first();
  return !!other;
}

/**
 * Delete an account's project (DELETE /api/me/projects/:id): its uploads
 * in progress given up, its files deleted (unless a template reads them
 * too), then the row, its bytes back to the account in the same batch.
 */
export async function deleteMemberProject(env: Env, user: UserRow, id: string): Promise<void> {
  const row = await projectFor(env, { kind: 'member', user }, id);
  const { results: pending } = await env.DB.prepare(`${PENDING_KEY} WHERE pu.project_id = ?`).bind(row.id).all<PendingKey>();
  await abortPending(env, pending);
  if (!(await prefixShared(env, row))) await deletePrefix(env, prefixFor(row));
  const mine = 'SELECT bytes FROM projects WHERE id = ? AND owner_id = ?';
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET bytes_used = MAX(0, bytes_used - (${mine})) WHERE id = ? AND EXISTS (${mine})`,
    ).bind(row.id, user.id, user.id, row.id, user.id),
    env.DB.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').bind(row.id, user.id),
  ]);
}
