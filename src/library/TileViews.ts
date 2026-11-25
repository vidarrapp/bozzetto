import { CONTROLS_REFRESH_EVENT } from '../ui/Panel';
import { RIGS_CHANGED_EVENT, myRigs } from '../ui/rigLibrary';
import type { PrimitiveKind } from '../sculpt/bridge/SculptSession';
import type { Viewer } from '../viewer/Viewer';
import { ENVIRONMENT_ASSETS, MATCAP_ASSETS, rigAssets } from './assets';
import { modelGroups, type ModelAsset } from './modelAssets';
import type { LibraryContext, LibraryView } from './AssetLibrary';

/**
 * The Asset library's picture tabs: Models, Materials, Lighting and HDRIs. Each is a few groups of
 * tiles (a picture and a name) built from the lists in assets.ts and modelAssets.ts, the same lists
 * the panels' own pickers are built from. A tap does what choosing the same thing in its panel does;
 * the one in use is marked as the tool in hand is. Nothing is lifted from these tiles, so a drag on
 * one scrolls the window (touch-action: pan-y) and only a tap, which is a click, uses it.
 */

interface TileItem {
  id: string;
  label: string;
  /** A second, smaller line (a base mesh's style). */
  note?: string;
  thumb?: string;
  /** A plain colour swatch in place of a picture (a scene's material). */
  swatch?: string;
  title?: string;
}

/** The scene's materials, as the Scene panel's select lists them (the library's own list, read where the panel reads it). */
export interface SceneMaterialsHost {
  list(): { id: string; name: string; albedo: string }[];
  /** The id the active object uses, or null with no object active. */
  active(): string | null;
  /** Assigns a material to the active object, as choosing it in the Scene panel does. */
  assign(id: string): void;
}

interface TileGroup {
  id: string;
  title: string;
  aside?: string;
  /** A heading under another group's (the base meshes' Figures, Heads and Parts). */
  sub?: boolean;
  /** A heading of the section this group opens (Base meshes, over Figures). */
  lead?: { title: string; aside?: string };
  items: TileItem[];
}

interface Tile {
  item: TileItem;
  el: HTMLButtonElement;
  group: TileGroup;
}

/** How often the marks are read again while the tab shows: the panels, the keys and a restored look change what is in use without telling the window. */
const PAINT_MS = 500;

abstract class TileView implements LibraryView {
  protected ctx!: LibraryContext;
  private root: HTMLDivElement | null = null;
  private readonly tiles: Tile[] = [];
  private readonly boxes = new Map<string, HTMLElement>();
  private readonly empty = document.createElement('p');
  private readonly mineLine = document.createElement('p');
  private mineBox: HTMLElement | null = null;
  private mineTiles: Tile[] = [];
  private timer = 0;

  /** The tab's own name, for the roles of its parts. */
  protected abstract readonly tab: string;
  protected abstract groups(): TileGroup[];
  /** What a tap does. */
  protected abstract use(item: TileItem, tile: HTMLButtonElement): void;
  /** The id in use now, of the groups' items (null: none of them). */
  protected abstract inUse(): string | null;
  /** The line under Mine when it has nothing. */
  protected mineEmpty(): string {
    return 'Nothing of yours here yet.';
  }
  /** What is under Mine (the tab's own copies). */
  protected mine(): TileItem[] {
    return [];
  }
  /** Tiles that are coming now (a file being fetched), by id. */
  protected loading(): ReadonlySet<string> {
    return NONE;
  }
  /** The tab's tail, under the groups (a line of help). */
  protected tail(): string | null {
    return null;
  }
  protected onMount(): (() => void) | null {
    return null;
  }

  private off: (() => void) | null = null;
  private watched = '';

  /** What the Scene list is made of, as text: a change of it reads the list again (the Scene lists follow the scene). */
  protected watch(): string {
    return '';
  }

