import type { InputShell } from '../bridge/InputShell';
import { hideSliderBubble, showSliderBubble } from '../../ui/sliderBubble';
import { formatSliderNumber, holdToLimits, openNumberField, parseTyped, watchDoublePress } from '../../ui/sliderEntry';
import { onTap } from '../../ui/dom';
import { SHELL_LAYOUT_EVENT } from './shellLayout';
import { chordParts, keymap } from '../../ui/keymap';
// Flaticon uicons solid straight (fi-ss-*), for the Solo button's glyph, the
// style of every other icon. Attribution: README.
import '@flaticon/flaticon-uicons/css/solid/straight.css';

/**
 * The edge controls at the bottom left (docs/ui-spec.md section 6): a
 * column of bare icon buttons, bottom up Negative, Undo, Redo and Solo,
 * with the brush Strength and Size above them as two upright fields - a
 * 1px line, the amount in orange from its foot, the value above, no
 * handle - dragged up and down in a zone 44px wide. The size is
 * log-mapped over 5..500 px so small brushes get room; the strength is
 * linear: 0 to 5 cm for the brushes whose strength is a length, 0..1 for
 * the rest. Both show only while the Tool panel is closed (its own rows
 * say the same), and for a moment when a hotkey or a tool switch moves
 * them while it is open. Values stay live in both directions: dragging
 * updates the tool (with the centered preview ring), and every other
 * route (digits, b/s drags, wheel keys, tool switches) moves the fields
 * through InputShell.onBrushChange. The history buttons act on tap and
 * auto-repeat while held; their enabled state is re-checked by
 * refreshHistory(), which the mode tick polls (cheap: two flag reads, DOM
 * touched only on change). A double-tap on either field opens a number
 * field beside it, as every slider's double-click does (sliderEntry): a
 * size typed past 500 px is kept, and the amount pins at the top.
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

/** How long the fields stay up after a change made while the Tool panel is open. */
const FLASH_MS = 1100;

export class BrushSliders {
  private readonly root: HTMLDivElement;
  private readonly fields: HTMLDivElement;
  private readonly vals: { size: HTMLElement; strength: HTMLElement };
  private flashTimer = 0;
  private readonly nubs: { size: HTMLDivElement; strength: HTMLDivElement };
  private readonly hist: HistoryButtons;
  private readonly soloBtn: HTMLButtonElement | null = null;
  private soloState = { on: false, can: false };
  private readonly offKeymap: () => void = () => {};

  constructor(
    private readonly input: InputShell,
    history: HistoryHooks,
    private readonly solo?: SoloHooks,
    /** Negative, the bottom of the column (the tool bar owns its press logic). */
    negative?: HTMLElement,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'sculpt-sliders bz-edge';
    this.fields = document.createElement('div');
    this.fields.className = 'bz-edge__fields';
    const size = this.buildSlider('size', 'Brush size');
    const strength = this.buildSlider('strength', 'Brush strength');
    this.nubs = { size: size.nub, strength: strength.nub };
    this.vals = { size: size.val, strength: strength.val };
    this.hist = new HistoryButtons(history);
    // Solo, at the head of the rail above both tracks (owner layout call): the
    // view's one toggle a hand on the rail reaches for, Alt+Q's twin on a
    // touch screen. Pressed while solo is on; greyed with nothing active.
    if (solo) {
      const wrap = document.createElement('div');
      wrap.className = 'sculpt-solo';
      const btn = document.createElement('button');
      btn.type = 'button';
      // Its own class, styled like the history chips: .sculpt-histbtn means
      // undo or redo, and Solo sharing it made it the first match for them.
      btn.className = 'sculpt-solobtn';
      btn.innerHTML = '<i class="fi fi-ss-arrows-to-eye" aria-hidden="true"></i>';
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
    this.fields.append(size.el, strength.el);
    // The fields lead, then Solo (already in the root), then the history
    // and Negative, which is the foot of the column.
    this.root.prepend(this.fields);
    this.root.append(this.hist.el);
    if (negative) this.root.append(negative);
    document.body.appendChild(this.root);

    this.input.onBrushChange = () => {
      this.refresh();
      this.flash();
    };
    window.addEventListener('bozzetto:panel-open', this.onPanel);
    window.addEventListener('bozzetto:panel-close', this.onPanel);
    window.addEventListener('bozzetto:panel-close-all', this.onPanel);
    this.refresh();
    this.refreshHistory();
    this.paintFields();
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

  /** Whether the Tool panel is open, whose own rows then say what the fields do. */
  private toolPanelOpen(): boolean {
    const p = document.querySelector('.panel--sculpt');
    return !!p && !p.classList.contains('panel--collapsed');
  }

  /** Whether a panel is open on the left, which needs the height the fields would take. */
  private leftPanelOpen(): boolean {
    return !!document.querySelector('.panel--scene:not(.panel--collapsed), .panel--model:not(.panel--collapsed)');
  }

  private paintFields(): void {
    // An open left panel has the edge to itself: the fields would leave it a
    // couple of hundred pixels on a tablet. They come back when it closes.
    const hidden = this.leftPanelOpen() || (this.toolPanelOpen() && !this.flashTimer);
    if (this.fields.hidden === hidden) return;
    this.fields.hidden = hidden;
    window.dispatchEvent(new Event(SHELL_LAYOUT_EVENT));
  }

  private readonly onPanel = (): void => {
    // A panel's events come before its class changes settle in some orders;
    // the next frame has the truth.
    this.paintFields();
    requestAnimationFrame(() => this.paintFields());
  };

  /** Show the fields for a moment, for a change made with the Tool panel open. */
  private flash(): void {
    if (!this.toolPanelOpen()) return;
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = 0;
      this.paintFields();
    }, FLASH_MS);
    this.paintFields();
  }

