import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Served at the site root on Cloudflare Pages, alongside Functions at /api,
// /admin/api and /media — so absolute asset URLs (base '/') are correct, and
// nested entries like /admin resolve their bundles properly.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: '/',
  define: {
    // The app builds include the editor, so ship the reel capture pipeline.
    __REEL_CAPTURE__: JSON.stringify(true),
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
