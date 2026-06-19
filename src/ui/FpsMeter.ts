import type { Viewer } from '../viewer/Viewer';

/**
 * Debug overlay, toggled by the hotkey "t". Shows FPS plus live renderer
 * diagnostics (backend, size, material, AO/DoF, subject scale, clip range,
 * environment). Polls on a timer — no extra render loop.
 */
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
    if (this.el.hidden) return;
    this.el.replaceChildren(
      ...this.viewer.debugInfo().map(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'fps-meter__row';
        const k = document.createElement('span');
        k.className = 'fps-meter__key';
        k.textContent = label;
        const v = document.createElement('span');
        v.textContent = value;
        row.append(k, v);
        return row;
      }),
    );
  }

  dispose(): void {
    clearInterval(this.timer);
    this.el.remove();
  }
}
