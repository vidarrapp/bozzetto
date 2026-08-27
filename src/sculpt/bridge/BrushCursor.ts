/**
 * Screen-space brush cursor (plan 7.6): a dot at the pointer, a circle at the
 * tool's screen radius, and a vertical line rising from the dot whose length
 * shows brush strength (Mudbox-style; proportional to the standard brush's
 * surface displacement, drawn at 10x so it reads). A DOM/SVG overlay outside
 * the 3D pipeline, so GTAO and DoF can never touch it.
 *
 * While the user holds b/s to adjust size/strength the cursor is anchored:
 * position freezes at the spot where the adjust began and the circle/line
 * update in place.
 */
export class BrushCursor {
  private readonly root: SVGSVGElement;
  private readonly circle: SVGCircleElement;
  private readonly dot: SVGCircleElement;
  private readonly line: SVGLineElement;
  private anchored = false;
  private x = 0;
  private y = 0;

  constructor(container: HTMLElement) {
    const NS = 'http://www.w3.org/2000/svg';
    this.root = document.createElementNS(NS, 'svg');
    this.root.setAttribute('class', 'sculpt-cursor');
    this.circle = document.createElementNS(NS, 'circle');
    this.circle.setAttribute('class', 'sculpt-cursor__ring');
    this.dot = document.createElementNS(NS, 'circle');
    this.dot.setAttribute('class', 'sculpt-cursor__dot');
    this.dot.setAttribute('r', '2');
    this.line = document.createElementNS(NS, 'line');
    this.line.setAttribute('class', 'sculpt-cursor__strength');
    this.root.append(this.circle, this.dot, this.line);
    this.root.style.display = 'none';
    container.appendChild(this.root);
  }

  /** Track the pointer (CSS px, container-relative), unless anchored. */
  moveTo(x: number, y: number): void {
    if (this.anchored) return;
    this.x = x;
    this.y = y;
    this.layout();
  }

  /** Freeze (b/s adjust) or release the cursor position. */
  setAnchored(anchored: boolean): void {
    this.anchored = anchored;
  }

  /** Update the ring to the tool's radius (CSS px) and strength (0..1). */
  setBrush(radius: number, intensity: number): void {
    const r = Math.max(2, radius);
    this.circle.setAttribute('r', String(r));
    this.line.setAttribute('y2', String(-r * Math.min(1, Math.max(0, intensity))));
    this.layout();
  }

  show(): void {
    this.root.style.display = '';
  }

  hide(): void {
    if (this.anchored) return;
    this.root.style.display = 'none';
  }

  private layout(): void {
    this.root.style.transform = `translate(${this.x}px, ${this.y}px)`;
  }

  dispose(): void {
    this.root.remove();
  }
}