  private buildSlider(
    kind: 'size' | 'strength',
    title: string,
  ): { el: HTMLDivElement; nub: HTMLDivElement; val: HTMLElement } {
    const el = document.createElement('div');
    el.className = 'sculpt-slider';
    el.dataset.kind = kind;
    el.title = title;
    const track = document.createElement('div');
    track.className = 'sculpt-slider__track';
    const nub = document.createElement('div');
    nub.className = 'sculpt-slider__nub';
    // The value stands above the line, in mono; the zone the finger drags
    // in is the line's own height, so the label does not skew it.
    const val = document.createElement('span');
    val.className = 'sculpt-slider__val';
    el.append(track, nub, val);

    const apply = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
      if (kind === 'size') this.input.setBrushRadius(Math.exp(LOG_MIN + t * LOG_SPAN));
      else {
        // In the strength's own steps over its travel: hundredths of 1, or
        // of a centimetre over 0 to 5 cm.
        const spec = this.input.strengthSpec();
        this.input.setBrushIntensity(Math.round((t * spec.max) / spec.step) * spec.step);
      }
      // The value beside the nub while it is dragged (owner rule for sliders).
      const text = kind === 'size' ? this.sizeText() : this.input.strengthText();
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
    return { el, nub, val };
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
   * the bubble prints it (sizeText), the strength in cm for a brush whose
   * strength is a length (to 50 cm), else in percent (to 100%).
   */
  private openField(kind: 'size' | 'strength', el: HTMLElement, nub: HTMLElement): void {
    const size = kind === 'size';
    const display = this.input.brushSizeDisplay();
    const strength = this.input.strengthSpec();
    const value = size
      ? display.scale === 1
        ? Math.round(this.input.getBrushRadius())
        : Number(formatSliderNumber(this.input.getBrushRadius() * display.scale, display.scale))
      : strength.cm
        ? Number(formatSliderNumber(this.input.getBrushIntensity(), strength.step))
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
        // Millimetres typed into a field in centimetres are read as such.
        const cm = size ? display.unit.trim() === 'cm' : strength.cm && strength.unit.trim() === 'cm';
        const raw = parseTyped(typed, cm ? 'cm' : undefined);
        if (!Number.isFinite(raw)) return;
        // Back to slider steps from what was typed (centimetres on real
        // units); a step is the least a brush can be.
        if (size) this.input.setBrushRadius(holdToLimits(raw / display.scale, { min: 1, integer: true }));
        else if (strength.cm) this.input.setBrushIntensity(holdToLimits(raw, { min: 0, max: strength.limit }));
        else this.input.setBrushIntensity(holdToLimits(raw / 100, { min: 0, max: 1 }));
      },
    );
  }

  /** Nub positions from the live tool values (bottom = min, top = max). */
  private refresh(): void {
    const tSize = (Math.log(this.input.getBrushRadius()) - LOG_MIN) / LOG_SPAN;
    this.nubs.size.style.bottom = `${(Math.min(1, Math.max(0, tSize)) * 100).toFixed(1)}%`;
    const tStrength = this.input.getBrushIntensity() / this.input.strengthSpec().max;
    this.nubs.strength.style.bottom = `${(Math.min(1, Math.max(0, tStrength)) * 100).toFixed(1)}%`;
    // The amount, as the stylesheet draws it from the line's foot, and its value.
    const amount = (t: number): string => (Math.min(1, Math.max(0, t)) * 100).toFixed(1);
    this.nubs.size.parentElement?.style.setProperty('--amount', amount(tSize));
    this.nubs.strength.parentElement?.style.setProperty('--amount', amount(tStrength));
    this.setVal(this.vals.size, this.sizeText());
    this.setVal(this.vals.strength, this.input.strengthText());
  }

  private setVal(el: HTMLElement, text: string): void {
    // The number to two places at most: 2.8319 cm reads as 2.83 cm above a 44px line.
    const t = text.trim().replace(/-?\d+(\.\d+)?/, (n) => String(Number(Number(n).toFixed(2))));
    if (el.textContent !== t) el.textContent = t;
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
    window.clearTimeout(this.flashTimer);
    window.removeEventListener('bozzetto:panel-open', this.onPanel);
    window.removeEventListener('bozzetto:panel-close', this.onPanel);
    window.removeEventListener('bozzetto:panel-close-all', this.onPanel);
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
