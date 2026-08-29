import type { InputShell } from '../bridge/InputShell';

/**
 * Minimal Procreate-style side sliders (WS2h review request): two thin
 * vertical tracks on the left edge - brush size on top (log-mapped over
 * 5..500 px so small brushes get room), strength below (linear 0..1) -
 * each just a track and a nub. Values stay live in both directions:
 * dragging updates the tool (with the centered preview ring), and every
 * other route (digits, b/s drags, wheel keys, tool switches) moves the
 * nubs through InputShell.onBrushChange.
 */

const R_MIN = 5;
const R_MAX = 500;
const LOG_MIN = Math.log(R_MIN);
const LOG_SPAN = Math.log(R_MAX) - LOG_MIN;

export class BrushSliders {
  private readonly root: HTMLDivElement;
  private readonly nubs: { size: HTMLDivElement; strength: HTMLDivElement };

  constructor(private readonly input: InputShell) {
    this.root = document.createElement('div');
    this.root.className = 'sculpt-sliders';
    const size = this.buildSlider('size', 'Brush size');
    const strength = this.buildSlider('strength', 'Brush strength');
    this.nubs = { size: size.nub, strength: strength.nub };
    this.root.append(size.el, strength.el);
    document.body.appendChild(this.root);

    this.input.onBrushChange = () => this.refresh();
    this.refresh();
  }

  private buildSlider(
    kind: 'size' | 'strength',
    title: string,
  ): { el: HTMLDivElement; nub: HTMLDivElement } {
    const el = document.createElement('div');
    el.className = 'sculpt-slider';
    el.dataset.kind = kind;
    el.title = title;
    const track = document.createElement('div');
    track.className = 'sculpt-slider__track';
    const nub = document.createElement('div');
    nub.className = 'sculpt-slider__nub';
    el.append(track, nub);

    const apply = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
      if (kind === 'size') this.input.setBrushRadius(Math.exp(LOG_MIN + t * LOG_SPAN));
      else this.input.setBrushIntensity(t);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events carry no active pointer; capture is best-effort.
      }
      apply(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons !== 0) apply(e);
    });
    return { el, nub };
  }

  /** Nub positions from the live tool values (bottom = min, top = max). */
  private refresh(): void {
    const tSize = (Math.log(this.input.getBrushRadius()) - LOG_MIN) / LOG_SPAN;
    this.nubs.size.style.bottom = `${(Math.min(1, Math.max(0, tSize)) * 100).toFixed(1)}%`;
    this.nubs.strength.style.bottom = `${(this.input.getBrushIntensity() * 100).toFixed(1)}%`;
  }

  dispose(): void {
    this.input.onBrushChange = null;
    this.root.remove();
  }
}
