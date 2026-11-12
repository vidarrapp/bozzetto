import { onTap } from '../../ui/dom';
import { chordLabel, keymap } from '../../ui/keymap';
import { settings } from '../../ui/settings';
import { layoutShell, startShellLayout } from './shellLayout';

/**
 * The title strip of Sculpt, Armature and Present: one 24px band across the
 * top. The menus are at its left (their names are TopMenu's, hosted here),
 * then the workspace path (Armature, Sculpt, Present: the order the work
 * goes, the step you are in lit), the readout of the project and the object
 * in the middle, and at the right Publish (Present only) and the
 * hide-interface button (docs/ui-spec.md section 6).
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
  /** What the mark says instead of "Edited": "Not saved", for a project not made yet (Create). */
  editedText?: string;
  /**
   * Who made it, for the public viewer of a member's work: "by @handle", a
   * link to their page, after the name. Null leaves it out.
   */
  by?: { text: string; href: string } | null;
  /** The selected object's name. */
  object?: string | null;
  tris?: number | null;
  /** The object's subdivision level (1-based) of the levels it has, when it has them. */
  level?: { at: number; of: number } | null;
  /** Present: the viewport's size in pixels, the frame a saved image is taken from. */
  frame?: { w: number; h: number } | null;
  /**
   * Other pairs for a workspace of its own (the owner's Present of a
   * published project: Timelapse 240 frames, Stage Forms), after the name:
   * a dim word and its bold value each. A null value leaves the pair out; an empty one shows the word alone.
   */
  extras?: Array<{ key: string; value: string | null }>;
}

/** The crossed-out eye: what hides the interface, and, while it is hidden, what brings it back. */
const EYE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.3 3.9M6.5 8.1A17 17 0 0 0 2.5 12s3.5 6 9.5 6a9.4 9.4 0 0 0 3.6-.7" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

/** The three workspaces, in the order the work goes. */
export type Workspace = 'armature' | 'sculpt' | 'present';
const WORKSPACES: Array<[Workspace, string]> = [
  ['armature', 'Armature'],
  ['sculpt', 'Sculpt'],
  ['present', 'Present'],
];

/**
 * What pressing a step does: an action, or a reason it cannot be pressed
 * (the step is then dim and says why in its title). A step with neither is
 * dim and silent.
 */
export type PathStep = { action: () => void } | { unavailable: string };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** What a strip may leave out: the public viewer is a place to look, and has no workspaces to walk between. */
export interface TitleStripOptions {
  /** The workspace path (Armature, Sculpt, Present) after the menus; on by default. */
  path?: boolean;
}

export class TitleStrip {
  readonly el: HTMLElement;
  /** The readout in the middle: a mode may put a pair or two of its own at its end. */
  readonly readoutEl: HTMLElement;
  /** Where the menus put their names. */
  readonly menus: HTMLElement;
  /** Publish, a plain text button; hidden until publishing is reachable (PublishWindow). */
  readonly publishHost: HTMLElement;
  private readonly hideBtn: HTMLButtonElement;
  private readonly steps = new Map<Workspace, HTMLButtonElement>();
  private readonly stepActions = new Map<Workspace, (() => void) | null>();
  private readonly nameEl = el('b', 'bz-readout__name');
  private readonly byEl = el('a', 'bz-readout__by viewer-author');
  private readonly editedEl = el('span', 'bz-readout__edited', 'Edited');
  private readonly objectItem: HTMLElement;
  private readonly objectVal = el('b', 'bz-readout__val bz-readout__object');
  private readonly trisItem: HTMLElement;
  private readonly trisVal = el('b', 'bz-readout__val bz-readout__tris');
  private readonly levelItem: HTMLElement;
  private readonly levelVal = el('b', 'bz-readout__val bz-readout__level');
  private readonly frameItem: HTMLElement;
  private readonly frameVal = el('b', 'bz-readout__val bz-readout__frame');
  /** The pairs a workspace adds (Readout.extras), kept by key between refreshes. */
  private readonly extraEls = new Map<string, { item: HTMLElement; val: HTMLElement }>();
  private readonly extraHost = el('span', 'bz-readout__extras');
  /** Set by the mode: the direct hide/show switch (not Tab's staged one). */
  onToggleChrome: (() => void) | null = null;
  private readonly offKeymap: () => void;
  private readonly stopLayout: () => void;
  private readonly offSettings: () => void;

