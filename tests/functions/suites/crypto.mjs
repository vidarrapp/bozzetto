// functions/_shared/crypto.ts, asked directly: the ids, tokens and digests
// the accounts batches build on, against known answers.
import { createHash, createHmac, webcrypto } from 'node:crypto';

export const needs = [];

/** Crockford base32 the slow way, to hold the fast one to. */
function base32Reference(bytes) {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  const bits = [...bytes].map((b) => b.toString(2).padStart(8, '0')).join('');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

export async function run({ checks, compileShared }) {
  globalThis.crypto ??= webcrypto; // Node 18 has none of its own
  const c = await (await compileShared())('crypto');
  const t = checks('functions: crypto helpers');

  const users = Array.from({ length: 200 }, () => c.randomId('u'));
  t.ok(users.every((id) => /^u-[0-9a-hjkmnp-tv-z]{26}$/.test(id)), `a user id is u- and 26 base32 characters (${users[0]})`);
  t.ok(/^p-[0-9a-hjkmnp-tv-z]{26}$/.test(c.randomId('p')), 'and a project id p- and the same');
  t.eq(new Set(users).size, users.length, '200 of them, all different');
  t.ok(/^[a-z0-9][a-z0-9-]{0,62}$/.test(c.randomId('p')), "a project id passes the owner tools' own id rule");
  const samples = [new Uint8Array(16), new Uint8Array(16).fill(255), webcrypto.getRandomValues(new Uint8Array(16)), new Uint8Array([1, 2, 3])];
  t.ok(samples.every((b) => c.base32(b) === base32Reference(b)), 'base32 agrees with a bit-by-bit reference');
  const token = c.randomToken();
  t.ok(/^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, 'base64url').length === 32, `a token is 32 random bytes as base64url (${token.length} characters)`);
  t.eq(await c.sha256Hex('abc'), createHash('sha256').update('abc').digest('hex'), 'SHA-256 as hex, of text');
  t.eq(await c.sha256Hex(new Uint8Array([0, 1, 2])), createHash('sha256').update(Buffer.from([0, 1, 2])).digest('hex'), 'and of bytes');
  // RFC 4231, test case 2.
  t.eq(await c.hmacHex('Jefe', 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', 'HMAC-SHA256 gives the RFC 4231 answer');
  t.eq(await c.hmacHex('other secret', 'flow:123456'), createHmac('sha256', 'other secret').update('flow:123456').digest('hex'), "and a second secret is not served the first one's cached key");
  t.eq((await c.hmacHex('Jefe', 'ip', 16)).length, 32, 'cut to 16 bytes, 32 hex characters');
  t.ok(c.timingSafeEqual('abc', 'abc') && !c.timingSafeEqual('abc', 'abd') && !c.timingSafeEqual('abc', 'abcd'), 'timingSafeEqual: equal, unequal, and unequal lengths');
  t.ok(c.timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])) && !c.timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([2, 1])), 'and of bytes');
  t.report();
}
