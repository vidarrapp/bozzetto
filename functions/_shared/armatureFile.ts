import type { Env } from './env';
import type { ProjectRow } from './types';
import { ARMATURE_FILE, ARMATURE_MAX_BYTES } from '../../shared/armature';
import { checkArmatureFile } from './content';
import { HttpError } from './http';
import { prefixFor } from './projects';
import { refundBytes, reserveBytes } from './quota';
import { projectFor, type Uploader } from './uploads';

/**
 * An armature project's file (docs/accounts.md §4): armature.json, one
 * request, since a figure is kilobytes (at most ARMATURE_MAX_BYTES). It
 * is checked in memory first (content.ts checkArmatureFile: 415 bad_type,
 * 422 bad_armature, 413 past the cap), then stored in place of the one
 * before. For an account the difference from what it replaces is reserved
 * against the quota before the put (413 quota_exceeded) and given back if
 * the put fails, as a thumbnail's is; for owner tools nothing is held, but
 * the project's bytes - and its owner's, when it has one - move the same.
 * Either way updated_at moves, which is the file's ?v=.
 */

const TYPE = 'application/x-bozzetto-armature';

/** The most a request may carry: the file's cap. */
export const MAX_ARMATURE_BODY = ARMATURE_MAX_BYTES;

export async function putArmatureFile(
  env: Env,
  who: Uploader,
  id: string,
  body: ArrayBuffer,
  now: number,
): Promise<ProjectRow> {
  const row = await projectFor(env, who, id);
  if (row.mode !== 'armature') throw new HttpError('Not an armature project', 400, 'bad_request');
  if (body.byteLength > ARMATURE_MAX_BYTES) {
    throw new HttpError(`An armature may be at most ${ARMATURE_MAX_BYTES} bytes`, 413, 'file_too_large', { limit: ARMATURE_MAX_BYTES });
  }
  await checkArmatureFile(new Uint8Array(body));
  const key = prefixFor(row) + ARMATURE_FILE;
  const before = await env.BUCKET.head(key);
  const delta = body.byteLength - (before?.size ?? 0);
  const user = who.kind === 'member' ? who.user.id : null;
  if (user) await reserveBytes(env, user, delta);
  try {
    await env.BUCKET.put(key, body, { httpMetadata: { contentType: TYPE } });
  } catch (err) {
    if (user) await refundBytes(env, user, delta).catch((e: unknown) => console.error('refund failed:', e));
    throw err;
  }
  const owner = user ?? row.owner_id;
  const here = 'SELECT 1 FROM projects WHERE id = ? AND owner_id IS ?';
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('UPDATE projects SET bytes = MAX(0, bytes + ?), updated_at = ? WHERE id = ? AND owner_id IS ?').bind(
      delta,
      now,
      row.id,
      row.owner_id,
    ),
  ];
  if (user) {
    // Reserved ahead, a growth is the account's already, unless the project
    // went meanwhile; a shrink is given back now, if it is still there.
    statements.push(
      delta > 0
        ? env.DB.prepare(`UPDATE users SET bytes_used = MAX(0, bytes_used - ?) WHERE id = ? AND NOT EXISTS (${here})`).bind(delta, user, row.id, user)
        : env.DB.prepare(`UPDATE users SET bytes_used = MAX(0, bytes_used + ?) WHERE id = ? AND EXISTS (${here})`).bind(delta, user, row.id, user),
    );
  } else if (owner && delta !== 0) {
    // The owner's own project, through the owner tools: its bytes are the
    // owner's, as a scene completed there moves them.
    statements.push(
      env.DB.prepare(`UPDATE users SET bytes_used = MAX(0, bytes_used + ?) WHERE id = ? AND EXISTS (${here})`).bind(delta, owner, row.id, owner),
    );
  }
  await env.DB.batch(statements);
  return projectFor(env, who, id);
}
