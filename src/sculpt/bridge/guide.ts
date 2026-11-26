import type { Vec3 } from './measure';

/**
 * The proportion guide (docs/plans/reference-and-measure.md, "Proportion
 * guide"): a vertical ruler standing beside the subject, in heads. This file
 * is its state and its arithmetic; the overlay that draws it is
 * ui/MeasureOverlay.ts, which draws the calipers on the same canvas, and the
 * switch, canon and head height are the Model panel's Measure section.
 *
 * The subject is the active object, or the mannequin (the page decides which,
 * `subject`). Nothing here touches a mesh or the sculpt history, and like the
 * calipers the guide is interface: it is never in a capture.
 */

export type CanonId = '7.5' | '8' | '8.5' | 'custom';

/** The canons, as decided on 2026-11-17: 7½ (natural), 8 (idealised) and 8½ (heroic) heads, and a count of one's own. */
export const CANONS: ReadonlyArray<{ id: CanonId; label: string; heads: number | null }> = [
  { id: '7.5', label: '7½ heads', heads: 7.5 },
  { id: '8', label: '8 heads', heads: 8 },
  { id: '8.5', label: '8½ heads', heads: 8.5 },
  { id: 'custom', label: 'Custom', heads: null },
];

/** The most heads a custom canon can have, and the least. */
export const HEADS_LIMITS = { min: 3, max: 12 } as const;
/** The head heights a figure can have, in centimetres. */
export const HEAD_LIMITS = { min: 0.5, max: 500 } as const;

/**
 * Where a landmark falls on a canon of `heads` heads, counted in heads from
 * the top of the head: the chin at one, the nipples at two, the navel at
 * three, the crotch at half the figure, the knees two heads above the floor.
 */
export const LANDMARKS: ReadonlyArray<{ id: string; label: string; at(heads: number): number }> = [
  { id: 'chin', label: 'Chin', at: () => 1 },
  { id: 'nipples', label: 'Nipples', at: () => 2 },
  { id: 'navel', label: 'Navel', at: () => 3 },
  { id: 'crotch', label: 'Crotch', at: (n) => n / 2 },
  { id: 'knees', label: 'Knees', at: (n) => n - 2 },
];

/** What a scene file keeps of the guide. */
export interface SavedGuide {
  on?: boolean;
  /** Head height in centimetres; absent when none is set. */
  head?: number;
  canon?: CanonId;
  /** The head count of the Custom canon. */
  heads?: number;
  landmarks?: boolean;
}

/** What the guide stands beside: a box in the world, and a cheap key that changes whenever the box may have. */
export interface GuideSubject {
  mannequin: boolean;
  key: string;
  box(): { min: Vec3; max: Vec3 };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A head count as the guide says it: "8", "7.5", never "8.0". */
export const headsText = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '–');

export class ProportionGuide {
  on = false;
  /** Head height in centimetres; 0 while none is set. */
  head = 0;
  canon: CanonId = '8';
  customHeads = 8;
  landmarks = false;
  /** The tick the person tapped (a landmark's id, or 'canon'): drawn orange, its label shown. */
  selected: string | null = null;
  /** Pick head under way: the crown's height once it has been tapped. */
  picking: { step: 'crown' } | { step: 'chin'; crown: number } | null = null;
  /** The panels and the overlay redraw on a change. */
  version = 0;
  onPersist: (() => void) | null = null;
  /** The page's answer to "what is the guide beside"; null: nothing. */
  subject: (() => GuideSubject | null) | null = null;
  /** Pick head began or ended (the page puts the Calipers tool in hand, or away). */
  onPickChange: ((on: boolean) => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private cache: { key: string; box: { min: Vec3; max: Vec3 } } | null = null;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed(persist: boolean): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
    if (persist) this.onPersist?.();
  }

  /** The subject's box, read again only when its key changed. */
  bounds(): { min: Vec3; max: Vec3; mannequin: boolean } | null {
    const s = this.subject?.() ?? null;
    if (!s) return null;
    if (!this.cache || this.cache.key !== s.key) this.cache = { key: s.key, box: s.box() };
    return { ...this.cache.box, mannequin: s.mannequin };
  }

  /** The subject's height in centimetres, or null with no subject. */
  height(): number | null {
    const b = this.bounds();
    return b ? Math.max(0, b.max[1] - b.min[1]) : null;
  }

  /** The head count the canon asks for. */
  canonHeads(): number {
    return CANONS.find((c) => c.id === this.canon)?.heads ?? this.customHeads;
  }

  setOn(on: boolean): void {
    if (this.on === on) return;
    this.on = on;
    if (!on) this.cancelPick();
    this.selected = null;
    this.changed(true);
  }

  setHead(cm: number): void {
    const v = Number.isFinite(cm) && cm > 0 ? clamp(Math.round(cm * 10) / 10, HEAD_LIMITS.min, HEAD_LIMITS.max) : 0;
    if (v === this.head) return;
    this.head = v;
    this.changed(true);
  }

  setCanon(id: CanonId): void {
    if (this.canon === id) return;
    this.canon = id;
    if (this.selected === 'canon') this.selected = null;
    this.changed(true);
  }

