import type { Env } from '../../_shared/env';
import { notYet } from '../../_shared/http';

// /api/me and /api/me/* — the signed-in account and its projects
// (docs/accounts.md §3-4). Until Batches 3 to 5 bring the routes: 404
// accounts_off with accounts off, 501 with them on. Any method: the root
// middleware has already refused a cross-site write, as it will for the
// real routes.
export const onRequest: PagesFunction<Env> = ({ env }) => notYet(env);
