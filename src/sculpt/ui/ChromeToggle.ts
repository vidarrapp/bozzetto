/**
 * Hide-the-interface mode (Tab): clears every panel, toolbar and overlay so
 * the model sits alone on the page, for focused work with a keyboard and a
 * TourBox. The brush cursor stays - it is the tool, not chrome.
 *
 * Getting back is the hard half, and the two audiences want opposite
 * things. The owner does this fifty times a day on an iPad and wants
 * silence. A stranger who lands here by accident - the sculpt page is
 * publicly linked, and the iPad has no Tab key to press again - needs to be
 * taught, loudly. Rather than compromise between them, the interface's
 * chattiness DECAYS: the first couple of hides explain themselves, the next
 * few whisper, and from then on there is nothing but a dim glyph. The owner
 * reaches silence on his first afternoon; a stranger's counter is always
 * zero, so they always get the full lesson.
 *
 * Three guarantees, in order of how much they are relied on:
 *
 *   1. It never persists. A reload always comes back to a full interface,
 *      so the universal "I'm stuck" instinct works even if all else fails.
 *      (The lesson COUNT persists; the hidden state never does.)
 *   2. A button stays on screen, top-left, where the Gallery link was - the
 *      corner people already look at to get out of something, and the one
 *      place a resting wrist never lands.
 *   3. Poking at an unresponsive screen is itself the rescue signal. Taps
 *      that do nothing re-show the hint, and if they keep coming the
 *      interface simply returns: holding it hostage from someone visibly
 *      lost is indefensible.
 *
 * Everything is hidden with `visibility: hidden`, not opacity or a
 * transform: the panels' own collapse is transform-only, which leaves their
 * controls focusable off-screen, and hidden chrome that still eats Tab
 * stops would strand a keyboard user in an invisible focus order. The
 * selector list lives in style.css next to that rule; the one deliberate
 * exception is the restored-session toast, whose Start fresh button is
 * someone's only way back to a clean sphere.
 */

export const CHROME_HIDDEN_CLASS = 'chrome-hidden';

/** How long the eye stays up after the interface goes. */
const WAKE_ON_HIDE_MS = 2600;
/** Shorter re-wake when a dead tap says someone is hunting for the way out. */
const WAKE_ON_LOST_MS = 2600;
/** Chattiness decay: full lesson, then a whisper, then silence. */
const LESSONS_LOUD = 2;
const LESSONS_QUIET = 5;
const HINT_LOUD_MS = 6000;
const HINT_QUIET_MS = 2500;
const LESSON_KEY = 'bz.sculpt.chromeLessons';

/** A tap counts as "dead" only if it was short, still, and changed nothing. */
const TAP_MAX_MS = 350;
const TAP_MAX_TRAVEL = 8;
/** Dead taps this close together are the same bout of confusion. */
const LOST_WINDOW_MS = 5000;
/** Re-teach at this many dead taps, give up and restore at this many. */
const LOST_TEACH = 2;
const LOST_RESCUE = 4;

export interface ChromeToggleOptions {
  /**
   * A monotonically-changing token for "an edit happened" - the undo index.
   * A tap that pushed an edit was a sculpt dab, not someone hunting for the
   * way out, so it must never count as a dead tap.
   */
  editToken(): number;
  /** Told when visibility flips, so pollers can idle while nothing shows. */
  onChange?(hidden: boolean): void;
}

export class ChromeToggle {
  private hidden = false;
  private readonly button: HTMLButtonElement;
  private readonly hint: HTMLDivElement;
  private hintTimer = 0;
  private wakeTimer = 0;
  private lessons = 0;

  private down: { t: number; x: number; y: number; token: number } | null = null;
  private lostTaps = 0;
  private lastLostTap = 0;

