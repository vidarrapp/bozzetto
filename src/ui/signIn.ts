import { desktopSignIn, isDesktop } from '../net/origin';
import { accountsOn, errorText, reloadConfig } from '../net/account';
import { signOut, type SignInVia } from '../admin/api';
import { readyToLeave } from './leaving';
import { topChip } from './topbar';
import { failNotice } from '../sculpt/ui/statusToast';

/**
 * Sign in again from wherever an expired session was noticed, and come
 * back to the same page with the work on it.
 *
 * With accounts on (docs/accounts.md §7), the account's session is signed
 * in again in the sign-in dialog, over the page, which stays where it is;
 * whoever asked then carries on (a save that failed tries again).
 *
 * Cloudflare Access's own session - all there is with accounts off, and
 * still the first lock on the owner tools with them on - is renewed by a
 * page load through it: Access fronts /admin*, so a navigation to
 * /admin/login runs its login, and the Function there
 * (functions/admin/login.ts) then sends the browser back to `next`: this
 * page. The work crosses the round trip as it crosses any deliberate
 * leaving (ui/leaving): what each mode registered is written first, and
 * the page it returns to restores from there.
 *
 * The desktop app has no such page to go to: it signs in through its own
 * window and the page stays where it is.
 */

/** /admin/login, told to come back to this page. */
export function signInHref(): string {
  return `/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

/**
 * Sign in again. In the desktop app, its sign-in window. On the web with
 * accounts on, the sign-in dialog - unless it is Access's session that ran
 * out (`via` 'access': an owner route redirected to its login), which only
 * the round trip renews. Otherwise, store what is on the page and go
 * through the Access login and back. Resolves once the window or the
 * dialog has closed, true when someone signed in; on the round trip the
 * page is on its way out by then.
 */
export async function signInAgain(via?: SignInVia, reason?: string): Promise<boolean> {
  if (isDesktop()) {
    const signedIn = await desktopSignIn().catch(() => false);
    // The window asked the server afresh whether it has accounts; the
    // retry that follows must choose its route by the same answer, as
    // Server settings' sign-in does (desktop/ServerSettings).
    void reloadConfig();
    return signedIn;
  }
  if (via !== 'access' && (await accountsOn())) {
    try {
      const { openSignIn } = await import('./account/signIn');
      return (await openSignIn({ reason })) !== null;
    } catch (err) {
      // The dialog's code could not load (offline, an update replacing it).
      failNotice(`Could not open the sign-in: ${errorText(err)}`);
      return false;
    }
  }
  if (!(await readyToLeave('signing in means leaving the page. Leave anyway?'))) return false;
  window.location.assign(signInHref());
  return false;
}

/** What the dialog says first when it opens for a sign-in that ran out. */
const EXPIRED = 'Your sign-in has expired. Sign in again, and carry on where you were.';

/**
 * A Sign in again button, for a notice or a form. `after` hears how the
 * desktop app's sign-in window, or the sign-in dialog, ended; on the
 * Access round trip the page has gone. `via` is which sign-in ran out,
 * when the caller knows (an AuthExpiredError's).
 */
export function signInButton(
  className: string,
  after?: (signedIn: boolean) => void,
  label = 'Sign in again',
  via?: SignInVia,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', () => {
    b.disabled = true;
    // Read as it is now: a form may have relabelled it (Sign in, for a guest).
    void signInAgain(via, b.textContent === 'Sign in again' ? EXPIRED : undefined)
      .then((signedIn) => after?.(signedIn))
      .finally(() => {
        b.disabled = false;
      });
  });
  return b;
}

/**
 * Sign out, as a top-row chip (owner request: a sign-in should not stay
 * behind on a device the owner is done with). With accounts off it goes
 * through Access's logout and comes back to the gallery; with them on it
 * ends the account's session (admin/api signOut). The desktop app signs
 * out in Server settings instead, where it signs in.
 */
export function signOutChip(): HTMLElement {
  const b = topChip('Sign out') as HTMLButtonElement;
  b.addEventListener('click', () => {
    b.disabled = true;
    void signOut().catch((err: unknown) => {
      b.disabled = false;
      failNotice(`Could not sign out: ${errorText(err)}`);
    });
  });
  return b;
}
