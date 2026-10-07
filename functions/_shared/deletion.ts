import type { Env } from './env';
import type { UserRow } from './types';
import { auditStatement } from './auth/audit';
import { HANDLE_HOLD } from './auth/handles';
import { prefixFor } from './projects';
import { PENDING_KEY, abortPending, type PendingKey } from './uploads';

/**
 * Deleting an account (docs/accounts.md §3), carried across as many
 * requests as it takes: a request on Workers Free has 50 subrequests, D1's
 * and R2's calls among them, and an account can hold 500 projects of up to
 * 10,000 files. POST /api/me/delete starts it and each later call carries
 * it on; Batch 6's Finish deletion is the owner's way to do the same.
 */

/** What one call spends on the steps: subrequests, every D1 or R2 call one, of the 50 a request has. */
export const DELETION_BUDGET = 40;

/** Subrequests a call may still make. */
export class Budget {
  constructor(private left: number) {}

  get remaining(): number {
    return this.left;
  }

  /** Take `n` if there are as many left; false, taking none, if not. */
  take(n = 1): boolean {
    if (this.left < n) return false;
    this.left -= n;
    return true;
  }
}

/** Where a deletion stands after a call: done, or how many uploads and projects are still to go. */
export interface DeletionProgress {
  done: boolean;
  remaining: number;
}

/** R2 deletes at most this many keys a call. */
const KEYS_PER_DELETE = 1000;
/** Projects one call reads, at the most: more than its budget can finish. */
const PROJECTS_PER_CALL = 100;
/** Uploads one call reads, at the most: as many as its budget can give up. */
const UPLOADS_PER_CALL = DELETION_BUDGET;

/**
 * Carry a deletion as far as `budget` allows, in order:
 *
 * 1. its uploads in progress given up, in R2 and in D1;
 * 2. each of its projects: its files deleted (R2 lists and deletes a
 *    thousand keys a call), then its row - the rows a call finishes go in
 *    one batch;
 * 3. whatever else is under users/<uid>/ swept, but for the prefixes
 *    templates read their files from (only the owner's can have them);
 * 4. its passkeys, auth flows, invites and sessions deleted, then the
 *    account itself, and in the same batch
 * 5. its handle held from anyone else for 90 days.
 *
 * The audit log keeps its rows, which name the account by its bare id.
 * Each step starts where the last call left off: nothing is kept between
 * calls but what is left to delete. `actor` is who carries it out: the
 * account itself, or the owner finishing it.
 */
export async function continueDeletion(
  env: Env,
  user: Pick<UserRow, 'id' | 'handle'>,
  now: number,
  actor: string,
  budget: Budget,
): Promise<DeletionProgress> {
  // One read for where things stand: the uploads and projects left, how
  // many of each, and the prefixes templates still read from.
  if (!budget.take()) return { done: false, remaining: 0 };
  const home = `users/${user.id}/`;
  const [uploadRows, projectRows, counts, kept] = await env.DB.batch([
    env.DB.prepare(`${PENDING_KEY} WHERE pu.user_id = ?1 OR p.owner_id = ?1 ORDER BY pu.created_at LIMIT ?2`).bind(
      user.id,
      UPLOADS_PER_CALL,
    ),
    env.DB.prepare('SELECT id, storage_prefix FROM projects WHERE owner_id = ? ORDER BY created_at, id LIMIT ?').bind(
      user.id,
      PROJECTS_PER_CALL,
    ),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM projects WHERE owner_id = ?1) AS projects,
              (SELECT COUNT(*) FROM pending_uploads pu JOIN projects p ON p.id = pu.project_id
                WHERE pu.user_id = ?1 OR p.owner_id = ?1) AS uploads`,
    ).bind(user.id),
    env.DB.prepare(
      `SELECT DISTINCT storage_prefix AS prefix FROM projects
       WHERE substr(storage_prefix, 1, length(?1)) = ?1 AND (owner_id IS NULL OR owner_id <> ?2)`,
    ).bind(home, user.id),
  ]);
  const totals = ((counts.results ?? [])[0] as { projects: number; uploads: number } | undefined) ?? { projects: 0, uploads: 0 };
  let uploadsLeft = totals.uploads;
  let projectsLeft = totals.projects;
  const progress = (): DeletionProgress => ({ done: false, remaining: uploadsLeft + projectsLeft });

  // 1. Uploads: an abort each in R2, then one delete of their rows.
  const uploads = ((uploadRows.results ?? []) as PendingKey[]).slice(0, Math.max(0, budget.remaining - 1));
  if (uploads.length > 0) {
    budget.take(uploads.length + 1);
    await abortPending(env, uploads);
    uploadsLeft -= uploads.length;
  }
  if (uploadsLeft > 0) return progress();

  // 2. Projects: each one's files, then the rows finished, in one batch.
  const protectedPrefixes = ((kept.results ?? []) as { prefix: string }[]).map((r) => r.prefix);
  const isProtected = (key: string): boolean => protectedPrefixes.some((p) => key.startsWith(p));
  const finished: string[] = [];
  for (const project of (projectRows.results ?? []) as { id: string; storage_prefix: string | null }[]) {
    const prefix = prefixFor(project);
    // A template reads from this prefix too: its files stay, the row goes.
    if (!isProtected(prefix) && !(await emptyPrefix(env, prefix, budget, isProtected))) break;
    finished.push(project.id);
  }
  if (finished.length > 0 && budget.take()) {
    await env.DB.prepare(`DELETE FROM projects WHERE owner_id = ? AND id IN (${finished.map(() => '?').join(', ')})`)
      .bind(user.id, ...finished)
      .run();
    projectsLeft -= finished.length;
  }
  if (projectsLeft > 0) return progress();

  // 3. What is left under the account's folder.
  if (!(await emptyPrefix(env, home, budget, isProtected))) return progress();

  // 4 and 5. The account, in one batch.
  if (!budget.take()) return progress();
  const exists = { sql: 'SELECT 1 FROM users WHERE id = ?', binds: [user.id] };
  await env.DB.batch([
    env.DB.prepare('DELETE FROM credentials WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM pending_auth WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM invites WHERE created_by = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare(
      `INSERT INTO retired_handles (handle, until) SELECT ?, ? WHERE EXISTS (${exists.sql})
       ON CONFLICT (handle) DO UPDATE SET until = MAX(until, excluded.until)`,
    ).bind(user.handle, now + HANDLE_HOLD, ...exists.binds),
    auditStatement(env, { actor, action: 'account.deleted', subject: user.id, at: now }, exists),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return { done: true, remaining: 0 };
}

/**
 * Delete everything under `prefix` but what `keep` says to keep, a listing
 * and a delete at a time while the budget lasts, keeping one for the
 * batch that follows. True once nothing deletable is left.
 */
async function emptyPrefix(env: Env, prefix: string, budget: Budget, keep: (key: string) => boolean): Promise<boolean> {
  let cursor: string | undefined;
  for (;;) {
    if (budget.remaining < 3 || !budget.take()) return false;
    const listing = await env.BUCKET.list({ prefix, cursor });
    const doomed = listing.objects.map((o) => o.key).filter((k) => !keep(k));
    for (let i = 0; i < doomed.length; i += KEYS_PER_DELETE) {
      if (!budget.take()) return false;
      await env.BUCKET.delete(doomed.slice(i, i + KEYS_PER_DELETE));
    }
    if (!listing.truncated) return true;
    cursor = listing.cursor;
  }
}
