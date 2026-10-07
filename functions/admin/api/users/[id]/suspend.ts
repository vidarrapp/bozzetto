import type { Env } from '../../../../_shared/env';
import { answer, api, readBody } from '../../../../_shared/auth/api';
import { ownerGate } from '../../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../../_shared/principal';
import { suspendUser, suspensionReason } from '../../../../_shared/users';

// POST /admin/api/users/:id/suspend {reason} - suspend an active account
// (docs/accounts.md §8): every session of it signed out, its uploads in
// progress given up, its holder mailed the reason (1-500 characters, else
// 400 bad_request {reason: 'reason'}); its work is kept, and its cookies
// answer 403 suspended until it is lifted. Answers the account as GET
// /admin/api/users/:id does. 409 owner for the owner's own account, 409
// wrong_status {status} for one that is not active, 404 for none. Both
// locks, accounts on. Audited, without the reason.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, params, data, waitUntil }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    const reason = suspensionReason((await readBody(request)).reason);
    const user = await suspendUser(env, { request, now: data.now, waitUntil }, String(params.id), reason, ownerActor(data));
    return answer(user);
  });
