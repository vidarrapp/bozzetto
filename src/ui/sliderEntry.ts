/**
 * Typed values on sliders (owner request, after Maya: a slider's travel is
 * a default range, and a value typed into it may go past that). A
 * double-click with the mouse or the pen, or a double-tap with a finger,
 * turns the slider into a number field where it stands, holding the value
 * and selected; Enter or leaving the field applies what was typed, Esc
 * keeps what was there. Enter on a focused slider opens the field too.
 *
 * A typed value is held only to the quantity's own limits - an intensity
 * cannot go below zero, a roughness past one, an angle wraps - and not to
 * the travel. Past the travel it is applied as typed: the thumb pins at
 * that end and the row's readout, and the drag bubble, print the value
 * itself. A drag then moves within the travel again, from where the thumb
 * sits. The value lives here, beside the input, because a range input can
 * only hold what its travel covers.
 */

/** What a typed value is held to: the quantity's own limits, not the travel. */
export interface Limits {
  /** The lowest the quantity can be. */
  min?: number;
  /** The highest it can be. */
  max?: number;
  /** An angle: wrapped into [min, min + wrap) rather than clamped. */
  wrap?: number;
  /** A count (voxels, pixels): rounded to a whole number. */
  integer?: boolean;
}

export interface TypedSlider {
  /** What a value does once it is committed: the builder's input handler. */
  apply(v: number): void;
  /** The quantity's own limits; without them any finite number goes. */
  limits?: Limits;
  /** Repaints the row's readout for a value, which may lie past the travel. */
  readout?(v: number): void;
  /**
   * Called as the first press of a possible double lands, before the slider
   * moves; returns what puts back anything beyond the value that press
   * changes (the DoF focus slider lets go of the focus lock as it moves).
   */
  hold?(): () => void;
}

interface Entry {
  spec: TypedSlider;
  /** The value the slider stands for. */
  value: number;
  /** The thumb position that value was set at; a thumb moved since says the value moved with it. */
  thumb: string;
}

const entries = new WeakMap<HTMLInputElement, Entry>();

/** The value a slider stands for: a typed value past its travel, or where its thumb is. */
export function sliderValue(input: HTMLInputElement): number {
  const e = entries.get(input);
  return e && input.value === e.thumb ? e.value : Number(input.value);
}

/**
 * Point a slider at a value from outside (a hotkey, an undo, the rail): the
 * thumb goes as near as the travel allows, and the value itself is kept for
 * the readout and the bubble.
 */
export function setSliderValue(input: HTMLInputElement, v: number): void {
  input.value = String(v);
  const e = entries.get(input);
  if (!e) return;
  e.value = v;
  e.thumb = input.value;
  e.spec.readout?.(v);
}

/** Decimal places a number is written with (at most four). */
function decimalsOf(x: number): number {
  const s = String(Number(x.toFixed(4)));
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(4, s.length - dot - 1);
}

/** A number as a slider prints it: the step's decimals, more if the value has them (to four). */
export function formatSliderNumber(v: number, step: number): string {
  return v.toFixed(Math.max(decimalsOf(step), decimalsOf(v)));
}

function scaleOf(input: HTMLInputElement): number {
  return input.dataset.scale ? Number(input.dataset.scale) : 1;
}

/** The slider's value as text: scaled and with its unit, as the bubble and the readouts print it. */
export function sliderText(input: HTMLInputElement, v = sliderValue(input)): string {
  const scale = scaleOf(input);
  const step = Number(input.step) || 1;
  return formatSliderNumber(v * scale, step * scale) + (input.dataset.unit ?? '');
}

/** A typed value held to a quantity's limits. */
export function holdToLimits(v: number, limits: Limits = {}): number {
  let out = limits.integer ? Math.round(v) : v;
  if (limits.wrap) {
    const lo = limits.min ?? 0;
    out = ((((out - lo) % limits.wrap) + limits.wrap) % limits.wrap) + lo;
  } else {
    if (limits.min !== undefined) out = Math.max(limits.min, out);
    if (limits.max !== undefined) out = Math.min(limits.max, out);
  }
  return out;
}

/**
 * What was typed, as a number: a comma for the decimal point (an iPad in
 * much of Europe offers one), a typographic minus, and a unit or a percent
 * sign left on, all go. Anything else that is not a number is NaN.
 */
