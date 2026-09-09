import { div } from '../../ui/dom';
import { topbarLeft, topChip } from '../../ui/topbar';
import { PANEL_CLOSE_ALL_EVENT } from './ChromeToggle';

export type MenuItem =
  | { label: string; action: () => void | Promise<void> }
  | { label: string; checked: () => boolean; toggle: (on: boolean) => void }
  | { separator: true };

/**
 * A top-row menu: a chip beside the gallery link that drops a list of
 * commands. File and Edit are both one of these; the web page's stand-in
 * for the desktop app's native menu bar, over the same commands.
 *
 * Outside press, Escape and Tab close it; arrows walk the items; it hides
 * with the rest of the chrome. Questions and file pickers are the
 * caller's business - this only runs the item's action.
 */
export class TopMenu {
  readonly chip: HTMLButtonElement;
  readonly pop: HTMLDivElement;
  private opened = false;

  constructor(label: string, items: MenuItem[], cls: string) {
    this.chip = topChip(label) as HTMLButtonElement;
    this.chip.classList.add('file-menu__chip', `${cls}__chip`);
    this.chip.setAttribute('aria-haspopup', 'menu');
    this.chip.setAttribute('aria-expanded', 'false');
    this.chip.addEventListener('click', () => (this.opened ? this.close() : this.open()));

    this.pop = div(`file-menu ${cls}`);
    this.pop.setAttribute('role', 'menu');
    this.pop.hidden = true;
    for (const item of items) this.pop.appendChild(this.build(item));

    topbarLeft().appendChild(this.chip);
    document.body.appendChild(this.pop);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('resize', this.onResize);
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

  dispose(): void {
    this.close();
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener(PANEL_CLOSE_ALL_EVENT, this.onCloseAll);
    this.chip.remove();
    this.pop.remove();
  }

  /** A moment's confirmation for commands with nothing visible to show. */
  note(text: string): void {
    const toast = div('sculpt-toast file-menu__note');
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1600);
  }

  private build(item: MenuItem): HTMLElement {
    if ('separator' in item) {
      const s = div('file-menu__sep');
      s.setAttribute('role', 'separator');
      return s;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'file-menu__item';
    b.textContent = item.label;
    if ('toggle' in item) {
      b.classList.add('file-menu__item--toggle');
      b.setAttribute('role', 'menuitemcheckbox');
      const paint = (): void => b.setAttribute('aria-checked', item.checked() ? 'true' : 'false');
      b.addEventListener('click', () => {
        item.toggle(!item.checked());
        paint();
      });
      paint();
      return b;
    }
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => {
      this.close();
      // A command that throws must say so, or the menu "did nothing".
      Promise.resolve()
        .then(item.action)
        .catch((err: unknown) => alert(err instanceof Error ? err.message : String(err)));
    });
    return b;
  }

  /** Under the chip, left-aligned with it. */
  private place(): void {
    const r = this.chip.getBoundingClientRect();
    this.pop.style.left = `${Math.round(r.left)}px`;
    this.pop.style.top = `${Math.round(r.bottom + 6)}px`;
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
    // not be left hanging under an empty row.
    if (e.key === 'Tab' && !this.pop.contains(document.activeElement)) {
      this.close();
      return;
    }
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
