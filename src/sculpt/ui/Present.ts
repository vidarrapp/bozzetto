import { div, onTap } from '../../ui/dom';
import { keymap, chordLabel } from '../../ui/keymap';
import { topbarLeft, topChip } from '../../ui/topbar';

/**
 * Present mode (owner call): the model on its own, for looking at and for
 * showing. Its chip sits in the top row beside Capture, and Shift+P (the
 * keymap's ui.present, rebindable) or Esc leaves it as well as the chip.
 *
 * Presenting hides what edits - the toolbar, the brush rail and its undo
 * chips, the Scene, Model and Tool panels, the brush ring and the object
 * stats - and locks it: the brushes, the gizmo and the selection do not
 * answer (InputShell.presenting), while orbit, pan and zoom do, fingers
 * included, by the iPad's finger rules. The Render panel stays, with
 * everything on the look; so do the top row and the notices. Nothing about
 * the scene changes by going in or out, and the autosave carries on.
 * Leaving puts the interface back as it was: which panels were open, the
 * tool, the gizmo or the Select tool, the mask tint, Tab's hidden state.
 *
 * The bar along the bottom holds the turntable - a slow turn about the
 * subject's vertical axis, at the speed its slider says, which Space (the
 * keymap's play.toggle, the viewer's play/pause) starts and stops and any
 * press or wheel on the view stops; it moves the camera only, so the
 * timelapse never records it - Save image, and Done. Under it, one row
 * saves the turntable as a clip: one full turn at the slider's speed
 * (36°/s is ten seconds), MP4 or GIF, the window at 1x or 2x
 * (capture/turntable.ts), rendered offline with a progress bar and Cancel
 * in the row's place while it runs.
 *
 * Tab, and the toolbar's hide button, which stays in its corner in
 * Present, hide the interface as they do anywhere in Sculpt: here that is
 * everything, this bar included, and either brings it all back.
 */

/** What mode.ts does for Present mode, which knows the scene and the viewer. */
export interface PresentHost {
  /** Whether Present can begin now: not mid-stroke, nor mid-drag. */
  canEnter(): boolean;
  /** Hide and lock what edits; returns how to put it all back as it was. */
  enter(): () => void;
  /** Turn the camera by `deg` about the subject's vertical axis. */
  turn(deg: number): void;
  /** Render the still and hand it over (Save image). */
  saveImage(): Promise<void>;
  /** Render one turn as a clip and hand it over (Save turntable); resolves when it is done or cancelled. */
  saveTurntable(clip: TurntableRequest): Promise<void>;
}

export type ClipFormat = 'mp4' | 'gif';

/** What Save turntable asks the host for. */
export interface TurntableRequest {
  format: ClipFormat;
  /** The window at 1x or 2x. */
  scale: 1 | 2;
  /** The turntable's speed: one turn at it. */
  degPerSecond: number;
  /** Aborted by Cancel (or by leaving Present). */
  signal: AbortSignal;
  onProgress(done: number, total: number): void;
}

/** Degrees a second: a slow turn, and the range the slider covers. */
const SPEED_DEFAULT = 12;
const SPEED_MIN = 2;
const SPEED_MAX = 60;
/** The slider's last value, per browser: a convenience, nothing depends on it. */
const SPEED_KEY = 'bozzetto-present-speed';
/** A stalled frame never flings the turn. */
const MAX_STEP_S = 0.1;

export class PresentMode {
  readonly chip: HTMLButtonElement;
  readonly bar: HTMLDivElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly speedInput: HTMLInputElement;
  private readonly speedOut: HTMLSpanElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly clipRow: HTMLDivElement;
  private readonly formatBtn: HTMLButtonElement;
  private readonly sizeBtn: HTMLButtonElement;
  private readonly clipBtn: HTMLButtonElement;
  private readonly progressRow: HTMLDivElement;
  private readonly progress: HTMLProgressElement;
  private format: ClipFormat = 'mp4';
  private scale: 1 | 2 = 1;
  /** Save turntable under way: its Cancel. */
  private clip: AbortController | null = null;
  private active = false;
  private restore: (() => void) | null = null;
  private turning = false;
  private lastTurn = 0;
  private speed = SPEED_DEFAULT;
  private saving = false;
  private readonly offKeymap: () => void;

  /** Told when Present begins or ends. */
  onChange: ((on: boolean) => void) | null = null;

