import type { Env } from '../env';
import { HttpError } from '../http';
import { randomToken, sha256Hex } from '../crypto';

/**
 * Invites (docs/accounts.md §3, §8). An invite link carries 16 random
 * bytes as base64url (`/?invite=<token>`); invites.token_hash keeps their
 * SHA-256, so a copy of the database invites nobody. An invite admits
 * someone while it is not revoked, not expired, and not used up; a
 * registration uses it in the batch that makes the account (§3 step 4),
 * where a last use raced for goes to one of the two.
 *
 * The owner makes them (Batch 6); newInviteToken is what that route hands
 * out once.
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
