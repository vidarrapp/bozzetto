import type { InputShell } from '../bridge/InputShell';
import { hideSliderBubble, showSliderBubble } from '../../ui/sliderBubble';
import { formatSliderNumber, holdToLimits, openNumberField, parseTyped, watchDoublePress } from '../../ui/sliderEntry';
import { onTap } from '../../ui/dom';
import { chordParts, keymap } from '../../ui/keymap';
// Flaticon uicons bold straight (fi-bs-*), for the Solo button's glyph; the
// font only downloads when that glyph first renders. Attribution: README.
import '@flaticon/flaticon-uicons/css/bold/straight.css';

/**
 * Minimal Procreate-style left rail (WS2h review request + undo round): two
 * thin vertical tracks - brush size on top (log-mapped over 5..500 px so
 * small brushes get room), strength below (linear 0..1) - each just a track
 * and a nub, the Solo button between them, then undo/redo chips at the foot
 * of the rail, mirroring where
 * Procreate parks its history arrows. Slider values stay live in both
 * directions: dragging updates the tool (with the centered preview ring),
 * and every other route (digits, b/s drags, wheel keys, tool switches)
 * moves the nubs through InputShell.onBrushChange. The history buttons act
 * on tap and auto-repeat while held; their enabled state is re-checked by
 * refreshHistory(), which the mode tick polls (cheap: two flag reads, DOM
 * touched only on change). A double-tap on either track opens a number
 * field beside it, as every slider's double-click does (sliderEntry): a
 * size typed past 500 px is kept, and the nub pins at the top.
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

/**
 * The undo/redo chips, redo above undo: a tap steps once, holding walks the
 * stack. Sculpt's rail carries them at its foot; Armature mode stands the
 * same column where the rail would be (armature/mode.ts).
 */
export class HistoryButtons {
  readonly el: HTMLDivElement;
  private readonly btns: { undo: HTMLButtonElement; redo: HTMLButtonElement };
  private state = { undo: false, redo: false };
  private repeatTimer = 0;

  constructor(private readonly history: HistoryHooks) {
    this.el = document.createElement('div');
    this.el.className = 'sculpt-hist';
    this.btns = {
      undo: this.build('Undo (ctrl+z)', UNDO_ICON, () => this.history.undo(), () => this.history.canUndo()),
      redo: this.build('Redo (ctrl+shift+z)', REDO_ICON, () => this.history.redo(), () => this.history.canRedo()),
    };
    this.btns.undo.dataset.hist = 'undo';
    this.btns.redo.dataset.hist = 'redo';
    // Redo above undo (owner call): undo is the one reached for in a
    // hurry, so it sits closest to the thumb at the bottom of the column.
    this.el.append(this.btns.redo, this.btns.undo);
  }

  private build(title: string, icon: string, act: () => void, can: () => boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sculpt-histbtn';
    // Matches the state cache's initial false; refresh only writes the
    // DOM on change, so the two must start in agreement.
    btn.disabled = true;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = icon;
    const step = (): void => {
      if (!can()) return this.stopRepeat();
      act();
      this.refresh();
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
    holdable(btn);
    return btn;
  }

  private stopRepeat(): void {
    // A timeout id and an interval id share one numeric namespace; clearing
    // with both is harmless and covers whichever phase the hold is in.
    window.clearTimeout(this.repeatTimer);
    window.clearInterval(this.repeatTimer);
    this.repeatTimer = 0;
  }

  /** Enable/disable the chips; the DOM is touched only on change. */
  refresh(): void {
    const undo = this.history.canUndo();
    const redo = this.history.canRedo();
    if (undo !== this.state.undo) {
      this.state.undo = undo;
      this.btns.undo.disabled = !undo;
    }
    if (redo !== this.state.redo) {
      this.state.redo = redo;
      this.btns.redo.disabled = !redo;
    }
  }

  dispose(): void {
    this.stopRepeat();
    this.el.remove();
  }
}

/** Solo (view.solo) for the rail's button: the mode owns the state. */
export interface SoloHooks {
  isSolo(): boolean;
  /** Something is active to show alone. */
  canSolo(): boolean;
  toggle(): void;
}

export class BrushSliders {
  private readonly root: HTMLDivElement;
  private readonly nubs: { size: HTMLDivElement; strength: HTMLDivElement };
  private readonly hist: HistoryButtons;
  private readonly soloBtn: HTMLButtonElement | null = null;
  private soloState = { on: false, can: false };
  private readonly offKeymap: () => void = () => {};

  constructor(
    private readonly input: InputShell,
    history: HistoryHooks,
    private readonly solo?: SoloHooks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'sculpt-sliders';
    const size = this.buildSlider('size', 'Brush size');
    const strength = this.buildSlider('strength', 'Brush strength');
    this.nubs = { size: size.nub, strength: strength.nub };
    this.hist = new HistoryButtons(history);
    this.root.append(size.el);
    // Solo, directly above the strength track (owner layout call): the
    // view's one toggle a hand on the rail reaches for, Alt+Q's twin on a
    // touch screen. Pressed while solo is on; greyed with nothing active.
    if (solo) {
      const wrap = document.createElement('div');
      wrap.className = 'sculpt-solo';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sculpt-histbtn sculpt-solobtn';
      btn.innerHTML = '<i class="fi fi-bs-arrows-to-eye" aria-hidden="true"></i>';
      // Matches the state cache's initial values; refresh writes on change.
      btn.disabled = true;
      btn.setAttribute('aria-pressed', 'false');
      onTap(btn, () => {
        if (!btn.disabled) this.solo?.toggle();
        this.refreshSolo();
      });
      wrap.appendChild(btn);
      this.root.append(wrap);
      this.soloBtn = btn;
      this.titleSolo();
      this.offKeymap = keymap.onChange(() => this.titleSolo());
    }
    this.root.append(strength.el, this.hist.el);
    document.body.appendChild(this.root);

    this.input.onBrushChange = () => this.refresh();
    this.refresh();
    this.refreshHistory();
  }

