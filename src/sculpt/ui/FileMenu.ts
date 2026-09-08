import { div } from '../../ui/dom';
import { topbarLeft, topChip } from '../../ui/topbar';
import { PANEL_CLOSE_ALL_EVENT } from './ChromeToggle';
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
  readonly chip: HTMLButtonElement;
  private readonly pop: HTMLDivElement;
  private readonly openInput: HTMLInputElement;
  private readonly importInput: HTMLInputElement;
  private zUp = false;
  private opened = false;

  constructor(private readonly actions: FileActions) {
    this.chip = topChip('File') as HTMLButtonElement;
    this.chip.classList.add('file-menu__chip');
    this.chip.setAttribute('aria-haspopup', 'menu');
    this.chip.setAttribute('aria-expanded', 'false');
    this.chip.addEventListener('click', () => (this.opened ? this.close() : this.open()));

    this.pop = div('file-menu');
    this.pop.setAttribute('role', 'menu');
    this.pop.hidden = true;

    // Hidden inputs are how a web page asks for a file.
    this.openInput = fileInput('.bozz', (file) => void this.openFile(file));
    this.importInput = fileInput('.obj', (file) => void this.importFile(file));

    this.pop.append(
      this.item('New sculpt', async () => {
        if (this.actions.hasWork() && !confirm(`Start a new sculpt? ${this.actions.atRisk()} will be lost.`)) return;
        await this.actions.newScene();
      }),
      this.item('Open…', () => this.openInput.click()),
      this.item('Save file', async () => {
        const blob = await this.actions.pack();
        downloadBlob(blob, stampName('bozz'));
        this.actions.markClean(); // this scene now exists outside the browser
      }),
      this.item('Save to library', async () => {
        await this.actions.saveToLibrary();
        this.note('Saved to the library');
      }),
      separator(),
      this.item('Export OBJ', () => {
        downloadBlob(new Blob([this.actions.objText()], { type: 'text/plain' }), stampName('obj'));
      }),
      this.item('Import OBJ…', () => this.importInput.click()),
      this.toggle('Z-up OBJ import', () => this.zUp, (on) => (this.zUp = on)),
      this.openInput,
      this.importInput,
    );

    topbarLeft().appendChild(this.chip);
    document.body.appendChild(this.pop);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('resize', this.onResize);
    // Tab tidies the screen; an open menu is part of what it tidies.
    window.addEventListener(PANEL_CLOSE_ALL_EVENT, this.onCloseAll);
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.pop.hidden = false;
    this.place();
    this.chip.setAttribute('aria-expanded', 'true');
    this.chip.classList.add('topchip--open');
    this.pop.querySelector<HTMLButtonElement>('.file-menu__item')?.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.pop.hidden = true;
    this.chip.setAttribute('aria-expanded', 'false');
    this.chip.classList.remove('topchip--open');
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
    this.close();
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener(PANEL_CLOSE_ALL_EVENT, this.onCloseAll);
    this.chip.remove();
    this.pop.remove();
  }

  /** Under the chip, left-aligned with it. */
  private place(): void {
    const r = this.chip.getBoundingClientRect();
    this.pop.style.left = `${Math.round(r.left)}px`;
    this.pop.style.top = `${Math.round(r.bottom + 6)}px`;
  }

  private item(label: string, action: () => void | Promise<void>): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'file-menu__item';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    b.addEventListener('click', () => {
      this.close();
      // A command that throws must say so, or the menu "did nothing".
      Promise.resolve()
        .then(action)
        .catch((err: unknown) => alert(err instanceof Error ? err.message : String(err)));
    });
    return b;
  }

  private toggle(label: string, get: () => boolean, set: (on: boolean) => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'file-menu__item file-menu__item--toggle';
    b.setAttribute('role', 'menuitemcheckbox');
    b.textContent = label;
    const paint = (): void => {
      b.setAttribute('aria-checked', get() ? 'true' : 'false');
    };
    b.addEventListener('click', () => {
      set(!get());
      paint();
    });
    paint();
    return b;
  }

  /** A moment's confirmation for commands with nothing visible to show. */
  private note(text: string): void {
    const toast = div('sculpt-toast file-menu__note');
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1600);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.opened) return;
    const t = e.target as Node | null;
    if (t && (this.pop.contains(t) || this.chip.contains(t))) return;
    this.close();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    if (e.key === 'Escape') {
      this.close();
      this.chip.focus();
      e.preventDefault();
      return;
    }
    // Tab with focus outside the list is the sculpt shell's "tidy the
    // screen": the chip goes with the rest of the chrome, so the list must
    // not be left hanging under an empty row. Inside the list it still
    // walks the items.
    if (e.key === 'Tab' && !this.pop.contains(document.activeElement)) {
      this.close();
      return;
    }
    // Arrows walk the items; the sculpt shell must not see them as turntable steps.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...this.pop.querySelectorAll<HTMLButtonElement>('.file-menu__item')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  private readonly onResize = (): void => {
    if (this.opened) this.place();
  };

  private readonly onCloseAll = (): void => this.close();
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

function separator(): HTMLElement {
  const s = div('file-menu__sep');
  s.setAttribute('role', 'separator');
  return s;
}
