/**
 * Links that leave the app.
 *
 * shell.openExternal hands a URL to whatever the OS has registered for its
 * scheme, and an OS has handlers for far more than web pages: file: opens
 * or runs a local file, smb: mounts a share somewhere on the network, and
 * Windows ships protocol handlers that have been used to run code. A page
 * that can choose what reaches the OS can do all of that. So only the
 * kinds of link the app has a reason to show go out - https: pages,
 * mailto: addresses, and plain http: to this machine, which is where a
 * server you run yourself answers (the "open it" after publishing to it) -
 * and anything else is dropped with a line in the log.
 */
const { shell } = require('electron');

const OUTSIDE = new Set(['https:', 'mailto:']);
/** This machine, by the names a local server is reached at; nothing that only resolves here. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Open a link in the user's browser or mail client, if it is one of those.
 * The parsed URL is what goes out, so the OS gets exactly what was checked.
 * True when it was handed over.
 */
function openOutside(url) {
  const u = parse(url);
  if (u && (OUTSIDE.has(u.protocol) || (u.protocol === 'http:' && LOOPBACK.has(u.hostname)))) {
    void shell.openExternal(u.href);
    return true;
  }
  // The scheme only: the rest of a refused URL is nobody's business.
  console.warn(`bozzetto: not opening a ${u ? u.protocol : 'malformed'} link outside the app`);
  return false;
}

/**
 * scheme://host, spelt out. Not URL.origin: Node gives any scheme it does
 * not know an opaque origin, so `new URL('bozzetto://app/').origin` is
 * "null" - the same as bozzetto://elsewhere's.
 */
function originOf(url) {
  const u = typeof url === 'string' ? parse(url) : url;
  if (!u || u.username || u.password) return null;
  return `${u.protocol}//${u.host}`;
}

module.exports = { openOutside, originOf };
