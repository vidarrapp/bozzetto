import type { Env } from '../../../_shared/env';
import { bodyLimit, handle, json, readJson } from '../../../_shared/http';
import { ownerScope, requireAdmin, type RequestData } from '../../../_shared/principal';
import { createProject, listProjects, toOwnerRow } from '../../../_shared/projects';

// GET /admin/api/projects — every template and the owner's own projects,
// private ones and scenes included, each with its visibility and whether
// it is a template (Access-gated).
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    return json(await listProjects(env, ownerScope(data.principal)));
  });

// POST /admin/api/projects — create a project (Access-gated). A scene
// (mode 'scene') may leave out its id, which the server then picks, and
// starts private; everything else starts public unless asked otherwise,
// and a public project is a template.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    const tooBig = bodyLimit(request, 64 * 1024); // id, title, mode, fps, visibility
    if (tooBig) return tooBig;
    return json(toOwnerRow(await createProject(env, await readJson(request), ownerScope(data.principal)), env), 201);
  });
