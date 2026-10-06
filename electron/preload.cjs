/**
 * The only surface the renderer gets. Everything privileged - the
 * filesystem, the network to a configured server, the OS dialogs - lives
 * in the main process and is reached through these named channels, so the
 * page never holds a file handle or a Node primitive.
 *
 * window.bozzettoDesktop is the feature flag too: its presence is how the
 * web code knows it is running in the app rather than a browser tab.
 */
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, fn) => {
  const sub = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, sub);
  return () => ipcRenderer.off(channel, sub);
};

/** A `--name=value` argument main.cjs passed this window (launch.cjs), or null. */
const arg = (name) => {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};

contextBridge.exposeInMainWorld('bozzettoDesktop', {
  version: process.versions.electron,
  platform: process.platform,

  // --- launch settings (launch.cjs) ---------------------------------------
  /**
   * What this window runs with, known before the page draws its first
   * frame: v-sync (off unless launch.json turns it on), whether the
   * high-performance GPU switch applied, the display's refresh rate and the
   * battery at load.
   */
  launch: {
    vsync: arg('bozzetto-vsync') === 'on',
    highPerformanceGpu: arg('bozzetto-hp-gpu') === 'on',
    displayHz: Number(arg('bozzetto-display-hz')) || 0,
    onBattery: arg('bozzetto-battery') === '1',
  },
  /** launch.json as saved (next launch) and as running, for Preferences. */
  getLaunchOptions: () => ipcRenderer.invoke('launch:get'),
  /** Change launch.json; it applies when the app next starts. */
  setLaunchOptions: (opts) => ipcRenderer.invoke('launch:set', opts),
  /** On battery or mains, as it changes. */
  onBattery: (fn) => on('power:battery', fn),
  /** The battery and this window's display as they are now (a reload outlives its arguments). */
  powerNow: () => ipcRenderer.invoke('power:now'),
  /** The window moved to a display with another refresh rate. */
  onDisplayHz: (fn) => on('display:hz', fn),

  // --- files ------------------------------------------------------------
  // The page never holds a path (files.cjs): a scene comes with its name
  // and a ref, and the window's document is named by ref.
  /** Pick a scene (OS dialog) and read it: { ref, name, bytes }, or null when cancelled. */
  openScene: () => ipcRenderer.invoke('file:open'),
  /** Read a recent file. Any path not on the recents list is refused. */
  readScene: (filePath) => ipcRenderer.invoke('file:read', filePath),
  /** Write bytes to this window's document, or ask where when it has none. */
  saveScene: (bytes) => ipcRenderer.invoke('file:save', { bytes }),
  /** Ask where, starting at the document (or `suggested`, a file name), and write there. */
  saveSceneAs: (bytes, suggested) => ipcRenderer.invoke('file:saveAs', { bytes, suggested }),
  exportBytes: (bytes, suggested, filters) =>
    ipcRenderer.invoke('file:export', { bytes, suggested, filters }),
  recentFiles: () => ipcRenderer.invoke('file:recents'),
  /** Pick an .obj and read its text, for File > Import OBJ. null when cancelled. */
  openObj: () => ipcRenderer.invoke('file:openObj'),
  /**
   * Which file the document is (a ref from an open or a save, or null
   * while untitled) and whether it has unsaved work: the window title and
   * the OS dirty dot follow it.
   */
  setDocument: (doc) => ipcRenderer.send('file:document', { ref: doc?.ref ?? null, dirty: !!doc?.dirty }),

  /**
   * The answer to a save the main process asked for (a window closing
   * with unsaved work): true when the file was written, false when the
   * user cancelled at the dialog or the save failed.
   */
  saveDone: (saved) => ipcRenderer.send('file:saveDone', { saved: !!saved }),

  // Native dialogs, because window.confirm/prompt block the renderer.
  confirm: (opts) => ipcRenderer.invoke('ui:confirm', opts),
  /** A multi-button question; resolves to the index of the button pressed. */
  ask: (opts) => ipcRenderer.invoke('ui:ask', opts),
  message: (opts) => ipcRenderer.invoke('ui:message', opts),

  // --- crash recovery ---------------------------------------------------
  /** Autosave to a sidecar under userData - never over the user's file. */
  writeRecovery: (bytes) => ipcRenderer.invoke('recovery:write', bytes),
  readRecovery: () => ipcRenderer.invoke('recovery:read'),
  clearRecovery: () => ipcRenderer.invoke('recovery:clear'),

  // --- the optional server ----------------------------------------------
  getServer: () => ipcRenderer.invoke('server:get'),
  setServer: (url) => ipcRenderer.invoke('server:set', url),
  /** Sign in to a Cloudflare Access deployment, in a real browser window. */
  signIn: () => ipcRenderer.invoke('server:signIn'),
  signOut: () => ipcRenderer.invoke('server:signOut'),
  /**
   * Proxy an API call through the main process. Requests from there carry
   * no Origin header, so the server's total absence of CORS stops
   * mattering, and the Access cookie rides along on a named session
   * partition exactly as it would in a browser tab.
   */
  api: (init) => ipcRenderer.invoke('server:fetch', init),

  // --- menu commands ----------------------------------------------------
  onCommand: (fn) => on('menu:command', fn),
  onOpenPath: (fn) => on('file:opened', fn),
});
