import Enums from '@sculpt-vendor/misc/Enums';
// Flaticon uicons, solid straight (fi-ss-*), for the brushes and for the
// Negative button (circle-half-stroke: one style for every icon, owner
// call). Whole style sheets are imported
// for upgrade-proof font URLs; each font only downloads when one of its
// glyphs first renders (sculpt mode). Attribution lives in the README.
import '../../ui/icons';
import type { InputShell } from '../bridge/InputShell';
import { liftedOn, onTap, TAP_CLICK_MS } from '../../ui/dom';

// Inline-SVG overrides: an ./icons/<slot>.svg (slots below, e.g. flatten.svg
// or negative.svg) replaces that button's font glyph at build time. This is
// the route for icons the npm uicons release does not ship; see icons/README.
const svgIcons = import.meta.glob('./icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function svgFor(slot: string): string | null {
  return svgIcons[`./icons/${slot}.svg`] ?? null;
}

/**
 * How long a press on Negative lasts before it latches carving instead of
 * arming one stroke: well past the slowest deliberate tap, and still quick
 * to reach on purpose.
 */
const LATCH_MS = 600;

/**
 * When an input event happened, by the platform's own clock, so a press
 * lasts as long as it was held however late a busy page got to its
 * events. A browser that leaves the stamp out is read at arrival instead.
 */
function eventTime(e: Event): number {
  return e.timeStamp > 0 ? e.timeStamp : performance.now();
}

/**
 * Palette-heading names per tool: the Sculpt panel's top section is named
 * for the ACTIVE brush ("Polish", not "Brush"), so it is clear whose
 * settings the sliders drive. Kept beside the toolbar's own tuple list -
 * whose labels double as tooltips and carry hints ("alt: pick colour")
 * that a heading should not.
 */
export const TOOL_NAMES: Record<number, string> = {
  [Enums.Tools.CREASE]: 'Crease',
  [Enums.Tools.MOVE]: 'Move',
  [Enums.Tools.BRUSH]: 'Standard clay',
  [Enums.Tools.INFLATE]: 'Inflate',
  [Enums.Tools.PINCH]: 'Pinch',
  [Enums.Tools.FLATTEN]: 'Flatten',
  [Enums.Tools.SMOOTH]: 'Smooth',
  [Enums.Tools.RAKE]: 'Rake',
  [Enums.Tools.PAINT_BLUR]: 'Paint blur',
  [Enums.Tools.DRAG]: 'Drag',
  [Enums.Tools.TWIST]: 'Polish',
  [Enums.Tools.PAINT]: 'Paint',
  [Enums.Tools.MASKING]: 'Mask',
};

/**
 * The tool bar: the Select tool, the digit brushes and Transform in one
 * box at the bottom centre, each showing its icon with its hotkey digit
 * as a corner badge (View > Hotkeys on tools shows or hides the digits)
 * and its name, with the hotkey, in a tooltip above it. Most iPads have
 * no keyboard, so this is the native way to swap brushes; buttons and
 * hotkeys stay in sync.
 *
 * Negative is built here, because its press logic is, but it stands in
 * the edge controls (BrushSliders takes `negativeEl`). It carves two
 * ways, and neither keeps a finger on the glass while the Pencil draws: on
 * an iPad a fingertip anywhere in the page hides the Pencil from it until
 * the finger lifts, below anything a web page can reach (plan 6.6e), so
 * hold-to-carve cannot be offered there at all. A TAP arms carving for the
 * next stroke, which spends it; a LONG PRESS latches carving on until a
 * tap lets go. Alt does the opposite of whatever the button says, so
 * keyboard users lose nothing either way.
 */
export class SculptToolbar {
  /** Toolbar transform toggle (mode.ts owns the gizmo). */
  onToggleTransform: (() => void) | null = null;
  private transformBtn!: HTMLButtonElement;
  /** Toolbar select toggle (the shell owns the mode). */
  onToggleSelect: (() => void) | null = null;
  private selectBtn!: HTMLButtonElement;
  private selectOn = false;

  setTransformActive(on: boolean): void {
    this.transformBtn.classList.toggle('sculpt-toolbar__btn--active', on);
    this.keepInView();
  }

