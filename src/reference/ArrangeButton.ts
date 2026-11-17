import type { ReferenceBoard } from './board';

/**
 * The edge button that turns Arrange on and off: a lock, in the left edge
 * column with Solo, Undo, Redo and Negative, shown only while at least one
 * reference is in the view. Neutral when the pictures are locked, an orange
 * icon (no square behind it, as the other edge buttons) while arranging.
 * It takes the look of the Solo button (shell.css .sculpt-solobtn).
 */
export class ArrangeButton {
  readonly el: HTMLDivElement;
  private readonly btn: HTMLButtonElement;
  private readonly icon: HTMLElement;
  private readonly off: () => void;

  constructor(private readonly board: ReferenceBoard) {
    this.el = document.createElement('div');
    this.el.className = 'ref-arrange-wrap';
    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.className = 'sculpt-solobtn ref-arrangebtn';
    this.icon = document.createElement('i');
    this.icon.setAttribute('aria-hidden', 'true');
    this.btn.appendChild(this.icon);
    this.btn.addEventListener('click', () => this.board.setArranging(!this.board.isArranging()));
    this.el.appendChild(this.btn);
    this.off = board.onChange(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const any = this.board.inView().length > 0;
    const on = this.board.isArranging();
    this.el.hidden = !any;
    this.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const name = on ? 'Lock the references' : 'Arrange the references';
    this.btn.title = name;
    this.btn.setAttribute('aria-label', name);
    this.icon.className = `fi ${on ? 'fi-ss-unlock' : 'fi-ss-lock'}`;
  }

  /** Stand in a column: just under Solo when the column has one, else at its head. */
  mount(column: HTMLElement): void {
    const solo = column.querySelector('.sculpt-solo');
    if (solo) solo.after(this.el);
    else column.prepend(this.el);
  }

  dispose(): void {
    this.off();
    this.el.remove();
  }
}
