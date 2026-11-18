import { div } from './dom';
import { rowMenu, type RowMenuItem } from './rowMenu';
import { setSliderValue, sliderText, sliderValue, typedSlider } from './sliderEntry';
import { colorPicker, type ColorPickerHandle } from './ColorPicker';
import { nameOnLongPress, setTip } from '../sculpt/ui/edgeTip';

/**
 * A list of layers, as Photoshop's Layers panel has it: newest on top, a
 * fixed base row at the bottom, ONE row a layer, and above the list one
 * set of controls (`LayerControls`) that act on the active layer.
 *
 * A row, about 32px: the reorder grip (only where the panel gives a
 * `reorder` hook), the eye, the name (a tap on the active row's name renames
 * it), a quiet value in mono where it is not the default (`value`), and the
 * row menu. No slider or select inside a row. A tap on a row makes it the
 * active one; the base row (no eye, no menu) is active when `activeId` is
 * null. The list keeps no state of its own: `render` draws what it is given,
 * and every change is reported through the hooks.
 */

export type LayerId = string | number;

export interface LayerRowData {
  id: LayerId;
  name: string;
  visible: boolean;
  /** The layer's value when it is not the default ("Multiply 60%", "55%"); empty for none. */
  value?: string;
  /** In a group: indented one level. */
  depth?: 0 | 1;
  /** A group has a fold arrow; a fill layer has a colour swatch. */
  kind?: 'layer' | 'fill' | 'group';
  /** A group's fold: true when its layers show. */
  open?: boolean;
  /** The row has a mask, and whether it is on. */
  mask?: 'on' | 'off' | null;
  /** A fill layer's colour as `#rrggbb`. */
  swatch?: string;
}

/** Where a dragged row was dropped: on a row, above it, below it, or into it (a group). */
export type DropPlace = 'above' | 'below' | 'into';

export interface LayerListHooks {
  /** A row was tapped: its id, or null for the base row. */
  select(id: LayerId | null): void;
  visible(id: LayerId, visible: boolean): void;
  rename(id: LayerId, name: string): void;
  /** What the row's menu offers. */
  menu(id: LayerId): RowMenuItem[];
  /**
   * A row was dragged and dropped: its id, the row it was dropped on and where on it. Only where this
   * hook is given do the rows have a handle to drag by.
   */
  drop?(id: LayerId, onto: LayerId, place: DropPlace): void;
  /** A group's fold arrow was pressed. */
  toggleOpen?(id: LayerId): void;
  /** A fill layer's colour is being picked (`live`), or the picker closed (`commit`): `#rrggbb`. */
  swatch?(id: LayerId, hex: string, phase: 'live' | 'commit'): void;
  /** The base row's menu (Flatten all, and in Paint Clear); none leaves the base row bare. */
  baseMenu?(): RowMenuItem[];
}

export interface LayerListOptions {
  /** The base row's name. */
  baseName?: string;
}

/**
 * The controls above the list: an optional control of the panel's own (Paint's
 * blend mode select, `before`) and the slider (Opacity, Weight), both for the
 * ACTIVE layer. They show its values and are disabled with Base active. The
 * slider's travel is 0 to 100%; a double tap or double click types any value
 * between `floor` and `limit` times that.
 */
export interface LayerControlsOptions {
  caption: string;
  limit: number;
  floor: number;
  /** The select, drawn left of the slider where the panel is wide enough. */
  before?: HTMLSelectElement;
  /** The slider moved: `live` along a drag or a typed value, `commit` when it ends. */
  change(value: number, phase: 'live' | 'commit'): void;
}

export class LayerControls {
  readonly el: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly val: HTMLSpanElement;
  private readonly row: HTMLLabelElement;