  setSelectActive(on: boolean): void {
    this.selectOn = on;
    this.selectBtn.classList.toggle('sculpt-toolbar__btn--active', on);
    this.refresh();
  }
  private readonly root: HTMLDivElement;
  private readonly negativeBtn: HTMLButtonElement;
  private readonly brushBtns = new Map<number, HTMLButtonElement>();
  /** The Negative button, for the edge controls to stand. */
  get negativeEl(): HTMLButtonElement {
    return this.negativeBtn;
  }
  /**
   * The press on Negative, from its pointerdown to its lift: its pointer,
   * when it went down by the event's clock, and, once the timer has
   * latched, what the button said before, for a lift that turns out to
   * have come in time.
   */
  private negPress: {
    pointerId: number;
    downAt: number;
    before: { latched: boolean; armed: boolean } | null;
  } | null = null;
  private negTimer = 0;
  /** When the last press on Negative ended; a mouse's click right after it is that press's own. */
  private negPressEndedAt = -Infinity;

  /**
   * The timer is ours, not the OS's: the press starts it, and running out
   * with the press still down is the long press, which latches there and
   * then, under the finger. A lift before LATCH_MS is a tap; the lift's
   * own timestamp says which it was (see onNegativeUp). No
   * setPointerCapture: capturing a touch pointer and then putting a second
   * one down makes Safari cancel the captured one.
   */
  private readonly onNegativeDown = (e: PointerEvent): void => {
    // The press onTap counts: the primary button only, and no focus left
    // on the button for Tab or Space to land on.
    if (e.button !== 0) return;
    e.preventDefault();
    clearTimeout(this.negTimer);
    this.negPress = { pointerId: e.pointerId, downAt: eventTime(e), before: null };
    this.negTimer = window.setTimeout(this.onNegativeHeld, LATCH_MS);
  };

  /** Still down when the timer ran out: the long press shows, and latches. */
  private readonly onNegativeHeld = (): void => {
    this.negTimer = 0;
    const press = this.negPress;
    if (!press) return;
    press.before = { latched: this.input.getNegativeBase(), armed: this.input.getNegativeArmed() };
    this.latchNegative();
  };

  /**
   * The lift is watched on the WINDOW, because a mouse released off the
   * button never tells the button, and the timer must stop all the same.
   */
  private readonly onNegativeUp = (e: PointerEvent): void => {
    const press = this.negPress;
    if (!press || e.pointerId !== press.pointerId) return;
    this.endNegativePress();
    // The events' own times decide; the timer only shows a long press while
    // it is held. A main thread busy past LATCH_MS (a heavy frame, an
    // autosave) gets to the lift after the timer has run, and a tap must
    // not latch for that, nor a long press arm.
    if (eventTime(e) - press.downAt >= LATCH_MS) {
      if (!press.before) this.latchNegative();
      return; // a long press: its lift changes nothing
    }
    if (press.before) {
      // The timer ran first on a busy page; this was a tap all along.
      this.input.setNegativeBase(press.before.latched);
      this.input.setNegativeArmed(press.before.armed);
    }
    // A tap, unless the pointer slid off the button before lifting, which
    // is a change of mind here as it is for onTap. A cancel counts as the
    // tap (owner call): the press was made, and the OS ending it early
    // does not make it a long one.
    if (e.type === 'pointerup' && !liftedOn(this.negativeBtn, e)) {
      this.refresh();
      return;
    }
    this.tapNegative();
  };

  /** The window lost focus mid-press: neither a tap nor a long press. */
  private readonly onNegativeBlur = (): void => {
    if (this.negPress) this.endNegativePress();
  };

  private endNegativePress(): void {
    clearTimeout(this.negTimer);
    this.negTimer = 0;
    this.negPress = null;
    this.negPressEndedAt = performance.now();
  }

  /** A long press: carving latched on, for every stroke until a tap. */
  private latchNegative(): void {
    // The arm and the latch each turn a stroke over, so an arm left set
    // would make the first latched stroke raise instead of carve.
    this.input.setNegativeArmed(false);
    this.input.setNegativeBase(true);
    this.refresh();
  }

  /** A tap lets go of the latch, or else arms the next stroke or disarms it. */
  private tapNegative(): void {
    if (this.input.getNegativeBase()) {
      this.input.setNegativeBase(false);
      this.input.setNegativeArmed(false);
    } else {
      this.input.setNegativeArmed(!this.input.getNegativeArmed());
    }
    this.refresh();
  }

