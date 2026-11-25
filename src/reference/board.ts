import { withNamedStore } from '../sculpt/bridge/ScenePersist';
import { mayStore, onDeviceChoice } from '../ui/deviceStorage';
import { preparePicture } from './image';
import { CSS_BLEND_MODES } from '../ui/blendModes';

/**
 * The board of reference pictures: the pictures themselves, how each is
 * drawn (mirrored, in greys, blended, at an opacity), which are in the
 * view and where they stand there, and where they are kept.
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

/**
 * Where a picture stands in the view, relative to the view's centre so it
 * survives a resize or turning the device: the centre's offset and the
 * width, all in units of the view's shorter side.
 */
export interface Placement {
  x: number;
  y: number;
  w: number;
}

/** The camera as a picture was locked: plain numbers, kept with the picture and nowhere else. */
export interface StoredCamera {
  position: [number, number, number];
  target: [number, number, number];
  focalLength: number;
}

export interface RefItem {
  id: string;
  name: string;
  width: number;
  height: number;
  /** JPEG, or PNG when the picture has transparency: re-encoded on import, no metadata. */
  blob: Blob;
  mirror: boolean;
  grey: boolean;
  /** 'behind' (drawn behind the model) or a blend mode id from ui/blendModes (an element over the view). */
  blend: string;
  /** 0 to 1, in every mode. */
  opacity: number;
  /** In the view (floating over or behind the model), or only on the board. */
  inView: boolean;
  /** Order in the view: the larger is drawn above. */
  seq: number;
  /** Where it stands in the view; null until it first is put there. */
  place: Placement | null;
  /** The camera at the moment the picture was locked, for Match view. */
  camera: StoredCamera | null;
  added: number;
}

export const BEHIND = 'behind';
export const DEFAULT_BLEND = 'normal';

/** The blend a stored value means: behind, or one of the modes a browser can blend live. */
export function cleanBlend(v: unknown): string {
  return typeof v === 'string' && (v === BEHIND || CSS_BLEND_MODES.some((m) => m.id === v)) ? v : DEFAULT_BLEND;
}

export function cleanOpacity(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function cleanPlace(v: unknown): Placement | null {
  const r = v as Partial<Placement> | null;
  if (!r || typeof r !== 'object' || !finite(r.x) || !finite(r.y) || !finite(r.w)) return null;
  return { x: Math.max(-8, Math.min(8, r.x)), y: Math.max(-8, Math.min(8, r.y)), w: Math.max(0.02, Math.min(8, r.w)) };
}

const triple = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every(finite) ? [v[0], v[1], v[2]] : null;

export function cleanCamera(v: unknown): StoredCamera | null {
  const r = v as Partial<StoredCamera> | null;
  if (!r || typeof r !== 'object') return null;
  const position = triple(r.position);
  const target = triple(r.target);
  if (!position || !target || !finite(r.focalLength)) return null;
  return { position, target, focalLength: r.focalLength };
}

/** The most pictures a board holds: each is up to a few hundred kilobytes. */
export const MAX_REFERENCES = 48;

interface Stored {
  v: 1;
  items: RefItem[];
}

const STORE = 'scene';
const keyCurrent = (scope: string): string => `refs:${scope}`;
const keyProject = (id: string): string => `refs:project:${id}`;

const newId = (): string => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

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
    blend: cleanBlend(r.blend),
    opacity: cleanOpacity(r.opacity),
    inView: r.inView === true,
    seq: finite(r.seq) ? r.seq : 0,
    place: cleanPlace(r.place),
    camera: cleanCamera(r.camera),
    added: Number.isFinite(Number(r.added)) ? Number(r.added) : Date.now(),
  };
}

/**
 * A picture read back from the device's database is a Blob that points at
 * the database's own file. Safari deletes that file when the record is
 * written again, which every later change to the board does, and the
 * picture then has nothing behind it: its thumbnail went at the next
 * redraw, and the write after that kept nothing of it, so it was gone on
 * the next reload (owner report, 2026-11-24: removing pictures added later
 * lost the first one). So what is read is copied into memory at once, and
 * only pictures held in memory are ever written. One whose bytes can no
 * longer be read is left out.
 */
