import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { handle } from '../../../_shared/http';
import { notFound, pathSegments, serveMedia } from '../../../_shared/media';

// GET /api/me/media/<id>/<file>[?download=1] - a file of one of the
// account's own projects (docs/accounts.md §4): its scene, its thumbnail
// or a frame (frames/sd/0003.glb), to the row's owner alone (`WHERE id = ?
// AND owner_id = ?`). Typed by the file's name, nosniff, sandboxed,
// `private, no-store`, CORP same-origin; a scene is a download named after
// its project, and so is any file with ?download=1. Range and conditional
// requests are answered as on /m/. A file that is missing, anyone else's,
// or asked for without a session is the same 404.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, params, data, waitUntil }) =>
  handle(async () => {
    const p = data.principal;
    if (p.kind !== 'user') return notFound();
    return serveMedia({ request, env, waitUntil }, pathSegments(params.path), { member: p.user.id });
  });
