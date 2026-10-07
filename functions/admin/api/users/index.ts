import type { Env } from '../../../_shared/env';
import { answer, api } from '../../../_shared/auth/api';
import { cursorOf, ownerGate, pageLimit, readCursor } from '../../../_shared/owner';
import type { RequestData } from '../../../_shared/principal';
import { USER_ID, listUsers } from '../../../_shared/users';

// GET /admin/api/users?cursor=&limit= - the Users tab (docs/accounts.md
// §8): accounts, newest first, 50 a page (limit 1-100), as {users, next,
// pendingDeletions}. Each user is {id, handle, email, role, status,
// createdAt, lastSeenAt, bytesUsed, reserved, quotaBytes, projects,
// deletingSince, suspendedReason}: lastSeenAt the latest any session of it
// was seen (null if none), reserved what its uploads in progress hold,
// deletingSince when a deletion began (null unless being deleted). `next`
// is the cursor for the page after (null at the end); pendingDeletions
// counts the accounts whose deletion began over 24 hours ago, which the
// tab flags. A cursor or limit that is not one is 400 bad_request with
// `reason`. Both locks, accounts on.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const page = await listUsers(env, {
      cursor: readCursor(params, 'cursor', USER_ID),
      limit: pageLimit(params),
      now: data.now,
    });
    return answer({
      users: page.users,
      next: page.next ? cursorOf(page.next.at, page.next.id) : null,
      pendingDeletions: page.pendingDeletions,
    });
  });
