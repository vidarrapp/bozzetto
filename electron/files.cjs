/**
 * Native files: open, save, save-as, recents, and the crash-recovery
 * sidecar.
 *
 * Two rules shape all of it.
 *
 * First, writes are atomic. IndexedDB put()s are transactional and
 * fs.writeFile is not, so porting the autosave straight to a file would
 * introduce truncated-file corruption where none was possible before.
 * Every write here goes to a temp file in the same directory and is then
 * renamed over the target - rename within a filesystem is atomic, so a
 * crash leaves either the old file or the new one, never half of either.
 * Writes to one target are also serialised: the temp name is unique per
 * call and a second write waits for the first, or two overlapping
 * autosaves would truncate each other's temp file and rename half of one
 * into place - which is exactly the corruption the rename was meant to
 * rule out.
 *
 * Second, the autosave NEVER writes to the user's document. It writes a
 * sidecar under userData. If a background timer wrote through to the open
 * file, "Save" would stop meaning anything and closing without saving
 * would be impossible.
 *
 * Nothing here captures a window. Every handler finds the window that
 * asked, through event.sender, so a window closed and reopened (macOS dock
 * click) is not answering dialogs into a destroyed one.
 */
const { app, dialog, ipcMain, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const { rmSync } = require('node:fs');
const path = require('node:path');

const FILTERS = [{ name: 'Bozzetto scene', extensions: ['bozz'] }];
const RECENTS_FILE = () => path.join(app.getPath('userData'), 'recents.json');
const RECOVERY_FILE = () => path.join(app.getPath('userData'), 'recovery.bozz');
const MAX_RECENTS = 10;

/** The window an IPC event came from, or the focused one for menu paths. */
function windowFor(event) {
  return (
    (event && BrowserWindow.fromWebContents(event.sender)) ??
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows()[0] ??
    null
  );
}

// --- atomic, serialised writes ------------------------------------------

let tmpSeq = 0;
/** In-flight write per target path, so writes to one file queue up. */
const writeQueues = new Map();

async function atomicWrite(target, bytes) {
  const prev = writeQueues.get(target) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    const tmp = `${target}.${process.pid}.${++tmpSeq}.tmp`;
    try {
      await fs.writeFile(tmp, Buffer.from(bytes));
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  });
  writeQueues.set(target, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(target) === next) writeQueues.delete(target);
  }
}

// --- recents --------------------------------------------------------------

