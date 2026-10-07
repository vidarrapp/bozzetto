import { div } from '../ui/dom';
import { reloadConfig, suspensionText } from '../net/account';
import { forgetOwnerCaches } from '../net/ownerCaches';
import type { DesktopBridge } from './index';
import { serverAccount, type ServerAccount } from './serverAccount';

/**
 * Sign in to the server, from this panel or the Server menu: the main
 * process's sign-in window. The page's copy of the server's config is
 * asked for again afterwards, whether or not the window signed anyone in:
 * the sign-in asked the server afresh whether it has accounts, and the
 * page must not go on choosing routes by an answer from before it.
 */
export async function signInToServer(bridge: DesktopBridge): Promise<void> {
  try {
    await bridge.signIn();
  } finally {
    void reloadConfig();
  }
}

/**
 * Sign out of the server, from this panel or the Server menu: the main
 * process asks the server to end the account's session, where there is
 * one, then drops every cookie - the account's or Access's - and the
 * cached answers go too, as the web's Sign out drops them. The app has no
 * service worker, so today there are none; the call keeps the two
 * sign-outs the same. False when the server was not reached to end the
 * session, which this device has let go all the same.
 */
export async function signOutOfServer(bridge: DesktopBridge): Promise<boolean> {
  const { revoked } = await bridge.signOut();
  await forgetOwnerCaches();
  return revoked !== false;
}

/**
 * A refusal from the main process, as its own words: Electron puts
 * "Error invoking remote method 'server:set': Error: " in front of what
 * the handler threw.
 */
function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}

/** What the panel says of where the app stands with its server. */
function statusText(s: ServerAccount): string {
  switch (s.state) {
    case 'none':
      return 'No server set — everything stays on this device.';
    case 'out':
      return `${s.url} — not signed in, so publishing will not work yet.`;
    case 'in':
      return `Signed in to ${s.url}.`;
    case 'account':
      return `Signed in to ${s.url} as @${s.me.handle}.`;
    case 'ended':
      return `${s.url} — not signed in: the sign-in here has ended. Sign in again to publish.`;
    case 'suspended':
      return `${s.url} — ${suspensionText(s.reason)}`;
    case 'unconfirmed':
      return `Signed in to ${s.url}, which did not answer just now.`;
  }
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
    const s = await serverAccount(bridge);
    input.value = s.url ?? '';
    // Signing in is meaningless without a server, and signing out is
    // meaningless without a session: say so by disabling rather than by
    // letting the click fail. A session the server has let go is signed in
    // to again (the window drops it first); a suspended one is not, since
    // no sign-in lifts it - Sign out lets it go.
    signIn.disabled = s.state === 'none' || s.state === 'in' || s.state === 'account' || s.state === 'suspended' || s.state === 'unconfirmed';
    signOut.disabled = s.state === 'none' || s.state === 'out';
    show(statusText(s));
  };

  save.addEventListener('click', () => {
    void (async () => {
      save.disabled = true;
      try {
        await bridge.setServer(input.value.trim() || null);
        // Another server is another config: accounts, where passkeys work,
        // the files host. Asked again before the page is told to look.
        void reloadConfig();
        await refresh();
        signInChanged(); // another server is another sign-in
      } catch (err) {
        // normalise() rejects a URL with a path or a non-https scheme, and
        // its message says which - worth showing verbatim.
        show(said(err), true);
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
      let failed: unknown = null;
      try {
        await signInToServer(bridge);
      } catch (err) {
        failed = err;
      }
      await refresh();
      // After the status, which would otherwise hide it: a server that did
      // not answer says so until the next try.
      if (failed !== null) show(said(failed), true);
      signInChanged();
    })();
  });

  signOut.addEventListener('click', () => {
    void (async () => {
      signOut.disabled = true;
      const ended = await signOutOfServer(bridge).catch(() => false);
      await refresh();
      if (!ended) show('Signed out on this device. The server did not answer, so the session there ends when it runs out.', true);
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
