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
 * act as the Access identity, an email, until the owner has an account to
 * name instead (Batch 3).
 */
export interface AuditEntry {
  /** Who acted: the Access email for owner tools, else a user id. */
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
