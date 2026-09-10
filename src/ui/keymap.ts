/**
 * The keymap: every hotkey in both modes, as an action with a default
 * chord, and the user's overrides on top.
 *
 * The key handlers (sculpt's InputShell, the viewer's shortcuts) do not
 * know keys any more; they ask "which action is this event?" and switch on
 * the answer. The hotkey guide draws itself from the same table, so a
 * rebind shows up there, and the Preferences window edits it.
 *
 * Chords are spelled 'ctrl+shift+z', 'shift+w', '[', 'arrowleft', 'space'.
 * Cmd on a Mac is spelled ctrl, the way the handlers always treated it.
 * Letters, digits and the punctuation row are matched by PHYSICAL key
 * (event.code), so controller macros and non-US layouts agree with the
 * table - a habit the bracket and quote keys already had.
 */

export type KeyMode = 'sculpt' | 'view';

export interface ActionDef {
  id: string;
  label: string;
  group: string;
  /** Which mode's handler answers to it; 'both' is shared. */
  mode: KeyMode | 'both';
  /** The default chord, or null: unbound until the user binds it (or a gesture). */
  chord: string | null;
  /** A gesture row (drag, scroll, double-click): the guide shows its note; it has no key to edit. */
  gesture?: boolean;
  /** A held key (b, s, l): keydown begins, keyup ends. */
  hold?: boolean;
  /** Auto-repeat re-fires it (steps, turntable, undo). */
  repeat?: boolean;
  /** Guide text for gesture rows, and extra words for keyed ones. */
  note?: string;
}

/**
 * The table. Order is the guide's order; groups are its headings. Gesture
 * rows carry a note and no chord.
 */
