import type { Env } from '../env';

/**
 * The audit log (docs/accounts.md §1, §8): one row per thing done to an
 * account or a project that someone may later ask about. Owner tools list
 * them (Batch 6), and rows past twelve months are deleted as they are read.
 *
 * A row says who acted, what they did and to what, and nothing personal:
 * `detail` never holds an IP, a code, a token or an email address, and an
 * account is named by its bare id, which is all that is left of one once
 * it is deleted. The actor is the exception the design makes: owner tools
 * act as the Access identity, an email, until the bootstrap has made the
 * owner an account to name instead (ownerActor), and while accounts are off.
 */
export interface AuditEntry {
  /** Who acted: a user id, or the Access email for owner tools with no owner account behind them. */
  actor: string;
  /** What was done, as `<thing>.<what>`: `project.template`. */
  action: string;
  /** What it was done to: a project or user id, or null for the site. */
  subject?: string | null;
  /** The particulars: ids, counts and flags only. */
  detail?: Record<string, string | number | boolean | null>;
  /** When, in milliseconds; the request's time (ctx.data.now) where there is one. */
  at?: number;
}

/** Who is acting, and when: what a row written for a request says of it. */
export interface Actor {
  actor: string;
  at: number;
}

/** Anything shaped like an email address. */
const EMAIL = /[^\s@]+@[^\s@]+/g;

/**
 * The detail as stored. Callers put ids and flags in it; should a string
 * ever carry an address all the same, the address is not written down.
 */
function detailJson(detail: AuditEntry['detail']): string {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(detail ?? {})) out[k] = typeof v === 'string' ? v.replace(EMAIL, '[address]') : v;
  return JSON.stringify(out);
}

/**
 * The row's insert, to run on its own or in the batch that makes the change
 * it records, so the two land together or not at all. With `onlyIf` (a
 * SELECT), the row is written only if that finds something when the
 * statement runs: in a batch, the condition the change itself is made on,
 * so a change that turns out to have nothing to do leaves no row either.
 */
export function auditStatement(
  env: Env,
  entry: AuditEntry,
  onlyIf?: { sql: string; binds: unknown[] },
): D1PreparedStatement {
  const values = [entry.at ?? Date.now(), entry.actor, entry.action, entry.subject ?? null, detailJson(entry.detail)];
  return onlyIf
    ? env.DB.prepare(
        `INSERT INTO audit_log (at, actor, action, subject, detail) SELECT ?, ?, ?, ?, ? WHERE EXISTS (${onlyIf.sql})`,
      ).bind(...values, ...onlyIf.binds)
    : env.DB.prepare('INSERT INTO audit_log (at, actor, action, subject, detail) VALUES (?, ?, ?, ?, ?)').bind(...values);
}

/** Record one entry on its own. */
export async function audit(env: Env, entry: AuditEntry): Promise<void> {
  await auditStatement(env, entry).run();
}

// --- reading it, and letting it go ------------------------------------------------------

/**
 * How far back the log goes from `now`: twelve months by the calendar (§3,
 * §9), so a row written on 7 October 2026 is kept until 7 October 2027.
 */
export function auditCutoff(now: number): number {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.getTime();
}

/** The most rows one look at the log deletes. */
export const AUDIT_SWEEP = 500;

/**
 * Delete up to AUDIT_SWEEP rows written before the cutoff, oldest first;
 * answers how many went. The owner's audit page does this after each
 * answer (waitUntil), so the log keeps itself to twelve months with no
 * schedule: more than that many past it are taken over the next looks.
 */
export async function sweepAudit(env: Env, now: number): Promise<number> {
  const { meta } = await env.DB.prepare(
    'DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE at < ? ORDER BY at, id LIMIT ?)',
  )
    .bind(auditCutoff(now), AUDIT_SWEEP)
    .run();
  return meta.changes;
}

/** A row as the owner's audit page shows it: the detail as the object it was written as. */
export interface AuditView {
  id: number;
  at: number;
  actor: string;
  action: string;
  subject: string | null;
  detail: Record<string, unknown>;
}

/** Which rows, and from where: newest first, after `before` (the last row of the page before), within the twelve months. */
export interface AuditQuery {
  before: { at: number; id: number } | null;
  action: string | null;
  subject: string | null;
  limit: number;
  now: number;
}

interface AuditRow {
  id: number;
  at: number;
  actor: string;
  action: string;
  subject: string | null;
  detail: string;
}

function detailOf(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * A page of the log, newest first (by time, then id), filtered by action
 * and subject when asked, and nothing past the twelve months even before
 * the sweep has caught up: `rows`, `next` (the cursor for the page after,
 * null at the end), and `actions`, every action the log holds, for a
 * filter to offer. One read: a subject is found by its index; the rest,
 * and the actions, are a pass over a table that keeps a year of a small
 * site's doings.
 */
export async function listAudit(
  env: Env,
  q: AuditQuery,
): Promise<{ rows: AuditView[]; next: { at: number; id: number } | null; actions: string[] }> {
  const cutoff = auditCutoff(q.now);
  const where = ['at >= ?'];
  const binds: unknown[] = [cutoff];
  if (q.action !== null) {
    where.push('action = ?');
    binds.push(q.action);
  }
  if (q.subject !== null) {
    where.push('subject = ?');
    binds.push(q.subject);
  }
  if (q.before) {
    where.push('(at < ? OR (at = ? AND id < ?))');
    binds.push(q.before.at, q.before.at, q.before.id);
  }
  const [page, seen] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, at, actor, action, subject, detail FROM audit_log WHERE ${where.join(' AND ')}
       ORDER BY at DESC, id DESC LIMIT ?`,
    ).bind(...binds, q.limit + 1),
    env.DB.prepare('SELECT DISTINCT action FROM audit_log WHERE at >= ? ORDER BY action').bind(cutoff),
  ]);
  const found = (page.results ?? []) as AuditRow[];
  const rows = found.slice(0, q.limit).map((r) => ({
    id: r.id,
    at: r.at,
    actor: r.actor,
    action: r.action,
    subject: r.subject,
    detail: detailOf(r.detail),
  }));
  const last = rows.at(-1);
  return {
    rows,
    next: found.length > q.limit && last ? { at: last.at, id: last.id } : null,
    actions: ((seen.results ?? []) as { action: string }[]).map((r) => r.action),
  };
}
