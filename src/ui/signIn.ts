import { desktopSignIn, isDesktop } from '../net/origin';

/**
 * Sign in again from wherever an expired session was noticed, and come
 * back to the same page with the work on it.
 *
 * Cloudflare Access fronts /admin*, so a navigation to /admin/login runs
 * its login, and the Function there (functions/admin/login.ts) then sends
 * the browser back to `next`: this page. The work crosses the round trip
 * the way it crosses a reload. A mode registers what must be written before
 * the page goes - Sculpt its autosave, Armature its save - and the page it
 * returns to restores from there, the scene's project link with it.
 *
 * The desktop app has no such page to go to: it signs in through its own
 * window and the page stays where it is.
 */

/**
 * Write what the page holds that is not stored yet. Resolves false when
 * something could not be, which would be lost by leaving.
 */
type Flush = () => Promise<boolean>;

const flushes = new Set<Flush>();

/** Have `flush` run before the page leaves to sign in. Returns the undo. */
export function beforeSignIn(flush: Flush): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

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
  const stored = await Promise.all([...flushes].map((flush) => flush().catch(() => false)));
  if (
    stored.includes(false) &&
    !confirm(
      'The newest work on this page could not be stored on this device, and signing in means leaving the page. ' +
        'Leave anyway? Cancel, then File > Save file, keeps a copy.',
    )
  ) {
    return false;
  }
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
