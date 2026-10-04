import type { Env } from '../_shared/types';
import { handle } from '../_shared/http';
import { pathSegments, serveMedia } from '../_shared/media';

// GET /media/<id>/<file> — stream a PUBLIC project's R2 object: a frame
// (frames/sd/0000.glb), its thumbnail or a scene file. A private project's
// files are a 404 here whoever asks; the owner reads them through
// /admin/api/media/*, which Access fronts (see _shared/media.ts).
// NB: deliberately /media (not /assets) so it never shadows Vite's built
// /assets/* bundles or the matcap.
export const onRequestGet: PagesFunction<Env> = ({ env, params }) =>
  handle(() => serveMedia(env, pathSegments(params.path), false));
