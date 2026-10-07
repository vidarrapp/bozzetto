import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { answer, api } from '../../_shared/auth/api';
import { handleProblem } from '../../_shared/auth/handles';
import { HANDLE_CHECKS, clientIp, rateLimit } from '../../_shared/auth/ratelimit';

// GET /api/auth/handle?h=<handle> - whether a handle can be had, as it is
// typed (docs/accounts.md §3): {available: true}, or {available: false,
// reason} with reason format, reserved, taken (by an account, in any
// capitals) or retired (held for 90 days after its account let it go).
// A protected name (handles.ts) is reserved here whoever asks: the owner's
// bootstrap alone may take one, and checks for itself.
// The input is lower-cased first, as an account would store it. 60 per
// 10 minutes per IP; past that, 429 rate_limited with Retry-After.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, data, waitUntil }) =>
  api(async () => {
    const limited = await rateLimit(env, HANDLE_CHECKS, clientIp(request), data.now, waitUntil);
    if (limited) return limited;
    const reason = await handleProblem(env, new URL(request.url).searchParams.get('h') ?? '', data.now);
    return answer(reason ? { available: false, reason } : { available: true });
  });
