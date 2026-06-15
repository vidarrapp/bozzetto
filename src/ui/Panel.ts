import type { Viewer } from '../viewer/Viewer';
import type { LightId } from '../viewer/Lighting';

/**
 * Minimal, viewport-first control panel (design doc §12).
 *
 * A single collapsible panel: timeline transport, stage jumps, material mode,
 * the lighting rig, and a reset-view button. Keyboard shortcuts are wired here
 * too (space, arrows, number keys, r/l/g).
 */
export class Panel {
  private readonly root: HTMLDivElement;
  private readonly scrubber: HTMLInputElement;
  private readonly frameLabel: HTMLSpanElement;
  private readonly stageName: HTMLSpanElement;
  private readonly stageDesc: HTMLSpanElement;
  private readonly playButton: HTMLButtonElement;

  constructor(private readonly viewer: Viewer) {
    const m = viewer.manifest;

    this.root = div('panel');
    document.body.appendChild(this.root);

    // Header: title + collapse toggle.
    const header = div('panel__header');
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = m.title || 'Bozzetto';
    const collapse = button('–', () => this.toggleCollapsed());
    collapse.className = 'panel__collapse';
    header.append(title, collapse);
    this.root.appendChild(header);

    const body = div('panel__body');
    this.root.appendChild(body);
    collapse.addEventListener('click', () => {
      collapse.textContent = body.hidden ? '–' : '+';
    });

    // --- Timeline -------------------------------------------------------
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
    this.scrubber.max = String(m.config.frameCount - 1);
    this.scrubber.step = '1';
    this.scrubber.value = String(m.defaults.frame);
    this.scrubber.className = 'scrubber';
    this.scrubber.addEventListener('input', () => {
      this.viewer.scrubTo(Number(this.scrubber.value));
      this.updatePlayButton();
    });
    timeline.appendChild(this.scrubber);

    this.frameLabel = document.createElement('span');
    this.frameLabel.className = 'frame-label';
    timeline.appendChild(this.frameLabel);

    const transport = div('row');
    this.playButton = button('Pause', () => {
      this.viewer.togglePlay();
      this.updatePlayButton();
    });
    transport.append(
      button('⏮', () => {
        this.viewer.step(-1);
        this.updatePlayButton();
      }),
      this.playButton,
      button('⏭', () => {
        this.viewer.step(1);
        this.updatePlayButton();
      }),
    );
    timeline.appendChild(transport);

    const fpsRow = labelled('Speed (fps)', () => {
      const out = document.createElement('span');
      out.className = 'readout';
      out.textContent = m.config.fps.toFixed(1);
      const r = range(1, 8, 0.5, m.config.fps, (v) => {
        this.viewer.setFps(v);
        out.textContent = v.toFixed(1);
      });
      const wrap = div('range-wrap');
      wrap.append(r, out);
      return wrap;
    });
    timeline.appendChild(fpsRow);

    timeline.appendChild(
      checkbox('Loop', true, (on) => this.viewer.setLoop(on)),
    );

    // --- Stages ---------------------------------------------------------
    if (m.stages.length > 0) {
      const stages = section(body, 'Stages');
      const grid = div('btn-grid');
      for (const stage of m.stages) {
        grid.appendChild(
          button(stage.name, () => {
            this.viewer.jumpTo(stage.frame);
            this.scrubber.value = String(stage.frame);
          }),
        );
      }
      stages.appendChild(grid);
    }

    // --- Material -------------------------------------------------------
    const material = section(body, 'Material');
    const select = document.createElement('select');
    for (const mode of viewer.materials.modes) {
      const opt = document.createElement('option');
      opt.value = mode.id;
      opt.textContent = mode.label;
      select.appendChild(opt);
    }
    select.value = viewer.getMaterial();
    select.addEventListener('change', () => this.viewer.setMaterial(select.value));
    this.materialSelect = select;
    material.appendChild(select);

    // --- Lighting -------------------------------------------------------
    const lighting = section(body, 'Lighting');

    const presetSelect = document.createElement('select');
    for (const preset of viewer.lighting.presets()) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.label;
      presetSelect.appendChild(opt);
    }
    presetSelect.value = m.defaults.lightingPreset;
    presetSelect.addEventListener('change', () => {
      this.viewer.lighting.applyPreset(presetSelect.value);
      this.rebuildLightControls();
    });
    lighting.appendChild(labelRow('Preset', presetSelect));

