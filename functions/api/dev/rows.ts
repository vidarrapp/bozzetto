import type { Env } from '../../_shared/env';
import { testHooks } from '../../_shared/env';
import { json, refuse } from '../../_shared/http';

// GET /api/dev/rows?user=<id> - a test hook: how many rows of each table
// still name an account, as {users, projects, credentials, sessions,
// pendingAuth, invites, pendingUploads, uploadParts, audit}, so the suites
// can see what a deletion left. Only with DEV_TEST_HOOKS on a loopback
// host, like /api/dev/principal; anywhere else it is not found, and
// production's WAF blocks /api/dev/.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!testHooks(request, env)) return refuse(404, 'not_found', 'Not found');
  const user = new URL(request.url).searchParams.get('user');
  if (!user) return refuse(400, 'bad_request', 'user required');
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM users WHERE id = ?1) AS users,
            (SELECT COUNT(*) FROM projects WHERE owner_id = ?1) AS projects,
            (SELECT COUNT(*) FROM credentials WHERE user_id = ?1) AS credentials,
            (SELECT COUNT(*) FROM sessions WHERE user_id = ?1) AS sessions,
            (SELECT COUNT(*) FROM pending_auth WHERE user_id = ?1) AS pendingAuth,
            (SELECT COUNT(*) FROM invites WHERE created_by = ?1) AS invites,
            (SELECT COUNT(*) FROM pending_uploads WHERE user_id = ?1) AS pendingUploads,
            (SELECT COUNT(*) FROM upload_parts WHERE user_id = ?1) AS uploadParts,
            (SELECT COUNT(*) FROM audit_log WHERE subject = ?1 OR actor = ?1) AS audit`,
  )
    .bind(user)
    .first();
  return json(counts, 200, { 'cache-control': 'no-store' });
};
