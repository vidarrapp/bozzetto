// migrations/0003_accounts.sql (docs/accounts.md §1), two ways.
//
// On a fresh SQLite in Node (node:sqlite, Node 22.13 and later): 0001 and
// 0002, rows as 0.5.5 wrote them, then 0003 a statement at a time, as the
// D1 console runs it - and what it then holds, refuses and cascades, with
// foreign keys enforced as D1 enforces them.
//
// On the servers: the harness applies the migrations in two steps with
// this suite's 0.5 rows between them, and a file R2 held for one before.
// What the API makes of them is what production's gallery will show.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, DATA_ONE_FRAME, asOwner, ids, jpeg, same } from '../lib.mjs';

export const needs = ['off'];

const legacyRow = (id, title, mode, data, visibility, at) =>
  `('${id}', '${title}', '${mode}', 4, '${data}', '${visibility}', ${at}, ${at})`;

/** What 0.5.5 wrote: no column 0003 adds. */
const LEGACY = `
INSERT INTO projects (id, title, mode, fps, data, visibility, created_at, updated_at) VALUES
  ${legacyRow('mig-reel', 'A 0.5 reel', 'timelapse', DATA_ONE_FRAME, 'public', 1000)},
  ${legacyRow('mig-model', 'A 0.5 model', 'model', DATA, 'public', 1001)},
  ${legacyRow('mig-scene', 'A 0.5 scene', 'scene', DATA, 'private', 1002)},
  ${legacyRow('mig-hidden', 'A 0.5 private reel', 'timelapse', DATA, 'private', 1003)};
`;
const LEGACY_THUMB = jpeg(77);

export const seed = {
  legacy: LEGACY,
  r2: [{ key: 'projects/mig-reel/thumb.jpg', bytes: LEGACY_THUMB, type: 'image/jpeg' }],
};

/**
 * SQL split into statements where SQLite would split it: at semicolons
 * outside strings, quoted names and comments.
 */
function statements(sql) {
  const out = [];
  let start = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      i = sql.indexOf(c, i + 1);
      if (i < 0) break;
    } else if (c === '-' && sql[i + 1] === '-') {
      i = sql.indexOf('\n', i);
      if (i < 0) break;
    } else if (c === '/' && sql[i + 1] === '*') {
      i = sql.indexOf('*/', i + 2) + 1;
      if (i <= 0) break;
    } else if (c === ';') {
      out.push(sql.slice(start, i + 1));
      start = i + 1;
    }
  }
  const tail = sql.slice(start).replace(/--[^\n]*/g, '').trim();
  if (tail) out.push(tail);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** What a statement does, by its first words once its leading comments are gone. */
const verb = (stmt) => stmt.replace(/^(\s*--[^\n]*\n)*/, '').trim().split(/\s+/).slice(0, 3).join(' ').toUpperCase();

