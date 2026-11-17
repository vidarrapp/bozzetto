import { SidePanel } from '../sculpt/ui/SidePanel';
import { div } from '../ui/dom';
import { rowMenu } from '../ui/rowMenu';
import { askWindow } from '../ui/askWindow';
import { mayStore } from '../ui/deviceStorage';
import type { ReferenceBoard, RefItem } from './board';
import { addPictures, pasteFromClipboard } from './intake';

/** The row menu's name for putting the camera back as a picture was locked. Short, and kept in one place. */
export const MATCH_VIEW_LABEL = 'Match view';
export const MATCH_VIEW_HINT = 'Lock the picture first';

/**
 * The Reference tab, on the right after Tool and before Render: the
 * board's pictures as a grid of thumbnails, newest first, with Add
 * picture… and Paste above them. A tile is dragged into the view (a
 * finger, the Pencil or the mouse) and the picture is placed where it is
 * let go; the row menu's Place in view does the same for a hand that
 * cannot drag. A tile whose picture is in the view has the grey fill. The
 * Arrange button at the top turns arranging (unlocked) on and off.
 *
 * Delete asks first (the app's Undo is the sculpt's stroke history and
 * does not hold pictures), and says so in a window with a red button.
 *
 * Dragging a tile must not fight the panel's own scrolling. A mouse or the
 * Pencil starts a drag on a move of a few pixels. A finger starts one
 * after a short hold (the panel scrolls on any move before that), or on a
 * clear sideways move (the panel only scrolls up and down).
 */
export class ReferencePanel extends SidePanel {
  private readonly grid: HTMLDivElement;
  private readonly note: HTMLParagraphElement;
  private readonly empty: HTMLParagraphElement;
  private readonly arrangeBtn: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  /** Puts a tile's picture in the view where a drag let go; false when that was not on the view. */
  private placer: ((id: string, x: number, y: number) => boolean) | null = null;
  private readonly offDocTouch: () => void;
  private dragging = false;
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

    // Arrange (unlocked) on and off: for the pictures that are in the view.
    this.arrangeBtn = document.createElement('button');
    this.arrangeBtn.type = 'button';
    this.arrangeBtn.className = 'outliner__btn ref-arrange';
    this.arrangeBtn.addEventListener('click', () => this.board.setArranging(!this.board.isArranging()));
    this.body.appendChild(this.arrangeBtn);

    this.empty = document.createElement('p');
    this.empty.className = 'sculpt-panel__hint ref-empty';
    this.empty.textContent = 'No pictures yet. Add one, paste one, or drop one here.';
    this.body.appendChild(this.empty);

    this.grid = div('ref-grid');
    this.body.appendChild(this.grid);

    this.note = document.createElement('p');
    this.note.className = 'sculpt-panel__hint ref-note';
    this.body.appendChild(this.note);

