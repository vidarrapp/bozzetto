/**
 * Cameras (docs/ui-spec.md, "Cameras"): named, kept views of the scene, listed in the Scene panel.
 * A camera is data, not a second viewer: the viewer's one camera is set from it when it is looked
 * through (`host.place`), and read back into it when it is left or saved (`host.read`). The
 * working view is the free camera the person moves; it is never in the list and is kept here
 * only while a camera is in use, so a tap on Working view puts it back exactly.
 *
 * Making, deleting, renaming, locking and tying are steps of the sculpt history (as the
 * calipers' are). Looking through a camera, and moving an unlocked one, are not.
 */

import { MAX_CAMERAS, MAX_NAME } from '../../../shared/bozz';

export type Vec3 = [number, number, number];

/** What the viewer's one camera is set from. */
export interface ViewPose {
  position: Vec3;
  target: Vec3;
  /** The lens in millimetres (35mm equivalent). Kept in an orthographic camera too, for going back. */
  lens: number;
  projection: 'perspective' | 'orthographic';
}

export interface SceneCamera extends ViewPose {
  id: string;
  name: string;
  locked: boolean;
  /** The reference picture tied to it (its id on the board), or null. */
  reference: string | null;
}

/** What a scene file keeps of one camera (the format is written down in docs/ui-spec.md, "Cameras"). */
export interface SavedCamera {
  id: string;
  name: string;
  position: number[];
  target: number[];
  /** Always [0, 1, 0]: the view has no roll. */
  up: number[];
  lens: number;
  projection: 'perspective' | 'orthographic';
  /** How tall the view is at the target, in scene units (centimetres): from the distance and the lens. */
  orthoSize: number;
  locked: boolean;
  reference: string | null;
}

export interface SavedCameras {
  v: 1;
  /** The camera in use, or null for the working view. */
  active: string | null;
  /** The working view, kept while a camera is in use. */
  working?: { position: number[]; target: number[]; up: number[]; lens: number; projection: 'perspective' | 'orthographic'; orthoSize: number };
  items: SavedCamera[];
}

export const CAMERAS_V = 1;
/** More than anyone makes; a file's thousands are not cameras (the upload's check holds a scene to the same). */
export { MAX_CAMERAS };
export const MAX_CAMERA_NAME = MAX_NAME;
export const LENS_LIMITS = { min: 8, max: 1200 } as const;
const UP: Vec3 = [0, 1, 0];

/** What the page gives the store: the viewer's camera, to read and to set. */
export interface ViewHost {
  read(): ViewPose;
  /** Put the view there, and lock it when asked. */
  place(pose: ViewPose, locked: boolean): void;
  /** Let go of a lock (a camera is no longer in use) without moving the view. */
  unlock(): void;
  /** The view's height at its target, in scene units (the orthographic size). */
  size(pose: ViewPose): number;
}

const finite3 = (v: unknown): Vec3 | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : null;

/** A camera record read as far as it can be: null when it is not one. Shared by the reader and the tests of the server's check. */
export function sanitizeCamera(raw: unknown): SceneCamera | null {
  const r = raw as Partial<SavedCamera> | null;
  if (!r || typeof r !== 'object') return null;
  const position = finite3(r.position);
  const target = finite3(r.target);
  if (!position || !target) return null;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
  if (typeof r.lens !== 'number' || !Number.isFinite(r.lens)) return null;
  const same = position[0] === target[0] && position[1] === target[1] && position[2] === target[2];
  if (same) return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, MAX_CAMERA_NAME) : 'Camera',
    position,
    target,
    lens: Math.min(LENS_LIMITS.max, Math.max(LENS_LIMITS.min, r.lens)),
    projection: r.projection === 'orthographic' ? 'orthographic' : 'perspective',
    locked: r.locked === true,
    reference: typeof r.reference === 'string' && r.reference ? r.reference.slice(0, 40) : null,
  };
}

/** The cameras record as it is read: what is not a camera is left out, an unknown one in use is none. Undefined: nothing to keep. */
export function sanitizeCameras(raw: unknown): SavedCameras | undefined {
  const r = raw as Partial<SavedCameras> | null;
  if (!r || typeof r !== 'object' || r.v !== CAMERAS_V || !Array.isArray(r.items)) return undefined;
  const seen = new Set<string>();
  const items: SavedCamera[] = [];
  for (const it of r.items.slice(0, MAX_CAMERAS)) {
    const c = sanitizeCamera(it);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    items.push(saved(c, 0));
  }
  if (!items.length) return undefined;
  const w = r.working as Partial<SavedCameras['working']> | undefined;
  const wp = w && typeof w === 'object' ? finite3(w.position) : null;
  const wt = w && typeof w === 'object' ? finite3(w.target) : null;
  const working =
    w && wp && wt && typeof w.lens === 'number' && Number.isFinite(w.lens)
      ? {
          position: wp,
          target: wt,
          up: [...UP],
          lens: Math.min(LENS_LIMITS.max, Math.max(LENS_LIMITS.min, w.lens)),
          projection: w.projection === 'orthographic' ? ('orthographic' as const) : ('perspective' as const),
          orthoSize: typeof w.orthoSize === 'number' && Number.isFinite(w.orthoSize) ? w.orthoSize : 0,
        }
      : undefined;
  const active = typeof r.active === 'string' && seen.has(r.active) ? r.active : null;
  return { v: CAMERAS_V, active, ...(working && active ? { working } : {}), items };
}