  /** Esc leaves, unless something nearer the focus took it (a menu, a window, a dialog). */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active || e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.body.classList.contains('has-modal')) return;
    const at = e.target as Element | null;
    if (at?.closest?.('[role="menu"], [role="dialog"], .float-window, input[type="text"], textarea')) return;
    this.leave();
  };

  /** Any press or wheel on the view stops the turn: the hand takes over. */
  private readonly onViewInput = (e: Event): void => {
    if (!this.turning) return;
    if (!this.view.contains(e.target as Node | null)) return;
    this.setTurning(false);
  };

  constructor(
    private readonly host: PresentHost,
    /** The viewport: a press inside it stops the turntable. */
    private readonly view: HTMLElement,
  ) {
    this.chip = topChip('Present') as HTMLButtonElement;
    this.chip.classList.add('file-menu__chip', 'present__chip');
    this.chip.setAttribute('aria-pressed', 'false');
    onTap(this.chip, () => this.toggle());
    topbarLeft().appendChild(this.chip);
    this.syncChipTitle();

    this.bar = div('present-bar');
    this.bar.hidden = true;
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Present');

    this.playBtn = button('present-bar__play', 'Turntable', () => this.setTurning(!this.turning));
    this.playBtn.setAttribute('aria-pressed', 'false');

    const speed = div('present-bar__speed');
    this.speedInput = document.createElement('input');
    this.speedInput.type = 'range';
    this.speedInput.min = String(SPEED_MIN);
    this.speedInput.max = String(SPEED_MAX);
    this.speedInput.step = '1';
    this.speedInput.setAttribute('aria-label', 'Turntable speed, degrees a second');
    this.speedOut = document.createElement('span');
    this.speedOut.className = 'present-bar__val';
    try {
      const stored = Number(localStorage.getItem(SPEED_KEY));
      if (stored >= SPEED_MIN && stored <= SPEED_MAX) this.speed = stored;
    } catch {
      // A blocked store: the default speed.
    }
    this.speedInput.value = String(this.speed);
    this.speedInput.addEventListener('input', () => this.setSpeed(Number(this.speedInput.value)));
    speed.append(this.speedInput, this.speedOut);
    this.paintSpeed();

    this.saveBtn = button('present-bar__save', 'Save image', () => void this.saveImage());
    const done = button('present-bar__done', 'Done', () => this.leave());
    done.setAttribute('aria-label', 'Leave Present');
    const top = div('present-bar__row');
    top.append(this.playBtn, speed, this.saveBtn, done);

    // Save turntable: the format and the size switch on a tap, as the
    // play button does - nothing keeps a focus for Space to land on.
    this.formatBtn = button('present-bar__format', '', () => this.setClipFormat(this.format === 'mp4' ? 'gif' : 'mp4'));
    this.sizeBtn = button('present-bar__size', '', () => this.setClipScale(this.scale === 1 ? 2 : 1));
    this.clipBtn = button('present-bar__clip', 'Save turntable', () => void this.saveTurntable());
    this.clipBtn.title = 'One full turn at the turntable\'s speed, as a video';
    this.clipRow = div('present-bar__row present-bar__cliprow');
    this.clipRow.append(this.formatBtn, this.sizeBtn, this.clipBtn);
    this.progress = document.createElement('progress');
    this.progress.className = 'present-bar__progress';
    this.progress.max = 1;
    this.progress.value = 0;
    this.progress.setAttribute('aria-label', 'Saving the turntable');
    const cancel = button('present-bar__cancel', 'Cancel', () => this.clip?.abort());
    this.progressRow = div('present-bar__row present-bar__cliprow');
    this.progressRow.hidden = true;
    this.progressRow.append(this.progress, cancel);
    this.paintClip();

    this.bar.append(top, this.clipRow, this.progressRow);
    document.body.appendChild(this.bar);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onViewInput, true);
    window.addEventListener('wheel', this.onViewInput, { capture: true, passive: true });
    this.offKeymap = keymap.onChange(() => this.syncChipTitle());
  }

  isActive(): boolean {
    return this.active;
  }

  isTurning(): boolean {
    return this.turning;
  }

  getSpeed(): number {
    return this.speed;
  }

  toggle(): void {
    if (this.active) this.leave();
    else this.enter();
  }

  enter(): boolean {
    if (this.active) return true;
    if (!this.host.canEnter()) return false;
    this.restore = this.host.enter();
    this.active = true;
    this.bar.hidden = false;
    this.chip.setAttribute('aria-pressed', 'true');
    this.chip.classList.add('topchip--open');
    this.onChange?.(true);
    return true;
  }

  leave(): void {
    if (!this.active) return;
    this.clip?.abort();
    this.setTurning(false);
    this.active = false;
    this.bar.hidden = true;
    this.chip.setAttribute('aria-pressed', 'false');
    this.chip.classList.remove('topchip--open');
    const restore = this.restore;
    this.restore = null;
    restore?.();
    this.onChange?.(false);
  }

  /** The turntable on or off; only while presenting. */
  setTurning(on: boolean): void {
    // Not while a clip renders: it has the camera.
    on = on && this.active && !this.clip;
    if (on === this.turning) return;
    this.turning = on;
    this.lastTurn = performance.now();
    this.playBtn.setAttribute('aria-pressed', String(on));
    this.playBtn.classList.toggle('is-on', on);
  }

  setSpeed(degPerSecond: number): void {
    if (!Number.isFinite(degPerSecond)) return;
    this.speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, degPerSecond));
    this.speedInput.value = String(this.speed);
    this.paintSpeed();
    try {
      localStorage.setItem(SPEED_KEY, String(this.speed));
    } catch {
      // Only this page remembers it, then.
    }
  }

  /** Once a frame (mode.ts, before the controls): the turn, by real elapsed time. */
  tick(): void {
    if (!this.turning) return;
    const now = performance.now();
    const dt = Math.min(MAX_STEP_S, Math.max(0, (now - this.lastTurn) / 1000));
    this.lastTurn = now;
    if (dt > 0) this.host.turn(this.speed * dt);
  }

  /** Space (play.toggle) in Present: the turntable on or off. */
  toggleTurning(): void {
    this.setTurning(!this.turning);
  }

  getClipFormat(): ClipFormat {
    return this.format;
  }

  getClipScale(): 1 | 2 {
    return this.scale;
  }

  setClipFormat(format: ClipFormat): void {
    if (this.clip) return;
    this.format = format === 'gif' ? 'gif' : 'mp4';
    this.paintClip();
  }

  setClipScale(scale: number): void {
    if (this.clip) return;
    this.scale = scale >= 2 ? 2 : 1;
    this.paintClip();
  }

  /** Whether Save turntable is rendering. */
  isSavingClip(): boolean {
    return this.clip !== null;
  }

  /**
   * Save turntable: one turn at the slider's speed, from this view. The
   * turn stops for it, the bar's row becomes the progress and its Cancel,
   * and the turntable carries on afterwards if it was turning.
   */
  async saveTurntable(): Promise<void> {
    if (this.clip || this.saving || !this.active) return;
    const wasTurning = this.turning;
    this.setTurning(false);
    const clip = new AbortController();
    this.clip = clip;
    this.saveBtn.disabled = true;
    this.progress.value = 0;
    this.clipRow.hidden = true;
    this.progressRow.hidden = false;
    try {
      await this.host.saveTurntable({
        format: this.format,
        scale: this.scale,
        degPerSecond: this.speed,
        signal: clip.signal,
        onProgress: (done, total) => {
          this.progress.value = total > 0 ? done / total : 0;
        },
      });
    } finally {
      this.clip = null;
      this.saveBtn.disabled = false;
      this.progressRow.hidden = true;
      this.clipRow.hidden = false;
      if (wasTurning && !clip.signal.aborted) this.setTurning(true);
    }
  }

  /** Save image: the turn stops for it, so the picture is of one view. */
  async saveImage(): Promise<void> {
    if (this.saving || this.clip) return;
    this.saving = true;
    this.saveBtn.disabled = true;
    this.clipBtn.disabled = true;
    this.setTurning(false);
    try {
      await this.host.saveImage();
    } finally {
      this.saving = false;
      this.saveBtn.disabled = false;
      this.clipBtn.disabled = false;
    }
  }

  dispose(): void {
    this.leave();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointerdown', this.onViewInput, true);
    window.removeEventListener('wheel', this.onViewInput, { capture: true });
    this.offKeymap();
    this.chip.remove();
    this.bar.remove();
  }

  private paintClip(): void {
    this.formatBtn.textContent = this.format === 'mp4' ? 'MP4' : 'GIF';
    this.formatBtn.setAttribute('aria-label', `Turntable clip format: ${this.format.toUpperCase()}`);
    this.formatBtn.title = 'MP4 or GIF';
    this.sizeBtn.textContent = `${this.scale}×`;
    this.sizeBtn.setAttribute('aria-label', `Turntable clip size: the window at ${this.scale}x`);
    this.sizeBtn.title = 'The window at 1x or 2x';
  }

  private paintSpeed(): void {
    this.speedOut.textContent = `${Math.round(this.speed)}°/s`;
  }

  private syncChipTitle(): void {
    const chord = keymap.chordFor('ui.present');
    this.chip.title = chord ? `Present (${chordLabel(chord)}; Esc leaves)` : 'Present (Esc leaves)';
  }
}

function button(className: string, label: string, action: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `present-bar__btn ${className}`;
  b.textContent = label;
  onTap(b, action);
  return b;
}
