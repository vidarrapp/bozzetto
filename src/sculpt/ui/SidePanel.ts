import { div, onTap } from '../../ui/dom';
import { PANEL_CLOSE_ALL_EVENT } from '../../ui/ChromeToggle';
import { sidesOverlap } from './shellLayout';

/**
 * Shared shell for the docked panels: the root, the folder tab at the top
 * of its edge, the heading, and the scrolling body.
 *
 * One panel is open per side. Each side holds two (left: Scene, Model;
 * right: Tool, Render) and opening one closes the other: panels announce
 * themselves on 'bozzetto:panel-open' with {id, side}, and a panel
 * collapses when a DIFFERENT id opens on the SAME side. Older dispatchers
 * that omit `side` are treated as right-edge. A left and a right panel can
 * be open together where they do not overlap; on a phone, where they
 * would, opening any panel closes the one open on the other side.
 *
 * The tab is the panel's way open and shut: pressing it opens the panel,
 * pressing it again closes it, and there is no close button in the panel.
 * Its place along the edge is shellLayout's; its look is shell.css's.
 * 'bozzetto:panel-set' with {id, open} opens or closes a panel from
 * outside (the View menu, Present mode putting things back).
 */

export type PanelSide = 'left' | 'right';

export interface SidePanelOptions {
  /** Unique id for the panel-open protocol. */
  id: string;
  /** The name on the tab, and the heading until the panel words it otherwise. */
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
  /** The heading at the top of the panel (setHeading words it). */
  protected readonly title: HTMLSpanElement;
  /** The name on the tab. */
  protected readonly tabLabel: HTMLSpanElement;
  private readonly handle: HTMLButtonElement;
  private readonly side: PanelSide;
  private readonly id: string;
  private collapsed: boolean;

  /** Called when this panel collapses or expands (subclasses may react). */
  protected onCollapsedChange: ((collapsed: boolean) => void) | null = null;

  /** Tab's first press tidies the screen: every open panel collapses. */
  private readonly onCloseAll = (): void => {
    if (!this.collapsed) this.setCollapsed(true);
  };

  private readonly onOtherPanelOpen = (e: Event): void => {
    const detail = (e as CustomEvent<{ id?: string; side?: PanelSide }>).detail;
    if (!detail?.id || detail.id === this.id) return;
    if ((detail.side ?? 'right') !== this.side && !sidesOverlap()) return;
    if (!this.collapsed) this.setCollapsed(true);
  };

  /** Opened or closed from outside, by id. */
  private readonly onPanelSet = (e: Event): void => {
    const detail = (e as CustomEvent<{ id?: string; open?: boolean }>).detail;
    if (detail?.id !== this.id || typeof detail.open !== 'boolean') return;
    if (this.collapsed === !detail.open) return;
    this.setCollapsed(!detail.open);
  };

  constructor(opts: SidePanelOptions) {
    this.id = opts.id;
    this.side = opts.side;
    this.collapsed = opts.collapsed ?? true;

    // panel--left rides along from the first paint, as does the collapsed
    // class: a panel that starts collapsed must never show for a frame.
    this.root = div(
      `panel ${opts.side === 'left' ? 'panel--left ' : ''}${opts.variant}` +
        (this.collapsed ? ' panel--collapsed' : ''),
    );
    // The panel's name, which the heading may not say (the object's, the tool's).
    this.root.dataset.panel = opts.title;
    document.body.appendChild(this.root);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'panel__handle';
    this.tabLabel = document.createElement('span');
    this.tabLabel.className = 'handle__label';
    this.tabLabel.textContent = opts.title;
    handle.append(this.tabLabel);
    this.handle = handle;
    // A tap, not a click: the tab sits at the screen's edge, where a hand
    // rests, and a slow tap there must not become iOS's long press (onTap).
    onTap(handle, () => this.setCollapsed(!this.collapsed));
    this.root.appendChild(handle);

    const header = div('panel__header');
    this.title = document.createElement('span');
    this.title.className = 'panel__title';
    this.title.textContent = opts.title;
    header.appendChild(this.title);
    this.root.appendChild(header);

    this.body = div('panel__body');
    this.root.appendChild(this.body);

    this.applyCollapsed();
    window.addEventListener('bozzetto:panel-open', this.onOtherPanelOpen);
    window.addEventListener('bozzetto:panel-set', this.onPanelSet);
    window.addEventListener(PANEL_CLOSE_ALL_EVENT, this.onCloseAll);
  }

  /** The panel's heading: the object's name in Model, the tool's in Tool. */
  setHeading(text: string): void {
    if (this.title.textContent !== text) this.title.textContent = text;
  }

  setCollapsed(collapsed: boolean): void {
    const wasOpen = !this.collapsed;
    this.collapsed = collapsed;
    this.applyCollapsed();
    if (!collapsed) {
      window.dispatchEvent(
        new CustomEvent('bozzetto:panel-open', {
          detail: { id: this.id, side: this.side, top: this.root.getBoundingClientRect().top },
        }),
      );
    } else if (wasOpen) {
      window.dispatchEvent(
        new CustomEvent('bozzetto:panel-close', { detail: { id: this.id, side: this.side } }),
      );
    }
    this.onCollapsedChange?.(collapsed);
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  private applyCollapsed(): void {
    this.root.classList.toggle('panel--collapsed', this.collapsed);
    this.handle.setAttribute('aria-expanded', String(!this.collapsed));
  }

  dispose(): void {
    window.removeEventListener('bozzetto:panel-open', this.onOtherPanelOpen);
    window.removeEventListener('bozzetto:panel-set', this.onPanelSet);
    window.removeEventListener(PANEL_CLOSE_ALL_EVENT, this.onCloseAll);
    this.root.remove();
  }
}
