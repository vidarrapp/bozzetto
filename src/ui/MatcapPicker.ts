import { div } from './dom';

/**
 * Matcap picker: a round trigger swatch showing the ACTIVE matcap that
 * opens a body-mounted popover holding the thumbnail gallery (owner call:
 * a popout, not panel rows - fourteen thumbs ate half the Material
 * section). Same popover contract as the colour picker, for the same
 * reasons: the panel body would clip and stack-trap it, it stays open
 * for rapid A/B-ing until a press lands outside, Escape closes, and the
 * host closes it when its panel collapses.
 */
export interface MatcapPickerHandle {
  readonly root: HTMLElement;
  /** Re-sync the trigger thumb + selection ring (hotkeys, look restores). */
  refresh(): void;
  isOpen(): boolean;
  close(): void;
  dispose(): void;
}

export interface MatcapEntry {
  id: string;
  label: string;
}

export function matcapPicker(
  matcaps: () => MatcapEntry[],
  current: () => number,
  onPick: (index: number) => void,
): MatcapPickerHandle {
  const thumbUrl = (id: string): string => `/assets/matcaps/thumbs/${id}.png`;

  const root = div('mcpick');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'mcpick__trigger';
  trigger.setAttribute('aria-label', 'Choose a matcap');
  const triggerImg = document.createElement('img');
  triggerImg.alt = '';
  triggerImg.draggable = false;
  trigger.appendChild(triggerImg);
  root.appendChild(trigger);

  const pop = div('mcpick__pop');
  pop.hidden = true;
  document.body.appendChild(pop);
  const grid = div('matcap-grid matcap-grid--pop');
  pop.appendChild(grid);

  const place = (): void => {
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const leftSide = r.left - w - 8;
    const left = leftSide >= 8 ? leftSide : Math.min(window.innerWidth - w - 8, r.right + 8);
    const top = Math.min(window.innerHeight - h - 8, Math.max(8, r.top - 4));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  };

  const rebuild = (): void => {
    const list = matcaps();
    const sel = current();
    triggerImg.src = thumbUrl(list[sel]?.id ?? list[0]?.id ?? '');
    trigger.title = list[sel]?.label ?? '';
    grid.replaceChildren();
    list.forEach((mc, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'matcap-swatch';
      if (i === sel) btn.classList.add('matcap-swatch--on');
      btn.title = mc.label;
      btn.setAttribute('aria-label', `Matcap ${mc.label}`);
      const img = document.createElement('img');
      img.src = thumbUrl(mc.id);
      img.alt = '';
      img.draggable = false;
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        onPick(i);
        rebuild(); // ring + trigger follow; the popover stays for A/B-ing
      });
      grid.appendChild(btn);
    });
  };

  const close = (): void => {
    pop.hidden = true;
  };
  const onDocDown = (e: PointerEvent): void => {
    if (pop.hidden) return;
    // The trigger's row can be rebuilt (or its panel closed) under an open
    // popover; a floating gallery with no anchor left is stale.
    if (!trigger.isConnected) return close();
    const t = e.target as Node;
    if (!pop.contains(t) && !root.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !pop.hidden) {
      close();
      e.stopPropagation();
    }
  };
  trigger.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) {
      rebuild();
      place(); // measured after unhiding, so the size is real
    }
  });
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);

  rebuild();

  return {
    root,
    refresh: rebuild,
    isOpen(): boolean {
      return !pop.hidden;
    },
    close,
    dispose(): void {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      pop.remove(); // body-mounted: removing the root no longer takes it
      root.remove();
    },
  };
}
