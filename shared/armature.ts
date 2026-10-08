/**
 * An armature project's file (docs/accounts.md §4): `armature.json` under
 * the project's prefix, the figure as Armature mode keeps it - which
 * figure, the pose, the pins and aims, the proportions, symmetry and the
 * look - as JSON, gzipped by the app on the way up. Shared by the client,
 * which writes and reads it, and the server, which checks it before R2
 * sees a byte (functions/_shared/content.ts), so the two cannot drift.
 *
 *   {
 *     "kind": "bozzetto-armature-project",
 *     "v": 1,
 *     "figure": "mannequin-male-realistic",
 *     "name": "Armature",
 *     "state": { root, pose, proportions, pins, aims, plant },
 *     "symmetry": false,
 *     "look": { ...the viewer's look },
 *     "savedAt": 1790000000000
 *   }
 *
 * `state` is Armature.serialize() less its `preset`, which is `figure`.
 * The .armature file a guest downloads is another thing: the autosave
 * record as text (src/armature/file.ts), kept as it was.
 */

/** The file's name under a project's prefix. */
export const ARMATURE_FILE = 'armature.json';

/** What the file says it is. */
export const ARMATURE_PROJECT_KIND = 'bozzetto-armature-project';

/** The most the file may be, stored or unpacked: a figure is a few kilobytes, a look a few more. */
export const ARMATURE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The figures a project may be struck on: the block figures and the
 * mannequins (src/armature/rig.ts RIG_PRESETS, figures.ts FIGURES). A model
 * loaded from a file is not one - its bytes are not in the project - and
 * stays on the device that loaded it.
 */
export const ARMATURE_FIGURES: readonly string[] = [
  'placeholder-male',
  'placeholder-female',
  'mannequin-male-realistic',
  'mannequin-female-realistic',
  'mannequin-male-stylized',
  'mannequin-female-stylized',
];

/** How deep the JSON may nest: the state is four levels, a look a few more. */
const MAX_DEPTH = 16;

/** Keys that mean something to an object besides being a key. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class ArmatureFileError extends Error {}

/**
 * The file's text, parsed and held to the format's frame: one JSON object,
 * no `__proto__` (nor `constructor`, `prototype`) anywhere in it, no deeper
 * than MAX_DEPTH, `v` 1 and a figure named by a string. Throws an
 * ArmatureFileError saying what is wrong; whether the figure is one there
 * is, and every field's own shape, are the caller's (the server refuses an
 * unknown figure; the app stands the default in).
 */
export function parseArmatureProject(text: string): Record<string, unknown> {
  let bad: string | null = null;
  let value: unknown;
  try {
    value = JSON.parse(text, (key, v: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) bad = key;
      return v;
    });
  } catch {
    throw new ArmatureFileError('This armature file is not JSON');
  }
  if (bad) throw new ArmatureFileError(`This armature file has a "${bad}" key`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArmatureFileError('This armature file is not a JSON object');
  }
  if (depthOf(value) > MAX_DEPTH) throw new ArmatureFileError(`This armature file nests deeper than ${MAX_DEPTH}`);
  const rec = value as Record<string, unknown>;
  if (rec.v !== 1) throw new ArmatureFileError('This armature file is not version 1');
  if (typeof rec.figure !== 'string' || !rec.figure) throw new ArmatureFileError('This armature file names no figure');
  return rec;
}

/** Whether a figure id is one a project may be struck on. */
export const knownArmatureFigure = (id: unknown): boolean =>
  typeof id === 'string' && ARMATURE_FIGURES.includes(id);

/** How deep a parsed value nests, walked without recursion. */
function depthOf(root: unknown): number {
  let deepest = 0;
  const stack: Array<[unknown, number]> = [[root, 1]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (!v || typeof v !== 'object') continue;
    if (d > deepest) deepest = d;
    if (d > MAX_DEPTH) return d;
    for (const child of Object.values(v as object)) stack.push([child, d + 1]);
  }
  return deepest;
}
