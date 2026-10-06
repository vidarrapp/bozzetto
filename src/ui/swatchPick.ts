import type { ColorPickerHandle } from './ColorPicker';
import type { Viewer } from '../viewer/Viewer';
import { TAP_CLICK_MS } from './dom';

/**
 * The cursor while a swatch picks. An eyedropper is on its way from the
 * owner; until then the Pinch brush's icon (Flaticon uicons fi-ss-compress,
 * as on the sculpt toolbar) stands in, its four corners closing on the
 * pixel being read. Inlined as a path, so the viewer and the single-file
 * export need not load the icon font for one glyph. An `eyedropper.svg`
 * dropped into src/sculpt/ui/icons replaces it at build time, as the
 * toolbar's overrides do (see the README there).
 */
const dropped = import.meta.glob('../sculpt/ui/icons/eyedropper.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const PINCH_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="' +
  'M75 62Q75 68 71.5 71.5Q68 75 62 75H0V100H63Q78 100 89 89Q100 78 100 62V0H75Z' +
  'M200 237V300H225V237Q225 232 228.5 228.5Q232 225 237 225H300V200H238Q222 200 211 211Q200 222 200 237Z' +
  'M238 75Q232 75 228.5 71.5Q225 68 225 63V0H200V62Q200 78 211 89Q222 100 238 100H300V75Z' +
  'M63 200H0V225H63Q68 225 71.5 228.5Q75 232 75 238V300H100V237Q100 222 89 211Q78 200 63 200Z"/></svg>';

const PICK_ICON = Object.values(dropped)[0] ?? PINCH_ICON;

/** How far the pointer leaves the swatch before a press is a pick, not a tap. */
const DRAG_START_PX = 8;

interface Pick {
  /** The colour from before the drag: what a release off the view puts back. */
  before: string;
  /** The colour applied now. */
  shown: string;
  /** The frame the pick reads, once it is in (Viewer.frameSampler). */
  frame: Promise<(x: number, y: number) => string | null>;
  sample: ((x: number, y: number) => string | null) | null;
  /** Where the pointer is. */
  at: [number, number];
  cursor: HTMLElement;
}

/**
 * Drag a colour swatch out over the view and let go: the colour under the
 * pointer, read from the rendered frame (owner request; the paint brush's
 * swatch first, now the background's and each light's too, in Sculpt,
 * Armature, the viewer and the editors). The frame, not the model: a
 * background, an environment and one day a reference board are all fair
 * game. One implementation for every swatch that picks.
 *
 * A tap still opens the picker; the drag takes over once the pointer has
 * clearly left the swatch. From then on the colour under it is APPLIED as
 * it moves - the light or the backdrop changes under the pointer and the
 * swatch follows - read from one frame taken as the drag starts, since a
 * frame already showing the pick would hand the pick back. Off the view
 * (over a panel or the toolbar, or past the canvas) the colour from
 * before the drag is back, and a release there cancels. `apply` is the
 * setter the popover itself uses, so a picked colour goes through the
 * same normalisation (viewer/color.ts) as one chosen by hand.
 */
export function installSwatchPick(picker: ColorPickerHandle, viewer: Viewer, apply: (hex: string) => void): void {
  const swatch = picker.root.querySelector<HTMLElement>('.cpick__swatch');
  if (!swatch) return;
  const canvas = viewer.renderer.domElement;
  let press: { id: number; x: number; y: number } | null = null;
  let pick: Pick | null = null;
  let endedAt = -Infinity;

  /** Whether a point is on the view itself, not on something over it. */
  const onView = (x: number, y: number): boolean => {
    const host = canvas.parentElement ?? canvas;
    const top = document.elementFromPoint(x, y);
    return !!top && host.contains(top);
  };
  const show = (p: Pick, hex: string): void => {
    if (hex === p.shown) return;
    p.shown = hex;
    apply(hex);
    picker.set(hex);
  };
  const follow = (p: Pick): void => {
    const [x, y] = p.at;
    p.cursor.style.left = `${x}px`;
    p.cursor.style.top = `${y}px`;
    const inView = onView(x, y);
    // Dimmed where a release would cancel.
    p.cursor.classList.toggle('swatch-pick--off', !inView);
    if (p.sample) show(p, (inView && p.sample(x, y)) || p.before);
  };

  const begin = (x: number, y: number): Pick => {
    const cursor = document.createElement('div');
    cursor.className = 'swatch-pick';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = PICK_ICON; // the repo's own SVG, never a file's
    document.body.appendChild(cursor);
    document.body.classList.add('is-sampling');
    const before = picker.value();
    const p: Pick = { before, shown: before, frame: viewer.frameSampler(), sample: null, at: [x, y], cursor };
    void p.frame.then(
      (sample) => {
        if (pick !== p) return; // released first: end() reads the frame itself
        p.sample = sample;
        follow(p);
      },
      () => undefined, // no frame, no pick: the release puts the colour back
    );
    return p;
  };

  const end = (x: number, y: number, cancelled: boolean): void => {
    const p = pick;
    if (!p) return;
    pick = null;
    endedAt = performance.now();
    document.body.classList.remove('is-sampling');
    p.cursor.remove();
    const inView = !cancelled && onView(x, y);
    p.frame.then(
      (sample) => {
        const hex = inView ? sample(x, y) : null;
        show(p, hex ?? p.before);
        // A pick is an edit like a slider's: the looks' autosaves listen
        // for a change inside the panels.
        if (hex && hex !== p.before) swatch.dispatchEvent(new Event('change', { bubbles: true }));
      },
      () => show(p, p.before),
    );
  };

  swatch.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.isPrimary || pick) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    // Captured from the press: a mouse leaving a 22 px swatch quickly
    // would otherwise take its moves elsewhere before it had gone far
    // enough to count as a drag.
    swatch.setPointerCapture(e.pointerId);
  });
  swatch.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!pick) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_START_PX) return;
      pick = begin(e.clientX, e.clientY);
    }
    pick.at = [e.clientX, e.clientY];
    follow(pick);
  });
  const release = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    press = null;
    if (swatch.hasPointerCapture(e.pointerId)) swatch.releasePointerCapture(e.pointerId);
    end(e.clientX, e.clientY, e.type !== 'pointerup');
  };
  swatch.addEventListener('pointerup', release);
  swatch.addEventListener('pointercancel', release);
  // Capture lost without a release (the swatch's row rebuilt under the
  // drag): nothing was chosen, so nothing changes.
  swatch.addEventListener('lostpointercapture', release);
  // The click a mouse still sends after a release over the swatch would
  // open the popover: a pick is not a tap. Keys click with no detail.
  picker.root.addEventListener(
    'click',
    (e) => {
      if (e.detail > 0 && performance.now() - endedAt < TAP_CLICK_MS) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}