  setCustomHeads(n: number): void {
    if (!Number.isFinite(n)) return;
    const v = clamp(Math.round(n * 10) / 10, HEADS_LIMITS.min, HEADS_LIMITS.max);
    if (v === this.customHeads) return;
    this.customHeads = v;
    this.changed(true);
  }

  setLandmarks(on: boolean): void {
    if (this.landmarks === on) return;
    this.landmarks = on;
    if (!on && this.selected && this.selected !== 'canon') this.selected = null;
    this.changed(true);
  }

  /** A tick tapped: it takes the orange and its label; tapped again, it lets go. */
  select(id: string | null): void {
    const next = this.selected === id ? null : id;
    if (next === this.selected) return;
    this.selected = next;
    this.changed(false);
  }

  // --- Pick head: two taps on the model, the crown then the chin -----------

  beginPick(): void {
    this.picking = { step: 'crown' };
    this.changed(false);
    this.onPickChange?.(true);
  }

  cancelPick(): void {
    if (!this.picking) return;
    this.picking = null;
    this.changed(false);
    this.onPickChange?.(false);
  }

  /** A tap's world point: the crown first, then the chin; the head is the height between them. */
  pickPoint(world: Vec3): void {
    const p = this.picking;
    if (!p) return;
    if (p.step === 'crown') {
      this.picking = { step: 'chin', crown: world[1] };
      this.changed(false);
      return;
    }
    this.picking = null;
    this.setHead(Math.abs(p.crown - world[1]));
    this.changed(false);
    this.onPickChange?.(false);
  }

  // --- the drawing's numbers ------------------------------------------------

  /** Heights above the subject's bottom, in centimetres, of the numbered ticks: one head down from the top each time, the last at the floor or just above it. */
  tickHeights(): number[] {
    const h = this.height();
    if (h === null || !(this.head > 0)) return [];
    const out: number[] = [];
    // A box read in floats may come out a hair short of its eight heads: half a millimetre is the same tick.
    for (let i = 1; i * this.head <= h + 0.05 && i <= 40; i++) out.push(Math.max(0, h - i * this.head));
    return out;
  }

  /** How many heads tall the subject stands, or null with no head height or no subject. */
  headCount(): number | null {
    const h = this.height();
    return h !== null && this.head > 0 ? h / this.head : null;
  }

  /** Where the canon says the subject's top should be above its bottom, in centimetres (the faint target line); null with no head height. */
  targetHeight(): number | null {
    return this.head > 0 ? this.head * this.canonHeads() : null;
  }

  /** The landmarks of the canon with their heights above the subject's bottom, counted from its top. */
  landmarkHeights(): Array<{ id: string; label: string; cm: number }> {
    const h = this.height();
    if (h === null || !(this.head > 0)) return [];
    const n = this.canonHeads();
    return LANDMARKS.map((l) => ({ id: l.id, label: l.label, cm: h - l.at(n) * this.head }));
  }

  // --- the scene file ---------------------------------------------------------

  serialize(): SavedGuide | undefined {
    if (!this.on && !(this.head > 0) && this.canon === '8' && !this.landmarks) return undefined;
    return {
      ...(this.on ? { on: true } : {}),
      ...(this.head > 0 ? { head: this.head } : {}),
      ...(this.canon !== '8' ? { canon: this.canon } : {}),
      ...(this.canon === 'custom' || this.customHeads !== 8 ? { heads: this.customHeads } : {}),
      ...(this.landmarks ? { landmarks: true } : {}),
    };
  }

  restore(saved: SavedGuide | undefined): void {
    this.picking = null;
    this.selected = null;
    this.cache = null;
    this.on = saved?.on === true;
    this.head = typeof saved?.head === 'number' && saved.head > 0 ? clamp(saved.head, HEAD_LIMITS.min, HEAD_LIMITS.max) : 0;
    this.canon = CANONS.some((c) => c.id === saved?.canon) ? saved!.canon! : '8';
    this.customHeads = typeof saved?.heads === 'number' ? clamp(saved.heads, HEADS_LIMITS.min, HEADS_LIMITS.max) : 8;
    this.landmarks = saved?.landmarks === true;
    this.changed(false);
  }

  /** The whole scene is replaced (New): the guide is off and empty. */
  reset(): void {
    this.restore(undefined);
  }
}

/** Sanitise a saved guide from a file: only the known fields, in range. */
export function sanitizeGuide(v: unknown): SavedGuide | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number): number | undefined =>
    typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : undefined;
  const canon = CANONS.find((c) => c.id === r.canon)?.id;
  const out: SavedGuide = {
    ...(r.on === true ? { on: true } : {}),
    ...(num(r.head, HEAD_LIMITS.min, HEAD_LIMITS.max) !== undefined ? { head: r.head as number } : {}),
    ...(canon ? { canon } : {}),
    ...(num(r.heads, HEADS_LIMITS.min, HEADS_LIMITS.max) !== undefined ? { heads: r.heads as number } : {}),
    ...(r.landmarks === true ? { landmarks: true } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}
