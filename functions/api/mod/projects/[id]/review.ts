import type { Env } from '../../../../_shared/env';
import type { RequestData } from '../../../../_shared/principal';
import { answer, api, readBody } from '../../../../_shared/auth/api';
import { requireModerator } from '../../../../_shared/auth/permissions';
import { reviewProject } from '../../../../_shared/community';

// POST /api/mod/projects/:id/review {action, reason?} - a reviewer's
// decision (docs/accounts.md §13): approve (pending → public), reject
// {reason} (pending → rejected), hide {reason} (public → hidden), unhide
// (hidden → public, its open reports dismissed) or dismiss (the open
// reports of a pending or public project, closed). A reason is 1-500
// characters, shown to the author. Answers {id, shared, shared_at,
// reviewed_at, review_reason}. 409 wrong_state {shared} for an action the
// project's state does not allow, 400 reason own on the reviewer's own
// project, 404 for one not shared. The owner and moderators alone (401
// signin, 403 forbidden). Audited, with the action, not the reason.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, params, data }) =>
  api(async () => {
    const { user } = requireModerator(data.principal);
    const row = await reviewProject(env, user, String(params.id), await readBody(request), data.now);
    const { id, shared, shared_at, reviewed_at, review_reason } = row;
    return answer({ id, shared, shared_at, reviewed_at, review_reason });
  });
