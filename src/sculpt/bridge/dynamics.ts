import Enums from '@sculpt-vendor/misc/Enums';
import Tablet from '@sculpt-vendor/misc/Tablet';

/**
 * Per-brush pressure dynamics: how much pen pressure drives SIZE and
 * STRENGTH for each brush, each channel with its own response curve.
 * Implemented by patching the vendored Tablet getters on install (no
 * vendor edits): the tools keep calling getPressureRadius /
 * getPressureIntensity, and the patched getters consult the active brush's
 * config and curve the raw pressure per channel.
 *
 * Each channel is an AMOUNT, 0 to 1, not a switch (owner call): the
 * bottom of the slider is off, the top is the full range, and anything
 * between scales how far pressure can move the brush from its slider
 * value. A light touch on a half-amount strength brush still paints at
 * half strength rather than nothing.
 */

export type CurveId = 'linear' | 'soft' | 'firm';

export interface BrushDynamics {
  /** How much pressure drives the size: 0 is a constant brush, 1 the full range. */
  size: number;
  /** How much pressure drives the strength: 0 constant, 1 the full range. */
  strength: number;
  sizeCurve: CurveId;
  strengthCurve: CurveId;
}

export const CURVE_OPTIONS = [
  ['linear', 'Linear'],
  ['soft', 'Soft (light touch)'],
  ['firm', 'Firm (press hard)'],
] as const;

const CURVES: Record<CurveId, (p: number) => number> = {
  linear: (p) => p,
  soft: (p) => Math.pow(p, 0.6),
  firm: (p) => Math.pow(p, 1.8),
};

/**
 * Where each brush starts (owner-tuned). Size is constant and strength
 * follows pressure for most brushes; the crease and the paint brush want
 * both, and Drag has no strength to drive at all.
 */
const DEFAULTS: Record<number, { size: number; strength: number }> = {
  [Enums.Tools.CREASE]: { size: 1, strength: 1 },
  [Enums.Tools.PAINT]: { size: 1, strength: 1 },
  [Enums.Tools.DRAG]: { size: 0, strength: 0 },
};

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

export class DynamicsStore {
  private readonly map = new Map<number, BrushDynamics>();
  private restore: (() => void) | null = null;

  constructor(private readonly currentTool: () => number) {}

  get(tool: number): BrushDynamics {
    let d = this.map.get(tool);
    if (!d) {
      const base = DEFAULTS[tool] ?? { size: 0, strength: 1 };
      d = { size: base.size, strength: base.strength, sizeCurve: 'linear', strengthCurve: 'linear' };
      this.map.set(tool, d);
    }
    return d;
  }

  /** The per-tool table, for persistence. Only tools that were touched. */
  serialize(): Record<number, BrushDynamics> {
    const out: Record<number, BrushDynamics> = {};
    for (const [tool, d] of this.map) out[tool] = { ...d };
    return out;
  }

  load(table: Record<number, Partial<BrushDynamics> & LegacyDynamics> | undefined): void {
    if (!table) return;
    for (const [tool, d] of Object.entries(table)) {
      const base = this.get(Number(tool));
      // Scenes from before the amounts carry on/off switches: on is the
      // full range, off is none, which is what the switches meant.
      const size = 'size' in d ? clamp01(d.size, base.size) : d.sizeOn === undefined ? base.size : d.sizeOn ? 1 : 0;
      const strength =
        'strength' in d
          ? clamp01(d.strength, base.strength)
          : d.strengthOn === undefined
            ? base.strength
            : d.strengthOn
              ? 1
              : 0;
      // An unknown curve id (a hand-edited or foreign save) would make the
      // pressure getter throw inside every stroke; fall back per field.
      const sizeCurve = d.sizeCurve && d.sizeCurve in CURVES ? d.sizeCurve : base.sizeCurve;
      const strengthCurve =
        d.strengthCurve && d.strengthCurve in CURVES ? d.strengthCurve : base.strengthCurve;
      this.map.set(Number(tool), { size, strength, sizeCurve, strengthCurve });
    }
  }

  install(): void {
    const origIntensity = Tablet.getPressureIntensity;
    const origRadius = Tablet.getPressureRadius;
    // The upstream formula at full amount is 2p: neutral pressure (0.5)
    // is factor 1, a hard press doubles, a feather halves. The amount
    // scales that swing toward 1, so 0 is a constant brush.
    const swing = (curve: CurveId, amount: number): number => {
      if (amount <= 0) return 1;
      const p = CURVES[curve](Math.min(1, Math.max(0, Tablet.pressure)));
      return 1 + amount * (p * 2 - 1);
    };
    Tablet.getPressureIntensity = () => {
      const d = this.get(this.currentTool());
      return swing(d.strengthCurve, d.strength);
    };
    Tablet.getPressureRadius = () => {
      const d = this.get(this.currentTool());
      return swing(d.sizeCurve, d.size);
    };
    this.restore = () => {
      Tablet.getPressureIntensity = origIntensity;
      Tablet.getPressureRadius = origRadius;
    };
  }

  dispose(): void {
    this.restore?.();
    this.restore = null;
  }
}

/** The pre-amount record shape, still read from older scenes. */
interface LegacyDynamics {
  sizeOn?: boolean;
  strengthOn?: boolean;
}
