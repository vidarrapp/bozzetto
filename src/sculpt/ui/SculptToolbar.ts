import Enums from '@sculpt-vendor/misc/Enums';
// Flaticon uicons: solid straight (fi-ss-*) for the brushes, thin straight
// (fi-ts-*) for the Negative mode button (review pick; the lighter face
// sets the modifier apart from the tools). Whole style sheets are imported
// for upgrade-proof font URLs; each font only downloads when one of its
// glyphs first renders (sculpt mode). Attribution lives in the README.
import '@flaticon/flaticon-uicons/css/solid/straight.css';
import '@flaticon/flaticon-uicons/css/thin/straight.css';
import type { InputShell } from '../bridge/InputShell';

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
 * Touch-first sculpt toolbar (early WS4 piece, pulled forward for iPad): a
 * bottom bar with the Negative button in the left corner, the digit brushes
 * centered and the hide-interface eye on the right, each showing its icon
 * with the hotkey digit as a corner badge. Most iPads have no keyboard, so
 * this is the native way to invert strokes and swap brushes; buttons and
 * hotkeys stay in sync.
 *
 * Negative is a toggle you can also hold. Holding it while you draw mirrors
 * alt, and it took an on-device input log to make it work: a STATIONARY
 * finger on a control makes iOS arm its callout/drag gesture at about
 * 450ms, at which point Safari cancels the touch and then ignores the
 * Pencil for the rest of the interaction. Suppressing that gesture is the
 * fix (see the touchstart handler and the CSS beside it); the toggle
 * remains the guaranteed path underneath, since a press decides on its own
 * and never needs a release to arrive. alt still flips relative to whatever
 * the button says, so keyboard users lose nothing either way.
 */
export class SculptToolbar {
  /** Toolbar transform toggle (mode.ts owns the gizmo). */
  onToggleTransform: (() => void) | null = null;
  private transformBtn!: HTMLButtonElement;

  setTransformActive(on: boolean): void {
    this.transformBtn.classList.toggle('sculpt-toolbar__btn--active', on);
  }
  private readonly root: HTMLDivElement;
  private readonly negativeBtn: HTMLButtonElement;
  private readonly brushBtns = new Map<number, HTMLButtonElement>();
  /** Set by mode.ts: a direct hide/show switch for the toolbar button. */
  onToggleChrome: (() => void) | null = null;
  private hideBtn!: HTMLButtonElement;
  /** Pointer currently holding Negative down, or -1. */
  private negHoldId = -1;
  /** Stroke count when the press landed: tells a hold-and-draw from a tap. */
  private negDownStrokes = 0;

