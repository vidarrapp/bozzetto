/**
 * Hide-the-interface mode (Tab), in two stages: the first press tidies -
 * closing whatever panels are open - and a second press, with nothing left
 * open, clears the standing chrome down to a bare working screen.
 *
 * What goes is deliberately narrow (review call): the panels and their
 * docked tabs, the page furniture around them, and the brush row. What
 * STAYS is everything you actually work with or need to read - the brush
 * sliders, undo/redo, the Negative button, the object stats, and any toast,
 * tooltip or hotkey guide that appears. Hiding those made the mode useless
 * rather than minimal; the collapsed tabs were the clutter worth removing.
 *
 * Because the toolbar's Negative group survives, so does the hide button
 * sitting in it - which means there is always a visible, labelled control
 * to come back with, on a device with no Tab key as much as anywhere else.
 * That earns the mode its simplicity: no corner glyph, no rescue heuristics.
 * Escape also exits, and the state is never persisted, so a reload always
 * returns a full interface.
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
const LESSON_KEY = 'bz.sculpt.chromeLessons';

export class ChromeToggle {
  private hidden = false;
  private readonly hint: HTMLDivElement;
  private hintTimer = 0;
  private lessons = 0;

  /** Told when visibility flips: pollers idle, the toolbar button restyles. */
  onChange: ((hidden: boolean) => void) | null = null;

  /** Escape is a one-way door out; it never hides. */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.hidden) this.set(false);
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
    this.hint.textContent = 'Interface hidden - press Tab to bring it back';
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
  }
}

/**
 * Collapse every open panel; true if there was anything to collapse. Asks
 * the DOM rather than holding references, because the panels come from two
 * different owners - the Render panel belongs to the viewer mount, the
 * other three to sculpt mode - and neither can see the other's instances.
 */
function closeOpenPanels(): boolean {
  const open = document.querySelectorAll('.panel:not(.panel--collapsed)');
  if (open.length === 0) return false;
  window.dispatchEvent(new CustomEvent(PANEL_CLOSE_ALL_EVENT));
  return true;
}
