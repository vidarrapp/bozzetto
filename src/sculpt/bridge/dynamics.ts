import Tablet from '@sculpt-vendor/misc/Tablet';

/**
 * Per-brush pressure dynamics (WS4, review request): whether pen pressure
 * drives SIZE and STRENGTH for each brush, each channel with its own
 * response curve. Implemented by patching the vendored Tablet getters on
 * install (no vendor edits): the tools keep calling getPressureRadius /
 * getPressureIntensity, and the patched getters consult the active brush's
 * config and curve the raw pressure per channel.
 *
 * Defaults match the WS2f review decision: size constant, strength fully
 * dynamic, linear response. Session-scoped for now; persistence of these
 * prefs can ride the WS5 settings pass.
 */

export type CurveId = 'linear' | 'soft' | 'firm';

export interface BrushDynamics {
  sizeOn: boolean;
  strengthOn: boolean;
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

export class DynamicsStore {
  private readonly map = new Map<number, BrushDynamics>();
  private restore: (() => void) | null = null;

  constructor(private readonly currentTool: () => number) {}

  get(tool: number): BrushDynamics {
    let d = this.map.get(tool);
    if (!d) {
      d = { sizeOn: false, strengthOn: true, sizeCurve: 'linear', strengthCurve: 'linear' };
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

  load(table: Record<number, BrushDynamics> | undefined): void {
    if (!table) return;
    for (const [tool, d] of Object.entries(table)) {
      const base = this.get(Number(tool));
      // An unknown curve id (a hand-edited or foreign save) would make the
      // pressure getter throw inside every stroke; fall back per field.
      const merged = { ...base, ...d };
      if (!(merged.sizeCurve in CURVES)) merged.sizeCurve = base.sizeCurve;
      if (!(merged.strengthCurve in CURVES)) merged.strengthCurve = base.strengthCurve;
      this.map.set(Number(tool), merged);
    }
  }

  install(): void {
    const origIntensity = Tablet.getPressureIntensity;
    const origRadius = Tablet.getPressureRadius;
    Tablet.getPressureIntensity = () => {
      const d = this.get(this.currentTool());
      if (!d.strengthOn) return 1;
      const p = CURVES[d.strengthCurve](Math.min(1, Math.max(0, Tablet.pressure)));
      return 1 + (p * 2 - 1); // the upstream formula at full factor
    };
    Tablet.getPressureRadius = () => {
      const d = this.get(this.currentTool());
      if (!d.sizeOn) return 1;
      const p = CURVES[d.sizeCurve](Math.min(1, Math.max(0, Tablet.pressure)));
      return 1 + (p * 2 - 1);
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
