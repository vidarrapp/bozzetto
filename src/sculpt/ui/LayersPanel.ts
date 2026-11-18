import { div } from '../../ui/dom';
import { dynamicNote } from './dynamicNote';
import { LayerBar, LayerControls, LayerList, type LayerRowData } from '../../ui/layerList';
import { displayRows, resolveDrop } from '../../ui/layerTree';
import { askWindow } from '../../ui/askWindow';
import type { RowMenuItem } from '../../ui/rowMenu';
import { SidePanel } from './SidePanel';
import { MAX_LAYERS, WEIGHT_LIMIT, type SculptLayer } from '../bridge/layers';
import type { SculptSession } from '../bridge/SculptSession';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import { failNotice } from './statusToast';
import { PaintLayersView } from './PaintLayersView';

/**
 * The Layers tab, left, after Scene and Model, as Photoshop's panel is: the
 * Weight of the active layer or group above the list, the list with one row a
 * layer (groups folding over theirs), Base fixed at the bottom with Flatten all
 * in its menu, and at the foot a bar of icons: Add mask, New group, New layer
 * and Delete. The list is the shared component (src/ui/layerList.ts); this
 * panel is what turns its taps into session commands.
 */
export class LayersPanel extends SidePanel {
  private readonly list: LayerList;
  private readonly controls: LayerControls;
  private readonly bar: LayerBar;
  private readonly note: HTMLDivElement;
  private readonly byId = new Map<number, SculptLayer>();
  /** Everything of the sculpt layers, which the Paint workspace puts away for its own. */
  private readonly sculptEl: HTMLDivElement;
  /** The paint layers (PaintLayersView), shown in the Paint workspace in place of the sculpt layers. */
  private paintViewMade: PaintLayersView | null = null;
  private paintOn = false;

  /** A layer edit that the autosave and the display must hear of. */
  onEdit: (() => void) | null = null;

