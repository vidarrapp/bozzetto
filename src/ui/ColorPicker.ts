import { div, isTextField } from './dom';
import { setSliderValue, typedSlider, type Limits } from './sliderEntry';
import { isHexColor } from '../viewer/color';

/**
 * HSV colour picker: a swatch that opens a popover holding a
 * saturation/value spectrum with a hue strip beside it, plus numeric S and
 * V sliders. The hue strip alone sets the hue (owner call): the H row only
 * repeated it as a number, and its room went to a field twice the size.
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
  /** The colour the swatch shows, as `#rrggbb`. */
  value(): string;
  /** Whether the popover is up (hosts skip echo set()s while it is). */
  isOpen(): boolean;
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

/** S and V are percentages: a typed value is held to 0..100, in whole steps. */
const PERCENT: Limits = { min: 0, max: 100, integer: true };

/**
 * A labelled slider row inside the picker (S and V, 0..100), taking typed
 * values like every other slider (sliderEntry): a double-click or a
 * double-tap turns it into a number field. A <label>, as the panels' rows
 * are, so the field is named for the row it stands in.
 */
function hsvRow(
  label: string,
  name: string,
  value: number,
  onInput: (v: number) => void,
): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('label');
  row.className = 'cpick__row';
  const caption = document.createElement('span');
  caption.className = 'cpick__label';
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.value = String(Math.round(value));
  input.setAttribute('aria-label', name);
  const out = document.createElement('span');
  out.className = 'cpick__value';
  input.addEventListener('input', () => onInput(Number(input.value)));
  row.append(caption, input, out);
  typedSlider(
    input,
    {
      apply: onInput,
      limits: PERCENT,
      readout: (v) => {
        out.textContent = String(Math.round(v));
      },
    },
    Math.round(value),
  );
  return { row, input };
}

export function colorPicker(
  initial: string,
  onChange: (hex: string) => void,
): ColorPickerHandle {
  let hsv = hexToHsv(isHexColor(initial) ? initial : '#000000');
  /** The colour as last set or picked: what value() answers, exactly as it came. */
  let current = isHexColor(initial) ? initial.toLowerCase() : hsvToHex(hsv);

  const root = div('cpick');
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'cpick__swatch';
  // `#rrggbb` and nothing else reaches the style. The values come from
  // looks and files, and `background` takes url(): a colour that was an
  // address had every browser that drew the swatch fetch it.
  const paintSwatch = (hex: string): void => {
    if (isHexColor(hex)) swatch.style.background = hex;
  };
  paintSwatch(initial);
  swatch.setAttribute('aria-label', 'Choose a colour');
  root.appendChild(swatch);

  // The popover lives on the BODY: inside the panel it was clipped by the
  // scrolling body and trapped under the backdrop-filter stacking context,
  // painting behind later rows - and taps meant for its sliders hit
  // whatever covered it, which the outside-press dismiss then treated as
  // "outside" and closed the picker mid-reach (owner report).
  const pop = div('cpick__pop');
  pop.hidden = true;
  document.body.appendChild(pop);

  /** Fixed-position the popover beside the swatch's PANEL, over the view,
   * rather than across the rows around the swatch: left of a panel on the
   * right edge, right of one docked on the left (the Model panel's albedo).
   * At twice its old size it would otherwise cover the captions of every
   * row beside it. Where that side has no room (a phone) it opens on the
   * other side of the swatch, clamped on-screen, and vertically it starts
   * level with the swatch. */
  const place = (): void => {
    const r = swatch.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const panel = swatch.closest('.panel');
    const p = panel?.getBoundingClientRect() ?? r;
    const onLeftEdge = !!swatch.closest('.panel--left');
    const beside = onLeftEdge ? p.right + 8 : p.left - w - 8;
    const fits = beside >= 8 && beside + w <= window.innerWidth - 8;
    const left = fits
      ? beside
      : Math.max(8, Math.min(window.innerWidth - w - 8, onLeftEdge ? r.right + 8 : r.left - w - 8));
    const top = Math.min(window.innerHeight - h - 8, Math.max(8, r.top - 4));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  };

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
    current = hex;
    paintSwatch(hex);
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

  const sRow = hsvRow('S', 'Saturation', hsv.s * 100, (v) => {
    hsv.s = v / 100;
    paint();
    emit();
  });
  const vRow = hsvRow('V', 'Value', hsv.v * 100, (v) => {
    hsv.v = v / 100;
    paint();
    emit();
  });
  rows.append(sRow.row, vRow.row);

  // Through the typed-value entry, so a value typed earlier does not
  // linger in the row's readout once the field or the strip moves it.
  const syncRows = (): void => {
    setSliderValue(sRow.input, Math.round(hsv.s * 100));
    setSliderValue(vRow.input, Math.round(hsv.v * 100));
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
    if (pop.hidden) return;
    // The swatch's own row can be rebuilt (or its panel closed) under an
    // open popover; a floating picker with no anchor left is stale.
    if (!swatch.isConnected) return close();
    const t = e.target as Node;
    // Open until the tile is pressed again or the press is outside the
    // picker window (owner contract); everything inside it - sliders,
    // spectrum, hue bar - never dismisses.
    if (!pop.contains(t) && !root.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    // Esc in a row's number field is the field's own: it puts the value
    // back. Closing the picker under it would blur the field, which
    // applies what was typed instead.
    if (isTextField(e.target)) return;
    if (e.key === 'Escape' && !pop.hidden) {
      close();
      e.stopPropagation();
    }
  };
  swatch.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) {
      paint();
      place(); // measured after unhiding, so the size is real
    }
  });
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);

  paint();

  return {
    root,
    set(hex: string): void {
      if (!isHexColor(hex)) return;
      hsv = hexToHsv(hex);
      current = hex.toLowerCase();
      paintSwatch(hex);
      paint();
      syncRows();
    },
    value(): string {
      return current;
    },
    isOpen(): boolean {
      return !pop.hidden;
    },
    close,
    dispose(): void {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      pop.remove(); // body-mounted: removing the root no longer takes it
      root.remove();
    },
  };
}
