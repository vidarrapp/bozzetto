import { div } from '../../ui/dom';
import { LayerBar, LayerControls, LayerList, type LayerRowData } from '../../ui/layerList';
import { BLEND_MODES, blendModeById, blendSelect } from '../../ui/blendModes';
import { isBlendId } from '../../paint/blend';
import { displayRows, resolveDrop } from '../../ui/layerTree';
import { askWindow } from '../../ui/askWindow';
import { MAX_PAINT_LAYERS, type PaintLayer } from '../bridge/paintLayers';
import type { SculptSession } from '../bridge/SculptSession';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import { failNotice } from './statusToast';

const hexOf = (rgb: [number, number, number]): string =>
  `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * The paint layers' half of the Layers tab (Paint workspace), as Photoshop's
 * panel has it: above the list the blend mode and the Opacity of the ACTIVE
 * layer or group (a group's modes start with Pass through), then the list, one
 * row a layer with groups folding over their layers, and at the foot a bar of
 * icons: Add mask, New fill layer, New group, New layer and Delete. Clear and
 * Flatten all are the Base row's menu. The list is the shared component
 * (src/ui/layerList.ts); this is what turns its taps into session commands.
 */
export class PaintLayersView {
  readonly el: HTMLDivElement;
  private readonly list: LayerList;
  private readonly controls: LayerControls;
  private readonly mode: HTMLSelectElement;
  private readonly bar: LayerBar;
  private readonly note: HTMLDivElement;
  private readonly byId = new Map<number, PaintLayer>();

  /** A layer edit that the autosave and the display must hear of. */
  onEdit: (() => void) | null = null;

  constructor(private readonly session: SculptSession) {
    this.el = div('layers-paint');
    this.note = div('layers-note');
    this.note.hidden = true;
    this.el.append(this.note);

    // The blend mode and the opacity of the ACTIVE layer, as Photoshop has them at the top of its panel.
    this.mode = blendSelect(BLEND_MODES, 'normal', [['pass', 'Pass through']]);
    this.mode.setAttribute('aria-label', 'Blend mode of the active layer');
    this.mode.addEventListener('change', () => {
      const mesh = this.session.getMesh();
      const layer = this.session.paint.active(mesh);
      if (!mesh || !layer) return;
      if (this.mode.value === 'pass' || isBlendId(this.mode.value)) this.session.paint.setMode(mesh, layer, this.mode.value as never);
    });
    this.controls = new LayerControls({
      caption: 'Opacity',
      limit: 1,
      floor: 0,
      before: this.mode,
      change: (v, phase) => {
        const mesh = this.session.getMesh();
        const layer = this.session.paint.active(mesh);
        if (mesh && layer) this.session.paint.setOpacity(mesh, layer, v, phase);
      },
    });
    this.el.append(this.controls.el);

    this.list = new LayerList(
      {
        select: (id) => {
          const mesh = this.session.getMesh();
          if (!mesh) return;
          this.session.paint.setActive(mesh, id === null ? null : (this.byId.get(id as number) ?? null));
        },
        visible: (id, visible) => {
          const mesh = this.session.getMesh();
          const layer = this.byId.get(id as number);
          if (mesh && layer) this.session.paint.setVisible(mesh, layer, visible);
        },
        rename: (id, name) => {
          const layer = this.byId.get(id as number);
          if (layer) this.session.paint.rename(layer, name);
          this.refresh();
        },
        toggleOpen: (id) => {
          const layer = this.byId.get(id as number);
          if (layer) this.session.paint.setOpen(layer, !layer.open);
        },
        swatch: (id, hex, phase) => {
          const mesh = this.session.getMesh();
          const layer = this.byId.get(id as number);
          if (!mesh || !layer) return;
          this.session.paint.setFill(mesh, layer, rgbOf(hex), phase);
          this.session.render();
          if (phase === 'commit') this.onEdit?.();
        },
        drop: (id, onto, place) => {
          const mesh = this.session.getMesh();
          const layer = this.byId.get(id as number);
          const target = this.byId.get(onto as number);
          if (!mesh || !layer || !target || layer === target) return;
          const list = this.session.paint.rawList(mesh);
          const r = resolveDrop(list, layer, target, place);
          this.session.paint.move(mesh, layer, r.parent, r.index);
          this.onEdit?.();
        },
        baseMenu: () => [
          { label: 'Clear', action: () => this.act((m) => this.session.paint.clearBase(m)) },
          { label: 'Flatten all', action: () => this.act((m) => this.session.paint.flattenAll(m)) },
        ],
        menu: (id) => this.menuFor(this.byId.get(id as number), id),
      },
      { baseName: 'Base' },
    );
    this.el.append(this.list.el);

    // Photoshop's order, left to right: mask, fill layer, group, layer, delete.
    this.bar = new LayerBar([
      { id: 'mask', label: 'Add mask from the current mask', icon: 'fi-ss-customize-edit', action: () => this.withActive((m, l) => this.session.paint.maskFromWorking(m, l)) },
      { id: 'fill', label: 'New fill layer', icon: 'fi-ss-fill', action: () => this.add('fill') },
      { id: 'group', label: 'New group', icon: 'fi-ss-folder', action: () => this.add('group') },
      { id: 'layer', label: 'New layer', icon: 'fi-ss-layers', action: () => this.add('layer') },
      { id: 'delete', label: 'Delete', icon: 'fi-ss-trash', action: () => this.withActive((m, l) => void this.remove(m, l)) },
    ]);
    this.el.append(this.bar.el);
    this.refresh();
  }

  /** The row menu of a layer or a group. */
  private menuFor(layer: PaintLayer | undefined, id: number | string) {
    if (!layer) return [];
    const paint = this.session.paint;
    const mesh = this.session.getMesh();
    const items = [
      { label: 'Rename', action: () => this.list.startRename(id) },
      { label: 'Duplicate', action: () => this.act((m) => paint.duplicate(m, layer)) },
    ];
    if (layer.kind === 'group') {
      items.push({ label: 'Ungroup', action: () => this.act((m) => paint.ungroup(m, layer)) });
      items.push({ label: 'Flatten', action: () => this.act((m) => paint.flattenGroup(m, layer)) });
    } else {
      items.push({ label: 'Group', action: () => this.act((m) => paint.group(m, layer)) });
      items.push({ label: 'Merge down', action: () => this.act((m) => paint.mergeDown(m, layer)) });
      if (layer.kind === 'fill') items.push({ label: 'Make paintable', action: () => this.act((m) => paint.makePaintable(m, layer)) });
      else items.push({ label: 'Clear', action: () => this.act((m) => paint.clear(m, layer)) });
    }
    const item = (label: string, action: () => void, extra: { className?: string; disabled?: boolean } = {}) => items.push({ label, action, ...extra });
    if (layer.kind !== 'group' && layer.parent) {
      // Nothing to join into at the foot of a group.
    }
    if (layer.mask) {
      item('Load mask', () => this.act((m) => paint.loadMask(m, layer)));
      item('Replace mask from the current mask', () => this.act((m) => paint.maskFromWorking(m, layer)));
      item('Invert mask', () => this.act((m) => paint.invertMask(m, layer)));
      item(layer.maskOn ? 'Disable mask' : 'Enable mask', () => this.act((m) => paint.setMaskOn(m, layer, !layer.maskOn)));
      item('Remove mask', () => this.act((m) => paint.removeMask(m, layer)));
    } else {
      item('Add mask from the current mask', () => this.act((m) => paint.maskFromWorking(m, layer)));
    }
    item('Delete', () => this.act((m) => void this.remove(m, layer)), { className: 'file-menu__item--danger' });
    void mesh;
    // A group cannot go in a group; merge down needs a layer under it.
    return items.map((it) => {
      if (it.label === 'Group' && layer.parent) return { ...it, disabled: true };
      if (it.label === 'Merge down' && mesh && !paint.canMergeDown(mesh, layer)) return { ...it, disabled: true };
      return it;
    });
  }

  private act(fn: (mesh: SculptMesh) => unknown): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    fn(mesh);
    this.session.render();
    this.onEdit?.();
  }

  private withActive(fn: (mesh: SculptMesh, layer: PaintLayer) => void): void {
    const mesh = this.session.getMesh();
    const layer = this.session.paint.active(mesh);
    if (!mesh || !layer) return;
    fn(mesh, layer);
    this.session.render();
    this.onEdit?.();
  }

  /** Delete: a group takes its layers with it, and says how many. */
  private async remove(mesh: SculptMesh, layer: PaintLayer): Promise<void> {
    const count = this.session.paint.weight(mesh, layer) - 1;
    if (layer.kind === 'group' && count > 0) {
      const yes = await askWindow({
        title: `Delete the group "${layer.name}"?`,
        text: `Its ${count} ${count === 1 ? 'layer goes' : 'layers go'} with it. Undo brings them back.`,
        yes: 'Delete',
        danger: true,
      });
      if (!yes) return;
    }
    this.session.paint.remove(mesh, layer);
    this.session.render();
    this.onEdit?.();
  }

  private add(kind: 'layer' | 'fill' | 'group'): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    const paint = this.session.paint;
    const made = kind === 'fill' ? paint.addFill(mesh) : kind === 'group' ? paint.addGroup(mesh) : paint.add(mesh);
    if (!made) {
      failNotice(mesh.isDynamic ? 'Paint layers need dynamic topology off.' : `An object has at most ${MAX_PAINT_LAYERS} layers.`);
      return;
    }
    this.onEdit?.();
  }

  /** Redraw from the session: the active object's paint layers. */
  refresh(): void {
    if (this.list.isEditing()) return;
    const mesh = this.session.getMesh();
    const paint = this.session.paint;
    const raw = mesh ? paint.rawList(mesh) : [];
    this.byId.clear();
    for (const l of raw) this.byId.set(l.id, l);
    const rows: LayerRowData[] = displayRows(raw, (g) => g.open).map(({ item: l, depth }) => {
      const label = l.mode === 'normal' || l.mode === 'pass' ? '' : (blendModeById(l.mode)?.label ?? l.mode);
      const parts = [label, l.opacity < 1 ? `${Math.round(l.opacity * 100)}%` : ''];
      return {
        id: l.id,
        name: l.name,
        visible: l.visible,
        value: parts.filter(Boolean).join(' '),
        depth,
        kind: l.kind,
        open: l.kind === 'group' ? l.open : undefined,
        mask: l.mask ? (l.maskOn ? 'on' : 'off') : null,
        swatch: l.fill ? hexOf(l.fill) : undefined,
      };
    });
    const active = paint.active(mesh);
    this.list.render(rows, active?.id ?? null);
    this.controls.set(active ? active.opacity : null, active ? active.mode : null);
    // Pass through is a group's: a layer's select does not offer it.
    for (const o of this.mode.options) if (o.value === 'pass') o.disabled = active?.kind !== 'group';
    const dynamic = !!mesh?.isDynamic;
    this.note.hidden = !dynamic;
    this.note.textContent = dynamic ? 'Paint layers need dynamic topology off.' : '';
    this.bar.set({
      mask: !!active && !dynamic,
      fill: !!mesh && !dynamic,
      group: !!mesh && !dynamic,
      layer: !!mesh && !dynamic,
      delete: !!active,
    });
  }
}
