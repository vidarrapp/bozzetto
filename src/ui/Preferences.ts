import { div } from './dom';
import { ACTIONS, chordOf, chordParts, keymap, type ActionDef, type KeyMode } from './keymap';
import { rangeOf, settings, type OnOff, type SettingsValues } from './settings';

/**
 * Preferences: what a finger does, how solid the panels are, how frames are
 * drawn while things move, the diagnostic overlays, then the hotkey editor. Every keyed action in
 * both modes, with its current chord; click one, press the new key. The
 * keymap is the single source the handlers and the guide read, so a change
 * is live at once and shows up in the guide; the settings store is read
 * the same way, at the next press or the next frame.
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
let announced: KeyMode = 'view';
window.addEventListener('bozzetto:sculptmode', (e) => {
  const detail = (e as CustomEvent<{ active?: boolean; mode?: KeyMode }>).detail;
  announced = detail?.mode ?? (detail?.active ? 'sculpt' : 'view');
});
function currentMode(): KeyMode {
  return announced;
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
  blurb.textContent = 'Saved in this browser.';

  // Fingers first: on an iPad it is the choice that decides whether the
  // app is usable at all, and it has no key to find it by.
  const touchHead = div('prefs__group');
  touchHead.textContent = 'Touch (Sculpt)';
  const fingers = choiceGroup<SettingsValues['fingers']>(
    'fingers',
    [
      [
        'navigate',
        'Fingers: navigate only',
        'One finger orbits and two pan and zoom, in every tool. Only the pen and the mouse sculpt, select and move objects.',
      ],
      [
        'sculpt',
        'Fingers sculpt too',
        'For working without a pen: a finger on the model sculpts as the mouse does. Two fingers still pan and zoom.',
      ],
    ],
    (v) => settings.set('fingers', v),
  );

  // How solid the panels are, tried by dragging (owner request): every
  // value shows on the panels as the slider passes it.
  const appearanceHead = div('prefs__group');
  appearanceHead.textContent = 'Appearance';
  const opacity = panelOpacityRow();

  // How frames are drawn while things move (Viewer.updateFrameMode).
  const perfHead = div('prefs__group');
  perfHead.textContent = 'Performance';
  const lookQuestion = div('prefs__question');
  lookQuestion.textContent = 'While sculpting, posing or moving the view';
  const look = choiceGroup<SettingsValues['interactionLook']>(
    'interactionLook',
    [
      [
        'fast',
        'Fast frames',
        'Ambient occlusion holds still under a stroke and steps aside while the view or a pose moves, and the fill and rim shadows redraw less often, so each frame keeps up with the pen. All of it is back as you let go.',
      ],
      ['full', 'Full look', 'Every frame is drawn in full, as a still one is.'],
    ],
    (v) => settings.set('interactionLook', v),
  );

  // The overlays that say what a device is doing, kept on across reloads,
  // so the web version needs no URL parameters for them.
  const diagHead = div('prefs__group');
  diagHead.textContent = 'Diagnostics';
  const meter = toggleRow(
    'meter',
    'Frame meter',
    "Frame rate, where each frame's time goes (CPU, GPU and the display's budget) and which side is short. P shows and hides it.",
  );
  const stallLog = toggleRow(
    'stallLog',
    'Stall log',
    'Every pause between frames longer than 300 ms, and how long the heavy jobs took, newest first.',
  );
  const inputLog = toggleRow(
    'inputLog',
    'Input log',
    'Pointer and touch events as the browser delivers them, and what Sculpt did with each.',
  );

  const keysHead = div('prefs__group');
  keysHead.textContent = 'Hotkeys';
  const keysBlurb = div('dsettings__hint');
  keysBlurb.textContent = 'Click a key to change it, then press the new one; Esc cancels.';

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
  // Everything between the title and the buttons scrolls as one, so the
  // buttons stay on screen however many groups there are.
  const body = div('prefs__body');
  body.append(
    touchHead,
    fingers.root,
    appearanceHead,
    opacity.root,
    perfHead,
    lookQuestion,
    look.root,
    diagHead,
    meter.root,
    stallLog.root,
    inputLog.root,
    keysHead,
    keysBlurb,
    tabs,
    list,
  );
  card.append(title, blurb, body, row);
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
      if (a.gesture) continue;
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
    window.removeEventListener('keydown', onWindowKey, true);
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
  // Escape closes the window from wherever focus sits (a re-rendered list
  // drops it on the body), so the listener is on the window, and only
  // while the window is up.
  const onWindowKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !capturing) {
      hide();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return {
    root,
    open: (m) => {
      mode = m;
      fingers.set(settings.get('fingers'));
      look.set(settings.get('interactionLook'));
      opacity.sync();
      for (const t of [meter, stallLog, inputLog]) t.sync();
      render();
      root.hidden = false;
      document.body.classList.add('has-modal');
      window.addEventListener('keydown', onWindowKey, true);
      close.focus();
    },
  };
}

/**
 * A set of radio rows, each a title over a line of explanation. `set`
 * re-reads the stored value into the buttons when the window opens.
 */