    this.lightControls = div('light-controls');
    lighting.appendChild(this.lightControls);
    this.rebuildLightControls();

    lighting.appendChild(
      labelled('Rotate rig', () => {
        const out = document.createElement('span');
        out.className = 'readout';
        out.textContent = '0°';
        const r = range(0, 360, 1, 0, (v) => {
          this.viewer.lighting.setRigRotation(v);
          out.textContent = `${Math.round(v)}°`;
        });
        const wrap = div('range-wrap');
        wrap.append(r, out);
        return wrap;
      }),
    );

    lighting.appendChild(
      checkbox('Ground shadow', viewer.isGroundEnabled(), (on) =>
        this.viewer.setGround(on),
      ),
    );

    // --- View -----------------------------------------------------------
    const view = section(body, 'View');
    view.appendChild(button('Reset view', () => this.viewer.resetView()));

    // Wire viewer → panel sync and keyboard shortcuts.
    this.viewer.onFrame = (ordinal) => this.syncFrame(ordinal);
    this.syncFrame(m.defaults.frame);
    this.updatePlayButton();
    window.addEventListener('keydown', this.onKey);
  }

  private materialSelect!: HTMLSelectElement;
  private lightControls!: HTMLDivElement;

  private rebuildLightControls(): void {
    this.lightControls.replaceChildren();
    for (const light of this.viewer.lighting.state()) {
      const box = div('light');
      const head = div('light__head');
      head.appendChild(
        checkbox(light.label, light.enabled, (on) =>
          this.viewer.lighting.setEnabled(light.id, on),
        ),
      );
      box.appendChild(head);

      box.appendChild(
        compactRange('Intensity', 0, 8, 0.1, light.intensity, (v) =>
          this.viewer.lighting.setIntensity(light.id, v),
        ),
      );
      box.appendChild(
        compactRange('Azimuth', -180, 180, 1, light.azimuth, (v) =>
          this.setAngle(light.id, 'az', v),
        ),
      );
      box.appendChild(
        compactRange('Elevation', -20, 90, 1, light.elevation, (v) =>
          this.setAngle(light.id, 'el', v),
        ),
      );

      const color = document.createElement('input');
      color.type = 'color';
      color.value = light.color;
      color.addEventListener('input', () =>
        this.viewer.lighting.setColor(light.id, color.value),
      );
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

  private syncFrame(ordinal: number): void {
    this.scrubber.value = String(ordinal);
    const count = this.viewer.manifest.config.frameCount;
    this.frameLabel.textContent = `Frame ${ordinal + 1} / ${count}`;
    const stage = this.viewer.timeline.stageAt(ordinal);
    this.stageName.textContent = stage ? stage.name : '';
    this.stageDesc.textContent = stage ? stage.desc : '';
  }

  private updatePlayButton(): void {
    this.playButton.textContent = this.viewer.timeline.playing ? 'Pause' : 'Play';
  }

  private toggleCollapsed(): void {
    const body = this.root.querySelector<HTMLDivElement>('.panel__body');
    if (body) body.hidden = !body.hidden;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        this.viewer.togglePlay();
        this.updatePlayButton();
        break;
      case 'ArrowRight':
        this.viewer.step(1);
        this.updatePlayButton();
        break;
      case 'ArrowLeft':
        this.viewer.step(-1);
        this.updatePlayButton();
        break;
      case 'r':
        this.viewer.resetView();
        break;
      case 'g':
        this.viewer.setGround(!this.viewer.isGroundEnabled());
        break;
      default: {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= this.viewer.materials.modes.length) {
          const mode = this.viewer.materials.modes[n - 1].id;
          this.viewer.setMaterial(mode);
          this.materialSelect.value = mode;
        }
      }
    }
  };
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