  constructor(private readonly input: InputShell) {
    this.root = document.createElement('div');
    this.root.className = 'sculpt-toolbar';
    // With a transport bar present (?tl=...&sculpt=1), sit above it.
    if (document.querySelector('.transport')) this.root.classList.add('sculpt-toolbar--raised');

    // Carve: a tap for the next stroke, a long press for every stroke
    // until a tap (see the class comment for why there is no hold).
    this.negativeBtn = toolButton(
      '',
      'Carve (negative): tap to carve the next stroke, long-press to keep carving until a tap. Alt + drag does the opposite of the button',
      'negative',
      'fi-ss-circle-half-stroke',
    );
    this.negativeBtn.addEventListener('pointerdown', this.onNegativeDown);
    // The keyboard's and assistive tech's press, as for onTap. A pointer's
    // own click lands just after its press ended, which already acted as a
    // tap or a long press (or, slid off, chose not to).
    this.negativeBtn.addEventListener('click', (e) => {
      if (e.detail > 0 && performance.now() - this.negPressEndedAt < TAP_CLICK_MS) return;
      this.tapNegative();
    });
    this.negativeBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    // The belt to the CSS braces. On iOS a stationary press starts a
    // callout/drag gesture at ~450ms and Safari cancels the touch, before
    // the long press at LATCH_MS could ever run out: every press would end
    // as a tap. Cancelling the default on touchstart is what actually stops
    // that gesture from arming. It also stops the click a touch would
    // synthesise, which this button does not need: its pointer events
    // drive it, and the click is left to the keyboard.
    this.negativeBtn.addEventListener(
      'touchstart',
      (e) => e.preventDefault(),
      { passive: false },
    );

    const center = document.createElement('div');
    center.className = 'sculpt-toolbar__group sculpt-toolbar__brushes';
    const tools = Enums.Tools;
    // Icon picks are Vidar's where the pack ships them in solid straight;
    // the rest are the closest fi-ss matches (see the WS2b results note).
    // The slot name (column 4) doubles as the inline-SVG override filename.
    const brushes: Array<[number, string, string, string, string, string]> = [
      [tools.CREASE, '1', 'Crease', 'crease', 'fi-ss-scalpel', 'Crease'],
      [tools.MOVE, '2', 'Move', 'move', 'fi-ss-arrows', 'Move'],
      [tools.BRUSH, '3', 'Standard (clay)', 'standard', 'fi-ss-screwdriver', 'Standard clay'],
      [tools.INFLATE, '4', 'Inflate', 'inflate', 'fi-ss-expand-arrows-alt', 'Inflate'],
      [tools.PINCH, '5', 'Pinch', 'pinch', 'fi-ss-compress', 'Pinch'],
      [tools.FLATTEN, '6', 'Flatten', 'flatten', 'fi-ss-arrows-to-line', 'Flatten'],
      // Smooth lost the digit to the Rake (owner call) but not the tool:
      // holding shift still smooths, from any brush.
      [tools.RAKE, '7', 'Rake (shift still smooths)', 'smooth', 'fi-ss-shredder', 'Rake'],
      [tools.DRAG, '8', 'Drag', 'drag', 'fi-ss-hand-back-fist', 'Drag'],
      [tools.TWIST, '9', 'Polish', 'polish', 'fi-ss-broom', 'Polish'],
      // Paint takes the tenth slot; the digit row was full at 1-9, and 0
      // sits next to 9 on every keyboard.
      [tools.PAINT, '0', 'Paint (alt: pick colour)', 'paint', 'fi-ss-palette', 'Paint'],
    ];
    // Select at the far left, Transform at the far right (owner call): the
    // two tools that are not brushes bracket the row.
    this.selectBtn = toolButton('q', 'Select (q): click, shift adds, ctrl+drag removes, drag a marquee', 'select', 'fi-ss-cursor', 'Select');
    onTap(this.selectBtn, () => this.onToggleSelect?.());
    center.appendChild(this.selectBtn);
    for (const [id, key, name, slot, icon, tip] of brushes) {
      const btn = toolButton(key, name, slot, icon, tip);
      onTap(btn, () => this.input.selectBrush(id));
      this.brushBtns.set(id, btn);
      center.appendChild(btn);
    }

    // Transform is not a brush: it has letter keys (t, and w/e/r for one
    // kind of handle) and a gizmo instead of strokes, so it keeps its own
    // button and active state rather than a digit slot. Its key shows as a
    // badge like every other tool's (owner request).
    this.transformBtn = toolButton('t', 'Transform (t): move, rotate and scale; w/e/r show one kind', 'transform', 'fi-ss-transformation-block', 'Transform');
    onTap(this.transformBtn, () => this.onToggleTransform?.());
    center.appendChild(this.transformBtn);

    this.root.append(center);
    document.body.appendChild(this.root);

    window.addEventListener('pointerup', this.onNegativeUp, true);
    window.addEventListener('pointercancel', this.onNegativeUp, true);
    window.addEventListener('blur', this.onNegativeBlur);
    this.input.onToolChange = () => this.refresh();
    // The arm clears when its stroke ends, which the shell sees first.
    this.input.onNegativeChange = () => this.refresh();
    this.refresh();
  }

