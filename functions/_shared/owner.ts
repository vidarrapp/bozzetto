import type { Env } from './env';
import type { RequestData } from './principal';
import { accountsOn } from './env';
import { HttpError, refuse } from './http';
import { requireAdmin } from './principal';

/**
 * What the owner tools of docs/accounts.md §8 share (Batch 6): the gate
 * every one of them passes first, and how their lists are paged. The tools
 * are invites (auth/invites.ts), accounts (users.ts) and the audit log
 * (auth/audit.ts), each under /admin/api.
 */

/**
 * Both locks (requireAdmin: Access, and the owner's session once there is
 * an owner); then, for the tools that are about accounts, accounts on -
 * 404 accounts_off while they are off, as /api/me/* answers. The audit log
 * asks the locks alone: owner tools write to it with accounts off too.
 */
export function ownerGate(env: Env, data: RequestData, { accounts = true }: { accounts?: boolean } = {}): Response | null {
  const denied = requireAdmin(data);
  if (denied) return denied;
  if (accounts && !accountsOn(env)) return refuse(404, 'accounts_off', 'Accounts are off');
  return null;
}

/** A page of a list, unless ?limit= asks for another size. */
export const PAGE = 50;
/** The most a page may hold. */
export const MAX_PAGE = 100;

/** ?limit=: a whole number from 1 to MAX_PAGE, PAGE when absent; anything else is 400 bad_request {reason: 'limit'}. */
export function pageLimit(params: URLSearchParams): number {
  const raw = params.get('limit');
  if (raw === null || raw === '') return PAGE;
  const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= MAX_PAGE)) {
    throw new HttpError(`limit: a whole number from 1 to ${MAX_PAGE}`, 400, 'bad_request', { reason: 'limit' });
  }
  return n;
}

/**
 * Where a page of a list ends, newest first: the time and the id of its
 * last item, as `<time>.<id>`, which the next page asks for to begin after
 * it. Items with the same time are ordered by id, so none is skipped or
 * shown twice whatever the page size.
 */
export interface Cursor<Id> {
  at: number;
  id: Id;
}

/** A page's cursor, for its last item. */
export const cursorOf = (at: number, id: string | number): string => `${at}.${id}`;

/**
 * A cursor from the query (`name`), null when there is none. A value that
 * is not one - its id not matching `id` - is 400 bad_request with `name`
 * as the reason: it can only have been made up.
 */
export function readCursor(params: URLSearchParams, name: string, id: RegExp): Cursor<string> | null {
  const raw = params.get(name);
  if (raw === null || raw === '') return null;
  const dot = raw.indexOf('.');
  const at = raw.slice(0, dot);
  const rest = raw.slice(dot + 1);
  if (dot < 1 || !/^\d{1,15}$/.test(at) || !id.test(rest)) {
    throw new HttpError(`${name}: not a cursor this list gave`, 400, 'bad_request', { reason: name });
  }
  return { at: Number(at), id: rest };
}
