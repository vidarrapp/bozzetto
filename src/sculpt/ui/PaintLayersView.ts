import { div } from '../../ui/dom';
import { LayerControls, LayerList, type LayerRowData } from '../../ui/layerList';
import { BLEND_MODES, blendModeById, blendSelect } from '../../ui/blendModes';
import { isBlendId } from '../../paint/blend';
import { MAX_PAINT_LAYERS, type PaintLayer } from '../bridge/paintLayers';
import type { SculptSession } from '../bridge/SculptSession';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import { failNotice } from './statusToast';

/**
 * The paint layers' half of the Layers tab (Paint workspace): the active
 * object's paint layers, newest on top, Base fixed at the bottom. A row has
 * an eye, the name, a handle to drag the row to another place (order matters
 * here), the blend mode and the opacity. Add layer above the list, Flatten
 * all below it. The list is the shared component (src/ui/layerList.ts);
 * this is what turns its taps into session commands, as LayersPanel does
 * for sculpt layers.
 */
export class PaintLayersView {
  readonly el: HTMLDivElement;
  private readonly list: LayerList;
  private readonly controls: LayerControls;
  private readonly mode: HTMLSelectElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly flattenBtn: HTMLButtonElement;
  private readonly note: HTMLDivElement;
  private readonly byId = new Map<number, PaintLayer>();

  /** A layer edit that the autosave and the display must hear of. */
  onEdit: (() => void) | null = null;

  constructor(private readonly session: SculptSession) {
    this.el = div('layers-paint');
    this.addBtn = document.createElement('button');
    this.addBtn.type = 'button';
    this.addBtn.className = 'outliner__btn outliner__btn--wide layers-foot__btn';
    this.addBtn.textContent = 'Add layer';
    this.addBtn.addEventListener('click', () => this.add());

    this.note = div('layers-note');
    this.note.hidden = true;
    this.el.append(this.note);

    // The blend mode and the opacity of the ACTIVE layer, as Photoshop has them at the top of its panel.
    this.mode = blendSelect(BLEND_MODES, 'normal');
    this.mode.setAttribute('aria-label', 'Blend mode of the active layer');
    this.mode.addEventListener('change', () => {
      const mesh = this.session.getMesh();
      const layer = this.session.paint.active(mesh);
      if (mesh && layer && isBlendId(this.mode.value)) this.session.paint.setMode(mesh, layer, this.mode.value);
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
        reorder: (id, to) => {
          const mesh = this.session.getMesh();
          const layer = this.byId.get(id as number);
          if (!mesh || !layer) return;
          // The list is drawn newest first; the model counts from the bottom.
          this.session.paint.reorder(mesh, layer, this.session.paint.count(mesh) - 1 - to);
          this.onEdit?.();
        },
        menu: (id) => {
          const layer = this.byId.get(id as number);
          return [
            { label: 'Rename', action: () => this.list.startRename(id) },
            { label: 'Duplicate', action: () => layer && this.act((m) => this.session.paint.duplicate(m, layer)) },
            { label: 'Merge down', action: () => layer && this.act((m) => this.session.paint.mergeDown(m, layer)) },
            { label: 'Clear', action: () => layer && this.act((m) => this.session.paint.clear(m, layer)) },
            {
              label: 'Delete',
              className: 'file-menu__item--danger',
              action: () => layer && this.act((m) => this.session.paint.remove(m, layer)),
            },
          ];
        },
      },
      { baseName: 'Base' },
    );
    this.el.append(this.list.el);

    const foot = div('outliner__header layers-foot');
    this.flattenBtn = document.createElement('button');
    this.flattenBtn.type = 'button';
    this.flattenBtn.className = 'outliner__btn outliner__btn--wide layers-foot__btn';
    this.flattenBtn.textContent = 'Flatten all';
    this.flattenBtn.title = 'Make every layer part of the object’s colour';
    this.flattenBtn.addEventListener('click', () => this.act((m) => this.session.paint.flattenAll(m)));
    foot.append(this.addBtn, this.flattenBtn);
    this.el.append(foot);
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
    if (!this.session.paint.add(mesh)) {
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
    const items = paint.list(mesh);
    this.byId.clear();
    const rows: LayerRowData[] = items.map((l) => {
      this.byId.set(l.id, l);
      const parts = [l.mode === 'normal' ? '' : (blendModeById(l.mode)?.label ?? l.mode), l.opacity < 1 ? `${Math.round(l.opacity * 100)}%` : ''];
      return { id: l.id, name: l.name, visible: l.visible, value: parts.filter(Boolean).join(' ') };
    });
    const active = paint.active(mesh);
    this.list.render(rows, active?.id ?? null);
    this.controls.set(active ? active.opacity : null, active ? active.mode : null);
    const dynamic = !!mesh?.isDynamic;
    this.addBtn.disabled = !mesh || dynamic;
    this.flattenBtn.disabled = items.length === 0;
    this.note.hidden = !dynamic;
    this.note.textContent = dynamic ? 'Paint layers need dynamic topology off.' : '';
  }
}
