/**
 * Bozzetto desktop: the Electron main process.
 *
 * The app is served from a privileged custom protocol rather than file://.
 * That is not a style choice: the built app is full of root-absolute URLs
 * baked into runtime code (HDRI paths, brush stencils, matcaps, ten url()
 * refs in the CSS), which under file:// resolve to the filesystem root and
 * 404. It also needs a SECURE CONTEXT - WebGPU, IndexedDB and module
 * workers all require one, and file:// is not. A standard, secure,
 * fetch-capable scheme gives both, and dist/ ships unmodified.
 */
const { app, BrowserWindow, Menu, protocol, net, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { registerFileIpc, fileMenu, openPathInWindow } = require('./files.cjs');
const { registerServerIpc, serverMenu } = require('./server.cjs');

const SCHEME = 'bozzetto';
const ORIGIN = `${SCHEME}://app`;
/** The desktop build (vite --mode desktop), inside the packaged asar. */
const DIST = path.join(__dirname, '..', 'dist-desktop');

// Must run before app-ready. `standard` gives it an origin (so storage is
// partitioned per app rather than opaque), `secure` unlocks WebGPU and
// IndexedDB, `supportFetchAPI` lets the app's own fetch() reach its assets.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** Serve dist/, refusing anything that climbs out of it. */
function serveApp() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    // A path with no extension is a route, not a file: hand back the shell.
    const rel = pathname === '/' || !path.extname(pathname) ? '/index.html' : pathname;
    const target = path.join(DIST, decodeURIComponent(rel));
    // path.join resolves ..; anything landing outside DIST is a traversal.
    if (!target.startsWith(DIST + path.sep) && target !== DIST) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(target).href).catch(
      () => new Response('Not found', { status: 404 }),
    );
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1c1814', // the app's own warm ink, so no white flash
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // The renderer is web code and gets no Node. contextIsolation keeps
      // the preload's bridge out of reach of page script, and sandbox
      // holds the renderer to the OS sandbox. Everything privileged
      // happens in this process, behind the IPC in preload.js.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  void win.loadURL(`${ORIGIN}/?sculpt=1`);

  // Anything that is not the app opens in the real browser, never in a
  // frameless app window with no address bar.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  return win;
}

/**
 * The menu, with the Edit role's accelerators removed.
 *
 * Sculpt mode owns Ctrl/Cmd+A, Z, C, I and D for mask-all, undo, clear
 * mask, invert mask and subdivide (see InputShell.onKeyDown). Electron's
 * stock Edit menu binds the same chords to selectAll/undo/copy, and a menu
 * accelerator wins before the page ever sees the key - so the default menu
 * would break five core interactions on the first launch. Undo and Redo
 * are kept as menu items WITHOUT accelerators so they still appear, and
 * the app's own handlers keep the keys.
 */
function buildMenu(win) {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      fileMenu(win, isMac),
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: '', click: () => send(win, 'edit:undo') },
          { label: 'Redo', accelerator: '', click: () => send(win, 'edit:redo') },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy', accelerator: '' },
          { role: 'paste' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      serverMenu(win),
      { role: 'windowMenu' },
    ]),
  );
}

function send(win, channel, payload) {
  win?.webContents.send(channel, payload);
}

app.whenReady().then(() => {
  serveApp();
  // No remote content is loaded into the app window, so nothing should be
  // asking for the camera, the microphone or a location.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  // Everything the desktop app loads is on disk, so the policy can be
  // strict: no remote script, no remote frames. blob: and data: stay open
  // because the app builds thumbnails, object URLs and module workers out
  // of them. Server traffic does not appear here at all - it goes through
  // the main process, not the renderer.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
            "media-src 'self' blob:; font-src 'self'; " +
            "connect-src 'self' data: blob:; worker-src 'self' blob:; " +
            "object-src 'none'; frame-src 'none'",
        ],
      },
    });
  });

  const win = createWindow();
  registerFileIpc(win, ORIGIN);
  registerServerIpc(win);
  buildMenu(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      registerFileIpc(w, ORIGIN);
      buildMenu(w);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// A file double-clicked in Finder before the window exists.
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  const win = BrowserWindow.getAllWindows()[0];
  if (win) openPathInWindow(win, filePath);
});

module.exports = { ORIGIN, SCHEME };
