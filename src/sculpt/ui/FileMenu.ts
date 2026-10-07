import { TopMenu } from './TopMenu';
import { statusToast, type StatusToast } from './statusToast';
import { downloadBlob, stampName } from '../bridge/SceneFile';
import { NotUploadedError, type FileActions } from '../bridge/FileActions';
import { AuthExpiredError, type Role, type SignInVia } from '../../admin/api';
import { DEVICE_ONLY_NOTE } from '../../ui/deviceOnly';
import { signInButton } from '../../ui/signIn';

/** How long a save waits on the sign-in probe before treating the visit as a guest's. */
const ROLE_WAIT_MS = 5000;

/**
 * The File menu: a chip in the top row, beside the gallery link, that
 * drops the file commands. The web page's counterpart to the desktop
 * app's native File menu - same commands, same FileActions behind them -
 * and absent in the desktop app, where the native one takes over.
 *
 * Questions are asked here, not in FileActions: the web asks with a plain
 * confirm(), the desktop with a Save / Don't Save / Cancel box, and the
 * scene logic underneath is the same either way.
 */
export class FileMenu {
  private readonly menu: TopMenu;
  private readonly openInput: HTMLInputElement;
  private readonly importInput: HTMLInputElement;
  private zUp = false;
  /** Who the page is for, by the sign-in probe; null until it has answered. */
  private role: Role | null = null;
  /** A suspended account's sentence, said when it tries to save to it. */
  private suspension = '';
  private resolveRole: (role: Role) => void = () => {};
  private readonly roleKnown = new Promise<Role>((resolve) => {
    this.resolveRole = resolve;
  });
  /**
   * A save found the sign-in expired. The mount asks the probe again, so
   * the forms and this menu all say so; a desktop sign-in that ended well
   * is reported the same way. Resolves once the probe has answered.
   */
  onSignInChange: (() => Promise<unknown> | void) | null = null;

  constructor(private readonly actions: FileActions) {
    // Hidden inputs are how a web page asks for a file.
    this.openInput = fileInput('.bozz', (file) => void this.openFile(file));
    this.importInput = fileInput('.obj', (file) => void this.importFile(file));
    this.menu = new TopMenu(
      'File',
      [
        {
          label: 'New sculpt',
          action: async () => {
            if (this.actions.hasWork() && !confirm(`Start a new sculpt? ${this.actions.atRisk()} will be lost.`)) return;
            await this.actions.newScene();
          },
        },
        { label: 'Open…', action: () => this.openInput.click() },
        {
          label: 'Save file',
          action: async () => {
            const blob = await this.actions.pack();
            downloadBlob(blob, stampName('bozz'));
            this.actions.markClean(); // this scene now exists outside the browser
          },
        },
        // Signed in, the library is Projects on the server. Signed out it is
        // a file (owner call): browser storage does not survive a
        // reinstall, and a .bozz download - the share sheet, on an iPad -
        // does. The device shelf stays one item down, so a guest keeps
        // every way of saving they had.
        {
          label: 'Save to library',
          hint: () => this.libraryHint(),
          action: () => this.saveToLibrary(),
        },
        {
          label: 'Keep on this device',
          hint: DEVICE_ONLY_NOTE,
          action: async () => {
            await this.actions.keepOnDevice();
            this.menu.note('Kept on this device');
          },
        },
        { separator: true },
        {
          label: 'Export OBJ',
          action: () => {
            downloadBlob(new Blob([this.actions.objText()], { type: 'text/plain' }), stampName('obj'));
          },
        },
        { label: 'Import OBJ…', action: () => this.importInput.click() },
        { label: 'Z-up OBJ import', checked: () => this.zUp, toggle: (on) => (this.zUp = on) },
      ],
      'file-menu--file',
    );
    this.menu.pop.append(this.openInput, this.importInput);
  }

  get chip(): HTMLButtonElement {
    return this.menu.chip;
  }

  /**
   * The sign-in probe's answer, which decides what Save to library does;
   * with `suspension`, what a suspended account is told when it saves.
   */
  setRole(role: Role, suspension = ''): void {
    this.role = role;
    this.suspension = suspension;
    this.resolveRole(role);
  }

  private libraryHint(): string {
    if (this.role === 'expired') return 'Your sign-in has expired: keeps it on this device until you sign in again';
    if (this.role === 'suspended') return 'Your account is suspended: downloads a .bozz file to keep';
    // Members' own library (My projects) comes with the next update; until
    // then theirs is a file, as a guest's is.
    if (this.role !== 'owner') return 'Downloads a .bozz file to keep';
    const link = this.actions.link;
    return link ? `Updates "${link.title}" in Projects` : 'Uploads to Projects, as a private scene';
  }

