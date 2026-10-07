import type { Env } from './env';
import type { Role, UserRow, UserStatus } from './types';
import type { Actor } from './auth/audit';
import type { MailContext } from './auth/mail';
import type { Cursor } from './owner';
import { HttpError } from './http';
import { audit, auditStatement } from './auth/audit';
import { notify } from './auth/mail';
import { SESSION_IDLE } from './auth/session';
import { Budget, DELETION_BUDGET, continueDeletion, type DeletionProgress } from './deletion';
import { recountUsage } from './quota';
import { PENDING_KEY, abortInR2, type PendingKey } from './uploads';

/**
 * Accounts as the owner's Users tab sees them and acts on them (docs/
 * accounts.md §8): the list and one account, suspending and lifting it,
 * signing it out everywhere, its quota, a recount of its storage, and
 * finishing a deletion it began. Every action is audited as the owner
 * (ownerActor), naming the account by its bare id and nothing personal: a
 * suspension's reason goes to the account's row and its holder's mailbox,
 * not to the log. None of them acts on the owner's own account where that
 * would lock the owner out (409 owner): suspending it, signing it out
 * everywhere, or finishing its deletion.
 */

const MiB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

/** A deletion begun longer ago than this is flagged on the Users tab: it should have run to its end. */
export const DELETION_OVERDUE = DAY;
/** A suspension's reason, in characters. */
export const MAX_REASON = 500;
/** A quota, in MiB: up to 100 GiB. */
export const MAX_QUOTA_MIB = 102_400;
/** Uploads a suspension gives up in R2 in the request; R2 drops any others at 7 days. */
const ABORTS = 20;

/** An account as the owner's list shows it. */
export interface UserView {
  id: string;
  handle: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdAt: number;
  /** When any of its sessions, signed out or not, was last seen; null if it never had one. */
  lastSeenAt: number | null;
  bytesUsed: number;
  /** What its uploads in progress hold. */
  reserved: number;
  quotaBytes: number;
  /** How many projects it owns. */
  projects: number;
  /** When its deletion began, while it is being deleted; else null. */
  deletingSince: number | null;
  suspendedReason: string | null;
}

/** One account, as GET /admin/api/users/:id shows it: the list's fields, and its passkeys and good sessions counted. */
export interface UserDetail extends UserView {
  passkeys: number;
  sessions: number;
}

/**
 * When an account's deletion began: the time of its `account.delete` row
 * (POST /api/me/delete writes it in the batch that marks the account), or
 * the row's last change should the log have let that go.
 */
const DELETING_SINCE = `CASE WHEN u.status = 'deleting' THEN COALESCE(
    (SELECT MAX(at) FROM audit_log WHERE subject = u.id AND action = 'account.delete'), u.updated_at) END`;

/** The list's columns: each count is a read of an index on the account's id. */
const VIEW = `u.id, u.handle, u.email, u.role, u.status, u.created_at, u.bytes_used, u.quota_bytes, u.suspended_reason,
  (SELECT MAX(last_seen_at) FROM sessions WHERE user_id = u.id) AS last_seen_at,
  (SELECT COALESCE(SUM(bytes), 0) FROM upload_parts WHERE user_id = u.id) AS reserved,
  (SELECT COUNT(*) FROM projects WHERE owner_id = u.id) AS projects,
  ${DELETING_SINCE} AS deleting_since`;

type ViewRow = Pick<
  UserRow,
  'id' | 'handle' | 'email' | 'role' | 'status' | 'created_at' | 'bytes_used' | 'quota_bytes' | 'suspended_reason'
> & { last_seen_at: number | null; reserved: number; projects: number; deleting_since: number | null };

function viewOf(r: ViewRow): UserView {
  return {
    id: r.id,
    handle: r.handle,
    email: r.email,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at ?? null,
    bytesUsed: r.bytes_used,
    reserved: r.reserved,
    quotaBytes: r.quota_bytes,
    projects: r.projects,
    deletingSince: r.deleting_since ?? null,
    suspendedReason: r.suspended_reason ?? null,
  };
}

/** An account id as a cursor may carry one. */
export const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A page of accounts, newest first (by when each was made, then id),
 * `limit` long, after `cursor`: `users`, `next` (where the page ended, null
 * at the end), and `pendingDeletions`, how many accounts have been being
 * deleted for longer than DELETION_OVERDUE at `now`. One batch.
 */
