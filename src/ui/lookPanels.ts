import { type Viewer, type LookState, type GroundMode, type ToneMappingId } from '../viewer/Viewer';
import { PRESETS, presetRig, type LightId, type RigValues } from '../viewer/Lighting';
import { div, labelRow, selectEl } from './dom';
import { colorPicker, type ColorPickerHandle } from './ColorPicker';
import { installSwatchPick } from './swatchPick';
import { formatSliderNumber, sliderText, typedSlider } from './sliderEntry';
import { FLOOR_OFFSET_LIMIT } from '../viewer/units';
import { SidePanel, type PanelSide } from '../sculpt/ui/SidePanel';
import {
  AMOUNT,
  CAVITY_RADIUS_MAX,
  CAVITY_RADIUS_MIN,
  CAVITY_STRENGTH_MAX,
  DEGREES,
  FRACTION,
  button,
  checkbox,
  compactRange,
  CONTROLS_REFRESH_EVENT,
  labelled,
  numberedRange,
  range,
  section,
} from './Panel';
import { rigAssets } from '../library/assets';
import { askText, askWindow, tellWindow } from './askWindow';
import { downloadBlob } from './download';
import {
  RIGS_CHANGED_EVENT,
  RIG_EXT,
  cleanRigName,
  deleteRig,
  myRigs,
  parseRigFile,
  renameRig,
  rigFileName,
  rigFileText,
  rigNamed,
  saveRig,
  type SavedRig,
} from './rigLibrary';

/**
 * The look panels, three tabs that take the place of the one Render panel:
 *
 *   Lighting  the rig library, the shadows, every light, the HDRI as a light
 *   Camera    the lens and depth of field
 *   Render    tone mapping, ambient occlusion, background and ground, and
 *             Reset look at the foot
 *
 * They are Present's (at the left, after the workspace's own tabs are put
 * away), and the public viewer and review mode have the Lighting tab alone,
 * at the right. Sculpt and Armature have none of them: the key light is moved
 * with the L key or View > Move light, and the cavity is on the Material tab.
 * Sculpt builds them for its Present, where they show.
 *
 * Every panel builds itself from the viewer's live state each time it opens
 * (and again when a look is restored under it), so nothing shows a stale
 * number; the controls read their values once, when built. Keyboard shortcuts
 * that change the look send CONTROLS_REFRESH_EVENT, which an open panel
 * answers by reading what it shows again.
 */

export interface LookPanelsOptions {
  /**
   * Where the panels are built. 'sculpt': Sculpt's Present, where Reset look
   * asks the mode (which owns the defaults and the stored record) and the
   * floor offset is the Scene panel's. 'viewer': everywhere else, where the
   * look it opened with comes back.
   */
  owner: 'viewer' | 'sculpt';
  side: PanelSide;
  tabs: Array<'lighting' | 'camera' | 'render'>;
  /** The look Reset look goes back to; the viewer's as it stands when this is left out. */
  openedLook?: LookState;
  /**
   * Whether the rig list has Save, Import and Manage. The public viewer has the
   * select alone: a visitor's changes are never kept.
   */
  rigLibrary: boolean;
}

export class LookPanels {
  readonly lighting: LightingPanel | null;
  readonly camera: CameraPanel | null;
  readonly render: RenderPanel | null;
  private readonly all: LookPanel[];

  constructor(viewer: Viewer, opts: LookPanelsOptions) {
    const shared: Shared = {
      viewer,
      opts,
      openedLook: opts.openedLook ?? viewer.getLook(),
      bgPicker: undefined,
      stagePicker: undefined,
      lightPickers: new Map(),
    };
    this.lighting = opts.tabs.includes('lighting') ? new LightingPanel(shared) : null;
    this.camera = opts.tabs.includes('camera') ? new CameraPanel(shared) : null;
    this.render = opts.tabs.includes('render') ? new RenderPanel(shared) : null;
    this.all = ([this.lighting, this.camera, this.render] as Array<LookPanel | null>).filter((p): p is LookPanel => !!p);
  }

  /** Re-sync controls that hotkeys can change (the shortcuts call this). */
  refreshControls(): void {
    window.dispatchEvent(new Event(CONTROLS_REFRESH_EVENT));
  }

  dispose(): void {
    for (const p of this.all) p.dispose();
    this.all[0]?.disposeShared();
  }
}

/** What the three panels share: the viewer, the pickers kept across rebuilds (a picker's own drag echoes back through a look restore, and disposing it closed its popover under the pointer). */
interface Shared {
  viewer: Viewer;
  opts: LookPanelsOptions;
  openedLook: LookState;
  bgPicker?: ColorPickerHandle;
  stagePicker?: ColorPickerHandle;
  lightPickers: Map<LightId, ColorPickerHandle>;
}

abstract class LookPanel extends SidePanel {
  protected readonly viewer: Viewer;
  private built = false;

