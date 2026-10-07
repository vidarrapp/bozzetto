/**
 * The renderer half of the desktop app: the document model, the menu
 * commands, and the recovery sidecar.
 *
 * All of it is inert in a browser - every entry point returns early when
 * window.bozzettoDesktop is absent - so the web build carries a few dead
 * branches and nothing else.
 *
 * The document model is the piece the web app never needed. On the web a
 * scene is either "in the browser" or "downloaded"; here it has a path, a
 * name, and a dirty flag, and those three things drive the window title,
 * the OS edited-dot, what Save writes to, and what Cmd+S means.
 */
import { isDesktop } from '../net/origin';
import { serverSettings, signInToServer, signOutOfServer } from './ServerSettings';

export interface DesktopBridge {
  version: string;
  platform: string;
  openScene(): Promise<SceneFilePayload | null>;
  /** A file on the recents list; the main process refuses any other path. */
  readScene(path: string): Promise<SceneFilePayload>;
  /** Write to this window's document, whose path only the main process knows, or ask where. */
  saveScene(bytes: ArrayBuffer): Promise<SavedAt | null>;
  /** Ask where, starting at the document; `suggested` is a file name for an untitled one. */
  saveSceneAs(bytes: ArrayBuffer, suggested: string): Promise<SavedAt | null>;
  exportBytes(
    bytes: ArrayBuffer,
    suggested: string,
    filters?: { name: string; extensions: string[] }[],
  ): Promise<{ name: string } | null>;
  recentFiles(): Promise<string[]>;
  /** Pick an OBJ file and read it. null when cancelled. */
  openObj(): Promise<{ name: string; text: string } | null>;
  /** Which file the document is (a ref, or null while untitled) and whether it has unsaved work. */
  setDocument(doc: { ref: number | null; dirty: boolean }): void;
  /** Answer a save the main process asked for (see 'file:saveForClose'). */
  saveDone(saved: boolean): void;
  writeRecovery(bytes: ArrayBuffer): Promise<boolean>;
  readRecovery(): Promise<ArrayBuffer | null>;
  clearRecovery(): Promise<boolean>;
  /**
   * The server, and whether the jar holds the cookie that signs in to it:
   * the account's session where the server has accounts (`accounts`, as its
   * /api/config said; null when it could not be asked), Access's where it
   * has not. A cookie is not proof of a session: serverAccount asks.
   */
  getServer(): Promise<ServerInfo>;
  setServer(url: string | null): Promise<ServerInfo>;
  /** The sign-in window: the server's own sign-in page with accounts, Cloudflare Access without. */
  signIn(): Promise<{ url: string; signedIn: boolean; accounts: boolean | null }>;
  /**
   * Sign out: an account's session ended on the server first, then every
   * cookie gone. `revoked` is whether the server ended it, null when there
   * was no account's session to end.
   */
  signOut(): Promise<{ signedIn: boolean; revoked: boolean | null }>;
  api(init: {
    pathname: string;
    method?: string;
    body?: ArrayBuffer;
    contentType?: string;
  }): Promise<{ ok: boolean; status: number; contentType?: string; bytes?: ArrayBuffer; error?: string }>;
  confirm(opts: { message: string; detail?: string; confirmLabel?: string }): Promise<boolean>;
  /** A multi-button question; resolves to the index of the button pressed. */
  ask(opts: { message: string; detail?: string; buttons: string[] }): Promise<number>;
  message(opts: { message: string; detail?: string; type?: string }): Promise<boolean>;
  onCommand(fn: (command: string) => void): () => void;
  onOpenPath(fn: (payload: SceneFilePayload) => void): () => void;
}

/** What the main process says of the server (server:get). */
export interface ServerInfo {
  url: string | null;
  signedIn: boolean;
  /** Whether the server has accounts, as its /api/config said; null when it could not be asked. */
  accounts: boolean | null;
}

/**
 * A scene file the main process read for this window. Never its path: the
 * page names the file back by `ref` (setDocument), and the main process
 * alone knows where it is and where Save writes.
 */
export interface SceneFilePayload {
  ref: number;
  name: string;
  bytes: ArrayBuffer;
}

