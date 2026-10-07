// What the function suites share: who the owner is, the bytes they send,
// and the shapes they compare. The harness itself (servers, seeds, the
// runner) is check.mjs.
import { createHash } from 'node:crypto';

/** The one identity ADMIN_EMAILS lets through, as Access would name it. */
export const OWNER = 'owner@example.com';
export const asOwner = { 'cf-access-authenticated-user-email': OWNER };
export const asStranger = { 'cf-access-authenticated-user-email': 'someone@example.com' };
export const MiB = 1024 * 1024;

/** The files host the harness sets as MEDIA_ORIGIN, asked for by Host header. */
export const FILES_HOST = 'files.example';
/** A deployed host name: not loopback, so Access must vouch for an admin there. */
export const DEPLOYED_HOST = 'bozzetto.example';

/** Bytes nobody would mistake for others: a counter pattern from a seed. */
export function pattern(length, seed) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed) & 255;
  return out;
}

export const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** A thumbnail: it must open like a JPEG (FF D8 FF); what follows is not checked. */
export const jpeg = (seed, length = 508) => concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), pattern(length, seed));

export const ids = (list) => (Array.isArray(list) ? list.map((p) => p.id) : []);

/** A project's `data` column as createProject writes it, for rows the suites seed in SQL. */
export const DATA = JSON.stringify({
  defaults: { frame: 0, playing: true, material: 'lit', lightingPreset: 'three_point' },
  camera: { autoFrame: true },
  stages: [],
  frames: [],
});

/** The same with one frame listed, so a manifest has a frame path to show. */
export const DATA_ONE_FRAME = JSON.stringify({ ...JSON.parse(DATA), frames: [{ index: 0, tris: 12 }] });

/**
 * A fresh SQLite in memory with every migration applied and foreign keys
 * enforced, as D1 enforces them; null where this Node has no node:sqlite
 * (22.13 and later have it), and the suite skips what needed it.
 */
export async function migratedDatabase(repo) {
  let sqlite;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    return null;
  }
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(join(repo, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(repo, 'migrations', f), 'utf8'));
  }
  return db;
}

/**
 * A D1 binding over a node:sqlite database, for the suites that hand
 * functions/_shared an env of their own: prepare, bind, first, all, run and
 * batch, as the Functions use them. A batch is one transaction, as D1's is.
 * `beforeBatch`, when given, runs just ahead of each batch, so a suite can
 * change a row between a function's read and its write.
 */
