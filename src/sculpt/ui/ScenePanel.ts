import { div, labelRow, selectEl } from '../../ui/dom';
import { compactRange } from '../../ui/Panel';
import { setSliderValue, sliderValue } from '../../ui/sliderEntry';
import { FLOOR_OFFSET_LIMIT, formatLength } from '../../viewer/units';
import { chordLabel, keymap } from '../../ui/keymap';
import { SidePanel } from './SidePanel';
import { PRIMITIVE_SIZES, type PrimitiveKind, type SculptSession } from '../bridge/SculptSession';
import { BASE_MESHES, BASE_MESH_GROUPS, baseMeshThumbUrl, type BaseMeshInfo } from '../bridge/basemeshes';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { MaterialLibrary } from '../bridge/materials';
import { RemeshTooLarge } from '../bridge/remeshBudget';
import { statusToast } from './statusToast';
import { withLayersFlattened } from './layerGate';
import { deviceStore } from '../../ui/deviceStorage';
import { askText, askWindow } from '../../ui/askWindow';
import { FIGURES } from '../../armature/figures';
import { RIG_PRESETS } from '../../armature/presets';

/** Where an armature tile's picture is (tools/render-armature-thumbs.mjs makes them). */
export function armatureThumbUrl(id: string): string {
  return `/assets/armature/thumbs/${id}.png`;
}

/** One armature the Create choices offer: each mannequin and placeholder rig the Armature tab's Preset select lists. */
export interface ArmatureChoice {
  id: string;
  label: string;
}

/** The armatures on offer, in the Preset select's order. */
export function armatureChoices(): ArmatureChoice[] {
  return [...RIG_PRESETS, ...FIGURES].map((p) => ({ id: p.id, label: p.label }));
}

/**
 * Scene outliner: the upper-left docked panel, and only the objects. Each
 * row is an eye (visibility), a padlock (edit lock), the name - click
 * selects, ctrl+click adds or removes, shift+click takes the range,
 * double-click renames in place - and, on the active row, a trash can.
 * The up and down arrows walk the rows, wrapping at the ends, and pick
 * each as a click would (with Shift, as a shift+click would).
 * Create is the panel's one button, above the list (owner call);
 * Duplicate, Delete, Mirror, Radial copies and Merge are the Edit menu's
 * (Merge also the Model panel's, under Remesh), and act on the whole
 * selection through the methods here. Solo (alt+q, or its button on the
 * viewport's rail above the strength slider) shows the active object
 * alone, and the panel says so on its tab and title bar while it is on.
 * The material row sits directly under the list, then, in a scene on real
 * units, the Floor offset. New materials are made from the dropdown's own
 * trailing "New*" entry rather than a separate button. The selected
 * object's own material values, topology and mask are the Model panel's,
 * docked under this one; saving, exporting and capture live in the top row.
 */
export class ScenePanel extends SidePanel {
  private readonly listEl: HTMLDivElement;
  private readonly addMenu: HTMLDivElement;
  /** The Create choices as the panel's own empty state (the same choices as the menu's, built by the same code). */
  private readonly emptyEl: HTMLDivElement;
  /** Every "Blockouts as" pill, in the menu and in the empty state: they show one setting. */
  private readonly partPills: HTMLButtonElement[] = [];
  private matRow?: HTMLDivElement;
  /** The Floor offset row. */
  private readonly floorRow: HTMLLabelElement;
  private readonly floorInput: HTMLInputElement;
  /** The Floor offset follows a look restored elsewhere, which tells the panel nothing: polled. */
  private readonly floorTimer: number;
  /** The object whose name is being edited, so refresh keeps the input. */
  private renaming: SculptMesh | null = null;

  /**
   * Fired after any panel-driven scene edit that bypasses the undo stack
   * (rename, eye, padlock): the mount syncs the display side and tells the
   * autosave. Selection and history-backed edits announce themselves.
   */
  onSceneEdit: (() => void) | null = null;
  /**
   * The Solo chip was pressed: the mount turns solo on or off
   * and syncs the display. Not an edit (solo is view state), so not
   * onSceneEdit.
   */
  onSolo: ((on: boolean) => void) | null = null;
  /**
   * After every refresh (the list or the selection changed): the Model
   * panel's Merge follows whether there is anything to merge.
   */
  onRefresh: (() => void) | null = null;
  /**
   * An armature tile was chosen: the page makes it the scene's armature and goes to the Armature
   * workspace (asking first when the current one has been posed).
   */
  onArmature: ((id: string) => void) | null = null;
  /** A Create choice added an object to a scene that had none: the page frames it. */
  onCreatedFirst: (() => void) | null = null;

