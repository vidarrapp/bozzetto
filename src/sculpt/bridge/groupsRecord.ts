import { GROUPS_V, MAX_GROUPS, MAX_NAME } from '../../../shared/bozz';

/**
 * The poly groups' scene record (SavedMesh.groups), apart from
 * polyGroups.ts so that whatever reads a record (sanitize.ts, the gallery)
 * does not bring the vendored engine with it.
 */

/** An object's poly groups in a scene record (SavedMesh.groups, version 1). */
export interface SavedGroups {
  v: 1;
  /** One a face of the top level, each an index into `names`. */
  faces: Uint32Array;
  names: string[];
  /** One a group: 1 hidden. Absent when nothing is hidden. */
  hidden?: Uint8Array;
}

/** The name a new group takes, when nothing else names it: "Group 1" for group 0. */
export const defaultGroupName = (i: number): string => `Group ${i + 1}`;

/**
 * A record's poly groups as a scene brings them (sanitize.ts): version 1,
 * one group a face of the top level (`topFaces`), every one naming a
 * group there is, one to MAX_GROUPS names that are strings (cut to
 * MAX_NAME), and hidden flags, where there are any, one a group. Throws
 * saying what is wrong; returns the record's own fields and no others.
 */
export function sanitizeGroups(v: unknown, topFaces: number): SavedGroups {
  const bad = (why: string): never => {
    throw new Error(why);
  };
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('they are not a record');
  const r = v as Record<string, unknown>;
  if (r.v !== GROUPS_V) bad('a version this app does not read');
  const names = r.names;
  if (!Array.isArray(names) || names.length < 1 || names.length > MAX_GROUPS) bad(`not 1 to ${MAX_GROUPS} names`);
  const ns = names as unknown[];
  if (!ns.every((n) => typeof n === 'string')) bad('a name that is not one');
  const faces = r.faces;
  if (!(faces instanceof Uint32Array) || faces.length !== topFaces) bad('not one group a face of the top level');
  const f = faces as Uint32Array;
  for (let i = 0; i < f.length; i++) if (f[i] >= ns.length) bad('a face in a group there is not');
  const hidden = r.hidden;
  if (hidden !== undefined && (!(hidden instanceof Uint8Array) || hidden.length !== ns.length)) bad('hidden flags that are not one a group');
  return {
    v: 1,
    faces: f,
    names: (ns as string[]).map((n) => n.slice(0, MAX_NAME)),
    ...(hidden instanceof Uint8Array ? { hidden: Uint8Array.from(hidden, (h) => (h ? 1 : 0)) } : {}),
  };
}


/** A group name as one OBJ `g` line takes it: no line breaks, never empty. */
export function objName(name: string): string {
  const one = name.replace(/[\r\n]+/g, ' ').trim();
  return one || 'default';
}
