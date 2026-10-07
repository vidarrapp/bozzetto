import type { Env } from '../_shared/env';
import { handle } from '../_shared/http';
import { pathSegments, serveMedia } from '../_shared/media';

// GET /m/<id>/<file> — a public template's files: a frame
// (frames/sd/0000.glb), its thumbnail or its scene file, to anyone, on the
// files host (MEDIA_ORIGIN, where nothing else is answered) and on the
// app's own host alike (docs/accounts.md §4). The row decides: a template
// the gallery lists, or the same 404 as for a project that is not there.
// Cacheable at the version manifests name (?v=), readable by the app's
// pages from the files host; see _shared/media.ts.
export const onRequestGet: PagesFunction<Env> = ({ request, env, params, waitUntil }) =>
  handle(() => serveMedia({ request, env, waitUntil }, pathSegments(params.path), 'public'));
