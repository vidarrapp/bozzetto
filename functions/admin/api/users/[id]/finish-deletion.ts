import type { Env } from '../../../../_shared/env';
import { answer, api } from '../../../../_shared/auth/api';
import { ownerGate } from '../../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../../_shared/principal';
import { finishDeletion } from '../../../../_shared/users';

// POST /admin/api/users/:id/finish-deletion - carry on a deletion its
// account began and left (docs/accounts.md §3, §8), as far as one
// request's subrequests allow: {done: false, remaining} until {done:
// true}, when the account is gone; call again until then. No body. 409
// owner for the owner's own account, 409 wrong_status {status} for one
// whose deletion has not begun, 404 for none (a deletion that is done
// included). Both locks, accounts on. Each call audited.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    return answer(await finishDeletion(env, String(params.id), ownerActor(data)));
  });
