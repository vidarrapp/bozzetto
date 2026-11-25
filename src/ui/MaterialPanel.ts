import { div } from './dom';
import { colorPicker, type ColorPickerHandle } from './ColorPicker';
import { compactRange, CONTROLS_REFRESH_EVENT, MaterialControls, section } from './Panel';
import { setSliderValue, type Limits } from './sliderEntry';
import { SidePanel } from '../sculpt/ui/SidePanel';
import type { Viewer } from '../viewer/Viewer';

const FRACTION: Limits = { min: 0, max: 1 };

export interface MaterialPanelOptions {
  /**
   * Sculpt or Armature, whose viewer shows the active object. Over a
   * published model (the Present workspace) the albedo and the rest are the
   * model's own and sit with the display controls (MaterialControls).
   */
  sculpting: boolean;
  /** Plain Sculpt: the Display section has the Cavity switch (Armature and Present have no cavity). */
  cavity?: boolean;
  /** Sculpt: the Display section has the Colour choice (albedo and paint, albedo only, paint only) after Mode. */
  colour?: boolean;
  /**
   * Sculpt only: whether there is an active object. Gives the panel its
   * Surface section, the active object's own values; without it the panel
   * is the display controls alone.
   */
  surface?: { hasObject: () => boolean; materialName: () => string };
}

/** Whose values the Surface section shows when it is not the active object's: the scene's armature (its mannequin). */
export interface SurfaceSubject {
  /** What the section says the material belongs to. */
  name: string;
  values(): { albedo: string; roughness: number; metalness: number };
  set(patch: Partial<{ albedo: string; roughness: number; metalness: number }>): void;
}

/**
 * The Material panel (owner call): everything about how the model's
 * surface looks, on the left edge after Scene and Model. Two sections.
 * Surface, in Sculpt, is the active object's own material (albedo,
 * roughness, metalness), which used to open the Model panel. Display is how
 * the model is drawn (mode, matcap, shading, wireframe), which used to open
 * the Render panel; MaterialControls builds it. The public viewer and review
 * mode have this panel too, with the Display section alone, so Render never
 * holds Material anywhere. Each control is in one place only.
 *
 * Surface drives the same viewer.materials setters it always did: Sculpt's
 * hooks on Materials route a change into the active object's material (and
 * its undo step), so the move changed no plumbing.
 */
export class MaterialPanel extends SidePanel {
  private readonly display: MaterialControls;
  private readonly hasObject: (() => boolean) | null;
  private readonly materialName: (() => string) | null;
  private nameEl: HTMLSpanElement | null = null;
  private surfaceSection: HTMLDivElement | null = null;
  private surfaceRows: HTMLDivElement | null = null;
  private surfaceNone: HTMLDivElement | null = null;
  private albedoPicker: ColorPickerHandle | null = null;
  private roughInput: HTMLInputElement | null = null;
  private metalInput: HTMLInputElement | null = null;
  /** Present puts the editing away, and Armature has no object to speak for: either hides the Surface section. */
  private presenting = false;
  private surfaceWanted = true;
  /** The mannequin's material, while the section is its (set by the page; null: the active object's). */
  private subject: (() => SurfaceSubject | null) | null = null;
  setSubject(subject: (() => SurfaceSubject | null) | null): void {
    this.subject = subject;
    this.refreshSurface();
  }
  private readonly onPresent = (e: Event): void => {
    // Sculpt's Present puts the editing away; the object's own values with it.
    this.presenting = !!(e as CustomEvent<{ active?: boolean }>).detail?.active;
    this.paintSurface();
  };

  /**
   * Whether the workspace in front has an object's material to show (Sculpt and Paint do; Armature's
   * mannequin has none, and shows the Display section alone).
   */
  setSurfaceShown(shown: boolean): void {
    this.surfaceWanted = shown;
    this.display.setColourOffered(shown);
    this.paintSurface();
  }

  private paintSurface(): void {
    if (this.surfaceSection) this.surfaceSection.hidden = this.presenting || !(this.surfaceWanted || this.subject?.());
  }

  constructor(
    private readonly viewer: Viewer,
    opts: MaterialPanelOptions,
  ) {
    super({ id: 'material', title: 'Material', side: 'right', variant: 'panel--material' });
    // The albedo popover is body-mounted; collapsing the panel must take
    // it along or it floats on with its swatch off-screen.
    this.onCollapsedChange = (collapsed) => {
      if (collapsed) this.closePopovers();
    };
    this.hasObject = opts.surface?.hasObject ?? null;
    this.materialName = opts.surface?.materialName ?? null;
    if (opts.surface) this.buildSurface(this.body);
    this.display = new MaterialControls(viewer, { sculpting: opts.sculpting, heading: 'Display', cavity: opts.cavity, colour: opts.colour });
    this.body.appendChild(this.display.root);
    this.display.rebuild();
    window.addEventListener('bozzetto:present', this.onPresent);
    window.addEventListener('bozzetto:look-restored', this.onLookRestored);
    window.addEventListener(CONTROLS_REFRESH_EVENT, this.onControlsRefresh);
  }