  private readonly soloChip: HTMLButtonElement;
  /** A rebind in Preferences re-titles the Solo chip at once. */
  private readonly offKeymap: () => void;
  /** Blockouts arrive as their separate lumps rather than one shell. */
  private blockoutParts = readBlockoutParts();

  /** Any press outside the popup dismisses it, menu-style. */
  private readonly onDocPointerDown = (e: Event): void => {
    const t = e.target as Node;
    if (this.addMenu.hidden || !this.addMenu.contains(t)) this.closeMenus();
  };

  constructor(
    private readonly session: SculptSession,
    private readonly library?: MaterialLibrary,
    /** The viewer's fixed floor, which the Floor offset raises or lowers (centimetres). */
    private readonly floor?: { get(): number; set(cm: number): void },
  ) {
    super({ id: 'scene', title: 'Scene', side: 'left', variant: 'panel--scene' });

    // Solo's sign, open or docked: every other object has just left the
    // view, and this panel is where to look for why. The chip by the title
    // is also the way out, for a press made by accident by someone who does
    // not know the key. Both show only while solo is on (panel--solo).
    this.soloChip = document.createElement('button');
    this.soloChip.type = 'button';
    this.soloChip.className = 'outliner__solo';
    this.soloChip.textContent = 'Solo';
    this.soloChip.addEventListener('click', () => this.onSolo?.(false));
    this.title.after(this.soloChip);
    const tabNote = document.createElement('span');
    tabNote.className = 'handle__note';
    tabNote.textContent = 'Solo';
    this.tabLabel.after(tabNote);

    // Create sits above the object list it adds to (owner layout call),
    // the panel's one button: the rest of what you do to the list is the
    // Edit menu's.
    const header = div('outliner__header');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'outliner__btn outliner__btn--wide';
    addBtn.textContent = 'Create';

    // The menu lives on the body, not in the panel: the panel body scrolls
    // and clips, and with only the default sphere in the list the panel is
    // shorter than the menu, so an in-flow popup was simply invisible.
    // Fixed positioning against the button's own rect sidesteps both.
    this.addMenu = div('outliner__menu outliner__menu--create');
    this.addMenu.hidden = true;
    this.buildCreateChoices(this.addMenu);
    document.body.appendChild(this.addMenu);
    // The same choices are what an empty scene shows in the panel itself.
    this.emptyEl = div('outliner__empty');
    const line = div('outliner__empty-line');
    line.textContent = 'Add something to start.';
    const choices = div('outliner__choices');
    this.buildCreateChoices(choices);
    this.emptyEl.append(line, choices);
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.addMenu.hidden) this.openMenu(this.addMenu, addBtn);
      else this.closeMenus();
    });
    header.append(addBtn);
    this.body.appendChild(header);

    this.listEl = div('outliner');
    this.body.appendChild(this.listEl);
    // The selection's material, directly under the list (owner call).
    this.matRow = div('outliner__material');
    this.body.appendChild(this.matRow);
    // Where the floor is (owner decision: the floor fixed at 0 and offset
    // here). A scene from before real units has no floor of its own to
    // offset: it follows the subject until Set scale.
    const measure = div('outliner__measure');
    this.floorRow = compactRange(
      'Floor offset',
      -100,
      100,
      0.5,
      this.floor?.get() ?? 0,
      (cm) => this.floor?.set(cm),
      { unit: ' cm', limits: { min: -FLOOR_OFFSET_LIMIT, max: FLOOR_OFFSET_LIMIT } },
    );
    this.floorRow.title = 'Raise or lower the floor the scene stands on';
    this.floorInput = this.floorRow.querySelector('input') as HTMLInputElement;
    measure.append(this.floorRow);
    this.body.appendChild(measure);
    // After the rest, so the header is still the body's first child.
    this.body.appendChild(this.emptyEl);
    this.floorTimer = window.setInterval(() => this.refreshFloor(), 500);

    // A collapsing panel must not leave its popup menu armed.
    this.onCollapsedChange = (collapsed) => {
      if (collapsed) this.closeMenus();
    };
    this.offKeymap = keymap.onChange(() => this.refresh());
    this.refresh();
  }

  /**
   * The Create choices, built into the Create popup and into the panel's empty state alike, so
   * the two cannot differ: the procedural primitives as a row of words, the base-mesh library
   * as thumbnail tiles by group, then the armatures as tiles. A tile fetches its file when
   * picked - the library is 8 MB and a session touches one or two entries - and says so on the
   * tile until the objects are in the scene.
   */
  private buildCreateChoices(into: HTMLElement): void {
    const head = (text: string, aside?: string): void => {
      const h = div('outliner__menu-head');
      h.textContent = text;
      if (aside) {
        const a = document.createElement('span');
        a.className = 'outliner__menu-aside';
        a.textContent = aside;
        h.appendChild(a);
      }
      into.appendChild(h);
    };
    // Each primitive says the size it comes at in a scene on real units;
    // in one from before, they come at its old sizes and say none.
    head('Primitives', this.session.getUnits() ? 'real size' : undefined);
    const words = div('outliner__menu-grid outliner__menu-grid--words');
    const primitives: [PrimitiveKind, string][] = [
      ['sphere', 'Sphere'],
      ['cube', 'Cube'],
      ['cylinder', 'Cylinder'],
      ['torus', 'Torus'],
      ['cone', 'Cone'],
      ['capsule', 'Capsule'],
      ['plane', 'Plane'],
    ];
    for (const [kind, label] of primitives) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'outliner__menu-item';
      item.dataset.kind = kind;
      item.textContent = label;
      if (this.session.getUnits()) {
        const size = document.createElement('span');
        size.className = 'outliner__menu-size';
        size.textContent = formatLength(PRIMITIVE_SIZES[kind].size);
        item.appendChild(size);
      }
      item.addEventListener('click', () => {
        this.closeMenus();
        const first = this.isSceneEmpty();
        this.session.addPrimitive(kind);
        if (first) this.onCreatedFirst?.();
      });
      words.appendChild(item);
    }
    into.appendChild(words);
    head('Base meshes', 'Blender Studio · CC0');
    // The blockouts' one choice (owner request): the remeshed shell, or
    // every lump as its own object, the way the Armature keeps them.
    const row = div('outliner__menu-switch');
    const lead = document.createElement('span');
    lead.textContent = 'Blockouts as';
    row.appendChild(lead);
    for (const [parts, label] of [
      [false, 'one object'],
      [true, 'parts'],
    ] as const) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'outliner__menu-pill';
      pill.dataset.parts = String(parts);
      pill.textContent = label;
      pill.setAttribute('aria-pressed', String(parts === this.blockoutParts));
      pill.addEventListener('click', () => {
        this.blockoutParts = parts;
        writeBlockoutParts(parts);
        for (const p of this.partPills) p.setAttribute('aria-pressed', String((p.dataset.parts === 'true') === parts));
      });
      this.partPills.push(pill);
      row.appendChild(pill);
    }
    into.appendChild(row);
    for (const { group, title } of BASE_MESH_GROUPS) {
      const sub = div('outliner__menu-sub');
      sub.textContent = title;
      into.appendChild(sub);
      const grid = div('outliner__menu-grid');
      for (const info of BASE_MESHES) if (info.group === group) grid.appendChild(this.baseMeshTile(info));
      into.appendChild(grid);
    }
    // One armature a scene for now: a tile makes that mannequin the scene's armature.
    head('Armatures', 'Posable mannequins');
    const arms = div('outliner__menu-grid');
    for (const choice of armatureChoices()) arms.appendChild(this.armatureTile(choice));
    into.appendChild(arms);
  }

  private armatureTile(choice: ArmatureChoice): HTMLButtonElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'outliner__tile outliner__tile--armature';
    tile.dataset.armature = choice.id;
    tile.title = choice.label;
    const img = document.createElement('img');
    img.src = armatureThumbUrl(choice.id);
    img.alt = '';
    img.loading = 'lazy';
    img.draggable = false;
    const name = document.createElement('span');
    name.className = 'outliner__tile-name';
    name.textContent = choice.label;
    tile.append(img, name);
    tile.addEventListener('click', () => {
      this.closeMenus();
      this.onArmature?.(choice.id);
    });
    return tile;
  }

  /** The scene has nothing in it: no object and no armature. */
  private isSceneEmpty(): boolean {
    return this.session.getMeshes().length === 0 && !this.armatureRow?.();
  }

  private baseMeshTile(info: BaseMeshInfo): HTMLButtonElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'outliner__tile';
    tile.dataset.id = info.id;
    const faces = info.faces >= 1000 ? `${Math.round(info.faces / 1000)}k` : `${info.faces}`;
    const size = info.kb >= 1000 ? `${(info.kb / 1024).toFixed(1)} MB` : `${info.kb} KB`;
    tile.title = `${info.label}, ${info.note} · ${faces} faces, ${size} · by ${info.by}`;
    const img = document.createElement('img');
    img.src = baseMeshThumbUrl(info.id);
    img.alt = '';
    img.loading = 'lazy';
    img.draggable = false;
    const name = document.createElement('span');
    name.className = 'outliner__tile-name';
    name.textContent = info.label;
    const note = document.createElement('span');
    note.className = 'outliner__tile-note';
    note.textContent = info.note;
    tile.append(img, name, note);
    tile.addEventListener('click', () => void this.addBaseMesh(info.id, tile));
    return tile;
  }

  /**
   * Fetch a base mesh and add it. The tile reports on its own note line:
   * "Loading…" while the file comes in, "Failed" for a moment if it did not
   * (offline and never fetched, most likely). The menu closes on success,
   * the way a primitive's does; a failure leaves it open to try another.
   */
  async addBaseMesh(id: string, tile?: HTMLButtonElement): Promise<void> {
    if (tile?.disabled) return;
    const note = tile?.querySelector<HTMLElement>('.outliner__tile-note');
    const was = note?.textContent ?? '';
    if (tile) {
      tile.disabled = true;
      tile.classList.add('is-loading');
    }
    if (note) note.textContent = 'Loading…';
    let failed = false;
    try {
      const first = this.isSceneEmpty();
      await this.session.addBaseMesh(id, { parts: this.blockoutParts });
      this.closeMenus();
      if (first) this.onCreatedFirst?.();
    } catch (err) {
      console.error(err);
      failed = true;
    } finally {
      if (tile) {
        tile.disabled = false;
        tile.classList.remove('is-loading');
      }
      if (note) {
        note.textContent = failed ? 'Failed' : was;
        if (failed) setTimeout(() => (note.textContent = was), 2500);
      }
    }
  }

  private openMenu(menu: HTMLDivElement, anchor: HTMLElement): void {
    this.closeMenus();
    const btn = anchor.getBoundingClientRect();
    const panel = this.root.getBoundingClientRect();
    menu.hidden = false;
    // Measured after unhiding so the height is real. Opens BESIDE the panel
    // rather than over it - the object list is the thing you are adding to,
    // so covering it while choosing reads badly - level with the button at
    // the top of the panel, and falls back to below the button if there is
    // no room to the right.
    const h = menu.offsetHeight;
    const w = menu.offsetWidth;
    const right = panel.right + 6;
    const fitsRight = right + w <= window.innerWidth - 8;
    const left = fitsRight ? right : Math.max(8, btn.left);
    const wanted = fitsRight ? btn.top : btn.bottom + 6;
    const top = Math.min(window.innerHeight - h - 8, Math.max(8, wanted));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    document.addEventListener('pointerdown', this.onDocPointerDown, true);
  }

  private closeMenus(): void {
    this.addMenu.hidden = true;
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
  }

  /** Whether there is anything for Duplicate, Delete, Mirror and Radial copies to act on. */
  hasTargets(): boolean {
    return this.targets().length > 0;
  }

  /** Whether Merge has something to do: two objects or more selected. */
  canMerge(): boolean {
    return this.targets().length >= 2;
  }

  /** What an action applies to: the selection, or the active object alone. */
  private targets(): SculptMesh[] {
    // A copy: the copy operations edit the selection while this is walked.
    const selected = [...this.session.getSelectedMeshes()];
    if (selected.length > 0) return selected;
    const active = this.session.getMesh();
    return active ? [active] : [];
  }

  /**
   * Run a copy operation over the targets and select what it made. The
   * library fills a new object's colours with its material the moment it
   * is selected; held off here, so a painted source's copy keeps its paint
   * and is then adopted with the same material and the same claim.
   */
  private copyEach(make: (source: SculptMesh) => SculptMesh[]): void {
    const sources = this.targets();
    if (sources.length === 0) return;
    const made: SculptMesh[] = [];
    this.library?.beginRestore();
    try {
      for (const source of sources) {
        for (const copy of make(source)) {
          this.library?.adoptCopy(copy, source);
          made.push(copy);
        }
      }
    } finally {
      this.library?.endRestore();
    }
    // The copies are the selection now (the last one active), as they
    // would be in Maya: the next move or mirror works on what was made.
    if (made.length > 0) this.session.selectSet(made);
    this.refresh();
  }

  /** A mirrored copy of each selected object across a world axis. */
  mirrorActive(axis: 'x' | 'y' | 'z'): void {
    this.copyEach((source) => {
      const copy = this.session.mirrorMesh(source, axis) as unknown as SculptMesh | null;
      return copy ? [copy] : [];
    });
  }

  /** Copies of each selected object turned around the brush's symmetry axis. */
  radialActive(count: number): void {
    const axis = this.session.getSymmetryAxis();
    this.copyEach(
      (source) => this.session.radialCopies(source, count, axis) as unknown as SculptMesh[],
    );
  }

  /**
   * Merge: the selected objects become one, through a shared voxel grid at
   * the Model panel's remesh resolution. The active object is the base:
   * the result takes its place in the list, its name and its material.
   * Ctrl+z brings the originals back.
   */
  mergeSelected(): void {
    const sources = this.targets();
    if (sources.length < 2) return;
    withLayersFlattened(this.session, sources, 'merge', () => this.mergeNow(sources));
  }

  private mergeNow(sources: SculptMesh[]): void {
    const base = this.session.getMesh() && sources.includes(this.session.getMesh()!) ? this.session.getMesh()! : sources[0];
    this.library?.beginRestore();
    let merged: SculptMesh | null;
    try {
      merged = this.session.mergeMeshes(sources, base) as unknown as SculptMesh | null;
    } catch (err) {
      // The union's grid is past this device's memory: said, nothing merged.
      if (!(err instanceof RemeshTooLarge)) throw err;
      statusToast('Merging...').fail(err.message);
      return;
    } finally {
      this.library?.endRestore();
    }
    if (!merged) return;
    this.library?.adoptCopy(merged, base);
    this.session.render();
    this.refresh();
  }

  /**
   * Edit > Split groups into objects, Split hidden into object and Delete
   * hidden, on the active object (SculptSession.splitGroups and the rest):
   * the new objects take its material, and the whole is one undo step.
   */
  splitActive(kind: 'groups' | 'hidden' | 'delete-hidden'): void {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    withLayersFlattened(this.session, [mesh], 'split', () => this.splitNow(mesh, kind));
  }

  private splitNow(mesh: SculptMesh, kind: 'groups' | 'hidden' | 'delete-hidden'): void {
    this.library?.beginRestore();
    let out: { made: SculptMesh[]; flat: boolean } | null;
    try {
      out =
        kind === 'groups'
          ? this.session.splitGroups(mesh)
          : kind === 'hidden'
            ? this.session.splitHidden(mesh)
            : this.session.deleteHidden(mesh);
    } finally {
      this.library?.endRestore();
    }
    if (!out) return;
    for (const part of out.made) this.library?.adoptCopy(part, mesh);
    const flat = out.flat ? ' (cut at the level on screen, as one level: after a Rebuild the base mesh cannot be cut)' : '';
    const said =
      kind === 'groups'
        ? `${out.made.length} objects, one a group${flat}`
        : kind === 'hidden'
          ? `The hidden faces are "${this.session.getMeshName(out.made[1])}"${flat}`
          : `Hidden faces deleted${flat}`;
    statusToast('').done(said);
    this.session.render();
    this.refresh();
  }

  /** Duplicate: a copy of each selected object, at its transform, with its material. */
  duplicateSelected(): void {
    this.copyEach((source) => {
      const copy = this.session.duplicateMesh(source) as unknown as SculptMesh | null;
      return copy ? [copy] : [];
    });
  }

  /** Delete: every selected object (the active one when nothing else is), after asking. */
  async deleteSelected(): Promise<void> {
    // A copy: deleteMesh edits the selection list while this walks it.
    const selected = [...this.session.getSelectedMeshes()];
    const targets = selected.length > 0 ? selected : this.session.getMesh() ? [this.session.getMesh()!] : [];
    if (targets.length === 0) return;
    const what =
      targets.length === 1
        ? this.session.getMeshName(targets[0])
        : `${targets.length} objects`;
    // Ctrl+z brings them back, so the window does not threaten permanence.
    const yes = await askWindow({
      title: `Delete ${what}?`,
      text: 'Undo brings it back.',
      yes: 'Delete',
      danger: true,
    });
    if (!yes) return;
    for (const m of targets) this.session.deleteMesh(m);
    this.refresh();
  }

  /** Trash can: drop the selected object, once, after asking. */
  private async deleteActive(): Promise<void> {
    const mesh = this.session.getMesh();
    if (!mesh) return;
    // Ctrl+z brings it back, so the window does not threaten permanence.
    const yes = await askWindow({
      title: `Delete ${this.session.getMeshName(mesh)}?`,
      text: 'Undo brings it back.',
      yes: 'Delete',
      danger: true,
    });
    if (!yes) return;
    this.session.deleteMesh(mesh);
    this.refresh();
  }

  /** A small icon-only button (eye, padlock, trash). */
  private iconBtn(icon: string, title: string, onPress: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'outliner__icon';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    const glyph = document.createElement('i');
    glyph.className = `fi ${icon}`;
    glyph.setAttribute('aria-hidden', 'true');
    btn.appendChild(glyph);
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // the row behind selects; the icons must not
      onPress();
    });
    return btn;
  }

  /** Swap the name for an input; Enter/blur commits, Escape abandons. */
  private startRename(mesh: SculptMesh, nameEl: HTMLElement): void {
    this.renaming = mesh;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'outliner__rename';
    input.value = this.session.getMeshName(mesh);
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return; // Enter commits, then the removal fires blur too
      done = true;
      this.renaming = null;
      const next = input.value.trim();
      if (commit && next && next !== this.session.getMeshName(mesh)) {
        this.session.setMeshName(mesh, next);
        this.onSceneEdit?.();
      }
      this.refresh();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not trigger sculpt hotkeys
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  /**
   * A row picked, the way a file list does it (owner request): a plain
   * pick selects just this one, ctrl (cmd on a Mac) adds or removes it,
   * shift takes everything from the active object to here. The row click
   * and the arrow keys both come through here, so a step is a click on the
   * row it lands on, and the gizmo and the highlights follow it alike.
   */
  private pick(mesh: SculptMesh, shift: boolean, ctrl: boolean): void {
    this.armatureActions?.deselect();
    const list = this.session.getMeshes();
    if (shift) {
      const from = list.indexOf(this.session.getMesh() as SculptMesh);
      const to = list.indexOf(mesh);
      const lo = from < 0 ? to : Math.min(from, to);
      const hi = from < 0 ? to : Math.max(from, to);
      // The picked one last, so it becomes the active object.
      const range = list.slice(lo, hi + 1).filter((m) => m !== mesh);
      this.session.selectAdd([...range, mesh]);
    } else if (ctrl) {
      if (this.session.getSelectedMeshes().includes(mesh)) this.session.selectRemove([mesh]);
      else this.session.selectAdd([mesh]);
    } else if (mesh !== this.session.getMesh() || this.session.getSelectedMeshes().length !== 1) {
      this.session.selectSet([mesh]);
    }
  }

  /**
   * The up and down arrows: the row above or below the active one, round
   * from the last to the first and back, picked as a click on it would be
   * (`extend`: as a shift+click), then scrolled into view. Hidden and
   * locked objects are rows like any other; the gizmo declines them as it
   * does a click. A shift step that wraps is a shift+click on the far end,
   * so it takes the whole list.
   */
  step(dir: 1 | -1, extend: boolean): void {
    // A name being edited keeps the keys: the shell leaves a text field's
    // keys alone, and a step from anywhere else would rebuild the rows,
    // the field with them, under it.
    if (this.renaming) return;
    const list = this.session.getMeshes();
    if (list.length === 0) return;
    const at = list.indexOf(this.session.getMesh() as SculptMesh);
    // With nothing active, down starts at the top and up at the bottom.
    const to = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
    this.pick(list[to], extend, false);
    this.revealActive();
  }

  /**
   * Scroll the panel's own body until the active row shows. Not
   * scrollIntoView: that also scrolls whatever holds the panel, and a
   * docked panel sits off the edge of the screen.
   */
  private revealActive(): void {
    const row = this.listEl.querySelector<HTMLElement>('.outliner__row--active');
    if (!row) return;
    const view = this.body.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < view.top) this.body.scrollTop -= view.top - r.top;
    else if (r.bottom > view.bottom) this.body.scrollTop += r.bottom - view.bottom;
  }

  /**
   * The scene's units changed (New, Open, Set scale): the Create menu's
   * sizes and the Floor offset row follow.
   */
  refreshUnits(): void {
    this.closeMenus();
    this.addMenu.replaceChildren();
    const choices = this.emptyEl.querySelector('.outliner__choices') as HTMLElement;
    choices.replaceChildren();
    this.partPills.length = 0;
    this.buildCreateChoices(this.addMenu);
    this.buildCreateChoices(choices);
    this.refresh();
  }

  /** The Floor offset as it stands, shown only in a scene on real units. */
  private refreshFloor(): void {
    const units = this.session.getUnits();
    this.floorRow.hidden = !units || !this.floor;
    // A typed value or a look restored elsewhere moves it; a held thumb wins.
    if (this.floor && document.activeElement !== this.floorInput) {
      const cm = this.floor.get();
      if (Math.abs(sliderValue(this.floorInput) - cm) > 1e-6) setSliderValue(this.floorInput, cm);
    }
  }

  /**
   * The scene's armature, while its mannequin stands in the scene as it is posed and no figure has
   * been made from it: a row of its own, marked by the armature's icon, with an eye (shown as on in
   * the Armature workspace, where the mannequin always shows) and none of an object's other controls
   * (no lock, material or delete; it takes no strokes). `name` is the mannequin's own, never the
   * scene's. Null: no row.
   */
  armatureRow: (() => { name: string; shown: boolean; selected: boolean } | null) | null = null;
  /** What the armature's row does: the eye, and a tap on the row (it takes the selection's mark off the objects; a tap on an object gives it back). */
  armatureActions: { toggle(): void; select(): void; deselect(): void } | null = null;

  /** Rebuild the object rows from the live scene (list/selection changes). */
  refresh(): void {
    const active = this.session.getMesh();
    const selected = new Set(this.session.getSelectedMeshes());
    const solo = this.session.isSolo();
    const chord = keymap.chordFor('view.solo');
    const key = chord ? chordLabel(chord) : null;
    this.root.classList.toggle('panel--solo', solo);
    this.soloChip.title =
      `Solo: only the active object is showing. Click${key ? ` or press ${key}` : ''} ` +
      'to show the others again.';
    // The object under rename can vanish mid-edit (undo, delete elsewhere);
    // a stale flag would wait forever for an input that no longer exists.
    if (this.renaming && !this.session.getMeshes().includes(this.renaming)) this.renaming = null;
    const armature = this.armatureRow?.() ?? null;
    // An empty scene shows the Create choices in the panel, where the list and its Create button go.
    this.root.classList.toggle('panel--scene-empty', this.session.getMeshes().length === 0 && !armature);
    this.listEl.replaceChildren(
      ...this.session.getMeshes().map((mesh) => {
        const row = div('outliner__row');
        const visible = mesh.isVisible();
        // The padlock is the user's: a quad remesh's own hold while it
        // runs (SculptSession.setQuadBusy) does not show on it.
        const locked = this.session.isPadlocked(mesh);
        if (armature?.selected) {
          // The armature's row holds the mark.
        } else if (mesh === active) row.classList.add('outliner__row--active');
        // The Select tool's selection, beside the active object's row.
        else if (selected.has(mesh)) row.classList.add('outliner__row--selected');
        if (!visible) row.classList.add('outliner__row--hidden');

        // Under solo the eye shows what is on screen, and a click on it
        // ends solo before it applies (SculptSession.setMeshVisible).
        const eyeTitle = visible ? 'Hide' : 'Show';
        row.appendChild(
          this.iconBtn(
            visible ? 'fi-ss-eye' : 'fi-ss-eye-crossed',
            solo ? `${eyeTitle} (ends solo)` : eyeTitle,
            () => {
              this.session.setMeshVisible(mesh, !visible);
              this.onSceneEdit?.();
              this.refresh();
            },
          ),
        );
        const lockBtn = this.iconBtn(
          locked ? 'fi-ss-lock' : 'fi-ss-unlock',
          locked ? 'Unlock editing' : 'Lock editing',
          () => {
            this.session.setLocked(mesh, !locked);
            this.onSceneEdit?.();
            this.refresh();
          },
        );
        if (locked) lockBtn.classList.add('outliner__icon--on');
        row.appendChild(lockBtn);

        if (this.renaming === mesh) {
          // Rebuilt mid-rename (a background refresh): stay in edit mode.
          const placeholder = document.createElement('span');
          row.appendChild(placeholder);
          this.startRename(mesh, placeholder);
        } else {
          const name = document.createElement('span');
          name.className = 'outliner__name';
          name.textContent = this.session.getMeshName(mesh);
          name.addEventListener('dblclick', () => this.startRename(mesh, name));
          row.appendChild(name);
        }

        // On the last object too: it may go (owner call, 2026-11-01).
        if (mesh === active) {
          const del = this.iconBtn('fi-ss-trash', 'Delete object', () => this.deleteActive());
          del.classList.add('outliner__icon--danger');
          row.appendChild(del);
        }

        row.addEventListener('click', (e) => this.pick(mesh, e.shiftKey, e.ctrlKey || e.metaKey));
        return row;
      }),
    );
    if (armature) {
      const row = div('outliner__row outliner__row--armature');
      row.dataset.role = 'armature-row';
      if (armature.selected) row.classList.add('outliner__row--active');
      if (!armature.shown) row.classList.add('outliner__row--hidden');
      row.title = 'The armature: its posed mannequin, which cannot be sculpted. Make a figure from it in the Armature tab or the Model tab.';
      const eye = this.iconBtn(armature.shown ? 'fi-ss-eye' : 'fi-ss-eye-crossed', armature.shown ? 'Hide' : 'Show', () => this.armatureActions?.toggle());
      eye.dataset.role = 'armature-eye';
      const mark = document.createElement('i');
      mark.className = 'fi fi-ss-bone outliner__mark';
      mark.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'outliner__name';
      name.textContent = armature.name;
      row.append(eye, mark, name);
      row.addEventListener('click', () => this.armatureActions?.select());
      this.listEl.appendChild(row);
    }
    this.refreshMaterial();
    if (this.floorRow) this.refreshFloor();
    this.onRefresh?.();
  }

  /**
   * The active object's material, and a way to make another. Assignment
   * lives here rather than in the Render panel because it is a property of
   * the OBJECT; the Render panel edits whichever material the selection
   * points at.
   */
  private refreshMaterial(): void {
    if (!this.library || !this.matRow) return;
    const active = this.session.getMesh();
    this.matRow.hidden = !active;
    if (!active) return;
    const current = this.library.materialFor(active);
    // The trailing "New*" entry IS the create button (owner call): picking
    // it prompts for a name, makes the material and assigns it here.
    const NEW_ID = '__new__';
    const select = selectEl(
      [
        ...this.library.list().map((m) => [m.id, m.name] as [string, string]),
        [NEW_ID, 'New*'] as [string, string],
      ],
      current.id,
    );
    // The padlock means "not edited": a locked object's material is read-only with it.
    select.disabled = this.session.isLocked(active);
    select.addEventListener('change', () => {
      void (async () => {
        const picked = select.value;
        if (picked === NEW_ID) {
          const name = await askText({ title: 'New material', label: 'Material name', value: 'Clay', yes: 'Make material' });
          if (name === null) {
            select.value = current.id;
            return;
          }
          this.library!.assign(active, this.library!.create(name.trim() || 'Clay').id);
          this.session.render();
          this.refreshMaterial(); // the new material takes the slot, "New*" stays last
          return;
        }
        this.library!.assign(active, picked);
        this.session.render();
      })();
    });
    this.matRow.replaceChildren(labelRow('Material', select));
  }

  override dispose(): void {
    clearInterval(this.floorTimer);
    this.offKeymap();
    this.closeMenus();
    this.addMenu.remove();
    super.dispose();
  }
}

const BLOCKOUT_PARTS_KEY = 'bozzetto:blockout-parts';

/** The switch's last setting, per browser; storage may be unavailable. */
function readBlockoutParts(): boolean {
  try {
    return deviceStore.get(BLOCKOUT_PARTS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeBlockoutParts(parts: boolean): void {
  try {
    deviceStore.set(BLOCKOUT_PARTS_KEY, parts ? '1' : '0');
  } catch {
    /* private mode, or storage full: the setting lasts the session */
  }
}

