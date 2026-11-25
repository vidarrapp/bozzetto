import { eventTime, liftedOn, LONG_PRESS_MS, TAP_CLICK_MS } from '../../ui/dom';

/** What an arm button turns: a latch (every stroke) and an arm (the next stroke only). */
export interface ArmState {
  latched(): boolean;
  armed(): boolean;
  setLatched(on: boolean): void;
  setArmed(on: boolean): void;
}

/**
 * The press logic of Carve, Smooth and Mask: a tap arms the next stroke only
 * (or lets go of the latch), a long press keeps it on until a tap. Neither
 * keeps a finger on the glass while the Pencil draws: on an iPad a fingertip
 * anywhere in the page hides the Pencil from it until the finger lifts, so
 * hold-to-use cannot be offered there at all (plan 6.6e).
 *
 * The timer is ours, not the OS's: the press starts it, and running out with
 * the press still down is the long press, which latches there and then, under
 * the finger. A lift before LONG_PRESS_MS is a tap; the lift's own timestamp
 * says which it was. No setPointerCapture: capturing a touch pointer and then
 * putting a second one down makes Safari cancel the captured one.
 */
export class ArmButton {
  /** The press, from its pointerdown to its lift: its pointer, when it went down by the event's clock, and, once the timer has latched, what the button said before, for a lift that turns out to have come in time. */
  private press: {
    pointerId: number;
    downAt: number;
    before: { latched: boolean; armed: boolean } | null;
  } | null = null;
  private timer = 0;
  /** When the last press ended; a mouse's click right after it is that press's own. */
  private endedAt = -Infinity;

  constructor(
    private readonly btn: HTMLButtonElement,
    private readonly state: ArmState,
    private readonly refresh: () => void,
  ) {
    btn.addEventListener('pointerdown', this.onDown);
    // The keyboard's and assistive tech's press. A pointer's own click lands
    // just after its press ended, which already acted as a tap or a long
    // press (or, slid off, chose not to).
    btn.addEventListener('click', (e) => {
      if (e.detail > 0 && performance.now() - this.endedAt < TAP_CLICK_MS) return;
      this.tap();
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    // On iOS a stationary press starts a callout/drag gesture at ~450ms and
    // Safari cancels the touch, before the long press could ever run out.
    // Cancelling the default on touchstart is what stops that gesture. It
    // also stops the click a touch would synthesise, which this button does
    // not need: its pointer events drive it, and the click is left to the keyboard.
    btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    clearTimeout(this.timer);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onUp, true);
    window.removeEventListener('blur', this.onBlur);
  }

  private readonly onDown = (e: PointerEvent): void => {
    // The press onTap counts: the primary button only, and no focus left on
    // the button for Tab or Space to land on.
    if (e.button !== 0) return;
    e.preventDefault();
    clearTimeout(this.timer);
    this.press = { pointerId: e.pointerId, downAt: eventTime(e), before: null };
    this.timer = window.setTimeout(this.onHeld, LONG_PRESS_MS);
  };

  /** Still down when the timer ran out: the long press shows, and latches. */
  private readonly onHeld = (): void => {
    this.timer = 0;
    const press = this.press;
    if (!press) return;
    press.before = { latched: this.state.latched(), armed: this.state.armed() };
    this.latch();
  };

  /** The lift is watched on the WINDOW: a mouse released off the button never tells the button. */
  private readonly onUp = (e: PointerEvent): void => {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    this.end();
    // The events' own times decide; the timer only shows a long press while
    // it is held. A main thread busy past LONG_PRESS_MS gets to the lift
    // after the timer has run, and a tap must not latch for that, nor a long
    // press arm.
    if (eventTime(e) - press.downAt >= LONG_PRESS_MS) {
      if (!press.before) this.latch();
      return; // a long press: its lift changes nothing
    }
    if (press.before) {
      // The timer ran first on a busy page; this was a tap all along.
      this.state.setLatched(press.before.latched);
      this.state.setArmed(press.before.armed);
    }
    // A tap, unless the pointer slid off the button before lifting, which is
    // a change of mind. A cancel counts as the tap (owner call).
    if (e.type === 'pointerup' && !liftedOn(this.btn, e)) {
      this.refresh();
      return;
    }
    this.tap();
  };

  /** The window lost focus mid-press: neither a tap nor a long press. */
  private readonly onBlur = (): void => {
    if (this.press) this.end();
  };

  private end(): void {
    clearTimeout(this.timer);
    this.timer = 0;
    this.press = null;
    this.endedAt = performance.now();
  }

  /** A long press: on for every stroke until a tap. */
  private latch(): void {
    // The arm and the latch each turn a stroke over, so an arm left set
    // would make the first latched stroke go the other way.
    this.state.setArmed(false);
    this.state.setLatched(true);
    this.refresh();
  }

  /** A tap lets go of the latch, or else arms the next stroke or disarms it. */
  private tap(): void {
    if (this.state.latched()) {
      this.state.setLatched(false);
      this.state.setArmed(false);
    } else {
      this.state.setArmed(!this.state.armed());
    }
    this.refresh();
  }
}