export async function listUsers(
  env: Env,
  { cursor, limit, now }: { cursor: Cursor<string> | null; limit: number; now: number },
): Promise<{ users: UserView[]; next: Cursor<string> | null; pendingDeletions: number }> {
  const page = cursor
    ? env.DB.prepare(
        `SELECT ${VIEW} FROM users u WHERE u.created_at < ?1 OR (u.created_at = ?1 AND u.id < ?2)
         ORDER BY u.created_at DESC, u.id DESC LIMIT ?3`,
      ).bind(cursor.at, cursor.id, limit + 1)
    : env.DB.prepare(`SELECT ${VIEW} FROM users u ORDER BY u.created_at DESC, u.id DESC LIMIT ?`).bind(limit + 1);
  const [rows, pending] = await env.DB.batch([
    page,
    env.DB.prepare(`SELECT COUNT(*) AS n FROM users u WHERE u.status = 'deleting' AND ${DELETING_SINCE} < ?`).bind(
      now - DELETION_OVERDUE,
    ),
  ]);
  const found = (rows.results ?? []) as ViewRow[];
  const users = found.slice(0, limit).map(viewOf);
  const last = users.at(-1);
  return {
    users,
    next: found.length > limit && last ? { at: last.createdAt, id: last.id } : null,
    pendingDeletions: ((pending.results ?? [])[0] as { n: number } | undefined)?.n ?? 0,
  };
}

/** One account as the owner sees it at `now`, or null when there is none. */
export async function userDetail(env: Env, id: string, now: number): Promise<UserDetail | null> {
  const row = await env.DB.prepare(
    `SELECT ${VIEW},
       (SELECT COUNT(*) FROM credentials WHERE user_id = u.id) AS passkeys,
       (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND revoked_at IS NULL AND expires_at > ?2 AND last_seen_at > ?3)
         AS sessions
     FROM users u WHERE u.id = ?1`,
  )
    .bind(id, now, now - SESSION_IDLE)
    .first<ViewRow & { passkeys: number; sessions: number }>();
  return row ? { ...viewOf(row), passkeys: row.passkeys, sessions: row.sessions } : null;
}

// --- acting on one ------------------------------------------------------------------------

const notFound = (): HttpError => new HttpError('Not found', 404, 'not_found');

/** The account `id`, as stored, or 404. */
async function accountOf(env: Env, id: string): Promise<UserRow> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  if (!row) throw notFound();
  return row;
}

/** 409 owner for the owner's own account. */
function notTheOwner(user: UserRow): void {
  if (user.role === 'owner') throw new HttpError("Owner tools do not act on the owner's own account", 409, 'owner');
}

const STATUS_TEXT: Record<UserStatus, string> = { active: 'active', suspended: 'suspended', deleting: 'being deleted' };

/** 409 wrong_status: the action starts from another status than the account's, which comes with it. */
function wrongStatus(status: UserStatus): HttpError {
  return new HttpError(`The account is ${STATUS_TEXT[status]}`, 409, 'wrong_status', { status });
}

/** Why a change found nothing to change, read afresh: the account went (404), or its status moved on (409). */
async function changedMeanwhile(env: Env, id: string): Promise<HttpError> {
  const now = await env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(id).first<{ status: UserStatus }>();
  return now ? wrongStatus(now.status) : notFound();
}

/** The account as the owner sees it after an action. */
async function after(env: Env, id: string, now: number): Promise<UserDetail> {
  const detail = await userDetail(env, id, now);
  if (!detail) throw notFound();
  return detail;
}

/**
 * A suspension's reason from the body: text, its control characters and
 * runs of spaces made one space, trimmed, 1 to MAX_REASON characters;
 * else 400 bad_request {reason: 'reason'}. The holder is mailed it.
 */
export function suspensionReason(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  const text = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const length = [...text].length;
  if (length < 1 || length > MAX_REASON) {
    throw new HttpError(`reason: 1 to ${MAX_REASON} characters, which the account's holder is mailed`, 400, 'bad_request', {
      reason: 'reason',
    });
  }
  return text;
}

/**
 * Suspend an active account: its status and reason, every session of it
 * revoked and its uploads in progress dropped (their reservations with
 * them), and the audit row, in one batch; then its uploads given up in R2,
 * and its holder mailed the reason. Its cookies answer 403 suspended from
 * then on; its work is kept. 409 owner for the owner's own account, 409
 * wrong_status for one that is not active.
 */
