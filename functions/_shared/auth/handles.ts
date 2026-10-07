import type { Env } from '../env';

/**
 * Handles (docs/accounts.md §3): what an account is called, `@handle`.
 * Lower-case letters, digits, `_` and `-`, starting with a letter or a
 * digit, 3 to 30 characters. Input is lower-cased before it is checked, so
 * `Alice` is `alice`; the column compares without case as well, so no two
 * accounts can be told apart by capitals alone.
 */
export const HANDLE = /^[a-z0-9][a-z0-9_-]{2,29}$/;

/**
 * Names no account may take, the owner's included: paths the site has or
 * may have (/u/<handle> comes in phase 3; /m/ and /media/ serve files),
 * and words the system itself goes by. An account by one of them would
 * collide with a route, or pass for the system. A few are shorter than a
 * handle can be, and stay listed should that change.
 */
export const ROUTE_NAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'api',
  'app',
  'me',
  'u',
  'user',
  'account',
  'settings',
  'login',
  'logout',
  'signin',
  'signup',
  'register',
  'join',
  'invite',
  'media',
  'files',
  'static',
  'assets',
  'templates',
  'gallery',
  'legal',
  'root',
  'system',
  'null',
  'undefined',
  'www',
  'mail',
  'm',
  'dev',
  'auth',
]);

/**
 * Names only the owner's own account may take, at the bootstrap: the
 * site's name and its owner's, and the roles and addresses someone could
 * pose as to speak for the site. They are kept from everyone else so that
 * nobody can pass for the owner; the owner is who they protect, so they
 * are not kept from the owner. Join, a rename (PATCH /api/me) and the live
 * check answer `reserved` for them, the live check whoever asks.
 */
export const PROTECTED_NAMES: ReadonlySet<string> = new Set([
  'bozzetto',
  'vidarrapp',
  'owner',
  'moderator',
  'mod',
  'staff',
  'support',
  'help',
  'abuse',
  'security',
  'privacy',
  'terms',
]);

const DAY = 24 * 60 * 60 * 1000;
/** How long a handle let go of (renamed, or its account deleted) is held from anyone else: 90 days. */
export const HANDLE_HOLD = 90 * DAY;
/** How often an account may change its handle: once per 30 days. */
export const HANDLE_CHANGE_EVERY = 30 * DAY;

/** Why a handle cannot be had: `format` and `reserved` are the asker's to fix, `taken` and `retired` someone else's. */
export type HandleProblem = 'format' | 'reserved' | 'taken' | 'retired';

/** A handle as it is checked and stored: trimmed and lower-cased. Anything not a string is no handle. */
export const normalizeHandle = (raw: unknown): string => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');

/**
 * Whose handle is checked. `owner` is for the owner's bootstrap alone, and
 * lets PROTECTED_NAMES through; every other caller leaves it out.
 */
export interface HandleCheck {
  owner?: boolean;
}

/**
 * What is wrong with a handle without asking the database: its shape, a
 * route name, or a protected name unless it is the owner's (`owner`).
 */
export function handleShape(handle: string, { owner = false }: HandleCheck = {}): 'format' | 'reserved' | null {
  if (!HANDLE.test(handle)) return 'format';
  if (ROUTE_NAMES.has(handle)) return 'reserved';
  if (!owner && PROTECTED_NAMES.has(handle)) return 'reserved';
  return null;
}

/**
 * Whether a handle can be had at `now`, and if not, why. The shape is
 * checked first (with `check`, as handleShape takes it), so a malformed
 * one costs no query; then one read asks both whether an account has it
 * (in any capitals) and whether a deleted or renamed account's hold on it
 * is still running.
 */
export async function handleProblem(
  env: Env,
  raw: unknown,
  now: number,
  check: HandleCheck = {},
): Promise<HandleProblem | null> {
  const handle = normalizeHandle(raw);
  const shape = handleShape(handle, check);
  if (shape) return shape;
  const row = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM users WHERE handle = ?1) AS taken,
            EXISTS (SELECT 1 FROM retired_handles WHERE handle = ?1 AND until > ?2) AS retired`,
  )
    .bind(handle, now)
    .first<{ taken: number; retired: number }>();
  if (row?.taken) return 'taken';
  if (row?.retired) return 'retired';
  return null;
}
