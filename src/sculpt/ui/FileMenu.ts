import { TopMenu } from './TopMenu';
import { downloadBlob, stampName } from '../bridge/SceneFile';
import type { FileActions } from '../bridge/FileActions';

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
        {
          label: 'Save to library',
          action: async () => {
            await this.actions.saveToLibrary();
            this.menu.note('Saved to the library');
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
