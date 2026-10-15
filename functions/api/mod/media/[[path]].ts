import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { handle } from '../../../_shared/http';
import { notFound, pathSegments, serveMedia } from '../../../_shared/media';
import { isReviewer } from '../../../_shared/auth/permissions';

// GET /api/mod/media/<id>/<file> - a shared project's files for a reviewer
// (docs/accounts.md §13), in any state but not shared: a frame, the
// thumbnail. `private, no-store`, CORP same-origin, never a download, as
// the private routes serve (_shared/media.ts). Anyone but the owner or a
// moderator, signed in or not, gets the same bare 404 as a project that is
// not there.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, params, data, waitUntil }) =>
  handle(async () => {
    const p = data.principal;
    if (p.kind !== 'user' || !isReviewer(p.user)) return notFound();
    return serveMedia({ request, env, waitUntil }, pathSegments(params.path), { reviewer: true });
  });
