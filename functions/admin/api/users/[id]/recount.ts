import type { Env } from '../../../../_shared/env';
import { answer, api } from '../../../../_shared/auth/api';
import { ownerGate } from '../../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../../_shared/principal';
import { recountUser } from '../../../../_shared/users';

// POST /admin/api/users/:id/recount - count an account's storage again
// from R2 (docs/accounts.md §4, §8), for when a failure between R2 and D1
// left it wrong, or its rows predate the counting: every project's bytes,
// and the account's usage as their sum. {bytesUsed, before, next}: what it
// uses now, what the account said before, and - since one request lists
// only so much (RECOUNT_LISTINGS) - null once every project is counted,
// else the id to ask again after, as ?after=<next>. Its uploads in
// progress are left as they are. No body. 404 for no account. Both locks,
// accounts on. Audited, each call, with before and after.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, params, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    const after = new URL(request.url).searchParams.get('after') || null;
    return answer(await recountUser(env, String(params.id), ownerActor(data), after));
  });
