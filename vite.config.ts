import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Served at the site root on Cloudflare Pages, alongside Functions at /api,
// /admin/api and /media — so absolute asset URLs (base '/') are correct, and
// nested entries like /admin resolve their bundles properly.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: '/',
  resolve: {
    // The viewer renders with WebGPURenderer, so the bare `three` specifier must
    // resolve to the WebGPU build (a superset that also re-exports core three).
    // An exact-match regex leaves `three/tsl`, `three/webgpu` and the
    // `three/examples/jsm/*` addons resolving normally, so there's a single
    // three instance across app code and addons (no duplicate-module bugs).
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
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
