import { SidePanel } from '../sculpt/ui/SidePanel';
import { checkbox, compactRange, section } from '../ui/Panel';
import { div } from '../ui/dom';
import { rowMenu } from '../ui/rowMenu';
import { askWindow } from '../ui/askWindow';
import { mayStore } from '../ui/deviceStorage';
import type { ReferenceBoard, RefItem } from './board';
import { addPictures, pasteFromClipboard } from './intake';

/**
 * The Reference tab, on the right after Tool and before Render: the
 * board's pictures as a grid of thumbnails, newest first, with Add
 * picture… and Paste above them. A picture's row menu puts it beside the
 * view (a window) or over it, mirrors it, takes its colour out, or
 * deletes it. The Over the view section sets whether the picture sits in
 * front of the model or behind it, and how strongly.
 *
 * Delete asks first (the app's Undo is the sculpt's stroke history and
 * does not hold pictures), and says so in a window with a red button.
 */
export class ReferencePanel extends SidePanel {
  private readonly grid: HTMLDivElement;
  private readonly note: HTMLParagraphElement;
  private readonly empty: HTMLParagraphElement;
  private readonly over: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;
  private frontBox!: HTMLInputElement;
  private opacityRow!: HTMLLabelElement;
  private urls: string[] = [];
  private readonly offBoard: () => void;
  /** The library project this scene is, or null: the note under the grid says where pictures stay. */
  private linked: () => boolean = () => false;