async function inMemory(item: RefItem): Promise<RefItem | null> {
  try {
    const bytes = await item.blob.arrayBuffer();
    if (!bytes.byteLength) return null;
    return { ...item, blob: new Blob([bytes], { type: item.blob.type || 'image/jpeg' }) };
  } catch {
    return null;
  }
}

export class ReferenceBoard {
  /** Newest first. */
  private items: RefItem[] = [];
  /** Arranging (unlocked): not kept, a scene opens locked. */
  private arranging = false;
  private camGet: (() => StoredCamera) | null = null;
  private camSet: ((c: StoredCamera) => void) | null = null;
  private readonly placeListeners = new Set<() => void>();
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

  /** The pictures in the view, the one drawn lowest first. */
  inView(): RefItem[] {
    return this.items.filter((i) => i.inView).sort((a, b) => a.seq - b.seq);
  }

  isArranging(): boolean {
    return this.arranging && this.inView().length > 0;
  }

  /**
   * Arrange (unlocked) on or off. Locking keeps the camera with each
   * picture that is in the view, so Match view can bring it back.
   */
  setArranging(on: boolean): void {
    if (on === this.arranging) return;
    if (on && !this.inView().length) return;
    this.arranging = on;
    if (!on && this.camGet) {
      const cam = this.camGet();
      this.items = this.items.map((i) => (i.inView ? { ...i, camera: cam } : i));
      this.touch();
      return;
    }
    this.emit();
  }

  /** The view's camera, for locking and Match view (ReferenceView sets these). */
  bindCamera(get: () => StoredCamera, set: (c: StoredCamera) => void): void {
    this.camGet = get;
    this.camSet = set;
  }

