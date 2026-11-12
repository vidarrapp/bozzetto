import '../ui/icons';
import { SidePanel } from '../sculpt/ui/SidePanel';
import { checkbox, section } from '../ui/Panel';
import { div } from '../ui/dom';
import { heldMegabytes, type FrameItem } from './frameStore';

/**
 * The Frames tab of the Present workspace (present/): the sequence the
 * project plays, which the Create page and the owner's frame editor each
 * had a part of. Add frames (drop .obj or .glb files, or choose them),
 * see how many there are and what is held in memory, put them in order,
 * take one out, or clear the lot. Every change is the workspace's working
 * copy; saving it is the page's one Save.
 */

export interface FramesHooks {
  /** Files were given (dropped or chosen); resolves when they are converted and in the list. */
  addFiles(files: File[], zUp: boolean): Promise<void>;
  /** The frame at `from` goes to place `to`. */
  move(from: number, to: number): void;
  remove(at: number): void;
  /** Take every frame out of the list; the workspace asks first. */
  clear(): void;
  /** A row was pressed: go to that frame. */
  seek(at: number): void;
}

export class FramesPanel extends SidePanel {
  private readonly hooks: FramesHooks;
  private readonly drop = div('bz-drop');
  private readonly dropText = document.createElement('p');
  private readonly choose = button('Choose files');
  private readonly more = button('Add more');
  private readonly trash = document.createElement('button');
  private readonly input = document.createElement('input');
  private readonly zup: HTMLInputElement;
  private readonly count = document.createElement('span');
  private readonly memory = document.createElement('span');
  private readonly memoryRow = div('bz-rowline');
  private readonly progress = div('bz-progress');
  private readonly progressTrack = div('bz-progress__track');
  private readonly progressBar = div('bz-progress__bar');
  private readonly progressLabel = document.createElement('span');
  private readonly warn = document.createElement('p');
  private readonly note = document.createElement('p');
  private readonly orderSec: HTMLDivElement;
  private readonly list = document.createElement('ol');
  private items: readonly FrameItem[] = [];
  private busy = false;
  private at = -1;

