import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { Env } from '../env';
import type { CredentialRow, UserRow } from '../types';
import { appOrigin } from '../env';
import { HttpError, refuse } from '../http';
import { base64url, fromBase64url, randomToken, sha256Hex } from '../crypto';
import { CEREMONY_COOKIE, ceremonyCookie, readCookie } from './session';

/**
 * Passkeys (docs/accounts.md §3), through @simplewebauthn/server, which
 * needs nothing of workerd but Web Crypto.
 *
 * A ceremony is one options call and the one answer to it. Its challenge
 * is kept in pending_auth (kind 'webauthn') under the SHA-256 of a token
 * that only the browser that asked holds, in the `__Host-bz_wa` cookie
 * (SameSite=Strict), for five minutes; the answer consumes it before
 * anything is checked, so a challenge is good once, even for an answer
 * that fails. What the ceremony is for - signing in, re-authenticating, or
 * adding a passkey - and for whom is kept beside it.
 *
 * Everything the library checks is asked of it strictly (the origin, the
 * RP ID, user verification); what it leaves to the caller is checked here
 * (crossOrigin, the user handle, the counter).
 */

export type Purpose = 'sign_in' | 'reauth' | 'add_passkey';

/** How long a challenge is good for, and the browser's own timeout. */
export const CEREMONY_TTL = 5 * 60_000;
export const PASSKEY_TIMEOUT = 300_000;
/** What the passkey is saved under, as the platform's passkey manager shows it. */
export const RP_NAME = 'Bozzetto';
/** WebAuthn's own cap on a credential id. */
const MAX_CREDENTIAL_ID_BYTES = 1023;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The relying party: RP_ID, and APP_ORIGIN as the one origin a passkey is used from. */
export interface RelyingParty {
  rpID: string;
  origin: string;
}

/** RP_ID and APP_ORIGIN, or a 503 not_configured while either is missing. */
export function relyingParty(env: Env): RelyingParty {
  const rpID = env.RP_ID?.trim();
  const origin = appOrigin(env);
  if (!rpID || !origin) {
    console.error('Passkeys need RP_ID and APP_ORIGIN');
    throw new HttpError('Passkeys are not configured', 503, 'not_configured');
  }
  return { rpID, origin };
}

/** Any refusal of a passkey: the same 400, whatever the reason, so none of them is learned. */
export const notAccepted = (): Response => refuse(400, 'bad_request', 'That passkey was not accepted');

// --- ceremonies --------------------------------------------------------------------

/**
 * Begin a ceremony for `purpose` (and `userId`, when it is an account's):
 * store `challenge` under a new token's hash, and answer the cookie that
 * carries the token. A ceremony this browser already had going is dropped,
 * and so is every one, of anyone's, whose time is up.
 */
export async function beginCeremony(
  env: Env,
  request: Request,
  now: number,
  purpose: Purpose,
  userId: string | null,
  challenge: string,
): Promise<string> {
  const token = randomToken(32);
  const statements: D1PreparedStatement[] = [];
  const previous = readCookie(request, CEREMONY_COOKIE);
  if (previous && TOKEN.test(previous)) {
    statements.push(
      env.DB.prepare("DELETE FROM pending_auth WHERE id = ? AND kind = 'webauthn'").bind(await sha256Hex(previous)),
    );
  }
  statements.push(
    env.DB.prepare("DELETE FROM pending_auth WHERE kind = 'webauthn' AND expires_at <= ?").bind(now),
    env.DB.prepare(
      `INSERT INTO pending_auth (id, kind, purpose, user_id, secret, created_at, expires_at)
       VALUES (?, 'webauthn', ?, ?, ?, ?, ?)`,
    ).bind(await sha256Hex(token), purpose, userId, challenge, now, now + CEREMONY_TTL),
  );
  await env.DB.batch(statements);
  return ceremonyCookie(token, CEREMONY_TTL);
}

/** A ceremony taken back: what it was for, whose it was, and its challenge. */
export interface Ceremony {
  purpose: Purpose;
  userId: string | null;
  challenge: string;
}

/**
 * The ceremony this browser's cookie names, consumed: deleted before
 * anything else happens, so it is good once whatever follows. Null when
 * there is none, or its time is up.
 */
export async function takeCeremony(env: Env, request: Request, now: number): Promise<Ceremony | null> {
  const token = readCookie(request, CEREMONY_COOKIE);
  if (!token || !TOKEN.test(token)) return null;
  const row = await env.DB.prepare(
    "DELETE FROM pending_auth WHERE id = ? AND kind = 'webauthn' RETURNING purpose, user_id, secret, expires_at",
  )
    .bind(await sha256Hex(token))
    .first<{ purpose: Purpose; user_id: string | null; secret: string; expires_at: number }>();
  if (!row || row.expires_at <= now) return null;
  return { purpose: row.purpose, userId: row.user_id, challenge: row.secret };
}

// --- options --------------------------------------------------------------------------

/** A credential as options name it: its id, and how the browser reaches it. */
export interface CredentialRef {
  id: string;
  transports?: string[];
}

