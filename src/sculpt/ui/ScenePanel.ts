import { div, labelRow, selectEl } from '../../ui/dom';
import { SidePanel } from './SidePanel';
import type { SculptSession } from '../bridge/SculptSession';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { MaterialLibrary } from '../bridge/materials';

/**
 * Scene outliner: the lower-left docked panel, and only the objects. Each
 * row is an eye (visibility), a padlock (edit lock), the name - click
 * selects, double-click renames in place - and, on the selected row, a
 * trash can. The wide Create button sits right under the list, and the
 * selection's material row under that; new materials are made from the
 * dropdown's own trailing "New*" entry rather than a separate button.
 * Saving, exporting and capture live next door in the File panel.
 */
export class ScenePanel extends SidePanel {
  private readonly listEl: HTMLDivElement;
  private readonly addMenu: HTMLDivElement;
  private matRow?: HTMLDivElement;
  /** The object whose name is being edited, so refresh keeps the input. */
  private renaming: SculptMesh | null = null;

  /**
   * Fired after any panel-driven scene edit that bypasses the undo stack
   * (rename, eye, padlock): the mount syncs the display side and tells the
   * autosave. Selection and history-backed edits announce themselves.
   */
  onSceneEdit: (() => void) | null = null;

  private mirrorMenu!: HTMLDivElement;

  /** Any press outside the popup dismisses it, menu-style. */
  private readonly onDocPointerDown = (e: Event): void => {
    const t = e.target as Node;
    const inside =
      (!this.addMenu.hidden && this.addMenu.contains(t)) ||
      (!this.mirrorMenu.hidden && this.mirrorMenu.contains(t));
    if (!inside) this.closeMenus();
  };

