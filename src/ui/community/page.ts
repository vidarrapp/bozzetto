import { checkSignIn, roleOf, type SignIn } from '../../admin/api';
import { dayOf, loadConfig, type Me } from '../../net/account';
import {
  COMMUNITY_SORTS,
  HANDLE_IN_ADDRESS,
  MAX_SEARCH,
  authorHref,
  authorPage,
  communityPage,
  sortOf,
  type CommunityAnswer,
  type CommunityItem,
  type ListQuery,
} from '../../net/community';
import { legalFoot, setPicture } from '../Landing';
import { topChip, topbarLeft, topbarRight } from '../topbar';
import { accountChips } from '../account/menu';
import { button, el } from '../account/parts';
import { starButton } from './star';

/**
 * The community gallery (docs/accounts.md §13), anyone's to see:
 *
 * - `/?community`: the work members have shared and a reviewer approved,
 *   24 cards a page with Load more.
 * - `/?u=<handle>`: one member's part of it, under their handle; nobody
 *   by that handle (or an account not open now) is "No such member".
 *
 * Both have a sort select - Newest (the default), Oldest, Most viewed, Most
 * starred - and a search: titles or @handles on the Community, titles on
 * an author page. Both are kept in the address (`&sort=`, `&q=`, replaced,
 * not pushed, the search after 300 ms of quiet), so a reload keeps them.
 *
 * A card is the gallery's card: the 4:5 picture, the title, the author's
 * handle (to their page), the day it was approved and what it is (model or
 * timelapse). Picture and title open it in the viewer, as does the rest of
 * the card. A member signed in has a Star toggle in the picture's corner,
 * on anyone's work but their own (star.ts). Nobody here sees a count: the
 * author sees theirs on My projects, reviewers on the Review page. View
 * only: the viewer offers nothing to copy or download.
 *
 * The page keeps the gallery's frame: ← Gallery and the account's chips in
 * the top row, the legal pages at the foot. Offline, the service worker's
 * last copy of a list a guest was given stands in (vite.config.ts).
 *
 * Stable hooks for tests: `.community-page[data-page=community|author]`,
 * `.card--community[data-project][data-author]`, `.community__more`,
 * `.community__empty`, `.community__missing`, `.community__say`,
 * `.community-sort`, `.community-search`, `.star-toggle`.
 */

/** How long the search waits for the typing to stop. */
const SEARCH_WAIT = 300;

