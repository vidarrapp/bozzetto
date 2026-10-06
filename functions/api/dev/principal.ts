import type { Env } from '../../_shared/env';
import { testHooks } from '../../_shared/env';
import { json, refuse } from '../../_shared/http';
import type { RequestData } from '../../_shared/principal';

// GET /api/dev/principal — a test hook: who the root middleware decided
// was asking, and the time it read (X-Test-Now). Only with DEV_TEST_HOOKS
// on a loopback host; anywhere else it is not found, as if it were not
// there. Production's WAF blocks /api/dev/ outright as well.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, data }) => {
  if (!testHooks(request, env)) return refuse(404, 'not_found', 'Not found');
  const p = data.principal;
  const principal =
    p.kind === 'admin'
      ? { kind: p.kind, email: p.email, owner: p.owner?.id ?? null }
      : p.kind === 'user'
        ? { kind: p.kind, user: p.user.id, session: p.session.id, recentAuth: p.recentAuth }
        : { kind: p.kind };
  return json({ principal, now: data.now }, 200, { 'cache-control': 'no-store' });
};
