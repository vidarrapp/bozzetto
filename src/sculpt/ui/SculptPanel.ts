import Enums from '@sculpt-vendor/misc/Enums';
import { div, labelRow, selectEl } from '../../ui/dom';
import { checkbox, compactRange, section } from '../../ui/Panel';
import { colorPicker, type ColorPickerHandle } from '../../ui/ColorPicker';
import { CURVE_OPTIONS, type CurveId } from '../bridge/dynamics';
import { alphaThumbUrl } from '../bridge/alphas';
import { ClayStripsBrush, CreaseBrush, PolishBrush, VolumetricMove } from '../bridge/tools';
import { TOOL_NAMES } from './SculptToolbar';
import type { InputShell } from '../bridge/InputShell';
import type { SculptSession } from '../bridge/SculptSession';
import type { Viewer } from '../../viewer/Viewer';
import { SidePanel } from './SidePanel';

/** Matches the left rail's range so the two controls agree end to end. */
const RADIUS_MIN = 5;
const RADIUS_MAX = 500;

/**
 * The Tool palette (WS4/WS5, renamed from Sculpt by owner call): everything
 * about HOW the active tool behaves. Sections: the tool-named brush block
 * (pressure dynamics + feel extras), Symmetry, Mask (darken, ops, extract).
 * Topology and Remesh moved to the Model panel - they are properties of the
 * OBJECT, not the tool. Files and capture live in the left File panel, the
 * object list in Scene. Opening this collapses the other right-edge panels
 * (see SidePanel's side-scoped protocol).
 */
export class SculptPanel extends SidePanel {
  private dynamicsBody!: HTMLDivElement;
  private paintPicker?: ColorPickerHandle;
  private extrasBody!: HTMLDivElement;
  private symCheckbox!: HTMLInputElement;
  private axisButtons: HTMLButtonElement[] = [];
  private sizeInput?: HTMLInputElement;
  private strengthInput?: HTMLInputElement;
  private extractThickness = 1;
  private brushHeading: HTMLHeadingElement | null = null;

  constructor(
    private readonly session: SculptSession,
    private readonly input: InputShell,
    private readonly viewer: Viewer,
  ) {
    super({ id: 'sculpt', title: 'Tool', side: 'right', variant: 'panel--sculpt' });
    // The paint popover is body-mounted; collapsing the panel must take it
    // along or it floats on with its swatch off-screen.
    this.onCollapsedChange = (collapsed) => {
      if (collapsed) this.paintPicker?.close();
    };
    this.buildBrush(this.body);
    this.buildSymmetry(this.body);
    this.buildMask(this.body);
  }

  // --- Brush: per-brush pressure dynamics + active-tool extras ------------

  private buildBrush(body: HTMLElement): void {
    // Named for the ACTIVE tool (owner call): "Brush" never said whose
    // settings these sliders drive; refreshBrush renames it per selection.
    const sec = section(body, 'Brush');
    this.brushHeading = sec.querySelector('h3');

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
    if (this.brushHeading) this.brushHeading.textContent = TOOL_NAMES[tool] ?? 'Brush';
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
    // The curve shapes the pressure response, so it means nothing while
    // its pressure checkbox is off - the row folds away with it (same
    // rule as the Render panel's lights/DoF/ground and dyntopo's sliders).
    const sizeCurveRow = labelRow(
      'Size curve',
      this.curveSelect(d.sizeCurve, (c) => {
        d.sizeCurve = c;
        this.input.onBrushSettingsChange?.();
      }),
    );
    sizeCurveRow.hidden = !d.sizeOn;
    dyn.appendChild(
      checkbox('Pen pressure size', d.sizeOn, (on) => {
        d.sizeOn = on;
        sizeCurveRow.hidden = !on;
        this.input.onBrushSettingsChange?.();
      }),
    );
    dyn.appendChild(sizeCurveRow);
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
    const strengthCurveRow = labelRow(
      'Strength curve',
      this.curveSelect(d.strengthCurve, (c) => {
        d.strengthCurve = c;
        this.input.onBrushSettingsChange?.();
      }),
    );
    strengthCurveRow.hidden = !d.strengthOn;
    dyn.appendChild(
      checkbox('Pen pressure strength', d.strengthOn, (on) => {
        d.strengthOn = on;
        strengthCurveRow.hidden = !on;
        this.input.onBrushSettingsChange?.();
      }),
    );
    dyn.appendChild(strengthCurveRow);

    // Dab spacing: how far the brush travels between stamps, as a fraction
    // of its radius. Upstream fixed this at 0.15 for every tool; it is the
    // difference between a clay ribbon and a row of separate dabs, and a
    // rake only combs at all when its stamps overlap.
    if (this.input.hasBrushSpacing()) {
      dyn.appendChild(
        compactRange('Spacing', 0.02, 0.6, 0.01, this.input.getBrushSpacing(), (v) =>
          this.input.setBrushSpacing(v),
        ),
      );
    }

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
    } else if (tool === Enums.Tools.CREASE) {
      // A crease is a pinch and a crest, and upstream hardcoded the
      // balance between them. Profile is the crest's exponent: 1 is a
      // broad trough, 5 upstream's crease, higher a knife line. Pinch is
      // the sideways gather - at 0 it carves a groove without drawing the
      // surface in, which is a different tool entirely.
      const crease = manager.getTool(tool) as unknown as CreaseBrush;
      extras.appendChild(
        compactRange('Profile (broad-sharp)', 1, 12, 0.5, crease.profile, (v) => {
          crease.profile = v;
        }),
      );
      extras.appendChild(
        compactRange('Pinch', 0, 2.5, 0.1, crease.pinch, (v) => {
          crease.pinch = v;
        }),
      );
    } else if (tool === Enums.Tools.TWIST) {
      // Polish lives in the old Twist slot. Plane lock is the flatten-vs-
      // follow trade: locked planarizes chatter hardest, loose rides
      // gentle curvature without flattening it (owner-tuned by feel).
      const polish = manager.getTool(tool) as unknown as PolishBrush;
      extras.appendChild(
        compactRange('Plane lock (follow-flatten)', 0, 0.95, 0.05, polish.planeLock, (v) => {
          polish.planeLock = v;
        }),
      );
    }

    // Brush stencils, for whichever tools declare a set: the rake, where
    // the stencil is the tool, and clay, where it is off until you reach
    // for it. Pictures rather than names - "bars" and "fine bars" mean
    // nothing next to seeing the tines.
    const alphaSet = this.input.alphaSetFor(tool);
    if (alphaSet) {
      const grid = div('matcap-grid matcap-grid--alpha');
      const current = this.input.getToolAlpha(tool);
      const swatch = (id: string | null, label: string): HTMLButtonElement => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'matcap-swatch matcap-swatch--square';
        if (id === current) btn.classList.add('matcap-swatch--on');
        btn.title = label;
        btn.setAttribute('aria-label', `Brush alpha ${label}`);
        if (id === null) {
          btn.classList.add('matcap-swatch--none');
        } else {
          const img = document.createElement('img');
          img.src = alphaThumbUrl(id);
          img.alt = '';
          img.draggable = false;
          btn.appendChild(img);
        }
        btn.addEventListener('click', () => {
          this.input.setToolAlpha(id, tool);
          this.refreshBrush();
        });
        return btn;
      };
      if (alphaSet.allowNone) grid.appendChild(swatch(null, 'None'));
      for (const alpha of alphaSet.alphas) grid.appendChild(swatch(alpha.id, alpha.label));
      extras.appendChild(labelRow('Alpha', grid));
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