export function d1(db, { beforeBatch } = {}) {
  const plain = (row) => (row ? { ...row } : row);
  const statement = (sql, binds = []) => ({
    bind: (...values) => statement(sql, values),
    first: async (column) => {
      const row = db.prepare(sql).get(...binds);
      if (row === undefined) return null;
      return column === undefined ? plain(row) : (row[column] ?? null);
    },
    all: async () => ({ results: db.prepare(sql).all(...binds).map(plain), success: true, meta: {} }),
    run: async () => {
      const info = db.prepare(sql).run(...binds);
      return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      beforeBatch?.();
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

// --- accounts: browsers, cookies and seeded rows -----------------------------------

const DAY = 24 * 60 * 60 * 1000;

/** A cookie as Set-Cookie states it: its name and value, and its attributes by lower-cased name. */
export function parseSetCookie(header) {
  const [pair, ...attrs] = header.split(';').map((s) => s.trim());
  const eq = pair.indexOf('=');
  const out = { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs: {} };
  for (const a of attrs) {
    const i = a.indexOf('=');
    out.attrs[(i < 0 ? a : a.slice(0, i)).toLowerCase()] = i < 0 ? true : a.slice(i + 1);
  }
  return out;
}

/** Every Set-Cookie of a response the harness made (through fetch), parsed. */
export const setCookies = (r) => (r.headers.getSetCookie?.() ?? []).map(parseSetCookie);

/**
 * A browser for the accounts suites: a cookie jar over one server, the
 * address it is seen from (CF-Connecting-IP, which miniflare passes on
 * when a client sends it, so each suite has rate-limit buckets of its
 * own), a user agent, and a clock (X-Test-Now) the suite moves. `call`
 * sends the jar's cookies and keeps what comes back; Max-Age=0 removes.
 */
export class Browser {
  constructor(server, { ip = '203.0.113.1', ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', clock } = {}) {
    this.server = server;
    this.ip = ip;
    this.ua = ua;
    /** {now}: shared between the browsers of a suite, so they live at one time. */
    this.clock = clock ?? { now: Date.now() };
    this.jar = new Map();
  }

  /** The browser's origin, as the server's APP_ORIGIN names it. */
  get origin() {
    return `http://localhost:${this.server.port}`;
  }

  cookie(name) {
    return this.jar.get(name) ?? null;
  }

  async call(method, path, opts = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const headers = {
      'cf-connecting-ip': this.ip,
      'user-agent': this.ua,
      'x-test-now': String(this.clock.now),
      ...(cookie ? { cookie } : {}),
      ...opts.headers,
    };
    const r = await this.server.call(method, path, { ...opts, headers });
    for (const c of setCookies(r)) {
      if (c.attrs['max-age'] === '0') this.jar.delete(c.name);
      else this.jar.set(c.name, c.value);
    }
    return r;
  }
}

/** SQL text for a value: NULL, a number, a quoted string, or a blob. */
function sql(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (v instanceof Uint8Array) return `x'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** A session cookie's token, made up from a name so a suite can seed it and send it. */
export const seededToken = (name) => `bz1_${createHash('sha256').update(`seed:${name}`).digest('base64url')}`;
export const sha256hex = (text) => createHash('sha256').update(text).digest('hex');

/** An account, as registration would have made it. */
export function seedUser({ id, handle, email = `${handle}@example.com`, webauthn = `wa-${handle}`, role = 'member', status = 'active', quota = 262144000, used = 0, at = 0 }) {
  return `INSERT INTO users (id, handle, email, webauthn_user_id, role, status, quota_bytes, bytes_used, terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at)
  VALUES (${[id, handle, email, webauthn, role, status, quota, used, '2026-10', at, at, at, at].map(sql).join(', ')});`;
}

/** A session, signed in at `created`, with the token seededToken(name) makes. */
export function seedSession({ name, id, user, created, lastSeen = created, reauth = created, expires = created + 90 * DAY, revoked = null, method = 'passkey', client = 'web', ua = null }) {
  return `INSERT INTO sessions (id, token_hash, user_id, method, client, user_agent, created_at, last_seen_at, reauth_at, expires_at, revoked_at)
  VALUES (${[id, sha256hex(seededToken(name)), user, method, client, ua, created, lastSeen, reauth, expires, revoked].map(sql).join(', ')});`;
}

/** A passkey, from the authenticator's seed(): its id and COSE key. */
export function seedCredential({ credential, user, name = 'Seeded passkey', counter = 0, at = 0 }) {
  return `INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up, aaguid, name, created_at)
  VALUES (${[credential.id, user, credential.cose, counter, '["internal"]', 'singleDevice', 0, '00000000-0000-0000-0000-000000000000', name, at].map(sql).join(', ')});`;
}

// --- accounts: invites, mail and codes ------------------------------------------------

/** An invite link's token (16 bytes, base64url), made up from a name so a suite can seed it and send it. */
export const inviteToken = (name) => createHash('sha256').update(`invite:${name}`).digest('base64url').slice(0, 22);

/** An invite, as the owner's tools would have made it (Batch 6), with the token inviteToken(name) makes. */
export function seedInvite({ id, name, maxUses = 1, uses = 0, created = 0, expires, revoked = null, label = '' }) {
  return `INSERT INTO invites (id, token_hash, label, max_uses, uses, created_by, created_at, expires_at, revoked_at)
  VALUES (${[id, sha256hex(inviteToken(name)), label, maxUses, uses, null, created, expires, revoked].map(sql).join(', ')});`;
}

/** What the stub mailer wrote for one address, oldest first: {id, at, to, subject, body} each. */
export async function outbox(server, to) {
  const r = await server.call('GET', `/api/dev/outbox?to=${encodeURIComponent(to)}`);
  return r.json?.rows ?? [];
}

/** The code a code mail carries in its subject, or null. */
export const codeIn = (row) => /^(\d{6}) is your Bozzetto code$/.exec(row?.subject ?? '')?.[1] ?? null;

/** The token of the sign-in link a code mail carries, or null. */
export const linkIn = (row) => /\/\?link=([A-Za-z0-9_-]{43}) /.exec(row?.body ?? '')?.[1] ?? null;

/** An account's users row as stored (GET /api/dev/user), or null. */
export async function storedUser(server, { id, email }) {
  const q = id ? `id=${encodeURIComponent(id)}` : `email=${encodeURIComponent(email)}`;
  return (await server.call('GET', `/api/dev/user?${q}`)).json?.user ?? null;
}

/** The audit rows about one subject, oldest first (GET /api/dev/audit). */
export async function auditRows(server, subject) {
  return (await server.call('GET', `/api/dev/audit?subject=${encodeURIComponent(subject)}`)).json?.rows ?? [];
}

/**
 * What the server itself logged, without wrangler's own request lines: the
 * mail suites check no address is ever in it.
 */
export const workerLog = (server) =>
  server.log
    .split('\n')
    .filter((line) => !line.includes('[wrangler:'))
    .join('\n');
