import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { answer, api } from '../../../_shared/auth/api';
import { requireModerator } from '../../../_shared/auth/permissions';
import { authorOf, reviewMediaBase } from '../../../_shared/community';
import { getProjectRow, sharedOf, toManifest } from '../../../_shared/projects';

// GET /api/mod/projects/:id - a shared project's manifest for review
// (docs/accounts.md §13), in any state but not shared: the viewer's
// manifest with its files on the reviewers' private route
// (/api/mod/media/<id>), and {shared, shared_at, review_reason, author:
// {handle}} beside it. A project not shared, a template or none at all is
// 404 not_found. The owner and moderators alone (401 signin, 403
// forbidden). Never cached.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    requireModerator(data.principal);
    const id = String(params.id);
    const row = await getProjectRow(env, id, { reviewer: true });
    if (!row) throw new HttpError('Not found', 404, 'not_found');
    const manifest = toManifest(row, env, reviewMediaBase(id)) as object;
    return answer({ ...manifest, ...sharedOf(row), review_reason: row.review_reason, author: await authorOf(env, row) });
  });
