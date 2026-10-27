import Enums from '@sculpt-vendor/misc/Enums';
import { div, labelRow, onTap, selectEl } from '../../ui/dom';
import { checkbox, compactRange, section } from '../../ui/Panel';
import { setSliderValue, type Limits } from '../../ui/sliderEntry';
import { colorPicker, type ColorPickerHandle } from '../../ui/ColorPicker';
import { installSwatchPick } from '../../ui/swatchPick';
import { CURVE_OPTIONS, type CurveId } from '../bridge/dynamics';
import {
  ClayStripsBrush,
  CreaseBrush,
  PaintBrush,
  PolishBrush,
  RAKE_PRESETS,
  RAKE_TINES_MAX,
  RAKE_TINES_MIN,
  RakeBrush,
  SMOOTH_MODES,
  StableSmooth,
  VolumetricMove,
  type SmoothMode,
} from '../bridge/tools';
import type { ProfileCurve } from '../bridge/profile';
import { CurveEditor } from './CurveEditor';
import { TOOL_NAMES } from './SculptToolbar';
import type { InputShell } from '../bridge/InputShell';
import type { GizmoParts } from '../bridge/transform';
import type { SculptSession } from '../bridge/SculptSession';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { Viewer } from '../../viewer/Viewer';
import { SidePanel } from './SidePanel';
import { ChannelBox } from './ChannelBox';

/** Matches the left rail's range so the two controls agree end to end. */
const RADIUS_MIN = 5;
const RADIUS_MAX = 500;

/** Typed-value limits (sliderEntry): what each quantity can be, past the travel. */
const FRACTION: Limits = { min: 0, max: 1 }; // a strength, a pressure amount, a profile
const AMOUNT: Limits = { min: 0 };
/** A brush radius: a whole pixel at least, and as large as anyone types. */
const BRUSH_SIZE: Limits = { min: 1, integer: true };

/**
 * The Tool palette (WS4/WS5, renamed from Sculpt by owner call): everything
 * about HOW the active tool behaves. Sections: the tool-named brush block
 * (pressure dynamics + feel extras) and Symmetry. Topology, Remesh and Mask
 * moved to the Model panel - they act on the OBJECT, not on the tool. Files
 * live in the top row's File menu, Publish model in its Publish window, the
 * object list in Scene. Opening this collapses Render, the other
 * right-edge panel (see SidePanel's side-scoped protocol).
 */
