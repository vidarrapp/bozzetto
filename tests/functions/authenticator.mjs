// A software WebAuthn authenticator for the function suites
// (docs/accounts.md §10): ES256 passkeys made and used in Node, answering
// options as the browser would, in the JSON @simplewebauthn/browser posts
// (RegistrationResponseJSON, AuthenticationResponseJSON). Every part a
// server must check can be made wrong on purpose: the origin and RP ID,
// user presence and verification, crossOrigin and topOrigin, the
// counter, the user handle, the challenge and the ceremony type.
//
//   const key = new Authenticator();
//   const { response, credential } = key.makeCredential(creationOptions, { origin });
//   const assertion = key.getAssertion(requestOptions, { origin });
//
// Credentials are discoverable: the authenticator keeps each one (its key
// pair, RP ID, user handle and counter), and an assertion with no
// allowCredentials uses the newest for the RP ID. `seed()` makes one with
// no ceremony at all, for a suite to put in the database beforehand.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const sha256 = (data) => new Uint8Array(createHash('sha256').update(data).digest());
const concat = (...parts) => new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
const u16 = (n) => new Uint8Array([(n >> 8) & 255, n & 255]);
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** Flags in authenticator data (WebAuthn §6.1). */
const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

// --- CBOR, as much as COSE keys and attestation objects need --------------------

function head(major, n) {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
  if (n < 65536) return concat([(major << 5) | 25], u16(n));
  return concat([(major << 5) | 26], u32(n));
}

/** CBOR for integers, byte strings, text, arrays and Maps (whose keys keep their type). */
export function cbor(value) {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (Array.isArray(value)) return concat(head(4, value.length), ...value.map(cbor));
  if (value instanceof Map) {
    return concat(head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]));
  }
  throw new TypeError(`cbor: cannot encode ${typeof value}`);
}

/** A P-256 public key as a COSE_Key (ES256). */
function coseKey(publicKey) {
  const { x, y } = publicKey.export({ format: 'jwk' });
  return cbor(
    new Map([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, new Uint8Array(Buffer.from(x, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(y, 'base64url'))],
    ]),
  );
}

function clientData({ type, challenge, origin, crossOrigin, topOrigin }) {
  const data = { type, challenge, origin, crossOrigin };
  if (topOrigin !== undefined) data.topOrigin = topOrigin;
  return new TextEncoder().encode(JSON.stringify(data));
}

function flags({ up = true, uv = true, backupEligible, backedUp, attested = false }) {
  return (up ? UP : 0) | (uv ? UV : 0) | (backupEligible ? BE : 0) | (backedUp ? BS : 0) | (attested ? AT : 0);
}

export class Authenticator {
  /**
   * `aaguid`: the 16-byte model id it reports (zeros, as most passkey
   * providers report). `backupEligible`/`backedUp`: a synced passkey's flags.
   */
  constructor({ aaguid = new Uint8Array(16), backupEligible = false, backedUp = false } = {}) {
    this.aaguid = aaguid;
    this.backupEligible = backupEligible;
    this.backedUp = backedUp;
    /** Every credential it holds: {id, idBytes, privateKey, cose, rpId, userHandle, counter}. */
    this.credentials = [];
  }

  /**
   * A new credential with no ceremony: for an RP ID and a user handle
   * (base64url, as webauthn_user_id is stored), its COSE key in `cose`.
   */
  seed({ rpId = 'localhost', userHandle, counter = 0 } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const idBytes = new Uint8Array(randomBytes(32));
    const credential = { id: b64u(idBytes), idBytes, privateKey, cose: coseKey(publicKey), rpId, userHandle, counter };
    this.credentials.push(credential);
    return credential;
  }

  /**
   * navigator.credentials.create(), answered: a registration response for
   * `options` (PublicKeyCredentialCreationOptionsJSON) as made at `origin`.
   * Each of these may be made wrong: `rpId` (the hash in the authenticator
   * data), `up`, `uv`, `crossOrigin`, `topOrigin`, `challenge`, `type`.
   * An excluded credential it holds is refused, as an authenticator does,
   * unless `ignoreExclude`.
   */
  makeCredential(options, opts = {}) {
    const {
      origin,
      rpId = options.rp.id,
      up = true,
      uv = true,
      crossOrigin = false,
      topOrigin,
      challenge = options.challenge,
      type = 'webauthn.create',
      ignoreExclude = false,
      counter = 0,
    } = opts;
    if (!origin) throw new Error('makeCredential: an origin is needed');
    const excluded = new Set((options.excludeCredentials ?? []).map((c) => c.id));
    if (!ignoreExclude && this.credentials.some((c) => c.rpId === rpId && excluded.has(c.id))) {
      throw new Error('InvalidStateError: this authenticator already holds an excluded credential');
    }
    const credential = this.seed({ rpId, userHandle: options.user.id, counter });
    const authData = concat(
      sha256(rpId),
      [flags({ up, uv, backupEligible: this.backupEligible, backedUp: this.backedUp, attested: true })],
      u32(counter),
      this.aaguid,
      u16(credential.idBytes.length),
      credential.idBytes,
      credential.cose,
    );
    const attestationObject = cbor(
      new Map([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    const response = {
      id: credential.id,
      rawId: credential.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64u(clientData({ type, challenge, origin, crossOrigin, topOrigin })),
        attestationObject: b64u(attestationObject),
        transports: ['internal', 'hybrid'],
        publicKeyAlgorithm: -7,
        authenticatorData: b64u(authData),
      },
      clientExtensionResults: { credProps: { rk: true } },
      authenticatorAttachment: 'platform',
    };
    return { response, credential };
  }

  /**
   * navigator.credentials.get(), answered: an assertion for `options`
   * (PublicKeyCredentialRequestOptionsJSON) as made at `origin`, with the
   * named credential, else the newest it holds that the options allow.
   * The counter goes up by one unless `counter` says what to report; the
   * user handle is the credential's unless `userHandle` says otherwise
   * (null leaves it out). `rpId`, `up`, `uv`, `crossOrigin`, `topOrigin`,
   * `challenge` and `type` may be made wrong, as for makeCredential.
   */
  getAssertion(options, opts = {}) {
    const {
      origin,
      rpId = options.rpId,
      up = true,
      uv = true,
      crossOrigin = false,
      topOrigin,
      challenge = options.challenge,
      type = 'webauthn.get',
    } = opts;
    if (!origin) throw new Error('getAssertion: an origin is needed');
    const allowed = new Set((options.allowCredentials ?? []).map((c) => c.id));
    const credential =
      opts.credential ??
      [...this.credentials].reverse().find((c) => c.rpId === (options.rpId ?? rpId) && (allowed.size === 0 || allowed.has(c.id)));
    if (!credential) throw new Error('NotAllowedError: no credential for these options');
    credential.counter = opts.counter ?? credential.counter + 1;
    const authData = concat(
      sha256(rpId),
      [flags({ up, uv, backupEligible: this.backupEligible, backedUp: this.backedUp })],
      u32(credential.counter),
    );
    const data = clientData({ type, challenge, origin, crossOrigin, topOrigin });
    const signature = sign('sha256', concat(authData, sha256(data)), credential.privateKey); // DER, as WebAuthn wants
    const userHandle = 'userHandle' in opts ? opts.userHandle : credential.userHandle;
    const response = {
      clientDataJSON: b64u(data),
      authenticatorData: b64u(authData),
      signature: b64u(signature),
    };
    if (userHandle !== null && userHandle !== undefined) response.userHandle = userHandle;
    return {
      id: credential.id,
      rawId: credential.id,
      type: 'public-key',
      response,
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
