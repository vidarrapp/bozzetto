import type { Env } from '../../../../_shared/env';
import { bodyLimit, error, handle, json, readJson } from '../../../../_shared/http';
import { ownerScope, requireAdmin, type RequestData } from '../../../../_shared/principal';
import {
  MAX_SCENE_PART_BYTES,
  abortSceneUpload,
  completeSceneUpload,
  putScenePart,
  startSceneUpload,
  toManifest,
} from '../../../../_shared/projects';

// A scene project's .bozz file, uploaded in parts (Access-gated):
//
//   POST   /admin/api/projects/:id/scene                     start: { uploadId, partSize }
//   PUT    /admin/api/projects/:id/scene?upload=<u>&part=<n>  one part's bytes: { part, etag }
//   POST   /admin/api/projects/:id/scene?upload=<u>           finish, with JSON { parts, objects, tris }:
//                                                              the project's manifest
//   DELETE /admin/api/projects/:id/scene?upload=<u>           abandon an upload
//
// In parts because a request to a Pages Function is capped at 100 MB and a
// multiresolution scene can pass that; because a dropped connection then
// costs one part rather than the whole file; and because fetch() reports
// no upload progress, so the parts are what the client counts. The file
// already stored stays readable until the new one completes.

const uploadParam = (request: Request): string | null => new URL(request.url).searchParams.get('upload');

export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    const id = String(params.id);
    const scope = ownerScope(data.principal);
    const upload = uploadParam(request);
    if (!upload) return json(await startSceneUpload(env, id, scope), 201);
    // The part list: 10,000 parts of a few dozen bytes each at the most.
    const tooBig = bodyLimit(request, 1024 * 1024);
    if (tooBig) return tooBig;
    return json(toManifest(await completeSceneUpload(env, id, upload, await readJson(request), scope), env));
  });

export const onRequestPut: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    const url = new URL(request.url);
    const upload = url.searchParams.get('upload');
    const part = Number(url.searchParams.get('part'));
    if (!upload) return error('?upload=<id> required', 400);
    // Cap before buffering, as frames.ts does: a runaway part fails fast.
    const tooBig = bodyLimit(request, MAX_SCENE_PART_BYTES, true);
    if (tooBig) return tooBig;
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return error('empty body', 400);
    if (body.byteLength > MAX_SCENE_PART_BYTES) return error('part too large', 413);
    return json(await putScenePart(env, String(params.id), upload, part, body, ownerScope(data.principal)), 201);
  });

export const onRequestDelete: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    const upload = uploadParam(request);
    if (!upload) return error('?upload=<id> required', 400);
    await abortSceneUpload(env, String(params.id), upload, ownerScope(data.principal));
    return json({ aborted: true });
  });
