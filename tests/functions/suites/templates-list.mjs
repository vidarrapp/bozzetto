// Which rows each side reaches (docs/accounts.md §1, §5). The gallery's
// list and manifests are the templates it lists: template = 1 AND
// visibility = 'public'. Owner tools reach every template and the owner's
// own projects - before the bootstrap, the rows no account owns - and
// never a member's. Some rows are seeded in SQL because no route makes
// them: a public row that is no template, and a member and their projects.
import { DATA, asOwner, ids, jpeg, pattern, same } from '../lib.mjs';

export const needs = ['off'];

const MEMBER = 'u-tlmember00000000000000000a';
const row = (id, title, visibility, template, owner, prefix, at) =>
  `('${id}', '${title}', 'timelapse', 4, '${DATA}', '${visibility}', ${template}, ${owner ? `'${owner}'` : 'NULL'}, ${prefix ? `'${prefix}'` : 'NULL'}, ${at}, ${at})`;

export const seed = {
  sql: `
INSERT INTO users (id, handle, email, webauthn_user_id, role, terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at)
  VALUES ('${MEMBER}', 'tlmember', 'tl-member@example.com', 'wa-tl-member', 'member', '2026-10', 0, 0, 0, 0);
INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at) VALUES
  ${row('tl-public-own', 'Public, but no template', 'public', 0, null, null, 3000)},
  ${row('tl-privatised', 'A privatised template', 'private', 1, null, null, 3001)},
  ${row('tl-member', 'A member project', 'private', 0, MEMBER, `users/${MEMBER}/projects/tl-member/`, 3002)},
  ${row('tl-member-public', 'A member project marked public', 'public', 0, MEMBER, `users/${MEMBER}/projects/tl-member-public/`, 3003)},
  ${row('tl-window', 'A template whose files are the member project', 'public', 1, null, `users/${MEMBER}/projects/tl-member/`, 3004)};
`,
};

export async function run({ checks, off }) {
  const { call } = off;
  const publicList = async () => (await call('GET', '/api/projects')).json ?? [];
  const ownerList = async () => (await call('GET', '/admin/api/projects', { headers: asOwner })).json ?? [];

  // --- the gallery's side -------------------------------------------------
  let t = checks('functions: the public list is the templates');
  let r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id: 'tl-made', title: 'Made public' } });
  t.ok(r.status === 201 && r.json?.visibility === 'public' && r.json?.template === true, `what owner tools publish is a template (${r.status} ${r.json?.visibility} ${r.json?.template})`);
  let list = await publicList();
  const made = list.find((p) => p.id === 'tl-made');
  t.ok(made?.template === true && made?.media === '/media/tl-made', `listed, marked a template, with the base its files are read from (${JSON.stringify(made && { template: made.template, media: made.media })})`);
  t.ok(list.length > 0 && list.every((p) => p.template === true && p.visibility === 'public' && p.media === `/media/${p.id}`), 'every project on the list is a public template, its files on /media');
  const listedOwn = (await ownerList()).filter((p) => p.template && p.visibility === 'public').map((p) => p.id);
  t.eq(ids(list).sort().join(','), listedOwn.sort().join(','), 'and the list is exactly the public templates owner tools see');
  for (const [id, why] of [
    ['tl-public-own', 'a public row that is no template'],
    ['tl-privatised', 'a privatised template'],
    ['tl-member-public', "a member's project, whatever its visibility says"],
  ]) {
    r = await call('GET', `/api/projects/${id}`);
    t.ok(!ids(list).includes(id) && r.status === 404, `${why} is neither listed nor found (${r.status})`);
  }
  const th = await call('POST', '/admin/api/projects/tl-public-own/thumb', { headers: asOwner, bytes: jpeg(3) });
  r = await call('GET', '/media/tl-public-own/thumb.jpg');
  const own = await call('GET', '/admin/api/media/tl-public-own/thumb.jpg', { headers: asOwner });
  t.ok(th.status === 201 && r.status === 404 && own.status === 200, `nor are its files on /media, though the owner reads them (${th.status}, ${r.status}, ${own.status})`);

  r = await call('PUT', '/admin/api/projects/tl-made', { headers: asOwner, json: { visibility: 'private' } });
  list = await publicList();
  t.ok(r.status === 200 && r.json?.template === true && !ids(list).includes('tl-made'), `a template made private stays one, privatised, and leaves the list (${r.status} ${r.json?.template})`);
  const gone = await Promise.all([call('GET', '/api/projects/tl-made'), call('GET', '/media/tl-made/thumb.jpg')]);
  t.ok(gone.every((g) => g.status === 404), `its manifest and files with it (${gone.map((g) => g.status).join(', ')})`);
  r = await call('PUT', '/admin/api/projects/tl-made', { headers: asOwner, json: { visibility: 'public' } });
  t.ok(r.status === 200 && ids(await publicList()).includes('tl-made'), `made public again, it is back (${r.status})`);
  r = await call('PUT', '/admin/api/projects/tl-public-own', { headers: asOwner, json: { visibility: 'public' } });
  t.ok(r.status === 200 && r.json?.template === true && ids(await publicList()).includes('tl-public-own'), `the owner's own project said public becomes a template, and is listed (${r.status} ${r.json?.template})`);
  t.report();

  // --- the owner's side ---------------------------------------------------
  t = checks("functions: owner tools reach templates and the owner's own");
  const owned = await ownerList();
  const has = (id) => ids(owned).includes(id);
  t.ok(has('tl-privatised') && has('tl-window') && has('tl-made'), 'the owner list has the templates, privatised ones included');
  const seeded = owned.find((p) => p.id === 'tl-privatised');
  t.ok(seeded?.template === true && seeded?.media === '/admin/api/media/tl-privatised', `each marked as one, a privatised one's files on the gated route (${JSON.stringify(seeded && { template: seeded.template, media: seeded.media })})`);
  t.ok(!has('tl-member') && !has('tl-member-public'), "and not a member's projects");
  const window = await call('POST', '/admin/api/projects/tl-window/thumb', { headers: asOwner, bytes: jpeg(9) });
  const planted = await call('GET', '/media/tl-window/thumb.jpg');
  t.ok(window.status === 201 && planted.status === 200 && same(planted.bytes, jpeg(9)), `a file is in the member's project folder, put there through a template that shares it (${window.status}, ${planted.status})`);
  const tries = [
    ['GET', '/admin/api/projects/tl-member', {}],
    ['PUT', '/admin/api/projects/tl-member', { json: { title: 'Taken' } }],
    ['POST', '/admin/api/projects/tl-member/frames?index=0', { bytes: pattern(64, 1) }],
    ['POST', '/admin/api/projects/tl-member/thumb', { bytes: jpeg(1) }],
    ['POST', '/admin/api/projects/tl-member/scene', {}],
    ['GET', '/admin/api/media/tl-member/thumb.jpg', {}],
    ['DELETE', '/admin/api/projects/tl-member', {}],
  ];
  const answers = [];
  for (const [method, path, opts] of tries) answers.push((await call(method, path, { headers: asOwner, ...opts })).status);
  t.ok(answers.every((s) => s === 404), `every owner route answers a member's project as one that is not there (${answers.join(', ')})`);
  r = await call('GET', '/media/tl-window/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, jpeg(9)), 'and none of it touched the files: the delete never reached them');
  r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id: 'tl-member' } });
  t.eq(r.status, 409, 'its id is still taken, though: ids are one namespace');
  t.report();
}