export async function renderCommunity(app: HTMLElement, handle: string | null = null): Promise<void> {
  document.documentElement.classList.add('is-page');
  app.classList.add('app--page');
  const author = handle !== null;
  const shown = (handle ?? '').trim();
  document.title = author ? `@${shown} · Bozzetto` : 'Community · Bozzetto';

  const page = el('div', 'landing community-page');
  page.dataset.page = author ? 'author' : 'community';
  const head = el('header', 'landing__head');
  const titles = el('div');
  const title = el('h1', 'landing__title', author ? `@${shown}` : 'Community');
  const tagline = el(
    'p',
    'landing__tagline',
    author ? 'Their work in the Community. View only: it stays theirs.' : 'View work shared by our community, all rights reserved by authors.',
  );
  titles.append(title, tagline);
  head.appendChild(titles);
  const say = el('p', 'account-say community__say');
  say.setAttribute('role', 'status');
  const params = new URLSearchParams(window.location.search);
  const tools = listTools(author, { sort: sortOf(params.get('sort')), q: (params.get('q') ?? '').slice(0, MAX_SEARCH) });
  tools.root.hidden = true;
  const grid = el('div', 'landing__grid community__grid');
  const more = button('Load more', 'btn community__more');
  more.hidden = true;
  page.append(head, tools.root, say, grid, more);
  app.replaceChildren(page);
  topRow(author);

  const config = await loadConfig();
  let me: Me | null = null;
  if (config?.accounts) {
    const signIn = await checkSignIn().catch((): SignIn => ({ email: null, expired: false }));
    chips(signIn, app, handle);
    me = signIn.me && signIn.me.status === 'active' ? signIn.me : null;
    page.appendChild(legalFoot());
  } else {
    // No accounts, no members, and nothing anyone has shared.
    say.textContent = 'The Community is not open on this site.';
    return;
  }

  if (author && !HANDLE_IN_ADDRESS.test(shown)) {
    missing(page, grid, shown);
    return;
  }
  tools.root.hidden = false;

  let cursor: string | null = null;
  let first = true;
  // Each new order or search starts the list again; an answer to an older one is dropped.
  let round = 0;
  const load = async (fresh: boolean): Promise<void> => {
    const mine = fresh ? ++round : round;
    if (fresh) {
      cursor = null;
      first = true;
    }
    const query = tools.query();
    more.disabled = true;
    more.textContent = 'Loading…';
    const answer: CommunityAnswer = author ? await authorPage(shown, query, cursor) : await communityPage(query, cursor);
    if (mine !== round) return;
    more.disabled = false;
    if (answer.kind === 'missing' && author) {
      missing(page, grid, shown);
      tools.root.hidden = true;
      more.hidden = true;
      return;
    }
    if (answer.kind === 'off') {
      say.textContent = 'The Community is not open on this site.';
      more.hidden = true;
      return;
    }
    if (answer.kind !== 'page') {
      const status = answer.kind === 'failed' ? answer.status : 404;
      say.dataset.tone = 'error';
      say.textContent =
        status === 0
          ? 'No connection, and no copy of this page kept here. Try again when you are online.'
          : `The Community could not be loaded (${status}). Try again in a moment.`;
      // The button stays, to ask for the same page again.
      more.textContent = first ? 'Try again' : 'Load more';
      more.hidden = false;
      return;
    }
    more.textContent = 'Load more';
    say.textContent = '';
    delete say.dataset.tone;
    // The handle as the member has it, whatever capitals the address used.
    if (author && answer.handle) {
      title.textContent = `@${answer.handle}`;
      document.title = `@${answer.handle} · Bozzetto`;
    }
    if (first) grid.replaceChildren();
    for (const item of answer.page.items) {
      // A card already drawn (the list moved between pages) is not drawn twice.
      if (grid.querySelector(`[data-project="${CSS.escape(item.id)}"]`)) continue;
      grid.appendChild(communityCard(item, { showAuthor: !author, me }));
    }
    if (first && answer.page.items.length === 0) {
      grid.appendChild(query.q ? el('p', 'muted community__empty', 'Nothing in the Community matches.') : empty(author ? answer.handle ?? shown : null));
    }
    first = false;
    cursor = answer.page.next;
    more.hidden = cursor === null;
  };
  tools.changed = () => {
    remember(author, shown, tools.query());
    void load(true);
  };
  more.addEventListener('click', () => void load(false));
  await load(true);
}

/** The address follows the order and the search, replaced rather than pushed: a reload keeps them. */
function remember(author: boolean, handle: string, query: ListQuery): void {
  const params = new URLSearchParams(window.location.search);
  const out = new URLSearchParams();
  if (author) out.set('u', params.get('u') ?? handle);
  if (query.sort !== 'new') out.set('sort', query.sort);
  const q = query.q.trim();
  if (q) out.set('q', q);
  // ?community is a bare key, as the gallery's chip writes it.
  const text = out.toString();
  const href = author ? `/?${text}` : `/?community${text ? `&${text}` : ''}`;
  window.history.replaceState(null, '', href);
}

/** The sort select and the search, and what they ask for now. */
function listTools(author: boolean, start: ListQuery): { root: HTMLElement; query: () => ListQuery; changed: () => void } {
  const root = el('form', 'review-gallery__tools community__tools');
  root.setAttribute('role', 'search');
  root.addEventListener('submit', (e) => e.preventDefault());
  const search = el('input', 'account-input review-search community-search');
  search.type = 'search';
  search.name = 'q';
  search.maxLength = MAX_SEARCH;
  search.placeholder = author ? 'Search titles' : 'Search titles or @handles';
  search.setAttribute('aria-label', author ? 'Search their work by title' : 'Search the Community by title or @handle');
  search.value = start.q;
  const sort = el('select', 'account-input review-filter community-sort');
  sort.name = 'sort';
  sort.setAttribute('aria-label', 'Sort by');
  for (const [value, label] of COMMUNITY_SORTS) {
    const o = el('option', '', label);
    o.value = value;
    sort.appendChild(o);
  }
  sort.value = start.sort;
  root.append(search, sort);
  const tools = {
    root,
    query: (): ListQuery => ({ sort: sortOf(sort.value), q: search.value.trim().slice(0, MAX_SEARCH) }),
    changed: (): void => undefined,
  };
  let timer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => tools.changed(), SEARCH_WAIT);
  });
  sort.addEventListener('change', () => {
    window.clearTimeout(timer);
    tools.changed();
  });
  return tools;
}

