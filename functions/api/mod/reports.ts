import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { answer, api } from '../../_shared/auth/api';
import { requireModerator } from '../../_shared/auth/permissions';
import { openReports } from '../../_shared/community';

// GET /api/mod/reports - the Reports tab (docs/accounts.md §13): {items},
// each a project with open reports - {project, reports} - the
// longest-reported first. `project` is as the queue lists one, in whatever
// state it is; `reports` its open reports, oldest first, each {id, reason,
// note, reporter: {handle}, created_at}. The owner and moderators alone
// (401 signin, 403 forbidden). Never cached.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, data }) =>
  api(async () => {
    requireModerator(data.principal);
    return answer({ items: await openReports(env) });
  });
