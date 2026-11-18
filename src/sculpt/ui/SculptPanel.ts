import { keyedLabel } from '../../ui/keymap';
import Enums from '@sculpt-vendor/misc/Enums';
import { div, labelRow, onTap, selectEl } from '../../ui/dom';
import { checkbox, compactRange, section } from '../../ui/Panel';
import { setSliderValue, type Limits } from '../../ui/sliderEntry';
import { colorPicker, type ColorPickerHandle } from '../../ui/ColorPicker';
import { installSwatchPick } from '../../ui/swatchPick';
import { CURVE_OPTIONS, type BrushDynamics, type CurveId } from '../bridge/dynamics';
import { RAKE_PRESETS, RakeBrush, StableSmooth } from '../bridge/tools';
import type { ProfileCurve } from '../bridge/profile';
import { CurveEditor } from './CurveEditor';
import { toolByEngine, toolName, SMOOTH_OWN, type SettingSpec, type ToolDef } from '../tools/registry';
import { readOwn, writeOwn, type EngineTool } from '../tools/toolSettings';
import type { InputShell } from '../bridge/InputShell';
import type { GizmoParts } from '../bridge/transform';
import type { SculptSession } from '../bridge/SculptSession';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { Viewer } from '../../viewer/Viewer';
import { SidePanel } from './SidePanel';
import { lengthText } from '../bridge/measure';
import { ChannelBox } from './ChannelBox';

