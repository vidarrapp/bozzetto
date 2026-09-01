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
  const el = e.target as HTMLElement | null;
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
 * of acting as a hotkey. Tab is the only key the app binds that already
 * means something to the browser, so it may only be claimed when focus is
 * nowhere in particular (the body, or the non-focusable canvas) and the
 * user is going forward. Without this a keyboard user tabbing through the
 * panels gets stuck: there is no focus trap to escape and no focus ring to
 * show where they are.
 */
export function tabShouldMoveFocus(e: KeyboardEvent): boolean {
  if (e.shiftKey) return true;
  const a = document.activeElement;
  return !!a && a !== document.body && a !== document.documentElement && a.tagName !== 'CANVAS';
}

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
