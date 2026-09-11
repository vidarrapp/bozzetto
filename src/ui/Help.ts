import { topbarRight } from './topbar';
import { chordLabel, chordParts, keymap, type KeyMode } from './keymap';
import { showPreferences } from './Preferences';

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
function guideHtml(mode: KeyMode): string {
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
  html += `<div class="help-guide__foot"><button type="button" class="help-guide__prefs">Customise hotkeys…</button></div>`;
  return html;
}

export class Help {
  private readonly hint: HTMLDivElement;
  private readonly guide: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private hintTimer: number | undefined;
  private mode: KeyMode = 'view';
  private readonly offKeymap: () => void;
  private readonly onSculptMode = (e: Event): void => {
    const detail = (e as CustomEvent<{ active?: boolean; mode?: KeyMode }>).detail;
    this.mode = detail?.mode ?? (detail?.active ? 'sculpt' : 'view');
    this.render();
  };

  private render(): void {
    this.guide.innerHTML = guideHtml(this.mode);
    // The way into the editor from the guide, for anyone reading it and
    // wanting a different key. Its click must not close the guide.
    this.guide.querySelector<HTMLButtonElement>('.help-guide__prefs')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.guide.hidden = true;
      showPreferences(this.mode);
    });
  }

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
    this.hint.remove();
    this.button.remove();
    this.guide.remove();
  }
}
