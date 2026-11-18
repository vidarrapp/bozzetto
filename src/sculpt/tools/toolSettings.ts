/**
 * The scene's saved brush settings, by tool id.
 *
 * A scene has always kept its brush settings in tables keyed by the engine's
 * tool number (`radius`, `dynamics`, `spacing`, `curves`, `strength`,
 * `symmetry`, plus the Rake's and Smooth's own records). Those are still
 * written exactly as before, so an older installed build reads a newer
 * scene's settings. Beside them the scene now carries `tools`: one entry per
 * tool, keyed by its word id (`bz.clay`), holding that tool's size,
 * strength, spacing, pressure, curve, symmetry and its own knobs. Reading
 * prefers the new table and falls back, tool by tool and field by field, to
 * the numbered ones.
 *
 * The table is written in the units the numbered tables are written in now
 * (strength in centimetres where a tool has them, the curves as anchors, a
 * size in world units while world scale is on). `toolsRev` names that
 * reading; a later one is left alone.
 *
 * Four settings were shown but lost on reload before this table (Move's
 * Falloff, Crease's Pinch, Polish's Plane lock and Build-up). They have no
 * numbered table to ride, so they are saved in the new one only.
 */
import type { BrushDynamics } from '../bridge/dynamics';
import type { StoredCurve } from '../bridge/profile';
import type { BrushSymmetry } from '../bridge/symmetry';
import type { SavedRake, SavedSmooth, SculptSettings } from '../bridge/ScenePersist';
import { ENGINE_TOOLS, type SettingSpec, type ToolDef } from './registry';

/** The table's revision: 1 the first, in the units named above. */
export const TOOLS_REV = 1;

/** A live engine tool, as the settings reach its own fields. */
export type EngineTool = Record<string, unknown>;

/** One tool's entry in the scene's `tools` table. */
export interface SavedToolSettings {
  size?: number;
  strength?: number;
  spacing?: number;
  dynamics?: Partial<BrushDynamics>;
  curve?: StoredCurve | [number, number][];
  symmetry?: BrushSymmetry;
  /** The tool's own knobs, by the setting key the registry names. */
  own?: Record<string, number | boolean | string>;
}

export type SavedToolTable = Record<string, SavedToolSettings>;

// --- the tool's own knobs, on the live engine tool -------------------------------------

/** A knob's value on the engine tool. */
export function readOwn(tool: EngineTool, spec: SettingSpec): unknown {
  return spec.prop ? tool[spec.prop] : undefined;
}

/** Set a knob: by assigning its field, or through the tool's setter where it has one. */
export function writeOwn(tool: EngineTool, spec: SettingSpec, value: number | boolean | string): void {
  if (!spec.prop) return;
  const setter = spec.setter ? (tool[spec.setter] as ((s: Record<string, unknown>) => void) | undefined) : undefined;
  if (setter) setter.call(tool, { [spec.setKey ?? spec.key]: value });
  else tool[spec.prop] = value;
}

