// Flaticon uicons, solid straight (fi-ss-*), for the brushes and for the
// Negative button (circle-half-stroke: one style for every icon, owner
// call). Whole style sheets are imported
// for upgrade-proof font URLs; each font only downloads when one of its
// glyphs first renders (sculpt mode). Attribution lives in the README.
import '../../ui/icons';
import type { InputShell } from '../bridge/InputShell';
import { liftedOn, onTap, TAP_CLICK_MS } from '../../ui/dom';
import { chordLabel, keymap } from '../../ui/keymap';
import { slotAction, toolBars } from '../tools/bars';
import { toolById, type ToolDef, type Workspace } from '../tools/registry';

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
 * The tool bar: the Select tool, the brushes and Transform in one
 * box at the bottom centre, each showing its icon with its hotkey
 * as a corner badge (View > Hotkeys on tools shows or hides the digits)
 * and its name, with the hotkey, in a tooltip above it. The tools and
 * their order are the registry's and the bars' (tools/registry.ts,
 * tools/bars.ts); a brush's key is its place on the bar, read from the
 * keymap, so a rebind shows here. Most iPads have
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
  /** Toolbar calipers toggle (the shell owns the mode). */
  onToggleMeasure: (() => void) | null = null;
  private measureBtn!: HTMLButtonElement;
  private measureOn = false;

  setMeasureActive(on: boolean): void {
    this.measureOn = on;
    this.measureBtn.classList.toggle('sculpt-toolbar__btn--active', on);
    this.refresh();
  }

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
  /** The buttons by tool id: Sculpt's brushes, the Paint workspace's tools once it has been entered, and the three modes. */
  private readonly btns = new Map<string, HTMLButtonElement>();
  private paintOn = false;
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
      'Negative',
    );
    this.negativeBtn.classList.add('sculpt-toolbar__neg');
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
    this.center = center;
    // Select at the far left, Transform at the far right (owner call): the
    // two tools that are not brushes bracket the row. They are not brushes:
    // Transform has letter keys (t, and w/e/r for one kind of handle) and a
    // gizmo instead of strokes, Calipers measures and edits nothing, and
    // each keeps a button and an active state of its own rather than a
    // place on the bar. Their keys show as badges like every other tool's.
    this.selectBtn = this.modeButton('bz.select', () => this.onToggleSelect?.());
    this.transformBtn = this.modeButton('bz.transform', () => this.onToggleTransform?.());
    this.measureBtn = this.modeButton('bz.calipers', () => this.onToggleMeasure?.());
    this.layout();

    this.root.append(center);
    document.body.appendChild(this.root);

    window.addEventListener('pointerup', this.onNegativeUp, true);
    window.addEventListener('pointercancel', this.onNegativeUp, true);
    window.addEventListener('blur', this.onNegativeBlur);
    this.input.onToolChange = () => this.refresh();
    // The arm clears when its stroke ends, which the shell sees first.
    this.input.onNegativeChange = () => this.refresh();
    // A rebound key and a changed order both show on the badges and the tips.
    this.offKeys = keymap.onChange(() => this.paintKeys());
    this.offBars = toolBars.onChange(() => {
      this.layout();
      this.refresh();
    });
    this.refresh();
  }

  /** The bar's own box of buttons, which the Paint workspace adds its tools to. */
  private center!: HTMLDivElement;
  private offKeys: (() => void) | null = null;
  private offBars: (() => void) | null = null;

  /** A button for Select, Transform or Calipers: the registry's icon and words, the tool's own key. */
  private modeButton(id: string, onPress: () => void): HTMLButtonElement {
    const btn = this.toolButtonFor(toolById(id) as ToolDef);
    onTap(btn, onPress);
    return btn;
  }

  /** A button for a registry tool: its icon, its name, and data-tool for whoever has to find it by name. */
  private toolButtonFor(def: ToolDef): HTMLButtonElement {
    const btn = toolButton('', def.label, def.slot ?? def.id, def.icon ?? '', def.name);
    btn.dataset.tool = def.id;
    this.btns.set(def.id, btn);
    return btn;
  }

  /** The button of a brush on a workspace's bar, made on first need. */
  private brushButton(id: string, ws: Workspace): HTMLButtonElement | null {
    const have = this.btns.get(id);
    if (have) return have;
    const def = toolById(id);
    if (!def || def.kind !== 'brush' || def.engine === null || !def.icon) return null;
    const engine = def.engine;
    const btn = this.toolButtonFor(def);
    if (ws === 'paint') {
      btn.classList.add('sculpt-toolbar__btn--paint');
      btn.hidden = true;
    }
    onTap(btn, () => this.input.selectBrush(engine));
    return btn;
  }

  /**
   * Put the buttons in the bars' order: Select, Sculpt's brushes, Transform,
   * Calipers, then the Paint workspace's tools once they exist. The order
   * is the bars' (tools/bars.ts); nothing here names a tool.
   */
  private layout(): void {
    const ordered: HTMLButtonElement[] = [this.selectBtn];
    for (const id of toolBars.order('sculpt')) {
      const b = this.brushButton(id, 'sculpt');
      if (b) ordered.push(b);
    }
    ordered.push(this.transformBtn, this.measureBtn);
    // Paint's buttons wait for the first time Paint is entered; after that they follow the bar too.
    if (this.paintBuilt) {
      for (const id of toolBars.order('paint')) {
        const b = this.brushButton(id, 'paint');
        if (b) ordered.push(b);
      }
    }
    // Buttons of a tool taken off a bar go away; they come back by being put on one again.
    const keep = new Set(ordered);
    for (const [id, b] of this.btns) {
      if (!keep.has(b)) {
        b.remove();
        this.btns.delete(id);
      }
    }
    this.center.append(...ordered);
    this.applyVisibility();
    this.paintKeys();
  }

  private paintBuilt = false;

  /** Which workspace a button belongs to, for hiding it outside it. */
  private applyVisibility(): void {
    const paint = this.paintOn;
    for (const [id, btn] of this.btns) {
      const def = toolById(id);
      if (!def) continue;
      if (def.kind === 'mode') btn.hidden = paint && id !== 'bz.select';
      else btn.hidden = toolBars.placeOf('paint', id) > 0 ? !paint : paint;
    }
  }

  /**
   * Badges, tips and accessible names from the keymap: a brush's key is its
   * place on the bar, so what a person bound in Preferences is what shows.
   */
  private paintKeys(): void {
    for (const [id, btn] of this.btns) {
      const def = toolById(id);
      if (!def) continue;
      let action: string | null = null;
      let place = 0;
      if (def.kind === 'mode') action = def.keyAction ?? null;
      else {
        const own: Workspace = toolBars.placeOf('paint', id) > 0 ? 'paint' : 'sculpt';
        place = toolBars.placeOf(own, id);
        action = place >= 1 && place <= 10 ? slotAction(place) : null;
      }
      const chord = action ? keymap.chordFor(action) : null;
      setButtonKey(btn, chord);
      if (place) btn.dataset.place = String(place);
      else delete btn.dataset.place;
      btn.setAttribute('aria-label', keyedName(def.label, chord));
    }
  }

  /**
   * The Paint workspace's bar, or Sculpt's: in Paint the Select tool and the
   * paint tools stand, and the brushes, Transform and Calipers are put away;
   * Sculpt has the brushes, Transform and Calipers and no paint tool. The
   * Paint buttons are made the first time Paint is entered.
   */
  setWorkspace(paint: boolean): void {
    if (paint && !this.paintBuilt) {
      this.paintBuilt = true;
      this.layout();
    }
    this.paintOn = paint;
    this.applyVisibility();
    this.root.classList.toggle('sculpt-toolbar--paint', paint);
    this.refresh();
    window.dispatchEvent(new Event('bozzetto:shell-layout'));
  }

  /** Reflect the active brush, and Negative's arm or latch, on the buttons. */
  private refresh(): void {
    const active = this.input.currentToolIndex();
    for (const [id, btn] of this.btns) {
      const def = toolById(id);
      if (!def || def.kind !== 'brush') continue;
      const onPaint = toolBars.placeOf('paint', id) > 0;
      // With the Select tool up no brush is the active one, whatever the
      // vendor's current tool index still says (nor with the Calipers up,
      // on Sculpt's bar).
      const on = def.engine === active && !this.selectOn && (onPaint ? this.paintOn : !this.measureOn);
      btn.classList.toggle('sculpt-toolbar__btn--active', on);
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
    this.offKeys?.();
    this.offBars?.();
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

/** What a key looks like on a badge and in a tip: a plain key as it is, a named key spelt out; a chord with a modifier is not a badge's. */
function keyText(chord: string | null): { badge: string | null; tip: string | null } {
  if (!chord) return { badge: null, tip: null };
  const plain = chord.length === 1 ? chord : chordLabel(chord);
  return { badge: chord.includes('+') ? null : plain, tip: plain };
}

/** A button's name with its key in it where the label says `{key}`, and without the brackets when it has none. */
function keyedName(label: string, chord: string | null): string {
  const tip = keyText(chord).tip;
  return tip ? label.replace('{key}', tip) : label.replace(' ({key})', '');
}

/** Show, change or remove a button's key: the corner badge, and the key beside the name in the tip. */
function setButtonKey(btn: HTMLElement, chord: string | null): void {
  const { badge: badgeText, tip: tipText } = keyText(chord);
  const box = btn.querySelector<HTMLElement>('.bz-tip');
  let badge = btn.querySelector<HTMLElement>('.sculpt-toolbar__key');
  if (badgeText) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'sculpt-toolbar__key';
      btn.insertBefore(badge, box);
    }
    badge.textContent = badgeText;
  } else badge?.remove();
  if (!box) return;
  let k = box.querySelector<HTMLElement>('.bz-tip__key');
  if (tipText) {
    if (!k) {
      k = document.createElement('kbd');
      k.className = 'bz-tip__key';
      box.appendChild(k);
    }
    k.textContent = tipText;
  } else k?.remove();
}
