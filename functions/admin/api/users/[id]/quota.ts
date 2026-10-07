import type { Env } from '../../../../_shared/env';
import { answer, api, readBody } from '../../../../_shared/auth/api';
import { ownerGate } from '../../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../../_shared/principal';
import { quotaMiB, setQuota } from '../../../../_shared/users';

// PUT /admin/api/users/:id/quota {quotaMiB} - an account's quota, in MiB
// (docs/accounts.md §4, §8): a whole number from 1 to 102400 (100 GiB),
// else 400 bad_request {reason: 'quotaMiB'}. The owner's own may be set
// too. A quota below what the account holds keeps what it holds and takes
// no more. Answers the account as GET /admin/api/users/:id does; 404 for
// none. Both locks, accounts on. Audited with the old and new quota.
export const onRequestPut: PagesFunction<Env, string, RequestData> = ({ request, env, params, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    const mib = quotaMiB((await readBody(request)).quotaMiB);
    return answer(await setQuota(env, String(params.id), mib, ownerActor(data)));
  });