/** A value a file gave for a knob, as that knob can hold it, or undefined when it is not one. */
export function cleanOwn(spec: SettingSpec, v: unknown): number | boolean | string | undefined {
  if (spec.kind === 'toggle') return typeof v === 'boolean' ? v : undefined;
  if (spec.kind === 'select') return typeof v === 'string' && spec.options?.some(([o]) => o === v) ? v : undefined;
  if (spec.kind === 'presets') return typeof v === 'string' && v.length <= 32 ? v : undefined;
  if (spec.kind !== 'range' || typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const lo = spec.limits?.min ?? -Infinity;
  const hi = spec.limits?.max ?? Infinity;
  const clamped = Math.min(hi, Math.max(lo, v));
  return spec.limits?.integer ? Math.round(clamped) : clamped;
}

// --- writing the table -----------------------------------------------------------------

/** The numbered tables a scene keeps, as the table is made from them. */
export interface NumberedTables {
  radius?: Record<number, number>;
  dynamics?: Record<number, BrushDynamics>;
  spacing?: Record<number, number>;
  curves?: Record<number, StoredCurve | [number, number][]>;
  strength?: Record<number, number>;
  symmetry?: Record<number, BrushSymmetry>;
  smooth?: SavedSmooth;
}

/**
 * The `tools` table of a scene: for each tool the engine runs, what the
 * numbered tables hold for it, and its own knobs (`own` reads them off the
 * live tool). A tool with nothing to keep has no entry.
 */
export function buildToolTable(src: NumberedTables, own: (def: ToolDef) => Record<string, unknown>): SavedToolTable {
  const out: SavedToolTable = {};
  for (const def of ENGINE_TOOLS) {
    const n = def.engine as number;
    const e: SavedToolSettings = {};
    if (src.radius?.[n] !== undefined) e.size = src.radius[n];
    // Smooth's strength rides its own record in the numbered tables.
    const strength = def.id === 'bz.smooth' ? src.smooth?.strength : src.strength?.[n];
    if (strength !== undefined) e.strength = strength;
    if (src.spacing?.[n] !== undefined) e.spacing = src.spacing[n];
    if (src.dynamics?.[n]) e.dynamics = { ...src.dynamics[n] };
    if (src.curves?.[n]) e.curve = src.curves[n];
    if (src.symmetry?.[n]) e.symmetry = { ...src.symmetry[n] };
    const knobs: Record<string, number | boolean | string> = {};
    for (const [k, v] of Object.entries(own(def))) {
      if (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean' || typeof v === 'string') knobs[k] = v as number | boolean | string;
    }
    if (Object.keys(knobs).length) e.own = knobs;
    if (Object.keys(e).length) out[def.id] = e;
  }
  return out;
}

// --- reading it ------------------------------------------------------------------------

/** What the loaders are given: the scene's settings with the tool table laid over the numbered ones. */
export interface ToolSettingsRead {
  /** The tables the loaders that reset what they are not given take: the table's entries over the numbered ones. */
  radius?: Record<number, number>;
  dynamics?: Record<number, Partial<BrushDynamics>>;
  curves?: Record<number, StoredCurve | [number, number][]>;
  symmetry?: Record<number, BrushSymmetry>;
  /** The table's own strengths and spacings, in the current units, to lay over what the numbered tables set. */
  strength?: Record<number, number>;
  spacing?: Record<number, number>;
  /** The Rake's and Smooth's records: the numbered ones with the table's fields over them. */
  rake?: SavedRake;
  smooth?: SavedSmooth;
  /** Each tool's own knobs, by tool id. */
  own?: Record<string, Record<string, number | boolean | string>>;
}

function over<T>(base: Record<number, T> | undefined, extra: Record<number, T>): Record<number, T> | undefined {
  if (!Object.keys(extra).length) return base;
  return { ...base, ...extra };
}

/**
 * The settings as they are read: the numbered tables, with each tool's entry
 * in the `tools` table over them. A scene with no table (an older build's) or
 * one of a later revision than this build reads comes back as it is.
 */
export function readToolTable(settings: SculptSettings | undefined): ToolSettingsRead {
  const base: ToolSettingsRead = {
    radius: settings?.radius,
    dynamics: settings?.dynamics,
    curves: settings?.curves,
    symmetry: settings?.symmetry,
    rake: settings?.rake,
    smooth: settings?.smooth,
  };
  const table = settings?.tools;
  if (!table || (settings?.toolsRev ?? 0) > TOOLS_REV) return base;
  const radius: Record<number, number> = {};
  const dynamics: Record<number, Partial<BrushDynamics>> = {};
  const curves: Record<number, StoredCurve | [number, number][]> = {};
  const symmetry: Record<number, BrushSymmetry> = {};
  const strength: Record<number, number> = {};
  const spacing: Record<number, number> = {};
  const own: Record<string, Record<string, number | boolean | string>> = {};
  let rake = settings?.rake;
  let smooth = settings?.smooth;
  for (const def of ENGINE_TOOLS) {
    const e = table[def.id];
    if (!e) continue;
    const n = def.engine as number;
    if (e.size !== undefined) radius[n] = e.size;
    if (e.dynamics) dynamics[n] = e.dynamics;
    if (e.curve) curves[n] = e.curve;
    if (e.symmetry) symmetry[n] = e.symmetry;
    if (e.spacing !== undefined) spacing[n] = e.spacing;
    // Smooth's strength is part of its own record; the rest are numbered.
    if (e.strength !== undefined && def.id !== 'bz.smooth') strength[n] = e.strength;
    if (e.own) own[def.id] = e.own;
    if (def.id === 'bz.rake' && (e.own || e.strength !== undefined)) {
      rake = { ...rake, ...(e.own as SavedRake | undefined), ...(e.strength !== undefined ? { strength: e.strength } : {}) };
    }
    if (def.id === 'bz.smooth' && (e.own || e.strength !== undefined)) {
      smooth = { ...smooth, ...(e.own as SavedSmooth | undefined), ...(e.strength !== undefined ? { strength: e.strength } : {}) };
    }
  }
  return {
    radius: over(base.radius, radius),
    dynamics: over(base.dynamics, dynamics),
    curves: over(base.curves, curves),
    symmetry: over(base.symmetry, symmetry),
    strength: Object.keys(strength).length ? strength : undefined,
    spacing: Object.keys(spacing).length ? spacing : undefined,
    rake,
    smooth,
    own,
  };
}
