import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';
import { appVersion, buildCommit, packageVersion } from './scripts/app-version.mjs';

// Served at the site root on Cloudflare Pages, alongside Functions at /api,
// /admin/api and /media — so absolute asset URLs (base '/') are correct, and
// nested entries like /admin resolve their bundles properly.
const root = fileURLToPath(new URL('.', import.meta.url));

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
        // A navigation fallback that answers /api/ with index.html is
        // exactly the SPA-fallback failure loadProject() had to be hardened
        // against: 200 + "<!doctype" where JSON was expected. Navigation
        // requests are the only ones routed here, but the API and the
        // editor are denied explicitly rather than by assumption.
        // /cdn-cgi/ is Cloudflare's own: Access hands a sign-in back through
        // /cdn-cgi/access/authorized, a navigation inside this worker's
        // scope, and answered with the app shell the token never reached the
        // edge, so no session cookie was ever set and the visitor landed on
        // the gallery. That is how the installed iPad app could not sign in.
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/media\//, /^\/cdn-cgi\//],
        runtimeCaching: [
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
            // Gallery card thumbnails, so the cards keep their pictures.
            urlPattern: /\/media\/.*\/thumb\.jpg/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bozzetto-thumbs',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
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
