import type { Viewer } from '../viewer/Viewer';

/** Tiny FPS readout, toggled by the secret hotkey "t". Polls (no extra rAF). */
export class FpsMeter {
  private readonly el: HTMLDivElement;
  private readonly timer: number;

  constructor(private readonly viewer: Viewer) {
    this.el = document.createElement('div');
    this.el.className = 'fps-meter';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.timer = window.setInterval(() => this.render(), 250);
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
    this.render();
  }

  private render(): void {
    if (!this.el.hidden) this.el.textContent = `${Math.round(this.viewer.getFps())} fps`;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.el.remove();
  }
}
