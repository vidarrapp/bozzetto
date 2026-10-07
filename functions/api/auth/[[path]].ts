import type { Env } from '../../_shared/env';
import { refuse } from '../../_shared/http';

// /api/auth/* paths with no route of their own, and routes asked with a
// method they do not answer: 404 not_found. Every route phase 1 has under
// /api/auth is there (docs/accounts.md §3); accounts off, the middleware
// beside this has already answered 404 accounts_off, and the root one has
// refused a cross-site write, as for the real routes.
export const onRequest: PagesFunction<Env> = () => refuse(404, 'not_found', 'Not found');