  /** Put the camera back as it was when this picture was locked. False when none is kept. */
  matchView(id: string): boolean {
    const cam = this.get(id)?.camera;
    if (!cam || !this.camSet) return false;
    this.camSet(cam);
    return true;
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
      blend: DEFAULT_BLEND,
      opacity: 1,
      inView: false,
      seq: 0,
      place: null,
      camera: null,
      added: Date.now(),
    };
    this.items = [item, ...this.items];
    this.touch();
    return item;
  }

  remove(id: string): void {
    if (!this.get(id)) return;
    this.items = this.items.filter((i) => i.id !== id);
    this.touch();
  }

  setLook(id: string, look: Partial<Pick<RefItem, 'mirror' | 'grey' | 'blend' | 'opacity'>>): void {
    const item = this.get(id);
    if (!item) return;
    const next = {
      ...item,
      ...(look.mirror !== undefined ? { mirror: look.mirror } : {}),
      ...(look.grey !== undefined ? { grey: look.grey } : {}),
      ...(look.blend !== undefined ? { blend: cleanBlend(look.blend) } : {}),
      ...(look.opacity !== undefined ? { opacity: cleanOpacity(look.opacity) } : {}),
    };
    this.items = this.items.map((i) => (i.id === id ? next : i));
    this.touch();
  }

  /** Put a picture in the view, on top of those there; Arrange turns on so it can be placed. */
  putInView(id: string, place?: Placement): void {
    const item = this.get(id);
    if (!item) return;
    const seq = Math.max(0, ...this.items.map((i) => i.seq)) + 1;
    this.items = this.items.map((i) => (i.id === id ? { ...i, inView: true, seq, place: place ? cleanPlace(place) : i.place } : i));
    this.arranging = true;
    this.touch();
  }

  /** Take a picture out of the view (it stays on the board). */
  takeOut(id: string): void {
    const item = this.get(id);
    if (!item || !item.inView) return;
    this.items = this.items.map((i) => (i.id === id ? { ...i, inView: false } : i));
    if (!this.items.some((i) => i.inView)) this.arranging = false;
    this.touch();
  }

  /** A tile's tap: in the view, out again. */
  toggleInView(id: string): void {
    if (this.get(id)?.inView) this.takeOut(id);
    else this.putInView(id);
  }

  /** Move or size a picture in the view. Quiet while dragging: the panel is not rebuilt, the view is told. */
  setPlace(id: string, place: Placement): void {
    const clean = cleanPlace(place);
    if (!clean || !this.get(id)) return;
    this.items = this.items.map((i) => (i.id === id ? { ...i, place: clean } : i));
    for (const fn of [...this.placeListeners]) fn();
    this.touch(false);
  }

  onPlace(fn: () => void): () => void {
    this.placeListeners.add(fn);
    return () => this.placeListeners.delete(fn);
  }

  /** Start over with nothing: a new sculpt. What was kept for this scene goes with it. */
  async clear(): Promise<void> {
    this.epoch++;
    this.items = [];
    this.arranging = false;
    this.project = null;
    this.emit();
    this.dirty = false;
    window.clearTimeout(this.saveTimer);
    await this.erase(keyCurrent(this.scope));
  }

  /** Replace the board with these (a file's, or what was kept), keeping them as this scene's. */
  replace(items: RefItem[]): void {
    this.epoch++;
    this.arranging = false;
    this.items = items.map(cleanItem).filter((i): i is RefItem => !!i).slice(0, MAX_REFERENCES);
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
    const stored = (rec?.items ?? []).map(cleanItem).filter((i): i is RefItem => !!i).slice(0, MAX_REFERENCES);
    const items = (await Promise.all(stored.map(inMemory))).filter((i): i is RefItem => !!i);
    if (epoch !== this.epoch) return;
    if ('project' in from) this.project = from.project;
    this.items = items;
    this.arranging = false;
    this.emit();
    // An opened project replaces what the autosave held: written under the scene's own key at once.
    if ('project' in from) this.touch(false);
  }

  /**
   * Pictures kept under another scope join this board, once: the old Armature board's, now that
   * the page has one board for every workspace. They go after what is here, and the old record
   * is let go only when they are in. Nothing happens when this device kept nothing for it.
   */
  async adoptKept(scope: 'armature'): Promise<void> {
    const key = keyCurrent(scope);
    const rec = await this.read(key);
    if (!rec) return;
    const have = new Set(this.items.map((i) => i.id));
    const stored = rec.items.map(cleanItem).filter((i): i is RefItem => !!i && !have.has(i.id));
    // Copied into memory first, as restore() does and for the same reason (inMemory): these pictures point at
    // the old record's file, and the old record is deleted three lines down. Without the copy Safari left them
    // with nothing behind them, and a reference kept in Armature was gone after the first visit to the new
    // page (owner report, 2026-11-25).
    const items = (await Promise.all(stored.map(inMemory))).filter((i): i is RefItem => !!i && !this.items.some((x) => x.id === i.id));
    if (items.length) {
      this.items = [...this.items, ...items].slice(0, MAX_REFERENCES);
      this.touch();
      await this.flush();
    }
    await this.erase(key);
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
    const rec: Stored = { v: 1, items: this.items };
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
  blend: string;
  opacity: number;
  inView: boolean;
  seq: number;
  place: Placement | null;
  camera: StoredCamera | null;
  added: number;
  data: Uint8Array;
}

export interface FileReferences {
  items: FileReference[];
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
      blend: i.blend,
      opacity: i.opacity,
      inView: i.inView,
      seq: i.seq,
      place: i.place,
      camera: i.camera,
      added: i.added,
      data: new Uint8Array(await i.blob.arrayBuffer()),
    });
  }
  return { items };
}

/** A file's pictures as board items; ids are made new, so a file never collides with what is here. */
export function fromFileReferences(refs: FileReferences): { items: RefItem[] } {
  const items: RefItem[] = refs.items.map((r) => ({
    id: newId(),
    name: r.name,
    width: r.width,
    height: r.height,
    blob: new Blob([r.data as BlobPart], { type: r.type }),
    mirror: r.mirror,
    grey: r.grey,
    blend: cleanBlend(r.blend),
    opacity: cleanOpacity(r.opacity),
    inView: r.inView === true,
    seq: finite(r.seq) ? r.seq : 0,
    place: cleanPlace(r.place),
    camera: cleanCamera(r.camera),
    added: r.added,
  }));
  return { items };
}
