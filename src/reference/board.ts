import { withNamedStore } from '../sculpt/bridge/ScenePersist';
import { mayStore, onDeviceChoice } from '../ui/deviceStorage';
import { preparePicture } from './image';

/**
 * The board of reference pictures: the pictures themselves, how each is
 * drawn (mirrored, in greys), which one is on and how, and where they are
 * kept.
 *
 * They are kept on this device only, never uploaded (owner decision,
 * 2026-11-14): in IndexedDB, in the autosave's own store, under keys of
 * their own - one for the scene on screen, one more for the library
 * project that scene is, so reopening that project on this device brings
 * them back. Only while keeping work on this device is on (deviceStorage):
 * with it off they last for the page. Save file may carry them
 * (SceneFile); Save to library, Publish and every other upload send the
 * scene alone, because nothing that uploads ever asks this module.
 */

export type ShowMode = 'beside' | 'over';

export interface RefItem {
  id: string;
  name: string;
  width: number;
  height: number;
  /** JPEG, or PNG when the picture has transparency: re-encoded on import, no metadata. */
  blob: Blob;
  mirror: boolean;
  grey: boolean;
  added: number;
}

/** Which picture is on, how, and the over-the-view settings. */
export interface RefView {
  id: string | null;
  mode: ShowMode;
  /** Over the view: in front of the model (a film) instead of behind it. */
  front: boolean;
  /** Over the view, in front: 0.05 to 1. */
  opacity: number;
}

const DEFAULT_VIEW: RefView = { id: null, mode: 'beside', front: false, opacity: 0.5 };

/** The most pictures a board holds: each is up to a few hundred kilobytes. */
export const MAX_REFERENCES = 48;

interface Stored {
  v: 1;
  items: RefItem[];
  view: RefView;
}

const STORE = 'scene';
const keyCurrent = (scope: string): string => `refs:${scope}`;
const keyProject = (id: string): string => `refs:project:${id}`;

const newId = (): string => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function cleanView(v: Partial<RefView> | undefined, items: RefItem[]): RefView {
  const id = typeof v?.id === 'string' && items.some((i) => i.id === v.id) ? v.id : null;
  const opacity = typeof v?.opacity === 'number' && Number.isFinite(v.opacity) ? Math.min(1, Math.max(0.05, v.opacity)) : DEFAULT_VIEW.opacity;
  return { id, mode: v?.mode === 'over' ? 'over' : 'beside', front: v?.front === true, opacity };
}

function cleanItem(raw: unknown): RefItem | null {
  const r = raw as Partial<RefItem> | null;
  if (!r || typeof r !== 'object' || !(r.blob instanceof Blob)) return null;
  const w = Number(r.width);
  const h = Number(r.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : newId(),
    name: typeof r.name === 'string' ? r.name.slice(0, 120) : 'Picture',
    width: Math.round(w),
    height: Math.round(h),
    blob: r.blob,
    mirror: r.mirror === true,
    grey: r.grey === true,
    added: Number.isFinite(Number(r.added)) ? Number(r.added) : Date.now(),
  };
}

export class ReferenceBoard {
  /** Newest first. */
  private items: RefItem[] = [];
  private view: RefView = { ...DEFAULT_VIEW };
  private project: string | null = null;
  private readonly listeners = new Set<() => void>();
  private saveTimer = 0;
  private dirty = false;
  private readonly offChoice: () => void;
  /** Bumped by every restore and clear, so a read that lands late is dropped. */
  private epoch = 0;

  constructor(private readonly scope: 'sculpt' | 'armature') {
    // Keeping on this device was turned on after pictures were added: they are written then.
    this.offChoice = onDeviceChoice((now) => {
      if (now === 'keep' && (this.items.length || this.project)) this.touch(false);
    });
  }

  list(): readonly RefItem[] {
    return this.items;
  }

  get(id: string): RefItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  getView(): RefView {
    return { ...this.view };
  }

  /** The picture that is on, if any. */
  shown(): RefItem | undefined {
    return this.view.id ? this.get(this.view.id) : undefined;
  }

  /** The library project this scene is, which the pictures are also kept under. */
  linkedProject(): string | null {
    return this.project;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  /** Take a picture in: re-encoded and scaled (image.ts), then first on the board. */
  async add(file: Blob, name = 'Picture'): Promise<RefItem> {
    if (this.items.length >= MAX_REFERENCES) {
      throw new Error(`The board holds ${MAX_REFERENCES} pictures. Delete one to add another.`);
    }
    const prepared = await preparePicture(file);
    const item: RefItem = {
      id: newId(),
      name: (name || 'Picture').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 120) || 'Picture',
      width: prepared.width,
      height: prepared.height,
      blob: prepared.blob,
      mirror: false,
      grey: false,
      added: Date.now(),
    };
    this.items = [item, ...this.items];
    this.touch();
    return item;
  }

