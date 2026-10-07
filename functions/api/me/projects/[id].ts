import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { answer, api, readBody, requireUser } from '../../../_shared/auth/api';
import {
  MAX_DATA_BYTES,
  checkMemberPatch,
  getProjectRow,
  memberMediaBase,
  orphanedFrames,
  patched,
  toManifest,
  toMemberRow,
  updateMemberProject,
} from '../../../_shared/projects';
import { deleteFrames, deleteMemberProject, projectFor } from '../../../_shared/uploads';

// GET /api/me/projects/:id - one of the account's projects as owner tools'
// manifest gives one, its files on the private route
// (/api/me/media/<id>/...). Anyone else's, a template included, is 404
// not_found, as one that is not there.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    const id = String(params.id);
    const row = await getProjectRow(env, id, { member: user.id });
    if (!row) throw new HttpError('Not found', 404, 'not_found');
    return answer(toManifest(row, env, memberMediaBase(id)));
  });

// PUT /api/me/projects/:id - update it as owner tools update one (title,
// mode between timelapse and model, fps, the look, stages, frames), with
// the same checks; fields left out are kept. It stays private:
// `visibility: 'public'` is a 400. Frames a new frame list leaves out are
// deleted, and what they weighed comes off the quota. Answers the row as
// POST does.
export const onRequestPut: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    // The stored row is capped below MAX_DATA_BYTES, so a patch declared
    // past twice that cannot succeed and need not be parsed.
    const patch = await readBody(request, { max: MAX_DATA_BYTES * 2 });
    const row = await projectFor(env, { kind: 'member', user }, String(params.id));
    checkMemberPatch(patch);
    const p = patched(row, patch);
    const freed = await deleteFrames(env, row, orphanedFrames(patch, p));
    return answer(toMemberRow(await updateMemberProject(env, row, p, freed, data.now), env));
  });

// DELETE /api/me/projects/:id - delete it: its uploads in progress given
// up, every file under it, then the row, its bytes back to the account.
// Answers {deleted: true}.
export const onRequestDelete: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    await deleteMemberProject(env, user, String(params.id));
    return answer({ deleted: true });
  });
