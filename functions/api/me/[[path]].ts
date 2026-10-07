import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { notYet } from '../../_shared/http';
import { meOf } from '../../_shared/auth/account';
import { answer, api, requireUser } from '../../_shared/auth/api';

// GET /api/me - the signed-in account (docs/accounts.md §3): {id, handle,
// role, status, usage: {used, reserved, quota}}, reserved being what its
// uploads in progress hold. No address: this is what the client keeps.
// Signed out (or expired, suspended, or being deleted): 401 signin.
//
// It is answered here, not in an index.ts, because Pages tries a catch-all
// with more segments first, and /api/me/[[path]] matches /api/me itself.
// Every other /api/me/* path without a route of its own is one still to
// come (Batches 4-5: email change, projects, media, export, deletion) and
// answers 501 not_implemented; with accounts off, the middleware beside
// this has answered 404 accounts_off before either.
export const onRequest: PagesFunction<Env, string, RequestData> = ({ request, env, params, data }) => {
  const path = params.path;
  const root = path === undefined || path === '' || (Array.isArray(path) && path.length === 0);
  if (root && request.method === 'GET') {
    return api(async () => answer(await meOf(env, requireUser(data.principal).user)));
  }
  return notYet(env);
};
