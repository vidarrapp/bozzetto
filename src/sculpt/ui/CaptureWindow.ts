import { div, onTap } from '../../ui/dom';
import { checkbox, section } from '../../ui/Panel';
import { topbarLeft, topChip } from '../../ui/topbar';
import type { SnapshotRecorder } from '../bridge/SnapshotRecorder';

/** Where the window was left, for the rest of the browser session. */
const POSITION_KEY = 'bozzetto-capture-window';
/** The gap kept between the window and the screen's edges. */
const EDGE = 8;
/**
 * The highest the window goes: clear of the top row, whose chips sit over
 * it and would otherwise cover its title bar and its close button.
 */
const TOP = 44;

interface Position {
  x: number;
  y: number;
}

/**
 * The Capture window (owner call): the timelapse recorder's toggle,
 * readout and clear, and the publish forms, in a window that floats over
 * the work rather than a panel docked at an edge. Its chip sits in the top
 * row beside File and Edit, and opens and closes it.
 *
 * Non-modal by design. Nothing is dimmed or blocked: the pen keeps
 * sculpting around it, a press elsewhere leaves it open, and only its own
 * close button, its chip and Esc (while it has the focus) put it away. The
 * title bar drags it; where it was left is kept for the session and held
 * on screen as the browser window changes size. It hides with the rest of
 * the interface on Tab, and comes back where it was.
 *
 * The chip shows only where recording can go somewhere (setAvailable):
 * a guest on the web has nothing here to use.
 */
export class CaptureWindow {
  readonly chip: HTMLButtonElement;
  readonly root: HTMLDivElement;
  /** mode.ts appends the admin-only "publish timelapse" form here. */
  readonly captureSlot = div('sculpt-panel__slot');
  /** mode.ts appends the admin-only "publish model" form here. */
  readonly publishSlot = div('sculpt-panel__slot');
  private readonly bar: HTMLDivElement;
  private readonly recordCheckbox: HTMLInputElement;
  private readonly captureReadout: HTMLDivElement;
  private readonly autosaveNote: HTMLDivElement;
  private captureStopReason = '';
  private opened = false;
  private available = false;
  /** Where the window was put; shown clamped to the screen, kept as put. */
  private pos: Position | null = readPosition();
  private drag: { id: number; dx: number; dy: number } | null = null;

  constructor(private readonly recorder: SnapshotRecorder) {
    this.chip = topChip('Capture') as HTMLButtonElement;
    this.chip.classList.add('file-menu__chip', 'capture-window__chip');
    this.chip.setAttribute('aria-expanded', 'false');
    this.chip.hidden = true;
    // A tap, not a click, like the panels' edge tabs: no long press on a
    // slow tap, and no focus left on the chip for Tab to land on.
    onTap(this.chip, () => this.toggle());
    topbarLeft().appendChild(this.chip);

    this.root = div('float-window capture-window');
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'false');
    this.root.setAttribute('aria-label', 'Capture');
    this.root.id = 'capture-window';
    this.chip.setAttribute('aria-controls', this.root.id);

