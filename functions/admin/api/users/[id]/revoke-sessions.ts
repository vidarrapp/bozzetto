import type { Env } from '../../../../_shared/env';
import { answer, api } from '../../../../_shared/auth/api';
import { ownerGate } from '../../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../../_shared/principal';
import { revokeUserSessions } from '../../../../_shared/users';

// POST /admin/api/users/:id/revoke-sessions - sign an account out
// everywhere (docs/accounts.md §8): {revoked}, how many good sessions
// were. No body. 409 owner for the owner's own account (Account signs
// that out everywhere), 404 for none. Both locks, accounts on. Audited.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    return answer({ revoked: await revokeUserSessions(env, String(params.id), ownerActor(data)) });
  });