export class SculptPanel extends SidePanel {
  private dynamicsBody!: HTMLDivElement;
  private paintPicker?: ColorPickerHandle;
  private extrasBody!: HTMLDivElement;
  private symCheckbox!: HTMLInputElement;
  private worldScaleBox: HTMLInputElement | null = null;
  private axisButtons: HTMLButtonElement[] = [];
  private sizeInput?: HTMLInputElement;
  private strengthInput?: HTMLInputElement;
  private brushHeading: HTMLHeadingElement | null = null;
  /** The transform's typed rows, up with the Select tool or the gizmo. */
  private channelBox: ChannelBox | null = null;

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
    this.buildShiftSmooth(this.body);
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
      const box = checkbox('World-scale size', ws.isEnabled(), (on) => {
        ws.setEnabled(on);
        this.input.refreshBrushCursor();
        // The Size row changes units with the scale: rebuilt.
        this.refreshBrush();
      });
      this.worldScaleBox = box.querySelector('input');
      sec.appendChild(box);
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
    const dyn = this.dynamicsBody;
    dyn.replaceChildren();
    this.paintPicker?.dispose();
    this.paintPicker = undefined;
    this.channelBox?.dispose();
    this.channelBox = null;
    this.sizeInput = undefined;
    this.strengthInput = undefined;
    // The two tools that are not brushes get their own settings here
    // (owner request): the Select tool its modifiers and mode, the
    // transform gizmo which of its handles to show.
    const uiMode = this.input.uiMode();
    // Symmetry is a brush setting: neither the Select tool nor the gizmo
    // mirrors anything (a mirrored selection is a maybe for later), so
    // the section shows for brushes only, with the active brush's values.
    if (this.symSection) this.symSection.hidden = uiMode !== 'brush';
    // Shift's Smooth settings ride every brush that Shift smooths from.
    this.fillShiftSmooth(uiMode === 'brush' ? tool : -1);
    if (uiMode === 'select') {
      if (this.brushHeading) this.brushHeading.textContent = 'Select';
      this.extrasBody.replaceChildren();
      this.buildChannelBox(dyn);
      this.buildSelectSettings(dyn);
      return;
    }
    if (uiMode === 'transform') {
      if (this.brushHeading) this.brushHeading.textContent = 'Transform';
      this.extrasBody.replaceChildren();
      this.buildChannelBox(dyn);
      this.buildTransformSettings(dyn);
      return;
    }
    this.refreshState();
    if (this.brushHeading) this.brushHeading.textContent = TOOL_NAMES[tool] ?? 'Brush';
    const d = this.input.dynamics.get(tool);
    // The paint brush leads with its colour: the same HSV picker the Render
    // panel uses for albedo, so a colour is chosen the same way wherever
    // you are. Alt + click on the model samples one off the surface.
    if (this.input.isPainting()) {
      this.paintPicker = colorPicker(this.input.getPaintColor(), (hex) =>
        this.input.setPaintColor(hex),
      );
      // The fill sits beside the swatch (owner call): the whole object in
      // this colour, in one undo step.
      const colourRow = div('sculpt-panel__inline');
      const fill = document.createElement('button');
      fill.type = 'button';
      fill.className = 'sculpt-panel__btn sculpt-panel__btn--icon';
      fill.title = 'Fill the object with this colour';
      fill.setAttribute('aria-label', 'Fill the object with the paint colour');
      const icon = document.createElement('i');
      icon.className = 'fi fi-ss-fill';
      icon.setAttribute('aria-hidden', 'true');
      fill.appendChild(icon);
      fill.addEventListener('click', () => this.input.fillPaint());
      colourRow.append(this.paintPicker.root, fill);
      dyn.appendChild(labelRow('Colour', colourRow));
      // Drag the swatch over the view to pick a colour off the frame, as
      // the Render panel's background and light swatches do.
      installSwatchPick(this.paintPicker, this.viewer, (hex) => this.input.setPaintColor(hex));
      const hint = div('sculpt-panel__hint muted');
      hint.textContent = 'Alt+click for color picker';
      dyn.appendChild(hint);
    }
    // Radius and strength are per tool (the vendored core keeps both, and
    // world scale a radius per brush), so these are rebuilt with the rest
    // of the row set when the brush changes, and re-synced by
    // refreshBrushValues when the rail or a hotkey moves them.
    if (this.input.hasBrushRadius()) {
      const sizeRow = compactRange(
        'Size',
        RADIUS_MIN,
        RADIUS_MAX,
        1,
        Math.round(this.input.getBrushRadius()),
        (v) => this.input.setBrushRadius(v),
        // Printed as the rail prints it: pixels, or centimetres in world
        // scale on real units (InputShell.brushSizeDisplay).
        { limits: BRUSH_SIZE, ...(this.input.brushSizeDisplay().scale !== 1 ? this.input.brushSizeDisplay() : {}) },
      );
      this.sizeInput = sizeRow.querySelector('input') as HTMLInputElement;
      dyn.appendChild(sizeRow);
    }
    // Pressure is an amount, not a switch (owner call): the bottom of the
    // slider is off, the top the full range. The curve shapes the response
    // and means nothing at zero, so its row folds away there (same rule as
    // the Render panel's lights/DoF/ground and dyntopo's sliders).
    const sizeCurveRow = labelRow(
      'Size curve',
      this.curveSelect(d.sizeCurve, (c) => {
        d.sizeCurve = c;
        this.input.onBrushSettingsChange?.();
      }),
    );
    sizeCurveRow.hidden = d.size <= 0;
    dyn.appendChild(
      compactRange(
        'Pressure: size',
        0,
        1,
        0.05,
        d.size,
        (v) => {
          d.size = v;
          sizeCurveRow.hidden = v <= 0;
          this.input.onBrushSettingsChange?.();
        },
        { limits: FRACTION },
      ),
    );
    dyn.appendChild(sizeCurveRow);
    // Drag has no strength at all: no slider for it, and no pressure to
    // drive it with either.
    if (this.input.hasBrushIntensity()) {
      const strengthRow = compactRange(
        'Strength',
        0,
        1,
        0.01,
        this.input.getBrushIntensity(),
        (v) => this.input.setBrushIntensity(v),
        { limits: FRACTION },
      );
      this.strengthInput = strengthRow.querySelector('input') as HTMLInputElement;
      dyn.appendChild(strengthRow);
      const strengthCurveRow = labelRow(
        'Strength curve',
        this.curveSelect(d.strengthCurve, (c) => {
          d.strengthCurve = c;
          this.input.onBrushSettingsChange?.();
        }),
      );
      strengthCurveRow.hidden = d.strength <= 0;
      dyn.appendChild(
        compactRange(
          'Pressure: strength',
          0,
          1,
          0.05,
          d.strength,
          (v) => {
            d.strength = v;
            strengthCurveRow.hidden = v <= 0;
            this.input.onBrushSettingsChange?.();
          },
          { limits: FRACTION },
        ),
      );
      dyn.appendChild(strengthCurveRow);
    }