/** A file the document now is, after an open or a save. */
interface SavedAt {
  ref: number;
  name: string;
}

export function desktop(): DesktopBridge | null {
  return isDesktop()
    ? ((window as unknown as { bozzettoDesktop: DesktopBridge }).bozzettoDesktop)
    : null;
}

/** What the renderer must supply for the desktop file commands to work. */
export interface DocumentHost {
  /** Pack the live scene to .bozz bytes, or null when there is nothing. */
  pack(): Promise<ArrayBuffer | null>;
  /** Replace the live scene with these bytes. Throws on a bad file. */
  load(bytes: ArrayBuffer): Promise<void>;
  /** Start over, as File > New would. */
  reset(): Promise<void>;
  /**
   * Is there work that exists nowhere else? The same answer the File
   * panel's own Open gives, so the menu and the panel agree on what is
   * worth a question.
   */
  hasWork(): boolean;
  /** What is on screen is now what is in the file: a save just happened. */
  markClean(): void;
  /**
   * File > Save to Library: to Projects on the configured server when
   * signed in to it, otherwise onto this device's shelf.
   */
  saveToLibrary(): Promise<void>;
  /** Bring an OBJ in as a new object (File > Import OBJ). */
  importObj(text: string, zUp: boolean, name: string): Promise<void>;
  /** OBJ text, for File > Export OBJ. */
  objText(): string | null;
  /** Undo/redo, so the menu items work without owning the keys. */
  undo(): void;
  redo(): void;
  /** Open the server settings UI. */
  showServerSettings(): void;
  /**
   * The sign-in to the server changed (Server settings or the Server
   * menu): ask again who the page is for, so publishing and Save to
   * Library follow it rather than the last answer.
   */
  signInChanged(): void;
  /** Open Preferences (the hotkey editor). */
  showPreferences(): void;
}

/**
 * The open document. A desktop app's title bar is a promise about where
 * Save will write; keeping that in one place is what stops the promise
 * from drifting away from the truth. The place is the main process, which
 * holds the path: this side knows the file by its ref and its name.
 */
class DocumentModel {
  private ref: number | null = null;
  private name: string | null = null;
  private dirty = false;

  constructor(private readonly bridge: DesktopBridge) {}

  get fileName(): string | null {
    return this.name;
  }

  setFile(at: SavedAt | null): void {
    this.ref = at?.ref ?? null;
    this.name = at?.name ?? null;
    this.dirty = false;
    this.sync();
  }

  setDirty(dirty: boolean): void {
    if (this.held || this.dirty === dirty) return;
    this.dirty = dirty;
    this.sync();
  }

  /**
   * Replacing the scene (New, Open) fires the same edit signals a stroke
   * does, so without this the dot flickers on for the moment between the
   * old scene going and the new clean point being set. The caller sets
   * the document itself when it is done.
   */
  private held = false;
  async whileReplacing<T>(fn: () => Promise<T>): Promise<T> {
    this.held = true;
    try {
      return await fn();
    } finally {
      this.held = false;
    }
  }

  private sync(): void {
    this.bridge.setDocument({ ref: this.ref, dirty: this.dirty });
  }
}

let liveDoc: DocumentModel | null = null;
/** The mounted page's "ask again who this is for", for Server settings. */
let liveSignInChanged: (() => void) | null = null;

/**
 * Does the open scene have unsaved changes? Drives the title's bullet, the
 * macOS edited dot and the close-window guard. Called on every edit with
 * the File panel's own "is there work?" answer, so the title, the guard
 * and the panel's Open cannot disagree about what "changed" means.
 */
export function setDocumentDirty(dirty: boolean): void {
  liveDoc?.setDirty(dirty);
}

