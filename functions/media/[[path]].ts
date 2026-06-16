import type { Env } from '../_shared/types';

// GET /media/<id>/frames/sd/<file> — stream a project's R2 object.
// NB: deliberately /media (not /assets) so it never shadows Vite's built
// /assets/* bundles or the matcap.
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const key = `projects/${segments.join('/')}`;

  const object = await env.BUCKET.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (!headers.has('content-type')) headers.set('content-type', 'model/gltf-binary');
  return new Response(object.body, { headers });
};