  remove(id: string): void {
    if (!this.get(id)) return;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.view.id === id) this.view = { ...this.view, id: null };
    this.touch();
  }

  setLook(id: string, look: Partial<Pick<RefItem, 'mirror' | 'grey'>>): void {
    const item = this.get(id);
    if (!item) return;
    const next = { ...item, ...(look.mirror !== undefined ? { mirror: look.mirror } : {}), ...(look.grey !== undefined ? { grey: look.grey } : {}) };
    this.items = this.items.map((i) => (i.id === id ? next : i));
    this.touch();
  }

  /** Put a picture on, beside or over the view; one is on at a time. */
  show(id: string, mode: ShowMode): void {
    if (!this.get(id)) return;
    this.view = { ...this.view, id, mode };
    this.touch();
  }

  /** Take the picture off. */
  hide(): void {
    if (this.view.id === null) return;
    this.view = { ...this.view, id: null };
    this.touch();
  }

  setOver(over: Partial<Pick<RefView, 'front' | 'opacity'>>): void {
    const opacity = over.opacity === undefined ? this.view.opacity : Math.min(1, Math.max(0.05, over.opacity));
    this.view = { ...this.view, front: over.front ?? this.view.front, opacity };
    this.touch();
  }

  /** Start over with nothing: a new sculpt. What was kept for this scene goes with it. */
  async clear(): Promise<void> {
    this.epoch++;
    this.items = [];
    this.view = { ...DEFAULT_VIEW };
    this.project = null;
    this.emit();
    this.dirty = false;
    window.clearTimeout(this.saveTimer);
    await this.erase(keyCurrent(this.scope));
  }

  /** Replace the board with these (a file's, or what was kept), keeping them as this scene's. */
  replace(items: RefItem[], view?: Partial<RefView>): void {
    this.epoch++;
    this.items = items.map(cleanItem).filter((i): i is RefItem => !!i).slice(0, MAX_REFERENCES);
    this.view = cleanView(view, this.items);
    this.touch();
  }

  /** Point the scene at a library project (or none): the pictures are kept under its id too. */
  bindProject(id: string | null): void {
    if (id === this.project) return;
    this.project = id;
    if (id && this.items.length) this.touch(false);
  }

  /**
   * What this device kept for the scene on screen: `current` is the
   * autosave's (a reload), `project` a library project opened here (empty
   * when this device never had its pictures: they stay where they were added).
   */
  async restore(from: { current: true } | { project: string }): Promise<void> {
    const epoch = ++this.epoch;
    const rec = await this.read('project' in from ? keyProject(from.project) : keyCurrent(this.scope));
    if (epoch !== this.epoch) return;
    if ('project' in from) this.project = from.project;
    const items = (rec?.items ?? []).map(cleanItem).filter((i): i is RefItem => !!i).slice(0, MAX_REFERENCES);
    this.items = items;
    this.view = cleanView(rec?.view, items);
    this.emit();
    // An opened project replaces what the autosave held: written under the scene's own key at once.
    if ('project' in from) this.touch(false);
  }

  private async read(key: string): Promise<Stored | null> {
    if (!mayStore()) return null;
    try {
      const rec = (await withNamedStore(STORE, 'readonly', (s) => s.get(key))) as Stored | undefined;
      return rec && rec.v === 1 && Array.isArray(rec.items) ? rec : null;
    } catch {
      return null;
    }
  }

  private async erase(key: string): Promise<void> {
    if (!mayStore()) return;
    try {
      await withNamedStore(STORE, 'readwrite', (s) => s.delete(key));
    } catch {
      // Nothing was kept, or storage is blocked: either way it is gone.
    }
  }

  private touch(announce = true): void {
    if (announce) this.emit();
    this.dirty = true;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), 400);
  }

  /** Write what changed. The pictures are small; the whole board goes in one put per key. */
  async flush(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    if (!this.dirty) return;
    this.dirty = false;
    if (!mayStore()) return;
    const rec: Stored = { v: 1, items: this.items, view: this.view };
    const keys = [keyCurrent(this.scope), ...(this.project ? [keyProject(this.project)] : [])];
    for (const key of keys) {
      try {
        if (this.items.length) await withNamedStore(STORE, 'readwrite', (s) => s.put(rec, key));
        else await withNamedStore(STORE, 'readwrite', (s) => s.delete(key));
      } catch (err) {
        console.warn('references: not kept on this device', err);
      }
    }
  }

  dispose(): void {
    this.offChoice();
    void this.flush();
    this.listeners.clear();
  }
}

/** How the pictures ride a .bozz file: bytes, so the container's walk carries them as it does an array. */
export interface FileReference {
  name: string;
  type: string;
  width: number;
  height: number;
  mirror: boolean;
  grey: boolean;
  added: number;
  data: Uint8Array;
}

export interface FileReferences {
  items: FileReference[];
  view: RefView;
}

export async function toFileReferences(board: ReferenceBoard): Promise<FileReferences | null> {
  const list = board.list();
  if (!list.length) return null;
  const items: FileReference[] = [];
  for (const i of list) {
    items.push({
      name: i.name,
      type: i.blob.type === 'image/png' ? 'image/png' : 'image/jpeg',
      width: i.width,
      height: i.height,
      mirror: i.mirror,
      grey: i.grey,
      added: i.added,
      data: new Uint8Array(await i.blob.arrayBuffer()),
    });
  }
  // In a file the picture that is on is named by its place in the list (ids are not kept).
  const view = board.getView();
  const at = list.findIndex((i) => i.id === view.id);
  return { items, view: { ...view, id: at >= 0 ? String(at) : null } };
}

/** A file's pictures as board items; ids are made new, so a file never collides with what is here. */
export function fromFileReferences(refs: FileReferences): { items: RefItem[]; view: RefView } {
  const items: RefItem[] = [];
  const ids = new Map<number, string>();
  refs.items.forEach((r, n) => {
    const id = newId();
    ids.set(n, id);
    items.push({
      id,
      name: r.name,
      width: r.width,
      height: r.height,
      blob: new Blob([r.data as BlobPart], { type: r.type }),
      mirror: r.mirror,
      grey: r.grey,
      added: r.added,
    });
  });
  const at = refs.view.id === null ? -1 : refs.items.findIndex((_, n) => n === Number(refs.view.id));
  return { items, view: { ...refs.view, id: at >= 0 ? (ids.get(at) ?? null) : null } };
}