  constructor(private readonly session: SculptSession) {
    super({ id: 'layers', title: 'Layers', side: 'left', variant: 'panel--layers' });

    this.sculptEl = div('layers-sculpt');
    this.body.append(this.sculptEl);

    this.note = dynamicNote(session, 'Layers need dynamic topology off.', () => this.onEdit?.());
    this.sculptEl.append(this.note);

    // The weight of the ACTIVE layer or group, as Photoshop has its opacity at the top of the panel.
    this.controls = new LayerControls({
      caption: 'Weight',
      limit: WEIGHT_LIMIT,
      floor: -WEIGHT_LIMIT,
      change: (w, phase) => {
        const mesh = this.session.getMesh();
        const layer = this.session.layers.active(mesh);
        if (mesh && layer) this.session.layers.setWeight(mesh, layer, w, phase);
      },
    });
    this.sculptEl.append(this.controls.el);

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
        toggleOpen: (id) => {
          const layer = this.byId.get(id as number);
          if (layer) this.session.layers.setOpen(layer, !layer.open);
        },
        drop: (id, onto, place) => {
          const mesh = this.session.getMesh();
          const layer = this.byId.get(id as number);
          const target = this.byId.get(onto as number);
          if (!mesh || !layer || !target || layer === target) return;
          const r = resolveDrop(this.session.layers.rawList(mesh), layer, target, place);
          this.session.layers.move(mesh, layer, r.parent, r.index);
          this.onEdit?.();
        },
        baseMenu: () => [{ label: 'Flatten all', action: () => this.act((m) => this.session.layers.flattenAll(m)) }],
        menu: (id) => this.menuFor(this.byId.get(id as number), id),
      },
      { baseName: 'Base' },
    );
    this.sculptEl.append(this.list.el);

    // Photoshop's order, left to right (a sculpt layer has no fill layer): mask, group, layer, delete.
    this.bar = new LayerBar([
      { id: 'mask', label: 'Add mask from the current mask', icon: 'fi-ss-customize-edit', action: () => this.withActive((m, l) => this.session.layers.maskFromWorking(m, l)) },
      { id: 'group', label: 'New group', icon: 'fi-ss-folder', action: () => this.add('group') },
      { id: 'layer', label: 'New layer', icon: 'fi-ss-layers', action: () => this.add('layer') },
      { id: 'delete', label: 'Delete', icon: 'fi-ss-trash', action: () => this.withActive((m, l) => void this.remove(m, l)) },
    ]);
    this.sculptEl.append(this.bar.el);

    this.refresh();
  }

  /** The row menu of a layer or a group. */
  private menuFor(layer: SculptLayer | undefined, id: number | string): RowMenuItem[] {
    if (!layer) return [];
    const L = this.session.layers;
    const items: RowMenuItem[] = [
      { label: 'Rename', action: () => this.list.startRename(id) },
      { label: 'Duplicate', action: () => this.act((m) => L.duplicate(m, layer)) },
    ];
    if (layer.kind === 'group') items.push({ label: 'Ungroup', action: () => this.act((m) => L.ungroup(m, layer)) });
    else items.push({ label: 'Group', disabled: !!layer.parent, action: () => this.act((m) => L.group(m, layer)) });
    items.push({ label: 'Flatten into base', action: () => this.act((m) => L.flatten(m, layer)) });
    if (layer.mask) {
      items.push({ label: 'Load mask', action: () => this.act((m) => L.loadMask(m, layer)) });
      items.push({ label: 'Replace mask from the current mask', action: () => this.act((m) => L.maskFromWorking(m, layer)) });
      items.push({ label: 'Invert mask', action: () => this.act((m) => L.invertMask(m, layer)) });
      items.push({ label: layer.maskOn ? 'Disable mask' : 'Enable mask', action: () => this.act((m) => L.setMaskOn(m, layer, !layer.maskOn)) });
      items.push({ label: 'Remove mask', action: () => this.act((m) => L.removeMask(m, layer)) });
    } else {
      items.push({ label: 'Add mask from the current mask', action: () => this.act((m) => L.maskFromWorking(m, layer)) });
    }
    items.push({ label: 'Delete', className: 'file-menu__item--danger', action: () => this.act((m) => void this.remove(m, layer)) });
    return items;
  }

  private act(fn: (mesh: SculptMesh) => unknown): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    fn(mesh);
    this.session.render();
    this.onEdit?.();
  }

  private withActive(fn: (mesh: SculptMesh, layer: SculptLayer) => void): void {
    const mesh = this.session.getMesh();
    const layer = this.session.layers.active(mesh);
    if (!mesh || !layer) return;
    fn(mesh, layer);
    this.session.render();
    this.onEdit?.();
  }

  /** Delete: a group takes its layers with it, and says how many. */
  private async remove(mesh: SculptMesh, layer: SculptLayer): Promise<void> {
    const count = this.session.layers.weightOf(mesh, layer) - 1;
    if (layer.kind === 'group' && count > 0) {
      const yes = await askWindow({
        title: `Delete the group "${layer.name}"?`,
        text: `Its ${count} ${count === 1 ? 'layer goes' : 'layers go'} with it, and their effect leaves the surface. Undo brings them back.`,
        yes: 'Delete',
        danger: true,
      });
      if (!yes) return;
    }
    this.session.layers.remove(mesh, layer);
    this.session.render();
    this.onEdit?.();
  }

  private add(kind: 'layer' | 'group'): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    const L = this.session.layers;
    if (!(kind === 'group' ? L.addGroup(mesh) : L.add(mesh))) {
      failNotice(mesh.isDynamic ? 'Layers need dynamic topology off.' : `An object has at most ${MAX_LAYERS} layers.`);
      return;
    }
    this.onEdit?.();
  }

  /** The paint layers' view, made the first time Paint is entered (Sculpt's tab has nothing of it). */
  get paintView(): PaintLayersView {
    if (!this.paintViewMade) {
      const v = new PaintLayersView(this.session);
      v.onEdit = () => this.onEdit?.();
      this.body.append(v.el);
      this.paintViewMade = v;
    }
    return this.paintViewMade;
  }

  /** In the Paint workspace the tab shows the paint layers; in Sculpt, the sculpt layers. */
  setPaint(on: boolean): void {
    this.paintOn = on;
    this.sculptEl.hidden = on;
    if (on || this.paintViewMade) this.paintView.el.hidden = !on;
    this.refresh();
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
    const raw = layers.rawList(mesh);
    this.byId.clear();
    for (const l of raw) this.byId.set(l.id, l);
    const rows: LayerRowData[] = displayRows(raw, (g) => g.open).map(({ item: l, depth }) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      value: l.weight === 1 ? '' : `${Math.round(l.weight * 100)}%`,
      depth,
      kind: l.kind,
      open: l.kind === 'group' ? l.open : undefined,
      mask: l.mask ? (l.maskOn ? 'on' : 'off') : null,
    }));
    const active = layers.active(mesh);
    this.list.render(rows, active?.id ?? null);
    this.controls.set(active ? active.weight : null, null);
    const dynamic = !!mesh?.isDynamic;
    this.note.hidden = !dynamic;
    this.bar.set({ mask: !!active && !dynamic, group: !!mesh && !dynamic, layer: !!mesh && !dynamic, delete: !!active });
  }
}
