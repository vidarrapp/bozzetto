import type { Env } from '../../_shared/env';
import { testHooks } from '../../_shared/env';
import { json, refuse } from '../../_shared/http';

// GET /api/dev/outbox?to=<address> - a test hook: what the stub mailer
// wrote to dev_outbox for one address, oldest first, as {rows: [{id, at,
// to, subject, body}]}; without `to`, the latest 100 for anyone. The stub
// writes there on a loopback host without RESEND_API_KEY
// (functions/_shared/auth/mail.ts), so the suites and the e2e run read
// codes here. Only with DEV_TEST_HOOKS on a loopback host, like
// /api/dev/principal; anywhere else it is not found, and production's WAF
// blocks /api/dev/.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!testHooks(request, env)) return refuse(404, 'not_found', 'Not found');
  const to = new URL(request.url).searchParams.get('to');
  const query = to
    ? env.DB.prepare('SELECT id, at, to_addr, subject, body FROM dev_outbox WHERE to_addr = ? COLLATE NOCASE ORDER BY id').bind(to)
    : env.DB.prepare('SELECT * FROM (SELECT id, at, to_addr, subject, body FROM dev_outbox ORDER BY id DESC LIMIT 100) ORDER BY id');
  const { results } = await query.all<{ id: number; at: number; to_addr: string; subject: string; body: string }>();
  const rows = results.map((r) => ({ id: r.id, at: r.at, to: r.to_addr, subject: r.subject, body: r.body }));
  return json({ rows }, 200, { 'cache-control': 'no-store' });
};
