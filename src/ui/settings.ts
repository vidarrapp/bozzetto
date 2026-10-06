/**
 * Settings: the Preferences window's choices that are not keys. Saved per
 * browser beside the keymap, and read live by whatever they steer - the
 * sculpt input shell asks at every finger press - so a change applies to
 * the next press without a reload.
 */

/** A setting that is either on or off, kept as a word so the store stays one shape. */
export type OnOff = 'on' | 'off';

export interface SettingsValues {
  /**
   * What a finger does in Sculpt. 'navigate' (the default, owner call): one
   * finger orbits and two pan and zoom in every tool, and only the pen and
   * the mouse sculpt, select or drag the gizmo. 'sculpt': the older
   * behaviour, for sculpting without a pen - a finger on the model strokes.
   */
  fingers: 'navigate' | 'sculpt';
  /**
   * What a frame draws while a stroke, a pose drag or the view is moving,
   * in Sculpt and Armature. 'fast' (the default): ambient occlusion holds
   * still under a stroke and steps aside while things move, and the fill
   * and rim shadows refresh less often (Viewer.updateFrameMode). 'full':
   * every frame drawn as a still one is.
   */
  interactionLook: 'fast' | 'full';
  /**
   * Anti-aliasing in Sculpt and Armature (Preferences > Performance).
   * 'still' (the default, owner call): frames are drawn without it while
   * anything moves, and a still view is smoothed over the next frames
   * (Viewer.updateAntialias). 'always': 4x MSAA on every frame, as before.
   * 'off': never, on screen; thumbnails are smoothed whatever this says.
   */
  antialias: 'still' | 'always' | 'off';
  /** Adaptive quality: lighter frames while they keep missing the display (adaptive.ts). */
  adaptive: OnOff;
  /**
   * How opaque the panels are, in percent (Preferences > Appearance): from
   * 60, where a good deal of the view shows through, to 100, solid. Nothing
   * behind a panel is blurred at any setting (appearance.ts).
   */
  panelOpacity: number;
  /** The frame meter (P), kept across reloads so a device keeps showing it. */
  meter: OnOff;
  /** The stall log overlay (what ?perfdebug=1 shows), in every mode. */
  stallLog: OnOff;
  /** The input log overlay in Sculpt (what ?inputdebug=1 shows). */
  inputLog: OnOff;
}

const DEFAULTS: SettingsValues = {
  fingers: 'navigate',
  interactionLook: 'fast',
  antialias: 'still',
  adaptive: 'on',
  panelOpacity: 95,
  meter: 'off',
  stallLog: 'off',
  inputLog: 'off',
};

const ON_OFF = ['on', 'off'] as const;

/** A number setting's range, whole numbers only. */
interface Range {
  min: number;
  max: number;
}

/**
 * Each setting's accepted values - a list, or a number's range - and
 * anything else in the store is ignored.
 */
const ALLOWED: { [K in keyof SettingsValues]: SettingsValues[K] extends number ? Range : readonly SettingsValues[K][] } = {
  fingers: ['navigate', 'sculpt'],
  interactionLook: ['fast', 'full'],
  antialias: ['still', 'always', 'off'],
  adaptive: ON_OFF,
  panelOpacity: { min: 60, max: 100 },
  meter: ON_OFF,
  stallLog: ON_OFF,
  inputLog: ON_OFF,
};

/** Whether `value` is one `key` accepts. */
function accepts(key: keyof SettingsValues, value: unknown): boolean {
  const rule = ALLOWED[key] as Range | readonly unknown[];
  if (Array.isArray(rule)) return rule.includes(value);
  const range = rule as Range;
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;
}

/** A number setting's range, for the control that sets it. */
export function rangeOf(key: 'panelOpacity'): Range {
  return { ...ALLOWED[key] };
}

const STORAGE_KEY = 'bozzetto-settings';

type Listener = () => void;

export class Settings {
  private values: SettingsValues = { ...DEFAULTS };
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.load();
  }

  get<K extends keyof SettingsValues>(key: K): SettingsValues[K] {
    return this.values[key];
  }

  set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
    if (!accepts(key, value) || this.values[key] === value) return;
    this.values[key] = value;
    this.save();
    for (const fn of this.listeners) fn();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<keyof SettingsValues, unknown>>;
      for (const key of Object.keys(ALLOWED) as Array<keyof SettingsValues>) {
        const v = parsed[key];
        if (accepts(key, v)) (this.values as unknown as Record<string, unknown>)[key] = v;
      }
    } catch {
      // A blocked or corrupt store: the defaults stand.
    }
  }

  /** Only what differs from the defaults is written, as the keymap does. */
  private save(): void {
    const changed: Partial<SettingsValues> = {};
    for (const key of Object.keys(DEFAULTS) as Array<keyof SettingsValues>) {
      if (this.values[key] !== DEFAULTS[key]) {
        (changed as Record<string, unknown>)[key] = this.values[key];
      }
    }
    try {
      if (Object.keys(changed).length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
    } catch {
      // The choice still holds for this page; it just will not survive a reload.
    }
  }
}

/** The one settings store every reader consults. */
export const settings = new Settings();
