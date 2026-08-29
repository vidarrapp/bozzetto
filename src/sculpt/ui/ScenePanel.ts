import { div } from '../../ui/dom';
import type { SculptSession } from '../bridge/SculptSession';

/**
 * Scene outliner (WS4 review request): a LEFT-docked panel, collapsed by
 * default, listing the scene's objects with the active one highlighted
 * (click selects) and a plus button offering primitives to add. Save /
 * load / export options land here later (plan 12b backlog).
 */
export class ScenePanel {
  private readonly root: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly addMenu: HTMLDivElement;
  private readonly handleArrow: HTMLSpanElement;
  private collapsed = true;

  constructor(private readonly session: SculptSession) {
    this.root = div('panel panel--left panel--scene panel--collapsed');
    document.body.appendChild(this.root);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'panel__handle panel__handle--left';
    const label = document.createElement('span');
    label.className = 'handle__label';
    label.textContent = 'Scene';
    this.handleArrow = document.createElement('span');
    this.handleArrow.className = 'handle__arrow';
    handle.append(label, this.handleArrow);
    handle.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.root.appendChild(handle);

    const header = div('panel__header');
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = 'Scene';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel__close';
    close.textContent = '‹';
    close.addEventListener('click', () => this.setCollapsed(true));
    header.append(title, close);
    this.root.appendChild(header);

    const body = div('panel__body');
    this.listEl = div('outliner');
    body.appendChild(this.listEl);

    const footer = div('outliner__footer');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'outliner__add';
    addBtn.textContent = '+';
    addBtn.title = 'Add object';
    this.addMenu = div('outliner__menu');
    this.addMenu.hidden = true;
    for (const [kind, label2] of [
      ['sphere', 'Sphere'],
      ['cube', 'Cube'],
      ['cylinder', 'Cylinder'],
      ['torus', 'Torus'],
    ] as const) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'outliner__menu-item';
      item.textContent = label2;
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
    body.appendChild(footer);
    this.root.appendChild(body);
    this.applyCollapsed();
    this.refresh();
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    this.root.classList.toggle('panel--collapsed', this.collapsed);
    this.handleArrow.textContent = this.collapsed ? '›' : '‹';
    if (this.collapsed) this.addMenu.hidden = true;
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

  dispose(): void {
    this.root.remove();
  }
}
