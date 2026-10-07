import type { Env } from '../../../../_shared/env';
import { answer, api } from '../../../../_shared/auth/api';
import { ownerGate } from '../../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../../_shared/principal';
import { recountUser } from '../../../../_shared/users';

// POST /admin/api/users/:id/recount - count an account's storage again
// from R2 (docs/accounts.md §4, §8), for when a failure between R2 and D1
// left it wrong: {bytesUsed, before}, what it uses now and what the
// account said before. Its uploads in progress are left as they are. No
// body. 404 for no account. Both locks, accounts on. Audited with both.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    return answer(await recountUser(env, String(params.id), ownerActor(data)));
  });
