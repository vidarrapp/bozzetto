import { div } from './dom';
import { ACTIONS, chordOf, chordParts, keymap, type ActionDef, type KeyMode } from './keymap';

/**
 * Preferences: the hotkey editor. Every keyed action in both modes, with
 * its current chord; click one, press the new key. The keymap is the
 * single source the handlers and the guide read, so a change is live at
 * once and shows up in the guide.
 *
 * A modal, like the server settings: while it is up the body carries
 * `has-modal` and the key handlers stand down, which is also what lets
 * the capture step take any key - including the ones that would have
 * meant something.
 */

let mounted: { root: HTMLElement; open: (mode: KeyMode) => void } | null = null;

export function showPreferences(mode: KeyMode = currentMode()): void {
  if (!mounted) {
    mounted = build();
    document.body.appendChild(mounted.root);
  }
  mounted.open(mode);
}

/** Sculpt mode announces itself on the window; the editor opens on that tab. */
let sculptActive = false;
window.addEventListener('bozzetto:sculptmode', (e) => {
  sculptActive = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
});
function currentMode(): KeyMode {
  return sculptActive ? 'sculpt' : 'view';
}

function build(): { root: HTMLElement; open: (mode: KeyMode) => void } {
  const root = div('dsettings prefs');
  root.hidden = true;
  const card = div('dsettings__card prefs__card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Preferences');

  const title = document.createElement('h2');
  title.className = 'dsettings__title';
  title.textContent = 'Preferences';
  const blurb = div('dsettings__blurb');
  blurb.textContent =
    'Hotkeys. Click a key to change it, then press the new one; Esc cancels. Saved in this browser.';

  const tabs = div('prefs__tabs');
  const list = div('prefs__list');
  let mode: KeyMode = 'sculpt';
  const tabButtons = new Map<KeyMode, HTMLButtonElement>();
  for (const [m, label] of [
    ['sculpt', 'Sculpt'],
    ['view', 'Viewer'],
  ] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'prefs__tab';
    b.textContent = label;
    b.addEventListener('click', () => {
      mode = m;
      render();
    });
    tabs.appendChild(b);
    tabButtons.set(m, b);
  }

  const row = div('dsettings__row');
  const resetAll = button('Reset all', 'sculpt-panel__btn');
  const close = button('Close', 'sculpt-panel__btn dsettings__primary');
  row.append(resetAll, close);
  card.append(title, blurb, tabs, list, row);
  root.appendChild(card);

  // --- the capture step -------------------------------------------------
  let capturing: ActionDef | null = null;
  const capture = div('prefs__capture');
  capture.hidden = true;
  const captureText = div('prefs__capture-text');
  const captureHint = div('dsettings__hint');
  captureHint.textContent = 'Esc cancels. Click outside to cancel.';
  capture.append(captureText, captureHint);
  card.appendChild(capture);

  const endCapture = (): void => {
    capturing = null;
    capture.hidden = true;
    window.removeEventListener('keydown', onCaptureKey, true);
  };
  const beginCapture = (a: ActionDef): void => {
    capturing = a;
    captureText.textContent = `Press a key for "${a.label}"`;
    capture.hidden = false;
    window.addEventListener('keydown', onCaptureKey, true);
  };
  const onCaptureKey = (e: KeyboardEvent): void => {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      endCapture();
      return;
    }
    const chord = chordOf(e);
    if (!chord) return; // a bare modifier: keep waiting for the key
    const taken = keymap.conflictFor(capturing.id, chord);
    if (taken && !confirm(`${chordParts(chord).join(' + ')} is "${taken.label}". Take it?`)) {
      return; // still capturing
    }
    keymap.rebind(capturing.id, chord);
    endCapture();
    render();
  };

  // --- the list ---------------------------------------------------------
  function render(): void {
    for (const [m, b] of tabButtons) b.classList.toggle('prefs__tab--on', m === mode);
    list.replaceChildren();
    let group = '';
    for (const a of keymap.actionsFor(mode)) {
      // Gesture rows have no key to edit; they live in the guide.
      if (a.chord === null && !keymap.isOverridden(a.id)) continue;
      if (a.group !== group) {
        group = a.group;
        const h = div('prefs__group');
        h.textContent = group;
        list.appendChild(h);
      }
      const r = div('prefs__row');
      const label = document.createElement('span');
      label.className = 'prefs__label';
      label.textContent = a.label;
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'prefs__key';
      const chord = keymap.chordFor(a.id);
      if (chord) {
        for (const part of chordParts(chord)) {
          const k = document.createElement('kbd');
          k.textContent = part;
          key.appendChild(k);
        }
      } else {
        key.textContent = 'none';
        key.classList.add('prefs__key--none');
      }
      key.title = 'Click, then press the new key';
      key.addEventListener('click', () => beginCapture(a));
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'prefs__reset';
      reset.textContent = '↺';
      reset.title = 'Back to the default';
      reset.setAttribute('aria-label', `Reset ${a.label} to its default key`);
      reset.hidden = !keymap.isOverridden(a.id);
      reset.addEventListener('click', () => {
        keymap.reset(a.id);
        render();
      });
      r.append(label, key, reset);
      list.appendChild(r);
    }
  }

  const hide = (): void => {
    endCapture();
    root.hidden = true;
    document.body.classList.remove('has-modal');
  };
  close.addEventListener('click', hide);
  resetAll.addEventListener('click', () => {
    if (!confirm('Put every hotkey back to its default?')) return;
    keymap.resetAll();
    render();
  });
  root.addEventListener('pointerdown', (e) => {
    // The backdrop closes; a press outside the capture box cancels a capture.
    if (capturing) {
      if (!capture.contains(e.target as Node)) endCapture();
      return;
    }
    if (e.target === root) hide();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !capturing) {
      hide();
      e.preventDefault();
      e.stopPropagation();
    }
  });

  return {
    root,
    open: (m) => {
      mode = m;
      render();
      root.hidden = false;
      document.body.classList.add('has-modal');
      close.focus();
    },
  };
}

function button(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  return b;
}

/** The guide asks: is any of these actions bound to something? */
export function anyBound(ids: string[]): boolean {
  return ids.some((id) => keymap.chordFor(id) !== null);
}

export { ACTIONS };
