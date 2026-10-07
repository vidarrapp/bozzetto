import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { auditStatement } from '../../../_shared/auth/audit';
import { PASSKEY_COLUMNS, cleanPasskeyName, passkeyOf, type PasskeyFields } from '../../../_shared/auth/account';
import { answer, api, noContent, readBody, requireRecentAuth, requireUser } from '../../../_shared/auth/api';
import { notify } from '../../../_shared/auth/notify';

// PATCH /api/me/passkeys/:id {name} - rename one of the account's passkeys:
// trimmed, cut to 64 characters, and not empty (400). Answers {passkey}.
// Anyone else's, or none, is 404 not_found.
export const onRequestPatch: PagesFunction<Env, string, RequestData> = ({ request, env, params, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    const name = cleanPasskeyName((await readBody(request)).name);
    if (!name) throw new HttpError('name: expected a name', 400, 'bad_request');
    const row = await env.DB.prepare(
      `UPDATE credentials SET name = ? WHERE id = ? AND user_id = ? RETURNING ${PASSKEY_COLUMNS}`,
    )
      .bind(name, String(params.id), user.id)
      .first<PasskeyFields>();
    if (!row) throw new HttpError('Not found', 404, 'not_found');
    return answer({ passkey: passkeyOf(row) });
  });

// DELETE /api/me/passkeys/:id - remove one of the account's passkeys
// (docs/accounts.md §3). It needs recent authentication (401 reauth). The
// last one may go too: the account then signs in by email code. Audited,
// and the holder is told (mail, Batch 4). 204; anyone else's is 404.
export const onRequestDelete: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const { user } = requireRecentAuth(data.principal);
    const id = String(params.id);
    const [, removed] = await env.DB.batch([
      // Ahead of the delete, in the same batch: written exactly when there
      // is a passkey of the account's for it to remove.
      auditStatement(
        env,
        { actor: user.id, action: 'passkey.remove', subject: user.id, at: data.now, detail: { credential: id } },
        { sql: 'SELECT 1 FROM credentials WHERE id = ? AND user_id = ?', binds: [id, user.id] },
      ),
      env.DB.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').bind(id, user.id),
    ]);
    if (!removed.meta.changes) throw new HttpError('Not found', 404, 'not_found');
    await notify(env, user, 'passkey.removed');
    return noContent();
  });
