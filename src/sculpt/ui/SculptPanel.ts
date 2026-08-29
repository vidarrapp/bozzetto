import Enums from '@sculpt-vendor/misc/Enums';
import { div, labelRow, selectEl } from '../../ui/dom';
import { checkbox, compactRange, section } from '../../ui/Panel';
import { CURVE_OPTIONS, type CurveId } from '../bridge/dynamics';
import { ClayStripsBrush, VolumetricMove } from '../bridge/tools';
import type { InputShell } from '../bridge/InputShell';
import type { SculptSession } from '../bridge/SculptSession';
import type { Viewer } from '../../viewer/Viewer';

/**
 * The sculpt palette (WS4): a right-edge panel below the settings tab, in
 * the house panel markup. Sections: Brush (per-brush pressure dynamics +
 * the active tool's feel extras), Mask (darken, ops, extract), Detail
 * (dyntopo, voxel remesh), and the sculpt SSAO. Opening it collapses the
 * settings panel and vice versa (bozzetto:panel-open).
 */
export class SculptPanel {
  private readonly root: HTMLDivElement;
  private readonly handleArrow: HTMLSpanElement;
  private collapsed = true;
  private dynamicsBody!: HTMLDivElement;
  private extrasBody!: HTMLDivElement;
  private dyntopoCheckbox!: HTMLInputElement;
  private extractThickness = 1;
  private remeshResolution = 150;