  /**
   * The lift is watched on the WINDOW rather than the button, because once
   * the button stops capturing, the release can land anywhere - and on a
   * touch device it routinely does.
   *
   * Correctness does not DEPEND on this arriving, which is what kept the
   * button usable through three rounds of chasing the iOS gesture bug: a
   * press while carving is already on turns it OFF, so the button is a
   * toggle that cannot get stuck whatever happens to the release, and this
   * handler only adds the momentary behaviour on top.
   */
  private readonly onWindowPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.negHoldId) return;
    this.negHoldId = -1;
    // Drew while holding: that was a modifier press, so it ends with the
    // lift. Lifted without drawing: that was a tap, and a tap toggles on
    // and stays on.
    if (this.input.strokeCount() > this.negDownStrokes) this.setNegative(false);
  };

  private setNegative(on: boolean): void {
    this.input.setNegativeBase(on);
    this.refresh();
  }

  constructor(private readonly input: InputShell) {
    this.root = document.createElement('div');
    this.root.className = 'sculpt-toolbar';
    // With a transport bar present (?tl=...&sculpt=1), sit above it.
    if (document.querySelector('.transport')) this.root.classList.add('sculpt-toolbar--raised');

    // The two corner controls sit bare, without the group's panel behind
    // them (review call) - they are single icons, not a cluster.
    const left = document.createElement('div');
    left.className = 'sculpt-toolbar__corner sculpt-toolbar__left';
    // Carve, two ways, because on iPadOS only one of them can be relied
    // on. TAP toggles carving on and leaves it on; tap again to turn it
    // off. HOLD while you draw is momentary, like holding alt - it works
    // when the browser reports the lift, and when it does not, the state
    // simply stays on and the next tap clears it.
    this.negativeBtn = toolButton(
      '',
      'Carve (negative): tap to keep it on, or hold while you draw',
      'negative',
      'fi-ts-reflect-vertical',
    );
    // No setPointerCapture: capturing a touch pointer and then putting a
    // second one down makes Safari cancel the captured one.
    this.negativeBtn.addEventListener('pointerdown', (e) => {
      if (this.input.getNegativeBase()) {
        // Already carving, from a tap or from a hold whose lift went
        // missing: this press turns it off. That is what stops the button
        // ever getting stuck, whatever the browser does with the release.
        this.negHoldId = -1;
        this.setNegative(false);
        return;
      }
      this.negHoldId = e.pointerId;
      this.negDownStrokes = this.input.strokeCount();
      this.setNegative(true);
    });
    this.negativeBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    // The belt to the CSS braces. On iOS a stationary press starts a
    // callout/drag gesture at ~450ms and Safari cancels the touch - then
    // ignores the Pencil for the rest of the interaction, which is exactly
    // what made hold-to-carve impossible. Cancelling the default on
    // touchstart is what actually stops that gesture from ever arming.
    // Safe here because this button is driven by pointerdown, not click.
    this.negativeBtn.addEventListener(
      'touchstart',
      (e) => e.preventDefault(),
      { passive: false },
    );
    left.appendChild(this.negativeBtn);

    // The pointer route into the clean screen, and back out of it: Tab is
    // the keyboard/TourBox way, but the primary device is an iPad with no
    // Tab key at all. Parked in the opposite corner from Negative so a
    // resting left hand cannot brush it.
    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'sculpt-toolbar__btn';
    hideBtn.title = 'Hide the interface (Tab)';
    hideBtn.setAttribute('aria-label', 'Hide the interface');
    hideBtn.innerHTML =
      '<span class="sculpt-toolbar__svg" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M3 3l18 18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.3 3.9M6.5 8.1A17 17 0 0 0 2.5 12s3.5 6 9.5 6a9.4 9.4 0 0 0 3.6-.7" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg></span>';
    // The button is a plain switch, unlike Tab, which first tidies open
    // panels. Assigned by mode.ts; read at click time so ordering is free.
    hideBtn.addEventListener('click', () => this.onToggleChrome?.());
    this.hideBtn = hideBtn;
    const right = document.createElement('div');
    right.className = 'sculpt-toolbar__corner sculpt-toolbar__right';
    right.appendChild(hideBtn);

    const center = document.createElement('div');
    center.className = 'sculpt-toolbar__group sculpt-toolbar__brushes';
    const tools = Enums.Tools;
    // Icon picks are Vidar's where the pack ships them in solid straight;
    // the rest are the closest fi-ss matches (see the WS2b results note).
    // The slot name (column 4) doubles as the inline-SVG override filename.
    const brushes: Array<[number, string, string, string, string]> = [
      [tools.CREASE, '1', 'Crease', 'crease', 'fi-ss-scalpel'],
      [tools.MOVE, '2', 'Move', 'move', 'fi-ss-arrows'],
      [tools.BRUSH, '3', 'Standard (clay)', 'standard', 'fi-ss-screwdriver'],
      [tools.INFLATE, '4', 'Inflate', 'inflate', 'fi-ss-paintbrush-pencil'],
      [tools.PINCH, '5', 'Pinch', 'pinch', 'fi-ss-compress'],
      [tools.FLATTEN, '6', 'Flatten', 'flatten', 'fi-ss-arrows-to-line'],
      [tools.SMOOTH, '7', 'Smooth', 'smooth', 'fi-ss-shredder'],
      [tools.DRAG, '8', 'Drag', 'drag', 'fi-ss-hand-back-fist'],
      [tools.TWIST, '9', 'Twist', 'twist', 'fi-ss-pen-swirl'],
      // Paint takes the tenth slot; the digit row was full at 1-9, and 0
      // sits next to 9 on every keyboard.
      [tools.PAINT, '0', 'Paint (alt: pick colour)', 'paint', 'fi-ss-palette'],
    ];
    for (const [id, key, name, slot, icon] of brushes) {
      const btn = toolButton(key, name, slot, icon);
      btn.addEventListener('click', () => this.input.selectBrush(id));
      this.brushBtns.set(id, btn);
      center.appendChild(btn);
    }

    // Transform is not a brush: it has letter keys (e/r/t, q leaves) and a
    // gizmo instead of strokes, so it keeps its own button and active state
    // rather than a digit slot.
    this.transformBtn = toolButton('', 'Transform (e/r/t modes, q exits)', 'transform', 'fi-ss-transformation-block');
    this.transformBtn.addEventListener('click', () => this.onToggleTransform?.());
    center.appendChild(this.transformBtn);

    this.root.append(left, center, right);
    document.body.appendChild(this.root);

    window.addEventListener('pointerup', this.onWindowPointerUp, true);
    this.input.onToolChange = () => this.refresh();
    this.refresh();
  }

  /** The hide button stays on screen while hidden, so it shows its state. */
  setChromeHidden(hidden: boolean): void {
    this.hideBtn.classList.toggle('sculpt-toolbar__btn--active', hidden);
    const label = hidden ? 'Show the interface (Tab)' : 'Hide the interface (Tab)';
    this.hideBtn.title = label;
    this.hideBtn.setAttribute('aria-label', hidden ? 'Show the interface' : 'Hide the interface');
  }

  /** Reflect the active brush and the negative base on the buttons. */
  private refresh(): void {
    const active = this.input.currentToolIndex();
    for (const [id, btn] of this.brushBtns) {
      btn.classList.toggle('sculpt-toolbar__btn--active', id === active);
    }
    this.negativeBtn.classList.toggle(
      'sculpt-toolbar__btn--active',
      this.input.getNegativeBase(),
    );
  }

  dispose(): void {
    window.removeEventListener('pointerup', this.onWindowPointerUp, true);
    this.input.onToolChange = null;
    this.root.remove();
  }
}

function toolButton(key: string, title: string, slot: string, icon: string): HTMLButtonElement {
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
  btn.title = title;
  btn.setAttribute('aria-label', title);
  return btn;
}
