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
 * bottom bar with a hold-to-carve Negative button pinned in the left corner
 * and the digit brushes centered, each showing its icon with the hotkey
 * digit as a corner badge. Most iPads have no keyboard, so this is the
 * native way to invert strokes and swap brushes; buttons and hotkeys stay
 * in sync.
 *
 * Negative is held, not toggled (per testing feedback): strokes invert while
 * the button is down, exactly like holding alt; alt itself still flips
 * relative to it, so keyboard users lose nothing.
 */
export class SculptToolbar {
  private readonly root: HTMLDivElement;
  private readonly negativeBtn: HTMLButtonElement;
  private readonly brushBtns = new Map<number, HTMLButtonElement>();
  /** Double-tap latch on Negative: carving stays on without holding. */
  private negSticky = false;
  private unlatchOnUp = false;
  private lastNegDown = 0;

  constructor(private readonly input: InputShell) {
    this.root = document.createElement('div');
    this.root.className = 'sculpt-toolbar';
    // With a transport bar present (?tl=...&sculpt=1), sit above it.
    if (document.querySelector('.transport')) this.root.classList.add('sculpt-toolbar--raised');

    const left = document.createElement('div');
    left.className = 'sculpt-toolbar__group sculpt-toolbar__left';
    // Hold-to-carve: strokes are negative while the button is held (like
    // holding alt), released on lift. Works two-fingered on iPad: one finger
    // holds the button, the other sculpts. A double-tap latches carving on
    // (review request); while latched, a single tap unlatches.
    this.negativeBtn = toolButton(
      '',
      'Hold: carve (negative). Double-tap: lock carving on',
      'negative',
      'fi-ts-reflect-vertical',
    );
    this.negativeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        this.negativeBtn.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events carry no active pointer; capture is best-effort.
      }
      if (this.negSticky) {
        // Latched: this press ends the lock when it lifts.
        this.unlatchOnUp = true;
      } else {
        const now = performance.now();
        if (now - this.lastNegDown < 350) this.negSticky = true; // double-tap
        this.lastNegDown = now;
        this.input.setNegativeBase(true);
      }
      this.refresh();
    });
    const releaseNegative = (): void => {
      if (this.unlatchOnUp) {
        this.unlatchOnUp = false;
        this.negSticky = false;
        this.input.setNegativeBase(false);
      } else if (!this.negSticky) {
        if (!this.input.getNegativeBase()) return;
        this.input.setNegativeBase(false);
      }
      this.refresh();
    };
    this.negativeBtn.addEventListener('pointerup', releaseNegative);
    this.negativeBtn.addEventListener('pointercancel', releaseNegative);
    this.negativeBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    left.appendChild(this.negativeBtn);

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
    ];
    for (const [id, key, name, slot, icon] of brushes) {
      const btn = toolButton(key, name, slot, icon);
      btn.addEventListener('click', () => this.input.selectBrush(id));
      this.brushBtns.set(id, btn);
      center.appendChild(btn);
    }

    this.root.append(left, center);
    document.body.appendChild(this.root);

    this.input.onToolChange = () => this.refresh();
    this.refresh();
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
