/**
 * A question in the app's own window (the install card's look): a heading,
 * a line of words, the one orange button that does it, and Cancel. Esc,
 * Cancel and a press beside the window all say no. Resolves true for the
 * orange button.
 *
 * The page stands down while it is up (`has-modal`: the hotkeys and Tab).
 * Hooks for tests: `.bz-ask`, `.bz-ask-yes`, `.bz-ask-cancel`.
 */
export interface AskOptions {
  /** The question, as the heading. */
  title: string;
  /** What follows from yes, in a line or two. */
  text?: string;
  /** The orange button: the choice, in a word or two. */
  yes: string;
}

export function askWindow(opts: AskOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'install-overlay bz-ask';
    const card = document.createElement('div');
    card.className = 'install-card bz-ask__card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', opts.title);
    const h = document.createElement('h2');
    h.textContent = opts.title;
    card.appendChild(h);
    if (opts.text) {
      const p = document.createElement('p');
      p.textContent = opts.text;
      card.appendChild(p);
    }
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn btn--primary bz-ask-yes';
    yes.textContent = opts.yes;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn bz-ask-cancel';
    cancel.textContent = 'Cancel';
    const actions = document.createElement('div');
    actions.className = 'account-actions';
    actions.append(yes, cancel);
    card.appendChild(actions);
    overlay.appendChild(card);

    const finish = (answer: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('has-modal');
      overlay.remove();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    yes.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('has-modal');
    document.body.appendChild(overlay);
    yes.focus();
  });
}