async function readRecents() {
  try {
    const raw = await fs.readFile(RECENTS_FILE(), 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

async function noteRecent(filePath) {
  const list = [filePath, ...(await readRecents()).filter((p) => p !== filePath)];
  await atomicWrite(RECENTS_FILE(), Buffer.from(JSON.stringify(list.slice(0, MAX_RECENTS))));
  app.addRecentDocument(filePath);
}

// --- reading scenes -------------------------------------------------------

/** Read a scene and hand the renderer its bytes plus where they came from. */
async function readScene(filePath) {
  const buf = await fs.readFile(filePath);
  await noteRecent(filePath);
  // new Uint8Array(buffer) COPIES, which matters: Node pools small Buffers
  // in shared slabs, and handing a slab's .buffer across IPC would send
  // the neighbours along with it.
  return { path: filePath, name: path.basename(filePath), bytes: new Uint8Array(buf).buffer };
}

/** Open a path in a window: the OS "open with", argv, and recents. */
async function openPathInWindow(win, filePath) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('file:opened', await readScene(filePath));
  } catch (err) {
    await dialog.showMessageBox(win, {
      type: 'error',
      message: `Could not open ${path.basename(filePath)}`,
      detail: String(err && err.message ? err.message : err),
    });
  }
}

// --- the document, as main sees it ---------------------------------------

/**
 * What each window last told us about its document. The close guard reads
 * `dirty` from here, and the title bar is written from it - one source, so
 * the guard and the title cannot disagree about whether work is unsaved.
 */
const documents = new WeakMap();

function documentOf(win) {
  return documents.get(win) ?? { path: null, name: null, dirty: false };
}

function applyDocument(win, doc) {
  documents.set(win, doc);
  // The dot needs a name to sit on, and on Windows and Linux the title is
  // the only place unsaved work shows - so an unsaved scene is "Untitled",
  // as every native app spells it, rather than a bare app name.
  win.setTitle(`${doc.dirty ? '• ' : ''}${doc.name ?? 'Untitled'} - Bozzetto`);
  if (process.platform === 'darwin') {
    win.setRepresentedFilename(doc.path ?? '');
    win.setDocumentEdited(!!doc.dirty);
  }
}

/**
 * Ask the renderer to save, and learn how it went. The renderer answers on
 * file:saveDone - saved, or cancelled at the dialog - so a close that is
 * waiting on a save knows whether to proceed, rather than guessing from a
 * timeout while the user is still looking at the Save dialog.
 */
function requestSave(win) {
  return new Promise((resolve) => {
    const finish = (saved) => {
      ipcMain.off('file:saveDone', onDone);
      win.webContents.off('render-process-gone', onGone);
      resolve(saved);
    };
    const onDone = (event, result) => {
      if (event.sender !== win.webContents) return;
      finish(!!(result && result.saved));
    };
    const onGone = () => finish(false);
    ipcMain.on('file:saveDone', onDone);
    win.webContents.once('render-process-gone', onGone);
    win.webContents.send('menu:command', 'file:saveForClose');
  });
}

/**
 * A renderer that died. Its window still closes normally, and that close
 * must not be mistaken for a clean one: the recovery sidecar is exactly
 * for this exit, so it stays.
 */
let crashed = false;

/**
 * Closing a window with unsaved work asks first. Save / Don't Save /
 * Cancel, the way every native app does it - the recovery sidecar is a
 * net, not a substitute for asking.
 *
 * `onCancel` runs when the user keeps the window open, so a quit that
 * triggered the close can be called off with it.
 */
function guardClose(win, { onCancel } = {}) {
  let allowClose = false;
  let asking = false;
  win.webContents.on('render-process-gone', () => {
    crashed = true;
  });
  win.on('close', (e) => {
    if (allowClose) return;
    // Nothing left to ask a dead renderer; the sidecar has the work.
    if (win.webContents.isCrashed()) return;
    if (!documentOf(win).dirty) return;
    e.preventDefault();
    if (asking) return; // a second close while the dialog is up
    asking = true;
    void (async () => {
      try {
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['Save', "Don't Save", 'Cancel'],
          defaultId: 0,
          cancelId: 2,
          message: 'Save changes before closing?',
          detail: documentOf(win).name
            ? `${documentOf(win).name} on disk will not have your latest changes otherwise.`
            : 'This sculpt has not been saved to a file.',
        });
        if (response === 2) return onCancel?.(); // stay open, nothing changes
        if (response === 0) {
          const saved = await requestSave(win);
          if (!saved) return onCancel?.(); // they cancelled the Save dialog
        }
        allowClose = true;
        win.close();
      } finally {
        asking = false;
      }
    })();
  });
  // Closed with the guard's blessing (macOS keeps the app running): the
  // work is saved, discarded on purpose, or still in IndexedDB - and the
  // sidecar mirrors IndexedDB, so it has nothing that is not already kept.
  win.on('closed', () => clearRecoveryOnCleanExit());
}

// --- IPC ------------------------------------------------------------------