    this.bar = div('float-window__bar');
    const title = document.createElement('span');
    title.className = 'float-window__title';
    title.textContent = 'Capture';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'float-window__close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close the capture window');
    onTap(close, () => this.close());
    this.bar.append(title, close);
    this.root.appendChild(this.bar);

    const body = div('float-window__body');
    this.root.appendChild(body);

    // Empty until it has something to say (autosave stopping itself). Up
    // top, where the storage the captured frames spend is accounted for.
    this.autosaveNote = div('sculpt-panel__hint sculpt-panel__warn');
    this.autosaveNote.hidden = true;
    body.appendChild(this.autosaveNote);

    const sec = section(body, 'Timelapse');
    const rec = checkbox('Record timelapse', this.recorder.isEnabled(), (on) => {
      this.recorder.setEnabled(on);
      this.paintCapture();
    });
    this.recordCheckbox = rec.querySelector('input') as HTMLInputElement;
    sec.appendChild(rec);

    this.captureReadout = div('sculpt-panel__hint capture__readout');
    sec.appendChild(this.captureReadout);

    const col = div('outliner__files');
    col.appendChild(
      actionButton('Clear frames', async () => {
        if (this.recorder.frameCount() === 0) return;
        if (!confirm('Delete all captured timelapse frames?')) return;
        await this.recorder.clear();
      }),
    );
    this.captureSlot.dataset.slot = 'timelapse';
    col.appendChild(this.captureSlot);
    sec.appendChild(col);

    // The single-frame publish, beside the reel's: both need the sign-in.
    const publish = section(body, 'Publish');
    this.publishSlot.dataset.slot = 'model';
    const publishCol = div('outliner__files');
    publishCol.appendChild(this.publishSlot);
    publish.appendChild(publishCol);

    document.body.appendChild(this.root);

    this.recorder.onChange = () => this.paintCapture();
    this.recorder.onStopped = (reason) => {
      this.captureStopReason =
        reason === 'budget' ? 'stopped: frame budget reached' : 'stopped: storage unavailable';
      this.paintCapture();
    };
    this.paintCapture();

    // The title bar is held and dragged: on iOS a finger held still on it
    // arms the long press (a callout, a lift for drag and drop) and then
    // cancels the touch mid-drag, so its touches give the browser nothing
    // to start from. The close button in it acts on a tap (onTap) for the
    // same reason, since this also stops the click a touch would make.
    this.bar.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.bar.addEventListener('pointerdown', this.onBarDown);
    this.bar.addEventListener('pointermove', this.onBarMove);
    this.bar.addEventListener('pointerup', this.onBarUp);
    this.bar.addEventListener('pointercancel', this.onBarUp);
    this.root.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
  }

  isOpen(): boolean {
    return this.opened;
  }

  /** Whether the chip is offered at all (recording can go somewhere here). */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Recording became possible here, or stopped being: the chip shows or
   * goes, and an open window goes with it.
   */
  setAvailable(available: boolean): void {
    this.available = available;
    this.chip.hidden = !available;
    if (!available) this.close();
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  open(): void {
    if (this.opened || !this.available) return;
    // From the keyboard the chip holds the focus, and the window takes it
    // over, so Esc closes it again; a tap leaves the focus where it was,
    // which keeps Tab hiding the interface.
    const fromKeys = document.activeElement === this.chip;
    this.opened = true;
    this.root.hidden = false;
    this.place();
    this.chip.setAttribute('aria-expanded', 'true');
    this.chip.classList.add('topchip--open');
    if (fromKeys) this.root.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.opened) return;
    this.endDrag();
    // The focus leaves with the window, to nowhere in particular: Tab is
    // the interface's own key while nothing has the focus.
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.opened = false;
    this.root.hidden = true;
    this.chip.setAttribute('aria-expanded', 'false');
    this.chip.classList.remove('topchip--open');
  }

  /**
   * Autosave stopped itself. The way out of a full store is a saved file
   * (File menu) or fewer captured frames, and the frames are right here.
   */
  showAutosaveStopped(reason: 'quota' | 'error'): void {
    this.autosaveNote.textContent =
      reason === 'quota'
        ? 'Autosave stopped: this device is out of storage. Save a file (File menu), and clear captured frames to free space.'
        : 'Autosave stopped: this browser refused to store the scene. Save a file (File menu) to keep this work.';
    this.autosaveNote.hidden = false;
  }

  dispose(): void {
    this.close();
    this.recorder.onChange = null;
    this.recorder.onStopped = null;
    window.removeEventListener('resize', this.onResize);
    this.chip.remove();
    this.root.remove();
  }

  private paintCapture(): void {
    this.recordCheckbox.checked = this.recorder.isEnabled();
    const n = this.recorder.frameCount();
    const mb = this.recorder.bytes() / (1024 * 1024);
    const size = mb >= 100 ? Math.round(mb).toString() : mb.toFixed(1);
    const parts = [`${n} frame${n === 1 ? '' : 's'} - ${size} MB`];
    if (this.captureStopReason && !this.recorder.isEnabled()) parts.push(this.captureStopReason);
    this.captureReadout.textContent = parts.join(' - ');
  }

  /**
   * Put the window where it was left - or, the first time, under its chip
   * - pulled back on screen if the screen has shrunk since. The position
   * kept is the one asked for, so a window squeezed in by a narrow screen
   * goes back to its place when there is room again.
   */
  private place(): void {
    const at = this.pos ?? this.underChip();
    const { x, y } = this.clamp(at);
    this.root.style.left = `${Math.round(x)}px`;
    this.root.style.top = `${Math.round(y)}px`;
  }

  /**
   * Under the chip, the first time, but clear of the left edge's panels:
   * an open Model panel reaches past the chip, and the window would sit
   * across it. Their layout boxes, which ignore the slide, say where a
   * docked panel opens rather than where it is tucked away.
   */
  private underChip(): Position {
    const r = this.chip.getBoundingClientRect();
    let clear = 0;
    for (const p of document.querySelectorAll<HTMLElement>('.panel--left')) {
      clear = Math.max(clear, p.offsetLeft + p.offsetWidth + EDGE);
    }
    return { x: Math.max(r.left, clear), y: r.bottom + 6 };
  }

  private clamp(p: Position): Position {
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const maxX = Math.max(EDGE, window.innerWidth - w - EDGE);
    const maxY = Math.max(TOP, window.innerHeight - h - EDGE);
    return { x: Math.min(maxX, Math.max(EDGE, p.x)), y: Math.min(maxY, Math.max(TOP, p.y)) };
  }

  private readonly onBarDown = (e: PointerEvent): void => {
    if (e.button !== 0 || (e.target as Element).closest('.float-window__close')) return;
    // No text selection and no focus change from the press itself; the
    // window takes the focus instead, so Esc closes it after a drag.
    e.preventDefault();
    this.root.focus({ preventScroll: true });
    const r = this.root.getBoundingClientRect();
    this.drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    try {
      this.bar.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture; the drag still runs.
    }
    this.root.classList.add('float-window--dragging');
  };

  private readonly onBarMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    e.preventDefault();
    const { x, y } = this.clamp({ x: e.clientX - this.drag.dx, y: e.clientY - this.drag.dy });
    this.root.style.left = `${Math.round(x)}px`;
    this.root.style.top = `${Math.round(y)}px`;
  };

  private readonly onBarUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.endDrag();
  };

  /** Let go: where the window now is becomes where it lives this session. */
  private endDrag(): void {
    if (!this.drag) return;
    if (this.bar.hasPointerCapture(this.drag.id)) this.bar.releasePointerCapture(this.drag.id);
    this.drag = null;
    this.root.classList.remove('float-window--dragging');
    const r = this.root.getBoundingClientRect();
    this.pos = { x: r.left, y: r.top };
    writePosition(this.pos);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  private readonly onResize = (): void => {
    if (this.opened) this.place();
  };
}

/** A full-width action button, alert-on-error. */
function actionButton(label: string, action: () => Promise<void>): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sculpt-panel__btn outliner__filebtn';
  b.textContent = label;
  b.addEventListener('click', () => {
    b.disabled = true;
    void action()
      .catch((err: Error) => alert(err.message))
      .finally(() => {
        b.disabled = false;
      });
  });
  return b;
}

function readPosition(): Position | null {
  try {
    const raw = sessionStorage.getItem(POSITION_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Position>) : null;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x!, y: p.y! } : null;
  } catch {
    return null; // a blocked or corrupt store: the window starts under its chip
  }
}

function writePosition(p: Position): void {
  try {
    sessionStorage.setItem(POSITION_KEY, JSON.stringify(p));
  } catch {
    // The position just lasts until the page goes.
  }
}