  private readonly onOtherPanelOpen = (e: Event): void => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    if (id && id !== 'sculpt' && !this.collapsed) this.setCollapsed(true);
  };

  constructor(
    private readonly session: SculptSession,
    private readonly input: InputShell,
    private readonly viewer: Viewer,
  ) {
    this.root = div('panel panel--sculpt panel--collapsed');
    document.body.appendChild(this.root);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'panel__handle';
    const label = document.createElement('span');
    label.className = 'handle__label';
    label.textContent = 'Sculpt';
    this.handleArrow = document.createElement('span');
    this.handleArrow.className = 'handle__arrow';
    handle.append(label, this.handleArrow);
    handle.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.root.appendChild(handle);

    const header = div('panel__header');
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = 'Sculpt';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel__close';
    close.textContent = '›';
    close.addEventListener('click', () => this.setCollapsed(true));
    header.append(title, close);
    this.root.appendChild(header);

    const body = div('panel__body');
    this.root.appendChild(body);
    this.buildBrush(body);
    this.buildMask(body);
    this.buildDetail(body);
    this.buildShading(body);
    this.applyCollapsed();

    window.addEventListener('bozzetto:panel-open', this.onOtherPanelOpen);
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.applyCollapsed();
    if (!collapsed) {
      window.dispatchEvent(new CustomEvent('bozzetto:panel-open', { detail: { id: 'sculpt' } }));
    }
  }

  private applyCollapsed(): void {
    this.root.classList.toggle('panel--collapsed', this.collapsed);
    this.handleArrow.textContent = this.collapsed ? '‹' : '›';
  }

  // --- Brush: per-brush pressure dynamics + active-tool extras ------------

  private buildBrush(body: HTMLElement): void {
    const sec = section(body, 'Brush');
    this.dynamicsBody = div('sculpt-panel__dynamics');
    sec.appendChild(this.dynamicsBody);
    this.extrasBody = div('sculpt-panel__extras');
    sec.appendChild(this.extrasBody);
    this.refreshBrush();
  }

  /** Rebuild the per-brush rows for the ACTIVE tool (tool switches). */
  refreshBrush(): void {
    const tool = this.input.currentToolIndex();
    const d = this.input.dynamics.get(tool);
    const dyn = this.dynamicsBody;
    dyn.replaceChildren();
    dyn.appendChild(
      checkbox('Pen pressure size', d.sizeOn, (on) => {
        d.sizeOn = on;
      }),
    );
    dyn.appendChild(
      labelRow(
        'Size curve',
        this.curveSelect(d.sizeCurve, (c) => {
          d.sizeCurve = c;
        }),
      ),
    );
    dyn.appendChild(
      checkbox('Pen pressure intensity', d.strengthOn, (on) => {
        d.strengthOn = on;
      }),
    );
    dyn.appendChild(
      labelRow(
        'Intensity curve',
        this.curveSelect(d.strengthCurve, (c) => {
          d.strengthCurve = c;
        }),
      ),
    );

    const extras = this.extrasBody;
    extras.replaceChildren();
    const manager = this.session.getSculptManager();
    if (tool === Enums.Tools.MOVE) {
      const move = manager.getTool(tool) as unknown as VolumetricMove;
      extras.appendChild(
        compactRange('Falloff (soft-sharp)', 0.3, 1, 0.05, move.falloffPow, (v) => {
          move.falloffPow = v;
        }),
      );
    } else if (tool === Enums.Tools.BRUSH) {
      const strips = manager.getTool(tool) as unknown as ClayStripsBrush;
      extras.appendChild(
        compactRange('Strip plateau', 0, 0.8, 0.05, strips.plateau, (v) => {
          strips.plateau = v;
        }),
      );
      extras.appendChild(
        compactRange('Strip layer', 0.05, 0.5, 0.05, strips.layer, (v) => {
          strips.layer = v;
        }),
      );
    }
  }

  private curveSelect(value: CurveId, onChange: (c: CurveId) => void): HTMLSelectElement {
    const sel = selectEl(CURVE_OPTIONS, value);
    sel.addEventListener('change', () => onChange(sel.value as CurveId));
    return sel;
  }

  // --- Mask ---------------------------------------------------------------

  private buildMask(body: HTMLElement): void {
    const sec = section(body, 'Mask');
    sec.appendChild(
      compactRange('Darken', 0.05, 1, 0.05, this.viewer.materials.getMaskDarken(), (v) =>
        this.viewer.materials.setMaskDarken(v),
      ),
    );
    const ops = div('sculpt-panel__row');
    const masking = () => this.session.getSculptManager().getTool(Enums.Tools.MASKING);
    ops.append(
      this.opButton('Blur', () => masking().blur?.()),
      this.opButton('Sharpen', () => masking().sharpen?.()),
      this.opButton('Invert', () => masking().invert?.()),
      this.opButton('Clear', () => masking().clear?.()),
    );
    sec.appendChild(ops);

    sec.appendChild(
      compactRange('Extract thickness', 0, 6, 0.1, this.extractThickness, (v) => {
        this.extractThickness = v;
      }),
    );
    const extractRow = div('sculpt-panel__row');
    extractRow.appendChild(
      this.opButton('Extract masked', () => {
        this.session.extractMasked(this.extractThickness);
      }),
    );
    sec.appendChild(extractRow);
  }

  // --- Detail (dyntopo + voxel remesh) ------------------------------------

  private buildDetail(body: HTMLElement): void {
    const sec = section(body, 'Detail');
    const dyn = checkbox('Dynamic topology', this.session.isDynamicTopology(), () => {
      this.session.toggleDynamicTopology();
      this.refreshState();
    });
    this.dyntopoCheckbox = dyn.querySelector('input') as HTMLInputElement;
    sec.appendChild(dyn);
    const detail = this.session.getDynTopoDetail();
    sec.appendChild(
      compactRange('Subdivision', 0, 100, 1, detail.subdivision, (v) =>
        this.session.setDynTopoDetail({ subdivision: v }),
      ),
    );
    sec.appendChild(
      compactRange('Decimation', 0, 100, 1, detail.decimation, (v) =>
        this.session.setDynTopoDetail({ decimation: v }),
      ),
    );
    sec.appendChild(
      compactRange('Remesh resolution', 16, 300, 2, this.remeshResolution, (v) => {
        this.remeshResolution = v;
      }),
    );
    const row = div('sculpt-panel__row');
    row.appendChild(
      this.opButton('Voxel remesh', () => {
        this.session.voxelRemesh(this.remeshResolution);
      }),
    );
    sec.appendChild(row);
  }

  // --- Sculpt shading (the depth SSAO) ------------------------------------

  private buildShading(body: HTMLElement): void {
    const sec = section(body, 'Cavity (SSAO)');
    const ao = this.viewer.getSculptAO();
    sec.appendChild(
      compactRange('Strength', 0, 2, 0.05, ao.strength, (v) =>
        this.viewer.setSculptAO({ strength: v }),
      ),
    );
    sec.appendChild(
      compactRange('Radius', 2, 24, 1, ao.radius, (v) => this.viewer.setSculptAO({ radius: v })),
    );
  }

  /** Re-sync stateful controls after engine-side changes (undo, dyntopo). */
  refreshState(): void {
    this.dyntopoCheckbox.checked = this.session.isDynamicTopology();
  }

  private opButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sculpt-panel__btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  dispose(): void {
    window.removeEventListener('bozzetto:panel-open', this.onOtherPanelOpen);
    this.root.remove();
  }
}
