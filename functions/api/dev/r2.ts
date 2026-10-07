import type { Env } from '../../_shared/env';
import { testHooks } from '../../_shared/env';
import { json, refuse } from '../../_shared/http';

// GET /api/dev/r2?prefix=<prefix> - a test hook: every R2 object under a
// prefix, by key, as {objects: [{key, size}]}, so the suites can see what a
// deletion left (docs/accounts.md §10). Only with DEV_TEST_HOOKS on a
// loopback host, like /api/dev/principal; anywhere else it is not found,
// and production's WAF blocks /api/dev/.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!testHooks(request, env)) return refuse(404, 'not_found', 'Not found');
  const prefix = new URL(request.url).searchParams.get('prefix');
  if (!prefix) return refuse(400, 'bad_request', 'prefix required');
  const objects: { key: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const listing = await env.BUCKET.list({ prefix, cursor });
    for (const o of listing.objects) objects.push({ key: o.key, size: o.size });
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  return json({ objects }, 200, { 'cache-control': 'no-store' });
};