  /** Escape is a one-way door out; it never hides. */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.hidden) this.set(false);
  };

  // Purely observational: never preventDefault or stopPropagation here, or
  // orbiting and sculpting break.
  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.hidden) return;
    this.down = { t: performance.now(), x: e.clientX, y: e.clientY, token: this.opts.editToken() };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!this.hidden || !d) return;
    const still = Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_MAX_TRAVEL;
    const quick = performance.now() - d.t <= TAP_MAX_MS;
    // An edit means this was a sculpt dab; the pointer was doing its job.
    if (!still || !quick || this.opts.editToken() !== d.token) return;
    this.registerLostTap();
  };

  constructor(private readonly opts: ChromeToggleOptions) {
    try {
      this.lessons = Number(localStorage.getItem(LESSON_KEY)) || 0;
    } catch {
      // Private windows just get the full lesson every time, which is safe.
    }

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'chrome-restore';
    this.button.title = 'Show the interface (Tab)';
    this.button.setAttribute('aria-label', 'Show the interface');
    this.button.setAttribute('aria-keyshortcuts', 'Tab');
    this.button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '</svg>';
    this.button.addEventListener('click', () => this.set(false));
    document.body.appendChild(this.button);

    this.hint = document.createElement('div');
    this.hint.className = 'chrome-hint';
    this.hint.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.hint);

    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerUp, true);
    window.addEventListener('keydown', this.onKeyDown);
    this.apply();
  }

  toggle(): void {
    this.set(!this.hidden);
  }

  set(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.lostTaps = 0;
    this.apply();
    this.opts.onChange?.(hidden);
    if (!hidden) {
      this.clearHint();
      window.clearTimeout(this.wakeTimer);
      this.button.classList.remove('is-awake');
      return;
    }
    this.teach();
    // Born bright, so the eye is unmistakably a control at the moment it
    // becomes the only one, then settling to something ignorable.
    this.wake(WAKE_ON_HIDE_MS);
    this.lessons++;
    try {
      localStorage.setItem(LESSON_KEY, String(this.lessons));
    } catch {
      // The lesson just doesn't stick; the floor below is unaffected.
    }
  }

  isHidden(): boolean {
    return this.hidden;
  }

  /** Dead taps in a bout: first re-teach, then simply give the UI back. */
  private registerLostTap(): void {
    const now = performance.now();
    if (now - this.lastLostTap > LOST_WINDOW_MS) this.lostTaps = 0;
    this.lastLostTap = now;
    this.lostTaps++;
    if (this.lostTaps >= LOST_RESCUE) {
      this.set(false);
      return;
    }
    if (this.lostTaps >= LOST_TEACH) {
      this.showHint(HINT_LOUD_MS);
      this.wake(WAKE_ON_LOST_MS);
    }
  }

  /** Say it in full, then in brief, then not at all. */
  private teach(): void {
    if (this.lessons < LESSONS_LOUD) this.showHint(HINT_LOUD_MS);
    else if (this.lessons < LESSONS_QUIET) this.showHint(HINT_QUIET_MS);
  }

  private wake(ms: number): void {
    this.button.classList.add('is-awake');
    window.clearTimeout(this.wakeTimer);
    this.wakeTimer = window.setTimeout(() => {
      this.button.classList.remove('is-awake');
    }, ms);
  }

  private apply(): void {
    document.body.classList.toggle(CHROME_HIDDEN_CLASS, this.hidden);
    // The eye only exists while there is something to restore, so it never
    // adds a stray tab stop to the normal interface.
    this.button.hidden = !this.hidden;
  }

  private showHint(ms: number): void {
    // Name both routes: the key for whoever pressed it, the eye for whoever
    // has no keyboard and did not mean to be here.
    this.hint.textContent = 'Interface hidden - press Tab, or tap the eye, to bring it back';
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
    window.clearTimeout(this.wakeTimer);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointercancel', this.onPointerUp, true);
    window.removeEventListener('keydown', this.onKeyDown);
    document.body.classList.remove(CHROME_HIDDEN_CLASS);
    this.button.remove();
    this.hint.remove();
  }
}
