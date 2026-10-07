import type { Env } from '../../../_shared/env';
import { handle } from '../../../_shared/http';
import { notFound, pathSegments, serveMedia } from '../../../_shared/media';
import { ownerScope, type RequestData } from '../../../_shared/principal';

// GET /admin/api/media/<id>/<file> — the owner's way to a project's files,
// private ones included: templates and the owner's own (docs/accounts.md
// §4). It lives under /admin so the Access application fronts it: the
// session cookie is checked before this runs, and the identity the root
// middleware read is one Access vouched for. Without one it answers as
// /media does for a private project - not found - so the two routes
// refuse alike.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, params, data, waitUntil }) =>
  handle(async () => {
    if (data.principal.kind !== 'admin') return notFound();
    return serveMedia({ request, env, waitUntil }, pathSegments(params.path), ownerScope(data.principal));
  });
