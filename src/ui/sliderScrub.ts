/**
 * The whole slider row is a touch target (owner request: a slider at 0 or
 * full is nearly impossible to catch by its thumb, which sits at the very
 * edge). A press anywhere on a row (the name, the readout or the line) and a
 * drag sideways scrubs the value relatively, from where it stands, with the
 * row's full width equal to the slider's full travel. A tap changes nothing,
 * so there is no jump. A move that is mostly vertical is left to the browser,
 * which scrolls the panel (the rows carry `touch-action: pan-y`).
 *
 * Done once, here, for every range input that sits in a row: the scrub sets
 * the input's value and sends the same `input` events a native drag does,
 * and `change` at the end, so each builder's handlers run as they always
 * have. On a touch screen the stylesheet makes the input itself ignore
 * presses (it would jump to a tap and only drag from its thumb), so a press
 * always lands on the row. With a mouse on a desktop the native slider is
 * kept as it is: click to jump, drag the thumb.
 *
 * Not covered, on purpose: a range with no row (the timeline scrubber) and
 * the brush fields at the left edge, which have their own drag.
 */

import { bubbleHold, bubbleRelease } from './sliderBubble';

/** Sideways travel before a press is a scrub rather than a tap. */
const SLOP = 6;
/** A move this much more across than up or down is a scrub. */
const HORIZONTAL = 2;
/** A press that goes this far up or down first is a scroll: let it be. */
const VERTICAL_GIVE_UP = 10;

/** What counts as a slider's row. */
const ROW = 'label, .prefs__slider';
/** Controls inside a row that take their own presses. */
const OWN = 'input:not([type="range"]), select, button, textarea, a';

interface Press {
  id: number;
  input: HTMLInputElement;
  x: number;
  y: number;
  /** Where the value stood when the scrub began. */
  from: number;
  /** The x the scrub counts from: where the move became a scrub. */
  x0: number;
  active: boolean;
  last: string;
}

let press: Press | null = null;
let installed = false;

function rangeIn(target: EventTarget | null): HTMLInputElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(OWN)) return null;
  const row = target.closest(ROW);
  const input = row?.querySelector<HTMLInputElement>('input[type="range"]');
  if (!input || input.disabled || input.hidden || input.dataset.noScrub !== undefined) return null;
  const r = input.getBoundingClientRect();
  return r.width > 0 && r.width >= r.height ? input : null;
}

function end(commit: boolean): void {
  const p = press;
  press = null;
  window.removeEventListener('pointermove', onMove, true);
  window.removeEventListener('pointerup', onUp, true);
  window.removeEventListener('pointercancel', onCancel, true);
  if (!p?.active) return;
  bubbleRelease();
  if (commit) p.input.dispatchEvent(new Event('change', { bubbles: true }));
}

function onMove(e: PointerEvent): void {
  const p = press;
  if (!p || e.pointerId !== p.id) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  if (!p.active) {
    if (Math.abs(dy) > VERTICAL_GIVE_UP && Math.abs(dy) > Math.abs(dx)) return end(false);
    if (Math.abs(dx) < SLOP || Math.abs(dx) < HORIZONTAL * Math.abs(dy)) return;
    p.active = true;
    p.x0 = e.clientX;
    p.from = Number(p.input.value);
    p.last = p.input.value;
    bubbleHold(p.input);
  }
  e.preventDefault();
  const input = p.input;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const width = input.getBoundingClientRect().width || 1;
  // The input rounds to its step and holds to its travel.
  input.value = String(p.from + ((e.clientX - p.x0) / width) * (max - min));
  if (input.value !== p.last) {
    p.last = input.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function onUp(e: PointerEvent): void {
  if (press && e.pointerId === press.id) end(true);
}

function onCancel(e: PointerEvent): void {
  if (press && e.pointerId === press.id) end(true);
}

/** Wire every slider row on the page. Idempotent; call once per page. */
export function installSliderScrub(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (press) end(true);
      if (e.button !== 0 || !e.isPrimary) return;
      // The native slider itself took this press (a mouse on a desktop): leave it.
      if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;
      const input = rangeIn(e.target);
      if (!input) return;
      press = { id: e.pointerId, input, x: e.clientX, y: e.clientY, from: 0, x0: 0, active: false, last: '' };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
    },
    true,
  );
}
