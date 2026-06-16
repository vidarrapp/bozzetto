import type { Env } from './types';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Wrap a handler so thrown HttpErrors become clean JSON responses. */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e: unknown) => {
    if (e instanceof HttpError) return error(e.message, e.status);
    console.error(e);
    return error('Internal error', 500);
  });
}

/**
 * The authenticated admin email, or null. Cloudflare Access injects
 * `Cf-Access-Authenticated-User-Email` on protected routes; an optional
 * ADMIN_EMAILS allowlist narrows it further.
 */
export function adminEmail(request: Request, env: Env): string | null {
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!email) return null;
  const allow = env.ADMIN_EMAILS?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow && allow.length > 0 && !allow.includes(email.toLowerCase())) return null;
  return email;
}

/** Returns a 403 Response if the request is not an allowed admin, else null. */
export function requireAdmin(request: Request, env: Env): Response | null {
  return adminEmail(request, env) ? null : error('Unauthorized', 403);
}
