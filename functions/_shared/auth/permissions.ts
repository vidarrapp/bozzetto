import type { Principal, UserPrincipal } from '../principal';
import { HttpError } from '../http';
import { requireUser } from './api';

/**
 * What a role may do beyond its own projects (docs/accounts.md §2, Roles;
 * §13). Phase 1 needed no map; phase 3 brings the first route that is not
 * every account's: reviewing the community gallery (`content.moderate`).
 *
 * - owner: everything, reviewing included;
 * - moderator: reviewing, plus its own projects;
 * - member: its own projects.
 *
 * The reviewer routes are /api/mod/*, on the app session alone: moderators
 * have no Access identity, so they are not under /admin.
 */

/** The roles that may review the community gallery. */
const REVIEWERS = new Set(['owner', 'moderator']);

/**
 * The signed-in account asking, if it may review: an active owner or
 * moderator. Signed out is 401 signin (403 suspended for a suspended
 * account's cookie), as requireUser answers; any other account is 403
 * forbidden. A principal is only ever a user while its account is active
 * (an account being deleted reaches its deletion alone), so the status
 * needs no second look, but it is checked all the same.
 */
export function requireModerator(principal: Principal): UserPrincipal {
  const p = requireUser(principal);
  if (!REVIEWERS.has(p.user.role) || p.user.status !== 'active') {
    throw new HttpError('Only reviewers may do this', 403, 'forbidden');
  }
  return p;
}

/** Whether an account may review, for the answers that only say so. */
export const isReviewer = (user: { role: string; status: string }): boolean =>
  REVIEWERS.has(user.role) && user.status === 'active';
