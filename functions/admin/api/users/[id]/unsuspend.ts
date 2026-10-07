import type { Env } from '../../../../_shared/env';
import { answer, api } from '../../../../_shared/auth/api';
import { ownerGate } from '../../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../../_shared/principal';
import { unsuspendUser } from '../../../../_shared/users';

// POST /admin/api/users/:id/unsuspend - lift a suspension (docs/accounts.md
// §8): the account is active again, its reason cleared; its sessions stay
// signed out, so its holder signs in afresh. No body. Answers the account
// as GET /admin/api/users/:id does. 409 wrong_status {status} for an
// account that is not suspended, 404 for none. Both locks, accounts on.
// Audited.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    return answer(await unsuspendUser(env, String(params.id), ownerActor(data)));
  });
