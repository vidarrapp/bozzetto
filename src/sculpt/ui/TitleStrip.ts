import { onTap } from '../../ui/dom';
import { chordLabel, keymap } from '../../ui/keymap';
import { settings } from '../../ui/settings';
import { deviceChoice, mayStore, onDeviceChoice } from '../../ui/deviceStorage';
import { layoutShell, startShellLayout } from './shellLayout';
import { TIP_HOLD_MS, TIP_LINGER_MS } from './edgeTip';

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
   * The quiet state word after the name (Saved, Edited, Kept on this device)
   * for a workspace that knows where its work is kept. It stands in for
   * `edited`; null leaves it out.
   */
  state?: string | null;
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
  /** Present: the size in pixels of the image Save image writes. */
  frame?: { w: number; h: number } | null;
  /** Present: the lens, in mm (35mm equivalent), shown after the image size. */
  lens?: number | null;
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

/** The four workspaces, in the order the work goes. */
export type Workspace = 'armature' | 'sculpt' | 'paint' | 'present';
const WORKSPACES: Array<[Workspace, string]> = [
  ['armature', 'Armature'],
  ['sculpt', 'Sculpt'],
  ['paint', 'Paint'],
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
  /** The workspace path (Armature, Sculpt, Paint, Present) after the menus; on by default. */
  path?: boolean;
  /**
   * Say "Not saved" at the right while the person has turned saving off
   * (ui/deviceStorage); on by default. The public viewer asks nothing and
   * keeps nothing, so it has none.
   */
  savingNote?: boolean;
  /**
   * A page of the site (gallery, Community, My projects, Account, Review,
   * Owner tools): the same strip with no hide button, no workspace path and
   * none of the panel layout. The body is marked `bz-page` instead of
   * `bz-shell`, and shell.css gives both the one strip.
   */
  page?: boolean;
}

export class TitleStrip {
  readonly el: HTMLElement;
  /** The readout in the middle: a mode may put a pair or two of its own at its end. */
  readonly readoutEl: HTMLElement;
  /** Where the menus put their names. */
  readonly menus: HTMLElement;
  /** Publish, a plain text button; hidden until publishing is reachable (PublishWindow). */
  readonly publishHost: HTMLElement;
  /**
   * Where the signed-in account's @handle menu stands: the last thing at the
   * right, before the hide button. What a place adds with addAction (Star,
   * Publish, Save, Not saved) lands to its left.
   */
  readonly accountSlot: HTMLElement;
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
  private readonly lensItem: HTMLElement;
  private readonly frameVal = el('b', 'bz-readout__val bz-readout__frame');
  private readonly lensVal = el('b', 'bz-readout__val bz-readout__lens');
  /** The pairs a workspace adds (Readout.extras), kept by key between refreshes. */
  private readonly extraEls = new Map<string, { item: HTMLElement; val: HTMLElement }>();
  private readonly extraHost = el('span', 'bz-readout__extras');
  /**
   * Set by the mode that lets the name be changed here: tapping the name
   * puts a field in its place; Enter or leaving it hands the new name over,
   * Esc keeps the old one.
   */
  onRename: ((name: string) => void) | null = null;
  private renaming: HTMLInputElement | null = null;
  /** Set by the mode: the direct hide/show switch (not Tab's staged one). */
  onToggleChrome: (() => void) | null = null;
  private readonly offKeymap: () => void;
  private readonly stopLayout: () => void;
  private readonly offSettings: () => void;
  private offChoice: (() => void) | null = null;
  private readonly isPage: boolean;
  /** Things made for the strip by others (the account menu) that go when it does. */
  private readonly adopted: Array<{ dispose(): void }> = [];

