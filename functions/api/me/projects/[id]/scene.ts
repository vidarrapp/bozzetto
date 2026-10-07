import type { Env } from '../../../../_shared/env';
import type { RequestData } from '../../../../_shared/principal';
import { HttpError, bodyLimit } from '../../../../_shared/http';
import { answer, api, readBody, requireUser } from '../../../../_shared/auth/api';
import { memberMediaBase, toManifest } from '../../../../_shared/projects';
import {
  MAX_SCENE_PART_BYTES,
  abortSceneUpload,
  completeSceneUpload,
  putScenePart,
  startSceneUpload,
  type Uploader,
} from '../../../../_shared/uploads';

// A scene project's .bozz file, uploaded in parts, as owner tools upload
// one (docs/accounts.md §4), held to the account's quota:
//
//   POST   /api/me/projects/:id/scene {size}                  start: 201 {uploadId, partSize}
//   PUT    /api/me/projects/:id/scene?upload=<u>&part=<n>     one part's bytes: 201 {part, etag}
//   POST   /api/me/projects/:id/scene?upload=<u>              finish, with JSON {parts, objects, tris}:
//                                                             the project's manifest
//   DELETE /api/me/projects/:id/scene?upload=<u>              abandon an upload: {aborted: true}
//
// `size` is the file's size in bytes, at most 100 MiB (413 file_too_large),
// and it must fit the quota (413 quota_exceeded {used, quota}). Parts come
// in order of R2's rules: part 1 first, every one but the last `partSize`
// (8 MiB) or the size part 1 was, at most 32 MiB, the last the rest. Part
// 1 is checked as a scene (415 bad_type, 422 bad_scene {reason}) and the
// last part's gzip trailer against its header (422); each is admitted
// against the quota before R2 sees it (413 quota_exceeded), and one sent
// again replaces its own reservation. Finishing takes every part, 1 to the
// last, with the etags R2 gave them; the file's bytes then count against
// the quota instead of the parts'. The file already stored stays readable
// until the new one completes. Another account's project, or upload, is
// 404 not_found.

const uploadParam = (request: Request): string | null => new URL(request.url).searchParams.get('upload');
const member = (data: RequestData): Uploader => ({ kind: 'member', user: requireUser(data.principal).user });

export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  api(async () => {
    const who = member(data);
    const id = String(params.id);
    const upload = uploadParam(request);
    if (!upload) return answer(await startSceneUpload(env, who, id, await readBody(request), data.now), 201);
    // The part list: 10,000 parts of a few dozen bytes each at the most.
    const body = await readBody(request, { max: 1024 * 1024 });
    const row = await completeSceneUpload(env, who, id, upload, body, data.now);
    return answer(toManifest(row, env, memberMediaBase(row.id)));
  });

export const onRequestPut: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  api(async () => {
    const who = member(data);
    const url = new URL(request.url);
    const upload = url.searchParams.get('upload');
    const raw = url.searchParams.get('part');
    const part = raw !== null && /^\d{1,5}$/.test(raw) ? Number(raw) : -1;
    if (!upload) throw new HttpError('?upload=<id> required', 400, 'bad_request');
    // Cap before buffering: a runaway part fails fast.
    const tooBig = bodyLimit(request, MAX_SCENE_PART_BYTES, true);
    if (tooBig) throw new HttpError('A part may be at most 32 MiB', tooBig.status, tooBig.status === 411 ? 'bad_request' : 'file_too_large');
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) throw new HttpError('empty body', 400, 'bad_request');
    if (body.byteLength > MAX_SCENE_PART_BYTES) throw new HttpError('A part may be at most 32 MiB', 413, 'file_too_large');
    return answer(await putScenePart(env, who, String(params.id), upload, part, body), 201);
  });

export const onRequestDelete: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  api(async () => {
    await abortSceneUpload(env, member(data), String(params.id), uploadParam(request));
    return answer({ aborted: true });
  });
