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
    <div class="help-row"><span class="help-key">Double-click</span><span>Set focus point (double-tap on touch)</span></div>
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

const SCULPT_HTML = `
  <div class="help-guide__head">Sculpt hotkeys <span class="help-guide__close">H to close</span></div>
  <div class="help-guide__group">
    <div class="help-guide__title">Sculpting</div>
    <div class="help-row"><span class="help-key">Drag on mesh</span><span>Sculpt (off mesh: orbit)</span></div>
    <div class="help-row"><span class="help-key">Alt + drag</span><span>Negative (carve)</span></div>
    <div class="help-row"><span class="help-key">Shift + drag</span><span>Smooth</span></div>
    <div class="help-row"><span class="help-key">Ctrl + drag</span><span>Mask (+ Alt to unmask)</span></div>
    <div class="help-row"><kbd>B</kbd><span>Brush size (hold + drag)</span></div>
    <div class="help-row"><kbd>S</kbd><span>Brush strength (hold + drag up/down)</span></div>
    <div class="help-row"><kbd>[</kbd><kbd>]</kbd><span>Brush size step (wheel-friendly)</span></div>
    <div class="help-row"><kbd>;</kbd><kbd>'</kbd><span>Brush strength step (row below)</span></div>
    <div class="help-row"><kbd>X</kbd><span>Symmetry</span></div>
    <div class="help-row"><kbd>Ctrl</kbd>+<kbd>Z</kbd><span>Undo (Shift: redo)</span></div>
    <div class="help-row"><kbd>Ctrl</kbd>+<kbd>C</kbd><span>Clear mask</span></div>
    <div class="help-row"><kbd>Ctrl</kbd>+<kbd>I</kbd><span>Invert mask</span></div>
    <div class="help-row"><kbd>Ctrl</kbd>+<kbd>H</kbd><span>Show / hide mask tint</span></div>
    <div class="help-row"><kbd>Ctrl</kbd>+<kbd>E</kbd><span>Extract masked region</span></div>
  </div>
  <div class="help-guide__group">
    <div class="help-guide__title">Brushes</div>
    <div class="help-row"><kbd>1</kbd><span>Crease</span></div>
    <div class="help-row"><kbd>2</kbd><span>Move</span></div>
    <div class="help-row"><kbd>3</kbd><span>Standard (clay)</span></div>
    <div class="help-row"><kbd>4</kbd><span>Inflate</span></div>
    <div class="help-row"><kbd>5</kbd><span>Pinch</span></div>
    <div class="help-row"><kbd>6</kbd><span>Flatten</span></div>
    <div class="help-row"><kbd>7</kbd><span>Smooth</span></div>
    <div class="help-row"><kbd>8</kbd><span>Drag</span></div>
    <div class="help-row"><kbd>9</kbd><span>Twist</span></div>
  </div>
  <div class="help-guide__group">
    <div class="help-guide__title">Detail</div>
    <div class="help-row"><kbd>Ctrl</kbd>+<kbd>D</kbd><span>Subdivide</span></div>
    <div class="help-row"><kbd>D</kbd><span>Subdivision level up</span></div>
    <div class="help-row"><kbd>Shift</kbd>+<kbd>D</kbd><span>Subdivision level down</span></div>
  </div>
  <div class="help-guide__group">
    <div class="help-guide__title">Scene</div>
    <div class="help-row"><kbd>F</kbd><span>Frame model (orbit follows your strokes)</span></div>
    <div class="help-row"><kbd>←</kbd><kbd>→</kbd><span>Turn model 1° (wheel-friendly)</span></div>
    <div class="help-row"><kbd>Shift</kbd>+<kbd>S</kbd><span>Shadows on / off</span></div>
    <div class="help-row"><kbd>L</kbd><span>Rotate light (hold + drag)</span></div>
  </div>
  <div class="help-guide__group">
    <div class="help-guide__title">Interface</div>
    <div class="help-row"><kbd>Tab</kbd><span>Close panels, then hide the interface</span></div>
    <div class="help-row"><kbd>Esc</kbd><span>Show the interface</span></div>
    <div class="help-row"><kbd>H</kbd><span>This guide</span></div>
  </div>`;

export class Help {
  private readonly hint: HTMLDivElement;
  private readonly guide: HTMLDivElement;
  private hintTimer: number | undefined;
  private readonly onSculptMode = (e: Event): void => {
    const active = !!(e as CustomEvent<{ active?: boolean }>).detail?.active;
    this.guide.innerHTML = active ? SCULPT_HTML : GUIDE_HTML;
  };

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
    // Sculpt mode swaps the guide content while active (and back on exit).
    window.addEventListener('bozzetto:sculptmode', this.onSculptMode);
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
    window.removeEventListener('bozzetto:sculptmode', this.onSculptMode);
    this.hint.remove();
    this.guide.remove();
  }
}