  /**
   * Save to library: an upload to Projects for the owner, with its progress
   * shown until it ends; a .bozz download for everyone else, a suspended
   * account told why it gets one. The owner
   * whose sign-in expired is still the owner: the upload is tried (the
   * session may have been renewed meanwhile), and when it cannot go the
   * scene is kept on this device and the notice offers Sign in again. A
   * failed upload never ends at an error alone. Signed in again in the
   * dialog, the save goes again by itself, once the probe has said who the
   * page is for now.
   */
  async saveToLibrary(): Promise<void> {
    const role =
      this.role ??
      (await Promise.race([
        this.roleKnown,
        new Promise<Role>((resolve) => window.setTimeout(() => resolve('guest'), ROLE_WAIT_MS)),
      ]));
    if (role !== 'owner' && role !== 'expired') {
      downloadBlob(await this.actions.pack(), stampName('bozz'));
      this.actions.markClean(); // this scene now exists outside the browser
      // A suspended account keeps nothing new, and is told why, with no
      // sign-in offered: signing in again would not lift it.
      if (role === 'suspended') statusToast('').fail(`${this.suspension} The scene was saved as a .bozz file instead.`);
      else this.menu.note('Saved as a .bozz file');
      return;
    }
    if (this.actions.isUploading()) {
      this.menu.note('Already saving to Projects');
      return;
    }
    const status = statusToast('Saving to Projects...');
    try {
      const link = await this.actions.uploadToProjects((text) => status.set(text));
      status.done(`Saved to Projects: ${link.title}`);
      if (role === 'expired') void this.onSignInChange?.();
    } catch (err) {
      // A sign-in the probe already found expired is the account's (with
      // accounts on), whatever the owner route answered: the dialog first.
      reportNotUploaded(
        status,
        err,
        async () => {
          await this.onSignInChange?.();
          await this.saveToLibrary();
        },
        role === 'expired' ? 'session' : undefined,
      );
      if (err instanceof NotUploadedError && err.reason === 'expired') void this.onSignInChange?.();
    }
  }

  isOpen(): boolean {
    return this.menu.isOpen();
  }

  open(): void {
    this.menu.open();
  }

  close(): void {
    this.menu.close();
  }

  /**
   * Open a .bozz file the user picked (also the path the tests drive). The
   * question comes after the unpack - a corrupt file costs no dialog - and
   * only when there is something to lose.
   */
  async openFile(file: File): Promise<boolean> {
    try {
      return await this.actions.replaceWith(
        await file.arrayBuffer(),
        () => !this.actions.hasWork() || confirm(`Open this file? ${this.actions.atRisk()} will be replaced.`),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /** Import an OBJ as a new object, named after the file. */
  async importFile(file: File): Promise<void> {
    try {
      const name = file.name.replace(/\.obj$/i, '').trim() || 'Imported';
      await this.actions.importObj(await file.text(), this.zUp, name);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  /** Whether OBJ imports are rotated from Z-up (the menu's toggle). */
  importsZUp(): boolean {
    return this.zUp;
  }

  dispose(): void {
    this.menu.dispose();
  }
}

/**
 * How a Save to library that did not upload ended, on its notice: what was
 * kept and where, and the next step - Sign in again, a connection, or the
 * server's own words. Shared by the web's File menu and the desktop app's.
 * `signedIn` hears a sign-in that ended well, in the desktop app's window
 * or the sign-in dialog; `viaOverride` says which sign-in to renew when
 * the caller knows better than the error (ui/signIn).
 */
export function reportNotUploaded(
  status: StatusToast,
  err: unknown,
  signedIn?: () => unknown,
  viaOverride?: SignInVia,
): void {
  if (!(err instanceof NotUploadedError)) {
    const why = err instanceof Error ? err.message : String(err);
    status.fail(`Not saved to Projects: ${why}. The scene is still here; Save file or Keep on this device keeps a copy.`);
    return;
  }
  // Which sign-in ran out decides how it is renewed: the account's in the
  // dialog, here; Access's through its login and back (ui/signIn).
  const via = viaOverride ?? (err.why instanceof AuthExpiredError ? err.why.via : undefined);
  const signIn =
    err.reason === 'expired'
      ? signInButton('', (ok) => (ok ? void signedIn?.() : undefined), 'Sign in again', via)
      : undefined;
  if (!err.kept) {
    // Nothing on the shelf either: the autosave still holds the scene, and
    // a file is the copy that does not depend on this device's storage.
    const lost = `this device could not keep a copy (${err.keepError?.message ?? 'storage refused'}). Save file keeps one`;
    const head =
      err.reason === 'expired'
        ? 'Your sign-in has expired'
        : err.reason === 'offline'
          ? 'No connection'
          : err.reason === 'suspended'
            ? err.why.message.replace(/\.$/, '')
            : `Not saved to Projects: ${err.why.message}`;
    status.fail(`${head}, and ${lost}.`, signIn);
    return;
  }
  if (err.reason === 'expired') {
    status.fail('Your sign-in has expired. Saved on this device.', signIn);
  } else if (err.reason === 'suspended') {
    // Said as the server's refusal is: no sign-in would lift it.
    status.fail(`${err.why.message} Saved on this device.`);
  } else if (err.reason === 'offline') {
    status.fail('No connection. Saved on this device; use Upload to Projects when you are online.');
  } else {
    status.fail(`Not saved to Projects: ${err.why.message}. Saved on this device; Upload to Projects tries again.`);
  }
}

function fileInput(accept: string, onFile: (file: File) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  });
  return input;
}
