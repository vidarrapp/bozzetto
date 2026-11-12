/**
 * A "More" button with a short list under it, for the actions a card keeps
 * out of the way (My projects: Download, Rename). The list is the app's
 * menu (`.file-menu`), drawn under the button and left aligned with it;
 * an outside press, Escape or a choice closes it, the arrows walk it.
 * The chevron is the button's own (`.row-more` in style.css), so its text
 * can say something else meanwhile (a download's progress).
 */
export interface RowMenuItem {
  label: string;
  className?: string;
  action: () => void;
}

export interface RowMenu {
  readonly wrap: HTMLElement;
  readonly trigger: HTMLButtonElement;
  /** The list's buttons, to disable one while it has nothing to do. */
  readonly items: HTMLButtonElement[];
}

export function rowMenu(label: string, items: RowMenuItem[], className = ''): RowMenu {
  const wrap = document.createElement('div');
  wrap.className = 'row-more-wrap';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `btn row-more${className ? ` ${className}` : ''}`;
  trigger.textContent = label;
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const pop = document.createElement('div');
  pop.className = 'file-menu row-menu';
  pop.setAttribute('role', 'menu');
  pop.hidden = true;
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `file-menu__item${item.className ? ` ${item.className}` : ''}`;
    b.setAttribute('role', 'menuitem');
    b.textContent = item.label;
    b.addEventListener('click', () => {
      close();
      item.action();
    });
    pop.appendChild(b);
    buttons.push(b);
  }
  wrap.append(trigger, pop);

  const place = (): void => {
    const r = trigger.getBoundingClientRect();
    const room = window.innerWidth - pop.offsetWidth - 8;
    pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, room)))}px`;
    pop.style.top = `${Math.round(r.bottom + 4)}px`;
  };
  const onPointerDown = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (t && (pop.contains(t) || trigger.contains(t))) return;
    close();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      close();
      trigger.focus();
      e.preventDefault();
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
    if (pop.hidden) return;
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
  }
  trigger.addEventListener('click', () => {
    if (!pop.hidden) {
      close();
      return;
    }
    pop.hidden = false;
    place();
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    buttons.find((b) => !b.disabled)?.focus();
  });
  return { wrap, trigger, items: buttons };
}
