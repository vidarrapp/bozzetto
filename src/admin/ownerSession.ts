import { errorText } from '../net/account';
import { OwnerSessionError, failureText } from './api';

/**
 * The owner tools' second lock, as the page meets it (docs/accounts.md §2,
 * §8). Once the owner has an account, Cloudflare Access alone no longer
 * opens /admin/api: the owner's own session must come with it, and an
 * owner route without it answers 403 owner_session. The page then opens
 * the sign-in dialog over itself, and tries again once signed in.
 *
 * The dialog opens by itself once a page load; after that, the page offers
 * a Sign in button instead, so closing the dialog does not bring it back
 * at once.
 */

const REASON = "Owner tools need you signed in to the owner's account.";

let asked = false;

/**
 * Sign in for the owner tools: true once the owner's account is signed in.
 * `auto` is a page asking on its own, which happens once a load; a click
 * asks every time. A sign-in to an account that is not the owner's is
 * said, and is false.
 */
export async function ownerSignIn(auto = false): Promise<boolean> {
  if (auto && asked) return false;
  asked = true;
  try {
    const { openSignIn } = await import('../ui/account/signIn');
    const me = await openSignIn({ reason: REASON });
    if (!me) return false;
    if (me.role !== 'owner') {
      alert(`Signed in as @${me.handle}, which is not the owner's account. Owner tools need the owner's own sign-in.`);
      return false;
    }
    return true;
  } catch (err) {
    alert(`Could not open the sign-in: ${errorText(err)}`);
    return false;
  }
}

/** What the page says while the second lock is shut, with the way to open it. */
export function ownerSignInPanel(retry: () => void): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'admin__lock';
  const words = document.createElement('p');
  words.textContent = REASON;
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn btn--primary';
  go.textContent = 'Sign in';
  go.addEventListener('click', () => {
    go.disabled = true;
    void ownerSignIn().then((ok) => {
      go.disabled = false;
      if (ok) retry();
    });
  });
  panel.append(words, go);
  return panel;
}

/**
 * An owner tool's call with the second lock mended in place, for the tabs
 * over accounts (Invites, Users, Audit): refused for want of the owner's
 * session (OwnerSessionError), the sign-in dialog opens over the page and
 * the call is made again once signed in. `auto` is a tab loading itself,
 * whose dialog opens by itself once a load, as the Projects list's does; a
 * button pressed asks every time. Null when the owner did not sign in, for
 * the caller to show ownerSignInPanel; any other refusal is thrown.
 */
export async function asOwner<T>(call: () => Promise<T>, auto = false): Promise<T | null> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof OwnerSessionError)) throw err;
    if (!(await ownerSignIn(auto))) return null;
    return call();
  }
}

/** A failure as the owner's tabs say one: a sentence, capitalised and stopped. */
export function failureSentence(err: unknown): string {
  const text = failureText(err).trim();
  if (!text) return 'Something went wrong.';
  const capital = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