  /** A saved look was applied under us (a file opened, Reset look). */
  private readonly onLookRestored = (): void => {
    if (!this.isCollapsed()) this.rebuild();
  };
  private readonly onControlsRefresh = (): void => {
    if (!this.isCollapsed() && this.built) this.sync();
  };
  /** Sculpt's Present ended: what it showed goes away with it. */
  private readonly onPresent = (e: Event): void => {
    if (this.shared.opts.owner === 'sculpt' && !(e as CustomEvent<{ active?: boolean }>).detail?.active) this.setCollapsed(true);
  };

  protected constructor(
    protected readonly shared: Shared,
    id: string,
    title: string,
  ) {
    super({ id, title, side: shared.opts.side, variant: `panel--${id}`, collapsed: true });
    this.viewer = shared.viewer;
    this.onCollapsedChange = (collapsed) => {
      if (collapsed) this.closePopovers();
      else this.rebuild();
    };
    window.addEventListener('bozzetto:look-restored', this.onLookRestored);
    window.addEventListener(CONTROLS_REFRESH_EVENT, this.onControlsRefresh);
    window.addEventListener('bozzetto:present', this.onPresent);
  }

  /** Build the sections from the viewer's live state. */
  protected abstract build(body: HTMLElement): void;
  /** Read what hotkeys may have changed. */
  protected abstract sync(): void;
  protected closePopovers(): void {
    this.shared.bgPicker?.close();
    this.shared.stagePicker?.close();
    for (const p of this.shared.lightPickers.values()) p.close();
  }

  rebuild(): void {
    this.body.replaceChildren();
    this.build(this.body);
    this.built = true;
  }

  disposeShared(): void {
    this.shared.bgPicker?.dispose();
    this.shared.stagePicker?.dispose();
    for (const p of this.shared.lightPickers.values()) p.dispose();
    this.shared.lightPickers.clear();
  }

  override dispose(): void {
    window.removeEventListener('bozzetto:look-restored', this.onLookRestored);
    window.removeEventListener(CONTROLS_REFRESH_EVENT, this.onControlsRefresh);
    window.removeEventListener('bozzetto:present', this.onPresent);
    this.closePopovers();
    super.dispose();
  }
}

// --- Lighting ---------------------------------------------------------------

/** The Rig select's values: a built-in rig, one of mine, or the lights as they are. */
const BUILT = 'built:';
const MINE = 'mine:';
const CUSTOM = 'custom';

class LightingPanel extends LookPanel {
  private rigSelect?: HTMLSelectElement;
  private envSelect?: HTMLSelectElement;
  private envRows?: HTMLDivElement;
  private shadowsCheckbox?: HTMLInputElement;
  private lightControls?: HTMLDivElement;
  private manageList?: HTMLDivElement;
  private manageOpen = false;
  private readonly onRigs = (): void => {
    if (!this.isCollapsed()) this.rebuild();
  };

  constructor(shared: Shared) {
    super(shared, 'lighting', 'Lighting');
    window.addEventListener(RIGS_CHANGED_EVENT, this.onRigs);
  }

  override dispose(): void {
    window.removeEventListener(RIGS_CHANGED_EVENT, this.onRigs);
    super.dispose();
  }

  protected build(body: HTMLElement): void {
    this.buildRig(body);
    this.buildLights(body);
    this.buildEnvironment(body);
    this.rebuildLightControls();
  }

  protected sync(): void {
    if (this.shadowsCheckbox) this.shadowsCheckbox.checked = this.viewer.lighting.getShadowsMaster();
    // The Asset library's HDRIs tab sets the environment under the select.
    if (this.envSelect && this.envSelect.value !== (this.viewer.environment.getState().id ?? '')) {
      this.envSelect.value = this.viewer.environment.getState().id ?? '';
      if (this.envRows) this.envRows.hidden = !this.envSelect.value;
    }
    // The light rows read their values when built, and the hold-L drag moves the key under them.
    if (this.lightControls?.isConnected) this.rebuildLightControls();
  }

  // --- the rig library ---------------------------------------------------------

