import type { Env } from '../../_shared/types';
import { adminEmail, error, handle, json } from '../../_shared/http';

// GET /admin/api/whoami — cheap "am I an admin?" probe for the sculpt UI.
// In production Cloudflare Access intercepts unauthenticated requests
// before this runs (the client treats any non-JSON-200 as guest); when a
// request does get here, the same allowlist check as every admin write
// applies.
export const onRequestGet: PagesFunction<Env> = ({ env, request }) =>
  handle(async () => {
    const email = await adminEmail(request, env);
    return email ? json({ email }) : error('Unauthorized', 403);
  });
