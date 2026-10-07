// What the function suites share: who the owner is, the bytes they send,
// and the shapes they compare. The harness itself (servers, seeds, the
// runner) is check.mjs.

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