export const ACTIONS: ActionDef[] = [
  // --- sculpt: sculpting ---
  { id: 'gesture.sculpt', label: 'Sculpt', group: 'Sculpting', mode: 'sculpt', chord: null, gesture: true, note: 'Drag on mesh' },
  { id: 'gesture.negative', label: 'Negative (carve)', group: 'Sculpting', mode: 'sculpt', chord: null, gesture: true, note: 'Alt + drag' },
  { id: 'gesture.smooth', label: 'Smooth', group: 'Sculpting', mode: 'sculpt', chord: null, gesture: true, note: 'Shift + drag' },
  { id: 'brush.size', label: 'Brush size (hold, then drag with the pen down)', group: 'Sculpting', mode: 'sculpt', chord: 'b', hold: true },
  { id: 'brush.strength', label: 'Brush strength (hold, then drag up/down with the pen down)', group: 'Sculpting', mode: 'sculpt', chord: 's', hold: true },
  { id: 'brush.sizeDown', label: 'Brush size step down', group: 'Sculpting', mode: 'sculpt', chord: '[', repeat: true },
  { id: 'brush.sizeUp', label: 'Brush size step up', group: 'Sculpting', mode: 'sculpt', chord: ']', repeat: true },
  { id: 'brush.strengthDown', label: 'Brush strength step down', group: 'Sculpting', mode: 'sculpt', chord: ';', repeat: true },
  { id: 'brush.strengthUp', label: 'Brush strength step up', group: 'Sculpting', mode: 'sculpt', chord: "'", repeat: true },
  { id: 'brush.symmetry', label: 'Symmetry', group: 'Sculpting', mode: 'sculpt', chord: 'x' },
  { id: 'gizmo.toggle', label: 'Transform gizmo (all handles)', group: 'Sculpting', mode: 'sculpt', chord: 't' },
  { id: 'gizmo.translate', label: 'Move the object (gizmo)', group: 'Sculpting', mode: 'sculpt', chord: 'w' },
  { id: 'gizmo.rotate', label: 'Rotate the object (gizmo)', group: 'Sculpting', mode: 'sculpt', chord: 'e' },
  { id: 'gizmo.scale', label: 'Scale the object (gizmo)', group: 'Sculpting', mode: 'sculpt', chord: 'r' },
  { id: 'gizmo.exit', label: 'Back to sculpting (put the gizmo away)', group: 'Sculpting', mode: 'sculpt', chord: null },
  { id: 'edit.undo', label: 'Undo', group: 'Sculpting', mode: 'sculpt', chord: 'ctrl+z', repeat: true },
  { id: 'edit.redo', label: 'Redo', group: 'Sculpting', mode: 'sculpt', chord: 'ctrl+shift+z', repeat: true },
  // --- sculpt: masking ---
  { id: 'gesture.mask', label: 'Paint mask (+ Alt to unmask)', group: 'Masking', mode: 'sculpt', chord: null, gesture: true, note: 'Ctrl + drag' },
  { id: 'gesture.maskInvertClick', label: 'Invert mask', group: 'Masking', mode: 'sculpt', chord: null, gesture: true, note: 'Ctrl + click off mesh' },
  { id: 'mask.all', label: 'Mask the whole object', group: 'Masking', mode: 'sculpt', chord: 'ctrl+a' },
  { id: 'mask.clear', label: 'Clear mask', group: 'Masking', mode: 'sculpt', chord: 'ctrl+c' },
  { id: 'mask.invert', label: 'Invert mask', group: 'Masking', mode: 'sculpt', chord: 'ctrl+i' },
  { id: 'mask.tint', label: 'Show / hide mask tint', group: 'Masking', mode: 'sculpt', chord: 'ctrl+h' },
  { id: 'mask.extract', label: 'Extract masked region', group: 'Masking', mode: 'sculpt', chord: 'ctrl+e' },
  // --- sculpt: navigation ---
  { id: 'gesture.orbit', label: 'Orbit (around your last stroke)', group: 'Navigation', mode: 'sculpt', chord: null, gesture: true, note: 'Drag off mesh' },
  { id: 'gesture.pan', label: 'Pan (two fingers always navigate, even on the model)', group: 'Navigation', mode: 'sculpt', chord: null, gesture: true, note: 'Cmd / Shift + drag' },
  { id: 'gesture.zoomDrag', label: 'Zoom', group: 'Navigation', mode: 'sculpt', chord: null, gesture: true, note: 'Ctrl + drag off mesh' },
  { id: 'gesture.zoom', label: 'Zoom', group: 'Navigation', mode: 'sculpt', chord: null, gesture: true, note: 'Scroll / pinch' },
  { id: 'view.frame', label: 'Frame the model', group: 'Navigation', mode: 'both', chord: 'f' },
  { id: 'view.frameAll', label: 'Frame the whole scene', group: 'Navigation', mode: 'both', chord: 'a' },
  { id: 'view.turnLeft', label: 'Turntable left (accelerates with the wheel)', group: 'Navigation', mode: 'sculpt', chord: 'arrowleft', repeat: true },
  { id: 'view.turnRight', label: 'Turntable right', group: 'Navigation', mode: 'sculpt', chord: 'arrowright', repeat: true },
  // --- sculpt: brushes ---
  { id: 'tool.select', label: 'Select tool (click; Shift adds, Ctrl+drag removes, Ctrl+Shift+drag adds; drag a marquee)', group: 'Brushes', mode: 'sculpt', chord: 'q' },
  { id: 'tool.crease', label: 'Crease', group: 'Brushes', mode: 'sculpt', chord: '1' },
  { id: 'tool.move', label: 'Move', group: 'Brushes', mode: 'sculpt', chord: '2' },
  { id: 'tool.clay', label: 'Standard (clay)', group: 'Brushes', mode: 'sculpt', chord: '3' },
  { id: 'tool.inflate', label: 'Inflate', group: 'Brushes', mode: 'sculpt', chord: '4' },
  { id: 'tool.pinch', label: 'Pinch', group: 'Brushes', mode: 'sculpt', chord: '5' },
  { id: 'tool.flatten', label: 'Flatten', group: 'Brushes', mode: 'sculpt', chord: '6' },
  { id: 'tool.rake', label: 'Rake (Shift still smooths)', group: 'Brushes', mode: 'sculpt', chord: '7' },
  { id: 'tool.drag', label: 'Drag', group: 'Brushes', mode: 'sculpt', chord: '8' },
  { id: 'tool.polish', label: 'Polish (flattens, keeps edges sharp)', group: 'Brushes', mode: 'sculpt', chord: '9' },
  { id: 'tool.paint', label: 'Paint (Alt + click samples a colour; Shift blurs)', group: 'Brushes', mode: 'sculpt', chord: '0' },
  // --- sculpt: subdivision ---
  { id: 'subdiv.add', label: 'Subdivide', group: 'Subdivision', mode: 'sculpt', chord: 'ctrl+d' },
  { id: 'subdiv.up', label: 'Subdivision level up', group: 'Subdivision', mode: 'sculpt', chord: 'd' },
  { id: 'subdiv.down', label: 'Subdivision level down', group: 'Subdivision', mode: 'sculpt', chord: 'shift+d' },
  // --- sculpt: scene ---
  { id: 'scene.delete', label: 'Delete the selected objects', group: 'Scene', mode: 'sculpt', chord: 'delete' },
  { id: 'scene.mirror', label: 'Mirror the selected objects across the symmetry axis', group: 'Scene', mode: 'sculpt', chord: 'ctrl+m' },
  { id: 'scene.merge', label: 'Merge the selected objects into one', group: 'Scene', mode: 'sculpt', chord: 'ctrl+j' },
  // --- lighting / display (both) ---
  { id: 'view.shadows', label: 'Shadows on / off', group: 'Lighting', mode: 'both', chord: 'shift+s' },
  { id: 'view.wireframe', label: 'Wireframe overlay', group: 'Lighting', mode: 'both', chord: 'shift+w' },
  { id: 'light.move', label: 'Move the key light (hold + drag: across / up)', group: 'Lighting', mode: 'sculpt', chord: 'l', hold: true },
  // --- viewer: playback ---
  { id: 'play.toggle', label: 'Play / pause', group: 'Playback', mode: 'view', chord: 'space' },
  { id: 'play.back', label: 'Step back', group: 'Playback', mode: 'view', chord: 'arrowleft', repeat: true },
  { id: 'play.forward', label: 'Step forward', group: 'Playback', mode: 'view', chord: 'arrowright', repeat: true },
  // --- viewer: view gestures ---
  { id: 'gesture.viewOrbit', label: 'Orbit', group: 'View', mode: 'view', chord: null, gesture: true, note: 'Drag' },
  { id: 'gesture.viewPan', label: 'Pan (two-finger drag on touch)', group: 'View', mode: 'view', chord: null, gesture: true, note: 'Cmd / Shift + drag' },
  { id: 'gesture.viewZoom', label: 'Zoom', group: 'View', mode: 'view', chord: null, gesture: true, note: 'Scroll' },
  { id: 'gesture.focusPoint', label: 'Set focus point (double-tap on touch)', group: 'View', mode: 'view', chord: null, gesture: true, note: 'Double-click' },
  // --- viewer: material ---
  { id: 'material.lit', label: 'Lit (PBR)', group: 'Material', mode: 'view', chord: '1' },
  { id: 'material.matcap1', label: 'Matcap 1', group: 'Material', mode: 'view', chord: '2' },
  { id: 'material.matcap2', label: 'Matcap 2', group: 'Material', mode: 'view', chord: '3' },
  { id: 'material.matcap3', label: 'Matcap 3', group: 'Material', mode: 'view', chord: '4' },
  { id: 'material.matcap4', label: 'Matcap 4', group: 'Material', mode: 'view', chord: '5' },
  { id: 'material.matcap5', label: 'Matcap 5', group: 'Material', mode: 'view', chord: '6' },
  { id: 'material.matcap6', label: 'Matcap 6', group: 'Material', mode: 'view', chord: '7' },
  { id: 'material.matcap7', label: 'Matcap 7', group: 'Material', mode: 'view', chord: '8' },
  { id: 'material.matcap8', label: 'Matcap 8', group: 'Material', mode: 'view', chord: '9' },
  { id: 'view.ground', label: 'Cycle ground (shadow / floor / pedestal / off)', group: 'Material', mode: 'view', chord: 'g' },
  // --- interface ---
  { id: 'ui.chrome', label: 'Close panels, then hide the interface', group: 'Interface', mode: 'sculpt', chord: 'tab' },
  { id: 'ui.show', label: 'Show the interface', group: 'Interface', mode: 'sculpt', chord: 'escape' },
  { id: 'ui.panel', label: 'Toggle the panel', group: 'Interface', mode: 'view', chord: 'tab' },
  { id: 'ui.help', label: 'Hotkey guide', group: 'Interface', mode: 'both', chord: 'h' },
  { id: 'ui.fps', label: 'Frame-rate meter', group: 'Interface', mode: 'both', chord: 'p' },
  { id: 'ui.preferences', label: 'Preferences (hotkeys)', group: 'Interface', mode: 'both', chord: 'ctrl+,' },
];

