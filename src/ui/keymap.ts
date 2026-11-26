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

import { deviceStore, onDeviceChoice } from './deviceStorage';
import { legacyKeyMoves, PLACE_COUNT, placeOfAction, slotAction, toolBars } from '../sculpt/tools/bars';
import { toolById } from '../sculpt/tools/registry';

export type KeyMode = 'sculpt' | 'view' | 'armature' | 'paint' | 'present';

/**
 * What the Paint workspace leaves out of Sculpt's keys: Calipers and the
 * transform gizmo (the tool bar's places answer there too, and pick what
 * Paint's bar holds). Everything else in Sculpt's table answers there as it
 * does in Sculpt: undo, size and strength, symmetry, masks, the levels, the
 * scene and the view.
 */
const PAINT_LEAVES_OUT = /^(tool\.(?!select$)|gizmo\.)/;

export interface ActionDef {
  id: string;
  label: string;
  group: string;
  /** Which mode's handler answers to it; 'both' is shared. */
  mode: KeyMode | 'both';
  /**
   * Answers in Present too (a mode's keys that still work there). Present's key handling and its hotkey
   * guide are both drawn from this flag, so a new Present key is one entry here, with `present: true`
   * (or `mode: 'present'` when it means something only there).
   */
  present?: boolean;
  /** What the row says in Present's guide and in Preferences' Present tab, where it means something else there. */
  presentLabel?: string;
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
  /**
   * Another action whose key this one answers to: the row is shown in its
   * own mode's list, and rebinding either rebinds both (Armature's undo and
   * redo are Sculpt's, so one Preferences change covers the two modes).
   */
  sameKeyAs?: string;
}

/**
 * The table. Order is the guide's order; groups are its headings. Gesture
 * rows carry a note and no chord.
 */
