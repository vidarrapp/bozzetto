import { GROUPS_V, GROUPS_V1, isGroupColor, MAX_GROUPS, MAX_NAME } from '../../../shared/bozz';

/**
 * The poly groups' scene record (SavedMesh.groups), apart from
 * polyGroups.ts so that whatever reads a record (sanitize.ts, the gallery)
 * does not bring the vendored engine with it.
 */

/**
 * An object's poly groups in a scene record (SavedMesh.groups, version 2):
 * one group a face of level 0. A version 1 record (2026-10-31, one a face
 * of the top level) is made a version 2 one as it is read
 * (sanitizeGroups).
 */
export interface SavedGroups {
  v: 2;
  /** One a face of level 0 (the base faces, in their order), each an index into `names`. */
  faces: Uint32Array;
  names: string[];
  /** One a group: 1 hidden. Absent when nothing is hidden. */
  hidden?: Uint8Array;
  /**
   * One a group: 0xRRGGBB (sRGB) picked for it, or GROUP_COLOR_DEFAULT
   * (0xFFFFFFFF) for its default hue (groupColor). Absent when every group
   * has its default.
   */
  colors?: Uint32Array;
}

/** The name a new group takes, when nothing else names it: "Group 1" for group 0. */
export const defaultGroupName = (i: number): string => `Group ${i + 1}`;

/**
 * A version 1 record's top-level faces as level 0's: level by level down,
 * each face takes the group most of its four children (4f..4f+3) have,
 * the earliest child winning a tie among the tied groups, `levels - 1`
 * times. Bozzetto Studio rounds the same way.
 */
export function topToBase(top: Uint32Array, nbBaseFaces: number, levels: number): Uint32Array {
  let cur = top;
  for (let k = levels - 1; k >= 1; k--) {
    const n = nbBaseFaces * 4 ** (k - 1);
    const out = new Uint32Array(n);
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      let best = cur[i];
      let bestN = 0;
      for (let c = 0; c < 4; c++) {
        const g = cur[i + c];
        let m = 0;
        for (let d = 0; d < 4; d++) if (cur[i + d] === g) m++;
        if (m > bestN) {
          bestN = m;
          best = g;
        }
      }
      out[p] = best;
    }
    cur = out;
  }
  return cur;
}

/**
 * A record's poly groups as a scene brings them (sanitize.ts): version 2
 * with one group a face of level 0 (`nbBaseFaces`), or version 1 with one
 * a face of the top level (`levels` levels, four faces a face a level up),
 * which is rounded down to level 0 (topToBase); every face naming a group
 * there is, one to MAX_GROUPS names that are strings (cut to MAX_NAME),
 * hidden flags, where there are any, one a group, and colours, where there
 * are any, one a group, each 0xRRGGBB or the default. Throws saying what
 * is wrong; returns a version 2 record of its own fields and no others.
 */
export function sanitizeGroups(v: unknown, nbBaseFaces: number, levels: number): SavedGroups {
  const bad = (why: string): never => {
    throw new Error(why);
  };
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('they are not a record');
  const r = v as Record<string, unknown>;
  if (r.v !== GROUPS_V && r.v !== GROUPS_V1) bad('a version this app does not read');
  const names = r.names;
  if (!Array.isArray(names) || names.length < 1 || names.length > MAX_GROUPS) bad(`not 1 to ${MAX_GROUPS} names`);
  const ns = names as unknown[];
  if (!ns.every((n) => typeof n === 'string')) bad('a name that is not one');
  const faces = r.faces;
  const v1 = r.v === GROUPS_V1;
  const want = v1 ? nbBaseFaces * 4 ** (levels - 1) : nbBaseFaces;
  if (!(faces instanceof Uint32Array) || faces.length !== want) bad(v1 ? 'not one group a face of the top level' : 'not one group a face of level 0');
  const f = faces as Uint32Array;
  for (let i = 0; i < f.length; i++) if (f[i] >= ns.length) bad('a face in a group there is not');
  const hidden = r.hidden;
  if (hidden !== undefined && (!(hidden instanceof Uint8Array) || hidden.length !== ns.length)) bad('hidden flags that are not one a group');
  const colors = r.colors;
  if (colors !== undefined && (!(colors instanceof Uint32Array) || colors.length !== ns.length)) bad('colours that are not one a group');
  if (colors instanceof Uint32Array && !colors.every(isGroupColor)) bad('a colour that is not one');
  return {
    v: 2,
    faces: v1 ? topToBase(f, nbBaseFaces, levels) : f,
    names: (ns as string[]).map((n) => n.slice(0, MAX_NAME)),
    ...(hidden instanceof Uint8Array ? { hidden: Uint8Array.from(hidden, (h) => (h ? 1 : 0)) } : {}),
    ...(colors instanceof Uint32Array ? { colors: Uint32Array.from(colors) } : {}),
  };
}

/** A group name as one OBJ `g` line takes it: no line breaks, never empty. */
export function objName(name: string): string {
  const one = name.replace(/[\r\n]+/g, ' ').trim();
  return one || 'default';
}