/** Typed-value limits (sliderEntry): what Smooth's strength can be, past the travel. */
const FRACTION: Limits = { min: 0, max: 1 };

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
  /** The Rake's preset row, while the Rake's rows are up. */
  private rakePresets: HTMLDivElement | null = null;
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
    this.brushHeading?.classList.add('bz-section-named');

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

  /**
   * Name what the panel is for: the section's own heading, and the panel's,
   * which the shell shows in its place (the section's is then put away).
   */
  private nameBrush(name: string): void {
    if (this.brushHeading) this.brushHeading.textContent = name;
    this.setHeading(name);
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
    this.measureUnsub?.();
    this.measureUnsub = null;
    this.onSymmetryChanged = null;
    // Symmetry is a brush setting: neither the Select tool nor the gizmo
    // mirrors anything (a mirrored selection is a maybe for later), so
    // the section shows for brushes only, with the active brush's values.
    // The Calipers' Mirror follows the symmetry switch, so its section stays for them.
    if (this.symSection) this.symSection.hidden = uiMode !== 'brush' && uiMode !== 'measure';
    // Shift's Smooth settings ride every brush that Shift smooths from.
    this.fillShiftSmooth(uiMode === 'brush' ? tool : -1);
    if (uiMode === 'select') {
      this.nameBrush('Select');
      this.extrasBody.replaceChildren();
      this.buildChannelBox(dyn);
      this.buildSelectSettings(dyn);
      return;
    }
    if (uiMode === 'measure') {
      this.nameBrush('Calipers');
      this.extrasBody.replaceChildren();
      this.buildMeasureSettings(dyn);
      return;
    }
    if (uiMode === 'transform') {
      this.nameBrush('Transform');
      this.extrasBody.replaceChildren();
      this.buildChannelBox(dyn);
      this.buildTransformSettings(dyn);
      return;
    }
    this.refreshState();
    // The tool's rows come from its entry in the registry (tools/registry.ts),
    // in its order. A tool the table does not know has a heading and nothing else.
    const def = toolByEngine(tool);
    this.nameBrush(toolName(tool));
    this.extrasBody.replaceChildren();
    if (def) this.buildRows(def, tool);
  }

  /**
   * The rows of a brush: each of its settings, in the registry's order, in
   * the block it belongs to (the common rows under the heading, then the
   * tool's own). Rows that show only while another setting says so are
   * shown or hidden as it changes.
   */
  private buildRows(def: ToolDef, tool: number): void {
    const dyn = this.dynamicsBody;
    const extras = this.extrasBody;
    const d = this.input.dynamics.get(tool);
    const engine = this.session.getSculptManager().getTool(tool) as unknown as EngineTool;
    const gated: Array<{ spec: SettingSpec; row: HTMLElement }> = [];
    const holds = (when: SettingSpec['when']): boolean => {
      if (when === 'pressure-size') return d.size > 0;
      if (when === 'pressure-strength') return d.strength > 0;
      if (when === 'smooth-surface') return engine.smoothMode === 'surface';
      return true;
    };
    const regate = (): void => {
      for (const g of gated) g.row.hidden = !holds(g.spec.when);
    };
    const changed = (): void => {
      this.lightRakePresets();
      this.input.onBrushSettingsChange?.();
      regate();
    };
    for (const spec of def.settings) {
      const host = spec.block === 'brush' ? dyn : extras;
      const rows = this.buildSetting(spec, tool, d, engine, { regate, changed });
      for (const row of rows) host.appendChild(row);
      if (spec.when && spec.when !== 'always' && rows[0]) gated.push({ spec, row: rows[0] });
    }
    regate();
  }

  /** One setting's row (the colour's and a few hints' are two elements), by what it is and what it is for. */
  private buildSetting(
    spec: SettingSpec,
    tool: number,
    d: BrushDynamics,
    engine: EngineTool,
    on: { regate: () => void; changed: () => void },
    aria = spec.aria,
  ): HTMLElement[] {
    const input = this.input;
    switch (spec.role) {
      case 'colour': {
        // The paint tools lead with the colour: the same HSV picker the Render
        // panel uses for albedo, so a colour is chosen the same way wherever
        // you are. Alt + click on the model samples one off the surface.
        this.paintPicker = colorPicker(input.getPaintColor(), (hex) => input.setPaintColor(hex));
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
        fill.addEventListener('click', () => input.fillPaint());
        colourRow.append(this.paintPicker.root, fill);
        // Drag the swatch over the view to pick a colour off the frame, as
        // the Render panel's background and light swatches do.
        installSwatchPick(this.paintPicker, this.viewer, (hex) => input.setPaintColor(hex));
        return [labelRow(spec.label, colourRow), this.hint(spec.text ?? '')];
      }
      case 'size': {
        // Printed as the rail prints it: pixels, or centimetres in world
        // scale on real units (InputShell.brushSizeDisplay).
        const display = input.brushSizeDisplay();
        const row = compactRange(
          spec.label,
          spec.min!,
          spec.max!,
          spec.step!,
          Math.round(input.getBrushRadius()),
          (v) => input.setBrushRadius(v),
          { limits: spec.limits, ...(display.scale !== 1 ? display : {}) },
        );
        this.sizeInput = row.querySelector('input') as HTMLInputElement;
        return [row];
      }
      case 'pressureSize':
      case 'pressureStrength': {
        // Pressure is an amount, not a switch (owner call): the bottom of the
        // slider is off, the top the full range. Its curve shapes the response
        // and means nothing at zero, so that row folds away there.
        const key = spec.role === 'pressureSize' ? 'size' : 'strength';
        return [
          compactRange(
            spec.label,
            spec.min!,
            spec.max!,
            spec.step!,
            d[key],
            (v) => {
              d[key] = v;
              input.onBrushSettingsChange?.();
              on.regate();
            },
            { limits: spec.limits },
          ),
        ];
      }
      case 'sizeCurve':
      case 'strengthCurve': {
        const key = spec.role === 'sizeCurve' ? 'sizeCurve' : 'strengthCurve';
        return [
          labelRow(
            spec.label,
            this.curveSelect(d[key], (c) => {
              d[key] = c;
              input.onBrushSettingsChange?.();
            }),
          ),
        ];
      }
      case 'strength': {
        // A length in cm for the brushes that push the surface (owner call,
        // 2026-10-31): how far one stroke at full pressure moves the surface
        // at the brush centre, 0 to 5 cm on the travel and up to 50 typed.
        // The capped brushes and Move keep 0 to 1.
        const cm = spec.unit === 'cm';
        const row = compactRange(
          spec.label,
          spec.min!,
          spec.max!,
          spec.step!,
          input.getBrushIntensity(),
          (v) => input.setBrushIntensity(v),
          cm ? { limits: spec.limits, unit: input.strengthSpec().unit } : { limits: spec.limits },
        );
        row.dataset.strength = cm ? 'cm' : 'fraction';
        this.strengthInput = row.querySelector('input') as HTMLInputElement;
        return [row];
      }
      case 'spacing': {
        // Dab spacing: how far the brush travels between stamps, as a fraction
        // of its radius. It is the difference between a clay ribbon and a row
        // of separate dabs, and a rake only combs at all when its stamps
        // overlap. Under 0.02 a stroke lays down so many dabs that it stalls.
        return [compactRange(spec.label, spec.min!, spec.max!, spec.step!, input.getBrushSpacing(), (v) => input.setBrushSpacing(v), { limits: spec.limits })];
      }
      case 'curve': {
        // Every profile reads sharp on the left and soft on the right (owner call).
        const curve = (engine as unknown as { curve: ProfileCurve }).curve;
        return [this.curveRow(spec.label, spec.aria ?? spec.label, curve)];
      }
      case 'own':
        return this.buildOwn(spec, engine, on, aria);
    }
  }

  /** A knob of the tool's own: a slider, a switch, a choice, the Rake's presets, or a line of words. */
  private buildOwn(spec: SettingSpec, engine: EngineTool, on: { regate: () => void; changed: () => void }, aria = spec.aria): HTMLElement[] {
    if (spec.kind === 'hint') return [this.hint(spec.text ?? '')];
    if (spec.kind === 'presets') return [this.rakePresetRow(engine as unknown as RakeBrush, on.changed)];
    const write = (v: number | boolean | string): void => {
      writeOwn(engine, spec, v);
      on.changed();
    };
    const read = readOwn(engine, spec);
    if (spec.kind === 'toggle') return [checkbox(spec.label, read === true, (checked) => write(checked))];
    if (spec.kind === 'select') {
      const sel = selectEl(spec.options ?? [], String(read));
      if (aria) sel.setAttribute('aria-label', aria);
      sel.addEventListener('change', () => write(sel.value));
      return [labelRow(spec.label, sel)];
    }
    const row = compactRange(spec.label, spec.min!, spec.max!, spec.step!, Number(read), (v) => write(v), { limits: spec.limits });
    if (spec.data) Object.assign(row.dataset, spec.data);
    return [row];
  }

  private hint(text: string): HTMLDivElement {
    const hint = div('sculpt-panel__hint muted');
    hint.textContent = text;
    return hint;
  }

  /** The Rake's presets: one press sets every row, the strength included. */
  private rakePresetRow(rake: RakeBrush, changed: () => void): HTMLDivElement {
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
        changed();
        this.refreshBrush();
        // The rail's strength nub, which the preset moved too.
        this.input.onBrushChange?.();
      });
      presets.appendChild(b);
    }
    this.rakePresets = presets;
    return presets;
  }

  /** The Rake's preset lights while its settings are still the preset's. */
  private lightRakePresets(): void {
    const rake = this.session.getSculptManager().getTool(Enums.Tools.RAKE) as unknown as RakeBrush | undefined;
    if (!this.rakePresets?.isConnected || !rake) return;
    for (const b of this.rakePresets.querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('sculpt-panel__btn--on', b.dataset.preset === rake.presetId);
    }
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

  /** Rebuild the Smooth group from the tool's values, or hide it (`tool` -1: not a brush). */
  private fillShiftSmooth(tool: number): void {
    const sec = this.smoothSection;
    const rows = this.smoothBody;
    if (!sec || !rows) return; // the first refreshBrush runs before the group exists
    rows.replaceChildren();
    this.smoothStrengthInput = undefined;
    const smooth = this.session.getSculptManager().getTool(Enums.Tools.SMOOTH) as unknown as StableSmooth | undefined;
    // Shift smooths from every brush but Paint's (where it blurs) and the tools that are not brushes: the registry says which.
    sec.hidden = !toolByEngine(tool)?.shiftSmooths || !(smooth instanceof StableSmooth);
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
    // Smooth's own rows (its Mode, and Relax in Surface), from the registry, as on Smooth's own panel.
    const engine = smooth as unknown as EngineTool;
    const regate = (): void => {
      for (const r of gated) r.hidden = engine.smoothMode !== 'surface';
    };
    const gated: HTMLElement[] = [];
    const changed = (): void => {
      this.input.onBrushSettingsChange?.();
      regate();
    };
    for (const spec of SMOOTH_OWN) {
      const built = this.buildOwn(spec, engine, { regate, changed }, spec.key === 'mode' ? 'Shift smooth mode' : spec.aria);
      rows.append(...built);
      if (spec.when === 'smooth-surface' && built[0]) gated.push(built[0]);
    }
    regate();
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
      row.textContent = `${how}: ${what.toLowerCase()}`;
      body.appendChild(row);
    }
  }

  /** Set scale, for the Calipers' message in a scene without real units (mode.ts opens the banner). */
  onSetScale: (() => void) | null = null;
  private measureUnsub: (() => void) | null = null;

  /**
   * The Calipers tool's rows: what the measurement being made reads, Pin
   * to keep it, Mirror to add its other half. In a scene without real units
   * the tool asks for the scale first.
   */
  private buildMeasureSettings(body: HTMLElement): void {
    if (!this.session.getUnits()) {
      const msg = div('sculpt-panel__hint');
      msg.dataset.role = 'measure-needs-scale';
      msg.textContent = "Set the scene's scale first";
      body.appendChild(msg);
      const row = div('sculpt-panel__row');
      const set = this.opButton('Set scale', () => this.onSetScale?.());
      set.dataset.role = 'measure-set-scale';
      row.appendChild(set);
      body.appendChild(row);
      return;
    }
    const store = this.session.measure;
    const reading = div('measure-reading');
    reading.dataset.role = 'measure-reading';
    body.appendChild(reading);
    const row = div('sculpt-panel__row');
    const pin = this.opButton('Pin', () => store.pinWorking());
    pin.dataset.role = 'measure-pin';
    pin.title = 'Keep this measurement in the scene (listed in the Model panel)';
    const mirror = this.opButton('Mirror', () => {
      const w = store.working;
      if (!w) return;
      if (w.m.mirror) store.removeMirror(w.m);
      else store.addMirror(w.mesh, w.m);
    });
    mirror.dataset.role = 'measure-mirror';
    row.append(pin, mirror);
    body.appendChild(row);
    const note = div('sculpt-panel__hint muted');
    note.dataset.role = 'measure-note';
    body.appendChild(note);
    const help = div('sculpt-panel__hint muted');
    help.textContent = 'Tap the model for a point, tap again for the second. Drag an end to move it along the surface. A third tap starts a new one.';
    body.appendChild(help);
    const paint = (): void => {
      const w = store.working;
      const done = !!w && !!w.m.b;
      pin.disabled = !done;
      const symmetric = this.session.getSymmetry();
      mirror.disabled = !done || (!symmetric && !w?.m.mirror);
      mirror.textContent = w?.m.mirror ? 'Unmirror' : 'Mirror';
      note.textContent = symmetric ? '' : 'Turn on Mirror sculpting (X) to mirror a measurement.';
      reading.textContent = measureReading(this.session, w);
    };
    paint();
    this.measureUnsub = store.subscribe(paint);
    this.onSymmetryChanged = paint;
  }

  /** Symmetry switched (the Calipers' Mirror enables with it). */
  private onSymmetryChanged: (() => void) | null = null;

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
    const box = checkbox('Mirror sculpting', this.session.getSymmetry(), () => this.session.toggleSymmetry());
    box.title = keyedLabel('Mirror sculpting', 'brush.symmetry');
    this.symCheckbox = box.querySelector('input') as HTMLInputElement;
    sec.appendChild(box);
    // The X key toggles the same flag; keep the checkbox honest.
    this.session.onSymmetryChange = (on) => {
      this.symCheckbox.checked = on;
      this.onSymmetryChanged?.();
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
    // The rake's preset lights while the strength is still the preset's.
    this.lightRakePresets();
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
    this.measureUnsub?.();
    this.channelBox?.dispose();
    this.channelBox = null;
    this.session.onSymmetryChange = null;
    super.dispose();
  }
}

/**
 * What the measurement being made reads: its length, with the mirror's and
 * the difference when it has one; a prompt before it has two points.
 */
export function measureReading(session: SculptSession, w: SculptSession['measure']['working']): string {
  if (!w) return 'Tap the model for the first point';
  const len = session.measure.length(w.mesh, w.m);
  if (len === null) return 'Tap for the second point';
  const mirror = session.measure.mirrorLength(w.mesh, w.m);
  if (mirror === null) return lengthText(len);
  return `${lengthText(len)} and ${lengthText(mirror)}, difference ${lengthText(Math.abs(len - mirror))}`;
}