function saved(c: SceneCamera, size: number): SavedCamera {
  return {
    id: c.id,
    name: c.name,
    position: [...c.position],
    target: [...c.target],
    up: [...UP],
    lens: c.lens,
    projection: c.projection,
    orthoSize: size,
    locked: c.locked,
    reference: c.reference,
  };
}

const NAME = /^Camera (\d+)$/;
const newId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export class Cameras {
  private items: SceneCamera[] = [];
  /** The camera looked through, or null for the working view. */
  private use: string | null = null;
  /** The working view while a camera is in use. */
  private working: ViewPose | null = null;
  /** The row last tapped: Delete takes it. */
  selected: string | null = null;
  host: ViewHost | null = null;
  /** The sculpt history, to put an edit in as one step (set by the session). */
  history: ((undo: () => void, redo: () => void) => void) | null = null;
  /** A change the scene keeps (the autosave). */
  onPersist: (() => void) | null = null;
  /** The viewer's camera was set from a camera or from the working view. */
  onUse: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private named = 0;
  /** Bumped by every change. */
  version = 0;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed(persist = true): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
    if (persist) this.onPersist?.();
  }

  list(): readonly SceneCamera[] {
    return this.items;
  }

  get(id: string | null): SceneCamera | undefined {
    return id ? this.items.find((c) => c.id === id) : undefined;
  }

  /** The id of the camera in use, or null while the working view is. */
  inUse(): string | null {
    return this.use;
  }

  current(): SceneCamera | undefined {
    return this.get(this.use);
  }

  /** Whether the camera in use is locked. */
  isLocked(): boolean {
    return this.current()?.locked === true;
  }

  /** The camera a reference picture is tied to, or null. */
  cameraOf(reference: string): string | null {
    return this.items.find((c) => c.reference === reference)?.id ?? null;
  }

  select(id: string | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.changed(false);
  }

  // --- looking through ------------------------------------------------------------------

  /** An unlocked camera in use is where the person left it: read it from the view. */
  private keepCurrent(): void {
    const c = this.current();
    if (c && !c.locked && this.host) Object.assign(c, copyPose(this.host.read()));
  }

  /** Look through a camera (its id) or the working view (null). The view goes there at once. */
  look(id: string | null): void {
    if (id === this.use) return;
    if (id !== null && !this.get(id)) return;
    if (this.use === null) this.working = this.host ? copyPose(this.host.read()) : this.working;
    else this.keepCurrent();
    this.use = id;
    if (id === null) {
      const back = this.working;
      this.working = null;
      if (back && this.host) this.host.place(back, false);
      else this.host?.unlock();
    } else {
      const c = this.get(id)!;
      this.host?.place(copyPose(c), c.locked);
    }
    this.changed();
    this.onUse?.();
  }

  /** Set the viewer's camera from what is in use again (after a look or a scene was applied over it). */
  settle(): void {
    const c = this.current();
    if (c) this.host?.place(copyPose(c), c.locked);
    else this.host?.unlock();
  }

  // --- the history's steps ---------------------------------------------------------------

  private step(undo: () => void, redo: () => void): void {
    const wrap = (f: () => void) => (): void => {
      f();
      this.changed();
    };
    this.history?.(wrap(undo), wrap(redo));
  }

  private nextName(): string {
    for (const c of this.items) {
      const hit = NAME.exec(c.name);
      if (hit) this.named = Math.max(this.named, Number(hit[1]));
    }
    return `Camera ${++this.named}`;
  }

  /** A camera from the view as it is now, looked through at once. Null when the view cannot be read or the list is full. */
  make(): SceneCamera | null {
    if (!this.host || this.items.length >= MAX_CAMERAS) return null;
    const pose = copyPose(this.host.read());
    const cam: SceneCamera = { id: newId(), name: this.nextName(), ...pose, locked: false, reference: null };
    return this.insertAndLook(cam, this.items.length);
  }

  /** A camera from a view that is given (a reference picture's saved view). */
  makeFrom(pose: ViewPose, locked: boolean, reference: string | null): SceneCamera | null {
    if (!this.host || this.items.length >= MAX_CAMERAS) return null;
    const cam: SceneCamera = { id: newId(), name: this.nextName(), ...copyPose(pose), locked, reference };
    if (reference) for (const o of this.items) if (o.reference === reference) o.reference = null;
    return this.insertAndLook(cam, this.items.length);
  }

  private insertAndLook(cam: SceneCamera, at: number): SceneCamera {
    const before = this.use;
    const tied = this.items.filter((o) => o.reference && o.reference === cam.reference);
    this.items.splice(at, 0, cam);
    this.look(cam.id);
    this.step(
      () => {
        this.take(cam.id);
        for (const o of tied) o.reference = cam.reference;
        // Back where the person was: the camera they were looking through, or the working view.
        if (before && this.get(before)) this.look(before);
      },
      () => {
        for (const o of tied) o.reference = null;
        if (!this.items.includes(cam)) this.items.splice(Math.min(at, this.items.length), 0, cam);
        this.look(cam.id);
      },
    );
    return cam;
  }

  /** Take a camera out of the list; the working view takes over if it was in use. */
  private take(id: string): number {
    const i = this.items.findIndex((c) => c.id === id);
    if (i < 0) return -1;
    if (this.use === id) {
      this.use = null;
      const back = this.working;
      this.working = null;
      if (back && this.host) this.host.place(back, false);
      else this.host?.unlock();
      this.onUse?.();
    }
    this.items.splice(i, 1);
    if (this.selected === id) this.selected = null;
    return i;
  }

  remove(id: string): void {
    const cam = this.get(id);
    if (!cam) return;
    const wasUse = this.use === id;
    if (wasUse) this.keepCurrent();
    const at = this.take(id);
    this.changed();
    this.step(
      () => {
        if (!this.items.includes(cam)) this.items.splice(Math.min(at, this.items.length), 0, cam);
        // Back in the list; when it was looked through it is again.
        if (wasUse) this.look(cam.id);
      },
      () => void this.take(id),
    );
  }

  /** Delete the camera whose row was last tapped (Delete or Backspace). False with none. */
  removeSelected(): boolean {
    if (!this.selected || !this.get(this.selected)) return false;
    this.remove(this.selected);
    return true;
  }

  rename(id: string, name: string): void {
    const cam = this.get(id);
    const next = name.trim().slice(0, MAX_CAMERA_NAME);
    if (!cam || !next || next === cam.name) return;
    const was = cam.name;
    cam.name = next;
    this.changed();
    this.step(
      () => void (cam.name = was),
      () => void (cam.name = next),
    );
  }

  setLocked(id: string, locked: boolean): void {
    const cam = this.get(id);
    if (!cam || cam.locked === locked) return;
    // A camera in use is locked where the person stands: that is where it is kept.
    if (this.use === id && locked) this.keepCurrent();
    const apply = (value: boolean): void => {
      cam.locked = value;
      if (this.use === id) this.host?.place(copyPose(cam), value);
    };
    apply(locked);
    this.changed();
    this.step(
      () => apply(!locked),
      () => apply(locked),
    );
  }

  /** Tie a picture to a camera (or null: none). A picture belongs to one camera, a camera to one picture. */
  setReference(id: string, reference: string | null): void {
    const cam = this.get(id);
    if (!cam || cam.reference === reference) return;
    const before = new Map(this.items.map((c) => [c, c.reference] as const));
    for (const o of this.items) if (reference && o.reference === reference) o.reference = null;
    cam.reference = reference;
    const after = new Map(this.items.map((c) => [c, c.reference] as const));
    const put = (m: Map<SceneCamera, string | null>): void => {
      for (const [c, r] of m) c.reference = r;
    };
    this.changed();
    this.step(
      () => put(before),
      () => put(after),
    );
  }

  /** Tie a picture to no camera (the card's select says None). */
  untie(reference: string): void {
    const id = this.cameraOf(reference);
    if (id) this.setReference(id, null);
  }

  // --- the scene's record ----------------------------------------------------------------

  serialize(): SavedCameras | null {
    if (!this.items.length) return null;
    this.keepCurrent();
    const size = (p: ViewPose): number => this.host?.size(p) ?? 0;
    const working = this.use !== null && this.working ? this.working : null;
    return {
      v: CAMERAS_V,
      active: this.use,
      ...(working
        ? {
            working: {
              position: [...working.position],
              target: [...working.target],
              up: [...UP],
              lens: working.lens,
              projection: working.projection,
              orthoSize: size(working),
            },
          }
        : {}),
      items: this.items.map((c) => saved(c, size(c))),
    };
  }

  /** Replace the list from a scene's record (undefined: a scene with none). The viewer is set when a host is bound. */
  restore(rec: SavedCameras | undefined): void {
    this.items = [];
    this.use = null;
    this.working = null;
    this.selected = null;
    const clean = sanitizeCameras(rec);
    if (clean) {
      this.items = clean.items.map((c) => sanitizeCamera(c)!);
      this.use = clean.active;
      this.working = clean.working ? copyPose({ ...clean.working, position: clean.working.position as Vec3, target: clean.working.target as Vec3 }) : null;
    }
    this.changed(false);
    this.settle();
    this.onUse?.();
  }

  /** A new scene or one that is replaced: none, and the view free. */
  reset(): void {
    const had = this.items.length > 0 || this.use !== null;
    this.items = [];
    this.use = null;
    this.working = null;
    this.selected = null;
    this.named = 0;
    if (had) {
      this.host?.unlock();
      this.changed(false);
      this.onUse?.();
    }
  }
}

function copyPose(p: ViewPose): ViewPose {
  return { position: [...p.position] as Vec3, target: [...p.target] as Vec3, lens: p.lens, projection: p.projection };
}
