import { apiFetch } from './origin';

/**
 * The community gallery's public lists (docs/accounts.md §13): members'
 * work a reviewer has approved, anyone's to see, in four orders and
 * searchable. The service worker asks the network first and keeps the last
 * answer a guest was given for offline use (vite.config.ts); a signed-in
 * member's answers, which say what they starred, are kept by nothing.
 */

/** One card of the community gallery, as GET /api/community lists it. */
export interface CommunityItem {
  id: string;
  title: string;
  mode: string;
  fps: number;
  shared_at: number;
  author: { handle: string };
  /** Its picture, at its current version. */
  thumb: string;
  /** Where its files are read from. */
  media: string;
  /** Whether the member signed in starred it; absent for a guest. */
  starred?: boolean;
}

/** A page of a list, and the cursor of the next (null at the end). */
export interface CommunityPage {
  items: CommunityItem[];
  next: string | null;
}

/** What a list answered: a page, nobody by that handle (404), or no answer to be had. */
export type CommunityAnswer =
  | { kind: 'page'; page: CommunityPage; handle?: string }
  | { kind: 'missing' }
  | { kind: 'off' }
  | { kind: 'failed'; status: number };

/** A handle as the author page takes it from the address: any capitals, the server's shape otherwise. */
export const HANDLE_IN_ADDRESS = /^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$/;

/** A picture's address as a server names one: a path on this site, or an http(s) address. */
const PICTURE = /^(?:https?:\/\/[^/?#]+)?\/(?!\/)/;

function itemOf(raw: unknown): CommunityItem | null {
  const r = raw as Partial<CommunityItem> | null;
  if (!r || typeof r.id !== 'string' || typeof r.author?.handle !== 'string') return null;
  return {
    id: r.id,
    title: typeof r.title === 'string' ? r.title : '',
    mode: typeof r.mode === 'string' ? r.mode : 'model',
    fps: typeof r.fps === 'number' ? r.fps : 0,
    shared_at: typeof r.shared_at === 'number' ? r.shared_at : 0,
    author: { handle: r.author.handle },
    thumb: typeof r.thumb === 'string' && PICTURE.test(r.thumb) ? r.thumb : '',
    media: typeof r.media === 'string' ? r.media : '',
    ...(typeof r.starred === 'boolean' ? { starred: r.starred } : {}),
  };
}

async function ask(path: string): Promise<CommunityAnswer> {
  let res;
  try {
    res = await apiFetch(path);
  } catch {
    return { kind: 'failed', status: 0 };
  }
  // A host serving the app alone answers with its shell: no community here.
  if (res.contentType.includes('text/html')) return { kind: 'off' };
  let body: Record<string, unknown> | null = null;
  try {
    body = res.bytes ? (JSON.parse(new TextDecoder().decode(res.bytes)) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (res.status === 404) return body?.code === 'accounts_off' ? { kind: 'off' } : { kind: 'missing' };
  if (!res.ok || !body || !Array.isArray(body.items)) return { kind: 'failed', status: res.status };
  const items = body.items.map(itemOf).filter((i): i is CommunityItem => i !== null);
  const next = typeof body.next === 'string' && body.next ? body.next : null;
  const handle = typeof body.handle === 'string' ? body.handle : undefined;
  return { kind: 'page', page: { items, next }, handle };
}

/** The orders a list comes in, as the server names them. */
export type CommunitySort = 'new' | 'old' | 'views' | 'stars';

/** The sort select's options, in order: the first is the default. */
export const COMMUNITY_SORTS: readonly [CommunitySort, string][] = [
  ['new', 'Newest'],
  ['old', 'Oldest'],
  ['views', 'Most viewed'],
  ['stars', 'Most starred'],
];

/** A sort from the address: one the server takes, else the default. */
export const sortOf = (raw: string | null): CommunitySort =>
  COMMUNITY_SORTS.some(([s]) => s === raw) ? (raw as CommunitySort) : 'new';

/** What the longest search is, in characters (the server cuts it there too). */
export const MAX_SEARCH = 100;

/** How a list is asked for: its order and its search ('' for none). */
export interface ListQuery {
  sort: CommunitySort;
  q: string;
}

function listPath(base: string, query: ListQuery, cursor: string | null): string {
  const params = new URLSearchParams();
  if (query.sort !== 'new') params.set('sort', query.sort);
  const q = query.q.trim().slice(0, MAX_SEARCH);
  if (q) params.set('q', q);
  if (cursor) params.set('after', cursor);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

const NEWEST: ListQuery = { sort: 'new', q: '' };

/** GET /api/community: a page of the gallery in `query`'s order and search, after `cursor`. */
export const communityPage = (query: ListQuery = NEWEST, cursor: string | null = null): Promise<CommunityAnswer> =>
  ask(listPath('/api/community', query, cursor));

/** GET /api/community/u/:handle: a page of one member's public work (`q` matching titles), after `cursor`. */
export const authorPage = (handle: string, query: ListQuery = NEWEST, cursor: string | null = null): Promise<CommunityAnswer> =>
  ask(listPath(`/api/community/u/${encodeURIComponent(handle)}`, query, cursor));

/** GET /api/me/stars: a page of the works the member signed in starred, the latest first. */
export const starredPage = (cursor: string | null = null): Promise<CommunityAnswer> =>
  ask(cursor ? `/api/me/stars?after=${encodeURIComponent(cursor)}` : '/api/me/stars');

/**
 * POST /api/community/:id/view: the viewer opened a work from the
 * Community. The server decides whether it counts (once a day a visitor,
 * never the author's or a reviewer's) and always answers 204; nothing here
 * waits for it or cares how it went.
 */
export function recordView(id: string): void {
  void apiFetch(`/api/community/${encodeURIComponent(id)}/view`, { method: 'POST' }).catch(() => undefined);
}

/** "12 views · 1 star": what the author and reviewers see of a work's counts. */
export function statsText(views: number, stars: number): string {
  const n = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`;
  return `${n(views, 'view')} · ${n(stars, 'star')}`;
}

/** Where a member's author page is. */
export const authorHref = (handle: string): string => `/?u=${encodeURIComponent(handle)}`;