const STORAGE_KEY = 'bozzetto-keymap';

/** Physical-key names for the main block, so layouts and macros agree. */
const CODE_NAMES: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'space',
};

/** The key part of a chord for an event: physical for the main block. */
export function keyNameOf(e: KeyboardEvent): string | null {
  const code = e.code;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  if (code in CODE_NAMES) return CODE_NAMES[code];
  const key = e.key;
  if (key === ' ') return 'space';
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase(); // 'tab', 'escape', 'arrowleft', 'delete', 'f1' ...
}

/** The full chord for an event, or null for a bare modifier. */
export function chordOf(e: KeyboardEvent): string | null {
  const key = keyNameOf(e);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

const PRETTY: Record<string, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  space: 'Space',
  tab: 'Tab',
  escape: 'Esc',
  delete: 'Del',
  backspace: 'Backspace',
  enter: 'Enter',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
};

/** 'ctrl+shift+z' -> ['Ctrl', 'Shift', 'Z'], for kbd rendering. */
export function chordParts(chord: string): string[] {
  return chord.split('+').map((p) => PRETTY[p] ?? (p.length === 1 ? p.toUpperCase() : p));
}

export function chordLabel(chord: string): string {
  return chordParts(chord).join(' + ');
}

type Listener = () => void;

/** The live keymap: defaults plus the user's overrides, saved per browser. */
export class Keymap {
  private overrides = new Map<string, string | null>();
  private readonly listeners = new Set<Listener>();
  private readonly byId = new Map<string, ActionDef>();

