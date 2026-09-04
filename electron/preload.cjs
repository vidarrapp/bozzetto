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

contextBridge.exposeInMainWorld('bozzettoDesktop', {
  version: process.versions.electron,
  platform: process.platform,

  // --- files ------------------------------------------------------------
  /** Ask for a path (OS dialog), then read it. null when cancelled. */
  openScene: () => ipcRenderer.invoke('file:open'),
  /** Read a known path, for recents and for files opened from the OS. */
  readScene: (filePath) => ipcRenderer.invoke('file:read', filePath),
  /** Write bytes to the current path, or prompt when there is none. */
  saveScene: (bytes, filePath) => ipcRenderer.invoke('file:save', { bytes, filePath }),
  saveSceneAs: (bytes, suggested) => ipcRenderer.invoke('file:saveAs', { bytes, suggested }),
  exportBytes: (bytes, suggested, filters) =>
    ipcRenderer.invoke('file:export', { bytes, suggested, filters }),
  recentFiles: () => ipcRenderer.invoke('file:recents'),
  /** Reflect the document into the window title and the OS dirty dot. */
  setDocument: (doc) => ipcRenderer.send('file:document', doc),

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