  /** "Solo (Alt+Q)", from the keymap, so a rebind shows at once. */
  private titleSolo(): void {
    if (!this.soloBtn) return;
    const chord = keymap.chordFor('view.solo');
    const title = chord ? `Solo (${chordParts(chord).join('+')})` : 'Solo';
    this.soloBtn.title = title;
    this.soloBtn.setAttribute('aria-label', title);
  }

  /** Pressed and enabled as solo stands; the DOM is touched only on change. */
  private refreshSolo(): void {
    if (!this.soloBtn || !this.solo) return;
    const on = this.solo.isSolo();
    const can = this.solo.canSolo() || on;
    if (on !== this.soloState.on) {
      this.soloState.on = on;
      this.soloBtn.setAttribute('aria-pressed', String(on));
    }
    if (can !== this.soloState.can) {
      this.soloState.can = can;
      this.soloBtn.disabled = !can;
    }
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
      // The value beside the nub while it is dragged (owner rule for sliders).
      const text = kind === 'size' ? this.sizeText() : `${Math.round(this.input.getBrushIntensity() * 100)}%`;
      showSliderBubble(rect.right, rect.bottom - t * rect.height, text, 'right');
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
    el.addEventListener('pointerup', hideSliderBubble);
    el.addEventListener('pointercancel', hideSliderBubble);
    holdable(el);
    watchDoublePress(
      el,
      () => {
        // A press on the track sets the value where it lands; the pair of
        // presses that opens the field must leave the brush as it was.
        const before = kind === 'size' ? this.input.getBrushRadius() : this.input.getBrushIntensity();
        return () => {
          if (kind === 'size') this.input.setBrushRadius(before);
          else this.input.setBrushIntensity(before);
        };
      },
      (undo) => {
        undo();
        hideSliderBubble();
        this.openField(kind, el, nub);
      },
    );
    return { el, nub };
  }

  /**
   * The size as the bubble and the field say it: pixels in screen scale,
   * the radius in centimetres in world scale on real units (owner
   * decision), the bare number in a scene from before them.
   */
  private sizeText(): string {
    const { unit, scale } = this.input.brushSizeDisplay();
    const v = this.input.getBrushRadius() * scale;
    return `${scale === 1 ? Math.round(v) : formatSliderNumber(v, scale)}${unit}`;
  }

  /**
   * The typed value for a track, in a field beside its nub: the size as
   * the bubble prints it (sizeText), the strength in percent.
   */
  private openField(kind: 'size' | 'strength', el: HTMLElement, nub: HTMLElement): void {
    const size = kind === 'size';
    const display = this.input.brushSizeDisplay();
    const value = size
      ? display.scale === 1
        ? Math.round(this.input.getBrushRadius())
        : Number(formatSliderNumber(this.input.getBrushRadius() * display.scale, display.scale))
      : Math.round(this.input.getBrushIntensity() * 100);
    const track = el.getBoundingClientRect();
    const at = nub.getBoundingClientRect();
    openNumberField(
      String(value),
      size ? 'Brush size' : 'Brush strength',
      (field) => {
        field.classList.add('slider-field--float');
        field.style.left = `${Math.round(track.right + 8)}px`;
        field.style.top = `${Math.round(at.top + at.height / 2)}px`;
        document.body.appendChild(field);
        return () => field.remove();
      },
      (typed) => {
        const raw = parseTyped(typed);
        if (!Number.isFinite(raw)) return;
        // Back to slider steps from what was typed (centimetres on real
        // units); a step is the least a brush can be.
        if (size) this.input.setBrushRadius(holdToLimits(raw / display.scale, { min: 1, integer: true }));
        else this.input.setBrushIntensity(holdToLimits(raw / 100, { min: 0, max: 1 }));
      },
    );
  }

  /** Nub positions from the live tool values (bottom = min, top = max). */
  private refresh(): void {
    const tSize = (Math.log(this.input.getBrushRadius()) - LOG_MIN) / LOG_SPAN;
    this.nubs.size.style.bottom = `${(Math.min(1, Math.max(0, tSize)) * 100).toFixed(1)}%`;
    this.nubs.strength.style.bottom = `${(this.input.getBrushIntensity() * 100).toFixed(1)}%`;
  }

  /** Enable/disable the history chips; DOM is touched only on change. */
  refreshHistory(): void {
    this.hist.refresh();
    // Solo moves by Alt+Q, the Scene panel's chip and eyes, and active
    // object changes; polled with the history flags, as cheaply.
    this.refreshSolo();
  }

  dispose(): void {
    this.offKeymap();
    this.hist.dispose();
    this.input.onBrushChange = null;
    this.root.remove();
  }
}

/**
 * A control that is held, not tapped: the rails are dragged slowly and the
 * history buttons repeat while held. On iPadOS a finger held still arms
 * the long press at about 450ms and Safari then cancels the touch, which
 * stops a repeat (it starts at 400ms) and lets go of a paused drag.
 * Cancelling the touchstart default stops it arming; both are driven by
 * pointer events, which still arrive, and use no click.
 */
function holdable(el: HTMLElement): void {
  el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
}