    // A finger held on a tile for a drag must not also scroll the panel: the touch that moves the picture is not let move the page.
    const stopScroll = (e: TouchEvent): void => {
      if (this.dragging && e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', stopScroll, { passive: false });
    this.offDocTouch = () => document.removeEventListener('touchmove', stopScroll);
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

  /** Where a dragged tile is let go: the view puts the picture there (reference/ReferenceView placeAt). */
  setPlacer(fn: (id: string, x: number, y: number) => boolean): void {
    this.placer = fn;
  }

  private refresh(): void {
    const items = this.board.list();
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    this.grid.replaceChildren(...items.map((i) => this.card(i)));
    this.empty.hidden = items.length > 0;
    this.grid.hidden = items.length === 0;

    const inView = this.board.inView().length;
    const arranging = this.board.isArranging();
    this.arrangeBtn.disabled = inView === 0;
    this.arrangeBtn.textContent = arranging ? 'Lock' : 'Arrange';
    this.arrangeBtn.setAttribute('aria-pressed', arranging ? 'true' : 'false');
    this.arrangeBtn.title = inView === 0 ? 'Drag a picture into the view first' : arranging ? 'Lock the pictures in place' : 'Move and resize the pictures in the view';

    this.note.textContent = this.linked()
      ? 'References stay on the device they were added on and are never uploaded.'
      : mayStore()
        ? 'References stay on this device and are never uploaded.'
        : 'Saving on this device is off, so references last until the page closes. They are never uploaded.';
  }

  private card(item: RefItem): HTMLElement {
    const on = item.inView;
    const card = div('ref-card');
    card.dataset.id = item.id;
    if (on) card.classList.add('ref-card--on');

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'ref-card__thumb';
    thumb.setAttribute('aria-label', `${item.name}${on ? ', in the view' : ''}. Drag it into the view.`);
    thumb.setAttribute('aria-pressed', on ? 'true' : 'false');
    const url = URL.createObjectURL(item.blob);
    this.urls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    if (item.mirror) img.style.transform = 'scaleX(-1)';
    if (item.grey) img.style.filter = 'grayscale(1)';
    thumb.appendChild(img);
    this.bindDrag(thumb, item.id, url);
    card.appendChild(thumb);

    const name = document.createElement('div');
    name.className = 'ref-card__name';
    name.textContent = item.name;
    card.appendChild(name);

    const flags = [on ? 'In view' : '', item.mirror ? 'Mirrored' : '', item.grey ? 'Grey' : ''].filter(Boolean);
    const meta = document.createElement('div');
    meta.className = 'ref-card__meta';
    meta.textContent = flags.join(' · ') || `${item.width} × ${item.height}`;
    card.appendChild(meta);

    const menu = rowMenu(
      'More',
      [
        on
          ? { label: 'Remove from view', className: 'ref-act-remove', action: () => this.board.takeOut(item.id) }
          : { label: 'Place in view', className: 'ref-act-place', action: () => this.board.putInView(item.id) },
        { label: MATCH_VIEW_LABEL, className: 'ref-act-match', action: () => void this.board.matchView(item.id) },
        { label: 'Mirror', className: 'ref-act-mirror', action: () => this.board.setLook(item.id, { mirror: !item.mirror }) },
        { label: 'Greyscale', className: 'ref-act-grey', action: () => this.board.setLook(item.id, { grey: !item.grey }) },
        { label: 'Delete', className: 'ref-act-delete file-menu__item--danger', action: () => void this.confirmDelete(item) },
      ],
      'ref-card__more',
    );
    // Match view needs the camera kept when the picture was locked.
    const match = menu.items[1];
    if (!item.camera) {
      match.disabled = true;
      match.innerHTML = '';
      const label = document.createElement('span');
      label.className = 'file-menu__label';
      label.textContent = MATCH_VIEW_LABEL;
      const hint = document.createElement('span');
      hint.className = 'file-menu__hint';
      hint.textContent = MATCH_VIEW_HINT;
      match.append(label, hint);
    }
    card.appendChild(menu.wrap);
    return card;
  }

  /**
   * Drag a tile into the view. A mouse or the Pencil: a move of 6px starts it.
   * A finger: a hold of 350ms without moving, or a clear sideways move
   * (14px, mostly across); before either, the panel scrolls as it always does.
   */
  private bindDrag(thumb: HTMLElement, id: string, url: string): void {
    let down: { pid: number; x: number; y: number; type: string; timer: number } | null = null;
    let ghost: HTMLImageElement | null = null;
    const start = (x: number, y: number): void => {
      if (!down || ghost) return;
      window.clearTimeout(down.timer);
      this.dragging = true;
      ghost = document.createElement('img');
      ghost.className = 'ref-ghost';
      ghost.src = url;
      ghost.alt = '';
      document.body.classList.add('ref-dragging');
      document.body.appendChild(ghost);
      try {
        thumb.setPointerCapture(down.pid);
      } catch {
        // A synthetic pointer has nothing to capture.
      }
      follow(x, y);
    };
    const follow = (x: number, y: number): void => {
      if (ghost) {
        ghost.style.left = `${x}px`;
        ghost.style.top = `${y}px`;
      }
    };
    const end = (x: number, y: number, drop: boolean): void => {
      if (!down) return;
      window.clearTimeout(down.timer);
      const was = !!ghost;
      ghost?.remove();
      ghost = null;
      document.body.classList.remove('ref-dragging');
      this.dragging = false;
      const pid = down.pid;
      down = null;
      if (thumb.hasPointerCapture(pid)) thumb.releasePointerCapture(pid);
      if (was && drop) this.placer?.(id, x, y);
    };
    thumb.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const timer = window.setTimeout(() => {
        if (down && down.type === 'touch') start(down.x, down.y);
      }, 350);
      down = { pid: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, timer };
      // Moves keep coming to the tile when the pointer leaves it fast (a mouse or the Pencil; a finger has this already).
      try {
        thumb.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic pointer has nothing to capture.
      }
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.pid) return;
      if (ghost) {
        e.preventDefault();
        follow(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (down.type === 'touch') {
        if (Math.abs(dx) >= 14 && Math.abs(dx) > 1.5 * Math.abs(dy)) start(e.clientX, e.clientY);
        else if (Math.hypot(dx, dy) > 8) window.clearTimeout(down.timer); // a scroll: no hold-drag
      } else if (Math.hypot(dx, dy) >= 6) {
        start(e.clientX, e.clientY);
      }
    });
    thumb.addEventListener('pointerup', (e) => end(e.clientX, e.clientY, true));
    thumb.addEventListener('pointercancel', (e) => {
      // A touch the browser took for a scroll is no drag.
      end(e.clientX, e.clientY, false);
    });
    thumb.addEventListener('contextmenu', (e) => e.preventDefault());
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
    this.offDocTouch();
    for (const u of this.urls) URL.revokeObjectURL(u);
    super.dispose();
  }
}
