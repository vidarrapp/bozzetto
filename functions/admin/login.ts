import type { Env } from '../_shared/env';

// GET /admin/login?next=<path> - the way back in after a Cloudflare Access
// session has expired. Access fronts /admin*, so by the time a request
// reaches this Function its login has run (or the session was still good);
// all that is left is to send the browser back to the page it came from,
// where the app restores the work it stored before leaving. The page's own
// fetches cannot do this: Access answers them with a redirect to its login
// on another origin, which a fetch can only report, not follow.
export const onRequestGet: PagesFunction<Env> = ({ request }) =>
  new Response(null, {
    status: 302,
    headers: {
      location: sameSiteTarget(new URL(request.url)),
      // A remembered redirect would skip Access the next time round.
      'cache-control': 'no-store',
    },
  });

/**
 * `next` when it is a path on this site, the gallery otherwise, as an
 * absolute URL on this origin. Only a path is taken - an absolute URL,
 * `//host`, `/\host` or anything that resolves off this origin would make
 * an authenticated route an open redirect - and it is checked by resolving
 * it the way the browser will, not by its spelling. What goes back is the
 * resolved URL whole, never its path alone: `/.//evil.example/x` resolves
 * on this origin to the path `//evil.example/x`, which as a Location of its
 * own the browser reads as a link to another host.
 */
function sameSiteTarget(url: URL): string {
  const home = new URL('/', url.origin).href;
  const next = url.searchParams.get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return home;
  let target: URL;
  try {
    target = new URL(next, url.origin);
  } catch {
    return home;
  }
  if (target.origin !== url.origin) return home;
  return target.href;
}
