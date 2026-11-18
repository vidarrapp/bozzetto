/**
 * The one table of tools.
 *
 * Every tool the app has, in Sculpt and in Paint, is an entry here: a stable
 * word id (`bz.clay`), the engine's tool number, the workspace, the name, the
 * icon, a one-line description, the Help topic, and the list of its
 * settings. The tool bar's buttons, the Tool panel's rows, the keys, the
 * Help topics' key lines and the scene's table of brush settings all read it,
 * so a tool is described once. Where a tool sits on a bar is not here but in
 * `bars.ts`: the bar is an ordered list of these ids.
 *
 * This file is data and nothing else (no engine, no DOM), so the keymap and
 * the scene's sanitiser can read it without pulling the engine in. The
 * engine numbers below are the vendored `Enums.Tools` values; the toolNames
 * suite holds them to the live engine.
 */

export type Workspace = 'sculpt' | 'paint';

/**
 * What a setting is for. The first seven are the rows every brush shares
 * (the Tool panel builds them from the engine's own size, strength and
 * dynamics), `curve` is a profile curve, `own` a knob only that tool has.
 */
export type SettingRole =
  | 'colour'
  | 'size'
  | 'pressureSize'
  | 'sizeCurve'
  | 'strength'
  | 'pressureStrength'
  | 'strengthCurve'
  | 'spacing'
  | 'curve'
  | 'own';

/** How a setting is drawn and edited. */
export type SettingKind = 'colour' | 'range' | 'select' | 'toggle' | 'curve' | 'presets' | 'hint';

/** When a row shows: always, or only while another setting says so. */
export type SettingWhen = 'always' | 'pressure-size' | 'pressure-strength' | 'smooth-surface';

