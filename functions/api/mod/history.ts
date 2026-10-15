import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { answer, api } from '../../_shared/auth/api';
import { requireModerator } from '../../_shared/auth/permissions';
import { reviewHistory } from '../../_shared/community';

// GET /api/mod/history - the History tab (docs/accounts.md §13): {items},
// the reviews and withdrawals of the last 30 days, newest first, at most
// 200, from the audit log. Each is {at, action, actor, auto, project,
// subject, reason}: `action` approve, reject, hide, unhide, dismiss or
// withdraw; `actor` {handle} of who did it (null for a hide the reports
// made, `auto`); `project` {id, title, shared, author} as it is now, null
// once deleted; `reason` what the author was shown, while that review is
// still the project's latest. The owner and moderators alone (401 signin,
// 403 forbidden). Never cached.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, data }) =>
  api(async () => {
    requireModerator(data.principal);
    return answer({ items: await reviewHistory(env, data.now) });
  });
