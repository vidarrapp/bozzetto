import type { Env } from '../env';
import { accountsOn } from '../env';
import { refuse } from '../http';

/**
 * What /api/auth/* and /api/me/* answer before any of their routes runs
 * (their _middleware.ts): 404 accounts_off while accounts are off, every
 * path and method alike, so none of them is there until the switch; and
 * no-store on whatever a route answers once they are on, since all of it
 * is someone's own (a sign-in, an account), unless the route said
 * otherwise.
 */
export const accountsGate: PagesFunction<Env> = async ({ env, next }) => {
  if (!accountsOn(env)) return refuse(404, 'accounts_off', 'Accounts are off');
  const res = await next();
  if (res.headers.has('cache-control')) return res;
  // A copy: a response can come back with headers that cannot be changed.
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'no-store');
  return out;
};
