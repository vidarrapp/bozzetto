import type { Env } from '../../../../_shared/env';
import { bodyLimit, error, handle, json } from '../../../../_shared/http';
import { ownerScope, requireAdmin, type RequestData } from '../../../../_shared/principal';
import { toManifest } from '../../../../_shared/projects';
import { MAX_ARMATURE_BODY, putArmatureFile } from '../../../../_shared/armatureFile';

// POST /admin/api/projects/:id/armature - an armature project's file
// (Access-gated), as /api/me takes one: the same checks, since a template
// reaches every visitor (415, 422 bad_armature, 413 past 4 MiB), and no
// quota. Answers the project's manifest.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    const tooBig = bodyLimit(request, MAX_ARMATURE_BODY, true);
    if (tooBig) return tooBig;
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return error('empty body', 400);
    const row = await putArmatureFile(env, { kind: 'owner', scope: ownerScope(data.principal) }, String(params.id), body, data.now);
    return json(toManifest(row, env));
  });
