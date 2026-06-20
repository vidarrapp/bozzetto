import type { Viewer, GroundMode } from '../viewer/Viewer';
import type { LightId } from '../viewer/Lighting';
import { div, labelRow } from './dom';

export interface PanelOptions {
  /** Editor variant: full lighting controls + an in-panel timeline. */
  editor?: boolean;
  /** Editor-only content pinned at the very top of the body (e.g. Save look). */
  actions?: HTMLElement;
}

/**
 * Side control panel. The viewer variant is minimal (starts collapsed; Material,
 * a trimmed Lighting of rotate-rig + ground, View) — the timeline lives in the
 * bottom Transport and the theme toggle is global. The editor variant adds the
 * full lighting rig and an in-panel timeline. Keyboard shortcuts live in
 * installShortcuts; it calls toggleCollapsed()/refreshControls() here.
 */
export class Panel {
  private readonly root: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly handleArrow: HTMLSpanElement;
  private readonly editor: boolean;
  private collapsed = false;

  /** Fired when the handle is clicked (editor coordinates both panels). */
  onToggle: ((collapsed: boolean) => void) | null = null;

  private modeSelect!: HTMLSelectElement;
  private materialOptions!: HTMLDivElement;
  private smoothCheckbox!: HTMLInputElement;
  private wireframeCheckbox!: HTMLInputElement;
  /** Ground-mode select lives in the editor's Environment section (or null). */
  private groundSelect: HTMLSelectElement | null = null;
  private lightControls?: HTMLDivElement;
  private lightToggles?: HTMLDivElement;

  private scrubber?: HTMLInputElement;
  private playButton?: HTMLButtonElement;
  private stageName?: HTMLSpanElement;
  private stageDesc?: HTMLSpanElement;
  private frameLabel?: HTMLSpanElement;

  constructor(
    private readonly viewer: Viewer,
    options: PanelOptions = {},
  ) {
    this.editor = options.editor ?? false;

    this.root = div('panel');
    // Editor panel runs full-height (like the sidebar); the viewer panel stays
    // content-sized and leaves room for the transport bar at the bottom.
    if (this.editor) this.root.classList.add('panel--editor');
    document.body.appendChild(this.root);

    // Edge handle: always visible, doubles as the collapse/expand toggle so the
    // panel can slide fully off the side and still be pulled back in. When
    // collapsed it shows the panel's name (a larger, labelled touch target).
    this.collapseBtn = button('', () => {
      this.toggleCollapsed();
      this.onToggle?.(this.collapsed);
    });
    this.collapseBtn.className = 'panel__handle';
    this.handleArrow = document.createElement('span');
    this.handleArrow.className = 'handle__arrow';
    const handleLabel = document.createElement('span');
    handleLabel.className = 'handle__label';
    handleLabel.textContent = this.editor ? 'Look dev' : 'Settings';
    this.collapseBtn.replaceChildren(handleLabel, this.handleArrow);
    this.root.appendChild(this.collapseBtn);

    const header = div('panel__header');
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = this.editor ? 'Look dev' : viewer.manifest.title || 'Bozzetto';
    // Closing lives in the title bar; the open panel hides its edge handle.
    const closeBtn = button('›', () => {
      this.setCollapsed(true);
      this.onToggle?.(true);
    });
    closeBtn.className = 'panel__close';
    closeBtn.setAttribute('aria-label', 'Hide panel');
    header.append(title, closeBtn);
    this.root.appendChild(header);

    this.bodyEl = div('panel__body');
    this.root.appendChild(this.bodyEl);

    // Viewer starts collapsed (slid out) for a minimal default; editor open.
    this.collapsed = !this.editor;
    this.applyCollapsed();

    if (options.actions) this.bodyEl.appendChild(options.actions);
    if (this.editor) this.buildTimeline(this.bodyEl);
    this.buildMaterial(this.bodyEl);
    this.buildLighting(this.bodyEl);
    if (this.editor) this.buildCamera(this.bodyEl);
    if (this.editor) this.buildEnvironment(this.bodyEl);
    if (this.editor) this.buildAO(this.bodyEl);
    if (devMode()) this.buildDeveloper(this.bodyEl);
  }