/** An account's passkeys as options name them. */
export async function credentialRefs(env: Env, userId: string): Promise<CredentialRef[]> {
  const { results } = await env.DB.prepare('SELECT id, transports FROM credentials WHERE user_id = ? ORDER BY created_at, id')
    .bind(userId)
    .all<{ id: string; transports: string }>();
  return results.map((r) => ({ id: r.id, transports: parseTransports(r.transports) }));
}

function parseTransports(raw: string): string[] | undefined {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && list.length > 0 ? list.filter((t): t is string => typeof t === 'string') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Options for signing in (no credentials named: the browser offers every
 * passkey it has for this site) or re-authenticating (only the account's).
 * User verification is required: a passkey is the whole sign-in.
 */
export function authenticationOptions(rp: RelyingParty, allow: CredentialRef[]): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: allow,
    userVerification: 'required',
    timeout: PASSKEY_TIMEOUT,
  });
}

/**
 * The user handle an account's passkeys carry: webauthn_user_id's bytes.
 * It is stored as base64url, which is how the browser hands it back.
 */
function userIdBytes(user: Pick<UserRow, 'webauthn_user_id'>): Uint8Array {
  return fromBase64url(user.webauthn_user_id) ?? new TextEncoder().encode(user.webauthn_user_id);
}

/** The user handle as an assertion carries it, to compare with what one says. */
export const userHandleOf = (user: Pick<UserRow, 'webauthn_user_id'>): string => base64url(userIdBytes(user));

/**
 * Options for a new passkey: discoverable and user-verifying, attestation
 * none, and the account's passkeys excluded, so one is not saved twice.
 * No preferredAuthenticatorType: 'localDevice' would force a platform
 * authenticator and lock out phones and security keys.
 */
export function registrationOptions(
  rp: RelyingParty,
  user: Pick<UserRow, 'handle' | 'webauthn_user_id'>,
  exclude: CredentialRef[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userID: userIdBytes(user).slice(),
    userName: user.handle,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: exclude,
    timeout: PASSKEY_TIMEOUT,
  });
}

// --- answers ----------------------------------------------------------------------------

/** The id an answer names its credential by, when it is one a passkey could have. */
export function credentialIdOf(response: unknown): string | null {
  const id = (response as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || id.length === 0) return null;
  const bytes = fromBase64url(id);
  return bytes && bytes.byteLength <= MAX_CREDENTIAL_ID_BYTES ? id : null;
}

/**
 * Whether the browser says the ceremony ran in a frame of another origin,
 * or the client data cannot be read at all. The library refuses a
 * cross-origin answer only when it names its top origin, which Safari's do
 * not, so it is refused here whatever it names.
 */
function crossOrigin(response: unknown): boolean {
  const raw = (response as { response?: { clientDataJSON?: unknown } } | null)?.response?.clientDataJSON;
  const bytes = typeof raw === 'string' ? fromBase64url(raw) : null;
  if (!bytes) return true;
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes)) as { crossOrigin?: unknown } | null;
    return data?.crossOrigin === true;
  } catch {
    return true;
  }
}

/** What a verified sign-in assertion says. */
export interface Assertion {
  newCounter: number;
  backedUp: boolean;
  /** The user handle it carried, or null when it carried none. */
  userHandle: string | null;
}

/**
 * Verify an assertion for `credential`, or null for any failure: the
 * challenge, the origin (APP_ORIGIN), the RP ID's hash, user presence and
 * verification, and the signature, all by the library; crossOrigin here.
 * The library would refuse a counter that went backwards, which is ours to
 * judge, so it is told the stored counter is 0 and the caller compares.
 */
export async function verifyAssertion(
  rp: RelyingParty,
  challenge: string,
  response: unknown,
  credential: Pick<CredentialRow, 'id' | 'public_key' | 'transports'>,
): Promise<Assertion | null> {
  try {
    if (crossOrigin(response)) return null;
    const answer = response as AuthenticationResponseJSON;
    const result = await verifyAuthenticationResponse({
      response: answer,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.public_key),
        counter: 0,
        transports: parseTransports(credential.transports),
      },
    });
    if (!result.verified || !result.authenticationInfo.userVerified) return null;
    const handle = answer.response?.userHandle;
    return {
      newCounter: result.authenticationInfo.newCounter,
      backedUp: result.authenticationInfo.credentialBackedUp,
      userHandle: typeof handle === 'string' && handle.length > 0 ? handle : null,
    };
  } catch {
    return null;
  }
}

/** A passkey just registered, as it is stored. */
export interface NewCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  aaguid: string;
}

/**
 * Verify a registration, or null for any failure: the challenge, the
 * origin, the RP ID's hash, user presence and verification, and the
 * attestation (none, or one the library can check), by the library;
 * crossOrigin here, which the library does not look at for registrations.
 */
export async function verifyRegistration(
  rp: RelyingParty,
  challenge: string,
  response: unknown,
): Promise<NewCredential | null> {
  try {
    if (crossOrigin(response)) return null;
    const result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!result.verified) return null;
    const info = result.registrationInfo;
    const id = credentialIdOf({ id: info.credential.id });
    if (!id || !info.userVerified) return null;
    return {
      id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: (info.credential.transports ?? []).filter((t) => typeof t === 'string'),
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      aaguid: info.aaguid,
    };
  } catch {
    return null;
  }
}
