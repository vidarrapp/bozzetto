import { AccountError, getMe, type Me } from '../net/account';
import type { DesktopBridge } from './index';

/**
 * Where the desktop app stands with its server (docs/accounts.md §2), as
 * Server settings says it and as the app's own checks ask it. The main
 * process knows only which cookie the jar holds (server:get); with
 * accounts, whether the session behind it still holds is the server's to
 * say, at GET /api/me, through the proxy.
 *
 * - `none`: no server set.
 * - `out`: no cookie for it.
 * - `in`: Cloudflare Access's cookie, on a server without accounts (or
 *   one that could not say), taken at its word as it always was.
 * - `account`: the account's session, confirmed: who it is.
 * - `ended`: a session cookie the server no longer knows (401): signed out
 *   elsewhere, or past its time.
 * - `suspended`: the account's session, suspended (403): no sign-in lifts it.
 * - `unconfirmed`: a session cookie, and no answer from the server.
 */
export type ServerAccount =
  | { state: 'none'; url: null }
  | { state: 'out' | 'in'; url: string; accounts: boolean | null }
  | { state: 'account'; url: string; accounts: true; me: Me }
  | { state: 'ended' | 'unconfirmed'; url: string; accounts: true }
  | { state: 'suspended'; url: string; accounts: true; reason: string | null };

export async function serverAccount(bridge: DesktopBridge): Promise<ServerAccount> {
  const { url, signedIn, accounts } = await bridge.getServer();
  if (!url) return { state: 'none', url: null };
  if (!signedIn) return { state: 'out', url, accounts };
  if (accounts !== true) return { state: 'in', url, accounts };
  try {
    const me = await getMe();
    return me ? { state: 'account', url, accounts, me } : { state: 'ended', url, accounts };
  } catch (err) {
    if (err instanceof AccountError && err.code === 'suspended') {
      return { state: 'suspended', url, accounts, reason: typeof err.body.reason === 'string' ? err.body.reason : null };
    }
    return { state: 'unconfirmed', url, accounts };
  }
}

/**
 * Whether the owner is signed in to the app's server, by what the server
 * says: with accounts, the session the app holds is the owner's account;
 * without them, Access's cookie is in the jar, as it was all the owner
 * had. False outside the app. The bridge is read here rather than through
 * desktop/index, so the web's chunks that ask need not carry the app's
 * menus and panels.
 */
export async function ownerSignedIn(): Promise<boolean> {
  const bridge = (window as unknown as { bozzettoDesktop?: DesktopBridge }).bozzettoDesktop;
  if (!bridge) return false;
  const s = await serverAccount(bridge);
  return s.state === 'in' || (s.state === 'account' && s.me.role === 'owner');
}