  /** Reflect the active brush, and Negative's arm or latch, on the buttons. */
  private refresh(): void {
    const active = this.input.currentToolIndex();
    for (const [id, btn] of this.brushBtns) {
      // With the Select tool up no brush is the active one, whatever the
      // vendor's current tool index still says.
      btn.classList.toggle('sculpt-toolbar__btn--active', id === active && !this.selectOn);
    }
    // Latched fills the button like any active tool; armed is the lighter
    // look, since it lasts one stroke.
    const latched = this.input.getNegativeBase();
    this.negativeBtn.classList.toggle('sculpt-toolbar__btn--active', latched);
    this.negativeBtn.classList.toggle('sculpt-toolbar__btn--armed', !latched && this.input.getNegativeArmed());
    this.keepInView();
  }

  /** Where the bar scrolls sideways (a phone), the tool in hand is brought to its middle. */
  private keepInView(): void {
    const bar = this.root.querySelector<HTMLElement>('.sculpt-toolbar__brushes');
    const on = bar?.querySelector<HTMLElement>('.sculpt-toolbar__btn--active');
    if (!bar || !on || bar.scrollWidth <= bar.clientWidth) return;
    const b = bar.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    bar.scrollLeft += r.left + r.width / 2 - (b.left + b.width / 2);
  }

  dispose(): void {
    clearTimeout(this.negTimer);
    window.removeEventListener('pointerup', this.onNegativeUp, true);
    window.removeEventListener('pointercancel', this.onNegativeUp, true);
    window.removeEventListener('blur', this.onNegativeBlur);
    this.input.onToolChange = null;
    this.input.onNegativeChange = null;
    this.root.remove();
  }
}

function toolButton(key: string, title: string, slot: string, icon: string, tip?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sculpt-toolbar__btn';
  const svg = svgFor(slot);
  if (svg) {
    // Inline SVG from the repo (trusted content); CSS recolors it via
    // currentColor and sizes it like the font glyphs.
    const holder = document.createElement('span');
    holder.className = 'sculpt-toolbar__svg';
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = svg;
    btn.appendChild(holder);
  } else {
    const glyph = document.createElement('i');
    glyph.className = `fi ${icon}`;
    glyph.setAttribute('aria-hidden', 'true');
    btn.appendChild(glyph);
  }
  if (key) {
    // The hotkey digit stays visible as a corner badge (and as the button
    // text the headless suite matches on).
    const badge = document.createElement('span');
    badge.className = 'sculpt-toolbar__key';
    badge.textContent = key;
    btn.appendChild(badge);
  }
  btn.setAttribute('aria-label', title);
  if (tip) {
    // A tool is named by a box above it (shell.css), not the browser's
    // title: its name, and its hotkey in the mono face.
    const box = document.createElement('span');
    box.className = 'bz-tip';
    box.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'bz-tip__name';
    name.textContent = tip;
    box.appendChild(name);
    if (key) {
      const k = document.createElement('kbd');
      k.className = 'bz-tip__key';
      k.textContent = key;
      box.appendChild(k);
    }
    btn.appendChild(box);
  } else {
    btn.title = title;
  }
  return btn;
}
