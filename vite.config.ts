import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';

// Served at the site root on Cloudflare Pages, alongside Functions at /api,
// /admin/api and /media — so absolute asset URLs (base '/') are correct, and
// nested entries like /admin resolve their bundles properly.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: '/',
  plugins: [
    VitePWA({
      // The manifest is hand-written in public/ and linked from every entry
      // html, so the plugin only supplies the service worker.
      injectRegister: null,
      manifest: false,
      registerType: 'autoUpdate',
      workbox: {
        // The shell, and only the shell: ~3 MB of JS, CSS and the small
        // PNGs (matcaps, brush stencils, icons). Source maps and the demo
        // timelapse are deliberately out - precaching either would triple
        // the install for bytes nobody needs offline.
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'icons/**/*.png', 'assets/**/*.png'],
        globIgnores: ['**/*.map', 'timelapses/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // A navigation fallback that answers /api/ with index.html is
        // exactly the SPA-fallback failure loadProject() had to be hardened
        // against: 200 + "<!doctype" where JSON was expected. Navigation
        // requests are the only ones routed here, but the API and the
        // editor are denied explicitly rather than by assumption.
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/media\//],
        runtimeCaching: [
          {
            // HDRIs are 1.5 MB each and there are six. Fetched on demand and
            // kept once seen, so an offline session has the environments you
            // actually used without a 9 MB install.
            urlPattern: /\/assets\/env\/.*\.hdr$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bozzetto-env',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
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
    sourcemap: true,
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        admin: `${root}admin/index.html`,
        create: `${root}create/index.html`,
      },
    },
  },
});
