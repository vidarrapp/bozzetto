import { chordLabel, chordOf, keymap } from './keymap';

/**
 * Hide-the-interface mode (Tab), in two stages: the first press tidies -
 * closing whatever panels are open - and a second press, with nothing left
 * open, clears the standing chrome down to a bare working screen. The next
 * press, or Esc, brings it all back.
 *
 * One behaviour everywhere (owner decision): the viewer, the editors'
 * preview, Armature and Sculpt share it. There is one toggle a page
 * (pageChrome): the viewer mount makes it, and the modes mounted over the
 * viewer use the same one rather than stacking a second veil and a second
 * Esc listener on top.
 *
 * What goes is deliberately narrow (review call), and is all in the CSS
 * under body.chrome-hidden: the panels and their docked tabs, the top row
 * of chips, the page furniture, the frame meter, and Sculpt's brush row.
 * What STAYS is everything you actually work with or need to read - the
 * brush sliders, undo/redo, the Negative button, the object stats, the
 * viewer's transport (its scrubber), and any toast, tooltip or hotkey guide
 * that appears. Hiding those made the mode useless rather than minimal;
 * the collapsed tabs were the clutter worth removing. The one notice that
 * goes is the update notice (ui/updates): it needs nothing done this
 * minute, and a clear view is what the mode is for. It comes back with the
 * interface. In the editors only the preview's chrome goes: their sidebar
 * of project settings is the page, not the preview's furniture.
 *
 * In Sculpt the toolbar's Negative group survives, so does the hide button
 * sitting in it - a visible, labelled control to come back with, on a
 * device with no Tab key as much as anywhere else. Escape also exits
 * everywhere, and the state is never persisted, so a reload always returns
 * a full interface.
 *
 * Hiding uses `visibility: hidden`, not opacity or a transform: the panels'
 * own collapse is transform-only, which leaves their controls focusable
 * off-screen, and hidden chrome that still took Tab stops would strand a
 * keyboard user in an invisible focus order.
 */

export const CHROME_HIDDEN_CLASS = 'chrome-hidden';
/** Panels listen for this and collapse; the first Tab press dispatches it. */
export const PANEL_CLOSE_ALL_EVENT = 'bozzetto:panel-close-all';

/** Chattiness decay: say it in full, then briefly, then not at all. */
const LESSONS_LOUD = 2;
const LESSONS_QUIET = 5;
const HINT_LOUD_MS = 5000;
const HINT_QUIET_MS = 2200;
/** One count for every mode: the lesson is the same wherever it is learnt. */
const LESSON_KEY = 'bz.sculpt.chromeLessons';

let shared: ChromeToggle | null = null;

/**
 * The page's toggle, made on first use. The viewer mount asks first; Sculpt
 * and Armature, mounted over it, get the same one.
 */
export function pageChrome(): ChromeToggle {
  shared ??= new ChromeToggle();
  return shared;
}

/** Drop the page's toggle, if there is one: the interface showing, its listener gone (an editor's preview unmounting). */
export function disposePageChrome(): void {
  shared?.dispose();
}

export class ChromeToggle {
  private hidden = false;
  private readonly hint: HTMLDivElement;
  private hintTimer = 0;
  private lessons = 0;

  /** Told when visibility flips: pollers idle, the toolbar button restyles. */
  onChange: ((hidden: boolean) => void) | null = null;

  /**
   * Escape (ui.show, rebindable) is a one-way door out; it never hides.
   * It listens here rather than in each mode's handler, so it answers the
   * same in all of them; Armature, whose Esc deselects and is claimed
   * before it gets here, shows the interface itself.
   */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.hidden && isShowKey(e)) this.set(false);
  };

  constructor() {
    try {
      this.lessons = Number(localStorage.getItem(LESSON_KEY)) || 0;
    } catch {
      // Private windows just get the full lesson every time, which is safe.
    }
    this.hint = document.createElement('div');
    this.hint.className = 'chrome-hint';
    this.hint.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.hint);
    window.addEventListener('keydown', this.onKeyDown);
    this.apply();
  }

  /**
   * One Tab press. Showing again always wins; otherwise an open panel is
   * the more likely thing you meant to dismiss, so it goes first and the
   * bare screen is a deliberate second press.
   */
  handleTab(): void {
    if (this.hidden) {
      this.set(false);
      return;
    }
    if (closeOpenPanels()) return;
    this.set(true);
  }

  toggle(): void {
    // The toolbar button is a direct switch, not the staged key.
    this.set(!this.hidden);
  }

  set(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) closeOpenPanels(); // never leave a panel open behind the veil
    this.apply();
    this.onChange?.(hidden);
    if (!hidden) {
      this.clearHint();
      return;
    }
    if (this.lessons < LESSONS_LOUD) this.showHint(HINT_LOUD_MS);
    else if (this.lessons < LESSONS_QUIET) this.showHint(HINT_QUIET_MS);
    this.lessons++;
    try {
      localStorage.setItem(LESSON_KEY, String(this.lessons));
    } catch {
      // The lesson just doesn't stick; nothing else depends on it.
    }
  }

  isHidden(): boolean {
    return this.hidden;
  }

  private apply(): void {
    document.body.classList.toggle(CHROME_HIDDEN_CLASS, this.hidden);
  }

  private showHint(ms: number): void {
    // The key as bound now, so a rebind in Preferences is what it names.
    const key = keymap.chordFor('ui.chrome') ?? keymap.chordFor('ui.show');
    this.hint.textContent = key ? `Interface hidden - press ${chordLabel(key)} to bring it back` : 'Interface hidden';
    this.hint.classList.add('is-visible');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hint.classList.remove('is-visible');
    }, ms);
  }

  private clearHint(): void {
    window.clearTimeout(this.hintTimer);
    this.hint.classList.remove('is-visible');
  }

  dispose(): void {
    window.clearTimeout(this.hintTimer);
    window.removeEventListener('keydown', this.onKeyDown);
    document.body.classList.remove(CHROME_HIDDEN_CLASS);
    this.hint.remove();
    if (shared === this) shared = null;
  }
}

/** Whether a key event is the show-the-interface key (ui.show, Esc by default). */
export function isShowKey(e: KeyboardEvent): boolean {
  const show = keymap.chordFor('ui.show');
  return !!show && chordOf(e) === show;
}

/**
 * Collapse every open panel; true if there was anything to collapse. Asks
 * the DOM rather than holding references, because the panels come from
 * different owners - the Render panel belongs to the viewer mount, the
 * others to Sculpt or Armature - and none can see the others' instances.
 */
function closeOpenPanels(): boolean {
  const open = document.querySelectorAll('.panel:not(.panel--collapsed)');
  if (open.length === 0) return false;
  window.dispatchEvent(new CustomEvent(PANEL_CLOSE_ALL_EVENT));
  return true;
}
