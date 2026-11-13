import Enums from '@sculpt-vendor/misc/Enums';
import { div, onTap } from '../../ui/dom';
import { hexToPacked, TooManyGroups } from '../bridge/polyGroups';
import { GeometrySync } from '../bridge/GeometrySync';
import { installSwatchPick } from '../../ui/swatchPick';
import { checkbox, compactRange, section, numberedRange, type SliderOptions } from '../../ui/Panel';
import { setSliderValue, type Limits } from '../../ui/sliderEntry';

/** Typed-value limits (sliderEntry). */
const FRACTION: Limits = { min: 0, max: 1 };
const AMOUNT: Limits = { min: 0 };
/**
 * The voxel grid the remesher will build, as SculptSession holds it: up to
 * 512 cells across (owner call), as far as this device's memory allows
 * (remeshBudget). The sliders here and in Armature travel all the way.
 */
export const VOXEL_RESOLUTION: Limits = { min: REMESH_LIMITS.min, max: REMESH_LIMITS.max, integer: true };
export const VOXEL_SLIDER = { min: 16, max: REMESH_LIMITS.max, step: 2 } as const;
import { colorPicker, type ColorPickerHandle } from '../../ui/ColorPicker';
import type { SculptSession } from '../bridge/SculptSession';
import type { Viewer } from '../../viewer/Viewer';
import { REMESH_LIMITS, RemeshTooLarge } from '../bridge/remeshBudget';
import { SidePanel } from './SidePanel';
import { statusToast } from './statusToast';
import { showWhileHeld, VoxelOverlay } from './VoxelOverlay';
import { formatSceneLength } from '../../viewer/units';
import { voxelGrid } from '../bridge/remeshBudget';
import {
  defaultQuadTarget,
  QUAD_TARGET,
  quadRemesh,
  QuadRemeshError,
  type QuadRemeshJob,
  type QuadRemeshProgress,
  type QuadRemeshResult,
} from '../bridge/quadRemesh';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';

/** Target faces: the slider's travel (in single faces) and the typed value's limits. */
const QUAD_LIMITS: Limits = { min: QUAD_TARGET.min, max: QUAD_TARGET.max, integer: true };

/**
 * Extract's thickness: the vendor's offset along the normal, in world
 * units. On real units the slider is in millimetres, up to 3 cm, and
 * starts at 5 mm - about what the old default of one unit was on its
 * 48-unit sphere; a scene from before real units keeps those units.
 */
const EXTRACT_MM = { min: 0, max: 30, step: 0.5, start: 5 } as const;
const EXTRACT_LEGACY = { min: 0, max: 6, step: 0.1, start: 1 } as const;

/**
 * The Model panel (owner layout call): everything about the SELECTED
 * OBJECT's substance, on the left edge under Scene, the list it is the
 * other half of (owner call: it sat on the right under Render). Topology
 * and Remesh on top, moved out of the old Sculpt panel, which is per-tool
 * and is now called Tool, then Mask, which followed them (owner call): its
 * operations and Extract act on the active object's mask, not on how a
 * brush behaves. The object's material values (albedo, roughness,
 * metalness) are the Material panel's (ui/MaterialPanel.ts).
 */
export class ModelPanel extends SidePanel {
  private dyntopoCheckbox!: HTMLInputElement;
  private remeshResolution = 150;
  /** The voxel grid over the view while the Resolution slider is held. */
  private voxelOverlay: VoxelOverlay | null = null;
  /** In world units: centimetres on real units, the scene's own before them. */
  private extractThickness = EXTRACT_MM.start / 10;
  /** The scale the Extract row was built for, rebuilt when the scene's changes. */
  private extractOnUnits = true;
  private extractHost?: HTMLDivElement;
  /** "One voxel: 1.7 mm" for the active object at the resolution set. */
  private voxelLine?: HTMLDivElement;
  /**
   * The active object's remesh box, read when the object changes rather
   * than on every step of the slider: it walks every vertex.
   */
  private voxelBox: number[] | null = null;
  private topoBody?: HTMLDivElement;
  private mergeBtn?: HTMLButtonElement;
  /** Merge, under Remesh: the Edit menu's Merge (the mount wires it to the Scene panel's). */
  onMerge: (() => void) | null = null;
  private dynDetailRows: Array<{ row: HTMLLabelElement; input: HTMLInputElement }> = [];

