import type { Viewer } from '../viewer/Viewer';
import { launchSummary } from './launch';
import { settings } from './settings';

/**
 * The frame meter: P, or Preferences > Diagnostics, where the choice is
 * kept, so a device that should show it keeps showing it across reloads.
 * Where each frame's time goes against the display's budget, which side
 * is short, and the renderer's own diagnostics (backend, size, AO, DoF,
 * subject scale, clip range, environment). Polls on a timer - no render
 * loop of its own - and times the GPU only while it is up, because reading
 * that back costs a little every frame (Viewer.setGpuTiming).
 */
export class FpsMeter {
  private readonly el: HTMLDivElement;
  private readonly timer: number;
  private readonly offSettings: () => void;

  constructor(private readonly viewer: Viewer) {
    this.el = document.createElement('div');
    this.el.className = 'fps-meter';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.timer = window.setInterval(() => this.render(), 250);
    this.offSettings = settings.onChange(() => this.apply());
    this.apply();
  }

  /** P: show or hide it, and remember which. */
  toggle(): void {
    settings.set('meter', this.el.hidden ? 'on' : 'off');
  }

  private apply(): void {
    const on = settings.get('meter') === 'on';
    if (on === !this.el.hidden) return;
    this.el.hidden = !on;
    this.viewer.setGpuTiming(on);
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
    this.offSettings();
    this.viewer.setGpuTiming(false);
    this.el.remove();
  }
}
