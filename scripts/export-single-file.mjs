/**
 * Export a static timelapse to one self-contained .html (viewer + manifest +
 * frames + assets inlined). Opens from file:// with no network.
 *
 * Usage:
 *   node scripts/export-single-file.mjs <id> [outFile]
 *
 * Reads public/timelapses/<id>/ and the inlined viewer bundle from dist/embed/
 * (run `npm run build` first). Writes <id>.html (or <outFile>) at the repo root.
 *
 * Shares its core with the editor's in-browser export: both call
 * buildSingleFileHtml from src/export/singleFile.js. Pure Node, no deps.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSingleFileHtml } from '../src/export/singleFile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');
const EMBED = join(ROOT, 'dist', 'embed');

// Mirror of the matcap set in src/viewer/Materials.ts (always embedded; the
// matcap material loads all four at startup).
const MATCAP_IDS = ['warm-clay', 'blue-grey', 'terracotta', 'silver'];

const [id, outArg] = process.argv.slice(2);
if (!id) {
  console.error('Usage: node scripts/export-single-file.mjs <id> [outFile]');
  process.exit(1);
}

const viewerJsPath = join(EMBED, 'viewer.js');
const cssPath = join(EMBED, 'embed.css');
if (!existsSync(viewerJsPath)) {
  console.error(`Missing ${viewerJsPath}. Run \`npm run build\` first.`);
  process.exit(1);
}

const projectDir = join(PUBLIC, 'timelapses', id);
const manifestPath = join(projectDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`No timelapse at ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const assets = [];
const add = (path, absFile) => {
  if (!existsSync(absFile)) {
    console.warn(`  (skipping missing asset ${path})`);
    return;
  }
  assets.push({ path, bytes: new Uint8Array(readFileSync(absFile)) });
};

// Frames, byte-for-byte. Keyed by the manifest's own (relative) paths.
for (const frame of manifest.frames ?? []) {
  add(frame.sd, join(projectDir, frame.sd));
}

// Matcaps (all four) and the selected HDRI, if any. Keys match the absolute
// paths the viewer requests these by.
for (const m of MATCAP_IDS) {
  add(`/assets/matcaps/${m}.png`, join(PUBLIC, 'assets', 'matcaps', `${m}.png`));
}
const envId = manifest.environment?.id;
if (envId) {
  add(`/assets/env/${envId}.hdr`, join(PUBLIC, 'assets', 'env', `${envId}.hdr`));
}

const html = buildSingleFileHtml({
  manifest,
  assets,
  viewerJs: readFileSync(viewerJsPath, 'utf8'),
  css: existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '',
  title: manifest.title,
});

const outFile = resolve(ROOT, outArg ?? `${id}.html`);
writeFileSync(outFile, html);

const mb = (html.length / 1e6).toFixed(2);
console.log(`Wrote ${outFile} (${mb} MB, ${assets.length} assets) — open it directly in a browser.`);