  constructor(hooks: FramesHooks) {
    super({ id: 'frames', title: 'Frames', side: 'left', variant: 'panel--frames', collapsed: true });
    this.hooks = hooks;

    const seq = section(this.body, 'Sequence');
    this.drop.setAttribute('role', 'group');
    this.drop.setAttribute('aria-label', 'Add frames');
    this.dropText.textContent = 'Drop a sequence of .obj or .glb files here';
    this.input.type = 'file';
    this.input.accept = '.obj,.glb';
    this.input.multiple = true;
    this.input.hidden = true;
    this.input.setAttribute('aria-label', 'Frame files');
    this.input.addEventListener('change', () => {
      const files = this.input.files ? [...this.input.files] : [];
      this.input.value = '';
      if (files.length) void this.take(files);
    });
    this.choose.addEventListener('click', () => this.input.click());
    this.drop.append(this.dropText, this.choose, this.input);
    // The whole panel takes a drop, so frames can be added to a list that has some.
    this.root.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.root.classList.add('panel--dropping');
    });
    this.root.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !this.root.contains(e.relatedTarget as Node)) this.root.classList.remove('panel--dropping');
    });
    this.root.addEventListener('drop', (e) => {
      e.preventDefault();
      this.root.classList.remove('panel--dropping');
      if (e.dataTransfer?.files?.length) void this.take([...e.dataTransfer.files]);
    });

    this.zup = checkbox('OBJ files are Z-up', false, () => undefined).querySelector('input')!;
    const zupRow = this.zup.closest('label')!;
    zupRow.classList.add('bz-zup');

    this.count.className = 'bz-val';
    this.memory.className = 'bz-val';
    const countRow = rowLine('Frames', this.count);
    this.memoryRow.append(rowLabel('In memory'), this.memory);

    this.progress.hidden = true;
    this.progress.setAttribute('role', 'status');
    this.progressTrack.appendChild(this.progressBar);
    this.progressLabel.className = 'bz-note';
    this.progress.append(this.progressTrack, this.progressLabel);

    this.warn.className = 'bz-warn';
    this.warn.hidden = true;

    this.more.addEventListener('click', () => this.input.click());
    this.trash.type = 'button';
    this.trash.className = 'bz-trash';
    this.trash.title = 'Clear the frames';
    this.trash.setAttribute('aria-label', 'Clear the frames');
    this.trash.innerHTML = '<i class="fi fi-ss-trash" aria-hidden="true"></i>';
    this.trash.addEventListener('click', () => this.hooks.clear());
    const actions = div('bz-btns');
    actions.append(this.more, this.trash);

    this.note.className = 'bz-note';
    this.note.hidden = true;

    seq.append(this.note, this.drop, zupRow, countRow, this.memoryRow, this.progress, this.warn, actions);

    this.orderSec = section(this.body, 'Order');
    this.list.className = 'bz-frames';
    this.orderSec.appendChild(this.list);
    this.setItems([]);
  }

  /** A line above the drop box: what Create says about where the frames go. */
  setNote(text: string | null): void {
    this.note.hidden = !text;
    this.note.textContent = text ?? '';
  }

  /** Whether files are being converted just now (a second drop waits). */
  isBusy(): boolean {
    return this.busy;
  }

  private async take(files: File[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.input.disabled = true;
    try {
      await this.hooks.addFiles(files, this.zup.checked);
    } finally {
      this.busy = false;
      this.input.disabled = false;
    }
  }

  /** Conversion progress: `done` of `total`, or hidden with null. */
  showProgress(done: number | null, total = 0, text?: string): void {
    this.progress.hidden = done === null && !text;
    // The bar is for the work in hand; once it is done only the words stay.
    this.progressTrack.hidden = done === null || (total > 0 && done >= total && !!text);
    if (done !== null) this.progressBar.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    this.progressLabel.textContent = text ?? (done === null ? '' : `${done} / ${total}`);
  }

  /** The list changed: redraw the counts and the rows. */
  setItems(items: readonly FrameItem[]): void {
    this.items = items;
    const n = items.length;
    const empty = n === 0;
    this.count.textContent = String(n);
    const mb = heldMegabytes(items);
    this.memoryRow.hidden = mb === 0;
    this.memory.textContent = mb > 0 && mb < 0.1 ? '<0.1 MB' : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
    // The same line the Create page said, past the same size.
    this.warn.hidden = mb <= 300;
    this.warn.textContent = `Heads up: ~${mb.toFixed(0)} MB of frames are held in memory. Very large sequences may strain the browser tab.`;
    // Empty: the drop box is the whole of it. With frames: Add more and the trash take over.
    this.drop.hidden = !empty;
    this.more.hidden = empty;
    this.trash.hidden = empty;
    this.orderSec.hidden = empty;
    this.renderRows();
  }

  private renderRows(): void {
    const n = this.items.length;
    const rows = this.items.map((f, i) => {
      const li = document.createElement('li');
      li.className = 'bz-frame';
      li.dataset.key = String(f.key);
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'bz-frame__pick';
      pick.title = `Go to frame ${i + 1}`;
      const num = document.createElement('span');
      num.className = 'bz-frame__n';
      num.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'bz-frame__name';
      name.textContent = f.name;
      pick.append(num, name);
      pick.addEventListener('click', () => this.hooks.seek(i));
      li.append(
        pick,
        iconButton('fi-ss-angle-small-up', `Move frame ${i + 1} up`, i === 0, () => this.hooks.move(i, i - 1)),
        iconButton('fi-ss-angle-small-down', `Move frame ${i + 1} down`, i === n - 1, () => this.hooks.move(i, i + 1)),
        iconButton('fi-ss-cross-small', `Remove frame ${i + 1}`, false, () => this.hooks.remove(i), 'bz-frame__remove'),
      );
      return li;
    });
    this.list.replaceChildren(...rows);
    this.markFrame(this.at);
  }

  /** The playhead is at `frame`: its row is marked. */
  syncFrame(frame: number): void {
    if (frame === this.at) return;
    this.markFrame(frame);
  }

  private markFrame(frame: number): void {
    this.at = frame;
    const rows = this.list.children;
    for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('bz-frame--on', i === frame);
  }
}

function button(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  return b;
}

function iconButton(icon: string, label: string, disabled: boolean, action: () => void, extra = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `bz-frame__btn ${extra}`.trim();
  b.title = label;
  b.setAttribute('aria-label', label);
  b.disabled = disabled;
  b.innerHTML = `<i class="fi ${icon}" aria-hidden="true"></i>`;
  b.addEventListener('click', action);
  return b;
}

function rowLabel(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'bz-lab';
  s.textContent = text;
  return s;
}

function rowLine(label: string, value: HTMLElement): HTMLDivElement {
  const row = div('bz-rowline');
  row.append(rowLabel(label), value);
  return row;
}
