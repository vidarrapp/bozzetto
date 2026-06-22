/**
 * Shared single-file export core. Pure: no DOM and no Node APIs, so the same
 * implementation backs both the editor (browser) and the CLI (Node), the way
 * glb.ts backs the worker and the obj-to-timelapse script.
 *
 * It base64-wraps each asset byte-for-byte (frames are never re-encoded),
 * builds the `{ manifest, assets }` registry keyed by the manifest's existing
 * paths, and emits one HTML document with the registry and the viewer IIFE
 * inlined. The result opens from file:// with no network.
 *
 * @typedef {{ path: string, bytes: Uint8Array }} Asset
 * @typedef {{ manifest: unknown, assets: Asset[], viewerJs: string, css?: string, title?: string }} SingleFileInput
 */

const B64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64-encode bytes without btoa/Buffer, so it runs anywhere. */
function bytesToBase64(bytes) {
  const out = [];
  let i = 0;
  const len = bytes.length;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]);
  }
  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out.push(B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==');
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out.push(B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=');
  }
  return out.join('');
}

/**
 * Neutralise `</script` (which would close the inline tag) and the U+2028 /
 * U+2029 separators (illegal raw in a string literal) inside inlined data.
 */
function escapeForScript(s) {
  return s
    .replace(/<\/(script)/gi, '<\\/$1')
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

/**
 * Build the self-contained HTML document.
 * @param {SingleFileInput} input
 * @returns {string}
 */
export function buildSingleFileHtml({ manifest, assets, viewerJs, css = '', title }) {
  /** @type {Record<string, string>} */
  const encoded = {};
  for (const { path, bytes } of assets) {
    // Key without any `?query` so a cache-busting matcap `?v=` (or a versioned
    // frame path) still matches what the embedded viewer asks for.
    encoded[path.replace(/[?#].*$/, '')] = bytesToBase64(bytes);
  }

  const registry = { manifest, assets: encoded };
  const registryJson = escapeForScript(JSON.stringify(registry));
  const manifestTitle =
    manifest && typeof manifest === 'object' && 'title' in manifest
      ? String(/** @type {{ title: unknown }} */ (manifest).title)
      : 'Bozzetto';
  const docTitle = escapeHtml(title || manifestTitle);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>${docTitle}</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="app">
      <div id="viewport"></div>
      <div id="overlay" class="overlay"><div class="overlay__msg">Loading…</div></div>
    </div>
    <script>window.__BOZZETTO__=${registryJson};</script>
    <script>${escapeForScript(viewerJs)}</script>
  </body>
</html>
`;
}
