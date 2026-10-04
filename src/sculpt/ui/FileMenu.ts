import { TopMenu } from './TopMenu';
import { statusToast } from './statusToast';
import { downloadBlob, stampName } from '../bridge/SceneFile';
import type { FileActions } from '../bridge/FileActions';
import { DEVICE_ONLY_NOTE } from '../../ui/deviceOnly';

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
  /** Whether the owner is signed in; null until the probe has answered. */
  private owner: boolean | null = null;
  private resolveOwner: (owner: boolean) => void = () => {};
  private readonly ownerKnown = new Promise<boolean>((resolve) => {
    this.resolveOwner = resolve;
  });

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

  /** The sign-in probe's answer, which decides what Save to library does. */
  setOwner(owner: boolean): void {
    this.owner = owner;
    this.resolveOwner(owner);
  }

  private libraryHint(): string {
    if (!this.owner) return 'Downloads a .bozz file to keep';
    const link = this.actions.link;
    return link ? `Updates "${link.title}" in Projects` : 'Uploads to Projects, as a private scene';
  }

  /**
   * Save to library: an upload to Projects for the owner, with its progress
   * shown until it ends; a .bozz download for everyone else. A failed
   * upload says so and leaves the work as it was - nothing is lost by it.
   */
  async saveToLibrary(): Promise<void> {
    const owner =
      this.owner ??
      (await Promise.race([
        this.ownerKnown,
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), ROLE_WAIT_MS)),
      ]));
    if (!owner) {
      downloadBlob(await this.actions.pack(), stampName('bozz'));
      this.actions.markClean(); // this scene now exists outside the browser
      this.menu.note('Saved as a .bozz file');
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
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      status.fail(
        `Not saved to Projects: ${why}. The scene is still here; Save file or Keep on this device keeps a copy.`,
      );
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
