import { apiFetch } from './origin';

/**
 * The community gallery's public lists (docs/accounts.md §13): members'
 * work a reviewer has approved, newest approval first, anyone's to see.
 * The service worker asks the network first and keeps the last answer for
 * offline use (vite.config.ts).
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

const after = (cursor: string | null): string => (cursor ? `?after=${encodeURIComponent(cursor)}` : '');

/** GET /api/community: a page of the gallery, after `cursor`. */
export const communityPage = (cursor: string | null = null): Promise<CommunityAnswer> => ask(`/api/community${after(cursor)}`);

/** GET /api/community/u/:handle: a page of one member's public work, after `cursor`. */
export const authorPage = (handle: string, cursor: string | null = null): Promise<CommunityAnswer> =>
  ask(`/api/community/u/${encodeURIComponent(handle)}${after(cursor)}`);

/** Where a member's author page is. */
export const authorHref = (handle: string): string => `/?u=${encodeURIComponent(handle)}`;
