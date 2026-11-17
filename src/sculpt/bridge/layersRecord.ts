import type { SavedLayers } from './layers';

/**
 * The sculpt layers' scene record (SavedMesh.layers), apart from layers.ts
 * so that whatever reads a record (sanitize.ts) does not bring the
 * vendored engine with it.
 */

/** The most layers an object may have. */
export const MAX_LAYERS = 32;
/** A layer's weight is a fraction, 1 being 100%; a typed value may be this many times it, either way. */
export const WEIGHT_LIMIT = 10;
/** Names longer than this are cut. */
export const MAX_LAYER_NAME = 60;
/** The record's version. */
export const LAYERS_V = 2;

/**
 * A record's layers as a scene brings them: version 1, at most MAX_LAYERS
 * layers with names, finite weights within WEIGHT_LIMIT, a visibility, and
 * the ids of the highest level's vertices they moved, each once and below
 * its count, with three finite numbers a vertex; an active index that is one of them or -1.
 * Throws saying what is wrong; returns a record of its own fields.
 */
export function sanitizeLayers(v: unknown, vertexCounts: number[]): SavedLayers {
  const bad = (why: string): never => {
    throw new Error(why);
  };
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('they are not a record');
  const r = v as Record<string, unknown>;
  if (r.v !== 1 && r.v !== LAYERS_V) bad('a version this app does not read');
  const items = r.items;
  if (!Array.isArray(items) || items.length > MAX_LAYERS) bad(`not 0 to ${MAX_LAYERS} layers`);
  const active = r.active;
  if (typeof active !== 'number' || !Number.isInteger(active) || active < -1 || active >= (items as unknown[]).length) {
    bad('an active layer that is not one');
  }
  const out = (items as unknown[]).map((it) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return bad('a layer that is not one');
    const l = it as Record<string, unknown>;
    if (typeof l.name !== 'string') bad('a name that is not one');
    const weight = l.weight;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || Math.abs(weight) > WEIGHT_LIMIT) bad('a weight that is not one');
    if (typeof l.visible !== 'boolean') bad('a visibility that is not one');
    const n = vertexCounts[vertexCounts.length - 1];
    const kind = (l.kind === undefined ? 'layer' : l.kind) as 'layer' | 'group';
    if (kind !== 'layer' && kind !== 'group') bad('a kind of layer that is not one');
    let parent = -1;
    if (l.parent !== undefined) {
      const q = l.parent;
      if (typeof q !== 'number' || !Number.isInteger(q) || q < -1 || q >= (items as unknown[]).length) bad('a group that is not one');
      parent = q as number;
      if (kind === 'group' && parent !== -1) bad('a group inside a group');
    }
    let mask: { maskVals: Uint8Array; maskLens: Uint32Array } | null = null;
    if (l.maskVals !== undefined || l.maskLens !== undefined) {
      const mv = l.maskVals;
      const ml = l.maskLens;
      if (!(mv instanceof Uint8Array) || !(ml instanceof Uint32Array) || mv.length !== ml.length) bad('a mask of the wrong kind');
      let total = 0;
      for (const x of ml as Uint32Array) total += x;
      if (total !== n) bad('a mask of the wrong size');
      mask = { maskVals: mv as Uint8Array, maskLens: ml as Uint32Array };
    }
    const ids = l.ids;
    const vals = l.vals;
    let keep: { ids: Uint32Array; vals: Float32Array } | null = null;
    if (ids !== undefined || vals !== undefined) {
      if (!(ids instanceof Uint32Array) || !(vals instanceof Float32Array) || vals.length !== ids.length * 3 || ids.length > n) {
        bad('data of the wrong kind or size');
      }
      const a = ids as Uint32Array;
      const b = vals as Float32Array;
      const hit = new Uint8Array(n);
      for (let i = 0; i < a.length; i++) {
        if (a[i] >= n || hit[a[i]]) bad('a vertex that is not one, or is there twice');
        hit[a[i]] = 1;
      }
      for (let i = 0; i < b.length; i++) if (!Number.isFinite(b[i])) bad('a displacement that is not a number');
      keep = { ids: a, vals: b };
    }
    return {
      name: (l.name as string).slice(0, MAX_LAYER_NAME) || 'Layer',
      weight: weight as number,
      visible: l.visible as boolean,
      kind,
      parent,
      ...(mask ? { ...mask, maskOn: l.maskOn !== false } : {}),
      open: l.open !== false,
      ...(keep ?? {}),
    };
  });
  return { v: 2, active: active as number, items: out };
}
