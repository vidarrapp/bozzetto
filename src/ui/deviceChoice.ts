import { signOut, signedInOnDevice } from '../admin/api';
import { declineKeeping, deviceChoice, keepOnDevice, mayStore, onDeviceChoice } from './deviceStorage';
import { failNotice } from '../sculpt/ui/statusToast';
import { accountsOn, getMe } from '../net/account';

/**
 * The first-visit question: keep work on this device, or not (the owner's
 * call). It is the app's own window (the install card's look, as the
 * sign-in window and the delete question have), with two steps in it:
 *
 *   1. "Keep your work on this device?" Keep on this device (the
 *      recommended action, lime) and Do not keep (grey). A choice is
 *      required, so Esc and a press beside the window do nothing.
 *   2. "Turn saving off?" Turn saving off (red) and Go back (grey). Esc
 *      and a press beside the window mean Go back.
 *
 * Keyboard focus starts on the lime button and stays in the window. The
 * page stands down while it is up (`has-modal`).
 *
 * Hooks for tests: `.bz-device`, `.bz-device-keep`, `.bz-device-decline`,
 * `.bz-device-off`, `.bz-device-back`.
 */

type Answer = 'keep' | 'off' | 'back';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(label: string, className: string): HTMLButtonElement {
  const b = make('button', className, label);
  b.type = 'button';
  return b;
}

/** The window, from step 1 or straight to step 2. Resolves with what was chosen; step 2 may end in 'back'. */
interface WindowOptions {
  /** Start at the first question (else straight to the second). */
  first: boolean;
  /** An opening sentence saying why it is asked now (an action that needs saving on). */
  intro?: string;
  /** A choice exists already and this is the action's question: Esc, and Go back, cancel it. */
  cancellable?: boolean;
  /** The second question says that turning saving off signs the person out here. */
  signOutNote?: boolean;
  /** A workspace is waiting on the answer and the page is empty: the logotype stands above the window, on the strip's ground. */
  blank?: boolean;
}

function openWindow({ first, intro, cancellable = false, signOutNote = false, blank = false }: WindowOptions): Promise<Answer> {
  return new Promise((resolve) => {
    const overlay = make('div', 'install-overlay bz-device');
    const card = make('div', 'install-card account-card bz-device__card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    if (blank) {
      overlay.classList.add('bz-device--blank');
      const stack = make('div', 'bz-device__stack');
      const logo = make('img', 'bz-device__logo');
      logo.src = '/assets/bozzetto-script-ink.svg';
      logo.alt = 'Bozzetto';
      stack.append(logo, card);
      overlay.appendChild(stack);
    } else overlay.appendChild(card);
    let step: 1 | 2 = first ? 1 : 2;
    let primary: HTMLButtonElement;
    // Opened over Preferences, the page is already standing down: leave it so.
    const hadModal = document.body.classList.contains('has-modal');

    const finish = (answer: Answer): void => {
      document.removeEventListener('keydown', onKey, true);
      if (!hadModal) document.body.classList.remove('has-modal');
      overlay.remove();
      resolve(answer);
    };

    const draw = (): void => {
      const body = make('div', 'account-body');
      card.replaceChildren(body);
      const h = make('h2', 'account-title');
      h.id = 'bz-device-title';
      card.setAttribute('aria-labelledby', h.id);
      const actions = make('div', 'account-actions');
      if (step === 1) {
        h.textContent = 'Keep your work on this device?';
        const why = intro ? make('p', 'account-lede bz-device__why', intro) : null;
        const p1 = make(
          'p',
          'account-lede',
          'Bozzetto saves your work, your settings and an offline copy of the app in this browser. ' +
            'Nothing is uploaded unless you sign in and save. There are no ads and no tracking.',
        );
        const p2 = make('p', 'account-lede');
        const link = make('a', 'account-legal', 'Privacy notice');
        link.href = '/legal/privacy.html';
        link.target = '_blank';
        link.rel = 'noopener';
        p2.appendChild(link);
        const keep = btn('Keep on this device', 'btn btn--recommended bz-device-keep');
        const decline = btn('Do not keep', 'btn bz-device-decline');
        keep.addEventListener('click', () => finish('keep'));
        decline.addEventListener('click', () => {
          step = 2;
          draw();
        });
        actions.append(keep, decline);
        if (why) body.append(h, why, p1, p2, actions);
        else body.append(h, p1, p2, actions);
        primary = keep;
      } else {
        h.textContent = 'Turn saving off?';
        const p = make(
          'p',
          'account-lede',
          'Your work will not be saved while you sculpt, and it is gone when you close or reload the page. ' +
            'The app will not work offline. Your settings will not be remembered.',
        );
        const out = signOutNote ? make('p', 'account-lede', 'This also signs you out on this device.') : null;
        const off = btn('Turn saving off', 'btn btn--danger bz-device-off');
        const back = btn('Go back', 'btn bz-device-back');
        off.addEventListener('click', () => finish('off'));
        back.addEventListener('click', () => {
          if (first && !cancellable) {
            step = 1;
            draw();
          } else finish('back');
        });
        actions.append(off, back);
        if (out) body.append(h, p, out, actions);
        else body.append(h, p, actions);
        // On the second question the safe way out holds the focus: turning
        // things off is one deliberate move away.
        primary = back;
      }
      primary.focus();
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // The first question needs an answer, unless a choice exists already and
        // this is an action's question (then Esc cancels it); the second's Esc is Go back.
        e.preventDefault();
        e.stopPropagation();
        if (step === 1 && cancellable) finish('back');
        else if (step === 2) card.querySelector<HTMLButtonElement>('.bz-device-back')?.click();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus stays in the window.
      const items = [...card.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === -1 || at === items.length - 1 ? 0 : at + 1;
      e.preventDefault();
      items[next].focus();
    };
    // A press beside the window: Go back on the second question, nothing on the first.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && step === 2) card.querySelector<HTMLButtonElement>('.bz-device-back')?.click();
    });
    // Focus that escaped (a click on the backdrop) comes back.
    overlay.addEventListener('focusout', () => {
      queueMicrotask(() => {
        if (overlay.isConnected && !card.contains(document.activeElement)) primary.focus();
      });
    });
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('has-modal');
    document.body.appendChild(overlay);
    draw();
  });
}