function choiceGroup<V extends string>(
  name: string,
  options: ReadonlyArray<readonly [V, string, string]>,
  onPick: (value: V) => void,
): { root: HTMLElement; set: (value: V) => void } {
  const root = div('prefs__choices');
  root.setAttribute('role', 'radiogroup');
  root.dataset.setting = name;
  const inputs = new Map<V, HTMLInputElement>();
  for (const [value, label, hint] of options) {
    const row = document.createElement('label');
    row.className = 'prefs__choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `prefs-${name}`;
    input.value = value;
    input.addEventListener('change', () => {
      if (input.checked) onPick(value);
    });
    const text = div('prefs__choice-text');
    const head = div('prefs__choice-title');
    head.textContent = label;
    const note = div('prefs__choice-hint');
    note.textContent = hint;
    text.append(head, note);
    row.append(input, text);
    root.appendChild(row);
    inputs.set(value, input);
  }
  return {
    root,
    set: (value) => {
      for (const [v, input] of inputs) input.checked = v === value;
    },
  };
}

/** The settings that are a box to tick. */
type OnOffKey = { [K in keyof SettingsValues]: SettingsValues[K] extends OnOff ? K : never }[keyof SettingsValues];

/**
 * A checkbox row with a title over a line of explanation, bound to an
 * on/off setting. `sync` re-reads the stored value when the window opens,
 * and the row also follows the setting while it is up (P toggles the
 * meter's with the window closed, but a test or the console may not).
 */
function toggleRow(key: OnOffKey, label: string, hint: string): { root: HTMLElement; sync: () => void } {
  const root = document.createElement('label');
  root.className = 'prefs__choice prefs__toggle';
  root.dataset.setting = key;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => settings.set(key, input.checked ? 'on' : 'off'));
  const text = div('prefs__choice-text');
  const head = div('prefs__choice-title');
  head.textContent = label;
  const note = div('prefs__choice-hint');
  note.textContent = hint;
  text.append(head, note);
  root.append(input, text);
  const sync = (): void => {
    input.checked = settings.get(key) === 'on';
  };
  settings.onChange(sync);
  sync();
  return { root, sync };
}

/**
 * Panel opacity: a slider over the setting's range, each value applied and
 * kept as it is dragged (appearance.ts puts it on the panels), with the
 * value beside the title and a line on what it does underneath.
 */
function panelOpacityRow(): { root: HTMLElement; sync: () => void } {
  const { min, max } = rangeOf('panelOpacity');
  const root = div('prefs__slider');
  root.dataset.setting = 'panelOpacity';
  const head = div('prefs__slider-head');
  const title = div('prefs__choice-title');
  title.textContent = 'Panel opacity';
  const value = div('prefs__slider-value');
  head.append(title, value);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.dataset.unit = '%';
  input.setAttribute('aria-label', 'Panel opacity');
  input.addEventListener('input', () => settings.set('panelOpacity', Number(input.value)));
  const hint = div('prefs__choice-hint');
  hint.textContent = 'How much of the view shows through the panels. At 100% they are solid.';
  root.append(head, input, hint);
  const sync = (): void => {
    const v = settings.get('panelOpacity');
    input.value = String(v);
    value.textContent = `${v}%`;
  };
  settings.onChange(sync);
  sync();
  return { root, sync };
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
