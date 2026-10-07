import type { Env } from '../../_shared/env';
import { testHooks } from '../../_shared/env';
import { json, refuse } from '../../_shared/http';

// GET /api/dev/audit?subject=<id> — a test hook: the audit rows about one
// subject, oldest first, as stored. Owner tools list the log for real
// (Batch 6); until then the suites read what a route recorded here. Only
// with DEV_TEST_HOOKS on a loopback host, like /api/dev/principal;
// anywhere else it is not found, and production's WAF blocks /api/dev/.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!testHooks(request, env)) return refuse(404, 'not_found', 'Not found');
  const subject = new URL(request.url).searchParams.get('subject');
  if (!subject) return refuse(400, 'bad_request', 'subject required');
  const { results } = await env.DB.prepare(
    'SELECT at, actor, action, subject, detail FROM audit_log WHERE subject = ? ORDER BY id',
  )
    .bind(subject)
    .all<{ at: number; actor: string; action: string; subject: string; detail: string }>();
  const rows = results.map((r) => ({ ...r, detail: JSON.parse(r.detail) as unknown }));
  return json({ rows }, 200, { 'cache-control': 'no-store' });
};
