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
 *
 * A server with accounts (docs/accounts.md §2) is signed in to the same
 * way, through its own page: the window opens `/?signin=desktop`, the
 * sign-in dialog there leaves the account's session cookie
 * (`__Host-bz_session`) in the same jar, and the proxied calls carry it as
 * they carry Access's. Which of the two applies is the server's to say, at
 * /api/config.
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
/** Cloudflare Access's cookie: the sign-in to a server without accounts. */
const ACCESS_COOKIE = 'CF_Authorization';
/** The account's session (functions/_shared/auth/session.ts): the sign-in to a server with them. */
const SESSION_COOKIE = '__Host-bz_session';
/** How long a call the main process makes on its own account (the config, /api/me, a sign-out) may take. */
const ASK_MS = 8000;
/** How long a server that did not answer whether it has accounts is not asked again. */
const UNANSWERED_MS = 30_000;

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
 * A request the main process makes on its own account, through the jar:
 * the server's config, whether a session still holds, a sign-out. No
 * redirect is followed (an Access login is an answer, not a page to load),
 * and one that takes too long is given up.
 */
async function ask(jar, url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ASK_MS);
  try {
    return await jar.fetch(url, { redirect: 'manual', ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether each server has accounts, as its /api/config last said: by
 * origin, {on, at, pending}. Asked once a run and again at every sign-in,
 * since a server can switch them on; one that did not answer is asked
 * again after UNANSWERED_MS, not on every call meanwhile.
 */
const accountsSaid = new Map();

/** What a server's /api/config says of accounts: true or false, or a throw when it did not answer. */
async function readAccounts(jar, url) {
  const res = await ask(jar, `${url}/api/config`);
  // Anything but the config itself - a server from before accounts (no
  // such route), Access in front of it, an HTML page - is a server
  // without accounts, as the web app reads it (net/account loadConfig).
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return false;
  try {
    return (await res.json())?.accounts === true;
  } catch {
    return false;
  }
}

/** Whether the server at `url` has accounts: true, false, or null when it could not be asked. */
function accountsAt(url, { fresh = false } = {}) {
  const known = accountsSaid.get(url);
  if (known?.pending) return known.pending;
  if (!fresh && known && (known.on !== null || Date.now() - known.at < UNANSWERED_MS)) return Promise.resolve(known.on);
  const jar = session.fromPartition(PARTITION);
  const pending = readAccounts(jar, url).then(
    (on) => on,
    () => null,
  );
  accountsSaid.set(url, { on: known?.on ?? null, at: known?.at ?? 0, pending });
  return pending.then((on) => {
    accountsSaid.set(url, { on, at: Date.now(), pending: null });
    return on;
  });
}

/** The value of a cookie the jar holds for `url`, or null. */
async function cookieValue(jar, url, name) {
  const found = await jar.cookies.get({ url, name });
  return found.length ? found[0].value : null;
}

/** What GET /api/me answers the session in the jar: its status, or 0 when nothing answered. */
async function meStatus(jar, url) {
  try {
    return (await ask(jar, `${url}/api/me`)).status;
  } catch {
    return 0;
  }
}

/**
 * The sign-in window shows whatever the login takes it to - Access, the
 * identity provider, back to the server; or the server's own sign-in page -
 * so it may go anywhere over https (or to the server itself, which may be
 * http on localhost), and nowhere else. Links it opens in a new window are
 * the app window's: https: and mailto: go to the browser, anything else is
 * dropped (links.cjs).
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

  /**
   * The server, and whether the app is signed in to it: while the cookie
   * that applies is in the jar - the account's session where the server
   * has accounts, Access's where it has not, either while it cannot say.
   * A cookie is not a session the server still knows: the page asks
   * GET /api/me for that (desktop/serverAccount). `accounts` is what the
   * server said of itself, null when it could not be asked.
   */
  ipcMain.handle('server:get', async () => {
    const cfg = await readConfig();
    if (!cfg.url) return { url: null, signedIn: false, accounts: null };
    const jar = session.fromPartition(PARTITION);
    const accounts = await accountsAt(cfg.url);
    const names = accounts === true ? [SESSION_COOKIE] : accounts === false ? [ACCESS_COOKIE] : [SESSION_COOKIE, ACCESS_COOKIE];
    let signedIn = false;
    for (const name of names) signedIn ||= (await cookieValue(jar, cfg.url, name)) !== null;
    return { url: cfg.url, signedIn, accounts };
  });

  ipcMain.handle('server:set', async (_e, raw) => {
    const url = raw ? normalise(raw) : null;
    await atomicWrite(CONFIG(), Buffer.from(JSON.stringify({ url })));
    return { url, signedIn: false, accounts: null };
  });

  /**
   * Sign in by opening the deployment in a real window on the shared
   * partition, and watching the jar for the cookie the sign-in leaves.
   * Nothing here handles credentials.
   *
   * What the server says at /api/config decides the window. With accounts,
   * the server's own sign-in page, `/?signin=desktop`: the code first, its
   * session marked as the desktop app's, and the cookie it sets is what
   * the window waits for - a new one, not one the jar held before. A
   * session the server still knows needs no window at all; one it has let
   * go (401) or will not serve (403, suspended) is dropped first, so the
   * page offers the sign-in again. Without accounts, Cloudflare Access does
   * its own thing at /admin/ - SSO, a code by email, whatever the policy
   * says - and leaves its cookie in the jar.
   */
  ipcMain.handle('server:signIn', async (event) => {
    const { url } = await readConfig();
    if (!url) throw new Error('Set a server first.');
    const accounts = await accountsAt(url, { fresh: true });
    if (accounts === null) throw new Error(`${url} did not answer. Check the connection and the address, then try again.`);
    const jar = session.fromPartition(PARTITION);
    const name = accounts ? SESSION_COOKIE : ACCESS_COOKIE;
    if (accounts && (await cookieValue(jar, url, SESSION_COOKIE)) !== null) {
      const status = await meStatus(jar, url);
      if (status === 200) return { url, signedIn: true, accounts };
      if (status === 401 || status === 403) await jar.cookies.remove(url, SESSION_COOKIE);
    }
    // The session cookie the jar holds now, if any: only another one is a sign-in.
    const before = accounts ? await cookieValue(jar, url, SESSION_COOKIE) : null;
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
    const signedIn = async () => {
      const value = await cookieValue(jar, url, name);
      return value !== null && value !== before;
    };
    const done = new Promise((resolve) => {
      // Poll the jar rather than guess at the page's steps, or Access's
      // redirect chain, which varies by identity provider and is not ours
      // to model.
      const timer = setInterval(async () => {
        if (w.isDestroyed()) return;
        if (await signedIn()) {
          clearInterval(timer);
          w.destroy();
          resolve({ url, signedIn: true, accounts });
        }
      }, 800);
      w.on('closed', async () => {
        clearInterval(timer);
        resolve({ url, signedIn: await signedIn(), accounts });
      });
    });
    // A page that does not load shows the browser's own error in the
    // window, which the person closes; the watch above ends it either way.
    w.loadURL(accounts ? `${url}/?signin=desktop` : `${url}/admin/`).catch(() => {});
    return done;
  });

  /**
   * Sign out: with an account's session in the jar, the server is asked to
   * end it (POST /api/auth/signout, through the jar, so the cookie goes
   * with it; a request from here is no cross-site write), and then every
   * cookie of the partition goes, whatever the server said - the session
   * is no use to this device without its cookie. `revoked` says whether
   * the server ended it, null when there was no account's session.
   */
  ipcMain.handle('server:signOut', async () => {
    const { url } = await readConfig();
    const jar = session.fromPartition(PARTITION);
    let revoked = null;
    if (url && (await cookieValue(jar, url, SESSION_COOKIE)) !== null) {
      try {
        const res = await ask(jar, `${url}/api/auth/signout`, { method: 'POST' });
        revoked = res.ok;
      } catch {
        revoked = false;
      }
    }
    await jar.clearStorageData({ storages: ['cookies'] });
    return { signedIn: false, revoked };
  });

  /**
   * The proxy. The renderer hands a path and a body; this resolves it
   * against the configured server and returns status + bytes. Paths are
   * checked against the routes the app actually uses, so a compromised
   * renderer cannot aim this at an arbitrary URL. A request from here
   * carries no Origin and Sec-Fetch-Site: none, a request no page started,
   * which the server's refusal of cross-site writes lets through; the
   * sign-in's cookie (SameSite=Lax: Access's, or the account's session)
   * goes with it. desktop.mjs checks all three.
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