export const ACTIONS: ActionDef[] = [
  // --- sculpt: sculpting ---
  { id: 'gesture.sculpt', label: 'Sculpt with the Pencil or the mouse (a finger orbits unless Preferences lets it sculpt)', group: 'Sculpting', mode: 'sculpt', chord: null, gesture: true, note: 'Drag on mesh' },
  { id: 'gesture.negative', label: 'Negative (carve). The toolbar button: a tap carves the next stroke, a long press every stroke until a tap', group: 'Sculpting', mode: 'sculpt', chord: null, gesture: true, note: 'Alt + drag' },
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
  { id: 'gesture.loopMask', label: 'Mask one side of an edge loop (+ Alt to unmask)', group: 'Masking', mode: 'sculpt', chord: null, gesture: true, note: 'Ctrl + Shift + drag' },
  { id: 'gesture.maskInvertClick', label: 'Invert mask (click off the model)', group: 'Masking', mode: 'sculpt', chord: null, gesture: true, note: 'Ctrl + click' },
  { id: 'mask.all', label: 'Mask the whole object', group: 'Masking', mode: 'sculpt', chord: 'ctrl+a' },
  { id: 'mask.clear', label: 'Clear mask', group: 'Masking', mode: 'sculpt', chord: 'ctrl+c' },
  { id: 'mask.invert', label: 'Invert mask', group: 'Masking', mode: 'sculpt', chord: 'ctrl+i' },
  { id: 'mask.tint', label: 'Show / hide mask tint', group: 'Masking', mode: 'sculpt', chord: 'ctrl+h' },
  { id: 'mask.extract', label: 'Extract masked region', group: 'Masking', mode: 'sculpt', chord: 'ctrl+e' },
  // --- sculpt: poly groups ---
  { id: 'groups.show', label: 'Show / hide the poly group colours', group: 'Poly groups', mode: 'sculpt', chord: 'shift+f' },
  { id: 'groups.fromMask', label: 'Group the masked faces (a new poly group)', group: 'Poly groups', mode: 'sculpt', chord: 'ctrl+g' },
  { id: 'gesture.groupIsolate', label: 'Show a poly group alone; again hides it and shows the rest; on empty space shows all', group: 'Poly groups', mode: 'sculpt', chord: null, gesture: true, note: 'Ctrl + Shift + click' },
  { id: 'gesture.groupMask', label: 'Mask a poly group (click on the model; + Alt unmasks it)', group: 'Poly groups', mode: 'sculpt', chord: null, gesture: true, note: 'Ctrl + click' },
  // --- sculpt: navigation ---
  { id: 'gesture.orbit', label: 'Orbit (around your last stroke; a finger orbits anywhere)', group: 'Navigation', mode: 'sculpt', chord: null, gesture: true, note: 'Drag off mesh' },
  { id: 'gesture.pan', label: 'Pan (two fingers always navigate, even on the model)', group: 'Navigation', mode: 'sculpt', chord: null, gesture: true, note: 'Cmd / Shift + drag' },
  { id: 'gesture.zoomDrag', label: 'Zoom', group: 'Navigation', mode: 'sculpt', chord: null, gesture: true, note: 'Ctrl + drag off mesh' },
  { id: 'gesture.zoom', label: 'Zoom', group: 'Navigation', mode: 'sculpt', chord: null, gesture: true, note: 'Scroll / pinch' },
  { id: 'view.frame', present: true, label: 'Frame the model', group: 'Navigation', mode: 'both', chord: 'f' },
  { id: 'view.frameAll', present: true, label: 'Frame the whole scene', group: 'Navigation', mode: 'both', chord: 'a' },
  { id: 'view.projection', present: true, label: 'Perspective / orthographic', group: 'Navigation', mode: 'both', chord: 'p' },
  { id: 'view.turnLeft', present: true, label: 'Turntable left (accelerates with the wheel)', group: 'Navigation', mode: 'sculpt', chord: 'arrowleft', repeat: true },
  { id: 'view.turnRight', present: true, label: 'Turntable right', group: 'Navigation', mode: 'sculpt', chord: 'arrowright', repeat: true },
  // Present's navigation, with no stroke to be had: a finger orbits anywhere.
  { id: 'gesture.presentOrbit', label: 'Orbit (one finger, the Pencil or the mouse)', group: 'Navigation', mode: 'present', chord: null, gesture: true, note: 'Drag' },
  { id: 'gesture.presentPan', label: 'Pan (two fingers on touch)', group: 'Navigation', mode: 'present', chord: null, gesture: true, note: 'Cmd / Shift + drag' },
  { id: 'gesture.presentZoom', label: 'Zoom', group: 'Navigation', mode: 'present', chord: null, gesture: true, note: 'Scroll / pinch' },
  // --- sculpt: brushes ---
  { id: 'tool.select', label: 'Select tool (click; Shift adds, Ctrl+drag removes, Ctrl+Shift+drag adds; drag a marquee)', group: 'Brushes', mode: 'sculpt', chord: 'q' },
  { id: 'tool.calipers', label: 'Calipers (tap the model twice to measure; drag an end to move it)', group: 'Brushes', mode: 'sculpt', chord: 'c' },
  // The ten number keys pick what sits in that place of the current workspace's
  // tool bar (Sculpt's brushes, Paint's six tools). Their labels name the tool
  // in the place when they are drawn (Keymap.labelFor).
  ...Array.from({ length: PLACE_COUNT }, (_, i): ActionDef => ({ id: slotAction(i + 1), label: `Tool bar, place ${i + 1}`, group: 'Tool bar', mode: 'sculpt', chord: String((i + 1) % PLACE_COUNT) })),
  // --- sculpt: subdivision ---
  { id: 'subdiv.add', label: 'Subdivide', group: 'Subdivision', mode: 'sculpt', chord: 'ctrl+d' },
  { id: 'subdiv.up', label: 'Subdivision level up', group: 'Subdivision', mode: 'sculpt', chord: 'd' },
  { id: 'subdiv.down', label: 'Subdivision level down', group: 'Subdivision', mode: 'sculpt', chord: 'shift+d' },
  // --- sculpt: scene ---
  { id: 'scene.delete', label: 'Delete the selected objects', group: 'Scene', mode: 'sculpt', chord: 'delete' },
  { id: 'scene.mirror', label: 'Mirror the selected objects across the symmetry axis', group: 'Scene', mode: 'sculpt', chord: 'ctrl+m' },
  { id: 'scene.merge', label: 'Merge the selected objects into one', group: 'Scene', mode: 'sculpt', chord: 'ctrl+j' },
  { id: 'view.solo', label: 'Solo: show the active object alone (again brings the rest back)', group: 'Scene', mode: 'sculpt', chord: 'alt+q' },
  // Separate actions rather than a Shift read inside two: a chord here is
  // matched whole, so Shift+arrow is a chord of its own, and as one it can
  // be rebound like any other.
  { id: 'scene.prev', label: 'Previous object in the Scene list (wraps round)', group: 'Scene', mode: 'sculpt', chord: 'arrowup', repeat: true },
  { id: 'scene.next', label: 'Next object in the Scene list (wraps round)', group: 'Scene', mode: 'sculpt', chord: 'arrowdown', repeat: true },
  { id: 'scene.prevExtend', label: 'Extend the selection to the previous object', group: 'Scene', mode: 'sculpt', chord: 'shift+arrowup', repeat: true },
  { id: 'scene.nextExtend', label: 'Extend the selection to the next object', group: 'Scene', mode: 'sculpt', chord: 'shift+arrowdown', repeat: true },
  // --- lighting / display (both) ---
  { id: 'view.shadows', present: true, label: 'Shadows on / off', group: 'Lighting', mode: 'both', chord: 'shift+s' },
  { id: 'view.wireframe', present: true, label: 'Wireframe overlay', group: 'Lighting', mode: 'both', chord: 'shift+w' },
  { id: 'view.details', label: 'Details overlay on / off', group: 'Lighting', mode: 'both', chord: 'shift+i' },
  { id: 'view.arrange', label: 'Arrange the reference pictures (unlock / lock)', group: 'Lighting', mode: 'sculpt', chord: 'alt+r' },
  { id: 'light.move', present: true, presentLabel: 'Move the picked light (hold + drag: across / up; View > Move light does it with one drag)', label: 'Move the key light (hold + drag: across / up; View > Move light does it with one drag)', group: 'Lighting', mode: 'sculpt', chord: 'l', hold: true },
  // Present: 1, 2 and 3 pick which light L moves (Key, Fill, Rim), where they pick tools in Sculpt.
  { id: 'present.light1', label: 'Pick the key light for L', group: 'Lighting', mode: 'present', chord: '1' },
  { id: 'present.light2', label: 'Pick the fill light for L', group: 'Lighting', mode: 'present', chord: '2' },
  { id: 'present.light3', label: 'Pick the rim light for L', group: 'Lighting', mode: 'present', chord: '3' },
  // The same key in the viewer and the editors' preview: one Preferences
  // change moves it in all three, as Armature's undo follows Sculpt's.
  { id: 'view.light', label: 'Move the key light (hold + drag: across / up)', group: 'Lighting', mode: 'view', chord: 'l', hold: true, sameKeyAs: 'light.move' },
  // --- viewer: playback ---
  // One key for both: the viewer's playback, and Present's turntable in Sculpt.
  { id: 'play.toggle', present: true, presentLabel: 'Turntable: start and stop', label: 'Play / pause (in Present, the turntable)', group: 'Playback', mode: 'both', chord: 'space' },
  { id: 'play.back', label: 'Step back', group: 'Playback', mode: 'view', chord: 'arrowleft', repeat: true },
  { id: 'play.forward', label: 'Step forward', group: 'Playback', mode: 'view', chord: 'arrowright', repeat: true },
  // --- viewer: view gestures ---
  { id: 'gesture.viewOrbit', label: 'Orbit (one finger, the Pencil or the mouse)', group: 'View', mode: 'view', chord: null, gesture: true, note: 'Drag' },
  { id: 'gesture.viewPan', label: 'Pan (two-finger drag on touch)', group: 'View', mode: 'view', chord: null, gesture: true, note: 'Cmd / Shift + drag' },
  { id: 'gesture.viewZoom', label: 'Zoom', group: 'View', mode: 'view', chord: null, gesture: true, note: 'Scroll / pinch' },
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
  // --- armature mode ------------------------------------------------------
  { id: 'arm.symmetry', label: 'Mirror pose edits to the other side', group: 'Armature', mode: 'armature', chord: 'x' },
  { id: 'arm.move', label: 'Move the figure, or the selected handle (move gizmo)', group: 'Armature', mode: 'armature', chord: 'w' },
  { id: 'arm.rotate', label: 'Rotate what is selected', group: 'Armature', mode: 'armature', chord: 'e' },
  { id: 'arm.gizmo', label: 'Move and rotate together', group: 'Armature', mode: 'armature', chord: 't' },
  { id: 'arm.scale', label: 'Scale the selected part (its size and length)', group: 'Armature', mode: 'armature', chord: 'r' },
  { id: 'arm.aim', label: 'Aim the knee or elbow of the selected limb', group: 'Armature', mode: 'armature', chord: null, gesture: true, note: 'Drag the small ball' },
  { id: 'gesture.armRoot', label: 'Move the whole figure by the ball in the hips, pinned hands and feet staying put', group: 'Armature', mode: 'armature', chord: null, gesture: true, note: 'Drag the hip ball' },
  { id: 'arm.resetPose', label: 'Reset the pose', group: 'Armature', mode: 'armature', chord: 'shift+r' },
  { id: 'arm.deselect', label: 'Deselect the joint', group: 'Armature', mode: 'armature', chord: 'escape' },
  { id: 'arm.undo', label: 'Undo', group: 'Armature', mode: 'armature', chord: 'ctrl+z', repeat: true, sameKeyAs: 'edit.undo' },
  { id: 'arm.redo', label: 'Redo', group: 'Armature', mode: 'armature', chord: 'ctrl+shift+z', repeat: true, sameKeyAs: 'edit.redo' },
  { id: 'arm.send', label: 'Remesh to a figure', group: 'Armature', mode: 'armature', chord: 'ctrl+enter' },
  { id: 'gesture.armPick', label: 'Select a part (its gizmo appears; a tap on touch)', group: 'Armature', mode: 'armature', chord: null, gesture: true, note: 'Click a part' },
  { id: 'gesture.armOrbit', label: 'Orbit, on the figure or off it, keeping the selection', group: 'Armature', mode: 'armature', chord: null, gesture: true, note: 'Drag' },
  { id: 'gesture.armDeselect', label: 'Deselect', group: 'Armature', mode: 'armature', chord: null, gesture: true, note: 'Click off the figure' },
  { id: 'gesture.armBall', label: 'Select a hand, foot or head ball (move gizmo)', group: 'Armature', mode: 'armature', chord: null, gesture: true, note: 'Click the ball' },
  // Sculpt mode's light.move, for the figure: a key of its own (not a
  // gesture row) so Preferences can rebind it as it can sculpt's.
  { id: 'arm.light', label: 'Move the key light (hold + drag: across / up)', group: 'Armature', mode: 'armature', chord: 'l', hold: true },
  // --- interface ---
  // After the Armature rows, so every mode lists its Interface keys under
  // one heading, and so Armature's Esc (arm.deselect, the same key) is
  // found first there; it shows a hidden interface as well (armature/mode).
  // Tab and Esc are the same in every mode (owner decision): one rebind
  // moves them everywhere.
  { id: 'ui.chrome', present: true, label: 'Close panels, then hide the interface', group: 'Interface', mode: 'both', chord: 'tab' },
  { id: 'ui.show', present: true, label: 'Show the interface', group: 'Interface', mode: 'both', chord: 'escape' },
  // The workspaces by number, from any of them (the only workspace keys; Esc does not leave Present): Shift and the digit's physical key (keyNameOf), so a Swedish and a US keyboard agree.
  { id: 'ws.armature', present: true, label: 'Go to Armature', group: 'Interface', mode: 'sculpt', chord: 'shift+1' },
  { id: 'ws.sculpt', present: true, label: 'Go to Sculpt', group: 'Interface', mode: 'sculpt', chord: 'shift+2' },
  { id: 'ws.paint', present: true, label: 'Go to Paint', group: 'Interface', mode: 'sculpt', chord: 'shift+3' },
  { id: 'ws.present', present: true, label: 'Go to Present', group: 'Interface', mode: 'sculpt', chord: 'shift+4' },
  // Save: to the library for whoever saves to one, else the copy on this device at once (owner request, 2026-11-18).
  { id: 'file.save', present: true, label: 'Save', group: 'Interface', mode: 'sculpt', chord: 'ctrl+s' },
  { id: 'arm.save', label: 'Save', group: 'Interface', mode: 'armature', chord: 'ctrl+s', sameKeyAs: 'file.save' },
  { id: 'ui.help', present: true, label: 'Hotkey guide', group: 'Interface', mode: 'both', chord: 'h' },
  { id: 'ui.fps', present: true, label: 'Frame meter', group: 'Interface', mode: 'both', chord: 'shift+p' },
  { id: 'ui.preferences', present: true, label: 'Preferences (fingers, hotkeys)', group: 'Interface', mode: 'both', chord: 'ctrl+,' },
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

/** A control's label with its action's current key after it, "Wireframe (Shift + W)"; the bare label when unbound. */
export function keyedLabel(label: string, actionId: string): string {
  const chord = keymap.chordFor(actionId);
  return chord ? `${label} (${chordLabel(chord)})` : label;
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
    // What an earlier visit kept is read once saving is allowed (ui/deviceStorage).
    // Turned on again after being off, what is on screen is kept and written.
    onDeviceChoice((c, was) => {
      if (c !== 'keep') return;
      if (was === 'none') {
        this.load();
        this.emit();
      } else this.save();
    });
    // The places' words (the guide's and Preferences' "Tool bar, place 3: ...") follow the order of a bar: whoever draws them is told as for a rebind.
    toolBars.onChange(() => this.emit());
  }

  action(id: string): ActionDef | undefined {
    return this.byId.get(id);
  }

  /** The action whose key `id` answers to: itself, or the one it shares a key with. */
  private keyOwner(id: string): string {
    const shared = this.byId.get(id)?.sameKeyAs;
    return shared && this.byId.has(shared) ? shared : id;
  }

  /** The chord an action answers to now, or null when unbound. */
  chordFor(id: string): string | null {
    const key = this.keyOwner(id);
    if (this.overrides.has(key)) return this.overrides.get(key) ?? null;
    return this.byId.get(key)?.chord ?? null;
  }

  /**
   * The words a row is listed by in a mode: its label, and for a place on the
   * tool bar the tool that holds the place in that mode's bar ("Tool bar,
   * place 3: Standard clay", or "...: empty").
   */
  labelFor(a: ActionDef, mode: KeyMode = 'sculpt'): string {
    if (mode === 'present' && a.presentLabel) return a.presentLabel;
    const place = placeOfAction(a.id);
    if (!place) return a.label;
    const id = toolBars.idAt(mode === 'paint' ? 'paint' : 'sculpt', place);
    return `${a.label}: ${(id && toolById(id)?.name) || 'empty'}`;
  }

  /** Whether a place of a mode's tool bar holds a tool (the guide leaves the others out). */
  placeFilled(a: ActionDef, mode: KeyMode = 'sculpt'): boolean {
    const place = placeOfAction(a.id);
    return !place || !!toolBars.idAt(mode === 'paint' ? 'paint' : 'sculpt', place);
  }

  isOverridden(id: string): boolean {
    return this.overrides.has(this.keyOwner(id));
  }

  /** Every action a mode's handler can be asked for, in table order. */
  actionsFor(mode: KeyMode): ActionDef[] {
    if (mode === 'present') return ACTIONS.filter((a) => a.mode === 'present' || a.present);
    if (mode === 'paint') return ACTIONS.filter((a) => a.mode === 'paint' || a.mode === 'both' || (a.mode === 'sculpt' && !PAINT_LEAVES_OUT.test(a.id)));
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

  /**
   * Rebind (null unbinds). Another action on the same chord in the same mode
   * is unbound. An action sharing another's key (sameKeyAs) rebinds that
   * one, and so both, in every mode either answers in.
   */
  rebind(id: string, chord: string | null): void {
    const a = this.byId.get(this.keyOwner(id));
    if (!a) return;
    id = a.id;
    if (chord) {
      for (const other of ACTIONS) {
        if (this.keyOwner(other.id) === id) continue;
        if (!this.sharesMode(a, other)) continue;
        if (this.chordFor(other.id) === chord) this.overrides.set(this.keyOwner(other.id), null);
      }
    }
    if (chord === a.chord) this.overrides.delete(id);
    else this.overrides.set(id, chord);
    this.save();
    this.emit();
  }

  /** What a chord would displace in an action's modes, for the editor to say so. */
  conflictFor(id: string, chord: string): ActionDef | null {
    const a = this.byId.get(this.keyOwner(id));
    if (!a) return null;
    for (const other of ACTIONS) {
      if (this.keyOwner(other.id) === a.id || !this.sharesMode(a, other)) continue;
      if (this.chordFor(other.id) === chord) return other;
    }
    return null;
  }

  reset(id: string): void {
    this.overrides.delete(this.keyOwner(id));
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

  /** Whether two actions answer in a mode in common, counting the actions that share each one's key. */
  private sharesMode(a: ActionDef, b: ActionDef): boolean {
    const ma = this.modesOf(a);
    const mb = this.modesOf(b);
    return ma.has('both') || mb.has('both') || [...ma].some((m) => mb.has(m));
  }

  /** The modes an action's key is heard in: its own, and those of every action sharing it. */
  private modesOf(a: ActionDef): Set<KeyMode | 'both'> {
    const owner = this.keyOwner(a.id);
    const modes = new Set<KeyMode | 'both'>(ACTIONS.filter((x) => this.keyOwner(x.id) === owner).map((x) => x.mode));
    // Sculpt's keys that the Paint workspace keeps answer there too: a chord taken in one is taken in the other.
    if (modes.has('sculpt') && !PAINT_LEAVES_OUT.test(owner)) modes.add('paint');
    // The keys Present keeps answer there too.
    if (ACTIONS.some((x) => this.keyOwner(x.id) === owner && x.present)) modes.add('present');
    return modes;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private load(): void {
    try {
      const raw = deviceStore.get(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string | null>;
      // Present and Paint had keys of their own (ui.present, ui.paint): a rebind carries over to the workspace keys.
      for (const [from, to] of [['ui.present', 'ws.present'], ['ui.paint', 'ws.paint']]) {
        if (from in parsed && !(to in parsed)) parsed[to] = parsed[from];
      }
      // The tool keys became places on the bar (tool.crease, paint.erase ...): a rebind carries to the place that tool holds by default. Sculpt's go first, so where Paint's tool on the same place was rebound too, Sculpt's wins.
      for (const [from, to] of legacyKeyMoves()) {
        if (from in parsed && !(to in parsed)) parsed[to] = parsed[from];
      }
      for (const [id, chord] of Object.entries(parsed)) {
        if (!this.byId.has(id) || this.byId.get(id)?.sameKeyAs) continue;
        if (chord !== null && typeof chord !== 'string') continue;
        this.overrides.set(id, chord);
      }
    } catch {
      // A blocked or corrupt store: the defaults stand.
    }
  }

  private save(): void {
    try {
      if (this.overrides.size === 0) deviceStore.remove(STORAGE_KEY);
      else deviceStore.set(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.overrides)));
    } catch {
      // The rebind still holds for this page; it just will not survive a reload.
    }
  }
}

/** The one keymap every handler consults. */
export const keymap = new Keymap();
