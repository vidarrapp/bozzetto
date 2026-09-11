import type { ArmatureFile } from './persist';

/**
 * The .armature file: the autosave record as JSON, nothing binary. A
 * figure is a preset name plus a few hundred numbers, and a text file is
 * one a person can read, diff and fix.
 */
export function packArmature(file: ArmatureFile): Blob {
  return new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
}

export function unpackArmature(text: string): ArmatureFile {
  let rec: unknown;
  try {
    rec = JSON.parse(text);
  } catch {
    throw new Error('Not an armature file');
  }
  const f = rec as Partial<ArmatureFile>;
  if (!f || f.kind !== 'bozzetto-armature' || !f.state || typeof f.state.preset !== 'string') {
    throw new Error('Not a Bozzetto armature file');
  }
  return {
    kind: 'bozzetto-armature',
    v: 1,
    name: typeof f.name === 'string' && f.name ? f.name : 'Armature',
    state: f.state,
    look: f.look,
    savedAt: typeof f.savedAt === 'number' ? f.savedAt : Date.now(),
  };
}

/** armature-20260911-1415.armature style stamp. */
export function armatureStamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `armature-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.armature`;
}
