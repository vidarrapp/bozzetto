import { checkSignIn, roleOf, type SignIn } from '../../admin/api';
import { dayOf, loadConfig } from '../../net/account';
import {
  HANDLE_IN_ADDRESS,
  authorHref,
  authorPage,
  communityPage,
  type CommunityAnswer,
  type CommunityItem,
} from '../../net/community';
import { legalFoot, setPicture } from '../Landing';
import { topChip, topbarLeft, topbarRight } from '../topbar';
import { accountChips } from '../account/menu';
import { button, el } from '../account/parts';

/**
 * The community gallery (docs/accounts.md §13), anyone's to see:
 *
 * - `/?community`: the work members have shared and a reviewer approved,
 *   newest approval first, 24 cards a page with Load more.
 * - `/?u=<handle>`: one member's part of it, under their handle; nobody
 *   by that handle (or an account not open now) is "No such member".
 *
 * A card is the gallery's card: the 4:5 picture, the title, the author's
 * handle (to their page), the day it was approved and what it is (model or
 * timelapse). Picture and title open it in the viewer, as does the rest of
 * the card. View only: the viewer offers nothing to copy or download.
 *
 * The page keeps the gallery's frame: ← Gallery and the account's chips in
 * the top row, the legal pages at the foot. Offline, the service worker's
 * last copy of a list stands in (vite.config.ts).
 *
 * Stable hooks for tests: `.community-page[data-page=community|author]`,
 * `.card--community[data-project][data-author]`, `.community__more`,
 * `.community__empty`, `.community__missing`, `.community__say`.
 */

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
    author ? 'Their work in the Community. View only: it stays theirs.' : "Work members have shared, newest first. View only: it stays its author's.",
  );
  titles.append(title, tagline);
  head.appendChild(titles);
  const say = el('p', 'account-say community__say');
  say.setAttribute('role', 'status');
  const grid = el('div', 'landing__grid community__grid');
  const more = button('Load more', 'btn community__more');
  more.hidden = true;
  page.append(head, say, grid, more);
  app.replaceChildren(page);
  topRow(author);

  const config = await loadConfig();
  if (config?.accounts) {
    const signIn = await checkSignIn().catch((): SignIn => ({ email: null, expired: false }));
    chips(signIn, app, handle);
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

  let cursor: string | null = null;
  let first = true;
  const load = async (): Promise<void> => {
    more.disabled = true;
    more.textContent = 'Loading…';
    const answer: CommunityAnswer = author ? await authorPage(shown, cursor) : await communityPage(cursor);
    more.disabled = false;
    if (answer.kind === 'missing' && author) {
      missing(page, grid, shown);
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
    for (const item of answer.page.items) {
      // A card already drawn (the list moved between pages) is not drawn twice.
      if (grid.querySelector(`[data-project="${CSS.escape(item.id)}"]`)) continue;
      grid.appendChild(communityCard(item, { showAuthor: !author }));
    }
    if (first && answer.page.items.length === 0) grid.appendChild(empty(author ? answer.handle ?? shown : null));
    first = false;
    cursor = answer.page.next;
    more.hidden = cursor === null;
  };
  more.addEventListener('click', () => void load());
  await load();
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
 * viewer too.
 */
export function communityCard(item: CommunityItem, opts: { showAuthor: boolean }): HTMLElement {
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
  card.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('a')) return;
    window.location.assign(href);
  });
  return card;
}
