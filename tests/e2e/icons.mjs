// The icon font ships only the glyphs the app uses (src/assets/icons,
// scripts/build-icon-subset.py). This fails when source names an `fi-ss-*`
// class the subset stylesheet does not define - such an icon would draw
// nothing - and when the whole font is imported again. It reads files; it
// does not need the page.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ICONS = resolve('src/assets/icons');
const NAME = /\bfi-ss-([a-z0-9]+(?:-[a-z0-9]+)*)/g;

/** Every file under `path` (or `path` itself, a file) with one of the suffixes. */
function files(path, suffixes, out = []) {
  if (!existsSync(path)) return out;
  if (statSync(path).isFile()) {
    if (suffixes.some((s) => path.endsWith(s))) out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules') continue;
    files(join(path, name), suffixes, out);
  }
  return out;
}

export const suites = {
  async icons(_page, _base, t) {
    const css = readFileSync(join(ICONS, 'uicons-subset.css'), 'utf8');
    const defined = new Set([...css.matchAll(/\.fi-ss-([a-z0-9-]+):before\{content:"\\[0-9a-f]+"\}/g)].map((m) => m[1]));
    t.ok(defined.size > 0, `the subset stylesheet defines ${defined.size} icons`);

    const used = new Map();
    const whole = [];
    const sources = ['src', 'index.html', 'admin', 'create', 'public/legal'].flatMap((p) => files(resolve(p), ['.ts', '.css', '.html', '.svg']));
    for (const file of sources) {
      if (file.startsWith(ICONS)) continue;
      const text = readFileSync(file, 'utf8');
      const where = file.replace(`${resolve('.')}/`, '');
      for (const m of text.matchAll(NAME)) used.set(m[1], (used.get(m[1]) ?? new Set()).add(where));
      if (/^\s*(@import|import)\b[^\n]*@flaticon\/flaticon-uicons/m.test(text)) whole.push(where);
    }
    const missing = [...used].filter(([n]) => !defined.has(n)).map(([n, where]) => `fi-ss-${n} (${[...where].join(', ')})`);
    t.ok(used.size > 0, `the source names ${used.size} icons`);
    t.ok(!missing.length, `every icon class in the source is in the subset${missing.length ? `: missing ${missing.join('; ')}; run scripts/build-icon-subset.py` : ''}`);
    t.ok(!whole.length, `nothing imports the whole icon font${whole.length ? `: ${whole.join(', ')}` : ''}`);

    const font = /url\(\.\/([^)]+\.woff2)\)/.exec(css)?.[1];
    const bytes = font && existsSync(join(ICONS, font)) ? readFileSync(join(ICONS, font)) : null;
    t.ok(!!bytes && bytes.subarray(0, 4).toString('latin1') === 'wOF2', `the stylesheet's one font file is there, a woff2 (${font})`);
    t.ok(!/format\("(woff|truetype|embedded-opentype)"\)/.test(css), 'and it names no other format');
  },
};
