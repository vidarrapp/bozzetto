import { defineConfig } from 'vite';

// Static, CDN-friendly build. `base: './'` lets the app be hosted at any path;
// runtime asset URLs are resolved against import.meta.env.BASE_URL (see main.ts).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
