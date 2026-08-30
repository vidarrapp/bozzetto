import { div } from '../../ui/dom';

/**
 * Shared shell for the docked sculpt panels: the sliding root, the edge
 * handle that doubles as the collapsed tab, the title bar with its close
 * button, and the scrolling body.
 *
 * Mutual collapse is SIDE-SCOPED. Each edge holds a stack of panels (right:
 * Render, Sculpt; left: File, Scene) and only one per edge is open at a
 * time, so an open panel never covers its neighbour's tab - but a left and
 * a right panel can be open together, since they never overlap. Panels
 * announce themselves on 'bozzetto:panel-open' with {id, side}; a panel
 * collapses when a DIFFERENT id opens on the SAME side. Older dispatchers
 * that omit `side` are treated as right-edge, which is where they all were.
 */

export type PanelSide = 'left' | 'right';

export interface SidePanelOptions {
  /** Unique id for the panel-open protocol. */
  id: string;
  /** Title bar text and collapsed-tab label. */
  title: string;
  side: PanelSide;
  /** Extra class on the root (e.g. 'panel--scene') for per-panel geometry. */
  variant: string;
  /** Start collapsed (all sculpt panels do). */
  collapsed?: boolean;
}

export class SidePanel {
  protected readonly root: HTMLDivElement;
  protected readonly body: HTMLDivElement;
  private readonly handleArrow: HTMLSpanElement;
  private readonly side: PanelSide;
  private readonly id: string;
  private collapsed: boolean;

  /** Called when this panel collapses or expands (subclasses may react). */
  protected onCollapsedChange: ((collapsed: boolean) => void) | null = null;

  private readonly onOtherPanelOpen = (e: Event): void => {
    const detail = (e as CustomEvent<{ id?: string; side?: PanelSide }>).detail;
    if (!detail?.id || detail.id === this.id) return;
    if ((detail.side ?? 'right') !== this.side) return;
    if (!this.collapsed) this.setCollapsed(true);
  };

  constructor(opts: SidePanelOptions) {
    this.id = opts.id;
    this.side = opts.side;
    this.collapsed = opts.collapsed ?? true;

    // panel--left must ride along from the first paint: the collapse
    // transform is direction-specific, and a panel that gets
    // panel--collapsed without it slides off the WRONG edge, taking its
    // tab off-screen with it. Both classes go on before the first paint so
    // a panel that starts collapsed never animates its way out.
    this.root = div(
      `panel ${opts.side === 'left' ? 'panel--left ' : ''}${opts.variant}` +
        (this.collapsed ? ' panel--collapsed' : ''),
    );
    document.body.appendChild(this.root);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = `panel__handle${opts.side === 'left' ? ' panel__handle--left' : ''}`;
    const label = document.createElement('span');
    label.className = 'handle__label';
    label.textContent = opts.title;
    this.handleArrow = document.createElement('span');
    this.handleArrow.className = 'handle__arrow';
    handle.append(label, this.handleArrow);
    handle.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.root.appendChild(handle);

    const header = div('panel__header');
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = opts.title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel__close';
    close.textContent = opts.side === 'left' ? '‹' : '›';
    close.setAttribute('aria-label', `Hide ${opts.title.toLowerCase()} panel`);
    close.addEventListener('click', () => this.setCollapsed(true));
    header.append(title, close);
    this.root.appendChild(header);

    this.body = div('panel__body');
    this.root.appendChild(this.body);

    this.applyCollapsed();
    window.addEventListener('bozzetto:panel-open', this.onOtherPanelOpen);
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.applyCollapsed();
    if (!collapsed) {
      window.dispatchEvent(
        new CustomEvent('bozzetto:panel-open', { detail: { id: this.id, side: this.side } }),
      );
    }
    this.onCollapsedChange?.(collapsed);
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  private applyCollapsed(): void {
    this.root.classList.toggle('panel--collapsed', this.collapsed);
    // The arrow points the way the panel travels on click.
    const out = this.side === 'left' ? '›' : '‹';
    const back = this.side === 'left' ? '‹' : '›';
    this.handleArrow.textContent = this.collapsed ? out : back;
  }

  dispose(): void {
    window.removeEventListener('bozzetto:panel-open', this.onOtherPanelOpen);
    this.root.remove();
  }
}