/** Registered once per process. Windows are found per call, never held. */
function registerFileIpc() {
  ipcMain.handle('file:open', async (event) => {
    const win = windowFor(event);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: FILTERS,
    });
    if (canceled || !filePaths[0]) return null;
    return readScene(filePaths[0]);
  });

  ipcMain.handle('file:read', (_e, filePath) => readScene(filePath));

  ipcMain.handle('file:save', async (event, { bytes, filePath }) => {
    let target = filePath;
    if (!target) {
      const { canceled, filePath: picked } = await dialog.showSaveDialog(windowFor(event), {
        defaultPath: 'sculpt.bozz',
        filters: FILTERS,
      });
      if (canceled || !picked) return null;
      target = picked;
    }
    await atomicWrite(target, bytes);
    await noteRecent(target);
    return { path: target, name: path.basename(target) };
  });

  ipcMain.handle('file:saveAs', async (event, { bytes, suggested }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(windowFor(event), {
      defaultPath: suggested || 'sculpt.bozz',
      filters: FILTERS,
    });
    if (canceled || !filePath) return null;
    await atomicWrite(filePath, bytes);
    await noteRecent(filePath);
    return { path: filePath, name: path.basename(filePath) };
  });

  // OBJ, single-file HTML, reels: bytes the app made that are not scenes.
  ipcMain.handle('file:export', async (event, { bytes, suggested, filters }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(windowFor(event), {
      defaultPath: suggested,
      filters: filters?.length ? filters : undefined,
    });
    if (canceled || !filePath) return null;
    await atomicWrite(filePath, bytes);
    return { path: filePath, name: path.basename(filePath) };
  });

  ipcMain.handle('file:recents', readRecents);

  // The title bar is the document: the name, and the OS dirty marker. The
  // renderer sends this at mount too, which is also how main learns that
  // the page is ready to be handed a file (see main.cjs's open queue).
  ipcMain.on('file:document', (event, doc) => {
    const win = windowFor(event);
    if (!win) return;
    applyDocument(win, {
      path: doc?.path ?? null,
      name: doc?.name ?? null,
      dirty: !!doc?.dirty,
    });
    win.emit('bozzetto:document');
  });

  // Native dialogs. The renderer must not use window.confirm/prompt: they
  // block its event loop, and the recovery question is asked during boot -
  // so a blocking prompt there freezes the app before it finishes starting.
  ipcMain.handle('ui:confirm', async (event, { message, detail, confirmLabel }) => {
    const { response } = await dialog.showMessageBox(windowFor(event), {
      type: 'question',
      buttons: [confirmLabel || 'OK', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message,
      detail,
    });
    return response === 0;
  });

  // The three-way question - Save / Don't Save / Cancel - that New and
  // Open ask when there is work to lose. Answers with the button index.
  ipcMain.handle('ui:ask', async (event, { message, detail, buttons }) => {
    const labels = Array.isArray(buttons) && buttons.length ? buttons.map(String) : ['OK'];
    const { response } = await dialog.showMessageBox(windowFor(event), {
      type: 'question',
      buttons: labels,
      defaultId: 0,
      cancelId: labels.length - 1,
      message,
      detail,
    });
    return response;
  });

  ipcMain.handle('ui:message', async (event, { message, detail, type }) => {
    await dialog.showMessageBox(windowFor(event), {
      type: type || 'info',
      message,
      detail,
      buttons: ['OK'],
    });
    return true;
  });

  // --- crash recovery ---------------------------------------------------
  ipcMain.handle('recovery:write', async (_e, bytes) => {
    await atomicWrite(RECOVERY_FILE(), bytes);
    return true;
  });
  ipcMain.handle('recovery:read', async () => {
    try {
      const buf = await fs.readFile(RECOVERY_FILE());
      return new Uint8Array(buf).buffer;
    } catch {
      return null; // no sidecar is the normal case, not a failure
    }
  });
  ipcMain.handle('recovery:clear', clearRecovery);
}

/**
 * Drop the sidecar. Called on a clean quit as well as after a save: a
 * sidecar that survives every ordinary session asks "recover?" at every
 * launch, about a scene IndexedDB has already put back on screen.
 */
async function clearRecovery() {
  await fs.rm(RECOVERY_FILE(), { force: true });
  return true;
}

/**
 * The exit-path variant: synchronous, because will-quit does not wait for
 * promises, and a no-op after a renderer crash, which is the one exit the
 * sidecar exists for.
 */
function clearRecoveryOnCleanExit() {
  if (crashed) return;
  try {
    rmSync(RECOVERY_FILE(), { force: true });
  } catch {
    // Nothing to do about it at exit; the next launch offers it once more.
  }
}

/** The File menu, wired to renderer commands rather than doing the work. */
function fileMenu(isMac) {
  // Resolved at click time: a menu built against the first window would
  // keep sending to it after it was closed and another opened.
  const cmd = (c) => () => windowFor(null)?.webContents.send('menu:command', c);
  return {
    label: 'File',
    submenu: [
      { label: 'New Sculpt', accelerator: 'CmdOrCtrl+N', click: cmd('file:new') },
      { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: cmd('file:open') },
      {
        label: 'Open Recent',
        role: 'recentdocuments',
        submenu: [{ label: 'Clear Recent', role: 'clearrecentdocuments' }],
      },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: cmd('file:save') },
      { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('file:saveAs') },
      { type: 'separator' },
      { label: 'Export OBJ...', click: cmd('file:exportObj') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };
}

module.exports = {
  registerFileIpc,
  fileMenu,
  openPathInWindow,
  atomicWrite,
  guardClose,
  clearRecovery,
  clearRecoveryOnCleanExit,
  windowFor,
};
