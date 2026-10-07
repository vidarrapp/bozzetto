import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { MEMBER_LIMITS } from '../../../_shared/config';
import { HttpError } from '../../../_shared/http';
import { auditStatement } from '../../../_shared/auth/audit';
import {
  PASSKEY_COLUMNS,
  cleanPasskeyName,
  defaultPasskeyName,
  passkeyOf,
  passkeysOf,
  type PasskeyFields,
} from '../../../_shared/auth/account';
import { answer, api, readBody, requireRecentAuth, requireUser } from '../../../_shared/auth/api';
import { notify } from '../../../_shared/auth/notify';
import { clearCeremony, userAgentOf, withCookies } from '../../../_shared/auth/session';
import { notAccepted, relyingParty, takeCeremony, verifyRegistration } from '../../../_shared/auth/webauthn';

// GET /api/me/passkeys - the account's passkeys, oldest first: {passkeys:
// [{id, name, createdAt, lastUsedAt, deviceType, backedUp, aaguid,
// counterWarningAt}]}.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, data }) =>
  api(async () => answer({ passkeys: await passkeysOf(env, requireUser(data.principal).user.id) }));

// POST /api/me/passkeys {response, name?} - save the passkey made from
// /api/me/passkeys/options (docs/accounts.md §3). The ceremony is consumed
// first, as a sign-in's is; then the same checks as a sign-in (origin, RP
// ID, user verification, not cross-origin), and recent authentication
// (401 reauth). The name defaults from the user agent ("Safari on iPad");
// one given is trimmed and cut to 64 characters. An account holds at most
// 10 (400 with `limit`). Answers 201 {passkey}; the holder is told (mail,
// Batch 4). Any failure of the passkey itself is the same 400.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  api(() => save(ctx)).then((res) => withCookies(res, [clearCeremony()]));

async function save({ request, env, data }: EventContext<Env, string, RequestData>): Promise<Response> {
  const { now } = data;
  const ceremony = await takeCeremony(env, request, now);
  const { user } = requireRecentAuth(data.principal);
  const body = await readBody(request);
  if (!ceremony || ceremony.purpose !== 'add_passkey' || ceremony.userId !== user.id) return notAccepted();
  const made = await verifyRegistration(relyingParty(env), ceremony.challenge, body.response);
  if (!made) return notAccepted();
  const name = cleanPasskeyName(body.name) || defaultPasskeyName(userAgentOf(request));
  const max = MEMBER_LIMITS.passkeys;
  let added: number;
  try {
    const [insert] = await env.DB.batch([
      // Below the limit, counted as the row goes in, so two saves at once
      // cannot both take the last place.
      env.DB.prepare(
        `INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up, aaguid, name, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM credentials WHERE user_id = ?) < ?`,
      ).bind(
        made.id,
        user.id,
        made.publicKey,
        made.counter,
        JSON.stringify(made.transports),
        made.deviceType,
        made.backedUp ? 1 : 0,
        made.aaguid,
        name,
        now,
        user.id,
        max,
      ),
      auditStatement(
        env,
        { actor: user.id, action: 'passkey.add', subject: user.id, at: now, detail: { credential: made.id } },
        { sql: 'SELECT 1 FROM credentials WHERE id = ? AND user_id = ? AND created_at = ?', binds: [made.id, user.id, now] },
      ),
    ]);
    added = insert.meta.changes;
  } catch (err) {
    // The same passkey saved twice (excludeCredentials should have stopped it).
    if (/UNIQUE|PRIMARY KEY/i.test(String((err as Error)?.message ?? err))) return notAccepted();
    throw err;
  }
  if (!added) throw new HttpError(`An account holds at most ${max} passkeys`, 400, 'bad_request', { limit: max });
  await notify(env, user, 'passkey.added');
  const row = await env.DB.prepare(`SELECT ${PASSKEY_COLUMNS} FROM credentials WHERE id = ?`)
    .bind(made.id)
    .first<PasskeyFields>();
  if (!row) throw new HttpError('Not found', 404, 'not_found');
  return answer({ passkey: passkeyOf(row) }, 201);
}
