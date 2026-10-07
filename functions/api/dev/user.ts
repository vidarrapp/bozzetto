import type { Env } from '../../_shared/env';
import type { UserRow } from '../../_shared/types';
import { testHooks } from '../../_shared/env';
import { json, refuse } from '../../_shared/http';

// GET /api/dev/user?id=<id> | ?email=<address> - a test hook: an account's
// users row as stored, {user} or {user: null}, so the suites can see what
// a registration or a change wrote that no API shows (the terms and age
// dates, the invite). Only with DEV_TEST_HOOKS on a loopback host, like
// /api/dev/principal; anywhere else it is not found, and production's WAF
// blocks /api/dev/.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!testHooks(request, env)) return refuse(404, 'not_found', 'Not found');
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const email = params.get('email');
  if (!id && !email) return refuse(400, 'bad_request', 'id or email required');
  const user = id
    ? await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
    : await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  return json({ user: user ?? null }, 200, { 'cache-control': 'no-store' });
};
