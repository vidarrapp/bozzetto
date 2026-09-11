/**
 * The value under the thumb while a slider is dragged (owner rule: every
 * slider says what it is set to). One bubble for the page, positioned
 * beneath the thumb - beside it for a vertical rail - and gone on release.
 * Range inputs get it for free through document-level listeners; custom
 * sliders (the brush rail) call show/hide themselves.
 */

let bubble: HTMLDivElement | null = null;
let held: HTMLInputElement | null = null;
let hideTimer = 0;
const THUMB = 16; // the thumb's width, so the bubble tracks its centre

function el(): HTMLDivElement {
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'slider-bubble';
    bubble.hidden = true;
    bubble.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bubble);
  }
  return bubble;
}

/** Show `text` at a screen point: below it, or to its right. */
export function showSliderBubble(x: number, y: number, text: string, side: 'below' | 'right' = 'below'): void {
  const b = el();
  b.textContent = text;
  b.hidden = false;
  b.dataset.side = side;
  const w = b.offsetWidth;
  const h = b.offsetHeight;
  let left = side === 'below' ? x - w / 2 : x + 10;
  let top = side === 'below' ? y + 8 : y - h / 2;
  left = Math.min(window.innerWidth - w - 4, Math.max(4, left));
  top = Math.min(window.innerHeight - h - 4, Math.max(4, top));
  b.style.left = `${Math.round(left)}px`;
  b.style.top = `${Math.round(top)}px`;
}

export function hideSliderBubble(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }
  if (bubble) bubble.hidden = true;
}

/** The slider's value as text: the step's decimals, plus a data-unit suffix. */
export function rangeText(input: HTMLInputElement): string {
  const step = Number(input.step) || 1;
  const decimals = step >= 1 ? 0 : Math.min(4, (String(step).split('.')[1] ?? '').length);
  const v = Number(input.value);
  const scale = input.dataset.scale ? Number(input.dataset.scale) : 1;
  return (v * scale).toFixed(decimals) + (input.dataset.unit ?? '');
}

function isRange(t: EventTarget | null): t is HTMLInputElement {
  return t instanceof HTMLInputElement && t.type === 'range';
}

function showFor(input: HTMLInputElement): void {
  const r = input.getBoundingClientRect();
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const frac = max > min ? (Number(input.value) - min) / (max - min) : 0;
  if (r.height > r.width) {
    // A vertical range: the thumb rides from the bottom up.
    showSliderBubble(r.right, r.bottom - THUMB / 2 - frac * (r.height - THUMB), rangeText(input), 'right');
  } else {
    showSliderBubble(r.left + THUMB / 2 + frac * (r.width - THUMB), r.bottom, rangeText(input), 'below');
  }
}

let installed = false;

/** Wire the page's range inputs. Idempotent; call once per page. */
export function installSliderBubble(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!isRange(e.target)) return;
      held = e.target;
      showFor(held);
    },
    true,
  );
  document.addEventListener(
    'input',
    (e) => {
      if (!isRange(e.target)) return;
      showFor(e.target);
      // A keyboard nudge has no release to hide on: fade after a moment.
      if (held !== e.target) {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = window.setTimeout(hideSliderBubble, 900);
      }
    },
    true,
  );
  const release = (): void => {
    if (!held) return;
    held = null;
    hideSliderBubble();
  };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  document.addEventListener('focusout', (e) => {
    if (isRange(e.target)) hideSliderBubble();
  });
}
