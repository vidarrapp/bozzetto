/**
 * On-device pointer/touch log (`?inputdebug=1`), for input bugs that only
 * appear on real hardware.
 *
 * Hold-to-carve took three attempts precisely because iPadOS behaviour here
 * cannot be reproduced headlessly: synthetic pointers are never cancelled,
 * never contend with a stylus, and always report their lift. Rather than
 * guess a fourth time, this prints exactly what the browser delivers when a
 * finger holds a button and a Pencil draws - which pointer types appear,
 * which ids, whether a cancel arrives, and whether the stylus shows up in
 * the touch list at all.
 *
 * Off unless asked for, and it only ever reads events.
 */

const MAX_LINES = 26;

export class InputDebug {
  private readonly root: HTMLDivElement;
  private readonly lines: string[] = [];
  private readonly t0 = performance.now();

  private readonly onPointer = (e: PointerEvent): void => {
    const el = e.target as HTMLElement | null;
    const target = el?.closest('button') ? 'BTN' : el?.tagName === 'CANVAS' ? 'CANVAS' : 'page';
    // pointerType in full: the whole finger-plus-Pencil question is about
    // which device each event came from.
    this.push(`${e.type.replace('pointer', 'p.')} ${e.pointerType}#${e.pointerId} ${target}`);
  };

  private readonly onTouch = (e: TouchEvent): void => {
    this.push(`${e.type.replace('touch', 't.')} touches=${e.touches.length}`);
  };

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'input-debug';
    document.body.appendChild(this.root);
    this.push('input log ready - hold Negative, then draw');
    for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
      window.addEventListener(type, this.onPointer as EventListener, true);
    }
    for (const type of ['touchstart', 'touchend', 'touchcancel']) {
      window.addEventListener(type, this.onTouch as EventListener, true);
    }
  }

  private push(text: string): void {
    const t = ((performance.now() - this.t0) / 1000).toFixed(2).padStart(6);
    this.lines.push(`${t} ${text}`);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    this.root.textContent = this.lines.join('\n');
  }

  dispose(): void {
    for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
      window.removeEventListener(type, this.onPointer as EventListener, true);
    }
    for (const type of ['touchstart', 'touchend', 'touchcancel']) {
      window.removeEventListener(type, this.onTouch as EventListener, true);
    }
    this.root.remove();
  }
}
