import type { Env } from '../../../_shared/env';
import type { CredentialRow, UserRow } from '../../../_shared/types';
import type { RequestData, UserPrincipal } from '../../../_shared/principal';
import { auditStatement } from '../../../_shared/auth/audit';
import { meOf } from '../../../_shared/auth/account';
import { answer, api, noContent, readBody, requireUser } from '../../../_shared/auth/api';
import {
  clearCeremony,
  clientOf,
  newSession,
  signInCookies,
  userAgentOf,
  withCookies,
} from '../../../_shared/auth/session';
import {
  credentialIdOf,
  notAccepted,
  relyingParty,
  takeCeremony,
  userHandleOf,
  verifyAssertion,
} from '../../../_shared/auth/webauthn';

// POST /api/auth/passkey/verify {response, client?, reauth?} - the answer
// to /api/auth/passkey/options (docs/accounts.md §3). The ceremony this
// browser's __Host-bz_wa names is consumed first, so its challenge is good
// once even when what follows fails; then the assertion is verified
// against APP_ORIGIN and RP_ID with user verification required, the
// browser must not say it ran cross-origin, the user handle must be the
// account's, and the account active. Any failure is the same 400.
//
// A sign-in answers 200 {user} (as GET /api/me) with a new session cookie,
// the other auth cookies cleared, and a session this browser held before
// revoked. client: 'desktop' marks the desktop app's sessions.
//
// With reauth: true (the ceremony began so, by the same account), it
// marks the session as recently authenticated instead, and answers 204.
//
// The counter is judged here, not by the library: a stored counter above
// 0 and a new one no higher is accepted, but noted on the passkey
// (counter_warning_at) and in the audit log.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  // Whatever the answer, the ceremony is over: its cookie goes too, unless
  // a sign-in's cookies already clear it.
  api(() => verify(ctx)).then((res) => (res.headers.has('set-cookie') ? res : withCookies(res, [clearCeremony()])));

async function verify({ request, env, data }: EventContext<Env, string, RequestData>): Promise<Response> {
  const { now } = data;
  const ceremony = await takeCeremony(env, request, now);
  const body = await readBody(request);
  const reauth = body.reauth === true;
  if (!ceremony || ceremony.purpose !== (reauth ? 'reauth' : 'sign_in')) return notAccepted();
  let me: UserPrincipal | null = null;
  if (reauth) {
    me = requireUser(data.principal);
    if (me.user.id !== ceremony.userId) return notAccepted();
  }
  const rp = relyingParty(env);
  const id = credentialIdOf(body.response);
  if (!id) return notAccepted();
  const found = await env.DB.prepare(
    `SELECT c.id AS c_id, c.public_key AS c_public_key, c.counter AS c_counter, c.transports AS c_transports, u.*
     FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
  )
    .bind(id)
    .first<UserRow & { c_id: string; c_public_key: ArrayLike<number>; c_counter: number; c_transports: string }>();
  if (!found) return notAccepted();
  const credential: Pick<CredentialRow, 'id' | 'public_key' | 'counter' | 'transports'> = {
    id: found.c_id,
    public_key: found.c_public_key,
    counter: found.c_counter,
    transports: found.c_transports,
  };
  const user = found as UserRow;
  if (me && user.id !== me.user.id) return notAccepted();

  const assertion = await verifyAssertion(rp, ceremony.challenge, body.response, credential);
  if (!assertion) return notAccepted();
  // Signing in, the handle is how the browser says whose passkey this is,
  // so it must be there; re-authenticating, the account is known already,
  // and a handle, when one comes, must agree with it.
  if (assertion.userHandle === null ? !reauth : assertion.userHandle !== userHandleOf(user)) return notAccepted();
  if (user.status !== 'active') return notAccepted();

  const warn = credential.counter > 0 && assertion.newCounter <= credential.counter;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE credentials SET counter = MAX(counter, ?), backed_up = ?, last_used_at = ?,
              counter_warning_at = CASE WHEN ? THEN ? ELSE counter_warning_at END
       WHERE id = ?`,
    ).bind(assertion.newCounter, assertion.backedUp ? 1 : 0, now, warn ? 1 : 0, now, credential.id),
  ];
  if (warn) {
    statements.push(
      auditStatement(env, {
        actor: user.id,
        action: 'passkey.counter',
        subject: user.id,
        at: now,
        detail: { credential: credential.id, stored: credential.counter, received: assertion.newCounter },
      }),
    );
  }

  if (me) {
    statements.push(env.DB.prepare('UPDATE sessions SET reauth_at = ? WHERE id = ?').bind(now, me.session.id));
    await env.DB.batch(statements);
    return noContent();
  }

  const client = clientOf(body.client);
  const session = await newSession(env, { userId: user.id, method: 'passkey', client, userAgent: userAgentOf(request), now });
  statements.push(session.insert);
  // A session this browser held is replaced by the new one, so it goes.
  if (data.principal.kind === 'user') {
    statements.push(
      env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(
        now,
        data.principal.session.id,
      ),
    );
  }
  statements.push(
    auditStatement(env, {
      actor: user.id,
      action: 'session.signin',
      subject: user.id,
      at: now,
      detail: { method: 'passkey', session: session.id, client },
    }),
  );
  await env.DB.batch(statements);
  return withCookies(answer({ user: await meOf(env, user) }), signInCookies(session.token));
}
