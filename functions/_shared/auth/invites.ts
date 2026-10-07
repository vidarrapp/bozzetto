import type { Env } from '../env';
import type { Actor } from './audit';
import { HttpError } from '../http';
import { randomId, randomToken, sha256Hex } from '../crypto';
import { auditStatement } from './audit';

/**
 * Invites (docs/accounts.md §3, §8). An invite link carries 16 random
 * bytes as base64url (`/?invite=<token>`); invites.token_hash keeps their
 * SHA-256, so a copy of the database invites nobody. An invite admits
 * someone while it is not revoked, not expired, and not used up; a
 * registration uses it in the batch that makes the account (§3 step 4),
 * where a last use raced for goes to one of the two.
 *
 * The owner makes them (POST /admin/api/invites), and the link with the
 * token in it is shown that once: nothing here can show it again.
 */

/** An invite token: 16 bytes as base64url. */
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** A new invite's token, to show once, and what invites.token_hash keeps of it. */
export async function newInviteToken(): Promise<{ token: string; hash: string }> {
  const token = randomToken(16);
  return { token, hash: await sha256Hex(token) };
}

/** An invite that admits someone. */
export interface LiveInvite {
  id: string;
  expires_at: number;
}

/** The invite `token` names, if it still admits someone at `now`; null for anything else, a malformed token included. */
export async function liveInvite(env: Env, token: unknown, now: number): Promise<LiveInvite | null> {
  if (typeof token !== 'string' || !INVITE_TOKEN.test(token)) return null;
  return env.DB.prepare(
    `SELECT id, expires_at FROM invites
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses`,
  )
    .bind(await sha256Hex(token), now)
    .first<LiveInvite>();
}

/** The refusal for an invite that admits nobody: unknown, revoked, expired or used up alike. */
export function inviteInvalid(headers: Record<string, string> = {}): HttpError {
  return new HttpError('This invite is not valid any more', 410, 'invite_invalid', {}, headers);
}

// --- owner tools ------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

/** What the owner may ask of a new invite, as the table's CHECKs hold it. */
export const INVITE_LIMITS = {
  /** Uses: 1 to 500 (invites.max_uses), 1 when not said. */
  maxUses: 500,
  defaultUses: 1,
  /** Days it lasts: 1 to 90, 14 when not said. */
  days: 90,
  defaultDays: 14,
  /** A label's characters. */
  label: 100,
  /** The most the list shows: the newest. */
  listed: 500,
} as const;

/** Where an invite stands: admitting someone, used up, past its date, or withdrawn - the first of the last three that holds. */
export type InviteState = 'live' | 'used' | 'expired' | 'revoked';

/** An invite as the owner's list shows it: never its token, nor the token's hash. */
export interface InviteView {
  id: string;
  label: string;
  maxUses: number;
  uses: number;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  state: InviteState;
}

interface InviteRow {
  id: string;
  label: string;
  max_uses: number;
  uses: number;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

const INVITE_COLUMNS = 'id, label, max_uses, uses, created_at, expires_at, revoked_at';

/** Where an invite stands at `now`: `live` exactly when liveInvite would admit someone with it. */
function inviteState(row: InviteRow, now: number): InviteState {
  if (row.revoked_at !== null) return 'revoked';
  if (row.uses >= row.max_uses) return 'used';
  if (row.expires_at <= now) return 'expired';
  return 'live';
}

function inviteView(row: InviteRow, now: number): InviteView {
  return {
    id: row.id,
    label: row.label,
    maxUses: row.max_uses,
    uses: row.uses,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    state: inviteState(row, now),
  };
}

/** What a new invite is asked to be. */
export interface InviteInput {
  label: string;
  maxUses: number;
  expiresInDays: number;
}

/** A whole number from 1 to `max`, `fallback` when left out (or null); else 400 bad_request naming `field` as the reason. */
function count(body: Record<string, unknown>, field: string, max: number, fallback: number): number {
  const v = body[field];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) {
    throw new HttpError(`${field}: a whole number from 1 to ${max}`, 400, 'bad_request', { reason: field });
  }
  return v;
}

/**
 * A new invite's terms from POST /admin/api/invites: `label` (optional,
 * text: control characters and runs of spaces made one space, trimmed, at
 * most 100 characters), `maxUses` (1-500, default 1) and `expiresInDays`
 * (1-90, default 14). Anything else is 400 bad_request, `reason` naming
 * the field.
 */
export function inviteInput(body: Record<string, unknown>): InviteInput {
  const raw = body.label ?? '';
  if (typeof raw !== 'string') throw new HttpError('label: text', 400, 'bad_request', { reason: 'label' });
  // eslint-disable-next-line no-control-regex
  const label = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if ([...label].length > INVITE_LIMITS.label) {
    throw new HttpError(`label: at most ${INVITE_LIMITS.label} characters`, 400, 'bad_request', { reason: 'label' });
  }
  return {
    label,
    maxUses: count(body, 'maxUses', INVITE_LIMITS.maxUses, INVITE_LIMITS.defaultUses),
    expiresInDays: count(body, 'expiresInDays', INVITE_LIMITS.days, INVITE_LIMITS.defaultDays),
  };
}

/**
 * Make an invite, made by `createdBy` (the owner's account; null before
 * there is one), at the actor's time, and audit it - its terms, never its
 * label or token. Answers the invite and its token, which only this
 * answer ever holds.
 */
export async function createInvite(
  env: Env,
  input: InviteInput,
  by: Actor,
  createdBy: string | null,
): Promise<{ invite: InviteView; token: string }> {
  const { token, hash } = await newInviteToken();
  const row: InviteRow = {
    id: randomId('i'),
    label: input.label,
    max_uses: input.maxUses,
    uses: 0,
    created_at: by.at,
    expires_at: by.at + input.expiresInDays * DAY,
    revoked_at: null,
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO invites (id, token_hash, label, max_uses, uses, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    ).bind(row.id, hash, row.label, row.max_uses, createdBy, row.created_at, row.expires_at),
    auditStatement(env, {
      ...by,
      action: 'invite.create',
      subject: row.id,
      detail: { maxUses: input.maxUses, expiresInDays: input.expiresInDays },
    }),
  ]);
  return { invite: inviteView(row, by.at), token };
}

/** The invites, newest first: the latest INVITE_LIMITS.listed of them. */
export async function listInvites(env: Env, now: number): Promise<InviteView[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${INVITE_COLUMNS} FROM invites ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(INVITE_LIMITS.listed)
    .all<InviteRow>();
  return results.map((r) => inviteView(r, now));
}

/**
 * Withdraw an invite: from now on it admits nobody, while the accounts it
 * made stay as they are. Audited once; withdrawing it again changes and
 * records nothing. Answers the invite; one that is not there is 404.
 */
export async function revokeInvite(env: Env, id: string, by: Actor): Promise<InviteView> {
  const open = { sql: 'SELECT 1 FROM invites WHERE id = ? AND revoked_at IS NULL', binds: [id] };
  const [, , after] = await env.DB.batch([
    auditStatement(env, { ...by, action: 'invite.revoke', subject: id }, open),
    env.DB.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(by.at, id),
    env.DB.prepare(`SELECT ${INVITE_COLUMNS} FROM invites WHERE id = ?`).bind(id),
  ]);
  const row = (after.results ?? [])[0] as InviteRow | undefined;
  if (!row) throw new HttpError('Not found', 404, 'not_found');
  return inviteView(row, by.at);
}
