import type { Env } from '../env';
import type { CredentialRow, SessionRow, UserRow } from '../types';
import { SESSION_IDLE } from './session';

/**
 * What the API says of an account (docs/accounts.md §3). GET /api/me is
 * what the client keeps and may cache: no address in it. The address, the
 * passkeys and the sessions are GET /api/me/account's, which nothing caches.
 */

/** An account as GET /api/me answers it, and as a sign-in answers with it. */
export interface Me {
  id: string;
  handle: string;
  role: UserRow['role'];
  status: UserRow['status'];
  /** Bytes stored, bytes reserved by uploads in progress, and the quota. */
  usage: { used: number; reserved: number; quota: number };
}

/** The account as /api/me shows it: one more read, for what its uploads in progress hold. */
export async function meOf(env: Env, user: UserRow): Promise<Me> {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS reserved FROM upload_parts WHERE user_id = ?')
    .bind(user.id)
    .first<{ reserved: number }>();
  return {
    id: user.id,
    handle: user.handle,
    role: user.role,
    status: user.status,
    usage: { used: user.bytes_used, reserved: row?.reserved ?? 0, quota: user.quota_bytes },
  };
}

/** A passkey as the account's lists show it: no key, and no counter. */
export interface Passkey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** 'multiDevice' for a synced passkey (iCloud Keychain, Google Password Manager), else 'singleDevice'. */
  deviceType: string;
  backedUp: boolean;
  /** The authenticator's model, when it says (all zeros when it does not). */
  aaguid: string | null;
  /** When a sign-in last reported a counter no higher than before; null if never. */
  counterWarningAt: number | null;
}

export type PasskeyFields = Pick<
  CredentialRow,
  'id' | 'name' | 'created_at' | 'last_used_at' | 'device_type' | 'backed_up' | 'aaguid' | 'counter_warning_at'
>;

/** The columns passkeyOf needs. */
export const PASSKEY_COLUMNS = 'id, name, created_at, last_used_at, device_type, backed_up, aaguid, counter_warning_at';

export function passkeyOf(row: PasskeyFields): Passkey {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    aaguid: row.aaguid,
    counterWarningAt: row.counter_warning_at,
  };
}

/** An account's passkeys, oldest first. */
export async function passkeysOf(env: Env, userId: string): Promise<Passkey[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${PASSKEY_COLUMNS} FROM credentials WHERE user_id = ? ORDER BY created_at, id`,
  )
    .bind(userId)
    .all<PasskeyFields>();
  return results.map(passkeyOf);
}

/** A session as the account's list shows it: never its token, nor the token's hash. */
export interface SessionView {
  id: string;
  client: string;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  /** How it was signed in: passkey, email (a code), link (the code mail's link), bootstrap. */
  method: string;
  /** The session this request came with. */
  current: boolean;
}

/** An account's good sessions at `now`, most recently used first, the one asking marked. */
export async function sessionsOf(env: Env, userId: string, currentId: string, now: number): Promise<SessionView[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, client, user_agent, created_at, last_seen_at, expires_at, method FROM sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND last_seen_at > ?
     ORDER BY last_seen_at DESC, id`,
  )
    .bind(userId, now, now - SESSION_IDLE)
    .all<Pick<SessionRow, 'id' | 'client' | 'user_agent' | 'created_at' | 'last_seen_at' | 'expires_at' | 'method'>>();
  return results.map((s) => ({
    id: s.id,
    client: s.client,
    userAgent: s.user_agent,
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    expiresAt: s.expires_at,
    method: s.method,
    current: s.id === currentId,
  }));
}

/** The most a passkey's name may be, in characters. */
export const MAX_PASSKEY_NAME = 64;

/**
 * A passkey's name as given: trimmed, control characters out, runs of
 * spaces made one, and cut to MAX_PASSKEY_NAME characters; '' when nothing
 * is left, or it was not a string.
 */
export function cleanPasskeyName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const flat = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, MAX_PASSKEY_NAME).join('').trim();
}

/**
 * The name a new passkey gets when none is given: where it was made, as
 * the user agent says - "Safari on iPad", "Chrome on Windows". The holder
 * can rename it; this only has to tell one from another at a glance.
 */
export function defaultPasskeyName(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const device = /iPad/.test(ua)
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  const browser = /Electron\//.test(ua)
    ? 'Bozzetto'
    : /Edg(A|iOS)?\//.test(ua)
      ? 'Edge'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  if (browser && device) return `${browser} on ${device}`;
  return device ?? browser ?? 'Passkey';
}
