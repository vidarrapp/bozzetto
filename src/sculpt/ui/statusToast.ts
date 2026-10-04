import { div } from '../../ui/dom';

/**
 * A notice that stays while something runs - an upload's progress - and
 * then says how it ended. TopMenu.note is the other kind, for commands that
 * are finished the moment they are chosen.
 */
export interface StatusToast {
  set(text: string): void;
  done(text: string): void;
  fail(text: string): void;
}

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
    // A failure stays long enough to be read, and to act on.
    fail: (t) => finish(t, 'failed', 9000),
  };
}
