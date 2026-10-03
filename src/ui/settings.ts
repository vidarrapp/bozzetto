/**
 * Settings: the Preferences window's choices that are not keys. Saved per
 * browser beside the keymap, and read live by whatever they steer - the
 * sculpt input shell asks at every finger press - so a change applies to
 * the next press without a reload.
 */

export interface SettingsValues {
  /**
   * What a finger does in Sculpt. 'navigate' (the default, owner call): one
   * finger orbits and two pan and zoom in every tool, and only the pen and
   * the mouse sculpt, select or drag the gizmo. 'sculpt': the older
   * behaviour, for sculpting without a pen - a finger on the model strokes.
   */
  fingers: 'navigate' | 'sculpt';
}

const DEFAULTS: SettingsValues = { fingers: 'navigate' };

/** Each setting's accepted values; anything else in the store is ignored. */
const ALLOWED: { [K in keyof SettingsValues]: readonly SettingsValues[K][] } = {
  fingers: ['navigate', 'sculpt'],
};

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
    if (!ALLOWED[key].includes(value) || this.values[key] === value) return;
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
        if ((ALLOWED[key] as readonly unknown[]).includes(v)) {
          (this.values as unknown as Record<string, unknown>)[key] = v;
        }
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
