/**
 * The name of an edge button (Solo, Negative, Undo, Redo), said the way the
 * tool bar's buttons say theirs: a small box beside it on hover, and, for a
 * finger or the Pencil, while the button is held for a moment. The box is
 * the tool bar's own (.bz-tip, shell.css); `.is-tip` shows it without a
 * hover. It goes soon after the press lets go.
 */

/** How long a press must last before it names the button. */
export const TIP_HOLD_MS = 450;
/** How long the name stays after the press lets go, so it can be read. */
export const TIP_LINGER_MS = 1200;

/** The box for a name and, if the button has one, its hotkey. */
export function tipBox(name: string, key?: string): HTMLSpanElement {
  const box = document.createElement('span');
  box.className = 'bz-tip';
  box.setAttribute('aria-hidden', 'true');
  const n = document.createElement('span');
  n.className = 'bz-tip__name';
  n.textContent = name;
  box.appendChild(n);
  if (key) {
    const k = document.createElement('kbd');
    k.className = 'bz-tip__key';
    k.textContent = key;
    box.appendChild(k);
  }
  return box;
}

/** Put a button's box in place, or replace it (a rebound key changes it). */
export function setTip(btn: HTMLElement, name: string, key?: string): void {
  btn.querySelector('.bz-tip')?.remove();
  btn.appendChild(tipBox(name, key));
}

/** A long press on the button shows its name, until a moment after the lift. */
export function nameOnLongPress(btn: HTMLElement): () => void {
  let hold = 0;
  let linger = 0;
  const clear = (): void => {
    window.clearTimeout(hold);
    hold = 0;
  };
  const down = (): void => {
    clear();
    window.clearTimeout(linger);
    hold = window.setTimeout(() => {
      hold = 0;
      btn.classList.add('is-tip');
    }, TIP_HOLD_MS);
  };
  const up = (): void => {
    clear();
    if (!btn.classList.contains('is-tip')) return;
    window.clearTimeout(linger);
    linger = window.setTimeout(() => btn.classList.remove('is-tip'), TIP_LINGER_MS);
  };
  // Capture phase: some buttons stop their own pointerdown.
  btn.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  return () => {
    clear();
    window.clearTimeout(linger);
    btn.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
  };
}