  /** Slide the panel in/out from its docked edge (Tab). Returns the new state. */
  toggleCollapsed(): boolean {
    this.collapsed = !this.collapsed;
    this.applyCollapsed();
    return this.collapsed;
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.applyCollapsed();
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  private applyCollapsed(): void {
    this.root.classList.toggle('panel--collapsed', this.collapsed);
    // Arrow shows travel direction: out (›) when open, in (‹) when collapsed.
    this.handleArrow.textContent = this.collapsed ? '‹' : '›';
  }

  /** Re-sync controls that hotkeys can change (material mode, matcap, shading…). */
  refreshControls(): void {
    this.modeSelect.value = this.viewer.getMaterial();
    this.rebuildMaterialOptions();
    const state = this.viewer.materials.getMaterialState();
    this.smoothCheckbox.checked = !state.flatShading;
    this.wireframeCheckbox.checked = this.viewer.isWireframe();
    if (this.groundSelect) this.groundSelect.value = this.viewer.getGround();
  }

  dispose(): void {
    this.viewer.onFrame = null;
    this.viewer.onPlayStateChange = null;
    this.root.remove();
  }

  // --- timeline (editor only) -------------------------------------------

  private buildTimeline(body: HTMLElement): void {
    const timeline = section(body, 'Timeline');

    this.stageName = document.createElement('span');
    this.stageName.className = 'stage__name';
    this.stageDesc = document.createElement('span');
    this.stageDesc.className = 'stage__desc';
    const stageRow = div('stage');
    stageRow.append(this.stageName, this.stageDesc);
    timeline.appendChild(stageRow);

    this.scrubber = document.createElement('input');
    this.scrubber.type = 'range';
    this.scrubber.min = '0';
    this.scrubber.max = String(this.viewer.manifest.config.frameCount - 1);
    this.scrubber.step = '1';
    this.scrubber.value = String(this.viewer.manifest.defaults.frame);
    this.scrubber.className = 'scrubber';
    this.scrubber.addEventListener('input', () =>
      this.viewer.scrubTo(Number(this.scrubber!.value)),
    );
    timeline.appendChild(this.scrubber);

    this.frameLabel = document.createElement('span');
    this.frameLabel.className = 'frame-label';
    timeline.appendChild(this.frameLabel);

    const transport = div('row');
    this.playButton = button('Pause', () => this.viewer.togglePlay());
    transport.appendChild(this.playButton);
    timeline.appendChild(transport);

    this.viewer.onFrame = (ordinal) => this.syncFrame(ordinal);
    this.viewer.onPlayStateChange = (playing) => this.setPlay(playing);
    this.syncFrame(this.viewer.manifest.defaults.frame);
    this.setPlay(this.viewer.timeline.playing);
  }

  private syncFrame(ordinal: number): void {
    if (this.scrubber) this.scrubber.value = String(ordinal);
    if (this.frameLabel) {
      this.frameLabel.textContent = `Frame ${ordinal + 1} / ${this.viewer.manifest.config.frameCount}`;
    }
    const stage = this.viewer.timeline.stageAt(ordinal);
    if (this.stageName) this.stageName.textContent = stage ? stage.name : '';
    if (this.stageDesc) this.stageDesc.textContent = stage ? stage.desc : '';
  }

  private setPlay(playing: boolean): void {
    if (this.playButton) this.playButton.textContent = playing ? 'Pause' : 'Play';
  }

  // --- material ---------------------------------------------------------

  private buildMaterial(body: HTMLElement): void {
    const material = section(body, 'Material');

    this.modeSelect = document.createElement('select');
    for (const mode of this.viewer.materials.modes) {
      const opt = document.createElement('option');
      opt.value = mode.id;
      opt.textContent = mode.label;
      this.modeSelect.appendChild(opt);
    }
    this.modeSelect.value = this.viewer.getMaterial();
    this.modeSelect.addEventListener('change', () => {
      this.viewer.setMaterial(this.modeSelect.value);
      this.rebuildMaterialOptions();
    });
    material.appendChild(labelRow('Mode', this.modeSelect));

    this.materialOptions = div('mat-options');
    material.appendChild(this.materialOptions);
    this.rebuildMaterialOptions();

    // Smooth shading on by default; unchecking it gives faceted/flat shading.
    const smooth = checkbox('Smooth shading', !this.viewer.materials.isFlatShading(), (on) =>
      this.viewer.materials.setFlatShading(!on),
    );
    this.smoothCheckbox = smooth.querySelector('input')!;
    material.appendChild(smooth);

    const wire = checkbox('Wireframe (w)', this.viewer.isWireframe(), (on) =>
      this.viewer.setWireframe(on),
    );
    this.wireframeCheckbox = wire.querySelector('input')!;
    material.appendChild(wire);

    material.appendChild(
      compactRange('Wire opacity', 0, 1, 0.05, this.viewer.getWireframeOpacity(), (v) =>
        this.viewer.setWireframeOpacity(v),
      ),
    );
  }

  private rebuildMaterialOptions(): void {
    this.materialOptions.replaceChildren();
    const mats = this.viewer.materials;
    const state = mats.getMaterialState();

    if (this.viewer.getMaterial() === 'lit') {
      const albedo = document.createElement('input');
      albedo.type = 'color';
      albedo.value = state.albedo;
      albedo.addEventListener('input', () => mats.setAlbedo(albedo.value));
      this.materialOptions.appendChild(labelRow('Albedo', albedo));
      this.materialOptions.appendChild(
        compactRange('Roughness', 0, 1, 0.01, state.roughness, (v) => mats.setRoughness(v)),
      );
      this.materialOptions.appendChild(
        compactRange('Metalness', 0, 1, 0.01, state.metalness, (v) => mats.setMetalness(v)),
      );
    } else if (this.viewer.getMaterial() === 'matcap') {
      const matcaps = mats.matcaps();
      if (matcaps.length > 1) {
        const select = document.createElement('select');
        matcaps.forEach((mc, i) => {
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = mc.label;
          select.appendChild(opt);
        });
        select.value = String(state.matcapIndex);
        select.addEventListener('change', () => mats.setMatcapIndex(Number(select.value)));
        this.materialOptions.appendChild(labelRow('Matcap', select));
      }
    }
  }

  // --- lighting ---------------------------------------------------------

  private buildLighting(body: HTMLElement): void {
    const lighting = section(body, 'Lighting');

    // Preset switch (viewer + editor): Three-point <-> Raking.
    const presetSelect = document.createElement('select');
    for (const preset of this.viewer.lighting.presets()) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.label;
      presetSelect.appendChild(opt);
    }
    presetSelect.value = this.viewer.manifest.defaults.lightingPreset;
    presetSelect.addEventListener('change', () => {
      this.viewer.lighting.applyPreset(presetSelect.value);
      this.rebuildLightControls(); // editor: full per-light rig
      this.rebuildLightToggles(); // viewer: simple on/off toggles
    });
    lighting.appendChild(labelRow('Preset', presetSelect));

    if (this.editor) {
      // Editor keeps the full rig: intensity, angles, colour, per-light shadows.
      this.lightControls = div('light-controls');
      lighting.appendChild(this.lightControls);
      this.rebuildLightControls();
    } else {
      // Viewer gets just on/off toggles per light; advanced settings live in the editor.
      this.lightToggles = div('light-toggles');
      lighting.appendChild(this.lightToggles);
      this.rebuildLightToggles();
    }

    lighting.appendChild(
      labelled('Rotate rig', () => {
        const out = document.createElement('span');
        out.className = 'readout';
        const start = this.viewer.lighting.getRigRotation();
        out.textContent = `${Math.round(start)}°`;
        const r = range(0, 360, 1, start, (v) => {
          this.viewer.setRigRotation(v); // rotates the directional rig + HDRI
          out.textContent = `${Math.round(v)}°`;
        });
        const wrap = div('range-wrap');
        wrap.append(r, out);
        return wrap;
      }),
    );
  }

