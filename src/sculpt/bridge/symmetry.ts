/**
 * Per-brush mirror sculpting (owner call): each brush remembers whether it
 * mirrors and across which axis, so the crease you use for the centre line
 * can stay one-sided while the clay stays mirrored. Every brush starts on,
 * across X. The Select tool and the gizmo have no symmetry of their own
 * today; a mirrored selection is a possibility for later.
 */

export type SymmetryAxis = 'x' | 'y' | 'z';

export interface BrushSymmetry {
  on: boolean;
  axis: SymmetryAxis;
}

const AXES: SymmetryAxis[] = ['x', 'y', 'z'];

export class SymmetryStore {
  private readonly map = new Map<number, BrushSymmetry>();
  /** What an untouched brush starts with. Reseeded from legacy scenes. */
  private fallback: BrushSymmetry = { on: true, axis: 'x' };

  get(tool: number): BrushSymmetry {
    let s = this.map.get(tool);
    if (!s) {
      s = { ...this.fallback };
      this.map.set(tool, s);
    }
    return s;
  }

  /** Every brush that has a setting, for persistence. */
  serialize(): Record<number, BrushSymmetry> {
    const out: Record<number, BrushSymmetry> = {};
    for (const [tool, s] of this.map) out[tool] = { ...s };
    return out;
  }

  /**
   * Restore a saved table. Without one (a scene from before symmetry went
   * per-brush) the legacy scene-wide flag and axis become what every brush
   * starts from, so the scene comes back sculpting the way it was left.
   */
  load(table: Record<number, Partial<BrushSymmetry>> | undefined, legacy?: BrushSymmetry): void {
    this.map.clear();
    this.fallback = legacy ? { ...legacy } : { on: true, axis: 'x' };
    if (!table) return;
    for (const [key, s] of Object.entries(table)) {
      const tool = Number(key);
      if (!Number.isInteger(tool) || !s) continue;
      this.map.set(tool, {
        on: typeof s.on === 'boolean' ? s.on : this.fallback.on,
        axis: AXES.includes(s.axis as SymmetryAxis) ? (s.axis as SymmetryAxis) : this.fallback.axis,
      });
    }
  }
}
