import { div, onTap } from '../../ui/dom';
import { topbarLeft, topChip } from '../../ui/topbar';
import { PANEL_CLOSE_ALL_EVENT } from '../../ui/ChromeToggle';

/** Text that may depend on state: read again each time the menu opens. */
type MenuText = string | (() => string);

/** One of a choice row's small buttons (Mirror's X, Y and Z). */
export type MenuChoice = { label: string; title?: string; action: () => void | Promise<void> };

export type MenuItem =
  | {
      label: MenuText;
      hint?: MenuText;
      /** The hotkey that does the same, shown at the right (read on each open, so a rebind shows). */
      key?: MenuText;
      /** Greyed out and skipped by the arrows while this says no (read on each open). */
      enabled?: () => boolean;
      action: () => void | Promise<void>;
    }
  | { label: string; checked: () => boolean; toggle: (on: boolean) => void }
  | {
      /** A label and a row of small buttons, one command each, rebuilt on each open. */
      label: MenuText;
      key?: MenuText;
      enabled?: () => boolean;
      choices: () => MenuChoice[];
    }
  | { separator: true };

const read = (t: MenuText | undefined): string => (typeof t === 'function' ? t() : (t ?? ''));

/** A label with its hotkey at the right. */
function line(label: HTMLElement, key: string): HTMLElement {
  const row = document.createElement('span');
  row.className = 'file-menu__line';
  const kbd = document.createElement('kbd');
  kbd.className = 'file-menu__key';
  kbd.textContent = key;
  row.append(label, kbd);
  return row;
}

/**
 * A top-row menu: a chip beside the gallery link that drops a list of
 * commands. File and Edit are both one of these.
 *
 * Outside press, Escape and Tab close it; arrows walk the items; it hides
 * with the rest of the chrome. Questions and file pickers are the
 * caller's business - this only runs the item's action.
 */
export class TopMenu {
  readonly chip: HTMLButtonElement;
  readonly pop: HTMLDivElement;
  private opened = false;
  /** Re-reads each item's label and hint, run whenever the menu opens. */
  private readonly painters: Array<() => void> = [];

  /**
   * `host` is the row the chip goes in: the left one, beside the gallery
   * link, unless said otherwise (the account's menu sits on the right).
   */
  constructor(label: string, items: MenuItem[], cls: string, host: HTMLElement = topbarLeft()) {
    this.chip = topChip(label) as HTMLButtonElement;
    this.chip.classList.add('file-menu__chip', `${cls}__chip`);
    this.chip.setAttribute('aria-haspopup', 'menu');
    this.chip.setAttribute('aria-expanded', 'false');
    this.chip.addEventListener('click', () => (this.opened ? this.close() : this.open()));

    this.pop = div(`file-menu ${cls}`);
    this.pop.setAttribute('role', 'menu');
    this.pop.hidden = true;
    for (const item of items) this.pop.appendChild(this.build(item));

    host.appendChild(this.chip);
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
    for (const paint of this.painters) paint();
    this.pop.hidden = false;
    this.place();
    this.chip.setAttribute('aria-expanded', 'true');
    this.chip.classList.add('topchip--open');
    this.pop.querySelector<HTMLButtonElement>('.file-menu__item:not(:disabled)')?.focus();
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
    if ('choices' in item) return this.buildChoices(item);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'file-menu__item';
    // A tap, not a click (ui/dom onTap): on an iPad a finger held a moment
    // on an item would otherwise never become a click.
    if ('toggle' in item) {
      b.textContent = item.label;
      b.classList.add('file-menu__item--toggle');
      b.setAttribute('role', 'menuitemcheckbox');
      const paint = (): void => b.setAttribute('aria-checked', item.checked() ? 'true' : 'false');
      onTap(b, () => {
        item.toggle(!item.checked());
        paint();
      });
      paint();
      return b;
    }
    // A hint is a second, quieter line saying what the command will do
    // where that depends on more than its name (signed in or not); a key
    // is the hotkey that does the same, at the right. Items with neither
    // stay plain text.
    const paint = (): void => {
      if (item.enabled) b.disabled = !item.enabled();
      const hint = read(item.hint);
      const key = read(item.key);
      if (!hint && !key) {
        b.textContent = read(item.label);
        return;
      }
      const label = document.createElement('span');
      label.className = 'file-menu__label';
      label.textContent = read(item.label);
      const parts: HTMLElement[] = [key ? line(label, key) : label];
      if (hint) {
        const note = document.createElement('span');
        note.className = 'file-menu__hint';
        note.textContent = hint;
        parts.push(note);
      }
      b.replaceChildren(...parts);
    };
    paint();
    this.painters.push(paint);
    b.setAttribute('role', 'menuitem');
    onTap(b, () => {
      if (b.disabled) return;
      this.run(item.action);
    });
    return b;
  }

  /** Close, then run a command; one that throws must say so, or the menu "did nothing". */
  private run(action: () => void | Promise<void>): void {
    this.close();
    Promise.resolve()
      .then(action)
      .catch((err: unknown) => alert(err instanceof Error ? err.message : String(err)));
  }

  /**
   * A choice row: the label, then a small button per choice, each its own
   * menu item for the arrows. Rebuilt on each open, since the choices may
   * name state (the radial copies' axis).
   */
  private buildChoices(item: Extract<MenuItem, { choices: () => MenuChoice[] }>): HTMLElement {
    const row = div('file-menu__choices');
    row.setAttribute('role', 'group');
    const paint = (): void => {
      const on = item.enabled ? item.enabled() : true;
      const label = document.createElement('span');
      label.className = 'file-menu__label';
      label.textContent = read(item.label);
      const key = read(item.key);
      row.setAttribute('aria-label', read(item.label));
      row.classList.toggle('file-menu__choices--off', !on);
      const buttons = div('file-menu__choice-row');
      for (const choice of item.choices()) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'file-menu__item file-menu__choice';
        b.setAttribute('role', 'menuitem');
        b.textContent = choice.label;
        if (choice.title) b.title = choice.title;
        b.disabled = !on;
        onTap(b, () => {
          if (b.disabled) return;
          this.run(choice.action);
        });
        buttons.appendChild(b);
      }
      row.replaceChildren(key ? line(label, key) : label, buttons);
    };
    paint();
    this.painters.push(paint);
    return row;
  }

  /** Under the chip, left-aligned with it, and kept on screen: a chip at the right edge has its list end there. */
  private place(): void {
    const r = this.chip.getBoundingClientRect();
    const room = window.innerWidth - this.pop.offsetWidth - 8;
    this.pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, room)))}px`;
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
      const items = [...this.pop.querySelectorAll<HTMLButtonElement>('.file-menu__item:not(:disabled)')];
      if (!items.length) return;
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