  // --- Surface: the active object's material values -------------------------

  private buildSurface(body: HTMLElement): void {
    const sec = section(body, 'Surface');
    this.surfaceSection = sec;
    const mats = this.viewer.materials;
    const state = mats.getMaterialState();
    // With no object there is nothing for the values to belong to.
    this.surfaceNone = div('sculpt-panel__hint muted');
    this.surfaceNone.textContent = 'No object is selected.';
    sec.appendChild(this.surfaceNone);
    const rows = div('');
    this.surfaceRows = rows;
    sec.appendChild(rows);
    // The shared HSV picker, owned for the panel's life (the popover is
    // body-mounted; disposing mid-drag closes it under the pointer).
    this.albedoPicker = colorPicker(state.albedo, (hex) => {
      const who = this.subject?.();
      if (who) who.set({ albedo: hex });
      else mats.setAlbedo(hex);
    });
    const albedoRow = document.createElement('label');
    albedoRow.className = 'label-row';
    const albedoName = document.createElement('span');
    albedoName.textContent = 'Albedo';
    albedoRow.append(albedoName, this.albedoPicker.root);
    // The assigned material, as a plain label and value (assigning is the Scene panel's).
    const nameRow = document.createElement('div');
    nameRow.className = 'label-row';
    nameRow.dataset.role = 'material-name';
    const nameLabel = document.createElement('span');
    nameLabel.textContent = 'Material';
    this.nameEl = document.createElement('span');
    this.nameEl.className = 'readout readout--name';
    nameRow.append(nameLabel, this.nameEl);
    rows.append(nameRow, albedoRow);
    const rough = compactRange('Roughness', 0, 1, 0.01, state.roughness, (v) => {
      const who = this.subject?.();
      if (who) who.set({ roughness: v });
      else mats.setRoughness(v);
    }, {
      limits: FRACTION,
    });
    this.roughInput = rough.querySelector('input') as HTMLInputElement;
    rows.appendChild(rough);
    const metal = compactRange('Metalness', 0, 1, 0.01, state.metalness, (v) => {
      const who = this.subject?.();
      if (who) who.set({ metalness: v });
      else mats.setMetalness(v);
    }, {
      limits: FRACTION,
    });
    this.metalInput = metal.querySelector('input') as HTMLInputElement;
    rows.appendChild(metal);
    this.refreshSurface();
  }

  /** Follow the selection (Sculpt calls this when the active material moves). */
  refreshSurface(): void {
    if (!this.surfaceRows || !this.surfaceNone || !this.roughInput || !this.metalInput) return;
    const who = this.subject?.() ?? null;
    const has = who ? true : this.hasObject ? this.hasObject() : true;
    this.surfaceRows.hidden = !has;
    this.surfaceNone.hidden = has;
    this.paintSurface();
    if (!has) this.albedoPicker?.close();
    if (this.nameEl && who) this.nameEl.textContent = who.name;
    else if (this.nameEl && this.materialName && has) this.nameEl.textContent = this.materialName();
    const state = who ? who.values() : this.viewer.materials.getMaterialState();
    // While the popover is up, the picker is the source of truth; echoes of
    // its own drag must not fight the thumb being held.
    if (this.albedoPicker && !this.albedoPicker.isOpen()) this.albedoPicker.set(state.albedo);
    setSliderValue(this.roughInput, state.roughness);
    setSliderValue(this.metalInput, state.metalness);
  }

  // --- Display ----------------------------------------------------------------

  /**
   * What hotkeys change (mode, matcap, smooth shading, wireframe) is read
   * again whenever the shortcuts say so: the shortcuts announce it
   * (CONTROLS_REFRESH_EVENT).
   */
  private readonly onControlsRefresh = (): void => {
    this.display.refresh();
  };

  /** A saved look was applied under us (opening a file): every control reads it again. */
  private readonly onLookRestored = (): void => {
    this.display.rebuild();
  };

  private closePopovers(): void {
    this.albedoPicker?.close();
    this.display.closePopovers();
  }

  override setCollapsed(collapsed: boolean): void {
    // What changed while it was tucked away (a hotkey, a look restore) is there when it opens.
    if (!collapsed) this.display.refresh();
    super.setCollapsed(collapsed);
  }

  override dispose(): void {
    window.removeEventListener('bozzetto:present', this.onPresent);
    window.removeEventListener('bozzetto:look-restored', this.onLookRestored);
    window.removeEventListener(CONTROLS_REFRESH_EVENT, this.onControlsRefresh);
    this.albedoPicker?.dispose();
    this.albedoPicker = null;
    this.display.dispose();
    super.dispose();
  }
}
