import type { Viewer } from '../viewer/Viewer';
import type { LightId } from '../viewer/Lighting';

export interface PanelOptions {
  /** Editor variant: full lighting controls + an in-panel timeline. */
  editor?: boolean;
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
  private readonly editor: boolean;

  private modeSelect!: HTMLSelectElement;
  private materialOptions!: HTMLDivElement;
  private smoothCheckbox!: HTMLInputElement;
  private wireframeCheckbox!: HTMLInputElement;
  private groundCheckbox!: HTMLInputElement;
  private lightControls?: HTMLDivElement;

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
    document.body.appendChild(this.root);

    const header = div('panel__header');
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = viewer.manifest.title || 'Bozzetto';
    this.collapseBtn = button('', () => this.toggleCollapsed());
    this.collapseBtn.className = 'panel__collapse';
    header.append(title, this.collapseBtn);
    this.root.appendChild(header);

    this.bodyEl = div('panel__body');
    this.root.appendChild(this.bodyEl);

    // Viewer starts collapsed for a minimal default; editor starts open.
    this.bodyEl.hidden = !this.editor;
    this.collapseBtn.textContent = this.bodyEl.hidden ? '+' : '–';

    if (this.editor) this.buildTimeline(this.bodyEl);
    this.buildMaterial(this.bodyEl);
    this.buildLighting(this.bodyEl);

    const view = section(this.bodyEl, 'View');
    view.appendChild(button('Reset view', () => this.viewer.resetView()));
  }

  /** Open/close the panel body (Tab). */
  toggleCollapsed(): void {
    this.bodyEl.hidden = !this.bodyEl.hidden;
    this.collapseBtn.textContent = this.bodyEl.hidden ? '+' : '–';
  }

  /** Re-sync controls that hotkeys can change (material mode, matcap, shading…). */
  refreshControls(): void {
    this.modeSelect.value = this.viewer.getMaterial();
    this.rebuildMaterialOptions();
    const state = this.viewer.materials.getMaterialState();
    this.smoothCheckbox.checked = !state.flatShading;
    this.wireframeCheckbox.checked = this.viewer.isWireframe();
    this.groundCheckbox.checked = this.viewer.isGroundEnabled();
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

    if (this.editor) {
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
        this.rebuildLightControls();
      });
      lighting.appendChild(labelRow('Preset', presetSelect));

      this.lightControls = div('light-controls');
      lighting.appendChild(this.lightControls);
      this.rebuildLightControls();
    }

    lighting.appendChild(
      labelled('Rotate rig', () => {
        const out = document.createElement('span');
        out.className = 'readout';
        const start = this.viewer.lighting.getRigRotation();
        out.textContent = `${Math.round(start)}°`;
        const r = range(0, 360, 1, start, (v) => {
          this.viewer.lighting.setRigRotation(v);
          out.textContent = `${Math.round(v)}°`;
        });
        const wrap = div('range-wrap');
        wrap.append(r, out);
        return wrap;
      }),
    );

    const ground = checkbox('Ground shadow', this.viewer.isGroundEnabled(), (on) =>
      this.viewer.setGround(on),
    );
    this.groundCheckbox = ground.querySelector('input')!;
    lighting.appendChild(ground);
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
}

// --- tiny DOM helpers ----------------------------------------------------

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

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

function labelRow(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'label-row';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, control);
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
