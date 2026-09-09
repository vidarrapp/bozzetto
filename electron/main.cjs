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
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  registerFileIpc,
  fileMenu,
  openPathInWindow,
  guardClose,
  clearRecoveryOnCleanExit,
  windowFor,
} = require('./files.cjs');
const { registerServerIpc, serverMenu } = require('./server.cjs');

const SCHEME = 'bozzetto';
const ORIGIN = `${SCHEME}://app`;
/** The desktop build (vite --mode desktop), inside the packaged asar. */
const DIST = path.join(__dirname, '..', 'dist-desktop');

// One running copy. Windows and Linux hand a double-clicked .bozz to a NEW
// process as an argv entry; without the lock every file opened from the
// Explorer would start a second app instead of landing in the one that is
// already up. The loser exits at once and its argv arrives in
// `second-instance` below.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  // Must run before app-ready. `standard` gives it an origin (so storage is
  // partitioned per app rather than opaque), `secure` unlocks WebGPU and
  // IndexedDB, `supportFetchAPI` lets the app's own fetch() reach its assets.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);

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

    // Once per process. ipcMain.handle throws on a second registration of
    // the same channel, so this cannot live next to createWindow(): on
    // macOS a dock click after the last window closed makes a new window,
    // and re-registering there would take the whole app down.
    registerFileIpc();
    registerServerIpc();
    buildMenu();
    createWindow();
    // A file opened from the OS at launch: on Windows and Linux it is an
    // argv entry, on macOS it arrived through open-file (queued below).
    queueOpens(bozzFilesIn(process.argv, process.cwd()));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('second-instance', (_e, argv, cwd) => {
    // The other copy was asked to open something (or just launched again):
    // bring this one forward and take the file. Before ready there is no
    // window to bring forward; the queue holds the file until there is.
    queueOpens(bozzFilesIn(argv, cwd));
    if (!app.isReady()) return;
    const win = windowFor(null) ?? createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // macOS only: Finder hands over files here, and can do so before the app
  // is ready, before any window exists, or after the last one was closed.
  app.on('open-file', (e, filePath) => {
    e.preventDefault();
    queueOpens([filePath]);
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    // The close guard cancels a quit while it asks about unsaved work; once
    // the window is gone the quit the user asked for has to go through,
    // on macOS too, where a closed window otherwise leaves the app running.
    if (process.platform !== 'darwin' || quitting) app.quit();
  });

  // A clean exit: no window crashed, every close was allowed. The recovery
  // sidecar is for the other kind of exit, so it must not survive this one
  // or the next launch asks about a scene IndexedDB has already restored.
  app.on('will-quit', () => clearRecoveryOnCleanExit());
}

/** True from the moment a quit was requested until it is cancelled or done. */
let quitting = false;

/** Serve dist-desktop, refusing anything that climbs out of it. */
function serveApp() {
  protocol.handle(SCHEME, async (request) => {
    const notFound = () => new Response('Not found', { status: 404 });
    let rel;
    try {
      rel = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return notFound(); // a malformed %-escape is a bad request, not a crash
    }
    let target = path.join(DIST, rel);
    // path.join resolves ..; anything landing outside DIST is a traversal.
    if (!target.startsWith(DIST + path.sep) && target !== DIST) return notFound();

    // The app has more than one page: / is the gallery and the sculpt
    // shell, /create/ is the timelapse uploader, each its own index.html.
    // A directory serves its own index; a path with no extension that is
    // not a directory is a client-side route and gets the root shell.
    const stat = await fs.stat(target).catch(() => null);
    if (stat && stat.isDirectory()) target = path.join(target, 'index.html');
    else if (!stat && !path.extname(target)) target = path.join(DIST, 'index.html');

    return net.fetch(pathToFileURL(target).href).catch(notFound);
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
      // happens in this process, behind the IPC in preload.cjs.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
    },
  });

  // The document owns the title. Without this the page's own <title>
  // overwrites whatever setTitle() put there, so the file name and the
  // unsaved-changes dot appear for an instant and are then wiped by the
  // renderer - which looks exactly like the title never worked.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  // Unsaved work asks before the window goes; a cancelled dialog also
  // cancels the quit that may have triggered the close.
  guardClose(win, {
    onCancel: () => {
      quitting = false;
    },
  });
  // The renderer says when its document model is up, which is the earliest
  // moment a file can be handed to it. Files that arrived before then wait.
  win.once('bozzetto:document', () => {
    ready.add(win);
    flushOpens(win);
  });
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

// --- files handed over by the OS --------------------------------------

/** Windows whose renderer has mounted its document model. */
const ready = new WeakSet();
/** Paths waiting for a window that can take them. */
let pendingOpens = [];

/** .bozz paths in an argv, resolved against the directory it was run from. */
function bozzFilesIn(argv, cwd) {
  return argv
    .slice(1) // the executable
    .filter((a) => /\.bozz$/i.test(a) && !a.startsWith('-'))
    .map((a) => path.resolve(cwd, a));
}

function queueOpens(paths) {
  if (!paths.length) return;
  pendingOpens.push(...paths);
  const win = windowFor(null);
  if (win && ready.has(win)) flushOpens(win);
}

function flushOpens(win) {
  if (!pendingOpens.length) return;
  // One document per window: of several files opened at once, the last
  // one wins, the same as double-clicking them one after another.
  const last = pendingOpens[pendingOpens.length - 1];
  pendingOpens = [];
  void openPathInWindow(win, last);
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
 *
 * Built once. Every item resolves its window at click time, so the menu
 * keeps working after the first window is closed and another opened.
 */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const cmd = (c) => () => windowFor(null)?.webContents.send('menu:command', c);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      fileMenu(isMac),
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: '', click: cmd('edit:undo') },
          { label: 'Redo', accelerator: '', click: cmd('edit:redo') },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy', accelerator: '' },
          { role: 'paste' },
          { type: 'separator' },
          { label: 'Preferences...', accelerator: 'CmdOrCtrl+,', click: cmd('edit:preferences') },
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
      serverMenu(),
      { role: 'windowMenu' },
    ]),
  );
}

module.exports = { ORIGIN, SCHEME };
