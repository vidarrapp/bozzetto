import { onTap } from '../../ui/dom';
import { chordLabel, keymap } from '../../ui/keymap';
import { settings } from '../../ui/settings';
import { layoutShell, startShellLayout } from './shellLayout';

/**
 * The title strip of Sculpt and Armature: one 24px band across the top.
 * The menus are at its left (their names are TopMenu's, hosted here), the
 * readout of the project and the object in the middle, Publish and the
 * hide-interface button at the right (docs/ui-spec.md section 6).
 *
 * Making it also marks the page as the app shell (`body.bz-shell`), which
 * is what shell.css keys on: the old top row is put away, the panels dock
 * under folder tabs, and the rest of the layout follows.
 */

export interface Readout {
  /** The project's name, bold; empty or null to leave it out. */
  name?: string | null;
  /** "Edited" after the name, for a project with changes not yet saved. */
  edited?: boolean;
  /** The selected object's name. */
  object?: string | null;
  tris?: number | null;
  /** The object's subdivision level (1-based) of the levels it has, when it has them. */
  level?: { at: number; of: number } | null;
}

/** The crossed-out eye: what hides the interface, and, while it is hidden, what brings it back. */
const EYE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.3 3.9M6.5 8.1A17 17 0 0 0 2.5 12s3.5 6 9.5 6a9.4 9.4 0 0 0 3.6-.7" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class TitleStrip {
  readonly el: HTMLElement;
  /** Where the menus put their names. */
  readonly menus: HTMLElement;
  /** Publish, a plain text button; hidden until publishing is reachable (PublishWindow). */
  readonly publishHost: HTMLElement;
  private readonly hideBtn: HTMLButtonElement;
  private readonly nameEl = el('b', 'bz-readout__name');
  private readonly editedEl = el('span', 'bz-readout__edited', 'Edited');
  private readonly objectItem: HTMLElement;
  private readonly objectVal = el('b', 'bz-readout__val bz-readout__object');
  private readonly trisItem: HTMLElement;
  private readonly trisVal = el('b', 'bz-readout__val bz-readout__tris');
  private readonly levelItem: HTMLElement;
  private readonly levelVal = el('b', 'bz-readout__val bz-readout__level');
  /** Set by the mode: the direct hide/show switch (not Tab's staged one). */
  onToggleChrome: (() => void) | null = null;
  private readonly offKeymap: () => void;
  private readonly stopLayout: () => void;
  private readonly offSettings: () => void;

  constructor() {
    document.body.classList.add('bz-shell');
    this.el = el('header', 'bz-strip');
    this.menus = el('nav', 'bz-strip__menus');
    this.menus.setAttribute('aria-label', 'Menus');

    const readout = el('div', 'bz-readout');
    readout.setAttribute('aria-live', 'off');
    const pair = (cls: string, key: string, val: HTMLElement): HTMLElement => {
      const item = el('span', `bz-readout__item ${cls}`);
      item.append(el('span', 'bz-readout__key', key), val);
      return item;
    };
    this.objectItem = pair('bz-readout__item--object', 'Object', this.objectVal);
    this.trisItem = pair('bz-readout__item--tris', 'Tris', this.trisVal);
    this.levelItem = pair('bz-readout__item--level', 'Level', this.levelVal);
    this.editedEl.hidden = true;
    this.nameEl.hidden = true;
    readout.append(this.nameEl, this.editedEl, this.objectItem, this.trisItem, this.levelItem);

    const right = el('div', 'bz-strip__right');
    this.publishHost = right;
    this.hideBtn = el('button', 'bz-strip__hide');
    this.hideBtn.type = 'button';
    this.hideBtn.innerHTML = EYE_ICON;
    // The button is a plain switch, unlike Tab, which first tidies open
    // panels. A tap, not a click: no long press on iOS, and no focus left
    // on the button for Tab or Space to land on (onTap).
    onTap(this.hideBtn, () => this.onToggleChrome?.());
    right.appendChild(this.hideBtn);
    this.setChromeHidden(false);
    this.offKeymap = keymap.onChange(() => this.setChromeHidden(this.hiddenNow));

    this.el.append(this.menus, readout, right);
    document.body.appendChild(this.el);
    this.setReadout({});
    // View > Hotkeys on tools: the digits on the tool bar follow the setting.
    const paintToolKeys = (): void => void document.body.classList.toggle('bz-no-toolkeys', settings.get('toolKeys') === 'off');
    paintToolKeys();
    const offSettings = settings.onChange(paintToolKeys);
    this.offSettings = () => void offSettings();
    this.stopLayout = startShellLayout();
    layoutShell();
  }

  private hiddenNow = false;

  /** The button names what it does now: hide, or bring the interface back. */
  setChromeHidden(hidden: boolean): void {
    this.hiddenNow = hidden;
    const chord = keymap.chordFor('ui.chrome');
    const key = chord ? ` (${chordLabel(chord)})` : '';
    const label = hidden ? 'Show the interface' : 'Hide the interface';
    this.hideBtn.title = label + key;
    this.hideBtn.setAttribute('aria-label', label);
    this.hideBtn.classList.toggle('bz-strip__hide--on', hidden);
  }

  /**
   * Put the readout up. What is not given is left out: a project with no
   * name shows none, an object without levels no Level. The text is only
   * written where it changed, since the mode refreshes this on a timer.
   */
  setReadout(r: Readout): void {
    const name = r.name?.trim() ?? '';
    this.nameEl.hidden = !name;
    if (this.nameEl.textContent !== name) this.nameEl.textContent = name;
    this.editedEl.hidden = !name || !r.edited;
    const set = (item: HTMLElement, val: HTMLElement, text: string | null): void => {
      item.hidden = text === null;
      if (text !== null && val.textContent !== text) val.textContent = text;
    };
    set(this.objectItem, this.objectVal, r.object ?? null);
    set(this.trisItem, this.trisVal, r.tris == null ? null : r.tris.toLocaleString('en-US'));
    set(this.levelItem, this.levelVal, r.level ? `${r.level.at}/${r.level.of}` : null);
  }

  dispose(): void {
    this.offKeymap();
    this.offSettings();
    document.body.classList.remove('bz-no-toolkeys');
    this.stopLayout();
    this.el.remove();
    document.body.classList.remove('bz-shell');
  }
}

/** The plain-text button the strip carries for a command (Publish). */
export function stripButton(label: string): HTMLButtonElement {
  const b = el('button', 'bz-strip__btn', label);
  b.type = 'button';
  return b;
}