  constructor(opts: TitleStripOptions = {}) {
    this.isPage = !!opts.page;
    document.body.classList.add(this.isPage ? 'bz-page' : 'bz-shell');
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
    this.frameItem = pair('bz-readout__item--frame', 'Image', this.frameVal);
    this.lensItem = pair('bz-readout__item--lens', 'Lens', this.lensVal);
    this.editedEl.hidden = true;
    this.nameEl.hidden = true;
    // The name is a button while a mode lets it be renamed (onRename).
    onTap(this.nameEl, () => this.beginRename());
    this.nameEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this.beginRename();
    });
    this.byEl.hidden = true;
    this.readoutEl = readout;
    readout.append(this.nameEl, this.editedEl, this.byEl, this.extraHost, this.objectItem, this.trisItem, this.levelItem, this.frameItem, this.lensItem);

    const right = el('div', 'bz-strip__right');
    this.publishHost = right;
    this.hideBtn = el('button', 'bz-strip__hide');
    this.hideBtn.type = 'button';
    this.hideBtn.innerHTML = EYE_ICON;
    // The button is a plain switch, unlike Tab, which first tidies open
    // panels. A tap, not a click: no long press on iOS, and no focus left
    // on the button for Tab or Space to land on (onTap).
    onTap(this.hideBtn, () => this.onToggleChrome?.());
    if ((opts.savingNote ?? true) && !this.isPage) {
      // Quiet, and always there while saving is off: the strip is the one
      // place that is neither the viewport nor the tool bar, and it stays
      // on a phone, where the readout does not.
      const note = el('span', 'bz-strip__off', 'Not saved');
      note.title = 'Saving is off: your work is not kept on this device. Turn it on in Edit > Preferences.';
      const paint = (): void => void (note.hidden = mayStore() || deviceChoice() === 'none');
      paint();
      this.offChoice = onDeviceChoice(paint);
      right.appendChild(note);
    }
    this.accountSlot = el('span', 'bz-strip__account');
    right.appendChild(this.accountSlot);
    if (!this.isPage) right.appendChild(this.hideBtn);
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
        if (b.getAttribute('aria-current') === 'step') {
          // On a phone the other steps are not in the strip: the step you are in opens a list of the three.
          if (window.matchMedia('(max-width: 599px)').matches) this.toggleStepMenu(b);
          return;
        }
        this.stepActions.get(id)?.();
      });
      this.steps.set(id, b);
      // A step that cannot be pressed says why on hover (its title) and, for a
      // finger or the Pencil, while it is held (the box under the strip).
      this.adopt({ dispose: this.sayWhyOnHold(b) });
      path.appendChild(b);
    });
    left.append(this.menus);
    if ((opts.path ?? true) && !this.isPage) left.append(sep, path);

    this.el.append(left, readout, right);
    document.body.appendChild(this.el);
    this.setReadout({});
    // View > Hotkeys on tools: the digits on the tool bar follow the setting.
    const paintToolKeys = (): void => void document.body.classList.toggle('bz-no-toolkeys', settings.get('toolKeys') === 'off');
    paintToolKeys();
    const offSettings = settings.onChange(paintToolKeys);
    this.offSettings = () => void offSettings();
    if (this.isPage) {
      this.stopLayout = () => undefined;
    } else {
      this.stopLayout = startShellLayout();
      layoutShell();
    }
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

  private whyBox: HTMLDivElement | null = null;

  /**
   * A long press on a step that cannot be pressed says why, in a small box
   * under the strip (a finger has no hover for the title), until a moment
   * after the lift. The reason is the step's title, set by setWorkspace.
   */
  private sayWhyOnHold(b: HTMLButtonElement): () => void {
    let hold = 0;
    let linger = 0;
    const hide = (): void => {
      this.whyBox?.remove();
      this.whyBox = null;
    };
    const down = (): void => {
      window.clearTimeout(hold);
      window.clearTimeout(linger);
      if (b.getAttribute('aria-disabled') !== 'true' || !b.title) return;
      hold = window.setTimeout(() => {
        hold = 0;
        hide();
        const box = el('div', 'bz-ws__why', b.title);
        box.setAttribute('role', 'status');
        document.body.appendChild(box);
        const r = b.getBoundingClientRect();
        box.style.top = `${Math.round(this.el.getBoundingClientRect().bottom + 6)}px`;
        box.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)))}px`;
        this.whyBox = box;
      }, TIP_HOLD_MS);
    };
    const up = (): void => {
      window.clearTimeout(hold);
      hold = 0;
      if (!this.whyBox) return;
      window.clearTimeout(linger);
      linger = window.setTimeout(hide, TIP_LINGER_MS);
    };
    b.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(linger);
      hide();
      b.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }

  private stepMenu: HTMLDivElement | null = null;
  private stepMenuOff: (() => void) | null = null;

  private closeStepMenu(): void {
    this.stepMenuOff?.();
    this.stepMenuOff = null;
    this.stepMenu?.remove();
    this.stepMenu = null;
    for (const b of this.steps.values()) b.removeAttribute('aria-expanded');
  }

  /** A phone: the three steps in a small list under the strip, the one you are in ticked. */
  private toggleStepMenu(anchor: HTMLElement): void {
    if (this.stepMenu) {
      this.closeStepMenu();
      return;
    }
    const pop = el('div', 'file-menu bz-ws-menu');
    pop.setAttribute('role', 'menu');
    for (const [id, label] of WORKSPACES) {
      const b = el('button', 'file-menu__item file-menu__item--toggle', label);
      b.type = 'button';
      const here = this.steps.get(id)?.getAttribute('aria-current') === 'step';
      const action = this.stepActions.get(id) ?? null;
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', here ? 'true' : 'false');
      b.dataset.workspace = id;
      const reason = this.steps.get(id)?.title;
      if (!here && !action) {
        b.disabled = true;
        if (reason) b.title = reason;
      }
      onTap(b, () => {
        if (b.disabled) return;
        this.closeStepMenu();
        if (!here) action?.();
      });
      pop.appendChild(b);
    }
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${Math.round(this.el.getBoundingClientRect().bottom)}px`;
    pop.style.left = `${Math.round(Math.max(0, Math.min(r.left, window.innerWidth - pop.offsetWidth)))}px`;
    anchor.setAttribute('aria-expanded', 'true');
    this.stepMenu = pop;
    const outside = (e: Event): void => {
      if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) this.closeStepMenu();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') this.closeStepMenu();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', () => this.closeStepMenu(), { once: true });
    this.stepMenuOff = () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key, true);
    };
    pop.querySelector<HTMLButtonElement>('.file-menu__item:not(:disabled)')?.focus();
  }

  /** Put a control at the right of the strip, before `before` (default: the account's place, so before @handle and the hide-interface button). */
  addAction(control: HTMLElement, before: HTMLElement | null = this.accountSlot): void {
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
    this.nameEl.hidden = !name || !!this.renaming;
    if (this.nameEl.textContent !== name) this.nameEl.textContent = name;
    const renamable = !!this.onRename && !!name;
    this.nameEl.classList.toggle('bz-readout__name--edit', renamable);
    if (renamable) {
      this.nameEl.setAttribute('role', 'button');
      this.nameEl.tabIndex = 0;
      this.nameEl.title = 'Rename';
    } else {
      this.nameEl.removeAttribute('role');
      this.nameEl.removeAttribute('tabindex');
      this.nameEl.removeAttribute('title');
    }
    const mark = r.state !== undefined ? (r.state ?? '') : r.edited ? (r.editedText ?? 'Edited') : '';
    this.editedEl.hidden = !name || !mark;
    if (mark && this.editedEl.textContent !== mark) this.editedEl.textContent = mark;
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
    set(this.lensItem, this.lensVal, r.lens == null ? null : `${Math.round(r.lens)} mm`);
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

  /** The name as a field, in the name's place: Enter or leaving it renames, Esc keeps. */
  private beginRename(): void {
    if (!this.onRename || this.renaming || this.nameEl.hidden) return;
    const was = this.nameEl.textContent ?? '';
    const input = el('input', 'bz-readout__rename');
    input.type = 'text';
    input.value = was;
    input.maxLength = 80;
    input.setAttribute('aria-label', 'Name');
    input.spellcheck = false;
    input.autocomplete = 'off';
    this.renaming = input;
    this.nameEl.hidden = true;
    this.nameEl.after(input);
    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      this.renaming = null;
      input.remove();
      this.nameEl.hidden = false;
      if (keep && next && next !== was) {
        this.nameEl.textContent = next;
        this.onRename?.(next);
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing is not a hotkey
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.focus();
    input.select();
  }

  /** Take something into the strip's care: it is disposed with it. */
  adopt(part: { dispose(): void }): void {
    this.adopted.push(part);
  }

  dispose(): void {
    this.closeStepMenu();
    for (const part of this.adopted.splice(0)) part.dispose();
    this.offChoice?.();
    this.offKeymap();
    this.offSettings();
    document.body.classList.remove('bz-no-toolkeys');
    this.stopLayout();
    this.el.remove();
    document.body.classList.remove(this.isPage ? 'bz-page' : 'bz-shell');
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