  mount(body: HTMLElement, ctx: LibraryContext): void {
    this.ctx = ctx;
    const root = document.createElement('div');
    root.className = `lib-pics lib-pics--${this.tab}`;
    root.dataset.pics = this.tab;
    this.root = root;
    for (const g of this.groups()) {
      const box = document.createElement('section');
      box.className = 'lib-group';
      box.dataset.group = g.id;
      if (g.lead) box.appendChild(this.head(g.lead.title, g.lead.aside, false));
      if (g.title) {
        box.appendChild(this.head(g.title, g.aside, !!g.sub));
      }
      const grid = document.createElement('div');
      grid.className = 'lib-grid';
      for (const item of g.items) {
        const tile = this.makeTile(item, g);
        this.tiles.push(tile);
        grid.appendChild(tile.el);
      }
      box.appendChild(grid);
      root.appendChild(box);
      this.boxes.set(g.id, box);
    }
    this.mineBox = document.createElement('section');
    this.mineBox.className = 'lib-group';
    this.mineBox.dataset.group = 'mine';
    root.appendChild(this.mineBox);
    this.empty.className = 'lib-later lib-empty';
    this.empty.textContent = 'Nothing called that.';
    this.mineLine.className = 'lib-later lib-empty';
    root.append(this.empty, this.mineLine);
    const tail = this.tail();
    if (tail) {
      const line = document.createElement('p');
      line.className = 'lib-later lib-pics__tail';
      line.dataset.role = 'library-tail';
      line.textContent = tail;
      root.appendChild(line);
    }
    body.appendChild(root);
    this.off = this.onMount();
    this.timer = window.setInterval(() => this.paint(), PAINT_MS);
    this.refresh();
  }

  private head(title: string, aside: string | undefined, sub: boolean): HTMLElement {
    const head = document.createElement('h3');
    head.className = sub ? 'lib-group__head lib-group__head--sub' : 'lib-group__head';
    head.textContent = title;
    if (aside) {
      const a = document.createElement('span');
      a.className = 'lib-group__aside';
      a.textContent = aside;
      head.appendChild(a);
    }
    return head;
  }

  private makeTile(item: TileItem, group: TileGroup): Tile {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lib-tile lib-tile--pic';
    el.dataset.asset = item.id;
    if (item.title) el.title = item.title;
    if (item.swatch) {
      const sw = document.createElement('span');
      sw.className = 'lib-tile__swatch';
      sw.style.background = item.swatch;
      el.appendChild(sw);
    } else if (item.thumb) {
      const img = document.createElement('img');
      img.src = item.thumb;
      img.alt = '';
      img.loading = 'lazy';
      img.draggable = false;
      el.appendChild(img);
    }
    const name = document.createElement('span');
    name.className = 'lib-tile__name';
    name.textContent = item.label;
    el.appendChild(name);
    if (item.note) {
      const note = document.createElement('span');
      note.className = 'lib-tile__note';
      note.textContent = item.note;
      el.appendChild(note);
    }
    const mark = document.createElement('span');
    mark.className = 'lib-tile__busy';
    mark.setAttribute('aria-hidden', 'true');
    el.appendChild(mark);
    el.addEventListener('click', () => this.use(item, el));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return { item, el, group };
  }

  refresh(): void {
    if (!this.root) return;
    const mine = this.ctx.where() === 'mine';
    const q = this.ctx.query();
    const match = (i: TileItem): boolean => !q || `${i.label} ${i.note ?? ''}`.toLowerCase().includes(q);
    let shown = 0;
    for (const t of this.tiles) {
      const on = !mine && match(t.item);
      t.el.hidden = !on;
      if (on) shown++;
    }
    for (const [id, box] of this.boxes) box.hidden = mine || !this.tiles.some((t) => t.group.id === id && !t.el.hidden);
    // Mine: the tab's own copies, drawn afresh (they change with the person's work).
    this.mineTiles = [];
    this.mineBox?.replaceChildren();
    let mineShown = 0;
    if (mine && this.mineBox) {
      const grid = document.createElement('div');
      grid.className = 'lib-grid';
      for (const item of this.mine()) {
        if (!match(item)) continue;
        const tile = this.makeTile(item, { id: 'mine', title: '', items: [] });
        this.mineTiles.push(tile);
        grid.appendChild(tile.el);
        mineShown++;
      }
      if (mineShown) this.mineBox.appendChild(grid);
    }
    if (this.mineBox) this.mineBox.hidden = !mine || mineShown === 0;
    const kept = mine ? this.mine().length : 0;
    this.empty.hidden = mine ? kept === 0 || mineShown > 0 : shown > 0;
    this.mineLine.hidden = !(mine && kept === 0);
    this.mineLine.textContent = this.mineEmpty();
    const tail = this.root.querySelector<HTMLElement>('.lib-pics__tail');
    if (tail) tail.hidden = mine;
    this.paint();
  }

