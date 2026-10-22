// Shared DOM primitives used by the editor control panels.

/**
 * True when a key event belongs to TYPING: a text-entry input, a textarea,
 * contenteditable, or mid-IME-composition. Both window-level keydown
 * handlers (the viewer's shortcuts and the sculpt InputShell) bail on this
 * unconditionally, so a hotkey never eats a character mid-word. Checkboxes,
 * sliders and selects are deliberately NOT typing - see
 * isFormControlTarget, which used to be folded in here: that made a single
 * click on a panel checkbox kill every hotkey (undo included) until focus
 * happened to move somewhere else.
 */
export function isTextEntryTarget(e: KeyboardEvent): boolean {
  if (e.isComposing) return true;
  return isTextField(e.target as Element | null);
}

/**
 * A field you type into: a text-like input, a textarea or contenteditable.
 * On a tablet it is also what brings up the on-screen keyboard, and with
 * it the dictation key.
 */
export function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable === true) return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !/^(checkbox|radio|range|button|submit|reset|color|file)$/.test(type);
}

/**
 * True when focus sits on a non-typing form control - a checkbox, slider or
 * select - whose PLAIN keys mean something to the control itself (space
 * toggles, arrows slide and pick). The viewer's shortcuts, all plain keys,
 * stand down entirely; the sculpt InputShell stands down for plain keys but
 * keeps modifier chords, because ctrl+z aimed at a checkbox isn't a thing
 * and losing undo to a focused checkbox reads as breakage.
 */
export function isFormControlTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return /^(INPUT|SELECT|OPTION)$/.test(el.tagName);
}

/**
 * True when a Tab press should do its normal job - moving focus - instead
 * of acting as the chrome toggle (owner call). Shift+Tab always moves
 * focus, so keyboard traversal keeps a way through the panels. Plain Tab
 * keeps its browser meaning only where focus is in something Tab belongs
 * to: a field you type into (a text input, a textarea, contenteditable), a
 * select, or anything inside a modal dialog. A button, checkbox, slider or
 * list row that merely kept focus after a click does not hold on to Tab:
 * it used to, so after Create in the Scene panel (the clicked button keeps
 * focus) Tab walked the buttons instead of closing the panels.
 */
export function tabShouldMoveFocus(e: KeyboardEvent): boolean {
  if (e.shiftKey) return true;
  if (document.body.classList.contains('has-modal')) return true;
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body || a === document.documentElement) return false;
  if (isTextField(a) || a.tagName === 'SELECT') return true;
  return !!a.closest('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]');
}

/**
 * Before Tab acts on the chrome: drop focus from whatever control kept it
 * (a clicked button), so the next Tab finds focus nowhere in particular
 * and means the same thing again, and no hidden control holds the focus
 * ring while the interface is away.
 */
export function releaseFocusForChrome(): void {
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && a !== document.documentElement && typeof a.blur === 'function') a.blur();
}

/**
 * A button that acts on a tap, for the ones a hand rests on or lingers
 * over (the sculpt toolbar, the docked panels' edge tabs). On iPadOS a
 * finger held still on a button arms the long press at about 450ms, and
 * Safari then cancels the touch (the Negative button's on-device log): a
 * slow tap never became a click, and the press could lift the button for
 * drag and drop. Cancelling the touchstart default stops that, and with
 * it the click a touch would synthesise, so the lift on the button is the
 * tap instead. The click still serves the keyboard and assistive tech,
 * and is skipped when it follows a lift that already acted.
 */
export function onTap(btn: HTMLElement, action: () => void): void {
  let pressed = -1;
  let actedAt = -Infinity;
  btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pressed = e.pointerId;
    // No focus left behind on the button for Tab or Space to land on.
    e.preventDefault();
  });
  btn.addEventListener('pointercancel', (e) => {
    if (e.pointerId === pressed) pressed = -1;
  });
  btn.addEventListener('pointerup', (e) => {
    if (e.pointerId !== pressed) return;
    pressed = -1;
    if (!liftedOn(btn, e)) return;
    actedAt = performance.now();
    action();
  });
  btn.addEventListener('click', (e) => {
    // A pointer's own click (detail counts its presses; a key's and a
    // script's click carry 0) after a lift that already acted.
    if (e.detail > 0 && performance.now() - actedAt < TAP_CLICK_MS) return;
    action();
  });
}

/**
 * Whether a lift landed on the button it pressed. A touch stays with the
 * button it landed on; a finger slid off before lifting has changed its
 * mind, as it would on a native button.
 */
export function liftedOn(btn: HTMLElement, e: PointerEvent): boolean {
  const r = btn.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

/** A pointer click this soon after a lift that acted is that lift's own click. */
export const TAP_CLICK_MS = 500;

export function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

/** A `label.label-row`: a fixed-width caption beside a control. */
export function labelRow(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'label-row';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}

/** A `<select>` populated from `[value, label]` pairs, set to `value`. */
export function selectEl(
  options: readonly (readonly [string, string])[],
  value: string,
): HTMLSelectElement {
  const s = document.createElement('select');
  for (const [v, l] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    s.appendChild(o);
  }
  s.value = value;
  return s;
}