export async function run({ checks, off, repo }) {
  const migration = (name) => readFileSync(join(repo, 'migrations', name), 'utf8');
  const sql = migration('0003_accounts.sql');

  // --- on a fresh SQLite ----------------------------------------------------
  let t = checks('functions: 0003 on a fresh SQLite');
  let sqlite = null;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the SQL-level checks did not run');
  }
  if (sqlite) {
    const db = new sqlite.DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(migration('0001_init.sql'));
    db.exec(migration('0002_visibility.sql'));
    db.exec(LEGACY);
    const parts = statements(sql);
    const naive = sql.split(';').map((s) => s.replace(/--[^\n]*/g, '').trim()).filter(Boolean);
    t.eq(naive.length, parts.length, 'no semicolon hides in a comment or a string, so splitting at each one splits where SQLite does');
    const kinds = parts.map(verb);
    t.ok(!kinds.some((k) => /TRIGGER|^BEGIN|^COMMIT|^ROLLBACK|^PRAGMA|^DROP|^DELETE/.test(k)), `nothing but additions: no trigger, transaction, pragma, drop or delete (${[...new Set(kinds.map((k) => k.split(' ').slice(0, 2).join(' ')))].join(', ')})`);
    const failed = [];
    for (const stmt of parts) {
      try {
        db.exec(stmt);
      } catch (err) {
        failed.push(`${verb(stmt)}: ${err.message}`);
      }
    }
    t.ok(failed.length === 0, `each of its ${parts.length} statements runs alone, after 0001 and 0002 and 0.5 rows (${failed.join('; ') || 'all ran'})`);
    const all = (q, ...a) => db.prepare(q).all(...a);
    const one = (q, ...a) => db.prepare(q).get(...a);
    const flags = Object.fromEntries(all('SELECT id, template FROM projects').map((r) => [r.id, r.template]));
    t.ok(flags['mig-reel'] === 1 && flags['mig-model'] === 1 && flags['mig-scene'] === 0 && flags['mig-hidden'] === 0, `every public project became a template, and no private one did (${JSON.stringify(flags)})`);
    const gallery = all("SELECT id FROM projects WHERE template = 1 AND visibility = 'public' ORDER BY created_at DESC").map((r) => r.id);
    const before = all("SELECT id FROM projects WHERE visibility = 'public' ORDER BY created_at DESC").map((r) => r.id);
    t.eq(gallery.join(','), before.join(','), 'so the gallery shows the set, in the order, it showed before');
    const added = one("SELECT COUNT(*) AS n FROM projects WHERE owner_id IS NULL AND storage_prefix IS NULL AND bytes = 0 AND moderation = 'none'").n;
    t.eq(added, 4, 'the old rows have no owner, the legacy prefix, no bytes counted and no moderation');
    const plan = all("EXPLAIN QUERY PLAN SELECT id FROM projects WHERE template = 1 AND visibility = 'public' ORDER BY created_at DESC")
      .map((r) => r.detail)
      .join(' / ');
    t.ok(plan.includes('idx_projects_template') && !plan.includes('TEMP B-TREE'), `the gallery's query is read off its index, in order (${plan})`);

    // 0.5.5 runs on it: its own statements, unchanged.
    let ok055 = true;
    try {
      db.prepare('INSERT INTO projects (id, title, mode, fps, data, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('v055-new', 'New in 0.5.5', 'timelapse', 4, DATA, 'public', 2000, 2000);
      db.prepare('UPDATE projects SET title = ?, mode = ?, fps = ?, data = ?, visibility = ?, updated_at = ? WHERE id = ?').run('Renamed', 'timelapse', 4, DATA, 'private', 2001, 'v055-new');
      all("SELECT id, title, mode, fps, updated_at, visibility, COALESCE(json_array_length(data, '$.frames'), 0) AS frameCount FROM projects WHERE visibility = 'public' ORDER BY created_at DESC");
      db.prepare('DELETE FROM projects WHERE id = ?').run('v055-new');
    } catch (err) {
      ok055 = `${err.message}`;
    }
    t.eq(ok055, true, "0.5.5's own insert, update, list and delete run on it unchanged");

    /** Whether a statement is refused. */
    const refused = (q, ...a) => {
      try {
        db.prepare(q).run(...a);
        return false;
      } catch {
        return true;
      }
    };
    const user = (id, handle, email, role = 'member') =>
      db
        .prepare("INSERT INTO users (id, handle, email, webauthn_user_id, role, terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2026-10', 0, 0, 0, 0)")
        .run(id, handle, email, `wa-${id}`, role);
    user('u-owner', 'owner', 'owner@example.com', 'owner');
    user('u-member', 'member', 'member@example.com');
    t.ok(refused("UPDATE projects SET template = 2 WHERE id = 'mig-reel'"), 'template is 0 or 1');
    t.ok(refused("INSERT INTO users (id, handle, email, webauthn_user_id, role, terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at) VALUES ('u-x', 'x1x', 'x@example.com', 'wa-x', 'admin', '2026-10', 0, 0, 0, 0)"), 'a role outside owner, moderator and member is refused');
    t.ok(refused("UPDATE users SET role = 'owner' WHERE id = 'u-member'"), 'and a second owner');
    t.ok(refused("INSERT INTO users (id, handle, email, webauthn_user_id, terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at) VALUES ('u-y', 'MEMBER', 'y@example.com', 'wa-y', '2026-10', 0, 0, 0, 0)"), 'a handle taken in other capitals is taken');
    t.ok(refused("INSERT INTO users (id, handle, email, webauthn_user_id, terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at) VALUES ('u-z', 'zed', 'Member@Example.com', 'wa-z', '2026-10', 0, 0, 0, 0)"), 'and so is an address');
    t.ok(refused("UPDATE users SET bytes_used = -1 WHERE id = 'u-member'"), 'usage never goes below nothing');
    db.prepare("INSERT INTO invites (id, token_hash, max_uses, created_by, created_at, expires_at) VALUES ('i-1', 'h-1', 1, 'u-owner', 0, 1)").run();
    t.ok(refused("UPDATE invites SET uses = uses + 1 WHERE id = 'i-1'") === false && refused("UPDATE invites SET uses = uses + 1 WHERE id = 'i-1'"), 'an invite is used up at its limit, and not past it');
    t.ok(refused("INSERT INTO invites (id, token_hash, max_uses, created_at, expires_at) VALUES ('i-2', 'h-2', 0, 0, 1)"), 'and allows from 1 to 500 uses');
    t.ok(refused("UPDATE projects SET owner_id = 'u-nobody' WHERE id = 'mig-scene'"), 'a project cannot be owned by an account that does not exist');
    db.prepare("UPDATE projects SET owner_id = 'u-member' WHERE id = 'mig-scene'").run();
    t.ok(refused("DELETE FROM users WHERE id = 'u-member'"), 'nor an account deleted while it owns projects (R2 is cleared first)');
    db.prepare("INSERT INTO credentials (id, user_id, public_key, device_type, name, created_at) VALUES ('c-1', 'u-owner', x'00', 'singleDevice', 'Key', 0)").run();
    db.prepare("INSERT INTO sessions (id, token_hash, user_id, method, created_at, last_seen_at, reauth_at, expires_at) VALUES ('s-1', 't-1', 'u-owner', 'passkey', 0, 0, 0, 1)").run();
    db.prepare("DELETE FROM users WHERE id = 'u-owner'").run();
    t.eq(one("SELECT (SELECT COUNT(*) FROM credentials) + (SELECT COUNT(*) FROM sessions) AS n").n, 0, "an account's passkeys and sessions go with it");
    db.prepare("INSERT INTO pending_uploads (id, r2_upload_id, project_id, user_id, file, declared_bytes, created_at) VALUES ('pu-1', 'r2-1', 'mig-scene', 'u-member', 'scene.bozz', 10, 0)").run();
    db.prepare("INSERT INTO upload_parts (upload_id, part, user_id, bytes) VALUES ('pu-1', 1, 'u-member', 10)").run();
    t.ok(refused("INSERT INTO pending_uploads (id, r2_upload_id, project_id, file, declared_bytes, created_at) VALUES ('pu-2', 'r2-2', 'mig-scene', 'scene.bozz', 10, 0)"), 'one upload at a time per file of a project');
    db.prepare("DELETE FROM projects WHERE id = 'mig-scene'").run();
    t.eq(one('SELECT (SELECT COUNT(*) FROM pending_uploads) + (SELECT COUNT(*) FROM upload_parts) AS n').n, 0, "a project's uploads in progress, and their parts, go with it");

    // A console run that stopped halfway can be run again from the top: only
    // the column additions, already made, are refused the second time.
    const again = parts.filter((stmt) => {
      try {
        db.exec(stmt);
        return false;
      } catch {
        return true;
      }
    });
    t.ok(again.length === 5 && again.every((s) => verb(s).startsWith('ALTER TABLE PROJECTS')), `run twice, only its five ALTER TABLE statements fail (${again.map(verb).join(', ')})`);
    db.close();
  }
  t.report();

  // --- what the servers made of 0.5's rows ------------------------------------
  t = checks('functions: 0.5 rows through 0003');
  const list = (await off.call('GET', '/api/projects')).json ?? [];
  const listed = ids(list);
  t.ok(listed.includes('mig-reel') && listed.includes('mig-model') && !listed.includes('mig-scene') && !listed.includes('mig-hidden'), `the gallery lists the 0.5 public projects and not the private ones (${listed.filter((id) => id.startsWith('mig-')).join(', ')})`);
  const migs = list.filter((p) => p.id.startsWith('mig-'));
  t.ok(migs.length === 2 && migs.every((p) => p.template === true), `each now a template (${migs.map((p) => `${p.id}: ${p.template}`).join(', ')})`);
  const owned = Object.fromEntries(((await off.call('GET', '/admin/api/projects', { headers: asOwner })).json ?? []).map((p) => [p.id, `${p.visibility}/${p.template}`]));
  t.ok(owned['mig-scene'] === 'private/false' && owned['mig-hidden'] === 'private/false' && owned['mig-reel'] === 'public/true', `owner tools still reach all four: the private ones as the owner's own (${['mig-reel', 'mig-scene', 'mig-hidden'].map((id) => owned[id]).join(', ')})`);
  let r = await off.call('GET', '/api/projects/mig-reel');
  t.ok(r.status === 200 && r.json?.template === true && r.json?.media === '/media/mig-reel' && r.json?.frames?.[0]?.sd?.startsWith('/media/mig-reel/frames/sd/0000.glb?v='), `its manifest says so, with its files where they always were (${r.json?.media}, ${r.json?.frames?.[0]?.sd})`);
  r = await off.call('GET', '/media/mig-reel/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, LEGACY_THUMB), `a file 0.5 stored under projects/<id>/ is served from there: nothing moved (${r.status})`);
  t.report();
}
