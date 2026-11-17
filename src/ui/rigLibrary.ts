import { deviceStore } from './deviceStorage';
import { isHexColor } from '../viewer/color';
import type { LightId, RigLight, RigValues } from '../viewer/Lighting';

/**
 * The rig library: lights kept under a name, on this device (deviceStore, so
 * they follow the storage choice), and passed on as small `.bozzrig` files.
 *
 * A rig is the lights and the ambient and nothing else. The file lists its
 * lights, each with a type, so more lights and other kinds can come later;
 * today there are the key, the fill and the rim, all directional. Everything
 * read from a file is checked, each number held to the Lighting tab's slider
 * limits; a file that is not a rig, or has a value that is no number or no
 * colour, is refused with a plain sentence, never half applied.
 */

export interface SavedRig {
  id: string;
  name: string;
  rig: RigValues;
}

/** The limits of the Lighting tab's sliders, which a typed or imported value is held to. */
export const RIG_LIMITS = {
  intensity: [0, 5],
  azimuth: [-180, 180],
  elevation: [-20, 90],
  softness: [0, 16],
  ambient: [0, 2],
} as const;

export const RIG_EXT = '.bozzrig';
const FORMAT = 'bozzrig';
const VERSION = 1;
const KEY = 'bz.rigs';
const MAX_RIGS = 100;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_NAME = 60;
const IDS: LightId[] = ['key', 'fill', 'rim'];

const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v));

/** The name as kept: one line, trimmed, not too long. */
export function cleanRigName(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One light from a file: every field present and what it says it is, or why not. */
function readLight(raw: unknown): Parsed<RigLight | null> {
  if (!raw || typeof raw !== 'object') return bad('A light in this file is not a light.');
  const o = raw as Record<string, unknown>;
  // A kind this version does not know is left out, not an error: a later rig may carry more.
  if (o.type !== 'directional') return { ok: true, value: null };
  if (typeof o.id !== 'string' || !IDS.includes(o.id as LightId)) return bad('A light in this file has a name this version does not know.');
  if (typeof o.enabled !== 'boolean' || typeof o.castShadow !== 'boolean') return bad('A light in this file has a switch that is not on or off.');
  if (!num(o.intensity) || !num(o.azimuth) || !num(o.elevation) || !num(o.softness)) return bad('A light in this file has a value that is not a number.');
  if (!isHexColor(o.color)) return bad('A light in this file has a colour that is not a colour.');
  return {
    ok: true,
    value: {
      type: 'directional',
      id: o.id as LightId,
      enabled: o.enabled,
      intensity: clamp(o.intensity, RIG_LIMITS.intensity),
      color: o.color.toLowerCase(),
      azimuth: clamp(o.azimuth, RIG_LIMITS.azimuth),
      elevation: clamp(o.elevation, RIG_LIMITS.elevation),
      castShadow: o.castShadow,
      softness: clamp(o.softness, RIG_LIMITS.softness),
    },
  };
}

const NO_LIGHT = (id: LightId): RigLight => ({
  type: 'directional',
  id,
  enabled: false,
  intensity: 1,
  color: '#ffffff',
  azimuth: id === 'key' ? 35 : id === 'fill' ? -55 : 160,
  elevation: id === 'key' ? 38 : id === 'fill' ? 12 : 50,
  castShadow: false,
  softness: 5,
});

/** The lights and the ambient out of parsed JSON (a file's, or what the store holds). */
export function readRig(raw: unknown): Parsed<RigValues> {
  if (!raw || typeof raw !== 'object') return bad('This file is not a rig.');
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.lights) || o.lights.length === 0 || o.lights.length > 32) return bad('This rig has no lights.');
  const found = new Map<LightId, RigLight>();
  for (const item of o.lights) {
    const light = readLight(item);
    if (!light.ok) return light;
    if (!light.value) continue;
    if (found.has(light.value.id)) return bad('This rig names a light twice.');
    found.set(light.value.id, light.value);
  }
  if (found.size === 0) return bad('This rig has no lights this version can use.');
  let ambient = { intensity: 0.35, sky: '#c4d4ff', ground: '#4a3b2f' };
  if (o.ambient !== undefined) {
    const a = o.ambient as Record<string, unknown> | null;
    if (!a || typeof a !== 'object' || !num(a.intensity) || !isHexColor(a.sky) || !isHexColor(a.ground)) {
      return bad('The ambient light in this rig is not valid.');
    }
    ambient = { intensity: clamp(a.intensity, RIG_LIMITS.ambient), sky: a.sky.toLowerCase(), ground: a.ground.toLowerCase() };
  }
  // A light the rig does not name is off, so a rig with a key alone is a key alone.
  return { ok: true, value: { lights: IDS.map((id) => found.get(id) ?? NO_LIGHT(id)), ambient } };
}

