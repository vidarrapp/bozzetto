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
  | {
      label: MenuText;
      /** The hotkey that does the same, at the right (read on each open). */
      key?: MenuText;
      /** Greyed out and skipped by the arrows while this says no. */
      enabled?: () => boolean;
      checked: () => boolean;
      toggle: (on: boolean) => void;
    }
  | {
      /** A label and a row of small buttons, one command each, rebuilt on each open. */
      label: MenuText;
      key?: MenuText;
      enabled?: () => boolean;
      choices: () => MenuChoice[];
    }
  | {
      /** A row with a chevron that opens a second list beside the menu; the items are read again on each open. */
      label: MenuText;
      hint?: MenuText;
      enabled?: () => boolean;
      submenu: () => MenuItem[];
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
 * A menu: its name in the title strip (a chip in the gallery's top row) that drops a list of
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
  /** The second list, while one is open, and the row that opened it. */
  private sub: HTMLDivElement | null = null;
  private subRow: HTMLElement | null = null;
  private readonly plain: boolean;
  /** Re-reads each item's label and hint, run whenever the menu opens. */
  private readonly painters: Array<() => void> = [];

  /**
   * `host` is the row the chip goes in: the left one, beside the gallery
   * link, unless said otherwise (the account's menu sits on the right).
   * With `plain`, the name is bare text in the title strip (shell.css)
   * rather than a chip, and the list hangs from the strip's lower edge.
   */
  constructor(label: string, items: MenuItem[], cls: string, host: HTMLElement = topbarLeft(), plain = false) {
    this.plain = plain;
    if (plain) {
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'bz-menuname';
      name.textContent = label;
      this.chip = name;
    } else {
      this.chip = topChip(label) as HTMLButtonElement;
    }
    this.chip.classList.add('file-menu__chip', `${cls}__chip`);
    this.chip.setAttribute('aria-haspopup', 'menu');
    this.chip.setAttribute('aria-expanded', 'false');
    this.chip.addEventListener('click', () => (this.opened ? this.close() : this.open()));

    this.pop = div(`file-menu ${cls}`);
    this.pop.setAttribute('role', 'menu');
    this.pop.hidden = true;
    this.setItems(items);

    host.appendChild(this.chip);
    document.body.appendChild(this.pop);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('resize', this.onResize);
    window.addEventListener(PANEL_CLOSE_ALL_EVENT, this.onCloseAll);
  }

  /** Replace the rows (a menu whose items depend on who is looking, known after it is drawn). */
  setItems(items: MenuItem[]): void {
    this.painters.length = 0;
    this.pop.replaceChildren(...items.map((item) => this.build(item)));
    if (this.opened) {
      for (const paint of this.painters) paint();
      this.place();
    }
  }

  /** Show or hide the menu's name (a menu with nothing in it for this person has none). */
  setShown(shown: boolean): void {
    this.chip.hidden = !shown;
    if (!shown) this.close();
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
    this.chip.classList.add('topchip--open', 'is-open');
    this.pop.querySelector<HTMLButtonElement>('.file-menu__item:not(:disabled)')?.focus();
  }

  close(): void {
    this.closeSub(false);
    if (!this.opened) return;
    this.opened = false;
    this.pop.hidden = true;
    this.chip.setAttribute('aria-expanded', 'false');
    this.chip.classList.remove('topchip--open', 'is-open');
  }

  dispose(): void {
    this.close();
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener(PANEL_CLOSE_ALL_EVENT, this.onCloseAll);
    this.chip.remove();
    this.pop.remove();
    this.sub?.remove();
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
    if ('submenu' in item) return this.buildSub(item);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'file-menu__item';
    // A tap, not a click (ui/dom onTap): on an iPad a finger held a moment
    // on an item would otherwise never become a click.
    if ('toggle' in item) {
      b.classList.add('file-menu__item--toggle');
      b.setAttribute('role', 'menuitemcheckbox');
      const paint = (): void => {
        if (item.enabled) b.disabled = !item.enabled();
        const label = document.createElement('span');
        label.className = 'file-menu__label';
        label.textContent = read(item.label);
        const key = read(item.key);
        b.replaceChildren(key ? line(label, key) : label);
        b.setAttribute('aria-checked', item.checked() ? 'true' : 'false');
      };
      onTap(b, () => {
        if (b.disabled) return;
        item.toggle(!item.checked());
        paint();
      });
      paint();
      this.painters.push(paint);
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

  /** A row that opens a second list: label, an optional hint, a chevron at the right. */
  private buildSub(item: Extract<MenuItem, { submenu: () => MenuItem[] }>): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'file-menu__item file-menu__item--sub';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    const paint = (): void => {
      if (item.enabled) b.disabled = !item.enabled();
      const label = document.createElement('span');
      label.className = 'file-menu__label';
      label.textContent = read(item.label);
      const row = line(label, '\u203a');
      row.querySelector('kbd')?.classList.add('file-menu__chev');
      const parts: HTMLElement[] = [row];
      const hint = read(item.hint);
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
    onTap(b, () => {
      if (b.disabled) return;
      if (this.subRow === b) this.closeSub(true);
      else this.openSub(b, item.submenu());
    });
    return b;
  }

  /** On a narrow screen the second list takes the first one's place, with a Back row on top. */
  private narrow(): boolean {
    return window.innerWidth <= 600;
  }

  private openSub(row: HTMLElement, items: MenuItem[]): void {
    this.closeSub(false);
    const sub = div('file-menu file-menu--sub');
    sub.setAttribute('role', 'menu');
    const kept = this.painters.length;
    const rows = items.map((item) => this.build(item));
    this.painters.length = kept; // rebuilt on each open: never repainted
    if (this.narrow()) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'file-menu__item file-menu__item--back';
      back.setAttribute('role', 'menuitem');
      back.textContent = '\u2039 Back';
      onTap(back, () => this.closeSub(true));
      rows.unshift(back, div('file-menu__sep'));
    }
    sub.replaceChildren(...rows);
    sub.style.visibility = 'hidden';
    document.body.appendChild(sub);
    this.sub = sub;
    this.subRow = row;
    row.setAttribute('aria-expanded', 'true');
    row.classList.add('file-menu__item--open');
    const pr = this.pop.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    let left: number;
    let top: number;
    if (this.narrow()) {
      sub.style.minWidth = `${Math.round(pr.width)}px`;
      left = pr.left;
      top = pr.top;
      this.pop.style.visibility = 'hidden';
    } else {
      left = pr.right - 2;
      if (left + sub.offsetWidth > window.innerWidth - 8) left = Math.max(8, pr.left - sub.offsetWidth + 2);
      top = Math.max(8, Math.min(rr.top - 6, window.innerHeight - sub.offsetHeight - 8));
    }
    sub.style.left = `${Math.round(left)}px`;
    sub.style.top = `${Math.round(top)}px`;
    sub.style.visibility = '';
    sub.querySelector<HTMLButtonElement>('.file-menu__item:not(:disabled):not(.file-menu__item--back)')?.focus();
  }

  /** Close the second list; with `focus`, the row that opened it takes the focus back. */
  private closeSub(focus: boolean): void {
    if (!this.sub) return;
    this.sub.remove();
    this.sub = null;
    this.pop.style.visibility = '';
    const row = this.subRow;
    this.subRow = null;
    row?.setAttribute('aria-expanded', 'false');
    row?.classList.remove('file-menu__item--open');
    if (focus) row?.focus();
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
    this.pop.style.top = `${Math.round(this.plain ? r.bottom : r.bottom + 6)}px`;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.opened) return;
    const t = e.target as Node | null;
    if (t && (this.pop.contains(t) || this.chip.contains(t) || this.sub?.contains(t))) return;
    this.close();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    if (this.sub && (e.key === 'Escape' || e.key === 'ArrowLeft')) {
      this.closeSub(true);
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === 'ArrowRight' && document.activeElement instanceof HTMLButtonElement && document.activeElement.classList.contains('file-menu__item--sub') && this.pop.contains(document.activeElement)) {
      document.activeElement.click();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === 'Escape') {
      this.close();
      this.chip.focus();
      e.preventDefault();
      return;
    }
    // Tab with focus outside the list is the sculpt shell's "tidy the
    // screen": the chip goes with the rest of the chrome, so the list must
    // not be left hanging under an empty row.
    if (e.key === 'Tab' && !this.pop.contains(document.activeElement) && !this.sub?.contains(document.activeElement)) {
      this.close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = this.sub && this.sub.contains(document.activeElement) ? this.sub : this.pop;
      const items = [...list.querySelectorAll<HTMLButtonElement>('.file-menu__item:not(:disabled)')];
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
