import { topbarRight } from './topbar';
import { chordLabel, chordParts, keymap, type KeyMode } from './keymap';
import { showPreferences } from './Preferences';
import { checkForUpdates, onUpdates, updateStatus, updatesAvailable } from './updates';
import { APP_VERSION } from './version';

/**
 * Hotkey guide for the viewer: a dismissible top-left hint ("Press H …") that
 * fades after a few seconds, plus a left-side overlay listing every shortcut,
 * toggled by H (or by clicking it).
 */
/**
 * The guide is drawn from the keymap, so a rebind shows up here the way it
 * shows up under the fingers. Gesture rows (drag, scroll, double-click)
 * come from the same table with a note instead of a chord.
 */
function guideHtml(mode: KeyMode, updates: boolean): string {
  const esc = (t: string): string =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const closeKey = keymap.chordFor('ui.help');
  const head = mode === 'sculpt' ? 'Sculpt hotkeys' : mode === 'armature' ? 'Armature hotkeys' : 'Hotkeys &amp; navigation';
  const closer = closeKey ? `${esc(chordLabel(closeKey))} to close` : 'click to close';
  let html = `<div class="help-guide__head">${head} <span class="help-guide__close">${closer}</span></div>`;
  let group = '';
  let open = false;
  for (const a of keymap.actionsFor(mode)) {
    const chord = keymap.chordFor(a.id);
    const gesture = !!a.gesture;
    if (!gesture && !chord) continue; // unbound: nothing to press
    if (a.group !== group) {
      if (open) html += '</div>';
      group = a.group;
      html += `<div class="help-guide__group"><div class="help-guide__title">${esc(group)}</div>`;
      open = true;
    }
    const key = gesture
      ? `<span class="help-key">${esc(a.note ?? '')}</span>`
      : chordParts(chord!)
          .map((p) => `<kbd>${esc(p)}</kbd>`)
          .join('+');
    html += `<div class="help-row">${key}<span>${esc(a.label)}</span></div>`;
  }
  if (open) html += '</div>';
  html += `<div class="help-guide__foot"><button type="button" class="help-guide__prefs">Customise hotkeys…</button>`;
  // Which build this is, so "am I on the new one?" has an answer on the
  // device itself. Checking needs a service worker, which the desktop app
  // never has: there the version stands alone.
  html += `<div class="help-guide__version"><span class="help-guide__ver">Bozzetto ${esc(APP_VERSION)}</span>`;
  if (updates) html += `<button type="button" class="help-guide__check">Check for updates</button>`;
  html += `<span class="help-guide__checked" role="status"></span></div>`;
  // The interface icons are Flaticon's UIcons, whose licence asks for this
  // line wherever they are used.
  html +=
    '<div class="help-guide__credit"><a href="https://www.flaticon.com/uicons" target="_blank" rel="noopener">Icons by Flaticon (UIcons)</a></div>';
  html += '</div>';
  return html;
}

/** What the guide says after Check for updates, by the check's answer. */
const CHECKED = {
  current: 'Up to date',
  found: 'Update found',
  ready: 'Update ready',
  unreachable: 'Could not check for updates',
} as const;

export class Help {
  private readonly hint: HTMLDivElement;
  private readonly guide: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private hintTimer: number | undefined;
  private mode: KeyMode = 'view';
  private readonly offKeymap: () => void;
  private readonly offUpdates: () => void;
  /** Whether Check for updates is offered: the worker registers after load. */
  private updates = updatesAvailable();
  /** What the last check said, kept across the redraws a rebind or a mode change makes. */
  private checked = '';
  private checking = false;
  private readonly onSculptMode = (e: Event): void => {
    const detail = (e as CustomEvent<{ active?: boolean; mode?: KeyMode }>).detail;
    this.mode = detail?.mode ?? (detail?.active ? 'sculpt' : 'view');
    this.render();
  };

  private render(): void {
    this.guide.innerHTML = guideHtml(this.mode, this.updates);
    // The way into the editor from the guide, for anyone reading it and
    // wanting a different key. Its click must not close the guide.
    this.guide.querySelector<HTMLButtonElement>('.help-guide__prefs')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.guide.hidden = true;
      showPreferences(this.mode);
    });
    // Nor must this one's: the answer is said here, beside the version.
    this.guide.querySelector<HTMLButtonElement>('.help-guide__check')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.check();
    });
    this.paintCheck();
  }

  /** Check for updates; a newer build found goes on in the corner notice. */
  private async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.checked = 'Checking…';
    this.paintCheck();
    const answer = await checkForUpdates();
    this.checking = false;
    this.checked = CHECKED[answer];
    this.paintCheck();
  }

  private paintCheck(): void {
    const said = this.guide.querySelector<HTMLElement>('.help-guide__checked');
    if (said) said.textContent = this.checked;
    const button = this.guide.querySelector<HTMLButtonElement>('.help-guide__check');
    if (button) button.disabled = this.checking;
  }

  /**
   * The worker registered (Check for updates appears), or an update moved
   * on: a download that starts just after a check said Up to date - the
   * worker reporting in late - corrects the line rather than contradict
   * the notice.
   */
  private readonly onUpdate = (): void => {
    if (updatesAvailable() !== this.updates) {
      this.updates = updatesAvailable();
      this.render();
    }
    if (this.checked === CHECKED.current && updateStatus() !== 'none') {
      this.checked = CHECKED.found;
      this.paintCheck();
    }
  };

  constructor() {
    this.hint = document.createElement('div');
    this.hint.className = 'help-hint';
    const helpKey = keymap.chordFor('ui.help');
    this.hint.textContent = helpKey ? `Press ${chordLabel(helpKey)} for hotkey guide` : 'Hotkey guide: the ? button';
    document.body.appendChild(this.hint);
    this.hintTimer = window.setTimeout(() => this.hint.classList.add('is-hidden'), 8000);

    // A visible way in, since H is unreachable on a keyboard-less iPad.
    // Parked beside the theme toggle in the top-right corner.
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'topchip help-toggle';
    this.button.textContent = '?';
    this.button.title = helpKey ? `Hotkey guide (${chordLabel(helpKey)})` : 'Hotkey guide';
    this.button.setAttribute('aria-label', 'Hotkey guide');
    this.button.addEventListener('click', () => this.toggle());
    topbarRight().appendChild(this.button);

    this.guide = document.createElement('div');
    this.guide.className = 'help-guide';
    this.guide.hidden = true;
    this.guide.addEventListener('click', () => this.toggle());
    document.body.appendChild(this.guide);
    this.render();
    // Sculpt mode swaps the guide content while active (and back on exit),
    // and a rebind redraws it.
    window.addEventListener('bozzetto:sculptmode', this.onSculptMode);
    this.offKeymap = keymap.onChange(() => this.render());
    this.offUpdates = onUpdates(this.onUpdate);
  }

  toggle(): void {
    this.guide.hidden = !this.guide.hidden;
    this.dismissHint();
  }

  private dismissHint(): void {
    this.hint.classList.add('is-hidden');
    if (this.hintTimer !== undefined) {
      clearTimeout(this.hintTimer);
      this.hintTimer = undefined;
    }
  }

  dispose(): void {
    if (this.hintTimer !== undefined) clearTimeout(this.hintTimer);
    window.removeEventListener('bozzetto:sculptmode', this.onSculptMode);
    this.offKeymap();
    this.offUpdates();
    this.hint.remove();
    this.button.remove();
    this.guide.remove();
  }
}