  // Quad remesh (QuadriFlow in a worker, bridge/quadRemesh.ts).
  private quadTarget: number = QUAD_TARGET.min;
  /** The object the target's default was taken from (by id): another one resets it. */
  private quadTargetFor = -1;
  private quadSharp = false;
  private quadBoundary = false;
  /** Owner decision: offered, off by default. */
  private quadAdaptive = false;
  private quadTargetInput?: HTMLInputElement;
  private quadButton?: HTMLButtonElement;
  private quadProgressRow?: HTMLDivElement;
  private quadBar?: HTMLProgressElement;
  private quadStage?: HTMLDivElement;
  /** The run under way, and the object it is on. */
  private quadJob: { job: QuadRemeshJob; mesh: SculptMesh } | null = null;
  /** The last run's stages as they arrived, and its result (for the console and the tests). */
  quadStages: QuadRemeshProgress[] = [];
  lastQuad: (Omit<QuadRemeshResult, 'positions' | 'faces'> & { faces: number }) | null = null;
  /**
   * A quad remesh started or ended on an object (mode.ts redraws it as
   * locked, and the outliner and the gizmo follow).
   */
  onQuadBusy: (() => void) | null = null;
  /** Set once the mode is left: a run it cancelled says nothing afterwards. */
  private disposed = false;

  // Poly groups (polyGroups.ts).
  private groupsList?: HTMLDivElement;
  private groupsColors?: HTMLInputElement;
  private uvButton?: HTMLButtonElement;
  private showAllButton?: HTMLButtonElement;
  private clearGroupsButton?: HTMLButtonElement;
  /** Group by angle's threshold, in degrees (owner default 40). */
  private groupAngle = 40;
  /** The group whose name is being typed, so a refresh mid-edit leaves the field be. */
  private renamingGroup = -1;
  /** The Groups list's colour pickers, one a row (rebuilt with the list). */
  private groupPickers: ColorPickerHandle[] = [];
  /**
   * The group whose colour is being picked, and the colour it had before
   * (0xRRGGBB or the default): the picker previews, and its close (or the
   * end of a drag over the view) commits one undo step.
   */
  private pickingGroup: { mesh: SculptMesh; g: number; before: number } | null = null;
  /** Shift+F's switch (mode.ts turns the colours on or off). */
  onGroupColors: ((on: boolean) => void) | null = null;
  /** From mask (Ctrl+G's twin). */
  onGroupFromMask: (() => void) | null = null;

