import { DEFAULT_CAVITY, type Viewer } from '../viewer/Viewer';
import type { ColourSource } from '../viewer/Materials';
import { div, labelRow, selectEl } from './dom';
import { colorPicker, type ColorPickerHandle } from './ColorPicker';
import { matcapPicker, type MatcapPickerHandle } from './MatcapPicker';
import { sliderText, typedSlider, type Limits } from './sliderEntry';
import { keyedLabel } from './keymap';

/**
 * Something a hotkey or a restore changed in the viewer (material mode,
 * matcap, shading, wireframe, the lights): panels that show those controls
 * read them again. The shortcuts send it (LookPanels.refreshControls).
 *
 * The row helpers below are the panels' shared building blocks; the look
 * panels (Lighting, Camera, Render) are in lookPanels.ts.
 */
export const CONTROLS_REFRESH_EVENT = 'bozzetto:controls-refresh';

/** Typed-value limits shared by the Render panel's sliders. */
export const AMOUNT: Limits = { min: 0 }; // an intensity, a strength, a softness: no less than none
export const FRACTION: Limits = { min: 0, max: 1 }; // an opacity, a roughness, a metalness, a blur
export const DEGREES: Limits = { min: 0, wrap: 360 }; // a turn, wrapped

/** The cavity's travel: its taps past about 12 px stamp offset copies of an edge onto the surface behind it, so the slider ends there; a wider one can be typed. */
export const CAVITY_STRENGTH_MAX = 2;
export const CAVITY_RADIUS_MIN = 2;
export const CAVITY_RADIUS_MAX = 12;

// --- tiny DOM helpers ----------------------------------------------------

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function section(parent: HTMLElement, heading: string): HTMLDivElement {
  const s = div('section');
  const h = document.createElement('h3');
  h.textContent = heading;
  s.appendChild(h);
  parent.appendChild(s);
  return s;
}