  constructor() {
    for (const a of ACTIONS) this.byId.set(a.id, a);
    this.load();
  }

  action(id: string): ActionDef | undefined {
    return this.byId.get(id);
  }

  /** The chord an action answers to now, or null when unbound. */
  chordFor(id: string): string | null {
    if (this.overrides.has(id)) return this.overrides.get(id) ?? null;
    return this.byId.get(id)?.chord ?? null;
  }

  isOverridden(id: string): boolean {
    return this.overrides.has(id);
  }

  /** Every action a mode's handler can be asked for, in table order. */
  actionsFor(mode: KeyMode): ActionDef[] {
    return ACTIONS.filter((a) => a.mode === mode || a.mode === 'both');
  }

  /** The action a chord means in a mode, or null. */
  actionForChord(chord: string, mode: KeyMode): ActionDef | null {
    for (const a of this.actionsFor(mode)) {
      if (a.gesture) continue;
      if (this.chordFor(a.id) === chord) return a;
    }
    return null;
  }

  /** The action a key event means in a mode, or null. */
  actionFor(e: KeyboardEvent, mode: KeyMode): ActionDef | null {
    const chord = chordOf(e);
    return chord ? this.actionForChord(chord, mode) : null;
  }

  /**
   * The HELD action a released key ends, ignoring modifiers: the modifier
   * state at keyup is whatever it is, and a held b must end on b either way.
   */
  holdActionForKeyUp(e: KeyboardEvent, mode: KeyMode): ActionDef | null {
    const key = keyNameOf(e);
    if (!key) return null;
    for (const a of this.actionsFor(mode)) {
      if (!a.hold) continue;
      const chord = this.chordFor(a.id);
      if (chord && chord.split('+').pop() === key) return a;
    }
    return null;
  }

  /** Rebind (null unbinds). Another action on the same chord in the same mode is unbound. */
  rebind(id: string, chord: string | null): void {
    const a = this.byId.get(id);
    if (!a) return;
    if (chord) {
      for (const other of ACTIONS) {
        if (other.id === id) continue;
        if (!this.sharesMode(a, other)) continue;
        if (this.chordFor(other.id) === chord) this.overrides.set(other.id, null);
      }
    }
    if (chord === a.chord) this.overrides.delete(id);
    else this.overrides.set(id, chord);
    this.save();
    this.emit();
  }

  /** What a chord would displace in an action's modes, for the editor to say so. */
  conflictFor(id: string, chord: string): ActionDef | null {
    const a = this.byId.get(id);
    if (!a) return null;
    for (const other of ACTIONS) {
      if (other.id === id || !this.sharesMode(a, other)) continue;
      if (this.chordFor(other.id) === chord) return other;
    }
    return null;
  }

  reset(id: string): void {
    this.overrides.delete(id);
    this.save();
    this.emit();
  }

  resetAll(): void {
    this.overrides.clear();
    this.save();
    this.emit();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private sharesMode(a: ActionDef, b: ActionDef): boolean {
    return a.mode === 'both' || b.mode === 'both' || a.mode === b.mode;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string | null>;
      for (const [id, chord] of Object.entries(parsed)) {
        if (!this.byId.has(id)) continue;
        if (chord !== null && typeof chord !== 'string') continue;
        this.overrides.set(id, chord);
      }
    } catch {
      // A blocked or corrupt store: the defaults stand.
    }
  }

  private save(): void {
    try {
      if (this.overrides.size === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.overrides)));
    } catch {
      // The rebind still holds for this page; it just will not survive a reload.
    }
  }
}

/** The one keymap every handler consults. */
export const keymap = new Keymap();
