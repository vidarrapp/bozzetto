/**
 * The optional server: publishing to your own Cloudflare deployment.
 *
 * Everything here exists to solve one problem. The renderer runs on
 * bozzetto://app, so any call to a real deployment is cross-origin - and
 * the Functions send no CORS headers at all, have no OPTIONS handler, and
 * authenticate by reading a header that Cloudflare Access injects only
 * after a COOKIE login. A renderer fetch therefore fails three separate
 * ways before it reaches the API.
 *
 * So the renderer never makes the call. Requests go out from the main
 * process, which sends no Origin header, so there is no CORS check to
 * fail; and they ride a named session partition that holds the Access
 * cookie, set by a real login window pointed at the deployment. The
 * server needs no changes whatsoever - not one line in functions/.
 */
const { ipcMain, session, BrowserWindow, app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, windowFor } = require('./files.cjs');
const { openOutside, originOf } = require('./links.cjs');

/** Its own cookie jar, so the login is not shared with anything else. */
const PARTITION = 'persist:bozzetto-server';
const CONFIG = () => path.join(app.getPath('userData'), 'server.json');
/**
 * Requests the app makes; anything else is a bug or an attempt. /m/ is the
 * files host's path for a template's files (docs/accounts.md §4), which
 * the server answers on its own host too: a file a manifest names on the
 * files host is asked for there, by its path (net/origin serverPath), so
 * this proxy stays pinned to the configured server.
 */
const ALLOWED = /^\/(api|admin\/api|media|m)\//;

async function readConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG(), 'utf8'));
  } catch {
    return { url: null };
  }
}

/**
 * A server base is scheme + host (+ port) and nothing else: Pages
 * Functions are fixed at the site root, so /api and /admin/api cannot
 * live under a path prefix. Anything with a path is a misunderstanding
 * worth rejecting at the point of entry rather than debugging later.
 */
function normalise(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw new Error('The server must be https (localhost may be http).');
  }
  if (u.pathname !== '/' || u.search || u.hash) {
    throw new Error('Give just the site root, with no path - like https://example.com');
  }
  return u.origin;
}

/**
 * The sign-in window shows whatever the login takes it to - Access, the
 * identity provider, back to the server - so it may go anywhere over https
 * (or to the server itself, which may be http on localhost), and nowhere
 * else. Links it opens in a new window are the app window's: https: and
 * mailto: go to the browser, anything else is dropped (links.cjs).
 */
function guardSignInWindow(w, serverOrigin) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    const target = originOf(url);
    if (target?.startsWith('https://') || target === serverOrigin) return;
    e.preventDefault();
    console.warn('bozzetto: the sign-in window stays on https');
  });
}

/** Registered once per process; windows are found per call, never held. */
function registerServerIpc() {
  // Nothing on the sign-in pages needs a permission: not the camera, not a
  // notification, and above all not openExternal, which is how a page's
  // smb: or file: link (or a redirect to one) would reach the OS. The app's
  // own session refuses them all the same way (main.cjs).
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  ipcMain.handle('server:get', async () => {
    const cfg = await readConfig();
    if (!cfg.url) return { url: null, signedIn: false };
    const jar = session.fromPartition(PARTITION);
    const cookies = await jar.cookies.get({ url: cfg.url, name: 'CF_Authorization' });
    return { url: cfg.url, signedIn: cookies.length > 0 };
  });

  ipcMain.handle('server:set', async (_e, raw) => {
    const url = raw ? normalise(raw) : null;
    await atomicWrite(CONFIG(), Buffer.from(JSON.stringify({ url })));
    return { url, signedIn: false };
  });

  /**
   * Sign in by opening the deployment in a real window on the shared
   * partition. Cloudflare Access does its own thing there - SSO, a code
   * by email, whatever the policy says - and leaves its cookie in the jar
   * that the proxied requests below use. Nothing here handles credentials.
   */
  ipcMain.handle('server:signIn', async (event) => {
    const { url } = await readConfig();
    if (!url) throw new Error('Set a server first.');
    const jar = session.fromPartition(PARTITION);
    const w = new BrowserWindow({
      width: 520,
      height: 700,
      parent: windowFor(event) ?? undefined,
      title: 'Sign in',
      // Someone else's pages in a window of ours: no preload, no Node, and
      // the OS sandbox, said outright rather than left to a default.
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    guardSignInWindow(w, url);
    await w.loadURL(`${url}/admin/`);
    return new Promise((resolve) => {
      // Poll the jar rather than guess at Access's redirect chain, which
      // varies by identity provider and is not ours to model.
      const timer = setInterval(async () => {
        if (w.isDestroyed()) return;
        const c = await jar.cookies.get({ url, name: 'CF_Authorization' });
        if (c.length) {
          clearInterval(timer);
          w.destroy();
          resolve({ url, signedIn: true });
        }
      }, 800);
      w.on('closed', async () => {
        clearInterval(timer);
        const c = await jar.cookies.get({ url, name: 'CF_Authorization' });
        resolve({ url, signedIn: c.length > 0 });
      });
    });
  });

  ipcMain.handle('server:signOut', async () => {
    const jar = session.fromPartition(PARTITION);
    await jar.clearStorageData({ storages: ['cookies'] });
    return { signedIn: false };
  });

  /**
   * The proxy. The renderer hands a path and a body; this resolves it
   * against the configured server and returns status + bytes. Paths are
   * checked against the routes the app actually uses, so a compromised
   * renderer cannot aim this at an arbitrary URL. A request from here
   * carries no Origin and Sec-Fetch-Site: none, a request no page started,
   * which the server's refusal of cross-site writes lets through; the
   * Access cookie (SameSite=Lax) goes with it. desktop.mjs checks all three.
   */
  ipcMain.handle('server:fetch', async (_e, { pathname, method, body, contentType }) => {
    const { url } = await readConfig();
    if (!url) return { ok: false, status: 0, error: 'No server configured' };
    // Resolve first, check what it resolved to. Testing the raw string
    // would pass '/api/../admin/x' (dot segments) and '//other.host/api/x'
    // (a protocol-relative URL, which resolves to another origin), and the
    // check is only worth having if it holds against both.
    let target;
    try {
      target = typeof pathname === 'string' ? new URL(pathname, url) : null;
    } catch {
      target = null;
    }
    if (!target || target.origin !== url || !ALLOWED.test(target.pathname)) {
      return { ok: false, status: 0, error: 'Blocked path' };
    }
    const jar = session.fromPartition(PARTITION);
    try {
      const res = await jar.fetch(target.href, {
        method: method || 'GET',
        headers: contentType ? { 'content-type': contentType } : undefined,
        body: body ? Buffer.from(body) : undefined,
        // Access answers an unauthenticated call with a redirect to its
        // login page. Following it would hand back a login document as if
        // it were the API; surfacing the 302 lets the app say "sign in".
        redirect: 'manual',
      });
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        bytes: new Uint8Array(await res.arrayBuffer()).buffer,
      };
    } catch (err) {
      return { ok: false, status: 0, error: String(err && err.message ? err.message : err) };
    }
  });
}

function serverMenu() {
  // Resolved at click time, so the menu outlives the first window.
  const cmd = (c) => () => windowFor(null)?.webContents.send('menu:command', c);
  return {
    label: 'Server',
    submenu: [
      { label: 'Server Settings...', click: cmd('server:settings') },
      { type: 'separator' },
      { label: 'Sign In...', click: cmd('server:signIn') },
      { label: 'Sign Out', click: cmd('server:signOut') },
    ],
  };
}

module.exports = { registerServerIpc, serverMenu, PARTITION };
