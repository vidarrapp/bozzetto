import { deviceStore, mayStore } from './deviceStorage';

/**
 * The list behind File > Open recent: the projects this device opened or
 * saved lately, newest first, one list for every mode. Only what is needed
 * to find them again: the id, which kind it is, where it lives, its name and
 * when. Nothing secret, and no file from disk (an iPad cannot reopen one).
 * Kept through deviceStore, so it follows the choice about saving; with
 * saving off it lives for the page only.
 */

export const RECENT_KEY = 'bozzetto-recent';
export const RECENT_MAX = 10;

/**
 * What kind of thing it is, which decides where it opens:
 * a sculpt scene project (Sculpt), an armature project (Armature), a
 * published project opened in the Present workspace, or a scene kept on this device (Sculpt).
 */
export type RecentKind = 'scene' | 'armature' | 'present' | 'lib';

export interface Recent {
  id: string;
  kind: RecentKind;
  name: string;
  /** Where it lives, as a person says it: My projects, Projects, This device. */
  place: string;
  /** The owner tools' routes, for a project opened from Projects with accounts on. */
  scope?: 'admin';
  /** When it was opened or saved (ms). */
  at: number;
}

/** What this page holds, for a device that has not been allowed to keep anything. */
let held: Recent[] = [];
const listeners = new Set<() => void>();

const KINDS: RecentKind[] = ['scene', 'armature', 'present', 'lib'];

function valid(x: unknown): x is Recent {
  const r = x as Partial<Recent> | null;
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.place === 'string' &&
    typeof r.at === 'number' &&
    KINDS.includes(r.kind as RecentKind) &&
    (r.scope === undefined || r.scope === 'admin')
  );
}

/** The list, newest first. */
export function listRecent(): Recent[] {
  if (!mayStore()) return held.slice();
  try {
    const raw = deviceStore.get(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, RECENT_MAX) : [];
  } catch {
    return held.slice();
  }
}

function save(list: Recent[]): void {
  held = list;
  try {
    deviceStore.set(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Saving is off, or storage refused: the page keeps it.
  }
  for (const fn of listeners) fn();
}

/** Opened or saved: to the top, once, whatever it was before. */
export function recordRecent(entry: Omit<Recent, 'at'> & { at?: number }): void {
  const at = entry.at ?? Date.now();
  const next: Recent = { id: entry.id, kind: entry.kind, name: entry.name, place: entry.place, at, ...(entry.scope ? { scope: entry.scope } : {}) };
  const rest = listRecent().filter((r) => !(r.id === next.id && r.kind === next.kind));
  save([next, ...rest].slice(0, RECENT_MAX));
}

/** One that can no longer be opened. */
export function dropRecent(entry: Pick<Recent, 'id' | 'kind'>): void {
  save(listRecent().filter((r) => !(r.id === entry.id && r.kind === entry.kind)));
}

export function clearRecent(): void {
  save([]);
}

/** Signing out: what needed the account goes, what this device holds stays. */
export function forgetAccountRecents(): void {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const stored: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(stored)) localStorage.setItem(RECENT_KEY, JSON.stringify(stored.filter(valid).filter((r) => r.kind === 'lib')));
  } catch {
    // Nothing readable to clear.
  }
  held = held.filter((r) => r.kind === 'lib');
  for (const fn of listeners) fn();
}

export function onRecentChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "just now" / "3 hours ago": enough to tell which session it was. */
export function ago(t: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** What each kind is called in a hint. */
export const KIND_LABEL: Record<RecentKind, string> = { scene: 'Sculpt', lib: 'Sculpt', armature: 'Armature', present: 'Present' };