export function parseTyped(text: string): number {
  let t = text
    .trim()
    .replace(/\s+/g, '')
    .replace(/−/g, '-')
    .replace(/[%°]|px$/gi, '');
  if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

/** Two presses this close in time and place are one double press. */
const DOUBLE_MS = 350;
const DOUBLE_DIST = 24;
/** A press that travels further than this was a drag, not a tap. */
const TAP_SLOP = 10;

/**
 * Watch an element for a double press: a double-click with the mouse, a
 * double-tap with a finger or the pen. `first` runs as a first press lands,
 * before the element reacts to it, and returns the undo for that press;
 * `double` gets it when the second press completes the pair.
 *
 * The mouse's second press is taken at once and cancelled, or the slider
 * would start another drag under it; a finger's or the pen's waits for its
 * lift, because iOS raises the keyboard for a field focused on a lift and
 * not on a touch's landing.
 */
export function watchDoublePress(el: HTMLElement, first: () => () => void, double: (undo: () => void) => void): void {
  let press: { id: number; x: number; y: number; moved: boolean; second: boolean } | null = null;
  let last: { t: number; x: number; y: number; type: string; undo: () => void } | null = null;
  el.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || !e.isPrimary) {
        last = null;
        return;
      }
      const prev = last;
      const second =
        !!prev &&
        prev.type === e.pointerType &&
        e.timeStamp - prev.t <= DOUBLE_MS &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= DOUBLE_DIST;
      if (prev && second && e.pointerType === 'mouse') {
        e.preventDefault();
        e.stopImmediatePropagation();
        last = null;
        press = null;
        double(prev.undo);
        return;
      }
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, second };
      // A first press is banked as it lands, with the undo for whatever it
      // is about to do; one that lifts as a drag rather than a tap is
      // dropped again on its lift.
      if (!second) last = { t: e.timeStamp, x: e.clientX, y: e.clientY, type: e.pointerType, undo: first() };
    },
    // Ahead of the element's own listeners (a target's capturing listeners
    // run first), so `first` sees the value before a custom slider moves it.
    true,
  );
  el.addEventListener('pointermove', (e) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) {
      press.moved = true;
    }
  });
  el.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (p.moved || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) {
      last = null;
      return;
    }
    if (p.second && last) {
      const put = last.undo;
      last = null;
      double(put);
    }
  });
  el.addEventListener('pointercancel', () => {
    press = null;
    last = null;
  });
}

/**
 * A number field standing in for a slider. `place` puts it on the page and
 * returns what takes it away again; `commit` gets the text if it changed.
 * Enter or leaving the field commits (a press anywhere else blurs it - see
 * touchGuards), Esc cancels. Keys typed here go no further: the hotkeys
 * stand down for a text field anyway, and Enter and Esc are this field's.
 */
export function openNumberField(
  text: string,
  label: string,
  place: (field: HTMLInputElement) => () => void,
  commit: (text: string) => void,
): HTMLInputElement {
  const field = document.createElement('input');
  field.type = 'text';
  // A numeric keyboard on an iPad, with a decimal point.
  field.inputMode = 'decimal';
  field.enterKeyHint = 'done';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.className = 'slider-field';
  field.value = text;
  field.setAttribute('aria-label', label);
  const remove = place(field);
  let done = false;
  const finish = (keep: boolean): void => {
    if (done) return; // Enter commits, and the removal can blur it as well
    done = true;
    remove();
    const typed = field.value.trim();
    if (keep && typed && typed !== text) commit(typed);
  };
  field.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  field.addEventListener('blur', () => finish(true));
  field.focus();
  field.select();
  return field;
}

/** The caption of a slider's row, for the field's accessible name. */
function rowLabel(input: HTMLInputElement): string {
  const row = input.closest('label');
  return row?.firstElementChild?.textContent?.trim() || 'Value';
}

/**
 * Give a range input typed values: `value` is what it stands for now, which
 * may lie past its travel (a saved look from before a range changed, or a
 * value typed last session).
 */
export function typedSlider(input: HTMLInputElement, spec: TypedSlider, value: number): void {
  const entry: Entry = { spec, value, thumb: input.value };
  entries.set(input, entry);
  spec.readout?.(value);
  // A drag or a key moves the value back onto the travel, from the thumb.
  input.addEventListener('input', () => {
    entry.value = Number(input.value);
    entry.thumb = input.value;
    spec.readout?.(entry.value);
  });
  const open = (undo: () => void): void => {
    if (input.hidden || !input.isConnected) return;
    undo();
    const scale = scaleOf(input);
    const step = Number(input.step) || 1;
    const row = input.closest('label');
    // The row is a <label>: a click that lands on it rather than on the
    // field would hand focus to the slider hidden under it.
    const keep = (e: Event): void => {
      if (e.target !== field) e.preventDefault();
    };
    const field = openNumberField(
      // To the slider's precision, without the step's trailing zeros: the
      // text to edit is 3, where the readout says 3.0.
      String(Number(formatSliderNumber(entry.value * scale, step * scale))),
      rowLabel(input),
      (f) => {
        input.hidden = true;
        input.after(f);
        row?.addEventListener('click', keep, true);
        return () => {
          f.remove();
          input.hidden = false;
          // After the click that may follow the press which opened it.
          window.setTimeout(() => row?.removeEventListener('click', keep, true), 0);
        };
      },
      (typed) => {
        const raw = parseTyped(typed);
        if (!Number.isFinite(raw)) return;
        const v = holdToLimits(raw / scale, spec.limits);
        setSliderValue(input, v);
        spec.apply(v);
        // As a drag ends with one: the autosaves listen for it.
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
    );
  };
  watchDoublePress(
    input,
    () => {
      const before = entry.value;
      const thumb = input.value;
      const put = spec.hold?.();
      return () => {
        // The presses may have moved the thumb (a click on the track jumps
        // it there): put the value back as it was, then whatever else the
        // first press let go of.
        if (input.value !== thumb || entry.value !== before) {
          setSliderValue(input, before);
          spec.apply(before);
        }
        put?.();
      };
    },
    open,
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.repeat) {
      e.preventDefault();
      open(() => undefined);
    }
  });
}
