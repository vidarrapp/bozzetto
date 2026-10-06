import type { Env } from './env';
import { PROJECT_FILE, getFileRow, prefixFor, type Scope } from './projects';

/**
 * Stream one of a project's R2 objects (a frame, the thumbnail, a scene
 * file), if the asker may see it.
 *
 * Two routes serve these and differ only in `scope`. /media/* is open, and
 * never looks at identity: Cloudflare Access does not front it, so the
 * identity headers on a request there are whatever the client chose to
 * send, and a private project behind a forgeable header would not be
 * private. It serves the templates the gallery lists ('public'). The
 * owner's /admin/api/media/* sits under the Access application, which is
 * what makes the identity the root middleware read there worth trusting,
 * and it reaches whatever owner tools do.
 *
 * The key is the row's prefix and a file name from the fixed set, never a
 * path from the URL (docs/accounts.md §4). Every refusal is a 404: a
 * private project and a missing one answer the same, so guessing ids
 * learns nothing about which exist.
 */
export async function serveMedia(env: Env, segments: string[], scope: Scope): Promise<Response> {
  const [id, ...rest] = segments;
  const file = rest.join('/');
  if (!id || !PROJECT_FILE.test(file)) return notFound();
  // The row decides who may read and where the file is, so the object can
  // only be asked for once it is known - unless it is where 0.5 put it,
  // as every row from before accounts is. That key is fetched beside the
  // row, and used only if the row says it is the one: a 0.5 frame costs
  // the slower of the two round trips instead of both, and the timelapse
  // viewer asks for hundreds.
  const legacy = `projects/${id}/${file}`;
  const [row, early] = await Promise.all([getFileRow(env, id, scope), env.BUCKET.get(legacy)]);
  // No row is a refusal too: R2 can hold files the database no longer
  // vouches for (an interrupted delete), and nothing says who may read them.
  const key = row ? prefixFor(row) + file : null;
  if (key !== legacy) await early?.body.cancel();
  const object = key === null ? null : key === legacy ? early : await env.BUCKET.get(key);
  if (!object) return notFound();

  const shared = scope === 'public';
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', cacheControl(shared, file));
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