  /** The marks: the one in use, and the ones coming. */
  protected paint(): void {
    const sig = this.watch();
    if (sig !== this.watched) {
      this.watched = sig;
      this.refresh();
      return;
    }
    if (!this.root || !this.root.isConnected || this.root.offsetParent === null) return;
    const now = this.inUse();
    const coming = this.loading();
    for (const t of [...this.tiles, ...this.mineTiles]) {
      const use = now !== null && this.same(t, now);
      const load = coming.has(t.item.id);
      t.el.classList.toggle('is-use', use);
      t.el.classList.toggle('is-loading', load);
      t.el.setAttribute('aria-busy', String(load));
      t.el.setAttribute('aria-pressed', String(use));
      t.el.dataset.state = load ? 'loading' : use ? 'use' : '';
    }
  }

  /** Whether a tile is the one in use (the Mine tiles of a tab have ids of their own). */
  protected same(t: Tile, now: string): boolean {
    return t.item.id === now;
  }

  protected repaint(): void {
    this.paint();
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.off?.();
    this.off = null;
    this.root?.remove();
    this.root = null;
    this.tiles.length = 0;
    this.mineTiles = [];
  }
}

const NONE: ReadonlySet<string> = new Set();

/** What the Models tab asks of the page it is on (the Scene panel's own Create choices, and its rows). */
export interface ModelsHost {
  /** The Scene panel's rows, in its order: the objects, then the armature. */
  sceneRows(): { id: string; name: string; active: boolean }[];
  /** A tap on a row, as a tap on the row in the Scene panel does. */
  selectRow(id: string): void;
  addPrimitive(kind: PrimitiveKind): void;
  /** Fetches the base mesh and adds it; false when it could not. */
  addBaseMesh(id: string): Promise<boolean>;
  /** Makes the armature the scene's (asks first when it would replace a posed one). */
  setArmature(id: string): void;
}

/** The Models tab: the Create choices, in the same groups. */
export class ModelsView extends TileView {
  protected readonly tab = 'models';
  private readonly coming = new Set<string>();

  constructor(private readonly host: ModelsHost) {
    super();
  }

  protected groups(): TileGroup[] {
    const out: TileGroup[] = [];
    let first = true;
    for (const g of modelGroups()) {
      const lead = g.sub && first ? { title: 'Base meshes', aside: 'Blender Studio · CC0' } : undefined;
      if (g.sub) first = false;
      out.push({ id: g.id, title: g.title, aside: g.aside, sub: g.sub, lead, items: g.items.map((m) => this.item(m)) });
    }
    return out;
  }

  private item(m: ModelAsset): TileItem {
    const i = m.info;
    if (!i) return { id: m.id, label: m.label, thumb: m.thumb, title: m.label };
    const faces = i.faces >= 1000 ? `${Math.round(i.faces / 1000)}k` : `${i.faces}`;
    const size = i.kb >= 1000 ? `${(i.kb / 1024).toFixed(1)} MB` : `${i.kb} KB`;
    return { id: m.id, label: i.label, note: i.note, thumb: m.thumb, title: `${i.label}, ${i.note} · ${faces} faces, ${size} · by ${i.by}` };
  }

