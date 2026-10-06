// public/_routes.json (docs/accounts.md §2). With a root middleware, Pages
// would otherwise run Functions for every path, static files and all, each
// one billed; the file keeps them to the paths that have Functions. This
// checks the file says that, that every Function is still reachable under
// it, and that `wrangler pages dev` honours it: a static file never meets
// the middleware, which would refuse it on the files host.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { FILES_HOST } from '../lib.mjs';

export const needs = ['off'];

const EXPECTED = ['/api/*', '/admin/api/*', '/admin/login', '/media/*', '/m/*'];

/** wrangler's own rule matching (templates/pages-dev-util.ts), which Pages shares. */
function matches(pathname, rule) {
  let r;
  if (rule === '/' || rule === '/*') r = rule;
  else if (rule.endsWith('/*')) r = `${rule.slice(0, -2)}(/*)?`;
  else if (rule.endsWith('/')) r = `${rule.slice(0, -1)}(/)?`;
  else if (rule.endsWith('*')) r = rule;
  else r = `${rule}(/)?`;
  return new RegExp(`^${r.replaceAll('.', '\\.').replaceAll('*', '.*')}$`).test(pathname);
}

/** A path each Function file answers: its route with a sample value per parameter. */
function routeFiles(dir, root = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '_shared') out.push(...routeFiles(full, root));
    } else if (name.endsWith('.ts') && name !== '_middleware.ts') {
      const parts = relative(root, full).slice(0, -3).split(sep);
      if (parts.at(-1) === 'index') parts.pop();
      const path = `/${parts.map((p) => (p.startsWith('[[') ? 'a/b' : p.startsWith('[') ? 'x' : p)).join('/')}`;
      out.push({ file: relative(root, full), path });
    }
  }
  return out;
}

export async function run({ checks, off, repo }) {
  const t = checks('functions: _routes.json');
  const routes = JSON.parse(readFileSync(join(repo, 'public', '_routes.json'), 'utf8'));
  t.ok(routes.version === 1 && JSON.stringify(routes.include) === JSON.stringify(EXPECTED), `it includes exactly ${EXPECTED.join(', ')} (${JSON.stringify(routes.include)})`);
  t.ok(Array.isArray(routes.exclude) && routes.exclude.length === 0, 'and excludes nothing');
  const unreachable = routeFiles(join(repo, 'functions')).filter(({ path }) => !routes.include.some((rule) => matches(path, rule)));
  t.ok(unreachable.length === 0, `every Function file is under an include, or it would never run (${unreachable.map((u) => u.file).join(', ') || 'all are'})`);

  // On the files host the middleware answers 404 to anything but GET /m/*,
  // so a static file that came back there never went through it.
  let r = await off.callHost(FILES_HOST, 'GET', '/');
  t.ok(r.status === 200 && new TextDecoder().decode(r.bytes).includes('<title>check</title>'), `the static index is served as a file, never meeting the middleware (${r.status})`);
  r = await off.callHost(FILES_HOST, 'GET', '/probe.txt');
  t.ok(r.status === 200 && new TextDecoder().decode(r.bytes) === 'a static file', `and so is any other static file (${r.status})`);
  r = await off.callHost(FILES_HOST, 'GET', '/api/config');
  t.ok(r.status === 404, `an included path does meet it there, and is refused (${r.status})`);
  // On the app's host a cross-site write would be refused by it with JSON.
  r = await off.call('POST', '/probe.txt', { headers: { origin: 'https://evil.example' }, body: 'x', type: 'text/plain' });
  t.ok(r.json?.code !== 'cross_site', `a write to a static path is the static server's to answer, not the middleware's (${r.status})`);
  t.report();
}
