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
  private topoBody?: HTMLDivElement;
  private dynDetailRows: Array<{ row: HTMLLabelElement; input: HTMLInputElement }> = [];

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
          this.input.onBrushSettingsChange?.();
      }),
    );
    dyn.appendChild(
      labelRow(
        'Size curve',
        this.curveSelect(d.sizeCurve, (c) => {
          d.sizeCurve = c;
          this.input.onBrushSettingsChange?.();
        }),
      ),
    );
    // Drag has no strength at all; a slider for it would be a lie.
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
          this.input.onBrushSettingsChange?.();
      }),
    );
    dyn.appendChild(
      labelRow(
        'Strength curve',
        this.curveSelect(d.strengthCurve, (c) => {
          d.strengthCurve = c;
          this.input.onBrushSettingsChange?.();
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
    const dyn = checkbox('Dynamic topology', this.session.isDynamicTopology(), (on) => {
      // Turning it ON replaces the mesh and flattens the multires stack, so
      // it asks first (turning it off is the way back and needs no gate).
      if (on) {
        const ok = confirm(
          'Dynamic topology rebuilds the surface under every stroke, and the ' +
            "subdivision levels are flattened to the current resolution. " +
            'Ctrl+Z undoes the switch. Continue?',
        );
        if (!ok) {
          this.dyntopoCheckbox.checked = false;
          return;
        }
      }
      this.session.toggleDynamicTopology();
      this.refreshState();
    });
    this.dyntopoCheckbox = dyn.querySelector('input') as HTMLInputElement;
    sec.appendChild(dyn);
    // Stroke-time detail: these two only act while dynamic topology is on
    // (they are its subdivision/decimation aggressiveness), so they follow
    // the checkbox and grey out with it. The old panel showed them bare,
    // and they read as dead controls.
    const detail = this.session.getDynTopoDetail();
    this.dynDetailRows = [
      this.numberedRange('Stroke subdivision', 0, 100, 1, detail.subdivision, (v) => {
        this.session.setDynTopoDetail({ subdivision: v });
        return String(Math.round(v));
      }),
      this.numberedRange('Stroke decimation', 0, 100, 1, detail.decimation, (v) => {
        this.session.setDynTopoDetail({ decimation: v });
        return String(Math.round(v));
      }),
    ];
    for (const r of this.dynDetailRows) sec.appendChild(r.row);

    // Multiresolution: the discrete level slider (with a live "sel/levels"
    // readout) and the four level operations. Rebuilt whenever the level
    // moves - steps, ctrl+d, undo - since the level count itself changes.
    this.topoBody = div('sculpt-panel__topo');
    sec.appendChild(this.topoBody);

    const remesh = section(body, 'Remesh');
    const res = this.numberedRange('Resolution', 16, 300, 2, this.remeshResolution, (v) => {
      this.remeshResolution = v;
      return String(Math.round(v));
    });
    remesh.appendChild(res.row);
    const row = div('sculpt-panel__row');
    row.appendChild(
      this.opButton('Voxel remesh', () => {
        this.session.voxelRemesh(this.remeshResolution);
      }),
    );
    remesh.appendChild(row);
    this.refreshTopology();
  }

  /** A compact slider with the current value printed at its right. */
  private numberedRange(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onInput: (v: number) => string,
  ): { row: HTMLLabelElement; input: HTMLInputElement; val: HTMLSpanElement } {
    const row = compactRange(label, min, max, step, value, (v) => {
      val.textContent = onInput(v);
    });
    const val = document.createElement('span');
    val.className = 'sculpt-panel__val';
    val.textContent = String(Math.round(value));
    row.appendChild(val);
    const input = row.querySelector('input') as HTMLInputElement;
    return { row, input, val };
  }

  /**
   * Rebuild the multiresolution block: level slider + Lower/Higher/
   * Subdivide/Rebuild. Levels exist only on static multimeshes; with
   * dynamic topology on the block explains itself instead.
   */
  refreshTopology(): void {
    if (!this.topoBody) return;
    const dynOn = this.session.isDynamicTopology();
    for (const r of this.dynDetailRows) {
      r.input.disabled = !dynOn;
      r.row.classList.toggle('sculpt-panel__row--off', !dynOn);
    }
    this.topoBody.replaceChildren();
    const lv = this.session.getLevels();
    if (!lv) {
      if (dynOn) {
        const hint = div('sculpt-panel__hint muted');
        hint.textContent = 'Subdivision levels return when dynamic topology is off.';
        this.topoBody.appendChild(hint);
      }
      return;
    }
    // Dragging previews the target level in the readout; the jump itself
    // lands on release ('change'). Applying per input step would rebuild
    // this block - and the slider under the pointer - mid-drag.
    const levels = this.numberedRange('Level', 1, Math.max(2, lv.levels), 1, lv.sel + 1, (v) => {
      return `${Math.round(v)}/${this.session.getLevels()?.levels ?? lv.levels}`;
    });
    levels.input.addEventListener('change', () => {
      this.session.selectLevel(Number(levels.input.value) - 1);
      this.refreshTopology(); // selectLevel may clamp or no-op; re-sync
    });
    levels.val.textContent = `${lv.sel + 1}/${lv.levels}`;
    // A single level still shows a slider (min 1 of max 2) but cannot move.
    levels.input.max = String(lv.levels);
    levels.input.disabled = lv.levels <= 1;
    this.topoBody.appendChild(levels.row);

    const ops = div('sculpt-panel__row');
    const lower = this.opButton('Lower', () => void this.session.stepSubdivision(-1));
    lower.disabled = lv.sel === 0;
    lower.title = 'Step down one subdivision level (shift+D)';
    const higher = this.opButton('Higher', () => void this.session.stepSubdivision(1));
    higher.disabled = lv.sel >= lv.levels - 1;
    higher.title = 'Step up one subdivision level (D)';
    const subdiv = this.opButton('Subdivide', () => void this.session.subdivide());
    subdiv.disabled = lv.sel !== lv.levels - 1;
    subdiv.title = 'Add a finer level above the top one (ctrl+D)';
    const rebuild = this.opButton('Rebuild', () => {
      if (!this.session.reverse()) {
        alert('This topology cannot be rebuilt into a lower level.');
      }
    });
    rebuild.disabled = lv.sel !== 0;
    rebuild.title = 'Rebuild a coarser level under the lowest one (reversion)';
    ops.append(lower, higher, subdiv, rebuild);
    this.topoBody.appendChild(ops);
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
    this.refreshTopology();
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