  constructor(private readonly opts: LayerControlsOptions) {
    this.el = div('layer-controls');
    if (opts.before) {
      opts.before.classList.add('layer-controls__select');
      this.el.append(opts.before);
    }
    this.row = document.createElement('label');
    this.row.className = 'compact layer-controls__slider';
    const cap = document.createElement('span');
    cap.textContent = opts.caption;
    this.val = document.createElement('span');
    this.val.className = 'slider-val';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = '1';
    input.dataset.scale = '100';
    input.dataset.unit = '%';
    input.setAttribute('aria-label', `${opts.caption} of the active layer`);
    this.input = input;
    this.row.append(cap, input, this.val);
    typedSlider(
      input,
      {
        apply: (v) => opts.change(v, 'live'),
        limits: { min: opts.floor, max: opts.limit },
        readout: (v) => void (this.val.textContent = sliderText(input, v)),
      },
      1,
    );
    input.addEventListener('change', () => opts.change(sliderValue(input), 'commit'));
    this.el.append(this.row);
    this.set(null, null);
  }

  /** Show the active layer's value (null with Base active: the controls are off). `select` is the panel's select value. */
  set(value: number | null, select: string | null): void {
    const on = value !== null;
    this.input.disabled = !on;
    this.row.classList.toggle('layer-controls__slider--off', !on);
    if (this.opts.before) {
      this.opts.before.disabled = !on;
      if (select !== null) this.opts.before.value = select;
    }
    // Not under a hand that is dragging or typing.
    if (on && sliderValue(this.input) !== value) {
      this.input.value = String(Math.max(0, Math.min(1, value)));
      setSliderValue(this.input, value);
    }
    if (!on) {
      this.val.textContent = '';
      this.input.value = '0';
    }
  }
}

const iconEl = (name: string): HTMLElement => {
  const i = document.createElement('i');
  i.className = `fi ${name}`;
  i.setAttribute('aria-hidden', 'true');
  return i;
};

export class LayerList {
  readonly el: HTMLDivElement;
  private renaming: LayerId | null = null;
  private lastRows: LayerRowData[] = [];
  private lastActive: LayerId | null = null;
  private signature = '';
  private readonly pickers = new Map<LayerId, ColorPickerHandle>();

  constructor(
    private readonly hooks: LayerListHooks,
    private readonly opts: LayerListOptions = {},
  ) {
    this.el = div('layer-list');
    this.el.setAttribute('role', 'list');
  }

  /** Whether a name is being typed: a redraw would take the field away. */
  isEditing(): boolean {
    return this.renaming !== null;
  }

  render(rows: LayerRowData[], activeId: LayerId | null): void {
    // The colour of a fill layer is not in the signature: a row redrawn under a picker would take it away.
    const sig = JSON.stringify([activeId, this.renaming, rows.map((r) => [r.id, r.name, r.visible, r.value ?? '', r.depth ?? 0, r.kind ?? 'layer', r.open ?? null, r.mask ?? null])]);
    if (sig === this.signature && this.el.childElementCount === rows.length + 1) {
      this.lastRows = rows;
      this.syncSwatches(rows);
      return;
    }
    this.signature = sig;
    this.lastRows = rows;
    this.lastActive = activeId;
    const keep = new Set(rows.filter((r) => r.kind === 'fill').map((r) => r.id));
    for (const [id, h] of this.pickers) {
      if (!keep.has(id) || !h.isOpen()) {
        h.dispose();
        this.pickers.delete(id);
      }
    }
    const out: HTMLElement[] = rows.map((r) => this.row(r, r.id === activeId));
    out.push(this.baseRow(activeId === null));
    this.el.replaceChildren(...out);
  }

  private syncSwatches(rows: LayerRowData[]): void {
    for (const r of rows) {
      const h = this.pickers.get(r.id);
      if (h && r.swatch && !h.isOpen() && h.value() !== r.swatch) h.set(r.swatch);
    }
  }

  /** Put the name of a row in a field (the row's menu: Rename). */
  startRename(id: LayerId): void {
    this.renaming = id;
    this.redraw();
  }

  private redraw(): void {
    this.render(this.lastRows, this.lastActive);
  }

