/**
 * Hotkey guide for the viewer: a dismissible top-left hint ("Press H …") that
 * fades after a few seconds, plus a left-side overlay listing every shortcut,
 * toggled by H (or by clicking it).
 */
const GUIDE_HTML = `
  <div class="help-guide__head">Hotkeys &amp; navigation <span class="help-guide__close">H to close</span></div>
  <div class="help-guide__group">
    <div class="help-guide__title">Playback</div>
    <div class="help-row"><kbd>Space</kbd><span>Play / pause</span></div>
    <div class="help-row"><kbd>←</kbd><kbd>A</kbd><span>Step back</span></div>
    <div class="help-row"><kbd>→</kbd><kbd>D</kbd><span>Step forward</span></div>
  </div>
  <div class="help-guide__group">
    <div class="help-guide__title">View</div>
    <div class="help-row"><span class="help-key">Drag</span><span>Orbit</span></div>
    <div class="help-row"><span class="help-key">Scroll</span><span>Zoom</span></div>
    <div class="help-row"><kbd>F</kbd><span>Focus / frame model</span></div>
    <div class="help-row"><kbd>B</kbd><span>Depth of field</span></div>
    <div class="help-row"><span class="help-key">Shift+click</span><span>Set focus point</span></div>
  </div>
  <div class="help-guide__group">
    <div class="help-guide__title">Material</div>
    <div class="help-row"><kbd>1</kbd><span>Lit (PBR)</span></div>
    <div class="help-row"><kbd>2</kbd>–<kbd>5</kbd><span>Matcaps</span></div>
    <div class="help-row"><kbd>S</kbd><span>Smooth / flat shading</span></div>
    <div class="help-row"><kbd>W</kbd><span>Wireframe overlay</span></div>
    <div class="help-row"><kbd>G</kbd><span>Ground shadow</span></div>
  </div>
  <div class="help-guide__group">
    <div class="help-guide__title">Interface</div>
    <div class="help-row"><kbd>Tab</kbd><span>Toggle panel</span></div>
    <div class="help-row"><kbd>H</kbd><span>This guide</span></div>
  </div>`;

export class Help {
  private readonly hint: HTMLDivElement;
  private readonly guide: HTMLDivElement;
  private hintTimer: number | undefined;

  constructor() {
    this.hint = document.createElement('div');
    this.hint.className = 'help-hint';
    this.hint.textContent = 'Press H for hotkey guide';
    document.body.appendChild(this.hint);
    this.hintTimer = window.setTimeout(() => this.hint.classList.add('is-hidden'), 8000);

    this.guide = document.createElement('div');
    this.guide.className = 'help-guide';
    this.guide.hidden = true;
    this.guide.innerHTML = GUIDE_HTML;
    this.guide.addEventListener('click', () => this.toggle());
    document.body.appendChild(this.guide);
  }

  toggle(): void {
    this.guide.hidden = !this.guide.hidden;
    this.dismissHint();
  }

  private dismissHint(): void {
    this.hint.classList.add('is-hidden');
    if (this.hintTimer !== undefined) {
      clearTimeout(this.hintTimer);
      this.hintTimer = undefined;
    }
  }

  dispose(): void {
    if (this.hintTimer !== undefined) clearTimeout(this.hintTimer);
    this.hint.remove();
    this.guide.remove();
  }
}
