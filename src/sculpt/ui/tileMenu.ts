/**
 * The small menu of a tool tile, on the tool bar and in the Asset library:
 * a few rows in the app's menu look (`.file-menu`), at the tile. A tap
 * outside, Esc, a choice, the page being resized or scrolled all close it;
 * one is open at a time. The arrows walk it.
 */
export interface TileMenuItem {
  label: string;
  /** Greyed out: it does not apply now. */
  disabled?: boolean;
  action: () => void;
}

let closeOpen: (() => void) | null = null;

/** Close the menu that is open, if there is one. */
export function closeTileMenu(): void {
  closeOpen?.();
}

/**
 * Open a menu at a tile. `above`: it stands over the tile (the tool bar is
 * at the foot of the view); otherwise under it. Returns its element.
 */
export function openTileMenu(anchor: HTMLElement, items: TileMenuItem[], above: boolean): HTMLElement {
  closeOpen?.();
  const pop = document.createElement('div');
  pop.className = 'file-menu row-menu tile-menu';
  pop.setAttribute('role', 'menu');
  pop.dataset.role = 'tile-menu';
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'file-menu__item';
    b.setAttribute('role', 'menuitem');
    b.disabled = !!item.disabled;
    b.textContent = item.label;
    b.addEventListener('click', () => {
      close();
      item.action();
    });
    pop.appendChild(b);
    buttons.push(b);
  }
  document.body.appendChild(pop);
  // Placed once, when it opens: the tile's rectangle and the menu's own size.
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2, window.innerWidth - pop.offsetWidth - 8));
  const top = above ? r.top - pop.offsetHeight - 8 : r.bottom + 4;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(Math.max(8, Math.min(top, window.innerHeight - pop.offsetHeight - 8)))}px`;

  const onDown = (e: PointerEvent): void => {
    if (!pop.contains(e.target as Node | null)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const live = buttons.filter((b) => !b.disabled);
      if (!live.length) return;
      const i = live.indexOf(document.activeElement as HTMLButtonElement);
      live[e.key === 'ArrowDown' ? (i + 1) % live.length : (i - 1 + live.length) % live.length]?.focus();
      e.preventDefault();
    }
  };
  function close(): void {
    if (closeOpen !== close) return;
    closeOpen = null;
    pop.remove();
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
  }
  closeOpen = close;
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  return pop;
}
