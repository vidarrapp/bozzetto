import type { InputShell } from '../bridge/InputShell';

/**
 * Minimal Procreate-style left rail (WS2h review request + undo round): two
 * thin vertical tracks - brush size on top (log-mapped over 5..500 px so
 * small brushes get room), strength below (linear 0..1) - each just a track
 * and a nub, then undo/redo chips at the foot of the rail, mirroring where
 * Procreate parks its history arrows. Slider values stay live in both
 * directions: dragging updates the tool (with the centered preview ring),
 * and every other route (digits, b/s drags, wheel keys, tool switches)
 * moves the nubs through InputShell.onBrushChange. The history buttons act
 * on tap and auto-repeat while held; their enabled state is re-checked by
 * refreshHistory(), which the mode tick polls (cheap: two flag reads, DOM
 * touched only on change).
 */

const R_MIN = 5;
const R_MAX = 500;
const LOG_MIN = Math.log(R_MIN);
const LOG_SPAN = Math.log(R_MAX) - LOG_MIN;

/** Held-button repeat: one step on press, then a steady walk. */
const REPEAT_DELAY_MS = 400;
const REPEAT_STEP_MS = 110;

const UNDO_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4.5 4.5 8l3.5 3.5M4.5 8H12a4.5 4.5 0 0 1 0 9H8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const REDO_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4.5 15.5 8l-3.5 3.5M15.5 8H8a4.5 4.5 0 0 0 0 9h3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface HistoryHooks {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export class BrushSliders {
  private readonly root: HTMLDivElement;
  private readonly nubs: { size: HTMLDivElement; strength: HTMLDivElement };
  private readonly histBtns: { undo: HTMLButtonElement; redo: HTMLButtonElement };
  private histState = { undo: false, redo: false };
  private repeatTimer = 0;

  constructor(
    private readonly input: InputShell,
    private readonly history: HistoryHooks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'sculpt-sliders';
    const size = this.buildSlider('size', 'Brush size');
    const strength = this.buildSlider('strength', 'Brush strength');
    this.nubs = { size: size.nub, strength: strength.nub };
    const hist = document.createElement('div');
    hist.className = 'sculpt-hist';
    this.histBtns = {
      undo: this.buildHistButton('Undo (ctrl+z)', UNDO_ICON, () => this.history.undo(), () =>
        this.history.canUndo(),
      ),
      redo: this.buildHistButton('Redo (ctrl+shift+z)', REDO_ICON, () => this.history.redo(), () =>
        this.history.canRedo(),
      ),
    };
    // Redo above undo (owner call): undo is the one reached for in a
    // hurry, so it sits closest to the thumb at the bottom of the column.
    hist.append(this.histBtns.redo, this.histBtns.undo);
    this.root.append(size.el, strength.el, hist);
    document.body.appendChild(this.root);

    this.input.onBrushChange = () => this.refresh();
    this.refresh();
    this.refreshHistory();
  }

  private buildSlider(
    kind: 'size' | 'strength',
    title: string,
  ): { el: HTMLDivElement; nub: HTMLDivElement } {
    const el = document.createElement('div');
    el.className = 'sculpt-slider';
    el.dataset.kind = kind;
    el.title = title;
    const track = document.createElement('div');
    track.className = 'sculpt-slider__track';
    const nub = document.createElement('div');
    nub.className = 'sculpt-slider__nub';
    el.append(track, nub);

    const apply = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
      if (kind === 'size') this.input.setBrushRadius(Math.exp(LOG_MIN + t * LOG_SPAN));
      else this.input.setBrushIntensity(t);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events carry no active pointer; capture is best-effort.
      }
      apply(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons !== 0) apply(e);
    });
    return { el, nub };
  }

  private buildHistButton(
    title: string,
    icon: string,
    act: () => void,
    can: () => boolean,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sculpt-histbtn';
    // Matches the histState cache's initial false; refreshHistory only
    // writes the DOM on change, so the two must start in agreement.
    btn.disabled = true;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = icon;
    const step = (): void => {
      if (!can()) return this.stopRepeat();
      act();
      this.refreshHistory();
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events carry no active pointer; capture is best-effort.
      }
      step();
      this.stopRepeat();
      this.repeatTimer = window.setTimeout(() => {
        this.repeatTimer = window.setInterval(step, REPEAT_STEP_MS);
      }, REPEAT_DELAY_MS);
    });
    const stop = (): void => this.stopRepeat();
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    return btn;
  }

  private stopRepeat(): void {
    // A timeout id and an interval id share one numeric namespace; clearing
    // with both is harmless and covers whichever phase the hold is in.
    window.clearTimeout(this.repeatTimer);
    window.clearInterval(this.repeatTimer);
    this.repeatTimer = 0;
  }

  /** Nub positions from the live tool values (bottom = min, top = max). */
  private refresh(): void {
    const tSize = (Math.log(this.input.getBrushRadius()) - LOG_MIN) / LOG_SPAN;
    this.nubs.size.style.bottom = `${(Math.min(1, Math.max(0, tSize)) * 100).toFixed(1)}%`;
    this.nubs.strength.style.bottom = `${(this.input.getBrushIntensity() * 100).toFixed(1)}%`;
  }

  /** Enable/disable the history chips; DOM is touched only on change. */
  refreshHistory(): void {
    const undo = this.history.canUndo();
    const redo = this.history.canRedo();
    if (undo !== this.histState.undo) {
      this.histState.undo = undo;
      this.histBtns.undo.disabled = !undo;
    }
    if (redo !== this.histState.redo) {
      this.histState.redo = redo;
      this.histBtns.redo.disabled = !redo;
    }
  }

  dispose(): void {
    this.stopRepeat();
    this.input.onBrushChange = null;
    this.root.remove();
  }
}