  constructor(private readonly board: ReferenceBoard) {
    super({ id: 'reference', title: 'Reference', side: 'right', variant: 'panel--reference' });

    // The system picker. No `capture`: on an iPad it offers Photo Library, Take Photo and Choose File, and the person chooses.
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.multiple = true;
    this.fileInput.hidden = true;
    this.fileInput.className = 'ref-file';
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      if (files.length) void addPictures(this.board, files);
    });

    const actions = div('ref-actions');
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'outliner__btn ref-add';
    add.textContent = 'Add picture…';
    add.addEventListener('click', () => this.fileInput.click());
    const paste = document.createElement('button');
    paste.type = 'button';
    paste.className = 'outliner__btn ref-paste';
    paste.textContent = 'Paste';
    paste.addEventListener('click', () => void pasteFromClipboard(this.board));
    actions.append(add, paste, this.fileInput);
    this.body.appendChild(actions);

    this.status = div('ref-status');
    this.body.appendChild(this.status);

    this.empty = document.createElement('p');
    this.empty.className = 'sculpt-panel__hint ref-empty';
    this.empty.textContent = 'No pictures yet. Add one, paste one, or drop one here.';
    this.body.appendChild(this.empty);

    this.grid = div('ref-grid');
    this.body.appendChild(this.grid);

    this.over = div('ref-over-settings');
    this.buildOverSection();
    this.body.appendChild(this.over);

    this.note = document.createElement('p');
    this.note.className = 'sculpt-panel__hint ref-note';
    this.body.appendChild(this.note);

    this.offBoard = board.onChange(() => this.refresh());
    this.refresh();
  }

  /** Whether the scene is a library project: then the note says pictures stay on the device that added them. */
  setLinked(fn: () => boolean): void {
    this.linked = fn;
    this.refresh();
  }

  /** Is the picture picker or any of the panel's own windows the cause of a focus: for the paste key. */
  isOpen(): boolean {
    return !this.isCollapsed();
  }

  private buildOverSection(): void {
    const sec = section(this.over, 'Over the view');
    this.frontBox = (
      checkbox('In front of the model', this.board.getView().front, (on) => this.board.setOver({ front: on })) as HTMLLabelElement
    ).querySelector('input') as HTMLInputElement;
    sec.appendChild(this.frontBox.closest('label') as HTMLElement);
    this.opacityRow = compactRange(
      'Opacity',
      5,
      100,
      1,
      Math.round(this.board.getView().opacity * 100),
      (v) => this.board.setOver({ opacity: v / 100 }),
      { unit: ' %', limits: { min: 5, max: 100 } },
    );
    sec.appendChild(this.opacityRow);
  }

  private refresh(): void {
    const items = this.board.list();
    const view = this.board.getView();
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    this.grid.replaceChildren(...items.map((i) => this.card(i, view.id === i.id ? view.mode : null)));
    this.empty.hidden = items.length > 0;
    this.grid.hidden = items.length === 0;

    // What is on, and the way to take it off.
    const shown = this.board.shown();
    this.status.replaceChildren();
    this.status.hidden = !shown;
    if (shown) {
      const text = document.createElement('span');
      text.className = 'ref-status__text';
      text.textContent = `${view.mode === 'beside' ? 'Beside' : 'Over the view'}: ${shown.name}`;
      const hide = document.createElement('button');
      hide.type = 'button';
      hide.className = 'outliner__btn ref-hide';
      hide.textContent = 'Hide';
      hide.addEventListener('click', () => this.board.hide());
      this.status.append(text, hide);
    }

    // The over-the-view settings only mean something with a picture over the view.
    const overOn = !!shown && view.mode === 'over';
    this.over.hidden = items.length === 0;
    this.frontBox.checked = view.front;
    this.frontBox.disabled = !overOn;
    const slider = this.opacityRow.querySelector<HTMLInputElement>('input[type=range]');
    if (slider) {
      slider.disabled = !overOn || !view.front;
      if (document.activeElement !== slider && Number(slider.value) !== Math.round(view.opacity * 100)) {
        slider.value = String(Math.round(view.opacity * 100));
        slider.dispatchEvent(new Event('input', { bubbles: false }));
      }
    }

    this.note.textContent = this.linked()
      ? 'References stay on the device they were added on.'
      : mayStore()
        ? 'References stay on this device and are never uploaded.'
        : 'Saving on this device is off, so references last until the page closes.';
  }

  private card(item: RefItem, on: 'beside' | 'over' | null): HTMLElement {
    const card = div('ref-card');
    card.dataset.id = item.id;
    if (on) card.classList.add('ref-card--on');

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'ref-card__thumb';
    thumb.setAttribute('aria-label', `${on === 'beside' ? 'Hide' : 'Show beside'}: ${item.name}`);
    const url = URL.createObjectURL(item.blob);
    this.urls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    if (item.mirror) img.style.transform = 'scaleX(-1)';
    if (item.grey) img.style.filter = 'grayscale(1)';
    thumb.appendChild(img);
    thumb.addEventListener('click', () => (on === 'beside' ? this.board.hide() : this.board.show(item.id, 'beside')));
    card.appendChild(thumb);

    const name = document.createElement('div');
    name.className = 'ref-card__name';
    name.textContent = item.name;
    card.appendChild(name);

    const flags = [on === 'beside' ? 'Beside' : on === 'over' ? 'Over' : '', item.mirror ? 'Mirrored' : '', item.grey ? 'Grey' : ''].filter(Boolean);
    const meta = document.createElement('div');
    meta.className = 'ref-card__meta';
    meta.textContent = flags.join(' · ') || `${item.width} × ${item.height}`;
    card.appendChild(meta);

    const menu = rowMenu(
      'More',
      [
        { label: on === 'beside' ? 'Hide' : 'Show beside', className: 'ref-act-beside', action: () => (on === 'beside' ? this.board.hide() : this.board.show(item.id, 'beside')) },
        { label: on === 'over' ? 'Hide' : 'Show over the view', className: 'ref-act-over', action: () => (on === 'over' ? this.board.hide() : this.board.show(item.id, 'over')) },
        { label: 'Mirror', className: 'ref-act-mirror', action: () => this.board.setLook(item.id, { mirror: !item.mirror }) },
        { label: 'Greyscale', className: 'ref-act-grey', action: () => this.board.setLook(item.id, { grey: !item.grey }) },
        { label: 'Delete', className: 'ref-act-delete file-menu__item--danger', action: () => void this.confirmDelete(item) },
      ],
      'ref-card__more',
    );
    card.appendChild(menu.wrap);
    return card;
  }

  private async confirmDelete(item: RefItem): Promise<void> {
    const yes = await askWindow({
      title: 'Delete this picture?',
      text: `"${item.name}" is removed from this device. It cannot be undone.`,
      yes: 'Delete',
      danger: true,
    });
    if (yes) this.board.remove(item.id);
  }

  override dispose(): void {
    this.offBoard();
    for (const u of this.urls) URL.revokeObjectURL(u);
    super.dispose();
  }
}
