import type { Env } from '../_shared/env';
import { handle } from '../_shared/http';
import { pathSegments, serveMedia } from '../_shared/media';

// GET /media/<id>/<file> — the files of a template the gallery lists, under
// the name the apps installed before /m/ reach: 0.5's mediaPath() builds
// it, and manifests name it while there is no files host, since the 0.5
// desktop app's proxy passes /api, /admin/api and /media alone. It is /m/'s
// handler under the old name, with the same answers and headers
// (docs/accounts.md §4), until 0.7 drops it. Anything else's files are a
// 404 here whoever asks.
// NB: deliberately /media (not /assets) so it never shadows Vite's built
// /assets/* bundles or the matcap.
export const onRequestGet: PagesFunction<Env> = ({ request, env, params, waitUntil }) =>
  handle(() => serveMedia({ request, env, waitUntil }, pathSegments(params.path), 'public'));