  private buildRig(body: HTMLElement): void {
    const sec = section(body, 'Rig');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Rig');
    const built = document.createElement('optgroup');
    built.label = 'Built in';
    for (const p of rigAssets()) built.appendChild(new Option(p.label, BUILT + p.id));
    select.appendChild(built);
    const mine = myRigs();
    if (mine.length) {
      const group = document.createElement('optgroup');
      group.label = 'My rigs';
      for (const r of mine) group.appendChild(new Option(r.name, MINE + r.id));
      select.appendChild(group);
    }
    // Said as the lights are: lights that match no rig are Custom.
    const custom = new Option('Custom', CUSTOM);
    custom.hidden = true;
    select.appendChild(custom);
    this.rigSelect = select;
    this.syncRig(mine);
    select.addEventListener('change', () => {
      const v = select.value;
      if (v.startsWith(BUILT)) this.viewer.lighting.applyPreset(v.slice(BUILT.length));
      else if (v.startsWith(MINE)) {
        const rig = myRigs().find((r) => r.id === v.slice(MINE.length));
        if (rig) this.viewer.lighting.applyRig(rig.rig);
      } else return;
      this.rebuildLightControls();
    });
    sec.appendChild(labelRow('Rig', select));

    if (!this.shared.opts.rigLibrary) return;
    const row = div('rig-actions');
    const save = button('Save rig…', () => void this.saveCurrent());
    const importBtn = button('Import rig…', () => file.click());
    const manage = button('Manage', () => {
      this.manageOpen = !this.manageOpen;
      this.paintManage(manage);
    });
    manage.setAttribute('aria-expanded', 'false');
    for (const b of [save, importBtn, manage]) b.className = 'btn btn--small rig-actions__btn';
    save.dataset.role = 'rig-save';
    importBtn.dataset.role = 'rig-import';
    manage.dataset.role = 'rig-manage';
    // The file, chosen from the Import button: a rig file is small, read whole.
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = `${RIG_EXT},application/json,.json`;
    file.hidden = true;
    file.className = 'rig-file';
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) void this.importFile(f);
    });
    row.append(save, importBtn, manage, file);
    sec.appendChild(row);
    this.manageList = div('rig-manage');
    sec.appendChild(this.manageList);
    this.paintManage(manage);
  }

  /** The Rig select shows the rig the lights are at, or Custom. */
  private syncRig(mine = myRigs()): void {
    const sel = this.rigSelect;
    if (!sel) return;
    const lighting = this.viewer.lighting;
    let value = CUSTOM;
    const preset = lighting.activePreset();
    if (preset) value = BUILT + preset;
    else {
      const m = mine.find((r) => lighting.matchesRig(r.rig));
      if (m) value = MINE + m.id;
    }
    const custom = [...sel.options].find((o) => o.value === CUSTOM);
    if (custom) custom.hidden = value !== CUSTOM;
    sel.value = value;
  }

  private async saveCurrent(): Promise<void> {
    const name = await askText({
      title: 'Save rig',
      label: 'Name',
      text: 'Keeps the lights as they are, on this device.',
      yes: 'Save',
    });
    if (name === null) return;
    const clean = cleanRigName(name);
    if (!clean) {
      await tellWindow({ title: 'The rig needs a name', text: 'Type a name for it.' });
      return;
    }
    if (rigNamed(clean)) {
      const replace = await askWindow({ title: `Replace "${clean}"?`, text: 'A rig with this name is kept already. It gets these lights instead.', yes: 'Replace', danger: true });
      if (!replace) return;
    }
    const kept = saveRig(clean, this.viewer.lighting.rigValues());
    if (!kept) await this.notKept();
  }

  private notKept(): Promise<void> {
    return tellWindow({
      title: 'The rig could not be kept',
      text: 'Rigs are kept on this device, and keeping things on this device is off.',
    });
  }

  private async importFile(f: File): Promise<void> {
    let text = '';
    try {
      text = await f.text();
    } catch {
      await tellWindow({ title: 'This rig cannot be imported', text: 'The file could not be read.' });
      return;
    }
    const parsed = parseRigFile(text, f.name.replace(/\.[^.]*$/, ''));
    if (!parsed.ok) {
      await tellWindow({ title: 'This rig cannot be imported', text: parsed.error });
      return;
    }
    let { name } = parsed.value;
    if (rigNamed(name)) {
      const replace = await askWindow({ title: `Replace "${name}"?`, text: 'A rig with this name is kept already. The file replaces it.', yes: 'Replace', danger: true });
      if (!replace) return;
    }
    this.viewer.lighting.applyRig(parsed.value.rig);
    name = cleanRigName(name);
    if (!saveRig(name, parsed.value.rig)) await this.notKept();
    this.rebuildLightControls();
    this.syncRig();
  }

  /** The Manage list: each of my rigs with Rename, Export and Delete. */
  private paintManage(toggle: HTMLButtonElement): void {
    const list = this.manageList;
    if (!list) return;
    toggle.setAttribute('aria-expanded', String(this.manageOpen));
    toggle.classList.toggle('is-on', this.manageOpen);
    list.hidden = !this.manageOpen;
    list.replaceChildren();
    if (!this.manageOpen) return;
    const mine = myRigs();
    if (!mine.length) {
      const none = document.createElement('p');
      none.className = 'rig-manage__none';
      none.textContent = 'No saved rigs yet. Save rig keeps the lights as they are.';
      list.appendChild(none);
      return;
    }
    for (const r of mine) list.appendChild(this.manageRow(r, toggle));
  }

  private manageRow(r: SavedRig, toggle: HTMLButtonElement): HTMLElement {
    const row = div('rig-manage__row');
    row.dataset.rig = r.name;
    const name = document.createElement('span');
    name.className = 'rig-manage__name';
    name.textContent = r.name;
    const rename = button('Rename', async () => {
      const next = await askText({ title: 'Rename rig', label: 'Name', yes: 'Rename', value: r.name });
      if (next === null) return;
      const clean = cleanRigName(next);
      if (!clean) return;
      if (clean.toLowerCase() !== r.name.toLowerCase() && rigNamed(clean)) {
        await tellWindow({ title: 'That name is taken', text: 'A rig with this name is kept already. Pick another.' });
        return;
      }
      if (!renameRig(r.id, clean)) await this.notKept();
    });
    const exportBtn = button('Export', () => {
      downloadBlob(new Blob([rigFileText(r.name, r.rig)], { type: 'application/json' }), rigFileName(r.name));
    });
    const del = button('Delete', async () => {
      const yes = await askWindow({ title: `Delete "${r.name}"?`, text: 'The rig is removed from this device. A file you exported stays.', yes: 'Delete', danger: true });
      if (yes && !deleteRig(r.id)) await this.notKept();
    });
    rename.dataset.role = 'rig-rename';
    exportBtn.dataset.role = 'rig-export';
    del.dataset.role = 'rig-delete';
    for (const b of [rename, exportBtn, del]) b.className = 'btn btn--small rig-manage__btn';
    del.classList.add('btn--danger');
    row.append(name, rename, exportBtn, del);
    void toggle;
    return row;
  }

  // --- lights --------------------------------------------------------------------

  private buildLights(body: HTMLElement): void {
    const sec = section(body, 'Lights');
    // Master shadow switch (also shift+s in sculpt mode). Per-light shadow
    // config lives in the rig; this gates all of it at once.
    const shadows = checkbox('Shadows', this.viewer.lighting.getShadowsMaster(), (on) => this.viewer.lighting.setShadowsMaster(on));
    this.shadowsCheckbox = shadows.querySelector('input')!;
    sec.appendChild(shadows);

    this.lightControls = div('light-controls');
    sec.appendChild(this.lightControls);

    sec.appendChild(
      labelled('Rotate rig', () => {
        const out = document.createElement('span');
        out.className = 'readout';
        const start = this.viewer.lighting.getRigRotation();
        const show = (v: number): void => {
          out.textContent = `${formatSliderNumber(v, 1)}°`;
        };
        show(start);
        const turn = (v: number): void => {
          this.viewer.setRigRotation(v); // rotates the directional rig + HDRI
          show(v);
        };
        const r = range(0, 360, 1, start, turn);
        r.dataset.unit = '°';
        typedSlider(r, { apply: turn, limits: DEGREES }, start);
        const wrap = div('range-wrap');
        wrap.append(r, out);
        return wrap;
      }),
    );
  }

  private rebuildLightControls(): void {
    this.syncRig();
    if (!this.lightControls) return;
    this.lightControls.replaceChildren();
    const pickers = this.shared.lightPickers;
    for (const light of this.viewer.lighting.state()) {
      const box = div('light');
      box.dataset.light = light.id;
      const head = div('light__head');
      head.appendChild(
        checkbox(light.label, light.enabled, (on) => {
          this.viewer.lighting.setEnabled(light.id, on);
          // A disabled light's settings drive nothing; fold them away and
          // rebuild on re-enable so the rows come back with live values.
          this.rebuildLightControls();
        }),
      );
      box.appendChild(head);

      if (!light.enabled) {
        // The folded rows take the light's colour popover with them if it
        // was up (the popover is body-mounted and would outlive its row).
        pickers.get(light.id)?.close();
      } else {
        box.appendChild(
          compactRange('Intensity', 0, LIGHT_INTENSITY_MAX, 0.1, light.intensity, (v) => {
            this.viewer.lighting.setIntensity(light.id, v);
            this.syncRig();
          }, { limits: AMOUNT }),
        );
        box.appendChild(
          compactRange('Azimuth', -180, 180, 1, light.azimuth, (v) => this.setAngle(light.id, 'az', v), {
            limits: { min: -180, wrap: 360 },
            unit: '°',
          }),
        );
        box.appendChild(
          // Past straight up the light would come over the top and face
          // the other way, which is an azimuth change, not an elevation.
          compactRange('Elevation', -20, 90, 1, light.elevation, (v) => this.setAngle(light.id, 'el', v), {
            limits: { min: -90, max: 90 },
            unit: '°',
          }),
        );

        let picker = pickers.get(light.id);
        if (!picker) {
          const id = light.id;
          const setColor = (hex: string): void => {
            this.viewer.lighting.setColor(id, hex);
            this.syncRig();
          };
          picker = colorPicker(light.color, setColor);
          // Drag the swatch onto the view to light with a colour off the frame.
          installSwatchPick(picker, this.viewer, setColor);
          pickers.set(id, picker);
        } else if (!picker.isOpen()) {
          picker.set(light.color);
        }
        box.appendChild(labelRow('Colour', picker.root));

        if (light.canShadow) {
          box.appendChild(
            checkbox('Casts shadow', light.castShadow, (on) => {
              this.viewer.lighting.setShadow(light.id, on);
              this.rebuildLightControls();
            }),
          );
          if (light.castShadow) {
            box.appendChild(
              compactRange('Softness', 0, 16, 0.5, light.softness, (v) => this.viewer.lighting.setSoftness(light.id, v), { limits: AMOUNT }),
            );
          }
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
    this.syncRig();
  }

  // --- the HDRI as a light -------------------------------------------------------

  private buildEnvironment(body: HTMLElement): void {
    const env = this.viewer.environment;
    const state = env.getState();
    const sec = section(body, 'Environment light');
    const select = document.createElement('select');
    select.appendChild(new Option('None', ''));
    for (const e of env.list()) select.appendChild(new Option(e.label, e.id));
    select.value = state.id ?? '';
    select.addEventListener('change', () => void env.setEnvironment(select.value || null));
    this.envSelect = select;
    sec.appendChild(labelRow('HDRI', select));

    // Intensity and rotation have nothing to act on under "None".
    const rows = div('env-rows');
    rows.appendChild(compactRange('Intensity', 0, HDRI_INTENSITY_MAX, 0.01, state.intensity, (v) => env.setIntensity(v), { limits: AMOUNT }));
    rows.appendChild(compactRange('Rotation', 0, 360, 1, state.rotation, (v) => env.setOffset(v), { limits: DEGREES, unit: '°' }));
    sec.appendChild(rows);
    const sync = (): void => {
      rows.hidden = !select.value;
    };
    this.envRows = rows;
    select.addEventListener('change', sync);
    sync();
  }
}

// --- Camera -----------------------------------------------------------------

class CameraPanel extends LookPanel {
  private dofCheckbox?: HTMLInputElement;
  private dofRows?: HTMLDivElement;

  constructor(shared: Shared) {
    super(shared, 'camera', 'Camera');
  }

  protected build(body: HTMLElement): void {
    const sec = section(body, 'Camera');
    sec.appendChild(
      steppedSlider('Lens', LENS_STEPS, this.viewer.getFocalLength(), (mm) => `${mm}mm`, (mm) => this.viewer.setFocalLength(mm)),
    );
    this.buildDoF(sec);
  }

  protected sync(): void {
    if (!this.dofCheckbox) return;
    const on = this.viewer.getDoFState().enabled;
    this.dofCheckbox.checked = on;
    if (this.dofRows) this.dofRows.hidden = !on;
  }

  /**
   * Depth of field. Aperture sets the blur; Focus scrubs the plane across the
   * subject depth. A double-click (double-tap on touch) in the viewport locks
   * focus onto a point (tap-to-focus); the Focus slider releases that lock.
   */
  private buildDoF(sec: HTMLElement): void {
    if (!this.viewer.dofAvailable()) return;
    const dof = this.viewer.getDoFState();
    // Aperture and Focus act on nothing while the effect is off, so they
    // fold away with the switch (the same rule as lights, ground, HDRI).
    const rows = div('dof-rows');
    rows.hidden = !dof.enabled;
    this.dofRows = rows;
    const toggle = checkbox('Depth of field', dof.enabled, (on) => {
      this.viewer.setDoF({ enabled: on });
      rows.hidden = !on;
    });
    this.dofCheckbox = toggle.querySelector('input')!;
    sec.appendChild(toggle);
    rows.appendChild(steppedSlider('Aperture', F_STOPS, dof.fStop, (f) => `f/${f}`, (f) => this.viewer.setDoF({ fStop: f })));
    rows.appendChild(
      // A typed focus may sit in front of the subject (below 0) or behind
      // it (past 1). Moving the slider lets go of a tap-to-focus lock, so
      // the first press of a double-click had let go of it before the field
      // opened; it is put back for the field, which then keeps it on Esc.
      compactRange('Focus', 0, 1, 0.02, dof.focus, (v) => this.viewer.setDoF({ focus: v }), {
        hold: () => {
          const lock = this.viewer.getDoFState().focusPoint;
          return () => {
            if (lock) this.viewer.setDoF({ focusPoint: lock });
          };
        },
      }),
    );
    sec.appendChild(rows);
  }
}

// --- Render -----------------------------------------------------------------

class RenderPanel extends LookPanel {
  private toneSelect?: HTMLSelectElement;
  private groundSelect?: HTMLSelectElement;
  private aoSelect?: HTMLSelectElement;
  private syncRows: (() => void) | null = null;
  /** The cavity strength to come back to after another model (zero is its "off"). */
  private cavityStrength = 0.9;

  constructor(shared: Shared) {
    super(shared, 'render', 'Render');
  }

  protected build(body: HTMLElement): void {
    this.buildTone(body);
    this.buildAO(body);
    this.buildBackground(body);
    if (devMode()) this.buildDeveloper(body);
    const foot = div('panel__foot');
    const reset = button('Reset look', () => this.resetLook());
    reset.className = 'btn btn--small panel__reset';
    foot.appendChild(reset);
    body.appendChild(foot);
  }

  protected sync(): void {
    if (this.groundSelect) this.groundSelect.value = this.viewer.getGround();
    if (this.toneSelect) this.toneSelect.value = this.viewer.getToneMapping();
    if (this.aoSelect) this.aoSelect.value = this.aoModeOfLook();
    this.syncRows?.(); // ground can move under us (the G key cycles it)
  }

  /**
   * Back to the look the scene or project opened with. Sculpt keeps its look
   * between sessions, so a look set up badly would otherwise restore for ever:
   * there the panel only asks, and the mode owns the defaults and the stored
   * record. Anywhere else the panel has the look it opened with and puts it
   * back (a visitor's change is never saved). All three tabs read it again.
   */
  private resetLook(): void {
    if (this.shared.opts.owner === 'sculpt') {
      window.dispatchEvent(new CustomEvent('bozzetto:look-reset'));
      return;
    }
    const look = this.shared.openedLook;
    // The camera's place is the visitor's view, not the look: it stays.
    void this.viewer
      .applyLook({ ...look, camera: { ...look.camera, position: [], target: [] } })
      .then(() => window.dispatchEvent(new CustomEvent('bozzetto:look-restored')));
  }

  private buildTone(body: HTMLElement): void {
    const sec = section(body, 'Tone');
    // Output grade (owner call): the film curve is a choice, saved with the
    // look; matcap mode always renders ungraded regardless (the fidelity
    // contract), so this steers the lit modes.
    const tone = selectEl(
      [
        ['none', 'None (linear)'],
        ['neutral', 'Neutral'],
        ['agx', 'AgX'],
        ['cinematic', 'Cinematic (ACES)'],
      ],
      this.viewer.getToneMapping(),
    );
    tone.addEventListener('change', () => this.viewer.setToneMapping(tone.value as ToneMappingId));
    this.toneSelect = tone;
    sec.appendChild(labelRow('Tone mapping', tone));
  }

  /**
   * The AO model the viewer is on: GTAO when it is enabled; else the cavity
   * when that has a strength (Sculpt's Present, where the Material tab sets
   * it); else off.
   */
  private aoModeOfLook(): string {
    if (this.viewer.aoAvailable() && this.viewer.getAOState().enabled) return 'gtao';
    return this.viewer.getSculptAO().strength > 0 ? 'cavity' : 'off';
  }

  /**
   * Ambient occlusion: GTAO is the viewer's screen-space pass. The cavity is
   * the cheap depth SSAO of Sculpt's own composite, which has its switch on
   * the Material tab; it shows here only as the model the viewer is on (a
   * pick of GTAO or Off turns it off), so each control is in one place.
   *
   * Building the section shows the model the viewer is on and changes
   * nothing; only a pick in the list writes.
   */
  private buildAO(body: HTMLElement): void {
    const sec = section(body, 'Ambient occlusion');
    const hasGtao = this.viewer.aoAvailable();
    const gtaoRows = div('ao-rows');
    const cavityRows = div('ao-rows');
    const show = (mode: string): void => {
      gtaoRows.hidden = mode !== 'gtao';
      cavityRows.hidden = mode !== 'cavity';
    };

    const apply = (mode: string): void => {
      if (mode === 'cavity') return; // the Material tab's switch turns it on
      if (hasGtao) this.viewer.setAO({ enabled: mode === 'gtao' });
      // Cavity has no enable flag of its own; zero strength is "off".
      this.viewer.setSculptAO({ strength: 0 });
      show(mode);
      // The Material tab's Cavity switch reads this too: it goes off with it.
      window.dispatchEvent(new Event(CONTROLS_REFRESH_EVENT));
    };

    const options: [string, string][] = [['off', 'Off']];
    if (hasGtao) options.push(['gtao', 'GTAO']);
    const cavityOn = this.viewer.getSculptAO().strength > 0;
    if (cavityOn && !(hasGtao && this.viewer.getAOState().enabled)) options.push(['cavity', 'Cavity (SSAO)']);
    const modeSel = selectEl(options, this.aoModeOfLook());
    modeSel.addEventListener('change', () => apply(modeSel.value));
    this.aoSelect = modeSel;
    sec.appendChild(labelRow('Model', modeSel));

    if (hasGtao) {
      const ao = this.viewer.getAOState();
      // Strength is an exponent on the GTAO term (Viewer): 0 none, 1 the
      // term, 2 its square - deeper, never clipped to black.
      gtaoRows.appendChild(
        compactRange('Strength', 0, AO_STRENGTH_MAX, 0.05, ao.intensity, (v) => this.viewer.setAO({ intensity: v }), { limits: AMOUNT }),
      );
      // A length in centimetres in a scene on real units, the same on a head
      // and on a whole figure, with its unit printed beside it. Without real
      // units it is the share of the subject's radius. Above zero either way,
      // or nothing occludes at all.
      const radius = this.viewer.getAORadius();
      if (radius.unit) {
        const row = numberedRange(
          'Radius',
          AO_RADIUS_CM_MIN,
          AO_RADIUS_CM_MAX,
          0.1,
          Math.round(radius.value * 100) / 100,
          (v) => {
            this.viewer.setAO({ radiusCm: v });
            return sliderText(row.input, v);
          },
          { limits: { min: 0.01 }, unit: ' cm' },
        );
        gtaoRows.appendChild(row.row);
      } else {
        gtaoRows.appendChild(
          compactRange('Radius', AO_RADIUS_MIN, AO_RADIUS_MAX, 0.01, ao.radius, (v) => this.viewer.setAO({ radius: v }), { limits: { min: 0.01 } }),
        );
      }
      sec.appendChild(gtaoRows);
    }

    // The cavity, while it is the model: its own two rows, the same as the Material tab's.
    const cav = this.viewer.getSculptAO();
    if (cav.strength > 0) this.cavityStrength = cav.strength;
    cavityRows.appendChild(
      compactRange('Strength', 0, CAVITY_STRENGTH_MAX, 0.05, this.cavityStrength, (v) => {
        this.cavityStrength = v;
        this.viewer.setSculptAO({ strength: v });
      }, { limits: AMOUNT }),
    );
    cavityRows.appendChild(
      compactRange('Radius', CAVITY_RADIUS_MIN, CAVITY_RADIUS_MAX, 1, cav.radius, (v) => this.viewer.setSculptAO({ radius: v }), {
        limits: { min: 1 },
        unit: ' px',
      }),
    );
    sec.appendChild(cavityRows);
    show(modeSel.value);
  }

  private buildBackground(body: HTMLElement): void {
    const env = this.viewer.environment;
    const state = env.getState();
    const stage = this.viewer.getStageState();
    const sec = section(body, 'Background and ground');

    const bg = selectEl(
      [
        ['theme', 'Theme'],
        ['color', 'Solid colour'],
        ['hdri', 'HDRI'],
      ],
      state.background,
    );
    bg.addEventListener('change', () => env.setBackgroundMode(bg.value as 'theme' | 'color' | 'hdri'));
    sec.appendChild(labelRow('Background', bg));

    const shared = this.shared;
    if (!shared.bgPicker) {
      const setBg = (hex: string): void => env.setBackgroundColor(hex);
      shared.bgPicker = colorPicker(state.bgColor, setBg);
      // The same drag-to-pick as the lights' and the paint brush's swatches.
      installSwatchPick(shared.bgPicker, this.viewer, setBg);
    } else if (!shared.bgPicker.isOpen()) {
      shared.bgPicker.set(state.bgColor);
    }
    const bgColorRow = labelRow('Bg colour', shared.bgPicker.root);
    sec.appendChild(bgColorRow);

    // The plate as the background: its blur, and its brightness apart from
    // the light it gives (1 is the map as it is, whatever the Intensity).
    const hdriRows = div('env-rows');
    hdriRows.appendChild(compactRange('Bg blur', 0, 1, 0.02, state.blur, (v) => env.setBackgroundBlur(v), { limits: FRACTION }));
    hdriRows.appendChild(
      compactRange('Bg brightness', 0, BG_BRIGHTNESS_MAX, 0.01, state.bgBrightness, (v) => env.setBackgroundBrightness(v), { limits: AMOUNT }),
    );
    sec.appendChild(hdriRows);

    // Stage: a single ground style (contact shadow, fading floor, or pedestal),
    // each with its own albedo where relevant. Where the mode holds the floor
    // (Armature), there is no pedestal to offer.
    const floorHeld = this.viewer.lockedFloor() !== null;
    const ground = selectEl(
      ([
        ['off', 'None'],
        ['shadow', 'Shadow'],
        ['floor', 'Floor'],
        ['pedestal', 'Pedestal'],
      ] as const).filter(([v]) => !(floorHeld && v === 'pedestal')),
      this.viewer.getGround(),
    );
    ground.addEventListener('change', () => this.viewer.setGround(ground.value as GroundMode));
    this.groundSelect = ground;
    sec.appendChild(labelRow('Ground', ground));

    // Floor/pedestal share one PBR surface (they're mutually exclusive);
    // shadow and none have no surface to style, so the rows fold away.
    const surfaceRows = div('env-rows');
    if (!shared.stagePicker) {
      shared.stagePicker = colorPicker(stage.color, (hex) => this.viewer.setStageColor(hex));
    } else if (!shared.stagePicker.isOpen()) {
      shared.stagePicker.set(stage.color);
    }
    surfaceRows.appendChild(labelRow('Surface albedo', shared.stagePicker.root));
    surfaceRows.appendChild(
      compactRange('Surface roughness', 0, 1, 0.01, stage.roughness, (v) => this.viewer.setStageRoughness(v), { limits: FRACTION }),
    );
    surfaceRows.appendChild(
      compactRange('Surface metalness', 0, 1, 0.01, stage.metalness, (v) => this.viewer.setStageMetalness(v), { limits: FRACTION }),
    );
    const pedestalRow = compactRange('Pedestal width', 0.5, 2, 0.05, stage.pedestalScale, (v) => this.viewer.setPedestalScale(v), {
      limits: { min: 0.1 },
    });
    if (!floorHeld) surfaceRows.appendChild(pedestalRow);
    sec.appendChild(surfaceRows);
    // A project on real units stands on a fixed floor at 0 (owner decision),
    // which this raises or lowers, in centimetres; saved with the look as the
    // presentation's floorOffset. Sculpt keeps its own in the Scene panel.
    const floorRow = compactRange('Floor offset', -100, 100, 0.5, this.viewer.getFloorOffset(), (cm) => this.viewer.setFloorOffset(cm), {
      unit: ' cm',
      limits: { min: -FLOOR_OFFSET_LIMIT, max: FLOOR_OFFSET_LIMIT },
    });
    floorRow.classList.add('panel__floor-offset');
    if (floorHeld && this.shared.opts.owner !== 'sculpt') sec.appendChild(floorRow);

    // Conditional rows in one place, re-run by every select that changes them
    // and by sync (the G key cycles ground externally).
    const sync = (): void => {
      hdriRows.hidden = bg.value !== 'hdri';
      bgColorRow.hidden = bg.value !== 'color';
      surfaceRows.hidden = ground.value !== 'floor' && ground.value !== 'pedestal';
      pedestalRow.hidden = ground.value !== 'pedestal';
      floorRow.hidden = ground.value === 'off';
    };
    bg.addEventListener('change', sync);
    ground.addEventListener('change', sync);
    this.syncRows = sync;
    sync();
  }

  // --- developer overlay (?dev) -----------------------------------------

  private buildDeveloper(body: HTMLElement): void {
    const lighting = this.viewer.lighting;
    const dev = section(body, 'Developer');
    dev.appendChild(compactRange('Bias', -0.003, 0.001, 0.0001, lighting.getBias(), (v) => lighting.setBias(v)));
    dev.appendChild(
      compactRange('Normal bias', 0, 0.1, 0.005, lighting.getNormalBias(), (v) => lighting.setNormalBias(v), { limits: AMOUNT }),
    );
    const quality = selectEl(
      ['auto', 'high', 'medium', 'low'].map((q) => [q, q] as const),
      new URLSearchParams(location.search).get('q') ?? 'auto',
    );
    quality.addEventListener('change', () => {
      const params = new URLSearchParams(location.search);
      if (quality.value === 'auto') params.delete('q');
      else params.set('q', quality.value);
      location.search = params.toString();
    });
    dev.appendChild(labelRow('Quality', quality));
    if (this.viewer.aoAvailable()) {
      dev.appendChild(checkbox('AO', this.viewer.getAOState().enabled, (on) => this.viewer.setAO({ enabled: on })));
    }
  }
}

function devMode(): boolean {
  return new URLSearchParams(location.search).has('dev');
}

/**
 * Slider travel for the light and HDRI intensities (owner call: most of the
 * old 0..8 and 0..3 went unused at the top). A value past either is still
 * reached by typing it, and a look saved with one still renders as it was.
 * The HDRI's 0..2 is on its own scale (Environment's ENV_INTENSITY_SCALE),
 * the renderer's 0..0.4; the plate's brightness runs 0..2 around its 1.
 */
const LIGHT_INTENSITY_MAX = 5;
const HDRI_INTENSITY_MAX = 2;
const BG_BRIGHTNESS_MAX = 2;

/**
 * Ambient occlusion's travel. GTAO's strength runs to 2, all of it usable now
 * that it deepens rather than clips (see DEFAULT_AO in Viewer). Its radius
 * runs 1 mm to 10 cm in a scene on real units, and 0.05 to 1 of the
 * subject's radius in one without. The cavity's taps past about 12 px stamp
 * offset copies of an edge onto the surface behind it, so its travel ends
 * there; a wider one can be typed.
 */
const AO_STRENGTH_MAX = 2;
const AO_RADIUS_MIN = 0.05;
const AO_RADIUS_MAX = 1;
const AO_RADIUS_CM_MIN = 0.1;
const AO_RADIUS_CM_MAX = 10;

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

/** A rig as the Lighting tab's list shows it, for the tests and the console. */
export function builtInRigs(): { id: string; label: string; rig: RigValues }[] {
  return PRESETS.map((p) => ({ id: p.id, label: p.label, rig: presetRig(p) }));
}