/** The text of a `.bozzrig` file. */
export function rigFileText(name: string, rig: RigValues): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, name: cleanRigName(name), lights: rig.lights, ambient: rig.ambient }, null, 2);
}

/** A file name for a rig: the name, kept to letters, digits and dashes. */
export function rigFileName(name: string): string {
  const base = cleanRigName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'rig'}${RIG_EXT}`;
}

/** Read a `.bozzrig` file's text: the rig and its name, or a plain sentence on what is wrong. */
export function parseRigFile(text: string, fallbackName = 'Imported rig'): Parsed<{ name: string; rig: RigValues }> {
  if (text.length > MAX_FILE_BYTES) return bad('This file is too big to be a rig.');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return bad('This file is not a rig. It cannot be read.');
  }
  if (!json || typeof json !== 'object' || (json as Record<string, unknown>).format !== FORMAT) return bad('This file is not a Bozzetto rig.');
  const version = (json as Record<string, unknown>).version;
  if (!num(version) || version < 1 || version > VERSION) return bad('This rig was made by a newer version of Bozzetto.');
  const rig = readRig(json);
  if (!rig.ok) return rig;
  const named = (json as Record<string, unknown>).name;
  const name = cleanRigName(typeof named === 'string' ? named : '') || cleanRigName(fallbackName) || 'Imported rig';
  return { ok: true, value: { name, rig: rig.value } };
}

// --- the list on this device -------------------------------------------------

/** Tells the Lighting tabs that My rigs changed (another tab's list, or this one's). */
export const RIGS_CHANGED_EVENT = 'bozzetto:rigs-changed';

/** My rigs, in the order they were made. A store that cannot be read or holds rubbish is an empty list. */
export function myRigs(): SavedRig[] {
  let list: unknown = [];
  try {
    list = JSON.parse(deviceStore.get(KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: SavedRig[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const rig = readRig(o.rig);
    const name = typeof o.name === 'string' ? cleanRigName(o.name) : '';
    if (!rig.ok || !name || typeof o.id !== 'string') continue;
    out.push({ id: o.id, name, rig: rig.value });
  }
  return out.slice(0, MAX_RIGS);
}

/** Write the list; false when this device is not keeping things (the choice) or the store refuses. */
function writeRigs(list: SavedRig[]): boolean {
  try {
    deviceStore.set(KEY, JSON.stringify(list));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(RIGS_CHANGED_EVENT));
  return true;
}

const freshId = (): string => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** The rig with this name (case aside), if there is one. */
export function rigNamed(name: string): SavedRig | undefined {
  const n = cleanRigName(name).toLowerCase();
  return myRigs().find((r) => r.name.toLowerCase() === n);
}

/** Keep a rig under a name, replacing the one of that name. Null when it could not be kept. */
export function saveRig(name: string, rig: RigValues): SavedRig | null {
  const clean = cleanRigName(name);
  if (!clean) return null;
  const list = myRigs();
  const same = list.find((r) => r.name.toLowerCase() === clean.toLowerCase());
  const entry: SavedRig = { id: same?.id ?? freshId(), name: clean, rig };
  const next = same ? list.map((r) => (r === same ? entry : r)) : [...list, entry];
  if (next.length > MAX_RIGS) return null;
  return writeRigs(next) ? entry : null;
}

export function renameRig(id: string, name: string): boolean {
  const clean = cleanRigName(name);
  if (!clean) return false;
  const list = myRigs();
  if (!list.some((r) => r.id === id)) return false;
  return writeRigs(list.map((r) => (r.id === id ? { ...r, name: clean } : r)));
}

export function deleteRig(id: string): boolean {
  const list = myRigs();
  return writeRigs(list.filter((r) => r.id !== id));
}
