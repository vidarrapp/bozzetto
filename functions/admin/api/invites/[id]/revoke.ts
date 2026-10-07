import type { Env } from '../../../../_shared/env';
import { answer, api } from '../../../../_shared/auth/api';
import { revokeInvite } from '../../../../_shared/auth/invites';
import { ownerGate } from '../../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../../_shared/principal';

// POST /admin/api/invites/:id/revoke - withdraw an invite (docs/accounts.md
// §8): it admits nobody from now on; the accounts it made are untouched.
// Answers the invite as the list shows it, state `revoked`; withdrawing
// one again answers it as it is, changing and recording nothing. No body.
// An unknown id is 404 not_found. Both locks, accounts on. Audited.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    return answer(await revokeInvite(env, String(params.id), ownerActor(data)));
  });
