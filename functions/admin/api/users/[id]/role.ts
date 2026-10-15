import type { Env } from '../../../../_shared/env';
import { answer, api, readBody } from '../../../../_shared/auth/api';
import { ownerGate } from '../../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../../_shared/principal';
import { givenRole, setRole } from '../../../../_shared/users';

// POST /admin/api/users/:id/role {role} - make an account a moderator, who
// reviews the community gallery beside the owner, or a member again
// (docs/accounts.md §13). `role` is 'member' or 'moderator', never the
// owner's (400 bad_request {reason: 'role'}). Answers the account as GET
// /admin/api/users/:id does. 409 owner for the owner's own account, 409
// wrong_status {status} to make one that is not active a moderator, 404
// for none. Both locks, accounts on. Audited (user.role {from, to}).
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, params, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    const role = givenRole((await readBody(request)).role);
    return answer(await setRole(env, String(params.id), role, ownerActor(data)));
  });
