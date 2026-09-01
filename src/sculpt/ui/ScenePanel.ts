import { div, labelRow, selectEl } from '../../ui/dom';
import { SidePanel } from './SidePanel';
import type { SculptSession } from '../bridge/SculptSession';
import type { MaterialLibrary } from '../bridge/materials';

/**
 * Scene outliner: the lower-left docked panel, and only the objects. Rows
 * list the scene's meshes with the active one highlighted (click selects);
 * the plus button offers primitives to add. Saving, exporting and capture
 * live next door in the File panel.
 */
export class ScenePanel extends SidePanel {
  private readonly listEl: HTMLDivElement;
  private readonly addMenu: HTMLDivElement;
  private delBtn!: HTMLButtonElement;
  private matRow?: HTMLDivElement;
  private newMatBtn?: HTMLButtonElement;

  /** Any press outside the popup dismisses it, menu-style. */
  private readonly onDocPointerDown = (e: Event): void => {
    if (!this.addMenu.hidden && !this.addMenu.contains(e.target as Node)) this.closeAddMenu();
  };

  constructor(
    private readonly session: SculptSession,
    private readonly library?: MaterialLibrary,
  ) {
    super({ id: 'scene', title: 'Scene', side: 'left', variant: 'panel--scene' });

    this.listEl = div('outliner');
    this.body.appendChild(this.listEl);

    // Material assignment sits between the objects and the add/delete
    // footer: it belongs to the selected object above it.
    this.matRow = div('outliner__material');
    this.body.appendChild(this.matRow);
    this.newMatBtn = document.createElement('button');
    this.newMatBtn.type = 'button';
    this.newMatBtn.className = 'outliner__btn outliner__btn--wide';
    this.newMatBtn.textContent = 'New material';
    this.newMatBtn.addEventListener('click', () => {
      const active = this.session.getMesh();
      if (!active || !this.library) return;
      this.library.assign(active, this.library.create().id);
      this.session.render();
    });

    const footer = div('outliner__footer');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'outliner__btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add object';
    addBtn.setAttribute('aria-label', 'Add object');

    this.delBtn = document.createElement('button');
    this.delBtn.type = 'button';
    this.delBtn.className = 'outliner__btn';
    this.delBtn.textContent = '\u2212'; // minus
    this.delBtn.title = 'Delete the selected object';
    this.delBtn.setAttribute('aria-label', 'Delete the selected object');
    this.delBtn.addEventListener('click', () => this.deleteActive());

    // The menu lives on the body, not in the panel: the panel body scrolls
    // and clips, and with only the default sphere in the list the panel is
    // shorter than the menu, so an in-flow popup was simply invisible.
    // Fixed positioning against the button's own rect sidesteps both.
    this.addMenu = div('outliner__menu');
    this.addMenu.hidden = true;
    for (const [kind, label] of [
      ['sphere', 'Sphere'],
      ['cube', 'Cube'],
      ['cylinder', 'Cylinder'],
      ['torus', 'Torus'],
    ] as const) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'outliner__menu-item';
      item.textContent = label;
      item.addEventListener('click', () => {
        this.closeAddMenu();
        this.session.addPrimitive(kind);
      });
      this.addMenu.appendChild(item);
    }
    document.body.appendChild(this.addMenu);
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.addMenu.hidden) this.openAddMenu(addBtn);
      else this.closeAddMenu();
    });
    footer.append(addBtn, this.delBtn);
    this.body.appendChild(footer);

    // A collapsing panel must not leave its popup menu armed.
    this.onCollapsedChange = (collapsed) => {
      if (collapsed) this.closeAddMenu();
    };
    this.refresh();
  }

  private openAddMenu(anchor: HTMLElement): void {
    const btn = anchor.getBoundingClientRect();
    const panel = this.root.getBoundingClientRect();
    this.addMenu.hidden = false;
    // Measured after unhiding so the height is real. Opens BESIDE the panel
    // rather than over it - the object list is the thing you are adding to,
    // so covering it while choosing reads badly - and falls back to above
    // the button if there is no room to the right.
    const h = this.addMenu.offsetHeight;
    const w = this.addMenu.offsetWidth;
    const right = panel.right + 6;
    const fitsRight = right + w <= window.innerWidth - 8;
    const left = fitsRight ? right : Math.max(8, btn.left);
    const wanted = fitsRight ? btn.bottom - h : btn.top - 6 - h;
    const top = Math.min(window.innerHeight - h - 8, Math.max(8, wanted));
    this.addMenu.style.left = `${Math.round(left)}px`;
    this.addMenu.style.top = `${Math.round(top)}px`;
    document.addEventListener('pointerdown', this.onDocPointerDown, true);
  }

  private closeAddMenu(): void {
    this.addMenu.hidden = true;
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
  }

  /** Minus: drop the selected object, once, after asking. */
  private deleteActive(): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    if (this.session.getMeshes().length <= 1) {
      alert('The scene needs at least one object. Use New scene to start over.');
      return;
    }
    const name = this.session.getMeshName(mesh);
    if (!confirm(`Delete "${name}"? This cannot be undone from the outliner.`)) return;
    this.session.deleteMesh(mesh);
    this.refresh();
  }

  /** Rebuild the object rows from the live scene (list/selection changes). */
  refresh(): void {
    const active = this.session.getMesh();
    this.listEl.replaceChildren(
      ...this.session.getMeshes().map((mesh) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'outliner__row';
        if (mesh === active) row.classList.add('outliner__row--active');
        row.textContent = this.session.getMeshName(mesh);
        row.addEventListener('click', () => {
          this.session.setMesh(mesh);
        });
        return row;
      }),
    );
    // Nothing to delete when the scene is down to its last object.
    this.delBtn.disabled = this.session.getMeshes().length <= 1;
    this.refreshMaterial();
  }

  /**
   * The active object's material, and a way to make another. Assignment
   * lives here rather than in the Render panel because it is a property of
   * the OBJECT; the Render panel edits whichever material the selection
   * points at.
   */
  private refreshMaterial(): void {
    if (!this.library || !this.matRow) return;
    const active = this.session.getMesh();
    this.matRow.hidden = !active;
    if (!active) return;
    const current = this.library.materialFor(active);
    const select = selectEl(
      this.library.list().map((m) => [m.id, m.name] as [string, string]),
      current.id,
    );
    select.addEventListener('change', () => {
      // Re-assigning re-fills the object, so painted work would go: ask.
      if (
        this.library!.isPainted(active) &&
        !confirm('Change material? The colours painted on this object will be replaced.')
      ) {
        select.value = current.id;
        return;
      }
      this.library!.assign(active, select.value);
      this.session.render();
    });
    this.matRow.replaceChildren(labelRow('Material', select), this.newMatBtn!);
  }

  override dispose(): void {
    this.closeAddMenu();
    this.addMenu.remove();
    super.dispose();
  }
}
