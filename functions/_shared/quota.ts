import type { Env } from './env';
import { HttpError } from './http';
import { prefixFor } from './projects';

/**
 * Storage and quota (docs/accounts.md §4). What an account stores is
 * users.bytes_used, the sum of its projects' `bytes`; what its uploads in
 * progress hold is the sum of its upload_parts. Both count against
 * quota_bytes, so usage is the two together.
 *
 * A scene's parts are admitted one at a time by the atomic statement in
 * uploads.ts. A frame or a thumbnail, one request each, is reserved here:
 * one conditional UPDATE takes its bytes onto bytes_used before the put,
 * and gives them back if the put fails. Owner tools keep no quota.
 */

/** An account's storage: what it stores, what its uploads in progress hold, and the most it may. */
export interface Usage {
  used: number;
  reserved: number;
  quota: number;
}

/** The account's usage as stored now: one read. Zeros for an account that is not there. */
export async function usageOf(env: Env, userId: string): Promise<Usage> {
  const row = await env.DB.prepare(
    `SELECT bytes_used AS used, quota_bytes AS quota,
            (SELECT COALESCE(SUM(bytes), 0) FROM upload_parts WHERE user_id = users.id) AS reserved
     FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<Usage>();
  return { used: row?.used ?? 0, reserved: row?.reserved ?? 0, quota: row?.quota ?? 0 };
}

/**
 * 413 quota_exceeded, saying how full the account is: `used` counts what
 * its uploads in progress hold too, as the quota does, so the client can
 * say "248 of 250 MB".
 */
export function quotaExceeded(usage: Usage): HttpError {
  return new HttpError('Your storage is full', 413, 'quota_exceeded', {
    used: usage.used + usage.reserved,
    quota: usage.quota,
  });
}

/**
 * Take `delta` more bytes onto an account's usage, for a file about to be
 * stored, if they fit: one conditional UPDATE, so two uploads at once
 * cannot both take the last of the quota. 413 quota_exceeded when they do
 * not. Only an active account takes anything.
 */
export async function reserveBytes(env: Env, userId: string, delta: number): Promise<void> {
  if (delta <= 0) return;
  const { meta } = await env.DB.prepare(
    `UPDATE users SET bytes_used = bytes_used + ?1
     WHERE id = ?2 AND status = 'active'
       AND bytes_used + ?1 + (SELECT COALESCE(SUM(bytes), 0) FROM upload_parts WHERE user_id = ?2) <= quota_bytes`,
  )
    .bind(delta, userId)
    .run();
  if (!meta.changes) throw quotaExceeded(await usageOf(env, userId));
}

/** Give back what reserveBytes took, when the file it was for did not land. */
export async function refundBytes(env: Env, userId: string, delta: number): Promise<void> {
  if (delta <= 0) return;
  await env.DB.prepare('UPDATE users SET bytes_used = MAX(0, bytes_used - ?) WHERE id = ?').bind(delta, userId).run();
}

/**
 * The sizes of every object under `prefix`, by key, from R2's listings (a
 * thousand a call). `limit` stops it after that many listings: what was
 * seen by then is answered, and `complete` says whether that was all.
 */
export async function listSizes(
  env: Env,
  prefix: string,
  limit = Infinity,
): Promise<{ sizes: Map<string, number>; complete: boolean; calls: number }> {
  const sizes = new Map<string, number>();
  let cursor: string | undefined;
  let calls = 0;
  do {
    if (calls >= limit) return { sizes, complete: false, calls };
    const listing = await env.BUCKET.list({ prefix, cursor });
    calls++;
    for (const o of listing.objects) sizes.set(o.key, o.size);
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  return { sizes, complete: true, calls };
}

/**
 * The R2 listings one request may spend on a recount, of the 50
 * subrequests it has on Workers Free (docs/accounts.md §1): what is left
 * covers the D1 calls around it - the session, the reads, the batch that
 * writes the counts, the audit row - in the recount route and in the
 * bootstrap alike.
 */
export const RECOUNT_LISTINGS = 36;

/**
 * What a recount found: the account's usage now, what each project it
 * counted weighs, and where to carry on - `next`, the id of the last
 * project counted, while some are still to be (null once all are).
 */
export interface Recount {
  used: number;
  projects: Record<string, number>;
  next: string | null;
}

/**
 * Count an account's storage again from R2 (the owner's Recount, §8; and
 * the bootstrap, for the projects it claims): each project of its own is
 * listed under its prefix, a thousand keys a listing, and its `bytes` set
 * to what is there; then bytes_used is set to the sum of its projects'
 * `bytes`. Uploads in progress are not stored objects, so their
 * reservations stand as they are. Usage drifts only where a request failed
 * between R2 and D1, or where a row predates the counting; this puts it
 * right.
 *
 * One call lists no more than `listings` (RECOUNT_LISTINGS): projects are
 * taken in id order, after `after`, as far as that goes, and a project the
 * listings ran out in is left for the next call, which starts from `next`.
 * A project holds at most 10,002 files (11 listings), so every call
 * finishes at least one. Projects not counted yet keep the `bytes` they
 * had, and bytes_used is their sum with the rest: never worse than before.
 */
export async function recountUsage(
  env: Env,
  userId: string,
  { after = null, listings = RECOUNT_LISTINGS }: { after?: string | null; listings?: number } = {},
): Promise<Recount> {
  const { results } = await env.DB.prepare(
    'SELECT id, storage_prefix FROM projects WHERE owner_id = ? AND id > ? ORDER BY id',
  )
    .bind(userId, after ?? '')
    .all<{ id: string; storage_prefix: string | null }>();
  const projects: Record<string, number> = {};
  let left = listings;
  let next: string | null = null;
  for (const row of results) {
    const listed = await listSizes(env, prefixFor(row), left);
    left -= listed.calls;
    if (!listed.complete) {
      next = Object.keys(projects).at(-1) ?? after;
      break;
    }
    let total = 0;
    for (const size of listed.sizes.values()) total += size;
    projects[row.id] = total;
  }
  const done = await env.DB.batch([
    env.DB.prepare(
      `UPDATE projects SET bytes = COALESCE((SELECT value FROM json_each(?1) WHERE key = projects.id), bytes)
       WHERE owner_id = ?2`,
    ).bind(JSON.stringify(projects), userId),
    env.DB.prepare(
      'UPDATE users SET bytes_used = (SELECT COALESCE(SUM(bytes), 0) FROM projects WHERE owner_id = ?1) WHERE id = ?1',
    ).bind(userId),
    env.DB.prepare('SELECT bytes_used AS used FROM users WHERE id = ?').bind(userId),
  ]);
  const used = (done[2].results[0] as { used: number } | undefined)?.used ?? 0;
  return { used, projects, next };
}

/**
 * A project about to change hands whose row says it weighs nothing, though
 * it may not: a row from before the counting (a 0.5 project, a template),
 * whose files R2 still holds. Its prefix is listed and, if anything is
 * there, its `bytes` set to that - and its owner's usage, if it has one,
 * takes the same, as a recount would - so the hand-over moves what it
 * really weighs. Both hold only while the row is still unweighed and in
 * the same hands; answered as it then is (the hand-over's own guard
 * refuses it if it changed meanwhile). A row with bytes is answered as it
 * is, with no listing.
 */
export async function weighUnweighed<
  R extends { id: string; storage_prefix: string | null; owner_id: string | null; template: number; bytes: number },
>(env: Env, row: R): Promise<R> {
  if (row.bytes !== 0) return row;
  let total = 0;
  for (const size of (await listSizes(env, prefixFor(row))).sizes.values()) total += size;
  if (total === 0) return row;
  const unweighed = 'id = ? AND bytes = 0 AND owner_id IS ? AND template = ?';
  const guard = `SELECT 1 FROM projects WHERE ${unweighed}`;
  const binds = [row.id, row.owner_id, row.template];
  await env.DB.batch([
    ...(row.owner_id
      ? [
          env.DB.prepare(`UPDATE users SET bytes_used = bytes_used + ? WHERE id = ? AND EXISTS (${guard})`).bind(
            total,
            row.owner_id,
            ...binds,
          ),
        ]
      : []),
    env.DB.prepare(`UPDATE projects SET bytes = ? WHERE ${unweighed}`).bind(total, ...binds),
  ]);
  return { ...row, bytes: total };
}
