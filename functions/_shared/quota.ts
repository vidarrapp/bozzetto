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

/** What a recount found: the account's usage now, and what each of its projects weighs. */
export interface Recount {
  used: number;
  projects: Record<string, number>;
}

/**
 * Count an account's storage again from R2 (the owner's Recount, §8):
 * every project of its own is listed under its prefix - one listing of
 * users/<uid>/projects/ for those under it, one more per project kept
 * elsewhere (the owner's from before 0.6) - and its `bytes` set to what is
 * there, bytes_used to their sum. Uploads in progress are not stored
 * objects, so their reservations stand as they are. Usage drifts only
 * where a request failed between R2 and D1; this puts it right.
 */
export async function recountUsage(env: Env, userId: string): Promise<Recount> {
  const { results } = await env.DB.prepare('SELECT id, storage_prefix FROM projects WHERE owner_id = ?')
    .bind(userId)
    .all<{ id: string; storage_prefix: string | null }>();
  const home = `users/${userId}/projects/`;
  // One pass over the listing: what each folder under home holds.
  const folders = new Map<string, number>();
  for (const [key, size] of (await listSizes(env, home)).sizes) {
    const folder = `${home}${key.slice(home.length).split('/')[0]}/`;
    folders.set(folder, (folders.get(folder) ?? 0) + size);
  }
  const projects: Record<string, number> = {};
  for (const row of results) {
    const prefix = prefixFor(row);
    if (folders.has(prefix) || (prefix.startsWith(home) && prefix.slice(home.length).split('/').length === 2)) {
      projects[row.id] = folders.get(prefix) ?? 0;
      continue;
    }
    let total = 0;
    for (const size of (await listSizes(env, prefix)).sizes.values()) total += size;
    projects[row.id] = total;
  }
  const used = Object.values(projects).reduce((a, b) => a + b, 0);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE projects SET bytes = COALESCE((SELECT value FROM json_each(?1) WHERE key = projects.id), bytes)
       WHERE owner_id = ?2`,
    ).bind(JSON.stringify(projects), userId),
    env.DB.prepare('UPDATE users SET bytes_used = ? WHERE id = ?').bind(used, userId),
  ]);
  return { used, projects };
}
