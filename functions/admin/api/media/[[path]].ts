import type { Env } from '../../../_shared/types';
import { adminEmail, handle } from '../../../_shared/http';
import { pathSegments, serveMedia } from '../../../_shared/media';

// GET /admin/api/media/<id>/<file> — the owner's way to a project's files,
// private ones included. It lives under /admin so the Access application
// fronts it: the session cookie is checked before this runs, and the
// identity adminEmail reads is one Access vouched for. Without a session
// it answers as /media does for a private project - not found - so the
// two routes refuse alike.
export const onRequestGet: PagesFunction<Env> = ({ env, request, params }) =>
  handle(async () => {
    const owner = (await adminEmail(request, env)) !== null;
    if (!owner) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    return serveMedia(env, pathSegments(params.path), true);
  });
