import { div } from './dom';
import { rowMenu, type RowMenuItem } from './rowMenu';
import { setSliderValue, sliderText, sliderValue, typedSlider } from './sliderEntry';

/**
 * A list of layers, newest on top, with a fixed base row at the bottom:
 * the part of the Layers panel (sculpt/ui/LayersPanel.ts) that knows
 * nothing about sculpting, so the Paint workspace can use it for paint
 * layers with the one more control each row has there (`extra`, a blend
 * mode select).
 *
 * A row: an eye, the name (a tap on the active row's name renames it), a
 * badge in mono for what the owner says of the layer (the levels it has
 * data on), a menu, and under them a slider with the weight in percent.
 * The slider's travel is 0 to 100%; a double tap or double click types any
 * value up to `limit` times that either way, negatives included. A tap on
 * a row makes it the active one; the base row is active when `activeId` is
 * null. The list keeps no state of its own: `render` draws what it is
 * given, and every change is reported through the hooks.
 */

export type LayerId = string | number;

export interface LayerRowData {
  id: LayerId;
  name: string;
  visible: boolean;
  /** A fraction: 1 is 100%. */
  weight: number;
  /** A short mono note beside the name; empty for none. */
  badge?: string;
  /** One more control under the slider (Paint's blend mode). */
  extra?: HTMLElement;
}

export interface LayerListHooks {
  /** A row was tapped: its id, or null for the base row. */
  select(id: LayerId | null): void;
  visible(id: LayerId, visible: boolean): void;
  rename(id: LayerId, name: string): void;
  /** The weight moved: `live` along a drag or a typed value, `commit` when it ends. */
  weight(id: LayerId, weight: number, phase: 'live' | 'commit'): void;
  /** What the row's menu offers. */
  menu(id: LayerId): RowMenuItem[];
}

export interface LayerListOptions {
  /** The base row's name. */
  baseName?: string;
  /** How far past 0 to 100% a typed weight may go, either way (a multiple of 100%). */
  limit?: number;
  /** The base row's note, for the person to read below the name. */
  baseHint?: string;
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
    // Only the weights moved: the sliders are set where they stand. A rebuilt row would take a
    // slider from under a double tap that is typing a value into it.
    const sig = JSON.stringify([activeId, this.renaming, rows.map((r) => [r.id, r.name, r.visible, r.badge ?? '', !!r.extra])]);
    if (sig === this.signature && this.el.childElementCount === rows.length + 1) {
      this.lastRows = rows;
      for (const r of rows) {
        const input = this.el.querySelector<HTMLInputElement>(`[data-layer="${String(r.id)}"] input[type=range]`);
        if (input && sliderValue(input) !== r.weight) {
          input.value = String(Math.max(0, Math.min(1, r.weight)));
          setSliderValue(input, r.weight);
        }
      }
      return;
    }
    this.signature = sig;
    this.lastRows = rows;
    this.lastActive = activeId;
    const out: HTMLElement[] = rows.map((r) => this.row(r, r.id === activeId));
    out.push(this.baseRow(activeId === null));
    this.el.replaceChildren(...out);
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
    const note = document.createElement('span');
    note.className = 'layer-row__badge';
    note.textContent = this.opts.baseHint ?? '';
    row.append(name, note);
    row.addEventListener('click', () => this.hooks.select(null));
    return row;
  }

  private row(r: LayerRowData, active: boolean): HTMLElement {
    const row = div(`layer-row${active ? ' layer-row--active' : ''}${r.visible ? '' : ' layer-row--hidden'}`);
    row.setAttribute('role', 'listitem');
    row.dataset.layer = String(r.id);
    const top = div('layer-row__top');

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

    if (r.badge) {
      const badge = document.createElement('span');
      badge.className = 'layer-row__badge';
      badge.textContent = r.badge;
      top.append(badge);
    }

    const menu = rowMenu('', this.hooks.menu(r.id), 'layer-row__more');
    menu.trigger.setAttribute('aria-label', `Actions for ${r.name}`);
    menu.trigger.title = 'Actions';
    menu.wrap.addEventListener('click', (e) => e.stopPropagation());
    top.append(menu.wrap);
    row.append(top);

    row.append(this.slider(r));
    if (r.extra) row.append(r.extra);
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.compact, .slider-field, button, input')) return;
      this.hooks.select(r.id);
    });
    return row;
  }

  private slider(r: LayerRowData): HTMLLabelElement {
    const limit = this.opts.limit ?? 10;
    const row = document.createElement('label');
    row.className = 'compact layer-row__weight';
    const cap = document.createElement('span');
    cap.textContent = 'Weight';
    const val = document.createElement('span');
    val.className = 'slider-val';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = String(Math.max(0, Math.min(1, r.weight)));
    input.dataset.scale = '100';
    input.dataset.unit = '%';
    input.setAttribute('aria-label', `Weight of ${r.name}`);
    row.append(cap, input, val);
    typedSlider(
      input,
      {
        apply: (v) => this.hooks.weight(r.id, v, 'live'),
        limits: { min: -limit, max: limit },
        readout: (v) => void (val.textContent = sliderText(input, v)),
      },
      r.weight,
    );
    // A past-the-travel value reads in the accent, as every slider's does.
    input.addEventListener('change', () => this.hooks.weight(r.id, sliderValue(input), 'commit'));
    return row;
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
