import { AccountError, inWait, setStar } from '../../net/account';
import { failNotice } from '../../sculpt/ui/statusToast';
import { signInButton } from '../signIn';

/**
 * The Star toggle (docs/accounts.md §13): a signed-in member's favourite,
 * on a Community card's picture and beside the viewer's credit, never on
 * the member's own work. Optimistic: it turns at the click, and back if
 * the server refuses, saying why. It never shows a count.
 *
 * Hooks for tests: `.star-toggle[data-project][aria-pressed]`.
 */
export function starButton(
  id: string,
  starred: boolean,
  opts: { className?: string; changed?: (on: boolean) => void } = {},
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `star-toggle${opts.className ? ` ${opts.className}` : ''}`;
  b.dataset.project = id;
  let on = starred;
  let busy = false;
  const paint = (): void => {
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Unstar' : 'Star');
    b.title = on ? 'Unstar' : 'Star';
    b.textContent = on ? '★' : '☆';
  };
  paint();
  b.addEventListener('click', (ev) => {
    // On a card the click would open the work as well.
    ev.preventDefault();
    ev.stopPropagation();
    if (busy) return;
    busy = true;
    const want = !on;
    on = want;
    paint();
    void setStar(id, want)
      .then(() => opts.changed?.(want))
      .catch((err: unknown) => {
        on = !want;
        paint();
        starRefused(err, want);
      })
      .finally(() => {
        busy = false;
      });
  });
  return b;
}

/** A star the server did not take, said in a toast, with the way back in when the sign-in has gone. */
function starRefused(err: unknown, want: boolean): void {
  const what = want ? 'Could not star it' : 'Could not unstar it';
  if (!(err instanceof AccountError)) {
    failNotice(`${what}: no connection.`);
    return;
  }
  if (err.status === 401) {
    failNotice(`${what}: your sign-in has expired.`, signInButton('', () => undefined, 'Sign in again', 'session'));
    return;
  }
  if (err.status === 404) failNotice(`${what}: it is no longer in the Community.`);
  else if (err.status === 429) failNotice(`${what}: that is as many changes as a day allows. Try again ${inWait(err.retryAfter)}.`);
  else if (err.status === 400 && err.reason === 'own') failNotice(`${what}: it is your own work.`);
  else failNotice(`${what}: ${err.message.replace(/\.$/, '')}.`);
}
