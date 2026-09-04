import type { Viewer } from '../viewer/Viewer';
import { launchSummary } from './launch';

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
    // How the app was opened rides along with the renderer's own numbers:
    // installed-vs-site and cached-vs-network are the two things you cannot
    // tell by looking at the screen, and both change how it behaves.
    const rows: [string, string][] = [
      ...this.viewer.debugInfo(),
      ['launch', launchSummary()],
    ];
    this.el.replaceChildren(
      ...rows.map(([label, value]) => {
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
