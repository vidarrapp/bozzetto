import { div } from '../../ui/dom';

/**
 * A notice that stays while something runs - an upload's progress - and
 * then says how it ended. TopMenu.note is the other kind, for commands that
 * are finished the moment they are chosen.
 */
export interface StatusToast {
  set(text: string): void;
  done(text: string): void;
  /**
   * How it went wrong. Given a button (Sign in again), the notice carries
   * it and stays long enough to be used, with a way to dismiss it sooner.
   */
  fail(text: string, button?: HTMLButtonElement): void;
}

/** How long a failure stays: long enough to be read, and to act on. */
const FAIL_MS = 9000;
/** With a button in it, long enough to reach for the button too. */
const ACTION_MS = 30000;

export function statusToast(text: string): StatusToast {
  const el = div('sculpt-toast file-menu__note file-menu__progress');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.dataset.state = 'running';
  el.textContent = text;
  document.body.appendChild(el);
  const finish = (message: string, state: 'done' | 'failed', ms: number): void => {
    el.textContent = message;
    el.dataset.state = state;
    window.setTimeout(() => el.remove(), ms);
  };
  return {
    set: (t) => {
      el.textContent = t;
    },
    done: (t) => finish(t, 'done', 2400),
    fail: (t, button) => {
      if (!button) {
        finish(t, 'failed', FAIL_MS);
        return;
      }
      finish(t, 'failed', ACTION_MS);
      // The words in a span of their own, so the notice still reads as one
      // line of text beside its buttons.
      const words = document.createElement('span');
      words.className = 'file-menu__words';
      words.textContent = t;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'sculpt-toast__btn file-menu__dismiss';
      close.setAttribute('aria-label', 'Dismiss');
      close.textContent = '×';
      close.addEventListener('click', () => el.remove());
      button.classList.add('sculpt-toast__btn');
      el.replaceChildren(words, button, close);
    },
  };
}

/** A notice on its own, for an outcome with no progress before it. */
export function failNotice(text: string, button?: HTMLButtonElement): void {
  statusToast('').fail(text, button);
}