  protected override mine(): TileItem[] {
    return this.host.sceneRows().map((r) => ({ id: r.id, label: r.name, title: r.name }));
  }

  protected override mineEmpty(): string {
    return 'Nothing in this scene yet.';
  }

  protected override watch(): string {
    return JSON.stringify(this.host.sceneRows());
  }

  protected inUse(): string | null {
    if (this.ctx.where() !== 'mine') return null;
    return this.host.sceneRows().find((r) => r.active)?.id ?? null;
  }

  protected override loading(): ReadonlySet<string> {
    return this.coming;
  }

  protected use(item: TileItem): void {
    if (this.ctx.where() === 'mine') {
      this.host.selectRow(item.id);
      this.repaint();
      return;
    }
    const group = modelGroups().find((g) => g.items.some((m) => m.id === item.id));
    const kind = group?.items.find((m) => m.id === item.id)?.kind;
    if (kind === 'primitive') this.host.addPrimitive(item.id as PrimitiveKind);
    else if (kind === 'armature') this.host.setArmature(item.id);
    else if (kind === 'basemesh') {
      if (this.coming.has(item.id)) return;
      this.coming.add(item.id);
      this.repaint();
      void this.host.addBaseMesh(item.id).then((ok) => {
        this.coming.delete(item.id);
        this.repaint();
        if (!ok) this.ctx.say(`${item.label} could not be added. Try again.`);
      });
    }
  }
}

/** What the look tabs ask of the page: the viewer, and which workspace is in front. */
export interface LookHost {
  viewer: Viewer;
  workspace(): string | null;
}

/**
 * Whether a change of the lights or of the environment can be seen in the view now: Present always shows them; the
 * working views draw them only in Lit (Matcap ignores the scene's lights).
 */
export function lightShows(host: LookHost): boolean {
  return host.workspace() === 'present' || document.body.classList.contains('presenting') || host.viewer.getMaterial() === 'lit';
}

const refreshControls = (): void => void window.dispatchEvent(new Event(CONTROLS_REFRESH_EVENT));

/** The Materials tab: the matcaps. */
export class MaterialsView extends TileView {
  protected readonly tab = 'materials';
  /** The scene's materials, while a sculpt is open (set by the sculpt mode, cleared when it closes). */
  private scene: SceneMaterialsHost | null = null;

  constructor(private readonly host: LookHost) {
    super();
  }

  setScene(scene: SceneMaterialsHost | null): void {
    this.scene = scene;
    this.refresh();
  }

  protected groups(): TileGroup[] {
    return [{ id: 'matcaps', title: 'Matcaps', items: MATCAP_ASSETS.map((m) => ({ id: m.id, label: m.label, thumb: m.thumb })) }];
  }

  protected override mine(): TileItem[] {
    return (this.scene?.list() ?? []).map((m) => ({ id: m.id, label: m.name, swatch: m.albedo, title: m.name }));
  }

  protected override mineEmpty(): string {
    return 'Materials in the scene show here.';
  }

  protected override watch(): string {
    return this.scene ? JSON.stringify(this.scene.list()) : '';
  }

  protected override tail(): string {
    return 'Lit shows the materials again (Material tab).';
  }

  protected inUse(): string | null {
    // Scene: the material the active object uses. Library: the matcap in use.
    if (this.ctx.where() === 'mine') return this.scene?.active() ?? null;
    const v = this.host.viewer;
    return v.getMaterial() === 'matcap' ? (MATCAP_ASSETS[v.materials.getMaterialState().matcapIndex]?.id ?? null) : null;
  }

  protected use(item: TileItem): void {
    if (this.ctx.where() === 'mine') {
      if (!this.scene) return;
      if (this.scene.active() === null) {
        this.ctx.say('Select an object first.');
        return;
      }
      this.scene.assign(item.id);
      refreshControls();
      this.repaint();
      return;
    }
    const index = MATCAP_ASSETS.findIndex((m) => m.id === item.id);
    if (index < 0) return;
    const v = this.host.viewer;
    v.setMaterial('matcap');
    v.materials.setMatcapIndex(index);
    refreshControls();
    this.repaint();
  }
}