/** Wire the desktop menu, document model and recovery sidecar to the app. */
export function mountDesktop(host: DocumentHost): (() => void) | null {
  const bridge = desktop();
  if (!bridge) return null;

  const doc = new DocumentModel(bridge);
  liveDoc = doc;
  liveSignInChanged = () => host.signInChanged();
  doc.setFile(null);

  /** Save to the document, or ask where. True when a file was written. */
  const save = async (forceDialog: boolean): Promise<boolean> => {
    const bytes = await host.pack();
    if (!bytes) return false;
    const at = forceDialog
      ? await bridge.saveSceneAs(bytes, doc.fileName ?? 'sculpt.bozz')
      : await bridge.saveScene(bytes);
    if (!at) return false; // cancelled: the document is untouched, still dirty
    doc.setFile(at);
    host.markClean();
    await bridge.clearRecovery();
    return true;
  };

  /**
   * Before the scene is replaced: Save / Don't Save / Cancel when there is
   * work to lose, nothing at all when there is not. Resolves true when it
   * is fine to go ahead.
   */
  const settle = async (before: string): Promise<boolean> => {
    if (!host.hasWork()) return true;
    const choice = await bridge.ask({
      message: `Save changes before ${before}?`,
      detail: doc.fileName
        ? `${doc.fileName} on disk will not have your latest changes otherwise.`
        : 'This sculpt has not been saved to a file.',
      buttons: ['Save', "Don't Save", 'Cancel'],
    });
    if (choice === 2) return false;
    if (choice === 0) return save(false);
    return true;
  };

  const openPayload = async (p: SceneFilePayload): Promise<void> => {
    await doc.whileReplacing(() => host.load(p.bytes));
    doc.setFile({ ref: p.ref, name: p.name });
    // The file on disk IS the work now, so the recovery copy of whatever
    // came before it is not just stale, it is misleading.
    await bridge.clearRecovery();
  };

  const importObj = async (zUp: boolean): Promise<void> => {
    const picked = await bridge.openObj();
    if (!picked) return;
    const name = picked.name.replace(/\.obj$/i, '').trim() || 'Imported';
    await host.importObj(picked.text, zUp, name);
  };

  const commands: Record<string, () => void | Promise<void>> = {
    'file:new': async () => {
      if (!(await settle('starting a new sculpt'))) return;
      await doc.whileReplacing(() => host.reset());
      doc.setFile(null);
      await bridge.clearRecovery();
    },
    'file:open': async () => {
      // The question first, the picker second: a picker that had already
      // read a file into memory and then asked would be work for nothing
      // when the answer is Cancel.
      if (!(await settle('opening another sculpt'))) return;
      const p = await bridge.openScene();
      if (p) await openPayload(p);
    },
    'file:save': () => void save(false),
    'file:saveAs': () => void save(true),
    // The window is closing with unsaved work and the user chose Save. The
    // main process is waiting on the answer, so it MUST get one even when
    // the save throws - or the window can never close.
    'file:saveForClose': async () => {
      let saved = false;
      try {
        saved = await save(false);
      } finally {
        bridge.saveDone(saved);
      }
    },
    'file:saveToLibrary': () => host.saveToLibrary(),
    'file:importObj': () => importObj(false),
    'file:importObjZUp': () => importObj(true),
    'file:exportObj': async () => {
      const text = host.objText();
      if (!text) return;
      await bridge.exportBytes(new TextEncoder().encode(text).buffer as ArrayBuffer, 'sculpt.obj', [
        { name: 'Wavefront OBJ', extensions: ['obj'] },
      ]);
    },
    'edit:undo': () => host.undo(),
    'edit:redo': () => host.redo(),
    'edit:preferences': () => host.showPreferences(),
    'server:settings': () => host.showServerSettings(),
    'server:signIn': async () => {
      await signInToServer(bridge);
      host.signInChanged();
      host.showServerSettings();
    },
    'server:signOut': async () => {
      const ended = await signOutOfServer(bridge);
      host.signInChanged();
      host.showServerSettings();
      if (!ended) {
        await bridge.message({
          type: 'warning',
          message: 'Signed out on this computer.',
          detail: 'The server did not answer, so the session there ends when it runs out.',
        });
      }
    },
  };

  // Visible in the console and to the smoke tests: the difference between
  // "the menu did nothing" and "the renderer never wired the menu up" is
  // most of the debugging time in a shell like this.
  console.info(`bozzetto desktop: ${Object.keys(commands).length} commands wired`);
  const offCommand = bridge.onCommand((c) => {
    console.info('bozzetto desktop: command', c);
    // A menu command that throws must say so. Unhandled, these surface only
    // as "the menu did nothing", which is the least debuggable failure a
    // desktop app has.
    Promise.resolve(commands[c]?.()).catch((err) => {
      console.error('bozzetto desktop: command failed', c, err);
      void bridge.message({
        type: 'error',
        message: `Could not complete ${c.replace(/^\w+:/, '')}.`,
        detail: err instanceof Error ? err.message : String(err),
      });
    });
  });
  // A file from the OS: a double-click, a recent, a drag onto the icon.
  const offOpen = bridge.onOpenPath((p) => {
    settle(`opening ${p.name}`)
      .then((go) => (go ? openPayload(p) : undefined))
      .catch((err) => {
        console.error('bozzetto desktop: open failed', p.name, err);
        void bridge.message({
          type: 'error',
          message: `Could not open ${p.name}.`,
          detail: err instanceof Error ? err.message : String(err),
        });
      });
  });

  return () => {
    offCommand();
    offOpen();
    liveDoc = null;
    liveSignInChanged = null;
  };
}

