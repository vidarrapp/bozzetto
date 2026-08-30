import { div } from '../../ui/dom';
import { SidePanel } from './SidePanel';
import type { SculptSession } from '../bridge/SculptSession';

/**
 * Scene outliner: the lower-left docked panel, and only the objects. Rows
 * list the scene's meshes with the active one highlighted (click selects);
 * the plus button offers primitives to add. Saving, exporting and capture
 * live next door in the File panel.
 */
export class ScenePanel extends SidePanel {
  private readonly listEl: HTMLDivElement;
  private readonly addMenu: HTMLDivElement;

  constructor(private readonly session: SculptSession) {
    super({ id: 'scene', title: 'Scene', side: 'left', variant: 'panel--scene' });

    this.listEl = div('outliner');
    this.body.appendChild(this.listEl);

    const footer = div('outliner__footer');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'outliner__add';
    addBtn.textContent = '+';
    addBtn.title = 'Add object';
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
        this.addMenu.hidden = true;
        this.session.addPrimitive(kind);
      });
      this.addMenu.appendChild(item);
    }
    addBtn.addEventListener('click', () => {
      this.addMenu.hidden = !this.addMenu.hidden;
    });
    footer.append(addBtn, this.addMenu);
    this.body.appendChild(footer);

    // A collapsing panel must not leave its popup menu armed.
    this.onCollapsedChange = (collapsed) => {
      if (collapsed) this.addMenu.hidden = true;
    };
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
  }
}
