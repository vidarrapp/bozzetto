export type AspectId = '9:16' | '4:5' | '1:1' | '16:9';

const ASPECTS: Record<AspectId, number> = {
  '9:16': 9 / 16,
  '4:5': 4 / 5,
  '1:1': 1,
  '16:9': 16 / 9,
};

/** Width-over-height ratio for an aspect id. */
export function aspectRatio(id: AspectId): number {
  return ASPECTS[id];
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Crop-guide overlay: a centred frame of the chosen aspect ratio with the area
 * outside it dimmed, plus rule-of-thirds lines. Used to frame the subject for
 * video / thumbnail capture (the capture crops to exactly this rectangle).
 */
export class CaptureGuide {
  private readonly root: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private aspect: AspectId | null = null;

  constructor(private readonly container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'capture-guide';
    this.root.hidden = true;

    this.frame = document.createElement('div');
    this.frame.className = 'capture-guide__frame';
    const grid = document.createElement('div');
    grid.className = 'capture-guide__grid';
    this.frame.appendChild(grid);
    this.root.appendChild(this.frame);
    container.appendChild(this.root);

    window.addEventListener('resize', this.onResize);
  }

  setAspect(aspect: AspectId | null): void {
    this.aspect = aspect;
    this.root.hidden = aspect === null;
    if (aspect) this.layout();
  }

  getAspect(): AspectId | null {
    return this.aspect;
  }

  /** Centred crop rectangle of the current aspect within a `w`×`h` box, or null. */
  rectFor(w: number, h: number): CropRect | null {
    if (!this.aspect) return null;
    const a = ASPECTS[this.aspect];
    let cw: number;
    let ch: number;
    if (a <= w / h) {
      ch = h;
      cw = h * a;
    } else {
      cw = w;
      ch = w / a;
    }
    return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
  }

  /** Centred crop rectangle (container CSS pixels) for the current aspect. */
  rect(): CropRect | null {
    return this.rectFor(this.container.clientWidth, this.container.clientHeight);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }

  private layout(): void {
    const r = this.rect();
    if (!r) return;
    this.frame.style.width = `${r.w}px`;
    this.frame.style.height = `${r.h}px`;
  }

  private readonly onResize = (): void => {
    if (this.aspect) this.layout();
  };
}