  /** Viewer-only: one enable checkbox per light (no advanced controls). */
  private rebuildLightToggles(): void {
    if (!this.lightToggles) return;
    this.lightToggles.replaceChildren();
    for (const light of this.viewer.lighting.state()) {
      this.lightToggles.appendChild(
        checkbox(light.label, light.enabled, (on) => this.viewer.lighting.setEnabled(light.id, on)),
      );
    }
  }

  private rebuildLightControls(): void {
    if (!this.lightControls) return;
    this.lightControls.replaceChildren();
    for (const light of this.viewer.lighting.state()) {
      const box = div('light');
      const head = div('light__head');
      head.appendChild(
        checkbox(light.label, light.enabled, (on) => this.viewer.lighting.setEnabled(light.id, on)),
      );
      box.appendChild(head);

      box.appendChild(
        compactRange('Intensity', 0, 8, 0.1, light.intensity, (v) =>
          this.viewer.lighting.setIntensity(light.id, v),
        ),
      );
      box.appendChild(
        compactRange('Azimuth', -180, 180, 1, light.azimuth, (v) => this.setAngle(light.id, 'az', v)),
      );
      box.appendChild(
        compactRange('Elevation', -20, 90, 1, light.elevation, (v) =>
          this.setAngle(light.id, 'el', v),
        ),
      );

      const color = document.createElement('input');
      color.type = 'color';
      color.value = light.color;
      color.addEventListener('input', () => this.viewer.lighting.setColor(light.id, color.value));
      box.appendChild(labelRow('Colour', color));

      if (light.canShadow) {
        box.appendChild(
          checkbox('Casts shadow', light.castShadow, (on) => {
            this.viewer.lighting.setShadow(light.id, on);
            this.rebuildLightControls();
          }),
        );
        if (light.castShadow) {
          box.appendChild(
            compactRange('Softness', 0, 16, 0.5, light.softness, (v) =>
              this.viewer.lighting.setSoftness(light.id, v),
            ),
          );
        }
      }

      this.lightControls.appendChild(box);
    }
  }

