import { div } from '../ui/dom';
import { forgetOwnerCaches } from '../net/ownerCaches';
import type { DesktopBridge } from './index';

/**
 * Sign out of the server, from this panel or the Server menu: the main
 * process drops the Access cookie, and the owner's cached answers go too,
 * as the web's Sign out drops them. The app has no service worker, so
 * today there are none; the call keeps the two sign-outs the same.
 */
export async function signOutOfServer(bridge: DesktopBridge): Promise<void> {
  await bridge.signOut();
  await forgetOwnerCaches();
}

/**
 * Server settings: which Cloudflare deployment to publish to, and whether
 * you are signed in to it.
 *
 * An in-app panel rather than window.prompt, for the same reason the
 * recovery question stopped being window.confirm: those block the
 * renderer, and a blocked renderer in a desktop app reads as a hang. It is
 * also the only place that explains what the setting is FOR - Bozzetto
 * works entirely offline, and this is opt-in.
 */
export function serverSettings(
  bridge: DesktopBridge,
  /** The sign-in changed here: the page asks again who it is for. */
  signInChanged: () => void,
): {
  root: HTMLElement;
  open: () => Promise<void>;
  close: () => void;
} {
  const root = div('dsettings');
  root.hidden = true;

  const card = div('dsettings__card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Server settings');

  const title = document.createElement('h2');
  title.className = 'dsettings__title';
  title.textContent = 'Publishing server';

  const blurb = div('dsettings__blurb');
  blurb.textContent =
    'Bozzetto works entirely on this device. Set a server only if you want to publish ' +
    'to your own Cloudflare deployment.';

  const label = document.createElement('label');
  label.className = 'dsettings__label';
  label.textContent = 'Site root';
  const input = document.createElement('input');
  input.type = 'url';
  input.className = 'dsettings__input';
  input.placeholder = 'https://example.com';
  input.autocomplete = 'off';
  label.appendChild(input);

  const hint = div('dsettings__hint');
  hint.textContent = 'Just the root, with no path — the API lives at /api on the same host.';

  const status = div('dsettings__status');
  const error = div('dsettings__error');
  error.hidden = true;

  const row = div('dsettings__row');
  const signIn = button('Sign in', 'sculpt-panel__btn');
  const signOut = button('Sign out', 'sculpt-panel__btn');
  const save = button('Save', 'sculpt-panel__btn dsettings__primary');
  const close = button('Close', 'sculpt-panel__btn');
  row.append(signIn, signOut, save, close);

  card.append(title, blurb, label, hint, status, error, row);
  root.appendChild(card);

  function button(text: string, cls: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    return b;
  }

  const show = (msg: string, isError = false): void => {
    if (isError) {
      error.textContent = msg;
      error.hidden = false;
    } else {
      status.textContent = msg;
      error.hidden = true;
    }
  };

  const refresh = async (): Promise<void> => {
    const { url, signedIn } = await bridge.getServer();
    input.value = url ?? '';
    // Signing in is meaningless without a server, and signing out is
    // meaningless without a session: say so by disabling rather than by
    // letting the click fail.
    signIn.disabled = !url || signedIn;
    signOut.disabled = !signedIn;
    show(
      !url
        ? 'No server set — everything stays on this device.'
        : signedIn
          ? `Signed in to ${url}.`
          : `${url} — not signed in, so publishing will not work yet.`,
    );
  };

  save.addEventListener('click', () => {
    void (async () => {
      save.disabled = true;
      try {
        await bridge.setServer(input.value.trim() || null);
        await refresh();
        signInChanged(); // another server is another sign-in
      } catch (err) {
        // normalise() rejects a URL with a path or a non-https scheme, and
        // its message says which - worth showing verbatim.
        show(err instanceof Error ? err.message : String(err), true);
      } finally {
        save.disabled = false;
      }
    })();
  });

  // Either way the page is told: without it, the publish forms and Save to
  // Library went on acting on the sign-in the page found when it loaded.
  signIn.addEventListener('click', () => {
    void (async () => {
      signIn.disabled = true;
      show('Opening the sign-in window…');
      try {
        await bridge.signIn();
      } catch (err) {
        show(err instanceof Error ? err.message : String(err), true);
      }
      await refresh();
      signInChanged();
    })();
  });

  signOut.addEventListener('click', () => {
    void (async () => {
      await signOutOfServer(bridge);
      await refresh();
      signInChanged();
    })();
  });

  const hide = (): void => {
    root.hidden = true;
  };
  close.addEventListener('click', hide);
  root.addEventListener('click', (e) => {
    if (e.target === root) hide(); // click the backdrop, not the card
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });

  return {
    root,
    open: async () => {
      root.hidden = false;
      await refresh();
      input.focus();
    },
    close: hide,
  };
}
