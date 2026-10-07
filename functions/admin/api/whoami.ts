import type { Env } from '../../_shared/env';
import { error, json } from '../../_shared/http';
import { requireAdmin, type RequestData } from '../../_shared/principal';

// GET /admin/api/whoami — cheap "am I an admin?" probe for the sculpt UI
// and the owner's pages. In production Cloudflare Access intercepts
// unauthenticated requests before this runs (the client treats any
// non-JSON-200 as guest); when a request does get here, the root
// middleware has already applied the same checks as every admin write, and
// this reports what it found: {email, owner}, `owner` being the owner's
// account ({id, handle}) once there is one, and null before the bootstrap
// or while accounts are off. Once there is an owner, Access alone is 403
// owner_session: the owner's session must come too (lock 2).
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ data }) => {
  const p = data.principal;
  if (p.kind !== 'admin') return requireAdmin(data) ?? error('Unauthorized', 403);
  return json({ email: p.email, owner: p.owner ? { id: p.owner.id, handle: p.owner.handle } : null });
};