  constructor(
    private readonly session: SculptSession,
    private readonly viewer: Viewer,
  ) {
    super({ id: 'model', title: 'Model', side: 'left', variant: 'panel--model' });
    this.buildTopology(this.body);
    this.buildRemesh(this.body);
    this.buildQuadRemesh(this.body);
    this.buildMask(this.body);
    this.buildGroups(this.body);
    this.refreshTopology();
    this.refreshHeading();
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
    // (they are its subdivision/decimation aggressiveness), so they fold
    // away with the checkbox.
    const detail = this.session.getDynTopoDetail();
    this.dynDetailRows = [
      this.numberedRange(
        'Stroke subdivision',
        0,
        100,
        1,
        detail.subdivision,
        (v) => {
          this.session.setDynTopoDetail({ subdivision: v });
          return String(Math.round(v));
        },
        { limits: { min: 0, max: 100 } },
      ),
      this.numberedRange(
        'Stroke decimation',
        0,
        100,
        1,
        detail.decimation,
        (v) => {
          this.session.setDynTopoDetail({ decimation: v });
          return String(Math.round(v));
        },
        { limits: { min: 0, max: 100 } },
      ),
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
    const res = this.numberedRange(
      'Resolution',
      VOXEL_SLIDER.min,
      VOXEL_SLIDER.max,
      VOXEL_SLIDER.step,
      this.remeshResolution,
      (v) => {
        this.remeshResolution = v;
        this.session.setRemeshResolution(v); // Merge (Edit menu, and below) reads it too
        this.refreshVoxel();
        return String(Math.round(v));
      },
      { limits: VOXEL_RESOLUTION },
    );
    remesh.appendChild(res.row);
    // How big a voxel is on the active object, the size the detail a
    // remesh keeps comes down to (owner decision: in centimetres).
    this.voxelLine = div('sculpt-panel__hint muted');
    this.voxelLine.dataset.role = 'voxel-size';
    remesh.appendChild(this.voxelLine);
    this.refreshVoxel(true);
    // The grid this resolution builds on the active object, over the view
    // while the slider is held (owner request).
    this.voxelOverlay = new VoxelOverlay(this.viewer, () => this.session.getUnits());
    showWhileHeld(res.input, this.voxelOverlay, () => this.session.remeshBox());
    const row = div('sculpt-panel__row');
    row.appendChild(
      this.opButton('Voxel remesh', () => {
        try {
          this.session.voxelRemesh(this.remeshResolution);
        } catch (err) {
          // Too much for this device's memory: said, and nothing changed.
          if (!(err instanceof RemeshTooLarge)) throw err;
          statusToast('Remeshing...').fail(err.message);
        }
      }),
    );
    // Merge goes through the same voxel grid, at this resolution, so it
    // sits beside the remesh as well as in the Edit menu (owner call).
    // Needs two objects, so it greys out until there are.
    this.mergeBtn = this.opButton('Merge', () => this.onMerge?.());
    this.mergeBtn.title = 'Merge the selected objects into one (ctrl+j)';
    this.mergeBtn.disabled = true;
    row.appendChild(this.mergeBtn);
    remesh.appendChild(row);
  }

  // --- Quad remesh ----------------------------------------------------------

  /**
   * QuadriFlow's quad remesh of the active object, under Remesh: a target
   * face count (a quarter of the object's faces to start with, 500 to
   * 50000), its three options, and the button, greyed out over a progress
   * bar with the stage and Cancel while it runs. The run is in a worker,
   * so the interface stays usable; the object it is on is locked against
   * strokes and the gizmo until it ends (SculptSession.setQuadBusy), and a
   * result for an object that changed anyway is refused.
   */
  private buildQuadRemesh(body: HTMLElement): void {
    const sec = section(body, 'Quad remesh');
    sec.dataset.role = 'quad-remesh';
    const target = this.numberedRange(
      'Target faces',
      QUAD_TARGET.min,
      QUAD_TARGET.max,
      1,
      this.quadTarget,
      (v) => {
        this.quadTarget = Math.round(v);
        return String(this.quadTarget);
      },
      { limits: QUAD_LIMITS },
    );
    this.quadTargetInput = target.input;
    sec.appendChild(target.row);
    sec.append(
      checkbox('Keep sharp edges', this.quadSharp, (on) => {
        this.quadSharp = on;
      }),
      checkbox('Keep open borders', this.quadBoundary, (on) => {
        this.quadBoundary = on;
      }),
      checkbox('Adaptive quad size', this.quadAdaptive, (on) => {
        this.quadAdaptive = on;
      }),
    );
    const row = div('sculpt-panel__row');
    this.quadButton = this.opButton('Quad remesh', () => void this.runQuadRemesh());
    this.quadButton.title = 'Rebuild the active object as quads (QuadriFlow)';
    row.appendChild(this.quadButton);
    sec.appendChild(row);
    // While it runs: the stage, the bar and Cancel.
    this.quadProgressRow = div('sculpt-panel__quad-progress');
    this.quadProgressRow.hidden = true;
    this.quadStage = div('sculpt-panel__hint');
    this.quadStage.dataset.role = 'quad-stage';
    this.quadBar = document.createElement('progress');
    this.quadBar.className = 'sculpt-panel__progress';
    this.quadBar.max = 100;
    this.quadBar.value = 0;
    this.quadBar.setAttribute('aria-label', 'Quad remesh progress');
    const cancel = this.opButton('Cancel', () => this.quadJob?.job.cancel());
    const bar = div('sculpt-panel__row sculpt-panel__quad-bar');
    bar.append(this.quadBar, cancel);
    this.quadProgressRow.append(this.quadStage, bar);
    sec.appendChild(this.quadProgressRow);
    this.refreshQuadTarget();
  }

  /** The target's default follows the active object: a quarter of its faces, 500 to 50000. */
  private refreshQuadTarget(): void {
    const mesh = this.session.getMesh();
    if (!mesh || !this.quadTargetInput || mesh.getID() === this.quadTargetFor) return;
    this.quadTargetFor = mesh.getID();
    this.quadTarget = defaultQuadTarget(mesh.getNbFaces());
    setSliderValue(this.quadTargetInput, this.quadTarget);
  }

  private showQuadProgress(p: QuadRemeshProgress | null): void {
    if (!this.quadProgressRow || !this.quadButton || !this.quadBar || !this.quadStage) return;
    this.quadProgressRow.hidden = !p;
    this.quadButton.disabled = !!p;
    if (!p) return;
    this.quadBar.value = p.percent;
    this.quadStage.textContent = `${p.label}... ${Math.round(p.percent)}%`;
  }

  /** Quad remesh the active object with the panel's settings; resolves when it has ended. */
  async runQuadRemesh(): Promise<boolean> {
    const mesh = this.session.getMesh();
    if (!mesh || this.quadJob) return false;
    if (this.session.isPadlocked(mesh)) {
      statusToast('').fail('This object is locked. Unlock it in the Scene panel to quad remesh it.');
      return false;
    }
    const input = this.session.quadRemeshInput(mesh);
    if (!input) return false;
    const opts = { target: this.quadTarget, sharp: this.quadSharp, boundary: this.quadBoundary, adaptive: this.quadAdaptive, seed: 0 };
    this.quadStages = [];
    this.lastQuad = null;
    const job = quadRemesh(input.positions, input.faces, opts, (p) => {
      this.quadStages.push(p);
      if (this.quadJob?.job === job) this.showQuadProgress(p);
    });
    this.quadJob = { job, mesh };
    this.session.setQuadBusy(mesh, true);
    this.onQuadBusy?.();
    this.showQuadProgress({ stage: -2, name: 'module', label: 'Loading QuadriFlow', percent: 0 });
    let ok = false;
    try {
      const r = await job.promise;
      this.session.setQuadBusy(mesh, false);
      this.session.applyQuadRemesh(mesh, input.stamp, r.positions, r.faces);
      this.lastQuad = { quads: r.quads, triangles: r.triangles, report: r.report, args: r.args, ms: r.ms, faces: r.quads + r.triangles };
      const shape = r.triangles ? `${r.quads} quads and ${r.triangles} triangles` : `${r.quads} quads`;
      statusToast('').done(`Quad remesh: ${shape} (${(r.ms.total / 1000).toFixed(1)} s)`);
      ok = true;
    } catch (err) {
      if (this.disposed) {
        // Left with the mode: nothing to say, and nothing was applied.
      } else if (err instanceof QuadRemeshError && err.kind === 'cancelled') {
        statusToast('').done('Quad remesh cancelled; the object is as it was.');
      } else {
        statusToast('').fail(err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.session.setQuadBusy(mesh, false);
      if (this.quadJob?.job === job) this.quadJob = null;
      if (!this.disposed) {
        this.showQuadProgress(null);
        this.onQuadBusy?.();
        this.refreshState();
      }
    }
    return ok;
  }

  /** Whether a quad remesh is running (the tests and mode.ts's leave). */
  isQuadRunning(): boolean {
    return !!this.quadJob;
  }

  /** Cancel a quad remesh under way (leaving the mode, the tests). */
  cancelQuadRemesh(): void {
    this.quadJob?.job.cancel();
  }

  // --- Mask (moved from the Tool panel) -------------------------------------

  /**
   * The mask's darkening, its four operations and Extract, on the active
   * object as they always were. Painting a mask is still the Mask brush's
   * (Ctrl + drag), and the Ctrl + A / C / I / H / E keys are unchanged;
   * Ctrl + E extracts at the thickness set here.
   */
  private buildMask(body: HTMLElement): void {
    const sec = section(body, 'Mask');
    sec.appendChild(
      compactRange(
        'Darken',
        0.05,
        1,
        0.05,
        this.viewer.materials.getMaskDarken(),
        (v) => this.viewer.materials.setMaskDarken(v),
        { limits: FRACTION },
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

    this.extractHost = div('sculpt-panel__extract');
    sec.appendChild(this.extractHost);
    this.buildExtract();
    const extractRow = div('sculpt-panel__row');
    extractRow.appendChild(
      this.opButton('Extract masked', () => {
        this.session.extractMasked(this.extractThickness);
      }),
    );
    sec.appendChild(extractRow);
  }

  // --- Poly groups --------------------------------------------------------------

  /**
   * The active object's poly groups (owner decisions, 2026-10-31): the
   * colours' switch (Shift+F), the ways to make groups - From mask
   * (Ctrl+G), By angle at the threshold set, By UV islands for an OBJ with
   * texture coordinates - and Show all; then a row a group, with its
   * colour, its name (tap to rename), an eye and a delete. Every change is
   * one undo step.
   */
  private buildGroups(body: HTMLElement): void {
    const sec = section(body, 'Poly groups');
    sec.dataset.role = 'groups';
    const colors = checkbox('Show group colours (Shift+F)', this.session.groups.isShowing(), (on) => this.onGroupColors?.(on));
    this.groupsColors = colors.querySelector('input') as HTMLInputElement;
    sec.appendChild(colors);
    // Group: every way of making groups, each one undo step (owner call,
    // 2026-11-01: By angle and By UV islands under this heading, with
    // Visible, Auto and Clear all; From mask joins them, as it makes a
    // group too).
    sec.appendChild(subheading('Group'));
    const make = div('sculpt-panel__row');
    const fromMask = this.tapButton('From mask', () => this.onGroupFromMask?.());
    fromMask.title = 'The masked faces into a new group, the mask cleared (Ctrl+G)';
    fromMask.dataset.role = 'groups-from-mask';
    const visible = this.tapButton('Visible', () => this.groupOne((m) => this.session.groups.groupVisible(m), 'Nothing is showing to group.'));
    visible.title = 'Every face that shows into one new group; hidden faces keep theirs';
    visible.dataset.role = 'groups-visible';
    const auto = this.tapButton('Auto', () => this.groupBy(() => this.session.groups.autoIslands(this.session.getMesh()!)));
    auto.title = 'A group for each separate piece of the mesh';
    auto.dataset.role = 'groups-auto';
    make.append(fromMask, visible, auto);
    sec.appendChild(make);
    const angle = this.numberedRange(
      'Angle',
      1,
      90,
      1,
      this.groupAngle,
      (v) => {
        this.groupAngle = Math.round(v);
        return `${this.groupAngle} deg`;
      },
      { limits: { min: 1, max: 179 } },
    );
    sec.appendChild(angle.row);
    const split = div('sculpt-panel__row');
    const byAngle = this.tapButton('By angle', () => this.groupBy(() => this.session.groups.byAngle(this.session.getMesh()!, this.groupAngle)));
    byAngle.title = 'A group for each piece between edges sharper than the angle';
    byAngle.dataset.role = 'groups-by-angle';
    this.uvButton = this.tapButton('By UV islands', () => this.groupBy(() => this.session.groupByUVIslands()));
    this.uvButton.title = 'A group for each UV island (an OBJ imported with texture coordinates)';
    this.uvButton.dataset.role = 'groups-by-uv';
    split.append(byAngle, this.uvButton);
    sec.appendChild(split);
    const clearRow = div('sculpt-panel__row');
    const clear = this.tapButton('Clear all', () => {
      const mesh = this.session.getMesh();
      if (mesh && this.session.groups.clearAll(mesh)) statusToast('').done('One poly group');
    });
    clear.title = 'Every face back in one group, "Group 1", nothing hidden';
    clear.dataset.role = 'groups-clear';
    this.clearGroupsButton = clear;
    const prune = this.tapButton('Remove unused', () => {
      const mesh = this.session.getMesh();
      const n = mesh ? this.session.groups.removeUnused(mesh) : 0;
      if (n > 0) statusToast('').done(n === 1 ? 'Removed 1 unused group' : `Removed ${n} unused groups`);
      else statusToast('').done('No unused groups');
    });
    prune.title = 'Remove the groups no face is in any more';
    prune.dataset.role = 'groups-remove-unused';
    clearRow.append(clear, prune);
    sec.appendChild(clearRow);
    // Groups: the list, and Show all for what it hides.
    sec.appendChild(subheading('Groups'));
    const showRow = div('sculpt-panel__row');
    this.showAllButton = this.tapButton('Show all', () => {
      const mesh = this.session.getMesh();
      if (mesh) this.session.groups.showAll(mesh);
    });
    this.showAllButton.title = 'Show every group (Ctrl+Shift+click on empty space)';
    this.showAllButton.dataset.role = 'groups-show-all';
    showRow.append(this.showAllButton);
    sec.appendChild(showRow);
    this.groupsList = div('groups-list');
    this.groupsList.dataset.role = 'groups-list';
    sec.appendChild(this.groupsList);
    this.refreshGroups();
  }

  /** Make one group (Visible), saying which, or `none` when it made nothing. */
  private groupOne(run: (mesh: SculptMesh) => number, none: string): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    try {
      const g = run(mesh);
      if (g < 0) statusToast('').fail(none);
      else statusToast('').done(`${this.session.groups.names(mesh)[g]}: the visible faces`);
    } catch (err) {
      if (!(err instanceof TooManyGroups)) throw err;
      statusToast('').fail(err.message);
    }
  }

  /** Run a regrouping, saying so when it makes too many groups. */
  private groupBy(run: () => number): void {
    if (!this.session.getMesh()) return;
    try {
      const n = run();
      if (n > 0) statusToast('').done(`${n} poly group${n === 1 ? '' : 's'}`);
    } catch (err) {
      if (!(err instanceof TooManyGroups)) throw err;
      statusToast('').fail(err.message);
    }
  }

  /** At most this many rows; a split into more lists the first and says how many more. */
  private static readonly GROUP_ROWS = 200;

  /** Redraw the Groups list for the active object (any change to its groups, another object). */
  refreshGroups(): void {
    const list = this.groupsList;
    if (!list) return;
    if (this.groupsColors) this.groupsColors.checked = this.session.groups.isShowing();
    const mesh = this.session.getMesh();
    if (this.uvButton) this.uvButton.disabled = !mesh || !this.session.hasUVIslands(mesh);
    if (this.clearGroupsButton) this.clearGroupsButton.disabled = !mesh || !this.session.groups.hasGroups(mesh);
    if (this.renamingGroup >= 0 && list.contains(document.activeElement)) return;
    // A picker that is up keeps its row; its close refreshes the list.
    if (this.groupPickers.some((p) => p.isOpen())) return;
    this.renamingGroup = -1;
    for (const p of this.groupPickers) p.dispose();
    this.groupPickers = [];
    list.replaceChildren();
    if (!mesh) return;
    const groups = this.session.groups;
    const names = groups.names(mesh);
    const hidden = groups.hiddenGroups(mesh);
    const counts = groups.counts(mesh);
    if (this.showAllButton) this.showAllButton.disabled = !hidden.some(Boolean);
    const colors = groups.colors(mesh);
    const rows = Math.min(names.length, ModelPanel.GROUP_ROWS);
    for (let g = 0; g < rows; g++) {
      const row = div('groups-row');
      row.dataset.group = String(g);
      if (hidden[g]) row.classList.add('groups-row--hidden');
      const swatch = this.groupSwatch(mesh, g, names[g], colors[g]);
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'groups-row__name';
      name.textContent = names[g];
      name.title = `${names[g]}: ${counts[g]} base face${counts[g] === 1 ? '' : 's'} (tap to rename)`;
      onTap(name, () => this.renameGroup(mesh, g, name));
      const eye = this.groupIcon(hidden[g] ? 'fi-ss-eye-crossed' : 'fi-ss-eye', hidden[g] ? 'Show' : 'Hide', () => groups.setHidden(mesh, g, !hidden[g]));
      eye.dataset.role = 'group-eye';
      const del = this.groupIcon('fi-ss-trash', 'Delete the group (its faces join the group they border most)', () => groups.remove(mesh, g));
      del.dataset.role = 'group-delete';
      del.disabled = names.length <= 1;
      row.append(swatch, name, eye, del);
      list.appendChild(row);
    }
    if (names.length > rows) {
      const more = div('sculpt-panel__hint muted');
      more.textContent = `and ${names.length - rows} more`;
      list.appendChild(more);
    }
  }

  /**
   * A row's colour swatch (owner request, 2026-11-01): a tap opens the
   * app's colour picker, a drag over the view samples the frame, as every
   * other swatch does. The colour shows on the group's faces as it moves
   * (the Shift+F colours come on if they were off); closing the picker, or
   * letting go of a drag, makes it one undo step.
   */
  private groupSwatch(mesh: SculptMesh, g: number, name: string, packed: number): HTMLElement {
    const groups = this.session.groups;
    // The colours come on as the popover opens; under a drag only once it
    // ends, since turning them on rebuilds the list, the swatch with it.
    const begin = (drag: boolean): void => {
      const p = this.pickingGroup;
      if (!p || p.mesh !== mesh || p.g !== g) this.pickingGroup = { mesh, g, before: packed };
      if (!drag && !groups.isShowing()) this.onGroupColors?.(true);
    };
    const preview = (hex: string): void => {
      const c = hexToPacked(hex);
      if (c === null || !groups.previewColor(mesh, g, c)) return;
      GeometrySync.refreshAll();
      this.session.render();
    };
    const commit = (): void => {
      const p = this.pickingGroup;
      this.pickingGroup = null;
      if (!p || p.mesh !== mesh || p.g !== g) return;
      if (!groups.isShowing()) this.onGroupColors?.(true);
      const now = groups.colors(mesh)[g];
      if (now === undefined || !groups.setColor(mesh, g, now, p.before)) this.refreshGroups();
    };
    const picker = colorPicker(groups.colorHex(mesh, g), preview, { onOpen: () => begin(false), onClose: commit });
    this.groupPickers.push(picker);
    picker.root.classList.add('groups-row__pick');
    const btn = picker.root.querySelector<HTMLElement>('.cpick__swatch');
    if (btn) {
      btn.classList.add('groups-row__swatch');
      btn.dataset.role = 'group-color';
      btn.title = `${name}: its colour (tap to choose, drag over the view to pick one)`;
      btn.setAttribute('aria-label', `Colour of ${name}`);
    }
    installSwatchPick(picker, this.viewer, (hex) => {
      begin(true);
      preview(hex);
    });
    // The end of a drag over the view (swatchPick says so with a change);
    // with the popover up, its close commits instead.
    picker.root.addEventListener('change', () => {
      if (!picker.isOpen()) commit();
    });
    return picker.root;
  }

  /** The name swapped for a field; Enter or leaving it renames, Escape keeps the name. */
  private renameGroup(mesh: SculptMesh, g: number, nameEl: HTMLElement): void {
    this.renamingGroup = g;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'groups-row__rename';
    input.value = this.session.groups.names(mesh)[g] ?? '';
    input.maxLength = 200;
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      this.renamingGroup = -1;
      if (commit) this.session.groups.rename(mesh, g, input.value);
      this.refreshGroups();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing is not a hotkey
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  private groupIcon(icon: string, title: string, onPress: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'outliner__icon';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    const glyph = document.createElement('i');
    glyph.className = `fi ${icon}`;
    glyph.setAttribute('aria-hidden', 'true');
    btn.appendChild(glyph);
    onTap(btn, onPress);
    return btn;
  }

  /** A panel button that acts on a tap (onTap: a slow finger on iPad still presses it). */
  private tapButton(label: string, onPress: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sculpt-panel__btn';
    b.textContent = label;
    onTap(b, onPress);
    return b;
  }

  /**
   * The thickness slider, for the scale the scene is on: millimetres on
   * real units, the scene's own units before them. Rebuilt when that
   * changes, the thickness starting over at the new scale's default.
   */
  private buildExtract(): void {
    if (!this.extractHost) return;
    const real = !!this.session.getUnits();
    const spec = real ? EXTRACT_MM : EXTRACT_LEGACY;
    const toWorld = real ? 1 / 10 : 1;
    if (real !== this.extractOnUnits) this.extractThickness = spec.start * toWorld;
    this.extractOnUnits = real;
    this.extractHost.replaceChildren(
      compactRange(
        'Extract thickness',
        spec.min,
        spec.max,
        spec.step,
        this.extractThickness / toWorld,
        (v) => {
          this.extractThickness = v * toWorld;
        },
        { limits: AMOUNT, ...(real ? { unit: ' mm' } : {}) },
      ),
    );
  }

  /** The active object's voxel at the resolution set; `remeasure` reads its box again. */
  private refreshVoxel(remeasure = false): void {
    if (!this.voxelLine) return;
    if (remeasure) this.voxelBox = this.session.remeshBox();
    const box = this.voxelBox;
    const grid = box && voxelGrid(box, this.remeshResolution);
    this.voxelLine.hidden = !grid;
    if (grid) this.voxelLine.textContent = `One voxel: ${formatSceneLength(grid.step, this.session.getUnits())}`;
  }

  /** The scene's units changed (New, Open, Set scale): Extract's and the voxel's units follow. */
  refreshUnits(): void {
    this.buildExtract();
    this.refreshVoxel(true);
  }

  /** Merge's button follows the selection: two objects or more. */
  setMergeEnabled(on: boolean): void {
    if (this.mergeBtn) this.mergeBtn.disabled = !on;
  }

  /** The Extract thickness the ctrl+e hotkey should use. */
  getExtractThickness(): number {
    return this.extractThickness;
  }

  /** The shared numbered slider (src/ui/Panel), kept as a method for the callers here. */
  private numberedRange(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onInput: (v: number) => string,
    opts: SliderOptions = {},
  ): { row: HTMLLabelElement; input: HTMLInputElement; val: HTMLSpanElement } {
    return numberedRange(label, min, max, step, value, onInput, opts);
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
   * Rebuild the multiresolution block: level slider, Lower/Higher/
   * Subdivide, then Rebuild and Delete highest - one acts at the bottom of
   * the stack, the other at the top. Levels exist only on static
   * multimeshes; with dynamic topology on the block explains itself
   * instead.
   */
  refreshTopology(): void {
    if (!this.topoBody) return;
    const dynOn = this.session.isDynamicTopology();
    for (const r of this.dynDetailRows) r.row.hidden = !dynOn;
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
    // A pick from the levels there are, like the f-stops: no typing.
    const levels = this.numberedRange(
      'Level',
      1,
      Math.max(2, lv.levels),
      1,
      lv.sel + 1,
      (v) => `${Math.round(v)}/${this.session.getLevels()?.levels ?? lv.levels}`,
      { fixed: true },
    );
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
    ops.append(lower, higher, subdiv);
    this.topoBody.appendChild(ops);

    // Rebuild and Delete highest share the second row: Rebuild adds a
    // level under the bottom one, Delete highest takes the top one away
    // with its detail, and one undo brings it back. The short name is what
    // lets the two sit together at the panel's width; the title says it in
    // full. A lone level is the object itself, so there is nothing to
    // delete.
    const ends = div('sculpt-panel__row');
    const rebuild = this.opButton('Rebuild', () => {
      if (!this.session.reverse()) {
        alert('This topology cannot be rebuilt into a lower level.');
      }
    });
    rebuild.disabled = lv.sel !== 0;
    rebuild.title = 'Rebuild a coarser level under the lowest one (reversion)';
    const del = this.opButton('Delete highest', () => void this.session.deleteHighestLevel());
    del.disabled = lv.levels <= 1;
    del.title = 'Remove the top subdivision level and its detail (Ctrl+Z brings it back)';
    ends.append(rebuild, del);
    this.topoBody.appendChild(ends);
  }

  /** Re-sync stateful controls after engine-side changes (undo, dyntopo). */
  refreshState(): void {
    this.refreshHeading();
    this.dyntopoCheckbox.checked = this.session.isDynamicTopology();
    this.refreshTopology();
    this.refreshVoxel(true);
    this.refreshQuadTarget();
  }

  /** The heading names the object the panel is about: the selected one, "Model" with none. */
  refreshHeading(): void {
    this.setHeading(this.session.getMesh() ? this.session.activeName() : 'Model');
  }

  override dispose(): void {
    // A run under way ends with the mode; its object is left as it was.
    this.onQuadBusy = null;
    this.disposed = true;
    this.cancelQuadRemesh();
    for (const p of this.groupPickers) p.dispose();
    this.groupPickers = [];
    this.voxelOverlay?.dispose();
    this.voxelOverlay = null;
    super.dispose();
  }
}

/** A sub-heading inside a section (the Poly groups section's Group and Groups). */
function subheading(text: string): HTMLElement {
  const h = document.createElement('h4');
  h.className = 'sculpt-panel__subhead';
  h.textContent = text;
  return h;
}
