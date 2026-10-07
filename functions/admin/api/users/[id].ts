import type { Env } from '../../../_shared/env';
import { HttpError } from '../../../_shared/http';
import { answer, api } from '../../../_shared/auth/api';
import { ownerGate } from '../../../_shared/owner';
import type { RequestData } from '../../../_shared/principal';
import { userDetail } from '../../../_shared/users';

// GET /admin/api/users/:id - one account (docs/accounts.md §8): what the
// list says of it, and `passkeys` and `sessions`, how many passkeys it
// has and how many of its sessions are good now. 404 not_found when there
// is no such account. Both locks, accounts on.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    const user = await userDetail(env, String(params.id), data.now);
    if (!user) throw new HttpError('Not found', 404, 'not_found');
    return answer(user);
  });