/** What a typed value may be, past the slider's travel (sliderEntry's Limits). */
export interface SettingLimits {
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface SettingSpec {
  role: SettingRole;
  /** The name the setting is saved under in the scene's table for its tool. */
  key: string;
  label: string;
  kind: SettingKind;
  /** The slider's travel and step (kind 'range'). */
  min?: number;
  max?: number;
  step?: number;
  /** What a typed value is held to. */
  limits?: SettingLimits;
  /** The unit printed after a value: 'px' for a size, 'cm' for a strength in centimetres. */
  unit?: 'px' | 'cm';
  /**
   * Where it starts on a fresh engine, for a scene that has no value for it.
   * Only the knobs with no record of their own have one: the Rake's and
   * Smooth's rows are reset by their record's loader.
   */
  default?: number | boolean | string;
  /** The choices of a select: value and label. */
  options?: ReadonlyArray<readonly [string, string]>;
  when?: SettingWhen;
  /** 'brush': the block under the heading every brush has; 'own': the tool's own block below it. */
  block: 'brush' | 'own';
  /**
   * The engine object's own field for a knob of the tool's own: it is read
   * from `tool[prop]`, and written by assigning it, or through
   * `tool[setter]({ [setKey ?? key]: value })` where the tool has a setter.
   */
  prop?: string;
  setter?: string;
  setKey?: string;
  /** The name a curve editor or a select is announced by. */
  aria?: string;
  /** The text of a hint, and what a colour row says under its swatch. */
  text?: string;
  /** Saved with the scene: every knob of the tool's own is (a hint is not). */
  saved?: boolean;
  /** Attributes the row carries for whoever finds it by name (the tests, the Smooth group). */
  data?: Record<string, string>;
}

export interface ToolDef {
  /** Stable word id, kept in scenes, keys and files. */
  id: string;
  /** The vendored engine's tool number; null for a tool the app does not run. */
  engine: number | null;
  /** The bar it sits on by default; null for a tool no bar offers yet. */
  workspace: Workspace | null;
  /** 'mode' tools (Select, Transform, Calipers) are not brushes: they have no place and a key of their own. */
  kind: 'brush' | 'mode';
  /** The tooltip's and the panel heading's name. */
  name: string;
  /** The panel's heading where it is not the name: Local scale has never had one and reads "Brush". */
  heading?: string;
  /** The button's accessible name. `{key}` is the tool's current key, with its brackets dropped when it has none. */
  label: string;
  /** The Uicons class, or null for a tool no button shows yet. */
  icon: string | null;
  /** The name of an `icons/<slot>.svg` that replaces the glyph. */
  slot: string | null;
  /** One line, 30 characters or fewer. */
  description: string;
  /** The Help topic id, or null. */
  help: string | null;
  /** The keymap action of a mode tool's own key (Select q, Transform t, Calipers c). */
  keyAction?: string;
  /** Shift smooths from this tool, so its Tool panel carries the Smooth (Shift) group. */
  shiftSmooths?: boolean;
  /**
   * The tool's own knobs also ride a record the older builds wrote and read
   * (`settings.rake`, `settings.smooth`); the scene loads them through its
   * loader, which knows the presets and the older shapes of that record.
   */
  ownRecord?: 'rake' | 'smooth';
  /** The Tool panel's rows, in order. Mode tools' panels are built by hand and list none. */
  settings: SettingSpec[];
}

// --- the rows -------------------------------------------------------------------------

const FRACTION: SettingLimits = { min: 0, max: 1 };

const size = (): SettingSpec => ({
  role: 'size',
  key: 'size',
  label: 'Size',
  kind: 'range',
  min: 5,
  max: 500,
  step: 1,
  limits: { min: 1, integer: true },
  unit: 'px',
  block: 'brush',
});
const pressureSize = (): SettingSpec => ({ role: 'pressureSize', key: 'pressureSize', label: 'Pressure: size', kind: 'range', min: 0, max: 1, step: 0.05, limits: FRACTION, block: 'brush' });
const sizeCurve = (): SettingSpec => ({
  role: 'sizeCurve',
  key: 'sizeCurve',
  label: 'Size curve',
  kind: 'select',
  options: [
    ['linear', 'Linear'],
    ['soft', 'Soft (light touch)'],
    ['firm', 'Firm (press hard)'],
  ],
  when: 'pressure-size',
  block: 'brush',
});
/** A strength in centimetres (Clay, Inflate, Crease, the Rake) or a fraction (the rest). */
const strength = (cm: boolean): SettingSpec =>
  cm
    ? { role: 'strength', key: 'strength', label: 'Strength', kind: 'range', min: 0, max: 5, step: 0.01, limits: { min: 0, max: 50 }, unit: 'cm', block: 'brush' }
    : { role: 'strength', key: 'strength', label: 'Strength', kind: 'range', min: 0, max: 1, step: 0.01, limits: FRACTION, block: 'brush' };
const pressureStrength = (): SettingSpec => ({ role: 'pressureStrength', key: 'pressureStrength', label: 'Pressure: strength', kind: 'range', min: 0, max: 1, step: 0.05, limits: FRACTION, block: 'brush' });
const strengthCurve = (): SettingSpec => ({ ...sizeCurve(), role: 'strengthCurve', key: 'strengthCurve', label: 'Strength curve', when: 'pressure-strength' });
const spacing = (): SettingSpec => ({ role: 'spacing', key: 'spacing', label: 'Spacing', kind: 'range', min: 0.02, max: 0.6, step: 0.01, limits: { min: 0.02 }, block: 'brush' });
/** A profile curve: `caption` is its label in the panel, `aria` the editor's name. */
const curve = (caption: string, aria: string): SettingSpec => ({ role: 'curve', key: 'curve', label: caption, kind: 'curve', aria, block: 'own' });

/** Size, pressure on size and its curve: every brush with a radius has these. */
const sizeRows = (): SettingSpec[] => [size(), pressureSize(), sizeCurve()];
/** Strength, pressure on strength and its curve. */
const strengthRows = (cm: boolean): SettingSpec[] => [strength(cm), pressureStrength(), strengthCurve()];

/** A knob of the tool's own, saved with the scene. */
const own = (key: string, label: string, kind: 'range' | 'toggle' | 'select', rest: Partial<SettingSpec> & { prop: string }): SettingSpec => ({
  role: 'own',
  key,
  label,
  kind,
  block: 'own',
  saved: true,
  ...rest,
});

/** What most sculpting brushes have: size, strength, pressure on both, spacing. */
const brushRows = (cm: boolean): SettingSpec[] => [...sizeRows(), ...strengthRows(cm), spacing()];

const SMOOTH_MODE_OPTIONS = [
  ['average', 'Average'],
  ['surface', 'Surface'],
] as const;

/** Smooth's own rows: the Mode, and Surface's Relax. The Smooth (Shift) group draws these too. */
export const SMOOTH_OWN: SettingSpec[] = [
  own('mode', 'Mode', 'select', { prop: 'smoothMode', setter: 'setSmooth', setKey: 'mode', options: SMOOTH_MODE_OPTIONS, aria: 'Smooth mode' }),
  own('relax', 'Relax', 'range', { prop: 'relax', setter: 'setSmooth', setKey: 'relax', min: 0, max: 1, step: 0.05, limits: FRACTION, when: 'smooth-surface', data: { smooth: 'relax' } }),
];

const RAKE_HINT =
  'Tines cut down to the Strength below the surface, then only take off what stands proud. Off: every pass cuts deeper.';

// --- the tools -------------------------------------------------------------------------

export const TOOLS: readonly ToolDef[] = [
  // --- Sculpt's bar ---
  {
    id: 'bz.crease',
    engine: 6,
    workspace: 'sculpt',
    kind: 'brush',
    name: 'Crease',
    label: 'Crease',
    icon: 'fi-ss-scalpel',
    slot: 'crease',
    description: 'Sharp grooves and folds',
    help: 'tool-crease',
    shiftSmooths: true,
    settings: [
      ...brushRows(true),
      curve('Profile', 'Crease profile'),
      own('pinch', 'Pinch', 'range', { prop: 'pinch', min: 0, max: 2.5, step: 0.1, limits: { min: 0 }, default: 0.625 }),
    ],
  },
  {
    id: 'bz.move',
    engine: 9,
    workspace: 'sculpt',
    kind: 'brush',
    name: 'Move',
    label: 'Move',
    icon: 'fi-ss-arrows',
    slot: 'move',
    description: 'Moves a region with the pen',
    help: 'tool-move',
    shiftSmooths: true,
    settings: [
      ...sizeRows(),
      ...strengthRows(false),
      own('falloff', 'Falloff (sharp-soft)', 'range', { prop: 'falloffPow', min: 0.3, max: 1, step: 0.05, limits: { min: 0.05 }, default: 1 }),
    ],
  },
  {
    id: 'bz.clay',
    engine: 0,
    workspace: 'sculpt',
    kind: 'brush',
    name: 'Standard clay',
    label: 'Standard (clay)',
    icon: 'fi-ss-screwdriver',
    slot: 'standard',
    description: 'Builds up strips of clay',
    help: 'tool-clay',
    shiftSmooths: true,
    settings: [...brushRows(true), curve('Profile', 'Clay profile')],
  },
  {
    id: 'bz.inflate',
    engine: 1,
    workspace: 'sculpt',
    kind: 'brush',
    name: 'Inflate',
    label: 'Inflate',
    icon: 'fi-ss-expand-arrows-alt',
    slot: 'inflate',
    description: 'Swells the surface out',
    help: 'tool-inflate',
    shiftSmooths: true,
    settings: brushRows(true),
  },
  {
    id: 'bz.pinch',
    engine: 5,
    workspace: 'sculpt',
    kind: 'brush',
    name: 'Pinch',
    label: 'Pinch',
    icon: 'fi-ss-compress',
    slot: 'pinch',
    description: 'Tightens ridges and creases',
    help: 'tool-pinch',
    shiftSmooths: true,
    settings: brushRows(false),
  },
  {
    id: 'bz.flatten',
    engine: 4,
    workspace: 'sculpt',
    kind: 'brush',
    name: 'Flatten',
    label: 'Flatten',
    icon: 'fi-ss-arrows-to-line',
    slot: 'flatten',
    description: 'Planes toward a flat level',
    help: 'tool-flatten',
    shiftSmooths: true,
    settings: brushRows(false),
  },
  {
    id: 'bz.rake',
    engine: 13,
    workspace: 'sculpt',
    kind: 'brush',
    name: 'Rake',
    // Smooth lost its digit to the Rake (owner call): its icon slot is still named smooth.
    label: 'Rake (shift still smooths)',
    icon: 'fi-ss-shredder',
    slot: 'smooth',
    description: 'Parallel grooves, like a comb',
    help: 'tool-rake',
    shiftSmooths: true,
    ownRecord: 'rake',
    settings: [
      ...brushRows(true),
      { role: 'own', key: 'preset', label: 'Preset', kind: 'presets', block: 'own', saved: true, prop: 'presetId' },
      own('tines', 'Tines', 'range', { prop: 'tines', min: 2, max: 12, step: 1, limits: { min: 2, max: 12, integer: true }, setter: 'set' }),
      own('width', 'Tine width', 'range', { prop: 'tineWidth', setter: 'set', min: 0.1, max: 1, step: 0.05, limits: { min: 0.1, max: 1 } }),
      own('scrape', 'Scrape', 'range', { prop: 'scrape', setter: 'set', min: 0, max: 1, step: 0.05, limits: FRACTION }),
      own('taper', 'Taper', 'range', { prop: 'taper', setter: 'set', min: 0, max: 1, step: 0.05, limits: FRACTION }),
      own('invert', 'Invert (raise ridges)', 'toggle', { prop: 'invert', setter: 'set' }),
      own('level', 'Stop at depth', 'toggle', { prop: 'level', setter: 'set' }),
      { role: 'own', key: 'rakeHint', label: '', kind: 'hint', block: 'own', text: RAKE_HINT },
      curve('Tine profile', 'Tine profile'),
    ],
  },
  {
    id: 'bz.drag',
    engine: 7,
    workspace: 'sculpt',
    kind: 'brush',
    name: 'Drag',
    label: 'Drag',
    icon: 'fi-ss-hand-back-fist',
    slot: 'drag',
    description: 'Pulls the surface along',
    help: 'tool-drag',
    shiftSmooths: true,
    // Drag has no strength, so no strength row and no pressure on it; and it holds one anchor for the stroke, so no spacing.
    settings: sizeRows(),
  },
  {
    id: 'bz.polish',
    engine: 2,
    workspace: 'sculpt',
    kind: 'brush',
    // The Twist slot of the vendored engine: the Polish brush took it.
    name: 'Polish',
    label: 'Polish',
    icon: 'fi-ss-broom',
    slot: 'polish',
    description: 'Flattens, keeps edges sharp',
    help: 'tool-polish',
    shiftSmooths: true,
    settings: [
      ...brushRows(false),
      own('planeLock', 'Plane lock (follow-flatten)', 'range', { prop: 'planeLock', min: 0, max: 0.95, step: 0.05, limits: { min: 0, max: 0.95 }, default: 0 }),
      curve('Profile', 'Polish profile'),
      own('gain', 'Build-up', 'range', { prop: 'gain', min: 0.2, max: 2, step: 0.1, limits: { min: 0 }, default: 0.8 }),
    ],
  },
  // --- Sculpt's tools no bar offers yet ---
  {
    id: 'bz.smooth',
    engine: 3,
    workspace: null,
    kind: 'brush',
    name: 'Smooth',
    label: 'Smooth',
    icon: null,
    slot: null,
    description: 'Evens the surface (Shift)',
    help: 'tool-smooth',
    ownRecord: 'smooth',
    settings: [...sizeRows(), ...strengthRows(false), spacing(), ...SMOOTH_OWN],
  },
  {
    id: 'bz.mask',
    engine: 10,
    workspace: null,
    kind: 'brush',
    name: 'Mask',
    label: 'Mask',
    icon: null,
    slot: null,
    description: 'Protects the surface (Ctrl)',
    help: 'tool-mask',
    settings: brushRows(false),
  },
  {
    // The vendored Twist is not installed: its slot holds Polish. Listed so the table says what the engine has.
    id: 'bz.twist',
    engine: null,
    workspace: null,
    kind: 'brush',
    name: 'Twist',
    label: 'Twist',
    icon: null,
    slot: null,
    description: 'Twists the surface at a point',
    help: null,
    settings: [],
  },
  {
    id: 'bz.local-scale',
    engine: 11,
    workspace: null,
    kind: 'brush',
    name: 'Local scale',
    heading: 'Brush',
    label: 'Local scale',
    icon: null,
    slot: null,
    description: 'Scales the surface at a point',
    help: null,
    shiftSmooths: true,
    settings: [...sizeRows(), spacing()],
  },
  // --- Paint's bar ---
  {
    id: 'bz.paint',
    engine: 8,
    workspace: 'paint',
    kind: 'brush',
    name: 'Paint',
    label: 'Paint (alt: pick colour, shift: blur)',
    icon: 'fi-ss-paint',
    slot: 'paint',
    description: 'Paints colour on the surface',
    help: 'tool-paint',
    settings: [
      { role: 'colour', key: 'colour', label: 'Colour', kind: 'colour', block: 'brush', text: 'Alt+click for color picker' },
      ...brushRows(false),
      curve('Profile', 'Paint profile'),
    ],
  },
  {
    id: 'bz.erase',
    engine: 15,
    workspace: 'paint',
    kind: 'brush',
    name: 'Erase',
    label: "Erase: lowers the layer's alpha",
    icon: 'fi-ss-eraser',
    slot: 'erase',
    description: "Lowers the layer's alpha",
    help: 'tool-erase',
    settings: [...brushRows(false), curve('Profile', 'Paint profile')],
  },
  {
    id: 'bz.blur',
    engine: 16,
    workspace: 'paint',
    kind: 'brush',
    name: 'Blur',
    label: 'Blur: softens the layer',
    icon: 'fi-ss-raindrops',
    slot: 'blur',
    description: 'Softens the layer',
    help: 'tool-blur',
    settings: [...brushRows(false), curve('Profile', 'Paint profile')],
  },
  {
    // A tap, not a brush: the colour and nothing else.
    id: 'bz.fill',
    engine: 17,
    workspace: 'paint',
    kind: 'brush',
    name: 'Fill',
    label: 'Fill: the layer, or the part that is not masked',
    icon: 'fi-ss-fill',
    slot: 'fill',
    description: 'Fills the layer with colour',
    help: 'tool-fill',
    settings: [{ role: 'colour', key: 'colour', label: 'Colour', kind: 'colour', block: 'brush', text: 'Tap the model to fill.' }],
  },
  {
    id: 'bz.pick',
    engine: 18,
    workspace: 'paint',
    kind: 'brush',
    name: 'Pick',
    label: 'Pick: takes a colour from the model',
    icon: 'fi-ss-eye-dropper-half',
    slot: 'pick',
    description: 'Takes a colour from the model',
    help: 'tool-pick',
    settings: [{ role: 'colour', key: 'colour', label: 'Colour', kind: 'colour', block: 'brush', text: 'Tap or drag on the model to take its colour.' }],
  },
  {
    id: 'bz.project',
    engine: 19,
    workspace: 'paint',
    kind: 'brush',
    name: 'Project',
    label: 'Project: paints a reference picture onto the model',
    icon: 'fi-ss-projector',
    slot: 'project',
    description: 'Projects a reference picture',
    help: 'tool-project',
    settings: [
      {
        role: 'own',
        key: 'projectHint',
        label: '',
        kind: 'hint',
        block: 'brush',
        text: 'Paints the reference picture in the view onto the model under the brush. Lock the pictures first so the brush reaches the model.',
      },
      ...brushRows(false),
      curve('Profile', 'Paint profile'),
    ],
  },
  // --- the tools that are not brushes: no place on a bar, a key of their own ---
  {
    id: 'bz.select',
    engine: null,
    workspace: 'sculpt',
    kind: 'mode',
    name: 'Select',
    label: 'Select ({key}): click, shift adds, ctrl+drag removes, drag a marquee',
    icon: 'fi-ss-cursor',
    slot: 'select',
    description: 'Picks objects',
    help: 'tool-select',
    keyAction: 'tool.select',
    settings: [],
  },
  {
    id: 'bz.transform',
    engine: null,
    workspace: 'sculpt',
    kind: 'mode',
    name: 'Transform',
    label: 'Transform ({key}): move, rotate and scale; w/e/r show one kind',
    icon: 'fi-ss-transformation-block',
    slot: 'transform',
    description: 'Moves, turns, scales objects',
    help: 'tool-transform',
    keyAction: 'gizmo.toggle',
    settings: [],
  },
  {
    id: 'bz.calipers',
    engine: null,
    workspace: 'sculpt',
    kind: 'mode',
    name: 'Calipers',
    label: 'Calipers ({key}): tap the model twice to measure between the points',
    // The uicons ruler, until a drawn glyph is dropped in as icons/calipers.svg (the slot name is the swap).
    icon: 'fi-ss-ruler-combined',
    slot: 'calipers',
    description: 'Measures between two points',
    help: 'tool-calipers',
    keyAction: 'tool.calipers',
    settings: [],
  },
];

// --- lookups ---------------------------------------------------------------------------

const byId = new Map<string, ToolDef>(TOOLS.map((t) => [t.id, t]));
const byEngine = new Map<number, ToolDef>();
for (const t of TOOLS) if (t.engine !== null && t.kind === 'brush') byEngine.set(t.engine, t);

export function toolById(id: string): ToolDef | undefined {
  return byId.get(id);
}

/** The tool an engine number runs, or undefined (the Paint blur Shift swaps in has none). */
export function toolByEngine(engine: number): ToolDef | undefined {
  return byEngine.get(engine);
}

/** The tools that have an engine number: the ones whose settings the scene keeps. */
export const ENGINE_TOOLS: readonly ToolDef[] = TOOLS.filter((t) => t.engine !== null && t.kind === 'brush');

/** The heading the Tool panel wears for an engine tool; 'Brush' for one this table does not know. */
export function toolName(engine: number): string {
  const def = byEngine.get(engine);
  return def?.heading ?? def?.name ?? 'Brush';
}

/** What the scene's saved settings call a tool: its saved knobs, by key. */
export function savedSpecs(def: ToolDef): SettingSpec[] {
  return def.settings.filter((s) => s.saved);
}