  constructor(opts: TitleStripOptions = {}) {
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
    this.frameItem = pair('bz-readout__item--frame', 'Frame', this.frameVal);
    this.editedEl.hidden = true;
    this.nameEl.hidden = true;
    this.byEl.hidden = true;
    this.readoutEl = readout;
    readout.append(this.nameEl, this.editedEl, this.byEl, this.extraHost, this.objectItem, this.trisItem, this.levelItem, this.frameItem);

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

    // The menus, a 1px separator, then the path.
    const left = el('div', 'bz-strip__left');
    const sep = el('span', 'bz-strip__sep');
    sep.setAttribute('aria-hidden', 'true');
    const path = el('div', 'bz-ws');
    path.setAttribute('role', 'group');
    path.setAttribute('aria-label', 'Workspace');
    WORKSPACES.forEach(([id, label], i) => {
      if (i) {
        const arrow = el('span', 'bz-ws__sep', '\u203a');
        arrow.setAttribute('aria-hidden', 'true');
        path.appendChild(arrow);
      }
      const b = el('button', 'bz-ws__step', label);
      b.type = 'button';
      b.dataset.workspace = id;
      onTap(b, () => {
        if (b.getAttribute('aria-current') === 'step') return;
        this.stepActions.get(id)?.();
      });
      this.steps.set(id, b);
      path.appendChild(b);
    });
    left.append(this.menus);
    if (opts.path ?? true) left.append(sep, path);

    this.el.append(left, readout, right);
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

  /**
   * Light the workspace the person is in and say what the other steps do.
   * Called by the mode on boot and whenever the workspace changes (Sculpt
   * to Present and back). `steps` is read for every step but the current.
   */
  setWorkspace(current: Workspace, steps: Partial<Record<Workspace, PathStep>>): void {
    for (const [id, label] of WORKSPACES) {
      const b = this.steps.get(id);
      if (!b) continue; // a strip without the path
      const on = id === current;
      const step = on ? undefined : steps[id];
      const action = step && 'action' in step ? step.action : null;
      this.stepActions.set(id, action);
      if (on) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('bz-ws__step--on', on);
      const dim = !on && !action;
      b.classList.toggle('bz-ws__step--none', dim);
      if (dim) b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
      const reason = step && 'unavailable' in step ? step.unavailable : '';
      if (reason) b.title = reason;
      else if (on) b.title = `${label}, where you are`;
      else b.title = action ? `Go to ${label}` : '';
    }
  }

  /** Put a control at the right of the strip, before `before` (default: the hide-interface button). */
  addAction(control: HTMLElement, before: HTMLElement | null = this.hideBtn): void {
    this.publishHost.insertBefore(control, before);
  }

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
    const mark = r.editedText ?? 'Edited';
    if (this.editedEl.textContent !== mark) this.editedEl.textContent = mark;
    const by = r.by ?? null;
    this.byEl.hidden = !by;
    if (by) {
      if (this.byEl.textContent !== by.text) this.byEl.textContent = by.text;
      if (this.byEl.getAttribute('href') !== by.href) this.byEl.setAttribute('href', by.href);
    }
    const set = (item: HTMLElement, val: HTMLElement, text: string | null): void => {
      item.hidden = text === null;
      if (text !== null && val.textContent !== text) val.textContent = text;
    };
    set(this.objectItem, this.objectVal, r.object ?? null);
    set(this.trisItem, this.trisVal, r.tris == null ? null : r.tris.toLocaleString('en-US'));
    set(this.levelItem, this.levelVal, r.level ? `${r.level.at}/${r.level.of}` : null);
    set(this.frameItem, this.frameVal, r.frame ? `${r.frame.w} \u00d7 ${r.frame.h}` : null);
    const wanted = (r.extras ?? []).filter((x): x is { key: string; value: string } => x.value !== null);
    for (const [key, e] of this.extraEls) {
      if (wanted.some((x) => x.key === key)) continue;
      e.item.remove();
      this.extraEls.delete(key);
    }
    for (const { key, value } of wanted) {
      let e = this.extraEls.get(key);
      if (!e) {
        const val = el('b', 'bz-readout__val');
        const item = el('span', 'bz-readout__item');
        item.append(el('span', 'bz-readout__key', key), val);
        this.extraHost.appendChild(item);
        e = { item, val };
        this.extraEls.set(key, e);
      }
      if (e.val.textContent !== value) e.val.textContent = value;
    }
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

/**
 * The plain-text button the strip carries for a command (Publish, Save).
 * `primary` is the one orange action of a workspace.
 */
export function stripButton(label: string, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'bz-strip__btn bz-strip__btn--primary' : 'bz-strip__btn', label);
  b.type = 'button';
  return b;
}

/** The same quiet text, for a link (Close, Edit): the strip's button where the command is an address. */
export function stripLink(label: string, href: string): HTMLAnchorElement {
  const a = el('a', 'bz-strip__btn', label);
  a.href = href;
  return a;
}