    // Dab spacing: how far the brush travels between stamps, as a fraction
    // of its radius. Upstream fixed this at 0.15 for every tool; it is the
    // difference between a clay ribbon and a row of separate dabs, and a
    // rake only combs at all when its stamps overlap.
    if (this.input.hasBrushSpacing()) {
      dyn.appendChild(
        // Under 0.02 a stroke lays down so many dabs that it stalls.
        compactRange('Spacing', 0.02, 0.6, 0.01, this.input.getBrushSpacing(), (v) => this.input.setBrushSpacing(v), {
          limits: { min: 0.02 },
        }),
      );
    }

    const extras = this.extrasBody;
    extras.replaceChildren();
    const manager = this.session.getSculptManager();
    // Every profile slider reads sharp on the left and soft on the right
    // (owner call), whatever the number underneath runs.
    if (tool === Enums.Tools.MOVE) {
      // The quartic's power: a low power flattens the bell's top and
      // drops it at the rim (sharp), 1 is the plain gradual bell (soft).
      const move = manager.getTool(tool) as unknown as VolumetricMove;
      extras.appendChild(
        compactRange(
          'Falloff (sharp-soft)',
          0.3,
          1,
          0.05,
          move.falloffPow,
          (v) => {
            move.falloffPow = v;
          },
          { limits: { min: 0.05 } },
        ),
      );
    } else if (tool === Enums.Tools.BRUSH) {
      // The strip's falloff is a curve now (owner call): its Plateau preset
      // is the old plateau slider's 0.8, and the clay stencils went with it.
      const strips = manager.getTool(tool) as unknown as ClayStripsBrush;
      extras.appendChild(this.curveRow('Profile', 'Clay profile', strips.curve));
      extras.appendChild(
        compactRange(
          'Strip layer',
          0.01,
          0.5,
          0.01,
          strips.layer,
          (v) => {
            strips.layer = v;
          },
          { limits: AMOUNT },
        ),
      );
    } else if (tool === Enums.Tools.CREASE) {
      // A crease is a pinch and a crest, and upstream hardcoded the
      // balance between them. The crest is a curve (Sharp the knife line it
      // has always defaulted to, Soft a broad trough); Pinch is the
      // sideways gather; at 0 it carves a groove without drawing the
      // surface in, which is a different tool entirely.
      const crease = manager.getTool(tool) as unknown as CreaseBrush;
      extras.appendChild(this.curveRow('Profile', 'Crease profile', crease.curve));
      extras.appendChild(
        compactRange(
          'Pinch',
          0,
          2.5,
          0.1,
          crease.pinch,
          (v) => {
            crease.pinch = v;
          },
          { limits: AMOUNT },
        ),
      );
    } else if (tool === Enums.Tools.TWIST) {
      // Polish lives in the old Twist slot. Plane lock is the flatten-vs-
      // follow trade: locked planarizes chatter hardest, loose rides
      // gentle curvature without flattening it. The profile and build-up
      // shape how a stroke lays its polish down: a small plateau (the
      // Default curve) and a low build-up smooth the effect across the
      // stroke instead of stepping it (owner feedback).
      const polish = manager.getTool(tool) as unknown as PolishBrush;
      extras.appendChild(
        // The brush itself holds the lock under 0.95.
        compactRange(
          'Plane lock (follow-flatten)',
          0,
          0.95,
          0.05,
          polish.planeLock,
          (v) => {
            polish.planeLock = v;
          },
          { limits: { min: 0, max: 0.95 } },
        ),
      );
      extras.appendChild(this.curveRow('Profile', 'Polish profile', polish.curve));
      extras.appendChild(
        compactRange(
          'Build-up',
          0.2,
          2,
          0.1,
          polish.gain,
          (v) => {
            polish.gain = v;
          },
          { limits: AMOUNT },
        ),
      );
    } else if (tool === Enums.Tools.PAINT) {
      // The paint falloff, a curve in place of the vendor's hardness (its
      // Default preset is hardness 0.75). Shift's blur shares it.
      const paint = manager.getTool(tool) as unknown as PaintBrush;
      extras.appendChild(this.curveRow('Profile', 'Paint profile', paint.curve));
    } else if (tool === Enums.Tools.RAKE) {
      this.buildRake(extras, manager.getTool(tool) as unknown as RakeBrush);
    } else if (tool === Enums.Tools.SMOOTH) {
      const smooth = manager.getTool(tool) as unknown as StableSmooth;
      if (smooth instanceof StableSmooth) this.buildSmooth(extras, smooth);
    }
  }

  /**
   * Smooth's Mode (owner call, 2026-10-24): Average, the umbrella average
   * it always was (the default), or Surface, which fits the surface by
   * distance and evens the triangles with a light Relax, the row shown in
   * Surface only. Shift's smoothing from any brush uses the mode set here;
   * the same rows head every other brush's Smooth group (fillShiftSmooth).
   */
  private buildSmooth(extras: HTMLElement, smooth: StableSmooth, label = 'Smooth mode'): void {
    const mode = selectEl(SMOOTH_MODES, smooth.smoothMode);
    mode.setAttribute('aria-label', label);
    const relax = compactRange(
      'Relax',
      0,
      1,
      0.05,
      smooth.relax,
      (v) => {
        smooth.setSmooth({ relax: v });
        this.input.onBrushSettingsChange?.();
      },
      { limits: FRACTION },
    );
    relax.dataset.smooth = 'relax';
    relax.hidden = smooth.smoothMode !== 'surface';
    mode.addEventListener('change', () => {
      smooth.setSmooth({ mode: mode.value as SmoothMode });
      relax.hidden = smooth.smoothMode !== 'surface';
      this.input.onBrushSettingsChange?.();
    });
    extras.append(labelRow('Mode', mode), relax);
  }

  // --- Smooth (Shift): one shared setting for every brush ------------------

  private smoothSection: HTMLElement | null = null;
  private smoothBody: HTMLDivElement | null = null;
  private smoothStrengthInput?: HTMLInputElement;

  /**
   * The Smooth group (owner call, 2026-10-27): Smooth has no toolbar slot
   * or key since the Rake took 7 and is used through Shift from the brush
   * in hand, so its settings sit at the foot of every brush's Tool panel.
   * They are the Smooth tool's own values, one set for all brushes: a
   * change on Clay's panel shows on the Rake's.
   */
  private buildShiftSmooth(body: HTMLElement): void {
    const sec = section(body, 'Smooth (Shift)');
    sec.classList.add('sculpt-panel__shift-smooth');
    this.smoothSection = sec;
    this.smoothBody = div('sculpt-panel__shift-smooth-rows');
    sec.appendChild(this.smoothBody);
    this.fillShiftSmooth(this.input.uiMode() === 'brush' ? this.input.currentToolIndex() : -1);
  }

  /**
   * Whether Shift smooths from `tool` (InputShell's swap): every brush but
   * Paint, where Shift blurs the paint instead. Smooth itself has these
   * rows in its own settings, and Paint blur and Mask are not brushes the
   * toolbar offers (Mask is Ctrl's stand-in).
   */
  private static shiftSmooths(tool: number): boolean {
    const t = Enums.Tools;
    return tool >= 0 && tool !== t.PAINT && tool !== t.PAINT_BLUR && tool !== t.MASKING && tool !== t.SMOOTH;
  }

  /** Rebuild the Smooth group from the tool's values, or hide it (`tool` -1: not a brush). */
  private fillShiftSmooth(tool: number): void {
    const sec = this.smoothSection;
    const rows = this.smoothBody;
    if (!sec || !rows) return; // the first refreshBrush runs before the group exists
    rows.replaceChildren();
    this.smoothStrengthInput = undefined;
    const smooth = this.session.getSculptManager().getTool(Enums.Tools.SMOOTH) as unknown as StableSmooth | undefined;
    sec.hidden = !SculptPanel.shiftSmooths(tool) || !(smooth instanceof StableSmooth);
    if (sec.hidden || !(smooth instanceof StableSmooth)) return;
    const strength = compactRange(
      'Strength',
      0,
      1,
      0.01,
      Number(smooth._intensity.toFixed(2)),
      (v) => {
        smooth.setSmooth({ strength: v });
        this.input.onBrushSettingsChange?.();
      },
      { limits: FRACTION },
    );
    strength.dataset.smooth = 'strength';
    this.smoothStrengthInput = strength.querySelector('input') as HTMLInputElement;
    rows.appendChild(strength);
    this.buildSmooth(rows, smooth, 'Shift smooth mode');
  }

  /** A profile curve's editor under its caption; an edit schedules the autosave. */
  private curveRow(caption: string, label: string, curve: ProfileCurve): HTMLDivElement {
    const row = div('sculpt-panel__curve');
    const head = div('sculpt-panel__curve-label');
    head.textContent = caption;
    const editor = new CurveEditor(curve, { label, onCommit: () => this.input.onBrushSettingsChange?.() });
    row.append(head, editor.root);
    return row;
  }

  /**
   * The tine rake's rows: its presets, the tine count and width, the
   * depth, the Scrape (how flat each dab planes the footprint before the
   * tines cut), the taper, Invert, and
   * the tine's own profile. A preset sets them all; any of them can move
   * after.
   */
  private buildRake(extras: HTMLElement, rake: RakeBrush): void {
    const changed = (): void => {
      for (const b of presets.querySelectorAll<HTMLButtonElement>('button')) {
        b.classList.toggle('sculpt-panel__btn--on', b.dataset.preset === rake.presetId);
      }
      this.input.onBrushSettingsChange?.();
    };
    const presets = div('sculpt-panel__row sculpt-panel__presets');
    for (const p of RAKE_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sculpt-panel__btn';
      b.textContent = p.label;
      b.dataset.preset = p.id;
      b.setAttribute('aria-label', `Rake preset ${p.label}`);
      if (p.id === rake.presetId) b.classList.add('sculpt-panel__btn--on');
      onTap(b, () => {
        rake.applyPreset(p.id);
        this.input.onBrushSettingsChange?.();
        this.refreshBrush();
      });
      presets.appendChild(b);
    }
    extras.appendChild(presets);
    const knob = (label: string, min: number, max: number, step: number, value: number, set: (v: number) => void, limits: Limits): void => {
      extras.appendChild(
        compactRange(label, min, max, step, value, (v) => {
          set(v);
          changed();
        }, { limits }),
      );
    };
    knob('Tines', RAKE_TINES_MIN, RAKE_TINES_MAX, 1, rake.tines, (v) => rake.set({ tines: v }), { min: RAKE_TINES_MIN, max: RAKE_TINES_MAX, integer: true });
    knob('Tine width', 0.1, 1, 0.05, rake.tineWidth, (v) => rake.set({ width: v }), { min: 0.1, max: 1 });
    knob('Depth', 0, 0.3, 0.01, rake.depth, (v) => rake.set({ depth: v }), { min: 0, max: 1 });
    knob('Scrape', 0, 1, 0.05, rake.scrape, (v) => rake.set({ scrape: v }), FRACTION);
    knob('Taper', 0, 1, 0.05, rake.taper, (v) => rake.set({ taper: v }), FRACTION);
    extras.appendChild(
      checkbox('Invert (raise ridges)', rake.invert, (on) => {
        rake.set({ invert: on });
        changed();
      }),
    );
    extras.appendChild(this.curveRow('Tine profile', 'Tine profile', rake.curve));
  }

  /**
   * The channel box (ChannelBox), at the head of the Select tool's and the
   * gizmo's settings. It shows the active object and the rest of the
   * selection, and edits them on the gizmo's terms: hidden and locked
   * objects stay put, and an active one of those leaves the box read-only.
   */
  private buildChannelBox(body: HTMLElement): void {
    const session = this.session;
    const movable = (m: SculptMesh): boolean => m.isVisible() && !session.isLocked(m);
    this.channelBox = new ChannelBox({
      targets: () => {
        const active = session.getMesh();
        if (!active) return [];
        if (!movable(active)) return [active];
        return [active, ...session.getSelectedMeshes().filter((m) => m !== active && movable(m))];
      },
      editable: () => {
        const active = session.getMesh();
        return !!active && movable(active);
      },
      units: () => session.getUnits(),
      commit: (entries) => this.input.transform?.applyMatrices(entries),
    });
    body.appendChild(this.channelBox.el);
  }

  /**
   * Once a frame from the mode's tick: the channel box follows the
   * objects, whatever moved them. Nothing to do while it cannot be seen.
   */
  tickChannels(): void {
    if (!this.channelBox || this.isCollapsed()) return;
    const cls = document.body.classList;
    if (cls.contains('chrome-hidden') || cls.contains('presenting')) return;
    this.channelBox.refresh();
  }

  /** The channel box's field texts (tx ty tz rx ry rz sx sy sz), or null when it is not up. */
  channelValues(): string[] | null {
    if (!this.channelBox) return null;
    this.channelBox.refresh();
    return this.channelBox.values();
  }

  /** The Select tool's settings: its modifiers, and the mode (lasso later). */
  private buildSelectSettings(body: HTMLElement): void {
    const mode = selectEl(
      [
        ['marquee', 'Marquee'],
        ['lasso', 'Lasso (soon)'],
      ],
      'marquee',
    );
    mode.disabled = true; // one mode today; the row says where the lasso will go
    body.appendChild(labelRow('Mode', mode));
    for (const [what, how] of [
      ['Select', 'Click an object'],
      ['Add', 'Shift + click / drag'],
      ['Remove', 'Ctrl + click / drag'],
      ['Add', 'Ctrl + Shift + drag'],
      ['Marquee', 'Drag on the view'],
      ['Orbit', 'Alt + drag'],
    ]) {
      const row = div('sculpt-panel__hint');
      row.textContent = `${how} — ${what.toLowerCase()}`;
      body.appendChild(row);
    }
  }

  /** The transform gizmo's settings: which handles it shows. */
  private buildTransformSettings(body: HTMLElement): void {
    const gizmo = this.input.transform;
    if (!gizmo) return;
    const parts = gizmo.getParts();
    for (const [key, label] of [
      ['arrows', 'Move arrows'],
      ['planes', 'Move planes'],
      ['rotate', 'Rotate rings'],
      ['scale', 'Scale boxes'],
      ['screen', 'Screen move (centre)'],
      ['uniform', 'Uniform scale (in R)'],
    ] as const) {
      body.appendChild(
        checkbox(label, parts[key], (on) => {
          gizmo.setParts({ [key]: on });
          this.onGizmoParts?.(gizmo.getParts());
        }),
      );
    }
    const hint = div('sculpt-panel__hint muted');
    hint.textContent =
      'W / E / R show one kind at a time; T shows what is ticked here. The centre of the unified gizmo moves the object across the screen.';
    body.appendChild(hint);
    const pick = div('sculpt-panel__hint muted');
    pick.textContent = 'Click an object to move the gizmo to it; Shift + click adds it to the selection, Ctrl + click removes it. The selection moves together.';
    body.appendChild(pick);
  }

  /** The gizmo's parts changed (mode.ts remembers them for next time). */
  onGizmoParts: ((parts: GizmoParts) => void) | null = null;


  private curveSelect(value: CurveId, onChange: (c: CurveId) => void): HTMLSelectElement {
    const sel = selectEl(CURVE_OPTIONS, value);
    sel.addEventListener('change', () => onChange(sel.value as CurveId));
    return sel;
  }

  // --- Symmetry -----------------------------------------------------------

  private symSection: HTMLElement | null = null;

  private buildSymmetry(body: HTMLElement): void {
    const sec = section(body, 'Symmetry');
    this.symSection = sec;
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

  /** Highlight the active brush's mirror axis (per-brush state). */
  private paintAxis(): void {
    const axis = this.session.getSymmetryAxis();
    for (const b of this.axisButtons) {
      b.classList.toggle('sculpt-panel__btn--on', b.dataset.axis === axis);
    }
  }

  /** Follow radius/strength changes made anywhere else (rail, keys, drags). */
  refreshBrushValues(): void {
    // Through the slider's own value, so a size typed past 500 reads as itself.
    if (this.sizeInput) setSliderValue(this.sizeInput, Math.round(this.input.getBrushRadius()));
    if (this.strengthInput) setSliderValue(this.strengthInput, Number(this.input.getBrushIntensity().toFixed(2)));
    const smooth = this.session.getSculptManager().getTool(Enums.Tools.SMOOTH) as unknown as StableSmooth | undefined;
    if (this.smoothStrengthInput && smooth instanceof StableSmooth) {
      setSliderValue(this.smoothStrengthInput, Number(smooth._intensity.toFixed(2)));
    }
  }

  /**
   * Re-sync stateful controls after engine-side changes (undo, dyntopo, a
   * brush pick, a scene opened with settings of its own).
   */
  refreshState(): void {
    // World scale rides the scene record: an opened file can turn it either
    // way, and the box was only ever read when the panel was built.
    const ws = this.input.worldScale;
    if (this.worldScaleBox && ws && this.worldScaleBox.checked !== ws.isEnabled()) {
      this.worldScaleBox.checked = ws.isEnabled();
      this.refreshBrush(); // the Size row's units with it
    }
    if (!this.symCheckbox) return; // called before the section is built
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
    this.channelBox?.dispose();
    this.channelBox = null;
    this.session.onSymmetryChange = null;
    super.dispose();
  }
}