export function range(
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

/** How a slider row treats its value beyond the track. */
export interface SliderOptions {
  /**
   * The quantity's own limits, which a typed value is held to (see
   * sliderEntry): an intensity's floor of zero, a roughness's 0..1. None
   * means any number goes; the travel itself never limits a typed value.
   */
  limits?: Limits;
  /** Puts back what a first press does beyond moving the value (see TypedSlider.hold). */
  hold?: () => () => void;
  /** Printed after the value, in the readout and the drag bubble. */
  unit?: string;
  /** The value is printed times this (proportions 0.5..2 as 50..200%). */
  scale?: number;
  /** A slider that picks from a set (a subdivision level) takes no typing. */
  fixed?: boolean;
}

/**
 * A slider row: the caption, the track, and the value at the end, which
 * both kinds print always (a value past the travel shows as typed).
 */
function sliderRow(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => string | void,
  opts: SliderOptions,
  numbered: boolean,
): { row: HTMLLabelElement; input: HTMLInputElement; val: HTMLSpanElement } {
  const row = document.createElement('label');
  row.className = 'compact';
  const span = document.createElement('span');
  span.textContent = label;
  const val = document.createElement('span');
  const apply = (v: number): void => {
    const text = onInput(v);
    if (numbered && typeof text === 'string') val.textContent = text;
  };
  const input = range(min, max, step, value, apply);
  if (opts.unit) input.dataset.unit = opts.unit;
  if (opts.scale) input.dataset.scale = String(opts.scale);
  row.append(span, input, val);
  if (numbered) {
    val.className = 'sculpt-panel__val';
    val.textContent = sliderText(input, value);
  } else {
    val.className = 'slider-val';
    val.textContent = sliderText(input, value);
  }
  if (!opts.fixed) {
    typedSlider(
      input,
      {
        apply,
        limits: opts.limits,
        hold: opts.hold,
        readout: numbered ? undefined : (v) => void (val.textContent = sliderText(input, v)),
      },
      value,
    );
  }
  return { row, input, val };
}

/** A captioned slider; a value typed past its travel is shown at the row's end. */
export function compactRange(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
  opts: SliderOptions = {},
): HTMLLabelElement {
  return sliderRow(label, min, max, step, value, (v) => void onInput(v), opts, false).row;
}

/**
 * A compact slider with its value printed at the right: `onInput` applies a
 * value and returns that text. `unit` and `scale` ride on the input for
 * the drag bubble, which prints the same number the readout does.
 */
export function numberedRange(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => string,
  opts: SliderOptions = {},
): { row: HTMLLabelElement; input: HTMLInputElement; val: HTMLSpanElement } {
  return sliderRow(label, min, max, step, value, onInput, opts, true);
}

export function labelled(label: string, build: () => HTMLElement): HTMLLabelElement {
  return labelRow(label, build());
}

export function checkbox(
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

/**
 * The display half of the material: how the model is drawn (Mode, and under
 * it the matcap gallery or, over a published model, its colour source and
 * albedo, roughness and metalness), Smooth shading, Wireframe and Wire
 * opacity. One builder for both places that show it: the Render panel of the
 * public viewer, and the Material panel of the workspaces. It owns its
 * section, built again by rebuild(), and its pickers, kept across rebuilds:
 * a picker's own drag echoes back through a look restore, and disposing it
 * closed its popover under the pointer.
 */
export class MaterialControls {
  /** The section, to put where it belongs. */
  readonly root: HTMLDivElement;
  private modeSelect?: HTMLSelectElement;
  private options?: HTMLDivElement;
  private smoothCheckbox?: HTMLInputElement;
  private wireframeCheckbox?: HTMLInputElement;
  private albedoPicker?: ColorPickerHandle;
  /** The matcap gallery popout's trigger, reused like the colour pickers. */
  private mcPicker?: MatcapPickerHandle;
  private readonly sculpting: boolean;
  private readonly cavity: boolean;
  /** Sculpt's Material panel: the Colour choice (albedo and paint, albedo only, paint only) after Mode. */
  private readonly colour: boolean;
  /** The workspace in front has paint to choose between (Armature's mannequin has none). */
  private colourOffered = true;
  private cavityHost?: HTMLDivElement;
  /** The cavity strength to come back to after it was switched off (zero is its "off"). */
  private cavityStrength: number = DEFAULT_CAVITY.strength;

  /** Present opens or closes over the sculpt: the choices are read again (the Colour choice is there in every workspace). */
  private readonly onPresent = (): void => {
    if (this.options && this.root.isConnected) this.rebuildOptions();
  };

  /**
   * `sculpting`: Sculpt or Armature, where albedo, roughness and metalness
   * are the active object's and live in the Material panel's Surface
   * section; otherwise they are the published model's, offered here.
   */
  constructor(
    private readonly viewer: Viewer,
    opts: { sculpting: boolean; heading?: string; cavity?: boolean; colour?: boolean },
  ) {
    this.sculpting = opts.sculpting;
    this.colour = !!opts.colour;
    this.cavity = !!opts.cavity;
    this.root = div('section');
    const h = document.createElement('h3');
    h.textContent = opts.heading ?? 'Material';
    this.root.appendChild(h);
    window.addEventListener('bozzetto:present', this.onPresent);
  }

  /** Build the controls again from the viewer's live state. */
  /** Show or hide the Colour choice (paint against albedo) for the workspace in front. */
  setColourOffered(on: boolean): void {
    if (on === this.colourOffered) return;
    this.colourOffered = on;
    this.rebuild();
  }

  rebuild(): void {
    const material = this.root;
    while (material.children.length > 1) material.lastElementChild!.remove();

    const modeSelect = document.createElement('select');
    this.modeSelect = modeSelect;
    for (const mode of this.viewer.materials.modes) {
      const opt = document.createElement('option');
      opt.value = mode.id;
      opt.textContent = mode.label;
      modeSelect.appendChild(opt);
    }
    modeSelect.value = this.viewer.getMaterial();
    modeSelect.addEventListener('change', () => {
      this.viewer.setMaterial(modeSelect.value);
      this.rebuildOptions();
      // The Scene panel's Material row shows the mode too.
      window.dispatchEvent(new Event(CONTROLS_REFRESH_EVENT));
    });
    material.appendChild(labelRow('Mode', modeSelect));

    this.options = div('mat-options');
    material.appendChild(this.options);
    this.rebuildOptions();

    // Smooth shading on by default; unchecking it gives faceted/flat shading.
    const smooth = checkbox('Smooth shading', !this.viewer.materials.isFlatShading(), (on) =>
      this.viewer.materials.setFlatShading(!on),
    );
    this.smoothCheckbox = smooth.querySelector('input')!;
    material.appendChild(smooth);

    // The label is the name alone; the hotkey is in the tooltip and the View menu.
    const wire = checkbox('Wireframe', this.viewer.isWireframe(), (on) => this.viewer.setWireframe(on));
    wire.title = keyedLabel('Wireframe', 'view.wireframe');
    this.wireframeCheckbox = wire.querySelector('input')!;
    material.appendChild(wire);

    material.appendChild(
      compactRange(
        'Wire opacity',
        0,
        1,
        0.05,
        this.viewer.getWireframeOpacity(),
        (v) => this.viewer.setWireframeOpacity(v),
        { limits: FRACTION },
      ),
    );

    // Cavity: Sculpt's own form shading (the depth SSAO of its composite),
    // which keeps creases readable on flat-shaded facets. Switching it on
    // turns GTAO off, as the two would darken the same creases twice.
    if (this.cavity) {
      this.cavityHost = div('cavity-rows');
      material.appendChild(this.cavityHost);
      this.rebuildCavity();
    }
  }

  private rebuildCavity(): void {
    const host = this.cavityHost;
    if (!host) return;
    host.replaceChildren();
    const cav = this.viewer.getSculptAO();
    if (cav.strength > 0) this.cavityStrength = cav.strength;
    const on = cav.strength > 0;
    const sw = checkbox('Cavity', on, (v) => {
      if (v) {
        if (this.viewer.aoAvailable()) this.viewer.setAO({ enabled: false });
        this.viewer.setSculptAO({ strength: this.cavityStrength });
      } else {
        this.viewer.setSculptAO({ strength: 0 });
      }
      this.rebuildCavity();
    });
    sw.dataset.role = 'cavity';
    host.appendChild(sw);
    if (!on) return;
    host.appendChild(
      compactRange('Strength', 0, CAVITY_STRENGTH_MAX, 0.05, this.cavityStrength, (v) => {
        this.cavityStrength = v;
        this.viewer.setSculptAO({ strength: v });
      }, { limits: AMOUNT }),
    );
    host.appendChild(
      compactRange('Radius', CAVITY_RADIUS_MIN, CAVITY_RADIUS_MAX, 1, cav.radius, (v) => this.viewer.setSculptAO({ radius: v }), {
        limits: { min: 1 },
        unit: ' px',
      }),
    );
  }

  /** Re-sync controls that hotkeys can change (material mode, matcap, shading, wireframe). */
  refresh(): void {
    if (!this.modeSelect || !this.smoothCheckbox || !this.wireframeCheckbox) return;
    this.modeSelect.value = this.viewer.getMaterial();
    this.rebuildOptions();
    this.smoothCheckbox.checked = !this.viewer.materials.getMaterialState().flatShading;
    this.wireframeCheckbox.checked = this.viewer.isWireframe();
    // The Render tab may have switched it off, or GTAO on, since.
    if (this.cavityHost && !this.cavityHost.contains(document.activeElement)) this.rebuildCavity();
  }

  /** The popovers are body-mounted: closing the panel takes them along. */
  closePopovers(): void {
    this.albedoPicker?.close();
    this.mcPicker?.close();
  }

  dispose(): void {
    window.removeEventListener('bozzetto:present', this.onPresent);
    this.albedoPicker?.dispose();
    this.mcPicker?.dispose();
    this.root.remove();
  }

  private rebuildOptions(): void {
    const host = this.options;
    if (!host) return;
    host.replaceChildren();
    const mats = this.viewer.materials;
    const state = mats.getMaterialState();

    if (this.viewer.getMaterial() === 'lit' && this.colour && this.colourOffered) {
      // A sculpt, in Sculpt, Paint and Present alike: which of the two factors
      // the shader uses. The albedo itself stays per object, in the Surface
      // section; nothing about the paint or the material is changed here.
      const source = selectEl(
        [
          ['both', 'Albedo and paint'],
          ['albedo', 'Albedo only'],
          ['paint', 'Paint only'],
        ],
        mats.getColourSource(),
      );
      source.addEventListener('change', () => mats.setColourSource(source.value as ColourSource));
      host.appendChild(labelRow('Colour', source));
    } else if (this.viewer.getMaterial() === 'lit' && !this.sculpting) {
      // In sculpt mode these three are PER-OBJECT material values and live
      // in the Surface section; here they would edit whichever object happens
      // to be selected while dressed as scene-wide controls.
      // A sculpt published from Sculpt mode carries its paint as vertex
      // colours, which replace the albedo outright (Materials), so the
      // albedo did nothing to one (owner report). Its own colours or one
      // plain colour, the albedo's: offered only where there are colours
      // to choose between, and saved with the look like the rest.
      const painted = mats.hasModelVertexColors();
      const plain = state.vertexColors === false;
      if (painted) {
        const source = selectEl(
          [
            ['sculpt', 'Sculpt colours'],
            ['plain', 'Plain colour'],
          ],
          plain ? 'plain' : 'sculpt',
        );
        source.addEventListener('change', () => {
          mats.setPlainColor(source.value === 'plain');
          this.rebuildOptions(); // the albedo row comes or goes
        });
        host.appendChild(labelRow('Colour', source));
      }
      // The shared HSV picker, not <input type="color">: the same control
      // the paint brush uses, so albedo and paint are picked the same way.
      // REUSED across rebuilds, never recreated: the picker's own slider
      // drag echoes back through look-restored and lands here mid-drag,
      // and disposing closed the popover under the pointer (owner report).
      // While the popover is up, the picker is the source of truth, so the
      // echo's set() is skipped too - it would fight the thumb being held.
      if (!this.albedoPicker) {
        this.albedoPicker = colorPicker(state.albedo, (hex) => mats.setAlbedo(hex));
      } else if (!this.albedoPicker.isOpen()) {
        this.albedoPicker.set(state.albedo);
      }
      // Over the model's own colours the albedo sets nothing, so it is not
      // offered; its popover goes with the row if it was up.
      if (!painted || plain) {
        host.appendChild(labelRow('Albedo', this.albedoPicker.root));
      } else {
        this.albedoPicker.close();
      }
      host.appendChild(
        compactRange('Roughness', 0, 1, 0.01, state.roughness, (v) => mats.setRoughness(v), { limits: FRACTION }),
      );
      host.appendChild(
        compactRange('Metalness', 0, 1, 0.01, state.metalness, (v) => mats.setMetalness(v), { limits: FRACTION }),
      );
    } else if (this.viewer.getMaterial() === 'matcap') {
      // A thumbnail gallery in a POPOUT, not a dropdown or inline rows
      // (owner calls): matcaps are pictures, picking one by name was a
      // guessing game, and fourteen thumbs ate half the section. The
      // trigger swatch shows the active matcap; the handle is reused
      // across rebuilds so refresh (2..9 hotkeys, look restores)
      // just re-syncs the ring and the trigger.
      if (mats.matcaps().length > 1) {
        if (!this.mcPicker) {
          this.mcPicker = matcapPicker(
            () => this.viewer.materials.matcaps(),
            () => this.viewer.materials.getMaterialState().matcapIndex,
            (i) => {
              this.viewer.materials.setMatcapIndex(i);
              window.dispatchEvent(new Event(CONTROLS_REFRESH_EVENT));
            },
          );
        } else {
          this.mcPicker.refresh();
        }
        host.appendChild(labelRow('Matcap', this.mcPicker.root));
      }
    }
  }
}
