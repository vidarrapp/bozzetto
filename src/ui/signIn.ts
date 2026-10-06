import { desktopSignIn, isDesktop } from '../net/origin';
import { signOut } from '../admin/api';
import { readyToLeave } from './leaving';
import { topChip } from './topbar';

/**
 * Sign in again from wherever an expired session was noticed, and come
 * back to the same page with the work on it.
 *
 * Cloudflare Access fronts /admin*, so a navigation to /admin/login runs
 * its login, and the Function there (functions/admin/login.ts) then sends
 * the browser back to `next`: this page. The work crosses the round trip
 * as it crosses any deliberate leaving (ui/leaving): what each mode
 * registered is written first, and the page it returns to restores from
 * there.
 *
 * The desktop app has no such page to go to: it signs in through its own
 * window and the page stays where it is.
 */

/** /admin/login, told to come back to this page. */
export function signInHref(): string {
  return `/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

/**
 * Sign in again: on the web, store what is on the page and go through the
 * Access login and back; in the desktop app, its sign-in window. Resolves
 * once the desktop's window has closed (true when it signed in); on the web
 * the page is on its way out by then.
 */
export async function signInAgain(): Promise<boolean> {
  if (isDesktop()) return desktopSignIn().catch(() => false);
  if (!(await readyToLeave('signing in means leaving the page. Leave anyway?'))) return false;
  window.location.assign(signInHref());
  return false;
}

/**
 * A Sign in again button, for a notice or a form. `after` hears how the
 * desktop app's sign-in window ended; on the web the page has gone.
 */
export function signInButton(
  className: string,
  after?: (signedIn: boolean) => void,
  label = 'Sign in again',
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', () => {
    b.disabled = true;
    void signInAgain()
      .then((signedIn) => after?.(signedIn))
      .finally(() => {
        b.disabled = false;
      });
  });
  return b;
}

/**
 * Sign out, as a top-row chip (owner request: a sign-in should not stay
 * behind on a device the owner is done with). It goes through Access's
 * logout and comes back to the gallery (admin/api signOut). The desktop
 * app signs out in Server settings instead, where it signs in.
 */
export function signOutChip(): HTMLElement {
  const b = topChip('Sign out') as HTMLButtonElement;
  b.addEventListener('click', () => {
    b.disabled = true;
    void signOut();
  });
  return b;
}
