import { div } from '../../ui/dom';
import { checkbox, compactRange, section } from '../../ui/Panel';
import { colorPicker, type ColorPickerHandle } from '../../ui/ColorPicker';
import type { SculptSession } from '../bridge/SculptSession';
import type { Viewer } from '../../viewer/Viewer';
import { SidePanel } from './SidePanel';

/**
 * The Model panel (owner layout call): everything about the SELECTED
 * OBJECT's substance, on the right edge under Render and Tool. Material
 * values on top - the albedo/roughness/metalness that used to sit in the
 * Render panel's Material section, moved here because in sculpt mode they
 * are per-object properties, not scene-wide viewing choices (mode, matcap,
 * shading and wireframe stay in Render). Then Topology and Remesh, moved
 * out of the old Sculpt panel, which is per-tool and is now called Tool.
 */
export class ModelPanel extends SidePanel {
  private albedoPicker: ColorPickerHandle | null = null;
  private roughInput!: HTMLInputElement;
  private metalInput!: HTMLInputElement;
  private dyntopoCheckbox!: HTMLInputElement;
  private remeshResolution = 150;
  private topoBody?: HTMLDivElement;
  private dynDetailRows: Array<{ row: HTMLLabelElement; input: HTMLInputElement }> = [];

  constructor(
    private readonly session: SculptSession,
    private readonly viewer: Viewer,
  ) {
    super({ id: 'model', title: 'Model', side: 'right', variant: 'panel--model' });
    this.buildMaterial(this.body);
    this.buildTopology(this.body);
    this.buildRemesh(this.body);
    this.refreshTopology();
  }

  // --- Material: the active object's material VALUES ----------------------

  /**
   * Drives the same viewer.materials setters the Render panel used to -
   * mode.ts's hooks on Materials route the change into the active object's
   * material either way, so moving the rows here changed no plumbing.
   */
  private buildMaterial(body: HTMLElement): void {
    const sec = section(body, 'Material');
    const mats = this.viewer.materials;
    const state = mats.getMaterialState();
    // The shared HSV picker, owned for the panel's life (the popover is
    // body-mounted; disposing mid-drag closes it under the pointer).
    this.albedoPicker = colorPicker(state.albedo, (hex) => mats.setAlbedo(hex));
    const albedoRow = document.createElement('label');
    albedoRow.className = 'label-row';
    const albedoName = document.createElement('span');
    albedoName.textContent = 'Albedo';
    albedoRow.append(albedoName, this.albedoPicker.root);
    sec.appendChild(albedoRow);
    const rough = compactRange('Roughness', 0, 1, 0.01, state.roughness, (v) =>
      mats.setRoughness(v),
    );
    this.roughInput = rough.querySelector('input') as HTMLInputElement;
    sec.appendChild(rough);
    const metal = compactRange('Metalness', 0, 1, 0.01, state.metalness, (v) =>
      mats.setMetalness(v),
    );
    this.metalInput = metal.querySelector('input') as HTMLInputElement;
    sec.appendChild(metal);
  }

  /** Follow the selection (mode.ts calls this when the active material moves). */
  refreshMaterial(): void {
    const state = this.viewer.materials.getMaterialState();
    // While the popover is up, the picker is the source of truth; echoes of
    // its own drag must not fight the thumb being held.
    if (this.albedoPicker && !this.albedoPicker.isOpen()) this.albedoPicker.set(state.albedo);
    this.roughInput.value = String(state.roughness);
    this.metalInput.value = String(state.metalness);
  }

  // --- Topology + Remesh (moved from the old Sculpt panel) ----------------

  private buildTopology(body: HTMLElement): void {
    const sec = section(body, 'Topology');
    const dyn = checkbox('Dynamic topology', this.session.isDynamicTopology(), (on) => {
      // Turning it ON replaces the mesh and flattens the multires stack, so
      // it asks first (turning it off is the way back and needs no gate).
      if (on) {
        const ok = confirm(
          'Dynamic topology rebuilds the surface under every stroke, and the ' +
            'subdivision levels are flattened to the current resolution. ' +
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
    // the checkbox and grey out with it.
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
  }

  private buildRemesh(body: HTMLElement): void {
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

  private opButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sculpt-panel__btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
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

  /** Re-sync stateful controls after engine-side changes (undo, dyntopo). */
  refreshState(): void {
    this.dyntopoCheckbox.checked = this.session.isDynamicTopology();
    this.refreshTopology();
  }

  override dispose(): void {
    this.albedoPicker?.dispose();
    this.albedoPicker = null;
    super.dispose();
  }
}
