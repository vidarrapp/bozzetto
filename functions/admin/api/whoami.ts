import type { Env } from '../../_shared/env';
import { error, json } from '../../_shared/http';
import type { RequestData } from '../../_shared/principal';

// GET /admin/api/whoami — cheap "am I an admin?" probe for the sculpt UI.
// In production Cloudflare Access intercepts unauthenticated requests
// before this runs (the client treats any non-JSON-200 as guest); when a
// request does get here, the root middleware has already applied the same
// allowlist check as every admin write, and this reports what it found.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ data }) => {
  const p = data.principal;
  return p.kind === 'admin' ? json({ email: p.email }) : error('Unauthorized', 403);
};
