/**
 * The amount a slider holds, as a number the stylesheet can paint: every
 * range input carries `--fill`, its position along its travel as a
 * percentage, and a field's orange bar under the label is that wide
 * (docs/ui-foundations.md, "Field"). Kept current from one place so that no
 * builder has to remember it: a drag or a key (the `input` event), a value
 * set from code (a hotkey, an undo), and a travel that changes (min, max).
 */

function paint(input: HTMLInputElement): void {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const span = max - min;
  const at = span > 0 ? ((Number(input.value) - min) / span) * 100 : 0;
  input.style.setProperty('--fill', `${Math.min(100, Math.max(0, at))}%`);
}

let installed = false;

/** Start keeping every range input's `--fill` current. Safe to call more than once. */
export function installRangeFill(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener(
    'input',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === 'range') paint(t);
    },
    true,
  );

  // A value set from code fires no event: wrap the setters.
  const proto = HTMLInputElement.prototype;
  for (const name of ['value', 'valueAsNumber'] as const) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc?.set || !desc.get) continue;
    const { get, set } = desc;
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: desc.enumerable,
      get(this: HTMLInputElement) {
        return get.call(this);
      },
      set(this: HTMLInputElement, v: never) {
        set.call(this, v);
        if (this.type === 'range') paint(this);
      },
    });
  }

  // A travel that changes (min, max, step) moves the same value along it.
  const sweep = (root: ParentNode): void => {
    root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(paint);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.target instanceof HTMLInputElement && r.target.type === 'range') paint(r.target);
      if (r.type === 'childList') {
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLInputElement && n.type === 'range') paint(n);
          else if (n instanceof HTMLElement) sweep(n);
        });
      }
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['min', 'max', 'step', 'value'],
  });
  sweep(document);
}