/** The top row's left: back to the gallery, and on an author page to the Community. */
function topRow(author: boolean): void {
  const left = topbarLeft();
  if (!left.querySelector('.viewer-back')) {
    const back = topChip('← Gallery', '/');
    back.classList.add('viewer-back');
    left.appendChild(back);
  }
  left.querySelector('.community-back')?.remove();
  if (author) {
    const to = topChip('Community', '/?community');
    to.classList.add('community-back');
    left.appendChild(to);
  }
}

function chips(signIn: SignIn, app: HTMLElement, handle: string | null): void {
  const bar = topbarRight();
  bar.querySelectorAll('.landing-chip').forEach((c) => c.remove());
  for (const c of accountChips(signIn, roleOf(signIn), () => void renderCommunity(app, handle))) {
    c.classList.add('landing-chip');
    bar.appendChild(c);
  }
}

function empty(handle: string | null): HTMLElement {
  return el(
    'p',
    'muted community__empty',
    handle
      ? `@${handle} has nothing in the Community yet.`
      : 'Nothing has been shared yet. Members share a model or a timelapse from My projects, and it shows here once a reviewer has looked at it.',
  );
}

function missing(page: HTMLElement, grid: HTMLElement, handle: string): void {
  page.dataset.missing = 'true';
  grid.replaceChildren(
    el('p', 'muted community__missing', `No such member. Nobody here goes by @${handle}, or their account is not open just now.`),
  );
}

const MODE_LABEL: Record<string, string> = { model: 'model', timelapse: 'timelapse' };

/**
 * A community card. Not one link around everything, since the handle is a
 * link of its own: the picture and the title open the viewer, the handle
 * the author's page, and a click anywhere else on the card opens the
 * viewer too. With `me`, a member signed in, the Star toggle in the
 * picture's corner, unless it is their own work; `unstarred` hears when
 * it is unstarred (the Starred tab takes the card away).
 */
export function communityCard(
  item: CommunityItem,
  opts: { showAuthor: boolean; me?: Me | null; unstarred?: (card: HTMLElement) => void },
): HTMLElement {
  const card = el('div', 'card card--library card--community');
  card.dataset.project = item.id;
  card.dataset.author = item.author.handle;
  const href = `/?tl=${encodeURIComponent(item.id)}`;
  const thumb = el('a', 'card__thumb');
  thumb.href = href;
  thumb.setAttribute('aria-label', item.title || 'Untitled');
  const body = el('div', 'card__body');
  const title = el('a', 'card__title card__link', item.title || 'Untitled');
  title.href = href;
  const meta = el('span', 'card__meta');
  meta.append(el('span', 'badge card__mode', MODE_LABEL[item.mode] ?? 'model'));
  if (item.shared_at) meta.append(el('span', 'card__date', dayOf(item.shared_at)));
  body.append(title);
  if (opts.showAuthor) {
    const by = el('a', 'card__author', `@${item.author.handle}`);
    by.href = authorHref(item.author.handle);
    body.append(by);
  }
  body.append(meta);
  card.append(thumb, body);
  if (item.thumb) setPicture(thumb, item.thumb);
  // Star, for a member signed in, on anyone's work but their own; beside
  // the picture rather than in its link, so it is a button of its own.
  const me = opts.me;
  if (me && me.handle.toLowerCase() !== item.author.handle.toLowerCase()) {
    card.appendChild(
      starButton(item.id, item.starred === true, {
        className: 'card__star',
        changed: (on) => {
          item.starred = on;
          if (!on) opts.unstarred?.(card);
        },
      }),
    );
  }
  card.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('a, button')) return;
    window.location.assign(href);
  });
  return card;
}
