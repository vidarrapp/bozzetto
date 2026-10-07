/**
 * Random ids and tokens, digests and keyed digests, for the accounts
 * (docs/accounts.md). Web Crypto only, which workerd provides as globals.
 */

const encoder = new TextEncoder();

/**
 * Crockford's base32, lower-cased: no i, l, o or u, so an id read aloud or
 * copied by hand survives, and nothing in it needs escaping in a path.
 */
const BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';

export function base32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * A new user, project, session or invite id: `u-`, `p-`, `s-` or `i-` and
 * 128 random bits as 26 base32 characters. Enough that ids can be made
 * without asking the database whether one is taken, and that guessing one
 * is hopeless.
 */
export function randomId(kind: 'u' | 'p' | 's' | 'i'): string {
  return `${kind}-${base32(crypto.getRandomValues(new Uint8Array(16)))}`;
}

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * base64url (padded or not) as bytes, or null when it is not base64url:
 * what a client sends is decoded with this, so a bad value is a refusal
 * rather than an exception.
 */
export function fromBase64url(text: string): Uint8Array | null {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(text) || text.replace(/=+$/, '').length % 4 === 1) {
    return null;
  }
  const plain = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(plain + '='.repeat((4 - (plain.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A secret to hand out once - a cookie, an invite, a sign-in link: `bytes` random bytes, base64url. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const asBytes = (data: string | ArrayBuffer | ArrayBufferView): ArrayBuffer | ArrayBufferView =>
  typeof data === 'string' ? encoder.encode(data) : data;

/**
 * SHA-256 as hex. What the database keeps of a token it hands out (a
 * session cookie, an invite), so a copy of the database signs nobody in.
 */
export async function sha256Hex(data: string | ArrayBuffer | ArrayBufferView): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', asBytes(data)));
}

/** The imported key, kept per isolate: importing it costs as much as using it. */
let hmacCache: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(secret: string): Promise<CryptoKey> {
  if (hmacCache?.secret !== secret) {
    // The secret's text is the key, as `openssl rand -base64 32` prints it:
    // 44 characters carry the same 256 bits, and nothing has to decode them.
    const key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    hmacCache = { secret, key };
  }
  return hmacCache.key;
}

/** HMAC-SHA256 of `message` under `secret` (AUTH_SECRET). */
export async function hmac(secret: string, message: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message)));
}

/** The same, as hex, cut to `bytes` bytes when asked: a rate-limit bucket keeps 16 (128 bits). */
export async function hmacHex(secret: string, message: string, bytes = 32): Promise<string> {
  return hex((await hmac(secret, message)).slice(0, bytes).buffer);
}

/**
 * Whether two secrets are the same, in a time that does not depend on
 * where they first differ. Their lengths are not secret (a digest's never
 * is), so unequal lengths answer at once; workerd's own comparison throws
 * on them anyway. The loop stands in where that comparison does not exist
 * (Node, where the check suite runs this file).
 */
export function timingSafeEqual(a: Uint8Array | string, b: Uint8Array | string): boolean {
  const x = typeof a === 'string' ? encoder.encode(a) : a;
  const y = typeof b === 'string' ? encoder.encode(b) : b;
  if (x.byteLength !== y.byteLength) return false;
  const subtle = crypto.subtle as Partial<Pick<SubtleCrypto, 'timingSafeEqual'>>;
  if (typeof subtle.timingSafeEqual === 'function') return subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.byteLength; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