const MINE_PREFIX = 'mine:';

/** The Lighting tab: the built-in rigs, and under Mine the ones the person saved in the Lighting tab. */
export class LightingView extends TileView {
  protected readonly tab = 'lighting';

  constructor(private readonly host: LookHost) {
    super();
  }

  protected groups(): TileGroup[] {
    return [{ id: 'rigs', title: 'Rigs', items: rigAssets().map((r) => ({ id: r.id, label: r.label, thumb: r.thumb })) }];
  }

  protected override mine(): TileItem[] {
    return myRigs().map((r) => ({ id: MINE_PREFIX + r.id, label: r.name }));
  }

  protected override mineEmpty(): string {
    return 'Rigs you save in the Lighting tab show here.';
  }

  protected override onMount(): () => void {
    const again = (): void => this.refresh();
    window.addEventListener(RIGS_CHANGED_EVENT, again);
    return () => window.removeEventListener(RIGS_CHANGED_EVENT, again);
  }

  protected inUse(): string | null {
    const lights = this.host.viewer.lighting;
    const built = lights.activePreset();
    if (built) return built;
    const mine = myRigs().find((r) => lights.matchesRig(r.rig));
    return mine ? MINE_PREFIX + mine.id : null;
  }

  protected use(item: TileItem): void {
    const lights = this.host.viewer.lighting;
    if (item.id.startsWith(MINE_PREFIX)) {
      const rig = myRigs().find((r) => r.id === item.id.slice(MINE_PREFIX.length));
      if (!rig) return;
      lights.applyRig(rig.rig);
    } else lights.applyPreset(item.id);
    refreshControls();
    this.repaint();
    if (!lightShows(this.host)) this.ctx.say('Shows in Present.');
  }
}

/** The HDRIs tab: None, and the environments. The file is fetched when one is used. */
export class HdrisView extends TileView {
  protected readonly tab = 'hdris';
  private readonly coming = new Set<string>();

  constructor(private readonly host: LookHost) {
    super();
  }

  protected groups(): TileGroup[] {
    return [
      {
        id: 'hdris',
        title: 'Environment light',
        items: [{ id: '', label: 'None' }, ...ENVIRONMENT_ASSETS.map((e) => ({ id: e.id, label: e.label, thumb: e.thumb }))],
      },
    ];
  }

  protected inUse(): string | null {
    return this.host.viewer.environment.getState().id ?? '';
  }

  /** Scene: the one environment this scene uses, or nothing when it has none. */
  protected override mine(): TileItem[] {
    const id = this.host.viewer.environment.getState().id ?? '';
    const e = id ? ENVIRONMENT_ASSETS.find((x) => x.id === id) : undefined;
    return e ? [{ id: e.id, label: e.label, thumb: e.thumb, title: e.label }] : [];
  }

  protected override mineEmpty(): string {
    return 'This scene has no environment light.';
  }

  protected override watch(): string {
    return this.host.viewer.environment.getState().id ?? '';
  }

  protected override loading(): ReadonlySet<string> {
    return this.coming;
  }

  protected use(item: TileItem): void {
    if (this.ctx.where() === 'mine') return; // the scene's own light shows as it is: a tap does nothing
    const env = this.host.viewer.environment;
    const id = item.id;
    if (this.coming.has(id) || (env.getState().id ?? '') === id) return;
    this.coming.clear();
    if (id) this.coming.add(id);
    this.repaint();
    void env.useEnvironment(id || null).then((result) => {
      if (result === 'superseded') return;
      this.coming.delete(id);
      this.repaint();
      if (result === 'failed') {
        this.ctx.say(`${item.label} could not be loaded. The environment is as it was.`);
        return;
      }
      refreshControls();
      if (!lightShows(this.host)) this.ctx.say('Shows in Present.');
    });
  }
}
