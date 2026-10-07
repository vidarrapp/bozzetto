import { rememberInvite, signInForDesktopApp } from '../../net/account';

/**
 * The sign-in links (docs/accounts.md §7), all queries on `/` so the
 * worker's shell answers them offline as well:
 *
 * - `/?signin` opens the sign-in dialog over the gallery; `/?signin=desktop`
 *   is the desktop app's sign-in window (docs/accounts.md §2), whose
 *   session the app goes on to use: its sign-ins say so (net/account
 *   signInForDesktopApp), and the service worker stays out of it
 *   (ui/serviceWorker);
 * - `/?invite=<token>` opens Join, the token moved to this tab's
 *   sessionStorage first;
 * - `/?link=<token>` is a code mail's sign-in link, posted once.
 *
 * Each is taken off the address as it is read, before anything else runs,
 * so a reload or a shared address does not carry it on, and a link's
 * token is never left in the history. Kept in the main bundle, small: the
 * dialog itself loads only when one of them is there.
 */
export type AccountLink = { kind: 'signin' } | { kind: 'join' } | { kind: 'link'; token: string };

/** A link's token: 32 bytes as base64url (functions/_shared/auth/codes.ts). */
const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** An invite's: 16 bytes as base64url. */
const INVITE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The sign-in link the address carries, if any, taken off it. */
export function takeAccountLink(): AccountLink | null {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  let link: AccountLink | null = null;
  if (params.has('link')) {
    const token = params.get('link') ?? '';
    link = LINK_TOKEN.test(token) ? { kind: 'link', token } : null;
  } else if (params.has('invite')) {
    const token = params.get('invite') ?? '';
    if (INVITE_TOKEN.test(token)) rememberInvite(token);
    link = { kind: 'join' };
  } else if (params.has('signin')) {
    if (params.get('signin') === 'desktop') signInForDesktopApp();
    link = { kind: 'signin' };
  }
  const had = ['link', 'invite', 'signin'].filter((k) => params.has(k));
  if (had.length > 0) {
    for (const k of had) params.delete(k);
    const query = params.toString();
    history.replaceState(history.state, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
  }
  return link;
}
