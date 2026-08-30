// Shared DOM primitives used by the editor control panels.

/**
 * True when a key event belongs to text entry rather than to a hotkey: the
 * two window-level keydown handlers (the viewer's shortcuts and the sculpt
 * InputShell) both bail on this before claiming anything. Covers IME
 * composition and contenteditable as well as the form tags, so a hotkey
 * never eats a character mid-word.
 */
export function isTextEntryTarget(e: KeyboardEvent): boolean {
  if (e.isComposing) return true;
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return /^(INPUT|SELECT|TEXTAREA|OPTION)$/.test(el.tagName) || el.isContentEditable === true;
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
