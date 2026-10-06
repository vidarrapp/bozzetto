import type { Env } from '../../_shared/env';

// Every answer under /admin/api is the owner's: lists and manifests that
// name private projects, the sign-in probe, refusals. No browser or proxy
// cache may keep one, so whatever a route said about caching (a media
// file's `private, no-store`) stands, and anything that said nothing is
// no-store. The installed app's offline copies are the service worker's
// own and unaffected: it stores what it chooses whatever the header says.
// nosniff covers the answers json() did not build, such as a media 404.
export const onRequest: PagesFunction<Env> = async ({ next }) => {
  const res = await next();
  // A copy: a response can come back with headers that cannot be changed.
  const out = new Response(res.body, res);
  if (!out.headers.has('cache-control')) out.headers.set('cache-control', 'no-store');
  out.headers.set('x-content-type-options', 'nosniff');
  return out;
};
