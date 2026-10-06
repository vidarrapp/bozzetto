import type { Env } from './types';

/**
 * Stream one of a project's R2 objects (a frame, the thumbnail, a scene
 * file), if the asker may see it.
 *
 * Two routes serve these and differ only in `owner`. /media/* is open, and
 * never looks at identity: Cloudflare Access does not front it, so the
 * identity headers on a request there are whatever the client chose to
 * send, and a private project behind a forgeable header would not be
 * private. /admin/api/media/* sits under the Access application, which is
 * what makes the identity adminEmail reads there worth trusting, and it
 * passes `owner` once that check has passed.
 *
 * Every refusal is a 404: a private project and a missing one answer the
 * same, so guessing ids learns nothing about which exist.
 */
export async function serveMedia(env: Env, segments: string[], owner: boolean): Promise<Response> {
  const [id, ...rest] = segments;
  if (!id || rest.length === 0) return notFound();
  // The row decides who may read, so it is fetched beside the object
  // rather than before it: a public frame costs the slower of the two round
  // trips instead of both, and the timelapse viewer asks for hundreds.
  const [row, object] = await Promise.all([
    env.DB.prepare('SELECT visibility FROM projects WHERE id = ?')
      .bind(id)
      .first<{ visibility: string }>(),
    env.BUCKET.get(`projects/${segments.join('/')}`),
  ]);
  const isPublic = row?.visibility === 'public';
  // No row is a refusal too: R2 can hold files the database no longer
  // vouches for (an interrupted delete), and nothing says who may read them.
  if (!object || !row || (!isPublic && !owner)) {
    await object?.body.cancel();
    return notFound();
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', cacheControl(isPublic && !owner, rest.join('/')));
  if (!headers.has('content-type')) headers.set('content-type', 'model/gltf-binary');
  // A stored file is data, never a page. Uploads are the owner's, but the
  // type a browser acts on should still be the one stored, and a file
  // opened on its own is sandboxed: no script, no plugins, and an origin
  // apart from this site's.
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  // Only this site's own pages read these. Nothing loads them from another
  // origin (the desktop app fetches them in its main process, the
  // single-file export carries its own copies), so no other site may
  // embed them either, public or private.
  headers.set('cross-origin-resource-policy', 'same-origin');
  return new Response(object.body, { headers });
}

/**
 * A private file, or any file read through the Access-gated route, is kept
 * nowhere it could outlive the session that fetched it. A scene is re-saved
 * in place under one name, so every read revalidates. Frames and thumbnails
 * are addressed with ?v=<updated_at>, so a URL never changes what it means
 * and may be kept for good.
 */
function cacheControl(shared: boolean, file: string): string {
  if (!shared) return 'private, no-store';
  if (file === 'scene.bozz') return 'public, no-cache';
  return 'public, max-age=31536000, immutable';
}

export function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/** A [[path]] catch-all hands over one segment or several. */
export function pathSegments(path: string | string[] | undefined): string[] {
  if (Array.isArray(path)) return path;
  return path ? [path] : [];
}
