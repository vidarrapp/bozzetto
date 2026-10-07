// GET /api/me/export (docs/accounts.md §3): everything the site keeps of an
// account as bozzetto-export/1 JSON - the account, its passkeys without
// their keys, its sessions without their tokens, its projects with their
// data and files (sizes, and URLs that serve them), and the audit rows
// about it - behind recent authentication, kept by no cache, and nothing
// of anyone else's.
import { Browser, bozz, glb, jpeg, same, seedCredential, seedSession, seedUser, seededToken, sha256hex } from '../lib.mjs';

export const needs = ['on'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const T = 3_100_000_000_000;
const ME = 'u-exme000000000000000000000';
const OTHER = 'u-exother0000000000000000000';

export const seed = {
  sql: [
    seedUser({ id: ME, handle: 'exme', at: T - 100 * HOUR }),
    seedUser({ id: OTHER, handle: 'exother' }),
    seedCredential({ credential: { id: 'ex-credential', cose: new Uint8Array([165, 1, 2, 3, 38]) }, user: ME, name: 'Laptop', at: T - 50 * HOUR }),
    seedSession({ name: 'ex-main', id: 's-exmain', user: ME, created: T }),
    seedSession({ name: 'ex-stale', id: 's-exstale', user: ME, created: T - HOUR, ua: 'Old browser' }),
    seedSession({ name: 'ex-gone', id: 's-exgone', user: ME, created: T - 2 * HOUR, revoked: T - HOUR }),
    seedSession({ name: 'ex-other', id: 's-exother', user: OTHER, created: T }),
    `INSERT INTO audit_log (at, actor, action, subject, detail) VALUES
      (${T - 10}, '${ME}', 'session.revoke', '${ME}', '{"session":"s-exgone"}'),
      (${T - 9}, '${OTHER}', 'passkey.add', '${OTHER}', '{}'),
      (${T - 8}, 'owner@example.com', 'project.template', 'some-project', '{}');`,
  ].join('\n'),
};

export async function run({ checks, on }) {
  const clock = { now: T + MINUTE };
  const as = (name, ip) => {
    const b = new Browser(on, { ip, clock });
    b.jar.set('__Host-bz_session', seededToken(name));
    return b;
  };
  const me = as('ex-main', '198.51.100.90');
  const other = as('ex-other', '198.51.100.91');

  let t = checks('functions: export, set up');
  const sc = (await me.call('POST', '/api/me/projects', { json: { title: 'Head', mode: 'scene' } })).json?.id;
  const reel = (await me.call('POST', '/api/me/projects', { json: { title: 'Reel', mode: 'timelapse', fps: 6 } })).json?.id;
  const sceneFile = bozz({ vertices: 60, seed: 51 });
  const up = (await me.call('POST', `/api/me/projects/${sc}/scene`, { json: { size: sceneFile.length } })).json;
  const p1 = await me.call('PUT', `/api/me/projects/${sc}/scene?upload=${up.uploadId}&part=1`, { bytes: sceneFile });
  const done = await me.call('POST', `/api/me/projects/${sc}/scene?upload=${up.uploadId}`, { json: { parts: [p1.json], objects: 1, tris: 9 } });
  const frames = [glb({ seed: 52 }), glb({ seed: 53, bin: 700 })];
  const results = [p1, done];
  for (const [i, f] of frames.entries()) results.push(await me.call('POST', `/api/me/projects/${reel}/frames?index=${i}`, { bytes: f }));
  results.push(await me.call('PUT', `/api/me/projects/${reel}`, { json: { frames: [{ index: 0, tris: 1 }, { index: 1, tris: 2 }], stages: [{ name: 'Start', frame: 0, desc: '' }] } }));
  const thumb = jpeg(54);
  results.push(await me.call('POST', `/api/me/projects/${reel}/thumb`, { bytes: thumb }));
  const theirs = (await other.call('POST', '/api/me/projects', { json: { title: 'Not mine', mode: 'model' } })).json?.id;
  t.ok(results.every((r) => r.status === 200 || r.status === 201) && !!theirs, `two projects with files, and someone else's (${results.map((r) => r.status).join(' ')})`);
  t.report();

  // --- who may ---------------------------------------------------------------------------------
  t = checks('functions: export, recent authentication');
  let r = await as('ex-stale', '198.51.100.92').call('GET', '/api/me/export');
  t.ok(r.status === 401 && r.json?.code === 'reauth', `a session not authenticated in 10 minutes: 401 reauth (${r.status} ${r.json?.code})`);
  r = await new Browser(on, { ip: '198.51.100.93', clock }).call('GET', '/api/me/export');
  t.ok(r.status === 401 && r.json?.code === 'signin', `no session: 401 signin (${r.status})`);
  t.report();

  // --- what it holds -----------------------------------------------------------------------------
  t = checks('functions: export, bozzetto-export/1');
  r = await me.call('GET', '/api/me/export');
  const x = r.json;
  t.ok(r.status === 200 && r.headers.get('cache-control') === 'private, no-store' && r.headers.get('content-type')?.startsWith('application/json'), `200 JSON, private, no-store (${r.status} ${r.headers.get('cache-control')})`);
  t.ok(x?.format === 'bozzetto-export/1' && x?.exportedAt === clock.now && x?.complete === true, `format, when, and complete (${x?.format} ${x?.complete})`);
  t.eq(Object.keys(x ?? {}).join(','), 'format,exportedAt,complete,account,passkeys,sessions,projects,audit', 'the sections of §3, in order');
  const a = x?.account;
  t.ok(a?.id === ME && a?.handle === 'exme' && a?.email === 'exme@example.com' && a?.role === 'member' && a?.status === 'active', `the account: id, handle, email, role, status (${JSON.stringify(a && { handle: a.handle, email: a.email })})`);
  t.ok(a?.createdAt === T - 100 * HOUR && a?.termsVersion === '2026-10' && typeof a?.termsAcceptedAt === 'number' && typeof a?.ageConfirmedAt === 'number', 'its dates and the terms it accepted');
  t.ok(a?.usage?.used === sceneFile.length + frames[0].length + frames[1].length + thumb.length && a?.usage?.quota === 262144000, `and its storage (${JSON.stringify(a?.usage)})`);
  t.eq(JSON.stringify(x?.passkeys), JSON.stringify([{ name: 'Laptop', createdAt: T - 50 * HOUR, lastUsedAt: null, deviceType: 'singleDevice', backedUp: false, aaguid: '00000000-0000-0000-0000-000000000000' }]), 'its passkeys: name, dates, type, AAGUID, and nothing of the key');
  const sessions = Object.fromEntries((x?.sessions ?? []).map((s) => [s.id, s]));
  t.ok(sessions['s-exmain']?.current === true && sessions['s-exstale']?.userAgent === 'Old browser' && sessions['s-exgone']?.revokedAt === T - HOUR && !sessions['s-exother'], `its sessions, revoked ones too, this one marked, no one else's (${Object.keys(sessions).join(', ')})`);
  t.eq(Object.keys(sessions['s-exmain'] ?? {}).join(','), 'id,client,userAgent,method,createdAt,lastSeenAt,expiresAt,revokedAt,current', 'each: {id, client, userAgent, method, createdAt, lastSeenAt, expiresAt, revokedAt, current}');
  const text = new TextDecoder().decode(r.bytes);
  t.ok(!text.includes(seededToken('ex-main')) && !text.includes(sha256hex(seededToken('ex-main'))) && !text.includes('wa-exme'), 'no token, token hash or WebAuthn user handle in it');
  const projects = Object.fromEntries((x?.projects ?? []).map((p) => [p.id, p]));
  t.ok(Object.keys(projects).length === 2 && projects[sc] && projects[reel] && !projects[theirs], `its two projects, not someone else's (${Object.keys(projects).length})`);
  const pr = projects[reel];
  t.ok(pr?.title === 'Reel' && pr?.mode === 'timelapse' && pr?.fps === 6 && pr?.visibility === 'private' && typeof pr?.createdAt === 'number', 'each with its metadata');
  t.ok(pr?.data?.stages?.[0]?.name === 'Start' && pr?.data?.frames?.length === 2 && typeof pr?.data === 'object', `its data, as JSON rather than text (${JSON.stringify(pr?.data?.frames)})`);
  t.eq(JSON.stringify((pr?.files ?? []).map((f) => [f.name, f.size])), JSON.stringify([['thumb.jpg', thumb.length], ['frames/sd/0000.glb', frames[0].length], ['frames/sd/0001.glb', frames[1].length]]), 'its files, by name under the project, with their sizes');
  t.eq(pr?.files?.[1]?.url, `/api/me/media/${reel}/frames/sd/0000.glb?download=1`, 'each with the private URL that serves it as a download');
  t.ok(pr?.bytes === thumb.length + frames[0].length + frames[1].length && projects[sc]?.files?.[0]?.name === 'scene.bozz' && projects[sc]?.files?.[0]?.size === sceneFile.length, 'the scene\'s file too, and what each project weighs');
  const fetched = await me.call('GET', projects[sc]?.files?.[0]?.url ?? '/none');
  t.ok(fetched.status === 200 && same(fetched.bytes, sceneFile) && fetched.headers.get('content-disposition')?.startsWith('attachment; filename="Head.bozz"'), `a file's URL gives the file (${fetched.status})`);
  const actions = (x?.audit ?? []).map((row) => `${row.action}:${row.subject}`);
  t.ok(actions.includes(`session.revoke:${ME}`) && !actions.some((s) => s.includes(OTHER) || s.includes('some-project')), `the audit rows about it, and no one else's (${actions.join(', ')})`);
  t.ok(typeof x?.audit?.[0]?.detail === 'object' && x?.audit?.[0]?.detail?.session === 's-exgone', 'each row\'s detail as JSON');
  t.report();
}