export async function suspendUser(env: Env, ctx: MailContext, id: string, reason: string, by: Actor): Promise<UserDetail> {
  const user = await accountOf(env, id);
  notTheOwner(user);
  if (user.status !== 'active') throw wrongStatus(user.status);
  const { results: uploads } = await env.DB.prepare(`${PENDING_KEY} WHERE pu.user_id = ? ORDER BY pu.created_at LIMIT ?`)
    .bind(id, ABORTS)
    .all<PendingKey>();
  const active = { sql: "SELECT 1 FROM users WHERE id = ? AND status = 'active' AND role <> 'owner'", binds: [id] };
  const suspended = "SELECT 1 FROM users WHERE id = ? AND status = 'suspended'";
  const [, changed] = await env.DB.batch([
    auditStatement(env, { ...by, action: 'account.suspend', subject: id }, active),
    env.DB.prepare(
      `UPDATE users SET status = 'suspended', suspended_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'active' AND role <> 'owner'`,
    ).bind(reason, by.at, id),
    env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND EXISTS (${suspended})`).bind(
      by.at,
      id,
      id,
    ),
    env.DB.prepare(`DELETE FROM pending_uploads WHERE user_id = ? AND EXISTS (${suspended})`).bind(id, id),
  ]);
  if (!changed.meta.changes) throw await changedMeanwhile(env, id);
  await abortInR2(env, uploads);
  await notify(env, ctx, user, { kind: 'account.suspended', reason });
  return after(env, id, by.at);
}

/**
 * Lift a suspension: the account is active again, its reason cleared,
 * audited. Its sessions stay revoked, so its holder signs in afresh. 409
 * wrong_status for an account that is not suspended.
 */
export async function unsuspendUser(env: Env, id: string, by: Actor): Promise<UserDetail> {
  const user = await accountOf(env, id);
  if (user.status !== 'suspended') throw wrongStatus(user.status);
  const guard = { sql: "SELECT 1 FROM users WHERE id = ? AND status = 'suspended'", binds: [id] };
  const [, changed] = await env.DB.batch([
    auditStatement(env, { ...by, action: 'account.unsuspend', subject: id }, guard),
    env.DB.prepare(
      "UPDATE users SET status = 'active', suspended_reason = NULL, updated_at = ? WHERE id = ? AND status = 'suspended'",
    ).bind(by.at, id),
  ]);
  if (!changed.meta.changes) throw await changedMeanwhile(env, id);
  return after(env, id, by.at);
}

/**
 * Sign an account out everywhere: every good session of it revoked, and
 * audited. Answers how many were. 409 owner for the owner's own account,
 * which signs out everywhere under Account.
 */
export async function revokeUserSessions(env: Env, id: string, by: Actor): Promise<number> {
  notTheOwner(await accountOf(env, id));
  const [revoked] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE sessions SET revoked_at = ?1
       WHERE user_id = ?2 AND revoked_at IS NULL AND expires_at > ?1 AND last_seen_at > ?3`,
    ).bind(by.at, id, by.at - SESSION_IDLE),
    auditStatement(env, { ...by, action: 'account.revoke_sessions', subject: id }),
  ]);
  return revoked.meta.changes;
}

/** A quota from the body, in MiB: a whole number from 1 to MAX_QUOTA_MIB; else 400 bad_request {reason: 'quotaMiB'}. */
export function quotaMiB(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_QUOTA_MIB) {
    throw new HttpError(`quotaMiB: a whole number from 1 to ${MAX_QUOTA_MIB}`, 400, 'bad_request', { reason: 'quotaMiB' });
  }
  return raw;
}

/**
 * An account's quota, set: audited with what it was and what it is, in
 * bytes; asking for what it already is changes and records nothing. A
 * quota below what the account holds keeps what it holds, and takes no
 * more. The change holds only while the quota is still the one read, so
 * the row's `from` is always the one replaced.
 */
export async function setQuota(env: Env, id: string, mib: number, by: Actor): Promise<UserDetail> {
  const bytes = mib * MiB;
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = await accountOf(env, id);
    if (user.quota_bytes === bytes) return after(env, id, by.at);
    const still = { sql: 'SELECT 1 FROM users WHERE id = ? AND quota_bytes = ?', binds: [id, user.quota_bytes] };
    const [, changed] = await env.DB.batch([
      auditStatement(env, { ...by, action: 'account.quota', subject: id, detail: { from: user.quota_bytes, to: bytes } }, still),
      env.DB.prepare('UPDATE users SET quota_bytes = ?, updated_at = ? WHERE id = ? AND quota_bytes = ?').bind(
        bytes,
        by.at,
        id,
        user.quota_bytes,
      ),
    ]);
    if (changed.meta.changes) return after(env, id, by.at);
  }
  throw new Error('the quota kept changing under the owner');
}

/**
 * An account's storage counted again from R2 (recountUsage): what it uses
 * now, and what the account said before. Audited with both.
 */
export async function recountUser(env: Env, id: string, by: Actor): Promise<{ bytesUsed: number; before: number }> {
  const { bytes_used: before } = await accountOf(env, id);
  const { used } = await recountUsage(env, id);
  await audit(env, { ...by, action: 'account.recount', subject: id, detail: { before, after: used } });
  return { bytesUsed: used, before };
}

/**
 * Carry an account's deletion on, as POST /api/me/delete does, within one
 * request's subrequests (continueDeletion): for the account that began it
 * and stopped calling. {done: false, remaining} until {done: true}, when
 * the account is gone and its `account.deleted` row names the owner. Each
 * call is audited. 409 owner for the owner's own account, 409 wrong_status
 * for one whose deletion has not begun.
 */
export async function finishDeletion(env: Env, id: string, by: Actor): Promise<DeletionProgress> {
  const user = await accountOf(env, id);
  notTheOwner(user);
  if (user.status !== 'deleting') throw wrongStatus(user.status);
  const progress = await continueDeletion(env, user, by.at, by.actor, new Budget(DELETION_BUDGET));
  await audit(env, {
    ...by,
    action: 'account.finish_deletion',
    subject: id,
    detail: { done: progress.done, remaining: progress.remaining },
  });
  return progress;
}
