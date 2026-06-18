import type { Panel } from './Panel';

/**
 * Coordinates the editor's two slide-out panels — the left "Project settings"
 * sidebar and the right "Look dev" control panel — so they behave on small
 * screens. It remembers the last open/closed state, and on a narrow screen the
 * two are mutually exclusive (opening one closes the other) so they never
 * overlap. First run with no saved state opens just the panel on mobile.
 *
 * The right panel is recreated whenever the preview remounts, so call attach()
 * with the fresh Panel each time; the sidebar and this coordinator persist.
 */
const NARROW_PX = 820;
const isNarrow = (): boolean => window.innerWidth < NARROW_PX;

interface SavedLayout {
  sidebar: boolean;
  panel: boolean;
}

export class EditorLayout {
  private panel: Panel | null = null;
  private sidebarOpen = true;
  private readonly arrow: HTMLSpanElement;

  constructor(
    private readonly sidebar: HTMLElement,
    handle: HTMLButtonElement,
    label: string,
    private readonly storageKey = 'bz.editor.panels',
  ) {
    const labelEl = document.createElement('span');
    labelEl.className = 'handle__label';
    labelEl.textContent = label;
    this.arrow = document.createElement('span');
    this.arrow.className = 'handle__arrow';
    handle.replaceChildren(labelEl, this.arrow);
    handle.addEventListener('click', () => this.setSidebar(!this.sidebarOpen, true));
    window.addEventListener('resize', this.onResize);
  }

  /** Bind the freshly-mounted control panel and apply the saved/default layout. */
  attach(panel: Panel): void {
    this.panel = panel;
    panel.onToggle = (collapsed) => {
      if (!collapsed && isNarrow()) this.setSidebar(false, false);
      this.persist();
    };

    const saved = this.load();
    if (saved) {
      this.setSidebar(saved.sidebar, false);
      panel.setCollapsed(!saved.panel || (isNarrow() && saved.sidebar));
    } else {
      // First run: on a narrow screen show only the Look dev panel.
      this.setSidebar(!isNarrow(), false);
      panel.setCollapsed(false);
    }
  }

  /** Tab: hide both, or restore the default layout when already hidden. */
  toggle(): void {
    const anyOpen = this.sidebarOpen || (this.panel ? !this.panel.isCollapsed() : false);
    if (anyOpen) {
      this.setSidebar(false, false);
      this.panel?.setCollapsed(true);
    } else {
      this.panel?.setCollapsed(false);
      if (!isNarrow()) this.setSidebar(true, false);
    }
    this.persist();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
  }

  private setSidebar(open: boolean, persist: boolean): void {
    this.sidebarOpen = open;
    this.sidebar.classList.toggle('editor__sidebar--collapsed', !open);
    this.arrow.textContent = open ? '‹' : '›';
    if (open && isNarrow()) this.panel?.setCollapsed(true);
    if (persist) this.persist();
  }

  private readonly onResize = (): void => {
    // Shrinking into the narrow range with both open would overlap; drop one.
    if (isNarrow() && this.sidebarOpen && this.panel && !this.panel.isCollapsed()) {
      this.setSidebar(false, true);
    }
  };

  private persist(): void {
    const data: SavedLayout = {
      sidebar: this.sidebarOpen,
      panel: this.panel ? !this.panel.isCollapsed() : true,
    };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      /* storage unavailable (private mode); fall back to defaults next load */
    }
  }

  private load(): SavedLayout | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const d = JSON.parse(raw) as Partial<SavedLayout>;
      if (typeof d.sidebar === 'boolean' && typeof d.panel === 'boolean') {
        return { sidebar: d.sidebar, panel: d.panel };
      }
    } catch {
      /* corrupt/unavailable */
    }
    return null;
  }
}
