import Enums from '@sculpt-vendor/misc/Enums';
import type { InputShell } from '../bridge/InputShell';

/**
 * Touch-first sculpt toolbar (early WS4 piece, pulled forward for iPad): a
 * bottom bar with the Negative toggle pinned in the left corner and the six
 * digit brushes centered, numbered 1-6 to match the hotkeys (icons later).
 * Most iPads have no keyboard, so this is the native way to invert strokes
 * and swap brushes; the buttons and the hotkeys stay in sync both ways.
 *
 * Negative is a sticky base: strokes invert while it is lit, and holding alt
 * still flips relative to it (so keyboard users lose nothing).
 */
export class SculptToolbar {
  private readonly root: HTMLDivElement;
  private readonly negativeBtn: HTMLButtonElement;
  private readonly brushBtns = new Map<number, HTMLButtonElement>();

  constructor(private readonly input: InputShell) {
    this.root = document.createElement('div');
    this.root.className = 'sculpt-toolbar';
    // With a transport bar present (?tl=...&sculpt=1), sit above it.
    if (document.querySelector('.transport')) this.root.classList.add('sculpt-toolbar--raised');

    const left = document.createElement('div');
    left.className = 'sculpt-toolbar__group sculpt-toolbar__left';
    this.negativeBtn = toolButton('−', 'Negative sculpting (invert strokes)');
    this.negativeBtn.addEventListener('click', () => {
      this.input.setNegativeBase(!this.input.getNegativeBase());
      this.refresh();
    });
    left.appendChild(this.negativeBtn);

    const center = document.createElement('div');
    center.className = 'sculpt-toolbar__group sculpt-toolbar__brushes';
    const tools = Enums.Tools;
    const brushes: Array<[number, string, string]> = [
      [tools.CREASE, '1', 'Crease'],
      [tools.MOVE, '2', 'Move'],
      [tools.BRUSH, '3', 'Standard (clay)'],
      [tools.INFLATE, '4', 'Inflate'],
      [tools.PINCH, '5', 'Pinch'],
      [tools.FLATTEN, '6', 'Flatten'],
    ];
    for (const [id, label, name] of brushes) {
      const btn = toolButton(label, name);
      btn.addEventListener('click', () => this.input.selectBrush(id));
      this.brushBtns.set(id, btn);
      center.appendChild(btn);
    }

    this.root.append(left, center);
    document.body.appendChild(this.root);

    this.input.onToolChange = () => this.refresh();
    this.refresh();
  }

  /** Reflect the active brush and the negative base on the buttons. */
  private refresh(): void {
    const active = this.input.currentToolIndex();
    for (const [id, btn] of this.brushBtns) {
      btn.classList.toggle('sculpt-toolbar__btn--active', id === active);
    }
    this.negativeBtn.classList.toggle(
      'sculpt-toolbar__btn--active',
      this.input.getNegativeBase(),
    );
  }

  dispose(): void {
    this.input.onToolChange = null;
    this.root.remove();
  }
}

function toolButton(label: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sculpt-toolbar__btn';
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  return btn;
}
