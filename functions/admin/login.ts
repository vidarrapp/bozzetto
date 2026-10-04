import type { Env } from '../_shared/types';

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
      location: sameSitePath(new URL(request.url)),
      // A remembered redirect would skip Access the next time round.
      'cache-control': 'no-store',
    },
  });

/**
 * `next` when it is a path on this site, `/` otherwise. Only a path is
 * taken - an absolute URL, `//host`, `/\host` or anything that resolves off
 * this origin would make an authenticated route an open redirect - and it
 * is checked by resolving it the way the browser will, not by its spelling.
 */
function sameSitePath(url: URL): string {
  const next = url.searchParams.get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  let target: URL;
  try {
    target = new URL(next, url.origin);
  } catch {
    return '/';
  }
  if (target.origin !== url.origin) return '/';
  return `${target.pathname}${target.search}${target.hash}`;
}
