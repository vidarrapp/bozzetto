import { withNamedStore } from '../sculpt/bridge/ScenePersist';
import type { LookState } from '../viewer/Viewer';
import type { ArmatureState } from './Armature';

/**
 * What an armature keeps between sessions: its state (preset, root, pose,
 * proportions), the look it was lit with, and a name. Small - a few
 * kilobytes of JSON - so the autosave writes it whole on every change, and
 * the same record is the .armature file's content.
 */
export interface ArmatureFile {
  kind: 'bozzetto-armature';
  v: 1;
  name: string;
  state: ArmatureState;
  look?: LookState;
  savedAt: number;
}

/**
 * The bridge into Sculpt mode: the posed figure baked to world-space
 * triangles, plus the voxel resolution to remesh it at. Sculpt mode takes
 * it on boot when the address carries ?handoff=1, and deletes it.
 */
export interface SculptHandoff {
  v: 1;
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  resolution: number;
  look?: LookState;
  savedAt: number;
}

// The same IndexedDB store the sculpt autosave uses, under keys of its own.
const STORE = 'scene';
const KEY = 'currentArmature';
const HANDOFF_KEY = 'sculptHandoff';

export async function saveArmature(file: ArmatureFile): Promise<void> {
  try {
    await withNamedStore(STORE, 'readwrite', (s) => s.put(file, KEY));
  } catch {
    // Private windows / blocked storage: the figure is simply not remembered.
  }
}

export async function loadArmature(): Promise<ArmatureFile | null> {
  try {
    const rec = (await withNamedStore(STORE, 'readonly', (s) => s.get(KEY))) as ArmatureFile | undefined;
    return rec && rec.kind === 'bozzetto-armature' && rec.state ? rec : null;
  } catch {
    return null;
  }
}

export async function hasArmature(): Promise<boolean> {
  try {
    return (await withNamedStore(STORE, 'readonly', (s) => s.count(KEY))) > 0;
  } catch {
    return false;
  }
}

export async function clearArmature(): Promise<void> {
  try {
    await withNamedStore(STORE, 'readwrite', (s) => s.delete(KEY));
  } catch {
    // Nothing to clear.
  }
}

export async function saveHandoff(h: SculptHandoff): Promise<void> {
  await withNamedStore(STORE, 'readwrite', (s) => s.put(h, HANDOFF_KEY));
}

/** Read the handoff and remove it, so a reload does not add the figure twice. */
export async function takeHandoff(): Promise<SculptHandoff | null> {
  try {
    const rec = (await withNamedStore(STORE, 'readonly', (s) => s.get(HANDOFF_KEY))) as SculptHandoff | undefined;
    if (!rec) return null;
    await withNamedStore(STORE, 'readwrite', (s) => s.delete(HANDOFF_KEY));
    return rec.positions instanceof Float32Array && rec.indices instanceof Uint32Array ? rec : null;
  } catch {
    return null;
  }
}
