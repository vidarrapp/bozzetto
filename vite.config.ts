import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';
import { appVersion, buildCommit, packageVersion } from './scripts/app-version.mjs';

// Served at the site root on Cloudflare Pages, alongside Functions at /api,
// /admin/api, /m and /media — so absolute asset URLs (base '/') are correct,
// and nested entries like /admin resolve their bundles properly.
const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * The files host the test build names, standing in for files.vidarrapp.se,
 * so the browser suites can serve a template's thumbnail from another
 * origin and see the worker keep it (tests/e2e). `.test` is never a real
 * host.
 */
const TEST_MEDIA_ORIGIN = 'https://files.bozzetto.test';

/**
 * The files host's origin, VITE_MEDIA_ORIGIN at build time (docs/accounts.md
 * §11): where the server names its templates' files once its own
 * MEDIA_ORIGIN is set, and so a second place the worker keeps their
 * thumbnails from. Unset, the files are on this site's open routes, and
 * there is nothing more to match. Anything but an origin fails the build
 * rather than writing a rule that matches nothing.
 */
function mediaOrigin(mode: string): string {
  const raw = loadEnv(mode, root, 'VITE_').VITE_MEDIA_ORIGIN ?? (mode === 'test' ? TEST_MEDIA_ORIGIN : '');
  if (!raw) return '';
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    // reported below
  }
  if (!url || !/^https?:$/.test(url.protocol) || raw.replace(/\/$/, '') !== url.origin) {
    throw new Error(`VITE_MEDIA_ORIGIN must be an origin, such as https://files.vidarrapp.se (got "${raw}")`);
  }
  return url.origin;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The source path every page links the app's stylesheet by; a build names it by its hash. */
const STYLESHEET_SOURCE = '<link rel="stylesheet" href="/src/style.css" />';

/**
 * The legal pages (public/legal/*.html, docs/accounts.md §9) are static,
 * copied as they are, and link the app's stylesheet by its source path, as
 * the app's own pages do; the dev server serves it there. A build names
 * the stylesheet by its hash, so each page's link is pointed at what the
 * built index.html links - when the files are written, before the
 * worker's precache is listed (closeBundle), so the pages it keeps and
 * their revisions are the ones served. A page left unlinked fails the
 * build rather than going out unstyled.
 */
function legalPages(outDir: string): void {
  const dir = join(outDir, 'legal');
  if (!existsSync(dir)) return;
  const index = readFileSync(join(outDir, 'index.html'), 'utf8');
  const sheets = [...index.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)]
    .map((m) => /\bhref="([^"]+)"/.exec(m[0])?.[1])
    .filter((href): href is string => !!href && href.endsWith('.css'));
  if (sheets.length === 0) throw new Error('legal pages: the built index.html links no stylesheet');
  const links = sheets.map((href) => `<link rel="stylesheet" href="${href}" />`).join('\n    ');
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.html'))) {
    const file = join(dir, name);
    const html = readFileSync(file, 'utf8');
    if (!html.includes(STYLESHEET_SOURCE)) throw new Error(`legal pages: ${name} does not link ${STYLESHEET_SOURCE}`);
    writeFileSync(file, html.replace(STYLESHEET_SOURCE, links));
  }
}

/**
 * `--mode desktop` builds for the Electron shell. Four differences, all
 * forced by the shell rather than chosen:
 *   - No service worker. bozzetto://app IS a secure context, so the worker
 *     would happily register and then serve a stale precache inside an app
 *     that already ships its bytes on disk.
 *   - No sourcemaps: 8.5 MB of a 26 MB dist, for a build nobody debugs
 *     through devtools-over-the-wire.
 *   - No /admin entry. The desktop app has no editor; the publish flow
 *     imports src/admin/api.ts directly, which is unaffected.
 *   - A version.json beside the app, for the About panel: the main process
 *     is not built here, so it cannot have the version injected.
 */
