import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { answer, api, readBody } from '../../../_shared/auth/api';
import { inviteInvalid, liveInvite } from '../../../_shared/auth/invites';
import { INVITE_CHECKS, clientIp, enforce } from '../../../_shared/auth/ratelimit';

// POST /api/auth/invite/check {invite} - whether an invite link still
// admits someone, as Join opens (docs/accounts.md §3): 200 {expiresAt}, or
// 410 invite_invalid for one unknown, revoked, expired or used up alike -
// and for anything that is not an invite token. 20 per hour per IP, every
// request counted; past that, 429 rate_limited with Retry-After.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, data, waitUntil }) =>
  api(async () => {
    await enforce(env, INVITE_CHECKS, clientIp(request), data.now, waitUntil);
    const invite = await liveInvite(env, (await readBody(request)).invite, data.now);
    if (!invite) throw inviteInvalid();
    return answer({ expiresAt: invite.expires_at });
  });
