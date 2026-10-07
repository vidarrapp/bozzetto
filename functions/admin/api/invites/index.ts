import type { Env } from '../../../_shared/env';
import { answer, api, readBody } from '../../../_shared/auth/api';
import { createInvite, inviteInput, listInvites } from '../../../_shared/auth/invites';
import { siteOrigin } from '../../../_shared/auth/mail';
import { ownerGate } from '../../../_shared/owner';
import { ownerActor, type RequestData } from '../../../_shared/principal';

// GET /admin/api/invites - the Invites tab (docs/accounts.md §8): the
// latest 500 invites, newest first, as {invites: [{id, label, maxUses,
// uses, createdAt, expiresAt, revokedAt, state}]}, `state` being live,
// used (every use taken), expired or revoked. No token is ever in it.
//
// POST /admin/api/invites {label?, maxUses?, expiresInDays?} - a new
// invite: maxUses 1-500 (default 1), expiresInDays 1-90 (default 14), a
// label of up to 100 characters for the owner's own use. 201 {invite,
// link}: the link, `<APP_ORIGIN>/?invite=<token>`, is in this answer and
// nowhere else, since only the token's hash is kept. A field that will not
// do is 400 bad_request, `reason` naming it. Audited, without the label.
//
// Both need both locks, and accounts on (404 accounts_off while off).
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    return answer({ invites: await listInvites(env, data.now) });
  });

export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, data }) =>
  api(async () => {
    const denied = ownerGate(env, data);
    if (denied) return denied;
    const input = inviteInput(await readBody(request, { optional: true }));
    const p = data.principal;
    const createdBy = p.kind === 'admin' ? (p.owner?.id ?? null) : null;
    const { invite, token } = await createInvite(env, input, ownerActor(data), createdBy);
    return answer({ invite, link: `${siteOrigin(env, request)}/?invite=${token}` }, 201);
  });
