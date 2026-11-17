/**
 * A question in the app's own window (the install card's look): a heading
 * that names the thing, a line of words, the button that does it (a verb:
 * "Delete", "Replace", "Leave"), and Cancel. Esc, Cancel and a press beside
 * the window all say no. Resolves true for the verb button.
 *
 * Two styles. Normal: the verb button is orange and has the focus, so Enter
 * confirms. Danger (anything that cannot be undone or loses work): the verb
 * button is red with a white label, Cancel has the focus, and Enter never
 * confirms. This replaces the browser's own question box, which the installed app
 * draws badly and Pencil cannot reach well. The one native question left is
 * the leave prompt of beforeunload (present/workspace.ts): browsers allow
 * nothing else there.
 *
 * The page stands down while it is up (`has-modal`: the hotkeys and Tab).
 * Hooks for tests: `.bz-ask`, `.bz-ask-yes`, `.bz-ask-cancel`.
 */
export interface AskOptions {
  /** The question, as the heading. */
  title: string;
  /** What follows from yes, in a line or two. */
  text?: string;
  /** The button that does it: the verb, in a word or two. */
  yes: string;
  /** Cannot be undone, or loses work: red button, focus on Cancel, Enter does not confirm. */
  danger?: boolean;
}

export function askWindow(opts: AskOptions): Promise<boolean> {
  return openAsk(opts).then((r) => r !== null);
}

/** A question with one line to type (the browser's own text box): the typed text, or null for Cancel. */
export function askText(opts: AskOptions & { value?: string; label?: string }): Promise<string | null> {
  return openAsk(opts, { value: opts.value ?? '', label: opts.label ?? opts.title });
}

/**
 * Something went wrong, or something is to be known: a window with one
 * button, OK (the browser's own alert, said in the app's look). Esc and a
 * press beside the window close it too.
 */
export function tellWindow(opts: { title: string; text?: string; ok?: string }): Promise<void> {
  return openAsk({ title: opts.title, text: opts.text, yes: opts.ok ?? 'OK' }, undefined, true).then(() => undefined);
}

/** The text of a yes (the field's, or '' with no field), null for no. */
function openAsk(opts: AskOptions, field?: { value: string; label: string }, notice = false): Promise<string | null> {
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
    let input: HTMLInputElement | null = null;
    if (field) {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'bz-ask-input';
      input.value = field.value;
      input.setAttribute('aria-label', field.label);
      input.autocomplete = 'off';
      card.appendChild(input);
    }
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = `btn ${opts.danger ? 'btn--danger' : 'btn--primary'} bz-ask-yes`;
    yes.textContent = opts.yes;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn bz-ask-cancel';
    cancel.textContent = 'Cancel';
    const actions = document.createElement('div');
    actions.className = 'account-actions';
    if (notice) actions.append(yes);
    else actions.append(yes, cancel);
    card.appendChild(actions);
    overlay.appendChild(card);

    const finish = (answer: boolean): void => {
      window.removeEventListener('keydown', onKey, true);
      if (!hadModal) document.body.classList.remove('has-modal');
      overlay.remove();
      resolve(answer ? (input ? input.value : '') : null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (notice && (e.key === 'Escape' || e.key === 'Enter')) {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Tab') {
        // Keep the keyboard inside the window.
        const first: HTMLElement = input ?? yes;
        const last: HTMLElement = notice ? yes : cancel;
        const on = document.activeElement;
        if (e.shiftKey && on === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && on === last) {
          e.preventDefault();
          first.focus();
        } else if (on !== first && on !== last && on !== yes) {
          e.preventDefault();
          first.focus();
        }
      } else if (e.key === 'Enter' && !opts.danger && document.activeElement !== cancel) {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      }
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    yes.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    const hadModal = document.body.classList.contains('has-modal');
    window.addEventListener('keydown', onKey, true);
    document.body.classList.add('has-modal');
    document.body.appendChild(overlay);
    if (input) {
      input.focus();
      input.select();
    } else (opts.danger && !notice ? cancel : yes).focus();
  });
}
