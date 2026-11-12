import { declineKeeping, deviceChoice, keepOnDevice } from './deviceStorage';

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
function openWindow(first: boolean): Promise<Answer> {
  return new Promise((resolve) => {
    const overlay = make('div', 'install-overlay bz-device');
    const card = make('div', 'install-card account-card bz-device__card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    overlay.appendChild(card);
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
      card.replaceChildren();
      const h = make('h2', 'account-title');
      h.id = 'bz-device-title';
      card.setAttribute('aria-labelledby', h.id);
      const actions = make('div', 'account-actions');
      if (step === 1) {
        h.textContent = 'Keep your work on this device?';
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
        card.append(h, p1, p2, actions);
        primary = keep;
      } else {
        h.textContent = 'Turn saving off?';
        const p = make(
          'p',
          'account-lede',
          'Your work will not be saved while you sculpt, and it is gone when you close or reload the page. ' +
            'The app will not work offline. Your settings will not be remembered.',
        );
        const off = btn('Turn saving off', 'btn btn--danger bz-device-off');
        const back = btn('Go back', 'btn bz-device-back');
        off.addEventListener('click', () => finish('off'));
        back.addEventListener('click', () => {
          if (first) {
            step = 1;
            draw();
          } else finish('back');
        });
        actions.append(off, back);
        card.append(h, p, actions);
        // On the second question the safe way out holds the focus: turning
        // things off is one deliberate move away.
        primary = back;
      }
      primary.focus();
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // The first question needs an answer; the second's Esc is Go back.
        e.preventDefault();
        e.stopPropagation();
        if (step === 2) card.querySelector<HTMLButtonElement>('.bz-device-back')?.click();
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

/**
 * Resolves once there is a choice: at once when there is one already, else
 * when the window has been answered. Nothing is written until then.
 */
export function ensureDeviceChoice(): Promise<void> {
  if (deviceChoice() !== 'none') return Promise.resolve();
  asking ??= (async () => {
    for (;;) {
      const answer = await openWindow(true);
      if (answer === 'keep') keepOnDevice();
      else if (answer === 'off') declineKeeping();
      else continue;
      break;
    }
  })().finally(() => {
    asking = null;
  });
  return asking;
}

/** Preferences, turning it off: the second question alone. True once saving is turned off. */
export async function confirmTurnOff(): Promise<boolean> {
  if ((await openWindow(false)) !== 'off') return false;
  declineKeeping();
  return true;
}
