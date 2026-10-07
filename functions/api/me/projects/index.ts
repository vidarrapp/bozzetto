import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { answer, api, readBody, requireUser } from '../../../_shared/auth/api';
import { createMemberProject, listMemberProjects, toMemberRow } from '../../../_shared/projects';

// GET /api/me/projects - the account's own projects, newest first (My
// projects, docs/accounts.md §4, §7): each as the gallery lists a project
// - {id, title, mode, fps, updated_at, visibility, template, frameCount,
// scene, media} - with `bytes`, what its files weigh against the quota,
// and `media` the private route its files are read from
// (/api/me/media/<id>). Never anyone else's; never cached.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, data }) =>
  api(async () => answer(await listMemberProjects(env, requireUser(data.principal).user.id)));

// POST /api/me/projects {title?, mode?, fps?} - a new project of the
// account's own: mode 'timelapse' (the default), 'model' or 'scene'; the
// id is the server's (p- and 26 base32 characters, any given is ignored),
// and it is private (`visibility: 'public'` is a 400). An account holds at
// most 500 (400 with `limit`). Answers 201 with the row as owner tools
// answer one, its `media` on the private route, and its `bytes`.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    const row = await createMemberProject(env, user.id, await readBody(request), data.now);
    return answer(toMemberRow(row, env), 201);
  });
