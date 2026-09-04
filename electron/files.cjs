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
 *
 * Second, the autosave NEVER writes to the user's document. It writes a
 * sidecar under userData. If a background timer wrote through to the open
 * file, "Save" would stop meaning anything and closing without saving
 * would be impossible.
 */
const { app, dialog, ipcMain, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const FILTERS = [{ name: 'Bozzetto scene', extensions: ['bozz'] }];
const RECENTS_FILE = () => path.join(app.getPath('userData'), 'recents.json');
const RECOVERY_FILE = () => path.join(app.getPath('userData'), 'recovery.bozz');
const MAX_RECENTS = 10;

/** Write via a temp file + rename, so a crash cannot truncate the target. */
async function atomicWrite(target, bytes) {
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, Buffer.from(bytes));
  await fs.rename(tmp, target);
}

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

/** Read a scene and hand the renderer its bytes plus where they came from. */
async function readScene(filePath) {
  const buf = await fs.readFile(filePath);
  await noteRecent(filePath);
  // A copy, because the underlying Buffer pools memory that would be
  // reused under the structured clone.
  return { path: filePath, name: path.basename(filePath), bytes: new Uint8Array(buf).buffer };
}

/** Open a path in a window, used by the OS "open with" and by recents. */
async function openPathInWindow(win, filePath) {
  try {
    win.webContents.send('file:opened', await readScene(filePath));
  } catch (err) {
    dialog.showMessageBox(win, {
      type: 'error',
      message: `Could not open ${path.basename(filePath)}`,
      detail: String(err && err.message ? err.message : err),
    });
  }
}

function registerFileIpc(win, origin) {
  ipcMain.handle('file:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: FILTERS,
    });
    if (canceled || !filePaths[0]) return null;
    return readScene(filePaths[0]);
  });

  ipcMain.handle('file:read', (_e, filePath) => readScene(filePath));

  ipcMain.handle('file:save', async (_e, { bytes, filePath }) => {
    let target = filePath;
    if (!target) {
      const { canceled, filePath: picked } = await dialog.showSaveDialog(win, {
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

  ipcMain.handle('file:saveAs', async (_e, { bytes, suggested }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: suggested || 'sculpt.bozz',
      filters: FILTERS,
    });
    if (canceled || !filePath) return null;
    await atomicWrite(filePath, bytes);
    await noteRecent(filePath);
    return { path: filePath, name: path.basename(filePath) };
  });

  // OBJ, single-file HTML, reels: bytes the app made that are not scenes.
  ipcMain.handle('file:export', async (_e, { bytes, suggested, filters }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: suggested,
      filters: filters?.length ? filters : undefined,
    });
    if (canceled || !filePath) return null;
    await atomicWrite(filePath, bytes);
    return { path: filePath, name: path.basename(filePath) };
  });

  ipcMain.handle('file:recents', readRecents);

  // The title bar is the document: the name, and the OS dirty marker.
  ipcMain.on('file:document', (_e, doc) => {
    const w = BrowserWindow.fromWebContents(_e.sender) ?? win;
    if (!w) return;
    w.setTitle(doc?.name ? `${doc.dirty ? '• ' : ''}${doc.name} - Bozzetto` : 'Bozzetto');
    if (process.platform === 'darwin') {
      w.setRepresentedFilename(doc?.path ?? '');
      w.setDocumentEdited(!!doc?.dirty);
    }
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
  ipcMain.handle('recovery:clear', async () => {
    await fs.rm(RECOVERY_FILE(), { force: true });
    return true;
  });

  void origin;
}

/** The File menu, wired to renderer commands rather than doing the work. */
function fileMenu(win, isMac) {
  const cmd = (c) => () => win.webContents.send('menu:command', c);
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

module.exports = { registerFileIpc, fileMenu, openPathInWindow, atomicWrite };
