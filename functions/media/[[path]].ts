import type { Env } from '../_shared/env';
import { handle } from '../_shared/http';
import { pathSegments, serveMedia } from '../_shared/media';

// GET /media/<id>/<file> — stream a file of a template the gallery lists:
// a frame (frames/sd/0000.glb), its thumbnail or a scene file. Anything
// else's files are a 404 here whoever asks; the owner reads them through
// /admin/api/media/*, which Access fronts (see _shared/media.ts).
// NB: deliberately /media (not /assets) so it never shadows Vite's built
// /assets/* bundles or the matcap.
export const onRequestGet: PagesFunction<Env> = ({ env, params }) =>
  handle(() => serveMedia(env, pathSegments(params.path), 'public'));
