/**
 * What Bozzetto may keep on this device, and who is allowed to ask.
 *
 * Bozzetto keeps things in the visitor's browser: the autosave and the
 * scenes kept on the device (IndexedDB), settings, hotkeys and the small
 * memories of the interface (localStorage), and the offline copy of the app
 * (the service worker and its caches). A visitor is asked once, and may say
 * no (ui/deviceChoice is the window). This module is the one answer to "may
 * we store?", and the few places that write go through it:
 *
 *   - `deviceStore`: the localStorage wrapper every persistent preference
 *     uses (settings, keymap, layouts, panel memory, hints already shown).
 *   - `openDb` in sculpt/bridge/ScenePersist: every IndexedDB write (the
 *     autosave, the library, the hand-offs) opens the database there.
 *   - ui/serviceWorker: the registration, and so every Cache write.
 *
 * Three states. NONE, nobody has answered: nothing is written, nothing is
 * read. KEEP, the choice is stored in localStorage and everything works as
 * it always did. DECLINED, nothing persistent is written; the refusal is
 * remembered for this tab session only, in sessionStorage (the one thing
 * written for it, and it is gone with the tab), so the window does not come
 * back on every page of the same visit while a new visit asks again.
 *
 * The choice is read once, at start, and then followed in memory; other
 * tabs are heard through the `storage` event. Subscribers hear every change
 * (the settings store reloads what was kept, the autosave starts, the
 * service worker registers or is removed).
 *
 * sessionStorage otherwise is left alone: what is in it is the tab's own
 * state (an invite being followed, the splash already played) and it is
 * gone when the tab closes.
 */

export type DeviceChoice = 'none' | 'keep' | 'declined';

/** localStorage: the stored choice. Tests seed it before the app loads (tests/e2e/run.mjs). */
export const CHOICE_KEY = 'bozzetto-device-choice';
/** sessionStorage: a refusal, for this tab session only. */
export const DECLINED_KEY = 'bozzetto-device-declined';

/** Thrown by a write the choice does not allow; callers already treat a throwing store as "storage refused". */
export class DeviceStorageOff extends Error {
  constructor() {
    super('Saving on this device is off');
    this.name = 'DeviceStorageOff';
  }
}

function readChoice(): DeviceChoice {
  try {
    if (localStorage.getItem(CHOICE_KEY) === 'keep') return 'keep';
  } catch {
    // Blocked storage reads as no stored choice.
  }
  try {
    if (sessionStorage.getItem(DECLINED_KEY) === '1') return 'declined';
  } catch {
    // The decline then lasts as long as this page does (the variable below).
  }
  return 'none';
}

let choice: DeviceChoice = readChoice();
type Listener = (choice: DeviceChoice) => void;
const listeners = new Set<Listener>();

export function deviceChoice(): DeviceChoice {
  return choice;
}

/** Whether anything may be written to this device. */
export function mayStore(): boolean {
  return choice === 'keep';
}

/** Hear every change of the choice. Returns the way to stop. */
export function onDeviceChoice(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(next: DeviceChoice): void {
  if (next === choice) return;
  choice = next;
  for (const fn of [...listeners]) {
    try {
      fn(choice);
    } catch (err) {
      console.error(err);
    }
  }
}

/** Keep things on this device: stored, and from now on everything that was waiting may write. */
export function keepOnDevice(): void {
  try {
    localStorage.setItem(CHOICE_KEY, 'keep');
  } catch {
    // Storage blocked: it holds for this page, and asks again on the next.
  }
  try {
    sessionStorage.removeItem(DECLINED_KEY);
  } catch {
    // Nothing to remove.
  }
  set('keep');
}

/**
 * Do not keep anything. The stored choice goes (what is already kept is
 * left as it is, and a new visit asks again); the refusal is remembered for
 * this tab session only.
 */
export function declineKeeping(): void {
  try {
    localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Blocked: nothing stored to remove.
  }
  try {
    sessionStorage.setItem(DECLINED_KEY, '1');
  } catch {
    // Remembered for this page only.
  }
  set('declined');
}

window.addEventListener('storage', (e) => {
  // Another tab answered (or switched it): follow, so no tab writes on a choice that is gone.
  if (e.key === CHOICE_KEY || e.key === null) {
    const stored = ((): boolean => {
      try {
        return localStorage.getItem(CHOICE_KEY) === 'keep';
      } catch {
        return false;
      }
    })();
    if (stored) set('keep');
    else if (choice === 'keep') set('declined');
  }
});

/**
 * localStorage, as the choice allows it. Reads answer null and removals do
 * nothing unless the choice is to keep (what an earlier visit left is not
 * read into a session that has not been allowed to keep, nor touched); a
 * write throws DeviceStorageOff, which is how every caller already reads a
 * private window.
 */
export const deviceStore = {
  get(key: string): string | null {
    return mayStore() ? localStorage.getItem(key) : null;
  },
  set(key: string, value: string): void {
    if (!mayStore()) throw new DeviceStorageOff();
    localStorage.setItem(key, value);
  },
  remove(key: string): void {
    if (mayStore()) localStorage.removeItem(key);
  },
};