export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  const media = desktop ? '' : mediaOrigin(mode);
  // Gallery thumbnails: kept once seen, refreshed behind the cached one.
  const thumbs = {
    cacheName: 'bozzetto-thumbs',
    expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
    cacheableResponse: { statuses: [200] },
  };
  return {
  base: '/',
  define: {
    // What the hotkey guide and the update notices say this build is
    // (scripts/app-version.mjs). Each build's own, so a deploy with no
    // version bump still reads differently from the one before it.
    __BOZZETTO_VERSION__: JSON.stringify(appVersion()),
  },
  plugins: [
    // The desktop app's About panel (electron/main.cjs) reads the version
    // from here, the commit being known only at build time.
    desktop && {
      name: 'bozzetto-version-file',
      generateBundle(): void {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: packageVersion(), commit: buildCommit() }),
        });
      },
    },
    // The demo timelapse is a synthetic test fixture - an icosphere
    // displaced by noise - and it ships nowhere: not in the desktop app,
    // where a bust nobody sculpted has no business in the user's own
    // gallery, and not on the live site, which has real work to show.
    //
    // The test suites boot through ?tl=demo, though: it is the only project
    // they can open without a backend. `--mode test` keeps it. A mode
    // rather than an env var because FOO=1 npm run build is Unix-only
    // syntax that fails outright on Windows, and this repo now builds
    // there. Vite copies public/ wholesale, so the fixture is removed after
    // the bundle is written rather than filtered on the way in.
    {
      name: 'bozzetto-legal-pages',
      apply: 'build' as const,
      writeBundle(options: { dir?: string }): void {
        legalPages(options.dir ?? `${root}${desktop ? 'dist-desktop' : 'dist'}`);
      },
    },
    mode !== 'test' && {
      name: 'bozzetto-drop-demo',
      closeBundle(): void {
        rmSync(`${root}${desktop ? 'dist-desktop' : 'dist'}/timelapses`, {
          recursive: true,
          force: true,
        });
      },
    },
    VitePWA({
      disable: desktop,
      // The manifest is hand-written in public/ and linked from every entry
      // html, so the plugin only supplies the service worker.
      injectRegister: null,
      manifest: false,
      // A new worker WAITS rather than taking over the pages that are open.
      // Taking over (skipWaiting + clientsClaim) swaps the precache under a
      // running page, and this app loads sculpt mode and the library by
      // dynamic import: the old page's next import() asks for a chunk hash
      // the new cache no longer holds and Pages no longer serves, and the
      // feature simply fails until a reload. serviceWorker.ts promotes the
      // waiting worker itself, on the gallery page, where a reload costs
      // nothing; a sculpt session keeps its worker to the end.
      registerType: 'prompt',
      workbox: {
        // The shell - JS, CSS, fonts and the small PNGs (matcaps, brush
        // stencils, base-mesh thumbnails, icons) - and what new work starts
        // from. Source maps and the demo timelapse stay out: precaching
        // either is bytes nobody needs offline.
        globPatterns: [
          '**/*.{js,css,html,svg,woff2}',
          'icons/**/*.png',
          'assets/**/*.png',
          // The four UI typefaces (~0.5 MB). Without them an offline open
          // falls back to system fonts unless the HTTP cache happens to
          // still hold them - the one visible difference between the
          // installed app online and offline.
          'assets/fonts/*.ttf',
          // The models and the default environment, from the first install
          // (owner request): the base-mesh library (about 9.5 MB over 28
          // files), the four mannequins (4 MB) and the Neutral studio HDRI
          // (1.5 MB). Kept only once used, they left an offline session
          // whose Create menu tiles failed and whose new armature came up
          // as blocks, its mannequin never fetched. The install grows from
          // about 4.6 MB to about 20 MB for it; the other five HDRIs stay
          // on demand (below).
          'assets/basemeshes/*.bzm',
          'assets/armature/*.glb',
          'assets/env/studio-neutral.hdr',
        ],
        // Nothing under /admin: Cloudflare Access answers a signed-out request
        // there with a redirect to its login on another origin, which a
        // precache fetch cannot follow, and one failed entry fails the whole
        // install. So a guest's worker never installed (no offline at all),
        // and an owner whose Access session had expired kept the last worker
        // they installed while signed in, never taking an update. The editor
        // needs the network for everything it does anyway.
        globIgnores: ['**/*.map', 'timelapses/**', 'admin/**'],
        // The plugin's default leaves everything under assets/ without a
        // revision, as if every name there carried a content hash, and
        // Workbox never fetches an unrevisioned entry again once it has
        // it. Vite's output does (name-hash.ext, flat in assets/); the
        // files public/ puts under assets/ keep their names through every
        // change, so a re-exported model would never have reached an
        // install that already had it. Only hashed names go without a
        // revision now. Everything else carries its content hash, so a
        // changed file changes the worker and every install fetches it
        // with the next update - which is what lets the models' URLs go
        // without a version of their own.
        dontCacheBustURLsMatching: /^assets\/[^/]+-[\w-]{8}\.\w+$/,
        // A request finds its precache entry by URL, and Workbox's defaults
        // ignore only utm_ and fbclid. The matcaps are asked for with a ?v=
        // cache-buster (ASSET_VERSION), so every one missed its entry and
        // went to the network - and offline, failed to load. Any precached
        // file requested with ?v= now finds its entry; the defaults stay.
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // Which navigations the worker answers with the app's shell, offline
        // or not: the root, with whatever query it was opened with - the
        // gallery, ?sculpt=1, ?armature=1, ?tl=<id> - and nothing else. Tested
        // against the path and the query together, hence the query in the
        // pattern. /create/ is answered by its own precached page
        // (create/index.html, which the precache finds for the bare
        // directory) before this fallback is asked; listed here, a query on
        // it would have been answered with the gallery's shell instead.
        //
        // It was a denylist (/api/, /admin/, /media/, /cdn-cgi/), and every
        // other path in scope got the shell: `//elsewhere.example/` too, a
        // path whose own address, used as a link, is another site. Listing
        // what is the app's means none of these is ever answered from here:
        // the API, whose JSON a shell answer replaces with "<!doctype"
        // (loadProject had to be hardened against that); the editor and
        // the media, Access-gated; and Cloudflare's /cdn-cgi/, through which
        // Access hands a sign-in back (/cdn-cgi/access/authorized) and signs
        // one out (/cdn-cgi/access/logout) - answered with the shell, the
        // installed iPad app could not sign in.
        navigateFallbackAllowlist: [/^\/(?:\?.*)?$/],
        runtimeCaching: [
          {
            // Never kept, online or off (docs/accounts.md §7): the sign-in
            // ceremonies (/api/auth/*), the account with its email address
            // and sessions (/api/me/account), everything it holds, the
            // address included (/api/me/export), and a member's private
            // files (/api/me/media/*). No rule below matches them, and this
            // one comes first, as the first rule that matches is the one
            // used, so none added later can: NetworkOnly goes to the network
            // and stores nothing.
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              /^\/api\/(?:auth\/|me\/(?:account|export)(?:\/|$)|me\/media\/)/.test(url.pathname),
            handler: 'NetworkOnly',
          },
          {
            // My projects (docs/accounts.md §7): the account's own list and
            // its projects' manifests, private. Network first, as the
            // owner's list below: online the live answer, so a scene saved a
            // moment ago is there and one deleted is gone (a 401 passes
            // through and is never stored, and the app drops this cache when
            // it sees one, or signs out, ownerCaches.ts); offline, the last
            // list stands in, so My projects still draws its cards, read
            // only. After the rule above, which keeps the files themselves
            // (/api/me/media/*) off every cache.
            urlPattern: ({ url }) =>
              url.origin === self.location.origin && /^\/api\/me\/projects(?:\/[^/]+)?$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bozzetto-my-projects',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The account signed in, with accounts on (docs/accounts.md §7):
            // the sign-in probe's answer then, with no address in it. Network
            // first, as the Access probe below: online the live answer (a 401
            // passes through and is never stored, and the app drops this
            // cache when it sees one, ownerCaches.ts); offline, or slower than
            // the timeout, the last one stands in, so an installed app keeps
            // its owner's and members' things. /api/me alone: the account's
            // details (/api/me/account) are never kept, by the rule above.
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname === '/api/me',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bozzetto-me',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // What the deployment is (/api/config): accounts on or off, where
            // passkeys work, the Turnstile key. The same for everyone, and
            // read before the sign-in probe, so offline the last answer says
            // which probe to trust; online the live one, so a switch made on
            // the server is seen at once.
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname === '/api/config',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bozzetto-config',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The sign-in probe. Everything owner-only (the gallery's
            // Projects chip, publishing) asks /admin/api/whoami at boot, and
            // offline the fetch throws, so the owner's own installed app
            // demoted them to a guest. Network first: online the answer is
            // always the live one (a 403, or Access's redirect to its login,
            // passes straight through and is never stored - only a 200 JSON
            // is); offline, or on a network slower than the timeout, the
            // last stored answer stands in. The redirect passes through only
            // because the app asks with redirect: 'manual' (net/origin.ts):
            // followed, it failed the fetch like a dropped connection, and
            // this cache answered "signed in" for a session that had expired.
            // Logging out therefore takes effect immediately online, and an
            // offline session keeps whichever state the last online one had.
            urlPattern: /\/admin\/api\/whoami$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bozzetto-whoami',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The other five HDRIs, 1.5 to 1.7 MB each: fetched on demand
            // and kept once seen, so an offline session has the environments
            // you actually used without another 8 MB on the install. The
            // default one is precached, and the precache answers first.
            urlPattern: /\/assets\/env\/.*\.hdr$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bozzetto-env',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            // The owner's list and manifests, private projects and scenes
            // included. Network first, unlike the public list below (whose
            // unanchored pattern would match these too, so this rule comes
            // first): a scene saved a moment ago in Sculpt must be on the
            // gallery when you get there, or its device copy would show in
            // its place as if it had never been uploaded. Offline, the last
            // list stands in, so the owner's cards still draw. GET only, as
            // every runtime route is by default.
            urlPattern: /\/admin\/api\/projects/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bozzetto-owner-projects',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The gallery list and each project's manifest. Stale-while-
            // revalidate so the gallery still renders its cards offline from
            // the last visit, and refreshes the moment there is a network.
            // Unanchored deliberately: Workbox tests runtimeCaching patterns
            // against the FULL url, so a /^\/api\// anchor never matches
            // https://host/api/... and the rule silently does nothing.
            // (navigateFallbackDenylist above is the opposite - it is tested
            // against the pathname, so its anchors there are correct.)
            urlPattern: /\/api\/projects/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bozzetto-projects',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Gallery card thumbnails, so the cards keep their pictures:
            // the open routes' on this site, and only those - /media, where
            // the server names a listed template's files while it has no
            // files host, and /m/, the files host's own path, which this
            // site answers too (docs/accounts.md §4). The pattern was
            // /\/media\/.*\/thumb\.jpg/, which also matched the owner's
            // gated route (/admin/api/media/<id>/thumb.jpg), so a private
            // project's picture was kept for thirty days whatever the
            // server's no-store said. A function, so the origin and the
            // path's start can both be said; the build writes it into the
            // worker as it stands.
            urlPattern: ({ url }) => url.origin === self.location.origin && /^\/(?:m|media)\/[^/]+\/thumb\.jpg$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: thumbs,
          },
          // And the files host's, when the build names one: the server
          // names a template's files there once it has MEDIA_ORIGIN. The
          // cards ask for those with CORS (crossorigin="anonymous"), so
          // the answer is a 200 the cache can keep, where a plain image
          // from another origin is opaque. A pattern rather than a
          // function, so the origin goes into the worker as written (a
          // function's own text is what the build copies, without this
          // file's variables); on another origin, Workbox takes a pattern's
          // match only from the start of the URL.
          ...(media
            ? [
                {
                  urlPattern: new RegExp(`^${escapeRegExp(media)}/m/[^/?#]+/thumb\\.jpg(?:\\?|$)`),
                  handler: 'StaleWhileRevalidate' as const,
                  options: thumbs,
                },
              ]
            : []),
        ],
      },
    }),
  ],
  resolve: {
    // The viewer renders with WebGPURenderer, so the bare `three` specifier must
    // resolve to the WebGPU build (a superset that also re-exports core three).
    // An exact-match regex leaves `three/tsl`, `three/webgpu` and the
    // `three/examples/jsm/*` addons resolving normally, so there's a single
    // three instance across app code and addons (no duplicate-module bugs).
    alias: [
      { find: /^three$/, replacement: 'three/webgpu' },
      // Vendored SculptGL modules import each other via this prefix (one
      // mechanical codemod from upstream's bare-root paths).
      { find: '@sculpt-vendor', replacement: `${root}src/sculpt/vendor` },
    ],
  },
  build: {
    target: 'es2020',
    sourcemap: !desktop,
    outDir: desktop ? 'dist-desktop' : 'dist',
    rollupOptions: {
      input: desktop
        ? { main: `${root}index.html`, create: `${root}create/index.html` }
        : {
            main: `${root}index.html`,
            admin: `${root}admin/index.html`,
            create: `${root}create/index.html`,
          },
    },
  },
  };
});
