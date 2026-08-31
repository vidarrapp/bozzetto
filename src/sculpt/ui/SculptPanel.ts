import Enums from '@sculpt-vendor/misc/Enums';
import { div, labelRow, selectEl } from '../../ui/dom';
import { checkbox, compactRange, section } from '../../ui/Panel';
import { colorPicker, type ColorPickerHandle } from '../../ui/ColorPicker';
import { CURVE_OPTIONS, type CurveId } from '../bridge/dynamics';
import { ClayStripsBrush, VolumetricMove } from '../bridge/tools';
import type { InputShell } from '../bridge/InputShell';
import type { SculptSession } from '../bridge/SculptSession';
import type { Viewer } from '../../viewer/Viewer';
import { SidePanel } from './SidePanel';

/** Matches the left rail's range so the two controls agree end to end. */
const RADIUS_MIN = 5;
const RADIUS_MAX = 500;

/**
 * The sculpt palette (WS4/WS5): the lower-right docked panel - everything
 * about HOW you sculpt. Sections: Brush (per-brush pressure dynamics + the
 * active tool's feel extras), Symmetry, Mask (darken, ops, extract), Topology
 * (dyntopo, voxel remesh). Getting work in and out
 * (files, capture, publishing) lives in the left File panel, and the object
 * list in Scene. Opening this collapses the Render panel above it, since
 * they share the right edge (see SidePanel's side-scoped protocol).
 */
export class SculptPanel extends SidePanel {
  private dynamicsBody!: HTMLDivElement;
  private paintPicker?: ColorPickerHandle;
  private extrasBody!: HTMLDivElement;
  private dyntopoCheckbox!: HTMLInputElement;
  private symCheckbox!: HTMLInputElement;
  private axisButtons: HTMLButtonElement[] = [];
  private sizeInput?: HTMLInputElement;
  private strengthInput?: HTMLInputElement;
  private extractThickness = 1;
  private remeshResolution = 150;

  constructor(
    private readonly session: SculptSession,
    private readonly input: InputShell,
    private readonly viewer: Viewer,
  ) {
    super({ id: 'sculpt', title: 'Sculpt', side: 'right', variant: 'panel--sculpt' });
    this.buildBrush(this.body);
    this.buildSymmetry(this.body);
    this.buildMask(this.body);
    this.buildDetail(this.body);
  }

  // --- Brush: per-brush pressure dynamics + active-tool extras ------------

  private buildBrush(body: HTMLElement): void {
    const sec = section(body, 'Brush');

    // Screen scale is upstream's behaviour: the brush is a fixed number of
    // pixels, so it covers less of the model up close and more far away.
    // World scale pins it to the mesh instead, so a size means the same
    // thing wherever the camera is.
    const ws = this.input.worldScale;
    if (ws) {
      sec.appendChild(
        checkbox('World-scale size', ws.isEnabled(), (on) => {
          ws.setEnabled(on);
          this.input.refreshBrushCursor();
          this.refreshBrushValues();
        }),
      );
    }
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
    // The old inputs are detached by replaceChildren; drop the handles too,
    // or refreshBrushValues writes into orphans (and, for a tool with no
    // strength at all, into nothing).
    this.sizeInput = undefined;
    this.strengthInput = undefined;
    // The paint brush leads with its colour: the same HSV picker the Render
    // panel uses for albedo, so a colour is chosen the same way wherever
    // you are. Alt + click on the model samples one off the surface.
    this.paintPicker?.dispose();
    this.paintPicker = undefined;
    if (this.input.isPainting()) {
      this.paintPicker = colorPicker(this.input.getPaintColor(), (hex) =>
        this.input.setPaintColor(hex),
      );
      dyn.appendChild(labelRow('Colour', this.paintPicker.root));
      const hint = div('sculpt-panel__hint muted');
      hint.textContent = 'Alt + click picks a colour off the model';
      dyn.appendChild(hint);
    }
    // Radius and strength are per-tool in the vendored core, so these are
    // rebuilt with the rest of the row set when the brush changes, and
    // re-synced by refreshBrushValues when the rail or a hotkey moves them.
    if (this.input.hasBrushRadius()) {
      const sizeRow = compactRange(
        'Size',
        RADIUS_MIN,
        RADIUS_MAX,
        1,
        this.input.getBrushRadius(),
        (v) => this.input.setBrushRadius(v),
      );
      this.sizeInput = sizeRow.querySelector('input') as HTMLInputElement;
      dyn.appendChild(sizeRow);
    }
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
    // Drag and Twist have no strength at all; a slider for it would be a lie.
    if (this.input.hasBrushIntensity()) {
      const strengthRow = compactRange(
        'Strength',
        0,
        1,
        0.01,
        this.input.getBrushIntensity(),
        (v) => this.input.setBrushIntensity(v),
      );
      this.strengthInput = strengthRow.querySelector('input') as HTMLInputElement;
      dyn.appendChild(strengthRow);
    }
    dyn.appendChild(
      checkbox('Pen pressure strength', d.strengthOn, (on) => {
        d.strengthOn = on;
      }),
    );
    dyn.appendChild(
      labelRow(
        'Strength curve',
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

  // --- Symmetry -----------------------------------------------------------

  private buildSymmetry(body: HTMLElement): void {
    const sec = section(body, 'Symmetry');
    const box = checkbox('Mirror sculpting (x)', this.session.getSymmetry(), () =>
      this.session.toggleSymmetry(),
    );
    this.symCheckbox = box.querySelector('input') as HTMLInputElement;
    sec.appendChild(box);
    // The X key toggles the same flag; keep the checkbox honest.
    this.session.onSymmetryChange = (on) => {
      this.symCheckbox.checked = on;
    };

    const axes = div('sculpt-panel__row');
    this.axisButtons = (['x', 'y', 'z'] as const).map((axis) => {
      const b = this.opButton(axis.toUpperCase(), () => {
        this.session.setSymmetryAxis(axis);
        this.paintAxis();
      });
      b.dataset.axis = axis;
      axes.appendChild(b);
      return b;
    });
    sec.appendChild(axes);
    this.paintAxis();
  }

  /** Highlight the active mesh's mirror axis (per-object state). */
  private paintAxis(): void {
    const axis = this.session.getSymmetryAxis();
    for (const b of this.axisButtons) {
      b.classList.toggle('sculpt-panel__btn--on', b.dataset.axis === axis);
    }
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

  // --- Topology (dyntopo + voxel remesh) ----------------------------------

  private buildDetail(body: HTMLElement): void {
    const sec = section(body, 'Topology');
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

  /** Follow radius/strength changes made anywhere else (rail, keys, drags). */
  refreshBrushValues(): void {
    if (this.sizeInput) this.sizeInput.value = String(Math.round(this.input.getBrushRadius()));
    if (this.strengthInput) {
      this.strengthInput.value = this.input.getBrushIntensity().toFixed(2);
    }
  }

  /** The Extract thickness the ctrl+e hotkey should use. */
  getExtractThickness(): number {
    return this.extractThickness;
  }

  /** Re-sync stateful controls after engine-side changes (undo, dyntopo). */
  refreshState(): void {
    this.dyntopoCheckbox.checked = this.session.isDynamicTopology();
    this.symCheckbox.checked = this.session.getSymmetry();
    this.paintAxis();
  }

  private opButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sculpt-panel__btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  override dispose(): void {
    this.session.onSymmetryChange = null;
    super.dispose();
  }
}