  constructor(
    private readonly session: SculptSession,
    private readonly library?: MaterialLibrary,
  ) {
    super({ id: 'scene', title: 'Scene', side: 'left', variant: 'panel--scene' });

    this.listEl = div('outliner');
    this.body.appendChild(this.listEl);

    // Create sits directly under the object list it adds to, with the
    // selection's material line beneath it (owner layout call).
    const footer = div('outliner__footer');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'outliner__btn outliner__btn--wide';
    addBtn.textContent = 'Create';

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
        this.closeMenus();
        this.session.addPrimitive(kind);
      });
      this.addMenu.appendChild(item);
    }
    document.body.appendChild(this.addMenu);
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.addMenu.hidden) this.openMenu(this.addMenu, addBtn);
      else this.closeMenus();
    });
    footer.append(addBtn);
    // Duplicate and Delete under Create (owner call): the three things you
    // do to the list, in one place. Delete takes the whole selection.
    const row = div('outliner__actions');
    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'outliner__btn';
    dupBtn.textContent = 'Duplicate';
    dupBtn.addEventListener('click', () => this.duplicateActive());
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'outliner__btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => this.deleteSelected());
    // Mirror: a copy across a world axis, or a ring of copies around one
    // (owner call). Its own popup, the way Create has one.
    const mirrorBtn = document.createElement('button');
    mirrorBtn.type = 'button';
    mirrorBtn.className = 'outliner__btn';
    mirrorBtn.textContent = 'Mirror';
    this.mirrorMenu = div('outliner__menu');
    this.mirrorMenu.hidden = true;
    document.body.appendChild(this.mirrorMenu);
    mirrorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.mirrorMenu.hidden) {
        this.buildMirrorMenu();
        this.openMenu(this.mirrorMenu, mirrorBtn);
      } else {
        this.closeMenus();
      }
    });
    row.append(dupBtn, delBtn, mirrorBtn);
    footer.appendChild(row);
    this.body.appendChild(footer);
    this.matRow = div('outliner__material');
    this.body.appendChild(this.matRow);

    // A collapsing panel must not leave its popup menu armed.
    this.onCollapsedChange = (collapsed) => {
      if (collapsed) this.closeMenus();
    };
    this.refresh();
  }

  private openMenu(menu: HTMLDivElement, anchor: HTMLElement): void {
    this.closeMenus();
    const btn = anchor.getBoundingClientRect();
    const panel = this.root.getBoundingClientRect();
    menu.hidden = false;
    // Measured after unhiding so the height is real. Opens BESIDE the panel
    // rather than over it - the object list is the thing you are adding to,
    // so covering it while choosing reads badly - and falls back to above
    // the button if there is no room to the right.
    const h = menu.offsetHeight;
    const w = menu.offsetWidth;
    const right = panel.right + 6;
    const fitsRight = right + w <= window.innerWidth - 8;
    const left = fitsRight ? right : Math.max(8, btn.left);
    const wanted = fitsRight ? btn.bottom - h : btn.top - 6 - h;
    const top = Math.min(window.innerHeight - h - 8, Math.max(8, wanted));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    document.addEventListener('pointerdown', this.onDocPointerDown, true);
  }

  private closeMenus(): void {
    this.addMenu.hidden = true;
    this.mirrorMenu.hidden = true;
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
  }

  /**
   * The Mirror menu, rebuilt on open because the radial entries name the
   * object's symmetry axis, which the Tool panel can change between opens.
   */
  private buildMirrorMenu(): void {
    this.mirrorMenu.replaceChildren();
    const item = (label: string, onPick: () => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'outliner__menu-item';
      b.textContent = label;
      b.addEventListener('click', () => {
        this.closeMenus();
        onPick();
      });
      this.mirrorMenu.appendChild(b);
    };
    for (const axis of ['x', 'y', 'z'] as const) {
      item(`Mirror ${axis.toUpperCase()}`, () => this.mirrorActive(axis));
    }
    const sep = div('outliner__menu-sep');
    this.mirrorMenu.appendChild(sep);
    const axis = this.session.getSymmetryAxis().toUpperCase();
    for (const count of [3, 4, 5, 6, 8, 12]) {
      item(`Radial ×${count} around ${axis}`, () => this.radialActive(count));
    }
  }

  /** A mirrored copy across a world axis; the copy takes the object's material. */
  mirrorActive(axis: 'x' | 'y' | 'z'): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    this.library?.beginRestore();
    let copy: SculptMesh | null;
    try {
      copy = this.session.mirrorMesh(mesh, axis) as unknown as SculptMesh | null;
    } finally {
      this.library?.endRestore();
    }
    if (!copy) return;
    this.library?.adoptCopy(copy, mesh);
    this.refresh();
  }

  /** Copies turned around the object's symmetry axis, the object one of `count`. */
  radialActive(count: number): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    this.library?.beginRestore();
    let copies: SculptMesh[];
    try {
      copies = this.session.radialCopies(mesh, count, this.session.getSymmetryAxis()) as unknown as SculptMesh[];
    } finally {
      this.library?.endRestore();
    }
    for (const c of copies) this.library?.adoptCopy(c, mesh);
    this.refresh();
  }

  /** Duplicate: a copy of the active object, at its transform, with its material. */
  private duplicateActive(): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    // The library fills a new object's colours with its material the moment
    // it is selected; held off here, so a painted source's copy keeps its
    // paint and is then adopted with the same material and the same claim.
    this.library?.beginRestore();
    let copy: SculptMesh | null;
    try {
      copy = this.session.duplicateMesh(mesh) as unknown as SculptMesh | null;
    } finally {
      this.library?.endRestore();
    }
    if (!copy) return;
    this.library?.adoptCopy(copy, mesh);
    this.refresh();
  }

  /** Delete: every selected object (the active one when nothing else is), after asking. */
  deleteSelected(): void {
    // A copy: deleteMesh edits the selection list while this walks it.
    const selected = [...this.session.getSelectedMeshes()];
    const targets = selected.length > 0 ? selected : this.session.getMesh() ? [this.session.getMesh()!] : [];
    if (targets.length === 0) return;
    const remaining = this.session.getMeshes().length - targets.length;
    if (remaining < 1) {
      alert('The scene needs at least one object. Use New sculpt to start over.');
      return;
    }
    const what =
      targets.length === 1
        ? `"${this.session.getMeshName(targets[0])}"`
        : `${targets.length} objects`;
    // Ctrl+z brings them back, so the prompt does not threaten permanence.
    if (!confirm(`Delete ${what}?`)) return;
    for (const m of targets) this.session.deleteMesh(m);
    this.refresh();
  }

  /** Trash can: drop the selected object, once, after asking. */
  private deleteActive(): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    if (this.session.getMeshes().length <= 1) {
      alert('The scene needs at least one object. Use New scene to start over.');
      return;
    }
    // Ctrl+z brings it back, so the prompt does not threaten permanence.
    if (!confirm(`Delete "${this.session.getMeshName(mesh)}"?`)) return;
    this.session.deleteMesh(mesh);
    this.refresh();
  }

  /** A small icon-only button (eye, padlock, trash). */
  private iconBtn(icon: string, title: string, onPress: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'outliner__icon';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    const glyph = document.createElement('i');
    glyph.className = `fi ${icon}`;
    glyph.setAttribute('aria-hidden', 'true');
    btn.appendChild(glyph);
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // the row behind selects; the icons must not
      onPress();
    });
    return btn;
  }

  /** Swap the name for an input; Enter/blur commits, Escape abandons. */
  private startRename(mesh: SculptMesh, nameEl: HTMLElement): void {
    this.renaming = mesh;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'outliner__rename';
    input.value = this.session.getMeshName(mesh);
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return; // Enter commits, then the removal fires blur too
      done = true;
      this.renaming = null;
      const next = input.value.trim();
      if (commit && next && next !== this.session.getMeshName(mesh)) {
        this.session.setMeshName(mesh, next);
        this.onSceneEdit?.();
      }
      this.refresh();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not trigger sculpt hotkeys
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  /** Rebuild the object rows from the live scene (list/selection changes). */
  refresh(): void {
    const active = this.session.getMesh();
    const selected = new Set(this.session.getSelectedMeshes());
    const many = this.session.getMeshes().length > 1;
    // The object under rename can vanish mid-edit (undo, delete elsewhere);
    // a stale flag would wait forever for an input that no longer exists.
    if (this.renaming && !this.session.getMeshes().includes(this.renaming)) this.renaming = null;
    this.listEl.replaceChildren(
      ...this.session.getMeshes().map((mesh) => {
        const row = div('outliner__row');
        const visible = mesh.isVisible();
        const locked = this.session.isLocked(mesh);
        if (mesh === active) row.classList.add('outliner__row--active');
        // The Select tool's selection, beside the active object's row.
        else if (selected.has(mesh)) row.classList.add('outliner__row--selected');
        if (!visible) row.classList.add('outliner__row--hidden');

        row.appendChild(
          this.iconBtn(
            visible ? 'fi-ss-eye' : 'fi-ss-eye-crossed',
            visible ? 'Hide' : 'Show',
            () => {
              this.session.setMeshVisible(mesh, !visible);
              this.onSceneEdit?.();
              this.refresh();
            },
          ),
        );
        const lockBtn = this.iconBtn(
          locked ? 'fi-ss-lock' : 'fi-ss-unlock',
          locked ? 'Unlock editing' : 'Lock editing',
          () => {
            this.session.setLocked(mesh, !locked);
            this.onSceneEdit?.();
            this.refresh();
          },
        );
        if (locked) lockBtn.classList.add('outliner__icon--on');
        row.appendChild(lockBtn);

        if (this.renaming === mesh) {
          // Rebuilt mid-rename (a background refresh): stay in edit mode.
          const placeholder = document.createElement('span');
          row.appendChild(placeholder);
          this.startRename(mesh, placeholder);
        } else {
          const name = document.createElement('span');
          name.className = 'outliner__name';
          name.textContent = this.session.getMeshName(mesh);
          name.addEventListener('dblclick', () => this.startRename(mesh, name));
          row.appendChild(name);
        }

        if (mesh === active && many) {
          const del = this.iconBtn('fi-ss-trash', 'Delete object', () => this.deleteActive());
          del.classList.add('outliner__icon--danger');
          row.appendChild(del);
        }

        row.addEventListener('click', () => {
          if (mesh !== this.session.getMesh()) this.session.setMesh(mesh);
        });
        return row;
      }),
    );
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
    // The trailing "New*" entry IS the create button (owner call): picking
    // it prompts for a name, makes the material and assigns it here.
    const NEW_ID = '__new__';
    const select = selectEl(
      [
        ...this.library.list().map((m) => [m.id, m.name] as [string, string]),
        [NEW_ID, 'New*'] as [string, string],
      ],
      current.id,
    );
    // The padlock means "not edited": re-assigning fills the object's
    // colours, so a locked object's material is read-only with it.
    select.disabled = this.session.isLocked(active);
    select.addEventListener('change', () => {
      // Any assignment re-fills the object, so painted work would go: ask.
      if (
        this.library!.isPainted(active) &&
        !confirm('Change material? The colours painted on this object will be replaced.')
      ) {
        select.value = current.id;
        return;
      }
      if (select.value === NEW_ID) {
        const name = prompt('New material name', 'Clay');
        if (name === null) {
          select.value = current.id;
          return;
        }
        this.library!.assign(active, this.library!.create(name.trim() || 'Clay').id);
        this.session.render();
        this.refreshMaterial(); // the new material takes the slot, "New*" stays last
        return;
      }
      this.library!.assign(active, select.value);
      this.session.render();
    });
    this.matRow.replaceChildren(labelRow('Material', select));
  }

  override dispose(): void {
    this.closeMenus();
    this.mirrorMenu.remove();
    this.addMenu.remove();
    super.dispose();
  }
}
