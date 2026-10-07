import type { Env } from '../../_shared/env';
import { notYet } from '../../_shared/http';

// /api/auth/* routes still to come (Batch 4: email codes, registration,
// invites): 501 not_implemented, so a staging run never mistakes a stub
// for a refusal. Accounts off, the middleware beside this has already
// answered 404 accounts_off; and the root one has refused a cross-site
// write, as it will for the real routes.
export const onRequest: PagesFunction<Env> = ({ env }) => notYet(env);
