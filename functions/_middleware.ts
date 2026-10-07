import type { Env } from './_shared/env';
import { onMediaHost, requestTime } from './_shared/env';
import { HttpError, crossSiteWrite, json, refuse } from './_shared/http';
import { notFound } from './_shared/media';
import { resolvePrincipal, type RequestData } from './_shared/principal';

// Every Function runs behind this, in this order (docs/accounts.md §2):
//
//   1. The files host (MEDIA_ORIGIN) serves public files and nothing else:
//      anything but GET /m/* there is not found, so the API and the owner's
//      routes are never reachable on it.
//   2. A write another site's page sent is refused (crossSiteWrite), on
//      every route, whatever answers it after.
//   3. ctx.data.principal says who is asking, and ctx.data.now when: one
//      read for a session cookie (sessions JOIN users), or for the owner
//      on /admin/api/ once accounts are on, and none otherwise.
//
// A root middleware would make Pages run Functions for every path, static
// files and all, each billed as a request. public/_routes.json keeps them
// to the paths that have Functions: /api/*, /admin/api/*, /admin/login,
// /media/* and /m/*. Static files never reach this, on either host; the
// WAF rule in docs/accounts.md §11 keeps the files host to /m/ for those.
export const onRequest: PagesFunction<Env, string, RequestData> = async (ctx) => {
  const { request, env, data, waitUntil } = ctx;
  const url = new URL(request.url);
  if (onMediaHost(url, env) && !(request.method === 'GET' && url.pathname.startsWith('/m/'))) {
    return notFound();
  }
  if (crossSiteWrite(request)) return refuse(403, 'cross_site', 'Cross-site request refused');
  data.now = requestTime(request, env);
  try {
    data.principal = await resolvePrincipal(request, env, url, data.now, waitUntil);
  } catch (err) {
    // Access unconfigured, or its keys out of reach: our side's fault, said
    // as the admin routes have always said it. It never reaches the
    // /admin/api middleware that would mark it, so it is marked here.
    if (err instanceof HttpError) return json({ error: err.message }, err.status, { 'cache-control': 'no-store' });
    throw err;
  }
  return ctx.next();
};
