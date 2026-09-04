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

export interface DesktopBridge {
  version: string;
  platform: string;
  openScene(): Promise<SceneFilePayload | null>;
  readScene(path: string): Promise<SceneFilePayload>;
  saveScene(bytes: ArrayBuffer, path: string | null): Promise<SavedAt | null>;
  saveSceneAs(bytes: ArrayBuffer, suggested: string): Promise<SavedAt | null>;
  exportBytes(
    bytes: ArrayBuffer,
    suggested: string,
    filters?: { name: string; extensions: string[] }[],
  ): Promise<SavedAt | null>;
  recentFiles(): Promise<string[]>;
  setDocument(doc: { path: string | null; name: string | null; dirty: boolean }): void;
  writeRecovery(bytes: ArrayBuffer): Promise<boolean>;
  readRecovery(): Promise<ArrayBuffer | null>;
  clearRecovery(): Promise<boolean>;
  getServer(): Promise<{ url: string | null; signedIn: boolean }>;
  setServer(url: string | null): Promise<{ url: string | null; signedIn: boolean }>;
  signIn(): Promise<{ url: string; signedIn: boolean }>;
  signOut(): Promise<{ signedIn: boolean }>;
  api(init: {
    pathname: string;
    method?: string;
    body?: ArrayBuffer;
    contentType?: string;
  }): Promise<{ ok: boolean; status: number; contentType?: string; bytes?: ArrayBuffer; error?: string }>;
  confirm(opts: { message: string; detail?: string; confirmLabel?: string }): Promise<boolean>;
  message(opts: { message: string; detail?: string; type?: string }): Promise<boolean>;
  onCommand(fn: (command: string) => void): () => void;
  onOpenPath(fn: (payload: SceneFilePayload) => void): () => void;
}

export interface SceneFilePayload {
  path: string;
  name: string;
  bytes: ArrayBuffer;
}

interface SavedAt {
  path: string;
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
  /** OBJ text, for File > Export OBJ. */
  objText(): string | null;
  /** Undo/redo, so the menu items work without owning the keys. */
  undo(): void;
  redo(): void;
  /** Open the server settings UI. */
  showServerSettings(): void;
}

/**
 * The open document. A desktop app's title bar is a promise about where
 * Save will write; keeping that in one place is what stops the promise
 * from drifting away from the truth.
 */
class DocumentModel {
  private path: string | null = null;
  private name: string | null = null;
  private dirty = false;

  constructor(private readonly bridge: DesktopBridge) {}

  get filePath(): string | null {
    return this.path;
  }

  setFile(at: SavedAt | null): void {
    this.path = at?.path ?? null;
    this.name = at?.name ?? null;
    this.dirty = false;
    this.sync();
  }

  markDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.sync();
  }

  markClean(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.sync();
  }

  private sync(): void {
    this.bridge.setDocument({ path: this.path, name: this.name, dirty: this.dirty });
  }
}

let liveDoc: DocumentModel | null = null;

/**
 * The open scene has unsaved changes. Drives the title's bullet and the
 * macOS edited dot; called from the same signal the Open guard uses, so
 * the two cannot drift into disagreeing about what "changed" means.
 */
export function markDocumentDirty(): void {
  liveDoc?.markDirty();
}

/** Wire the desktop menu, document model and recovery sidecar to the app. */
export function mountDesktop(host: DocumentHost): (() => void) | null {
  const bridge = desktop();
  if (!bridge) return null;

  const doc = new DocumentModel(bridge);
  liveDoc = doc;
  doc.setFile(null);

  const openPayload = async (p: SceneFilePayload): Promise<void> => {
    await host.load(p.bytes);
    doc.setFile({ path: p.path, name: p.name });
    // The file on disk IS the work now, so the recovery copy of whatever
    // came before it is not just stale, it is misleading.
    await bridge.clearRecovery();
  };

  const save = async (forceDialog: boolean): Promise<void> => {
    const bytes = await host.pack();
    if (!bytes) return;
    const at = forceDialog
      ? await bridge.saveSceneAs(bytes, doc.filePath ?? 'sculpt.bozz')
      : await bridge.saveScene(bytes, doc.filePath);
    if (!at) return; // cancelled: the document is untouched, still dirty
    doc.setFile(at);
    await bridge.clearRecovery();
  };

  const commands: Record<string, () => void | Promise<void>> = {
    'file:new': async () => {
      await host.reset();
      doc.setFile(null);
      await bridge.clearRecovery();
    },
    'file:open': async () => {
      const p = await bridge.openScene();
      if (p) await openPayload(p);
    },
    'file:save': () => save(false),
    'file:saveAs': () => save(true),
    'file:exportObj': async () => {
      const text = host.objText();
      if (!text) return;
      await bridge.exportBytes(new TextEncoder().encode(text).buffer as ArrayBuffer, 'sculpt.obj', [
        { name: 'Wavefront OBJ', extensions: ['obj'] },
      ]);
    },
    'edit:undo': () => host.undo(),
    'edit:redo': () => host.redo(),
    'server:settings': () => host.showServerSettings(),
    'server:signIn': async () => {
      await bridge.signIn();
      host.showServerSettings();
    },
    'server:signOut': async () => {
      await bridge.signOut();
      host.showServerSettings();
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
  const offOpen = bridge.onOpenPath((p) => void openPayload(p));

  return () => {
    offCommand();
    offOpen();
    liveDoc = null;
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
 * Server settings: the address of a Cloudflare deployment to publish to,
 * and its sign-in state. Nothing here is required to use the app - with no
 * server set, Bozzetto is entirely local, which is the default.
 */
export async function showServerSettings(): Promise<void> {
  const bridge = desktop();
  if (!bridge) return;
  const { url, signedIn } = await bridge.getServer();

  const next = window.prompt(
    'Publish to your own Cloudflare deployment.\n\n' +
      'Enter the site root - https://example.com - or leave blank to stay fully local.\n' +
      (url ? `Currently: ${url} (${signedIn ? 'signed in' : 'not signed in'})` : 'No server set.'),
    url ?? '',
  );
  if (next === null) return; // cancelled

  try {
    const saved = await bridge.setServer(next.trim() || null);
    if (!saved.url) return;
    if (window.confirm(`Server set to ${saved.url}.\n\nSign in now?`)) {
      const after = await bridge.signIn();
      window.alert(after.signedIn ? 'Signed in.' : 'Not signed in - publishing will not work yet.');
    }
  } catch (err) {
    window.alert(err instanceof Error ? err.message : String(err));
  }
}
