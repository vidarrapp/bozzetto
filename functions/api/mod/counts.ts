import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { answer, api } from '../../_shared/auth/api';
import { requireModerator } from '../../_shared/auth/permissions';
import { reviewCounts } from '../../_shared/community';

// GET /api/mod/counts - what the Review chip shows (docs/accounts.md §13):
// {pending, reports}, the projects waiting for review and the projects
// with open reports. The owner and moderators alone: signed out 401
// signin, anyone else 403 forbidden. Never cached.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, data }) =>
  api(async () => {
    requireModerator(data.principal);
    return answer(await reviewCounts(env));
  });
