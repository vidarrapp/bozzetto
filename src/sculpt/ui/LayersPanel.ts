import { div } from '../../ui/dom';
import { LayerList, type LayerRowData } from '../../ui/layerList';
import { SidePanel } from './SidePanel';
import { MAX_LAYERS, WEIGHT_LIMIT, type SculptLayer } from '../bridge/layers';
import type { SculptSession } from '../bridge/SculptSession';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import { failNotice } from './statusToast';
import { PaintLayersView } from './PaintLayersView';

/**
 * The Layers tab, left, after Scene and Model: the active object's sculpt
 * layers (src/sculpt/bridge/layers.ts), newest on top, Base fixed at the
 * bottom. Add layer above the list, Flatten all below it. The list itself
 * is the shared component (src/ui/layerList.ts); this panel is what turns
 * its taps into session commands.
 */
export class LayersPanel extends SidePanel {
  private readonly list: LayerList;
  private readonly addBtn: HTMLButtonElement;
  private readonly flattenBtn: HTMLButtonElement;
  private readonly note: HTMLDivElement;
  private readonly byId = new Map<number, SculptLayer>();
  /** Everything of the sculpt layers, which the Paint workspace puts away for its own. */
  private readonly sculptEl: HTMLDivElement;
  /** The paint layers (PaintLayersView), shown in the Paint workspace in place of the sculpt layers. */
  readonly paintView: PaintLayersView;
  private paintOn = false;

  /** A layer edit that the autosave and the display must hear of. */
  onEdit: (() => void) | null = null;

  constructor(private readonly session: SculptSession) {
    super({ id: 'layers', title: 'Layers', side: 'left', variant: 'panel--layers' });

    this.sculptEl = div('layers-sculpt');
    this.body.append(this.sculptEl);
    const header = div('outliner__header');
    this.addBtn = document.createElement('button');
    this.addBtn.type = 'button';
    this.addBtn.className = 'outliner__btn outliner__btn--wide';
    this.addBtn.textContent = 'Add layer';
    this.addBtn.addEventListener('click', () => this.add());
    header.append(this.addBtn);
    this.sculptEl.append(header);

    this.note = div('layers-note');
    this.note.hidden = true;
    this.sculptEl.append(this.note);

    this.list = new LayerList(
      {
        select: (id) => {
          const mesh = this.session.getMesh();
          if (!mesh) return;
          this.session.layers.setActive(mesh, id === null ? null : (this.byId.get(id as number) ?? null));
        },
        visible: (id, visible) => {
          const mesh = this.session.getMesh();
          const layer = this.byId.get(id as number);
          if (mesh && layer) this.session.layers.setVisible(mesh, layer, visible);
        },
        rename: (id, name) => {
          const layer = this.byId.get(id as number);
          if (layer) this.session.layers.rename(layer, name);
          this.refresh();
        },
        weight: (id, w, phase) => {
          const mesh = this.session.getMesh();
          const layer = this.byId.get(id as number);
          if (mesh && layer) this.session.layers.setWeight(mesh, layer, w, phase);
        },
        menu: (id) => {
          const layer = this.byId.get(id as number);
          return [
            { label: 'Rename', action: () => this.list.startRename(id) },
            { label: 'Duplicate', action: () => layer && this.act((m) => this.session.layers.duplicate(m, layer)) },
            { label: 'Flatten into base', action: () => layer && this.act((m) => this.session.layers.flatten(m, layer)) },
            {
              label: 'Delete',
              className: 'file-menu__item--danger',
              action: () => layer && this.act((m) => this.session.layers.remove(m, layer)),
            },
          ];
        },
      },
      { baseName: 'Base', limit: WEIGHT_LIMIT },
    );
    this.sculptEl.append(this.list.el);

    const foot = div('outliner__header layers-foot');
    this.flattenBtn = document.createElement('button');
    this.flattenBtn.type = 'button';
    this.flattenBtn.className = 'outliner__btn outliner__btn--wide';
    this.flattenBtn.textContent = 'Flatten all';
    this.flattenBtn.title = 'Make every layer part of the surface';
    this.flattenBtn.addEventListener('click', () => this.act((m) => this.session.layers.flattenAll(m)));
    foot.append(this.flattenBtn);
    this.sculptEl.append(foot);

    this.paintView = new PaintLayersView(session);
    this.paintView.el.hidden = true;
    this.paintView.onEdit = () => this.onEdit?.();
    this.body.append(this.paintView.el);

    this.refresh();
  }

  /** In the Paint workspace the tab shows the paint layers; in Sculpt, the sculpt layers. */
  setPaint(on: boolean): void {
    this.paintOn = on;
    this.sculptEl.hidden = on;
    this.paintView.el.hidden = !on;
    this.refresh();
  }

  private act(fn: (mesh: SculptMesh) => unknown): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    fn(mesh);
    this.session.render();
    this.onEdit?.();
  }

  private add(): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    if (!this.session.layers.add(mesh)) {
      failNotice(
        mesh.isDynamic ? 'Layers need dynamic topology off.' : `An object has at most ${MAX_LAYERS} layers.`,
      );
      return;
    }
    this.onEdit?.();
  }

  /** Redraw from the session: the active object's layers. */
  refresh(): void {
    if (this.paintOn) {
      this.paintView.refresh();
      return;
    }
    if (this.list.isEditing()) return;
    const mesh = this.session.getMesh();
    const layers = this.session.layers;
    const items = layers.list(mesh);
    this.byId.clear();
    const rows: LayerRowData[] = items.map((l) => {
      this.byId.set(l.id, l);
      return {
        id: l.id,
        name: l.name,
        visible: l.visible,
        weight: l.weight,
      };
    });
    this.list.render(rows, layers.active(mesh)?.id ?? null);
    const dynamic = !!mesh?.isDynamic;
    this.addBtn.disabled = !mesh || dynamic;
    this.flattenBtn.disabled = items.length === 0;
    this.note.hidden = !dynamic;
    this.note.textContent = dynamic ? 'Layers need dynamic topology off.' : '';
  }
}