  private baseRow(active: boolean): HTMLElement {
    const row = div(`layer-row layer-row--base${active ? ' layer-row--active' : ''}`);
    row.setAttribute('role', 'listitem');
    row.dataset.layer = 'base';
    const name = document.createElement('span');
    name.className = 'layer-row__name';
    name.textContent = this.opts.baseName ?? 'Base';
    row.append(name);
    const items = this.hooks.baseMenu?.() ?? [];
    if (items.length) {
      const menu = rowMenu('', items, 'layer-row__more');
      menu.trigger.setAttribute('aria-label', 'Actions for Base');
      menu.trigger.title = 'Actions';
      menu.wrap.addEventListener('click', (e) => e.stopPropagation());
      row.append(menu.wrap);
    }
    row.addEventListener('click', () => this.hooks.select(null));
    return row;
  }

  private row(r: LayerRowData, active: boolean): HTMLElement {
    const row = div(`layer-row${active ? ' layer-row--active' : ''}${r.visible ? '' : ' layer-row--hidden'}`);
    row.setAttribute('role', 'listitem');
    row.dataset.layer = String(r.id);
    const top = div('layer-row__top');
    if (r.depth === 1) row.classList.add('layer-row--nested');
    if (r.kind === 'group') row.classList.add('layer-row--group');
    if (this.hooks.drop) {
      row.classList.add('layer-row--grip');
      top.append(this.grip(r, row));
    }
    if (r.kind === 'group') {
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'layer-row__fold';
      fold.setAttribute('aria-label', r.open ? 'Fold the group' : 'Open the group');
      fold.setAttribute('aria-expanded', String(!!r.open));
      fold.append(iconEl(r.open ? 'fi-ss-angle-small-down' : 'fi-ss-angle-small-right'));
      fold.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hooks.toggleOpen?.(r.id);
      });
      top.append(fold);
    }

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'layer-row__eye';
    const eyeTitle = r.visible ? 'Hide layer' : 'Show layer';
    eye.title = eyeTitle;
    eye.setAttribute('aria-label', eyeTitle);
    eye.setAttribute('aria-pressed', String(r.visible));
    eye.append(iconEl(r.visible ? 'fi-ss-eye' : 'fi-ss-eye-crossed'));
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hooks.visible(r.id, !r.visible);
    });
    top.append(eye);

    if (r.kind === 'fill' && r.swatch) {
      let h = this.pickers.get(r.id);
      if (!h) {
        h = colorPicker(r.swatch, (hex) => this.hooks.swatch?.(r.id, hex, 'live'), { onClose: () => this.hooks.swatch?.(r.id, this.pickers.get(r.id)?.value() ?? '#000000', 'commit') });
        this.pickers.set(r.id, h);
      }
      h.root.classList.add('layer-row__swatch');
      h.root.addEventListener('click', (e) => e.stopPropagation());
      top.append(h.root);
    }
    if (this.renaming === r.id) {
      top.append(this.renameField(r));
    } else {
      const name = document.createElement('span');
      name.className = 'layer-row__name';
      name.textContent = r.name;
      name.title = active ? 'Rename' : r.name;
      // A tap on the name of the layer you are on renames it; on another it only picks it.
      name.addEventListener('click', (e) => {
        if (!active) return;
        e.stopPropagation();
        this.renaming = r.id;
        this.redraw();
      });
      top.append(name);
    }

    if (r.mask) {
      const mark = document.createElement('span');
      mark.className = `layer-row__mask${r.mask === 'off' ? ' layer-row__mask--off' : ''}`;
      mark.title = r.mask === 'off' ? 'Mask off' : 'Has a mask';
      mark.append(iconEl('fi-ss-circle-half-stroke'));
      top.append(mark);
    }
    if (r.value) {
      const value = document.createElement('span');
      value.className = 'layer-row__badge';
      value.textContent = r.value;
      top.append(value);
    }

    const menu = rowMenu('', this.hooks.menu(r.id), 'layer-row__more');
    menu.trigger.setAttribute('aria-label', `Actions for ${r.name}`);
    menu.trigger.title = 'Actions';
    menu.wrap.addEventListener('click', (e) => e.stopPropagation());
    top.append(menu.wrap);
    row.append(top);

    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, input, select')) return;
      this.hooks.select(r.id);
    });
    return row;
  }

  /**
   * The handle a row is dragged by: a press on it follows the pointer over
   * the rows, shows where the row would land, and the lift puts it there.
   * The handle alone takes the press (touch-action none), so a finger on the
   * rest of the row still scrolls the panel.
   */
  private grip(r: LayerRowData, rowEl: HTMLElement): HTMLButtonElement {
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'layer-row__grip';
    grip.title = 'Drag to reorder';
    grip.setAttribute('aria-label', `Move ${r.name}`);
    grip.append(iconEl('fi-ss-grip-lines'));
    grip.addEventListener('click', (e) => e.stopPropagation());
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rows = [...this.el.querySelectorAll<HTMLElement>('.layer-row:not(.layer-row--base)')];
      if (rows.indexOf(rowEl) < 0) return;
      const rects = rows.map((x) => x.getBoundingClientRect());
      let hit: { at: number; place: DropPlace } | null = null;
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events carry no active pointer; capture is best-effort.
      }
      rowEl.classList.add('layer-row--dragging');
      const clear = (): void => rows.forEach((x) => x.classList.remove('layer-row--drop-above', 'layer-row--drop-below', 'layer-row--drop-into'));
      const move = (ev: PointerEvent): void => {
        let at = rects.findIndex((b) => ev.clientY < b.bottom);
        if (at < 0) at = rows.length - 1;
        const b = rects[at];
        const f = (ev.clientY - b.top) / Math.max(1, b.height);
        const target = rows[at];
        const isGroup = target.classList.contains('layer-row--group') && r.kind !== 'group' && target !== rowEl;
        const place: DropPlace = isGroup && f > 0.25 && f < 0.75 ? 'into' : f < 0.5 ? 'above' : 'below';
        hit = target === rowEl ? null : { at, place };
        clear();
        if (hit) rows[hit.at].classList.add(`layer-row--drop-${hit.place}`);
      };
      const end = (ev: PointerEvent, keep: boolean): void => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', cancel);
        try {
          grip.releasePointerCapture(ev.pointerId);
        } catch {
          // Already let go.
        }
        rowEl.classList.remove('layer-row--dragging');
        clear();
        const h = hit as { at: number; place: DropPlace } | null;
        if (keep && h) {
          const onto = rows[h.at].dataset.layer;
          if (onto !== undefined) this.hooks.drop?.(r.id, this.idOf(onto), h.place);
        }
      };
      const up = (ev: PointerEvent): void => end(ev, true);
      const cancel = (ev: PointerEvent): void => end(ev, false);
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', cancel);
    });
    return grip;
  }

  /** A row's id as the model has it (rows keep it as text). */
  private idOf(text: string): LayerId {
    return this.lastRows.find((x) => String(x.id) === text)?.id ?? text;
  }

  private renameField(r: LayerRowData): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-row__rename';
    input.value = r.name;
    input.maxLength = 60;
    input.setAttribute('aria-label', 'Layer name');
    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      this.renaming = null;
      const text = input.value.trim();
      if (keep && text && text !== r.name) this.hooks.rename(r.id, text);
      else this.redraw();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    return input;
  }
}


/** One button of the foot bar. */
export interface BarItem {
  id: string;
  /** Its name, said on hover and on a long press. */
  label: string;
  /** A Uicons solid straight class. */
  icon: string;
  action(): void;
}

/**
 * The bar at the foot of a Layers panel, as Photoshop's: bare icons at the right, in a
 * row, each named on hover and on a long press, none of them a text button. `set` greys
 * what does not apply.
 */
export class LayerBar {
  readonly el: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(items: BarItem[]) {
    this.el = div('layer-bar');
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Layer actions');
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'layer-bar__btn';
      b.dataset.action = it.id;
      b.setAttribute('aria-label', it.label);
      b.append(iconEl(it.icon));
      setTip(b, it.label);
      nameOnLongPress(b);
      b.addEventListener('click', () => it.action());
      this.buttons.set(it.id, b);
      this.el.append(b);
    }
  }

  /** Which buttons apply now (the ones missing from `on` are greyed out). */
  set(on: Record<string, boolean>): void {
    for (const [id, b] of this.buttons) b.disabled = !on[id];
  }
}
