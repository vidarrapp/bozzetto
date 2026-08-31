import { div } from './dom';

/**
 * HSV colour picker: a swatch that opens a popover holding a
 * saturation/value spectrum with a hue strip beside it, plus numeric H, S
 * and V sliders.
 *
 * HSV rather than RGB because picking a colour is a perceptual job - you
 * reach for "the same red but duller", which is one slider in HSV and three
 * in RGB. The same control serves the material albedo and the paint brush,
 * so the two never drift into different mental models.
 *
 * The spectrum is CSS gradients over a hue-coloured square, not a canvas:
 * it costs nothing to redraw when the hue moves, and stays crisp at any
 * device pixel ratio.
 */

export interface ColorPickerHandle {
  readonly root: HTMLElement;
  /** Set the colour from outside (a tool switch, an eyedropper pick). */
  set(hex: string): void;
  close(): void;
  dispose(): void;
}

type HSV = { h: number; s: number; v: number };

export function hexToHsv(hex: string): HSV {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number): string =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

/** A labelled slider row inside the picker (H 0..360, S and V 0..100). */
function hsvRow(
  label: string,
  max: number,
  value: number,
  onInput: (v: number) => void,
): { row: HTMLElement; input: HTMLInputElement } {
  const row = div('cpick__row');
  const name = document.createElement('span');
  name.className = 'cpick__label';
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = String(max);
  input.step = '1';
  input.value = String(Math.round(value));
  const out = document.createElement('span');
  out.className = 'cpick__value';
  out.textContent = input.value;
  input.addEventListener('input', () => {
    out.textContent = input.value;
    onInput(Number(input.value));
  });
  row.append(name, input, out);
  return { row, input };
}

export function colorPicker(
  initial: string,
  onChange: (hex: string) => void,
): ColorPickerHandle {
  let hsv = hexToHsv(initial);

  const root = div('cpick');
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'cpick__swatch';
  swatch.style.background = initial;
  swatch.setAttribute('aria-label', 'Choose a colour');
  root.appendChild(swatch);

  const pop = div('cpick__pop');
  pop.hidden = true;
  root.appendChild(pop);

  // --- spectrum: saturation across, value down, over the current hue ------
  const field = div('cpick__field');
  const fieldDot = div('cpick__dot');
  field.appendChild(fieldDot);
  const hueBar = div('cpick__hue');
  const hueDot = div('cpick__huedot');
  hueBar.appendChild(hueDot);
  const spectrum = div('cpick__spectrum');
  spectrum.append(field, hueBar);
  pop.appendChild(spectrum);

  const rows = div('cpick__rows');
  pop.appendChild(rows);

  const emit = (): void => {
    const hex = hsvToHex(hsv);
    swatch.style.background = hex;
    onChange(hex);
  };

  const paint = (): void => {
    field.style.background =
      `linear-gradient(to top, #000, transparent), ` +
      `linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})`;
    fieldDot.style.left = `${hsv.s * 100}%`;
    fieldDot.style.top = `${(1 - hsv.v) * 100}%`;
    hueDot.style.top = `${(hsv.h / 360) * 100}%`;
  };

  const hRow = hsvRow('H', 360, hsv.h, (v) => {
    hsv.h = v;
    paint();
    emit();
  });
  const sRow = hsvRow('S', 100, hsv.s * 100, (v) => {
    hsv.s = v / 100;
    paint();
    emit();
  });
  const vRow = hsvRow('V', 100, hsv.v * 100, (v) => {
    hsv.v = v / 100;
    paint();
    emit();
  });
  rows.append(hRow.row, sRow.row, vRow.row);

  const syncRows = (): void => {
    hRow.input.value = String(Math.round(hsv.h));
    sRow.input.value = String(Math.round(hsv.s * 100));
    vRow.input.value = String(Math.round(hsv.v * 100));
    for (const [i, o] of [
      [hRow.input, hsv.h],
      [sRow.input, hsv.s * 100],
      [vRow.input, hsv.v * 100],
    ] as const) {
      const out = i.nextElementSibling as HTMLElement | null;
      if (out) out.textContent = String(Math.round(o));
    }
  };

  // Dragging in the spectrum: pointer capture so the drag survives leaving
  // the box, which is how every colour field behaves.
  const dragField = (e: PointerEvent): void => {
    const r = field.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    hsv.v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    paint();
    syncRows();
    emit();
  };
  const dragHue = (e: PointerEvent): void => {
    const r = hueBar.getBoundingClientRect();
    hsv.h = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * 360;
    paint();
    syncRows();
    emit();
  };
  for (const [el, handler] of [
    [field, dragField],
    [hueBar, dragHue],
  ] as const) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      handler(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) handler(e);
    });
  }

  const close = (): void => {
    pop.hidden = true;
  };
  const onDocDown = (e: PointerEvent): void => {
    if (!pop.hidden && !root.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !pop.hidden) {
      close();
      e.stopPropagation();
    }
  };
  swatch.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) paint();
  });
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);

  paint();

  return {
    root,
    set(hex: string): void {
      hsv = hexToHsv(hex);
      swatch.style.background = hex;
      paint();
      syncRows();
    },
    close,
    dispose(): void {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      root.remove();
    },
  };
}
