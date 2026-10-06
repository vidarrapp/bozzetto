import type { Env } from '../../_shared/env';
import { notYet } from '../../_shared/http';

// /api/auth/* — signing in, joining, signing out (docs/accounts.md §3).
// Until Batches 3 and 4 bring the routes: 404 accounts_off with accounts
// off, 501 with them on. Any method: the root middleware has already
// refused a cross-site write, as it will for the real routes.
export const onRequest: PagesFunction<Env> = ({ env }) => notYet(env);
