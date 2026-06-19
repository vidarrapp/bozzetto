import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Builds the viewer as a single self-contained classic IIFE (three.js and all),
// emitted to dist/embed/. A classic script — not an ES module — is required so
// the single-file export runs from a file:// page. The single-file exporter
// (editor + CLI) inlines dist/embed/viewer.js and dist/embed/embed.css into the
// generated HTML. Run after the main `vite build` so it isn't wiped.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    // Match the main build: route bare `three` to the WebGPU build so the
    // self-contained embed renders with WebGPURenderer too (see vite.config.ts).
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: `${root}src/embed/main.ts`,
      name: 'BozzettoEmbed',
      formats: ['iife'],
      fileName: () => 'viewer.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'embed.css' },
    },
  },
});