/**
 * The recovery sidecar.
 *
 * Deliberately NOT a write-through to the open document. If a background
 * timer wrote to the user's file, Save would stop meaning anything and
 * closing without saving would be impossible - so this writes its own copy
 * under userData, and the app offers it back after a crash.
 *
 * The write is atomic on the main-process side (temp file plus rename),
 * which matters more here than it did in IndexedDB: a put() was
 * transactional and fs.writeFile is not, so the naive port would have
 * introduced truncated-file corruption where none was possible before.
 */
export async function writeRecovery(bytes: ArrayBuffer): Promise<boolean> {
  const bridge = desktop();
  if (!bridge) return false;
  try {
    return await bridge.writeRecovery(bytes);
  } catch {
    return false; // a failed recovery write must never break a stroke
  }
}

export async function readRecovery(): Promise<ArrayBuffer | null> {
  const bridge = desktop();
  if (!bridge) return null;
  try {
    return await bridge.readRecovery();
  } catch {
    return null;
  }
}

/** Drop the sidecar: the user asked for a clean start, so nothing to offer. */
export async function clearRecovery(): Promise<void> {
  const bridge = desktop();
  if (!bridge) return;
  try {
    await bridge.clearRecovery();
  } catch {
    // Not worth blocking a fresh start over.
  }
}

/**
 * A sidecar survived from a previous run, so the app did not close
 * cleanly. Offer it rather than restoring silently: the user may have
 * quit deliberately, and silently reviving a scene they abandoned is its
 * own kind of data loss.
 */
export async function offerRecovery(load: (bytes: ArrayBuffer) => Promise<void>): Promise<void> {
  const bridge = desktop();
  if (!bridge) return;
  const bytes = await readRecovery();
  if (!bytes || bytes.byteLength === 0) return;
  const restore = await bridge.confirm({
    message: 'Recover your last sculpt?',
    detail:
      'Bozzetto closed unexpectedly. A copy of the work in progress was kept and can be restored.',
    confirmLabel: 'Recover',
  });
  if (restore) {
    try {
      await load(bytes);
    } catch {
      await bridge.message({
        type: 'error',
        message: 'That recovery file could not be read.',
        detail: 'The previous session could not be restored.',
      });
    }
  }
  // Either way the sidecar has served its purpose; keeping it would ask
  // the same question at every launch from here on.
  await bridge.clearRecovery();
}

/**
 * Server settings, as a panel rather than a prompt. Mounted once and
 * reopened, so the input keeps focus behaviour and the panel does not
 * accumulate in the DOM.
 */
let settingsPanel: ReturnType<typeof serverSettings> | null = null;

export async function showServerSettings(): Promise<void> {
  const bridge = desktop();
  if (!bridge) return;
  if (!settingsPanel) {
    // Resolved at the moment of the change: the panel outlives the page
    // that first opened it.
    settingsPanel = serverSettings(bridge, () => liveSignInChanged?.());
    document.body.appendChild(settingsPanel.root);
  }
  await settingsPanel.open();
}