  private setAngle(id: LightId, which: 'az' | 'el', value: number): void {
    const current = this.viewer.lighting.state().find((l) => l.id === id);
    if (!current) return;
    const az = which === 'az' ? value : current.azimuth;
    const el = which === 'el' ? value : current.elevation;
    this.viewer.lighting.setAngles(id, az, el);
  }

  // --- environment (editor only) ----------------------------------------

  private buildEnvironment(body: HTMLElement): void {
    const env = this.viewer.environment;
    const state = env.getState();
    const stage = this.viewer.getStageState();
    const sec = section(body, 'Environment');

    const select = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'None';
    select.appendChild(none);
    for (const e of env.list()) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.label;
      select.appendChild(opt);
    }
    select.value = state.id ?? '';
    select.addEventListener('change', () => void env.setEnvironment(select.value || null));
    sec.appendChild(labelRow('HDRI', select));

    sec.appendChild(
      compactRange('Intensity', 0, 3, 0.05, state.intensity, (v) => env.setIntensity(v)),
    );

    const bg = document.createElement('select');
    for (const [value, label] of [
      ['theme', 'Theme'],
      ['color', 'Solid colour'],
      ['hdri', 'HDRI'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      bg.appendChild(opt);
    }
    bg.value = state.background;
    bg.addEventListener('change', () =>
      env.setBackgroundMode(bg.value as 'theme' | 'color' | 'hdri'),
    );
    sec.appendChild(labelRow('Background', bg));

    const bgColor = document.createElement('input');
    bgColor.type = 'color';
    bgColor.value = state.bgColor;
    bgColor.addEventListener('input', () => env.setBackgroundColor(bgColor.value));
    sec.appendChild(labelRow('Bg colour', bgColor));

    sec.appendChild(
      compactRange('HDR rotation', 0, 360, 1, state.rotation, (v) => env.setOffset(v)),
    );
    sec.appendChild(
      compactRange('Bg blur', 0, 1, 0.02, state.blur, (v) => env.setBackgroundBlur(v)),
    );

    // Stage: a single ground style (contact shadow, fading floor, or pedestal),
    // each with its own albedo where relevant.
    const ground = document.createElement('select');
    for (const [value, label] of [
      ['off', 'None'],
      ['shadow', 'Shadow'],
      ['floor', 'Floor'],
      ['pedestal', 'Pedestal'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      ground.appendChild(opt);
    }
    ground.value = this.viewer.getGround();
    ground.addEventListener('change', () => this.viewer.setGround(ground.value as GroundMode));
    this.groundSelect = ground;
    sec.appendChild(labelRow('Ground', ground));

    // Floor/pedestal share one PBR surface (they're mutually exclusive).
    const albedo = document.createElement('input');
    albedo.type = 'color';
    albedo.value = stage.color;
    albedo.addEventListener('input', () => this.viewer.setStageColor(albedo.value));
    sec.appendChild(labelRow('Surface albedo', albedo));

    sec.appendChild(
      compactRange('Surface roughness', 0, 1, 0.01, stage.roughness, (v) =>
        this.viewer.setStageRoughness(v),
      ),
    );
    sec.appendChild(
      compactRange('Surface metalness', 0, 1, 0.01, stage.metalness, (v) =>
        this.viewer.setStageMetalness(v),
      ),
    );
  }

  // --- camera (editor only) ---------------------------------------------

  private buildCamera(body: HTMLElement): void {
    const sec = section(body, 'Camera');

    sec.appendChild(
      steppedSlider('Lens', LENS_STEPS, this.viewer.getFocalLength(), (mm) => `${mm}mm`, (mm) =>
        this.viewer.setFocalLength(mm),
      ),
    );

    // Depth of field: focus across the subject depth; aperture sets the blur.
    if (this.viewer.dofAvailable()) {
      const dof = this.viewer.getDoFState();
      sec.appendChild(
        checkbox('Depth of field', dof.enabled, (on) => this.viewer.setDoF({ enabled: on })),
      );
      sec.appendChild(
        steppedSlider('Aperture', F_STOPS, dof.fStop, (f) => `f/${f}`, (f) =>
          this.viewer.setDoF({ fStop: f }),
        ),
      );
      sec.appendChild(
        compactRange('Focus', 0, 1, 0.02, dof.focus, (v) => this.viewer.setDoF({ focus: v })),
      );
    }
  }

  private buildAO(body: HTMLElement): void {
    if (!this.viewer.aoAvailable()) return;
    const ao = this.viewer.getAOState();
    const sec = section(body, 'Ambient occlusion');

    sec.appendChild(checkbox('Enabled', ao.enabled, (on) => this.viewer.setAO({ enabled: on })));
    // Strength blends the GTAO term toward 1 (0 = none, 1 = full, >1 deepens it).
    sec.appendChild(
      compactRange('Strength', 0, 2, 0.05, ao.intensity, (v) => this.viewer.setAO({ intensity: v })),
    );
    sec.appendChild(
      compactRange('Radius', 0.05, 1, 0.05, ao.radius, (v) => this.viewer.setAO({ radius: v })),
    );
  }

  // --- developer overlay (?dev) -----------------------------------------

  private buildDeveloper(body: HTMLElement): void {
    const lighting = this.viewer.lighting;
    const dev = section(body, 'Developer');

    dev.appendChild(
      compactRange('Bias', -0.003, 0.001, 0.0001, lighting.getBias(), (v) => lighting.setBias(v)),
    );
    dev.appendChild(
      compactRange('Normal bias', 0, 0.1, 0.005, lighting.getNormalBias(), (v) =>
        lighting.setNormalBias(v),
      ),
    );

    const quality = document.createElement('select');
    for (const q of ['auto', 'high', 'medium', 'low']) {
      const opt = document.createElement('option');
      opt.value = q;
      opt.textContent = q;
      quality.appendChild(opt);
    }
    quality.value = new URLSearchParams(location.search).get('q') ?? 'auto';
    quality.addEventListener('change', () => {
      const params = new URLSearchParams(location.search);
      if (quality.value === 'auto') params.delete('q');
      else params.set('q', quality.value);
      location.search = params.toString();
    });
    dev.appendChild(labelRow('Quality', quality));

    if (this.viewer.aoAvailable()) {
      dev.appendChild(
        checkbox('AO', this.viewer.getAOState().enabled, (on) => this.viewer.setAO({ enabled: on })),
      );
    }
  }
}

function devMode(): boolean {
  return new URLSearchParams(location.search).has('dev');
}

/** Lens slider stops, in 35mm-equivalent mm (wide normal through short tele). */
const LENS_STEPS: number[] = [35, 50, 55, 80, 105, 135];

/** Aperture slider stops, in f-stops (whole stops; lower is shallower). */
const F_STOPS: number[] = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];

/** Index of the entry in `steps` nearest to `value`. */
function nearestIndex(steps: number[], value: number): number {
  let best = 0;
  for (let i = 1; i < steps.length; i++) {
    if (Math.abs(steps[i] - value) < Math.abs(steps[best] - value)) best = i;
  }
  return best;
}

/** A slider that snaps to `steps`, with a formatted readout (lens, aperture). */
function steppedSlider(
  label: string,
  steps: number[],
  current: number,
  format: (v: number) => string,
  onPick: (v: number) => void,
): HTMLElement {
  const idx = nearestIndex(steps, current);
  return labelled(label, () => {
    const out = document.createElement('span');
    out.className = 'readout';
    out.textContent = format(steps[idx]);
    const r = range(0, steps.length - 1, 1, idx, (i) => {
      onPick(steps[i]);
      out.textContent = format(steps[i]);
    });
    const wrap = div('range-wrap');
    wrap.append(r, out);
    return wrap;
  });
}

// --- tiny DOM helpers ----------------------------------------------------

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function section(parent: HTMLElement, heading: string): HTMLDivElement {
  const s = div('section');
  const h = document.createElement('h3');
  h.textContent = heading;
  s.appendChild(h);
  parent.appendChild(s);
  return s;
}

function range(
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
): HTMLInputElement {
  const r = document.createElement('input');
  r.type = 'range';
  r.min = String(min);
  r.max = String(max);
  r.step = String(step);
  r.value = String(value);
  r.addEventListener('input', () => onInput(Number(r.value)));
  return r;
}

function compactRange(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'compact';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, range(min, max, step, value, onInput));
  return wrap;
}

function labelled(label: string, build: () => HTMLElement): HTMLLabelElement {
  return labelRow(label, build());
}

function checkbox(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'checkbox';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(input, span);
  return wrap;
}