let asking: Promise<void> | null = null;

/** Sign out here, for a person who turns saving off while signed in; false when it could not be done. */
/**
 * Whether this browser is signed in: the remembered sign-in, or else the
 * server's answer, since the note is written only once a page has asked
 * the server and a question opened sooner would miss it.
 */
async function signedInNow(): Promise<boolean> {
  if (signedInOnDevice()) return true;
  try {
    return (await accountsOn()) && !!(await getMe());
  } catch {
    return false;
  }
}

async function signOutForOff(): Promise<boolean> {
  try {
    await signOut();
    return true;
  } catch {
    failNotice('Could not sign out, so saving stays on.');
    return false;
  }
}

/**
 * The question for a page that works without an answer (the gallery, My
 * projects, Community, Account, Review, the owner tools): a small card at
 * the foot of the window, no overlay, nothing trapped, the page behind it
 * as usable as ever. Until it is answered the state is "no choice": nothing
 * is written. Do not keep opens the second question as a window; Go back
 * leaves the card where it was. It goes when the choice is made, by the
 * card or by a question an action asked (requireSaving).
 */
export function showDeviceNotice(): void {
  if (deviceChoice() !== 'none' || document.querySelector('.bz-device-notice')) return;
  const card = make('section', 'bz-device-notice');
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'bz-device-notice-title');
  const h = make('h2', 'bz-device-notice__title', 'Keep your work on this device?');
  h.id = 'bz-device-notice-title';
  const p = make(
    'p',
    'bz-device-notice__text',
    'Bozzetto saves your work, your settings and an offline copy of the app in this browser. Nothing is uploaded unless you sign in and save, and there are no ads and no tracking. ',
  );
  const link = make('a', 'account-legal', 'Privacy notice');
  link.href = '/legal/privacy.html';
  link.target = '_blank';
  link.rel = 'noopener';
  p.appendChild(link);
  const actions = make('div', 'bz-device-notice__actions');
  const keep = btn('Keep on this device', 'btn btn--recommended bz-device-keep');
  const decline = btn('Do not keep', 'btn bz-device-decline');
  keep.addEventListener('click', () => keepOnDevice());
  decline.addEventListener('click', () => {
    void (async () => {
      const signedIn = await signedInNow();
      if ((await openWindow({ first: false, cancellable: true, signOutNote: signedIn })) !== 'off') return;
      if (signedIn && !(await signOutForOff())) return;
      declineKeeping();
    })();
  });
  actions.append(keep, decline);
  card.append(h, p, actions);
  const stop = onDeviceChoice(() => {
    if (deviceChoice() === 'none') return;
    card.remove();
    stop();
  });
  // First in the page, so a keyboard user reaches it early; it is fixed to the foot of the window.
  document.body.prepend(card);
}

/**
 * Resolves once there is a choice: at once when there is one already, else
 * when the window has been answered. Nothing is written until then. A
 * session signed in from before the question existed is told that saying
 * no signs it out, and does.
 */
export function ensureDeviceChoice(): Promise<void> {
  if (deviceChoice() !== 'none') return Promise.resolve();
  asking ??= (async () => {
    for (;;) {
      const signedIn = await signedInNow();
      const answer = await openWindow({ first: true, signOutNote: signedIn, blank: true });
      if (answer === 'keep') keepOnDevice();
      else if (answer === 'off') {
        if (signedIn && !(await signOutForOff())) continue;
        declineKeeping();
      } else continue;
      break;
    }
  })().finally(() => {
    asking = null;
  });
  return asking;
}

/**
 * For something that needs saving on (Import OBJ, Send to Sculpt, signing
 * in): true at once when it is on; else the first question again, with
 * `why` as its opening sentence. Keep on this device turns saving on and
 * resolves true, so the caller goes on with what was asked. Anything else
 * (Turn saving off, Go back, Esc) leaves it off and resolves false.
 */
export async function requireSaving(why: string): Promise<boolean> {
  if (mayStore()) return true;
  const answer = await openWindow({ first: true, intro: why, cancellable: true });
  if (answer === 'keep') {
    keepOnDevice();
    return true;
  }
  if (answer === 'off') declineKeeping();
  return false;
}

/** Preferences, turning it off: the second question alone. True once saving is turned off. */
export async function confirmTurnOff(): Promise<boolean> {
  const signedIn = await signedInNow();
  if ((await openWindow({ first: false, signOutNote: signedIn })) !== 'off') return false;
  if (signedIn && !(await signOutForOff())) return false;
  declineKeeping();
  return true;
}
