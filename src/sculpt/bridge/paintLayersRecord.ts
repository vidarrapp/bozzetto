import { isBlendId, type BlendId } from '../../paint/blend';

/**
 * The paint layers' scene record (SavedMesh.paintLayers), apart from the
 * model (paintLayers.ts) so that whatever reads a record (sanitize.ts) does
 * not bring the vendored engine with it. Sparse, with a version of its own:
 * a scene without it opens with no paint layers, and a build from before it
 * leaves the field behind (the levels' colours already are the composite).
 */

/** The most paint layers an object may have. */
export const MAX_PAINT_LAYERS = 32;
/** Names longer than this are cut. */
export const MAX_PAINT_NAME = 60;
/** The record's version. */
export const PAINT_LAYERS_V = 1;

/** A layer as a scene record keeps it. */
export interface SavedPaintLayer {
  name: string;
  mode: BlendId;
  /** 0 to 1. */
  opacity: number;
  visible: boolean;
  /** The highest-level vertices the layer has colour on (alpha above 0), each once. Absent for an empty layer. */
  ids?: Uint32Array;
  /** Four bytes a vertex of `ids`: the sRGB colour and the alpha. */
  rgba?: Uint8Array;
}

export interface SavedPaintLayers {
  v: 1;
  /** Index into `items` of the active layer, or -1 for Base. Oldest layer first. */
  active: number;
  /** What Base holds on most vertices: linear red, green, blue. */
  base: [number, number, number];
  /** The highest-level vertices whose Base is not that colour, and their linear colours (three a vertex). */
  baseIds?: Uint32Array;
  baseVals?: Float32Array;
  /** Oldest (bottom) first. */
  items: SavedPaintLayer[];
}

/**
 * A record's paint layers as a scene brings them: version 1, at most
 * MAX_PAINT_LAYERS layers with names, a mode of the list, an opacity within
 * 0..1, a visibility, vertex ids of the highest level each once and below
 * its count with four bytes each; a Base colour and sparse overrides of it,
 * all finite and in range; an active index that is one of them or -1.
 * Throws saying what is wrong; returns a record of its own fields.
 */
export function sanitizePaintLayers(v: unknown, vertexCounts: number[]): SavedPaintLayers {
  const bad = (why: string): never => {
    throw new Error(why);
  };
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('they are not a record');
  const r = v as Record<string, unknown>;
  if (r.v !== PAINT_LAYERS_V) bad('a version this app does not read');
  const n = vertexCounts[vertexCounts.length - 1];
  const items = r.items;
  if (!Array.isArray(items) || items.length > MAX_PAINT_LAYERS) bad(`not 0 to ${MAX_PAINT_LAYERS} layers`);
  const active = r.active;
  if (typeof active !== 'number' || !Number.isInteger(active) || active < -1 || active >= (items as unknown[]).length) {
    bad('an active layer that is not one');
  }
  const base = r.base;
  if (!Array.isArray(base) || base.length !== 3 || !base.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1)) {
    bad('a base colour that is not one');
  }
  const ids = (a: unknown, what: string): Uint32Array => {
    if (!(a instanceof Uint32Array) || a.length > n) bad(`${what} of the wrong kind or size`);
    const list = a as Uint32Array;
    const hit = new Uint8Array(n);
    for (let i = 0; i < list.length; i++) {
      if (list[i] >= n || hit[list[i]]) bad('a vertex that is not one, or is there twice');
      hit[list[i]] = 1;
    }
    return list;
  };
  let baseIds: Uint32Array | undefined;
  let baseVals: Float32Array | undefined;
  if (r.baseIds !== undefined || r.baseVals !== undefined) {
    baseIds = ids(r.baseIds, 'base vertices');
    const vals = r.baseVals;
    if (!(vals instanceof Float32Array) || vals.length !== baseIds.length * 3) bad('base colours of the wrong kind or size');
    for (const x of vals as Float32Array) if (!Number.isFinite(x) || x < 0 || x > 1) bad('a base colour that is not one');
    baseVals = vals as Float32Array;
  }
  const out = (items as unknown[]).map((it): SavedPaintLayer => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return bad('a layer that is not one');
    const l = it as Record<string, unknown>;
    if (typeof l.name !== 'string') bad('a name that is not one');
    if (!isBlendId(l.mode)) bad('a blend mode that is not one');
    const opacity = l.opacity;
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) bad('an opacity that is not one');
    if (typeof l.visible !== 'boolean') bad('a visibility that is not one');
    let keep: { ids: Uint32Array; rgba: Uint8Array } | null = null;
    if (l.ids !== undefined || l.rgba !== undefined) {
      const a = ids(l.ids, 'data');
      const c = l.rgba;
      if (!(c instanceof Uint8Array) || c.length !== a.length * 4) bad('data of the wrong kind or size');
      keep = { ids: a, rgba: c as Uint8Array };
    }
    return {
      name: (l.name as string).slice(0, MAX_PAINT_NAME) || 'Layer',
      mode: l.mode as BlendId,
      opacity: opacity as number,
      visible: l.visible as boolean,
      ...(keep ?? {}),
    };
  });
  const b = base as number[];
  const rec: SavedPaintLayers = { v: 1, active: active as number, base: [b[0], b[1], b[2]], items: out };
  if (baseIds && baseVals) {
    rec.baseIds = baseIds;
    rec.baseVals = baseVals;
  }
  return rec;
}
