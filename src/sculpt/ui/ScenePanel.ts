import { div, labelRow, selectEl } from '../../ui/dom';
import { SidePanel } from './SidePanel';
import type { SculptSession } from '../bridge/SculptSession';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { MaterialLibrary } from '../bridge/materials';

/**
 * Scene outliner: the lower-left docked panel, and only the objects. Each
 * row is an eye (visibility), a padlock (edit lock), the name - click
 * selects, double-click renames in place - and, on the selected row, a
 * trash can. Objects are added through the wide button under the list.
 * Saving, exporting and capture live next door in the File panel.
 */
export class ScenePanel extends SidePanel {
  private readonly listEl: HTMLDivElement;
  private readonly addMenu: HTMLDivElement;
  private matRow?: HTMLDivElement;
  private newMatBtn?: HTMLButtonElement;
  /** The object whose name is being edited, so refresh keeps the input. */
  private renaming: SculptMesh | null = null;

  /**
   * Fired after any panel-driven scene edit that bypasses the undo stack
   * (rename, eye, padlock): the mount syncs the display side and tells the
   * autosave. Selection and history-backed edits announce themselves.
   */
  onSceneEdit: (() => void) | null = null;

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

    // Material assignment sits between the objects and the add button: it
    // belongs to the selected object above it.
    this.matRow = div('outliner__material');
    this.body.appendChild(this.matRow);
    this.newMatBtn = document.createElement('button');
    this.newMatBtn.type = 'button';
    this.newMatBtn.className = 'outliner__btn outliner__btn--wide';
    this.newMatBtn.textContent = 'New material';
    this.newMatBtn.addEventListener('click', () => {
      const active = this.session.getMesh();
      if (!active || !this.library) return;
      const name = prompt('New material name', 'Clay');
      if (name === null) return;
      // Assigning re-fills the object, so painted work would go: ask first.
      if (
        this.library.isPainted(active) &&
        !confirm('New material? The colours painted on this object will be replaced.')
      ) {
        return;
      }
      this.library.assign(active, this.library.create(name.trim() || 'Clay').id);
      this.session.render();
    });

    const footer = div('outliner__footer');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'outliner__btn outliner__btn--wide';
    addBtn.textContent = 'Add to scene';

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
    footer.append(addBtn);
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
    const select = selectEl(
      this.library.list().map((m) => [m.id, m.name] as [string, string]),
      current.id,
    );
    // The padlock means "not edited": re-assigning fills the object's
    // colours, so a locked object's material is read-only with it.
    const locked = this.session.isLocked(active);
    select.disabled = locked;
    this.newMatBtn!.disabled = locked;
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
