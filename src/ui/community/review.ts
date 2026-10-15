import { checkSignIn, roleOf, type SignIn } from '../../admin/api';
import {
  AccountError,
  dayOf,
  errorText,
  loadConfig,
  momentOf,
  reviewHistory,
  reviewQueue,
  reviewReports,
  reviewShared,
  type HistoryItem,
  type Me,
  type OpenReport,
  type ReviewAction,
  type ReviewCard,
  type SharedFilter,
} from '../../net/account';
import { authorHref } from '../../net/community';
import { legalFoot, renderLanding, setPicture } from '../Landing';
import { topChip, topbarLeft, topbarRight } from '../topbar';
import { accountChips } from '../account/menu';
import { button, el } from '../account/parts';
import { signInButton } from '../signIn';
import {
  ACTION_LABEL,
  REVIEW_TABS,
  STATE_LABEL,
  allowedActions,
  askReason,
  doneText,
  mayReview,
  reportReasonText,
  reviewTabHref,
  reviewTabOf,
  reviewViewerHref,
  sendReview,
  type ReviewTab,
} from './reviewActions';

/**
 * The Review page, `/?review` (docs/accounts.md §13): the owner's and the
 * moderators' place to decide on what members share. Anyone else is sent
 * to the gallery, which says why. Four tabs, plain links like the owner
 * tools' (`?review&tab=`):
 *
 * - Queue: what waits for review, oldest first, 50 at a time with Load
 *   more; Open (the viewer in review mode), Approve, Reject… (a reason).
 * - Gallery: everything in the Community now, public or hidden, newest
 *   first, 24 at a time with Load more; a search (title or @handle,
 *   debounced, kept in the address as `&q=`) and a state filter (`&state=`);
 *   Open, and Hide… or Unhide.
 * - Reports: each project with open reports, the longest-reported first,
 *   with the reports (reason, note, who, when) and where it stands; Hide…,
 *   Dismiss, Unhide, Reject… as its state allows.
 * - History: the reviews and withdrawals of the last 30 days, newest first.
 *
 * An action redraws its card from the server's answer. Someone else acting
 * first (409) redraws it as it now is, saying so; a moderator does not
 * review their own work (the card says so and offers nothing; the server
 * refuses as well), while the owner reviews everything, their own included.
 *
 * Hooks for tests: `.review-page[data-tab]`, `.review-tab[data-tab]`,
 * `.review-card[data-project][data-shared]`, `.review-card__state`,
 * `.review-card__reports`, `.review-report`, `.review-action[data-action]`,
 * `.review-card__say`, `.review__more`, `.review__empty`,
 * `.review-history__item[data-action]`, `.review__say`, and on the Gallery
 * tab `.review-search`, `.review-filter`.
 */
export async function renderReview(app: HTMLElement): Promise<void> {
  const config = await loadConfig();
  const signIn = config?.accounts ? await checkSignIn().catch((): SignIn => ({ email: null, expired: false })) : null;
  const me = signIn?.me ?? null;
  if (!signIn || !me || (me.role !== 'owner' && me.role !== 'moderator') || me.status !== 'active') {
    await sendToGallery(app);
    return;
  }

  document.documentElement.classList.add('is-page');
  app.classList.add('app--page');
  document.title = 'Review · Bozzetto';
  const tab = reviewTabOf(new URLSearchParams(window.location.search).get('tab'));
  const page = el('div', 'landing review-page');
  page.dataset.tab = tab;
  const head = el('header', 'landing__head');
  const titles = el('div');
  titles.append(
    el('h1', 'landing__title', 'Review'),
    el('p', 'landing__tagline', 'What members share waits here for a reviewer. Moderators do not review their own work; the owner reviews everything.'),
  );
  head.appendChild(titles);
  const nav = el('nav', 'admin-tabs review-tabs');
  nav.setAttribute('aria-label', 'Review');
  for (const [name, label] of REVIEW_TABS) {
    const a = el('a', `admin-tab review-tab${name === tab ? ' admin-tab--current' : ''}`, label);
    a.href = reviewTabHref(name);
    a.dataset.tab = name;
    if (name === tab) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }
  const say = el('p', 'account-say review__say');
  say.setAttribute('role', 'status');
  const body = el('div', 'review__body');
  page.append(head, nav, say, body, legalFoot());
  app.replaceChildren(page);

  const left = topbarLeft();
  if (!left.querySelector('.viewer-back')) {
    const back = topChip('← Gallery', '/');
    back.classList.add('viewer-back');
    left.appendChild(back);
  }
  const bar = topbarRight();
  bar.querySelectorAll('.landing-chip').forEach((c) => c.remove());
  for (const c of accountChips(signIn, roleOf(signIn), () => void renderReview(app))) {
    c.classList.add('landing-chip');
    bar.appendChild(c);
  }

  const ctx: Ctx = { app, me, tab, say };
  if (tab === 'queue') await queueTab(ctx, body);
  else if (tab === 'gallery') await galleryTab(ctx, body);
  else if (tab === 'reports') await reportsTab(ctx, body);
  else await historyTab(ctx, body);
}

interface Ctx {
  app: HTMLElement;
  me: Me;
  tab: ReviewTab;
  say: HTMLElement;
}

/** Not a reviewer: the gallery, at its own address, saying why. */
async function sendToGallery(app: HTMLElement): Promise<void> {
  window.history.replaceState(null, '', '/');
  await renderLanding(app);
  const note = el('p', 'landing__notice review-refused', 'The Review page is for the owner and moderators, so here is the gallery.');
  app.querySelector('.landing__head > div')?.appendChild(note);
}

/** A list that would not load, said on the page; a sign-in gone offers Sign in again. */
function loadFailed(ctx: Ctx, what: string, err: unknown): void {
  ctx.say.dataset.tone = 'error';
  if (err instanceof AccountError && err.status === 401) {
    ctx.say.replaceChildren('Your sign-in has expired. ', signInButton('account-linkbtn', (ok) => (ok ? void renderReview(ctx.app) : undefined)));
    return;
  }
  if (err instanceof AccountError && err.status === 403) {
    ctx.say.textContent = 'Only the owner and moderators review, and this account is not one now.';
    return;
  }
  ctx.say.textContent = `${what} could not be loaded: ${errorText(err)}`;
}

async function queueTab(ctx: Ctx, body: HTMLElement): Promise<void> {
  const grid = el('div', 'landing__grid review__grid');
  const more = button('Load more', 'btn community__more review__more');
  more.hidden = true;
  body.append(grid, more);
  let cursor: string | null = null;
  let first = true;
  const load = async (): Promise<void> => {
    more.disabled = true;
    let page;
    try {
      page = await reviewQueue(cursor);
    } catch (err) {
      more.disabled = false;
      loadFailed(ctx, 'The queue', err);
      return;
    }
    more.disabled = false;
    for (const item of page.items) {
      if (grid.querySelector(`[data-project="${CSS.escape(item.id)}"]`)) continue;
      grid.appendChild(new Card(ctx, item, null).root);
    }
    if (first && page.items.length === 0) grid.appendChild(el('p', 'muted review__empty', 'Nothing is waiting for review.'));
    first = false;
    cursor = page.next;
    more.hidden = cursor === null;
  };
  more.addEventListener('click', () => void load());
  await load();
}

async function reportsTab(ctx: Ctx, body: HTMLElement): Promise<void> {
  const grid = el('div', 'landing__grid review__grid review__grid--reports');
  body.append(grid);
  let got;
  try {
    got = await reviewReports();
  } catch (err) {
    loadFailed(ctx, 'The reports', err);
    return;
  }
  for (const { project, reports } of got.items) grid.appendChild(new Card(ctx, project, reports).root);
  if (got.items.length === 0) grid.appendChild(el('p', 'muted review__empty', 'No open reports.'));
}

/** The Gallery tab's state filter, in words. */
const FILTERS: [SharedFilter, string][] = [
  ['all', 'All'],
  ['public', 'Public'],
  ['hidden', 'Hidden'],
];

const filterOf = (raw: string | null): SharedFilter => (raw === 'public' || raw === 'hidden' ? raw : 'all');

/** How long the search waits for the typing to stop. */
const SEARCH_WAIT = 300;

/**
 * Everything in the Community now, newest first, searched and filtered;
 * the search and the filter are kept in the address (`&q=`, `&state=`),
 * so a reload keeps them.
 */
async function galleryTab(ctx: Ctx, body: HTMLElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const tools = el('form', 'review-gallery__tools');
  tools.setAttribute('role', 'search');
  tools.addEventListener('submit', (e) => e.preventDefault());
  const search = el('input', 'account-input review-search');
  search.type = 'search';
  search.name = 'q';
  search.maxLength = 100;
  search.placeholder = 'Search titles or @handles';
  search.setAttribute('aria-label', 'Search the Community by title or @handle');
  search.value = params.get('q') ?? '';
  const filter = el('select', 'account-input review-filter');
  filter.name = 'state';
  filter.setAttribute('aria-label', 'Which to show');
  for (const [value, label] of FILTERS) {
    const o = el('option', '', label);
    o.value = value;
    filter.appendChild(o);
  }
  filter.value = filterOf(params.get('state'));
  tools.append(search, filter);
  const grid = el('div', 'landing__grid review__grid');
  const more = button('Load more', 'btn community__more review__more');
  more.hidden = true;
  body.append(tools, grid, more);

  let cursor: string | null = null;
  // Each search starts a new list; an answer to an older one is dropped.
  let round = 0;
  const query = (): { q: string; state: SharedFilter } => ({ q: search.value.trim().slice(0, 100), state: filterOf(filter.value) });
  const load = async (fresh: boolean): Promise<void> => {
    const mine = fresh ? ++round : round;
    const { q, state } = query();
    more.disabled = true;
    let page;
    try {
      page = await reviewShared(q, state, fresh ? null : cursor);
    } catch (err) {
      if (mine !== round) return;
      more.disabled = false;
      loadFailed(ctx, 'The Community', err);
      return;
    }
    if (mine !== round) return;
    more.disabled = false;
    if (fresh) grid.replaceChildren();
    for (const item of page.items) {
      if (grid.querySelector(`[data-project="${CSS.escape(item.id)}"]`)) continue;
      grid.appendChild(new Card(ctx, item, null).root);
    }
    if (fresh && page.items.length === 0) {
      grid.appendChild(el('p', 'muted review__empty', q || state !== 'all' ? 'Nothing in the Community matches.' : 'Nothing is in the Community yet.'));
    }
    cursor = page.next;
    more.hidden = cursor === null;
  };
  /** The address follows the search, replaced rather than pushed: a reload keeps it. */
  const remember = (): void => {
    const { q, state } = query();
    let href = reviewTabHref('gallery');
    if (q) href += `&q=${encodeURIComponent(q)}`;
    if (state !== 'all') href += `&state=${state}`;
    window.history.replaceState(null, '', href);
  };
  let timer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      remember();
      void load(true);
    }, SEARCH_WAIT);
  });
  filter.addEventListener('change', () => {
    window.clearTimeout(timer);
    remember();
    void load(true);
  });
  more.addEventListener('click', () => void load(false));
  await load(true);
}

/** Each history line's verb. */
const DONE: Record<string, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  hide: 'Hidden',
  unhide: 'Unhidden',
  dismiss: 'Reports dismissed',
  withdraw: 'Withdrawn',
};

async function historyTab(ctx: Ctx, body: HTMLElement): Promise<void> {
  let got;
  try {
    got = await reviewHistory();
  } catch (err) {
    loadFailed(ctx, 'The history', err);
    return;
  }
  if (got.items.length === 0) {
    body.appendChild(el('p', 'muted review__empty', 'Nothing has been reviewed or withdrawn in the last 30 days.'));
    return;
  }
  const list = el('ul', 'review-history');
  for (const item of got.items) list.appendChild(historyLine(item));
  body.append(el('p', 'muted review-history__intro', 'The last 30 days, newest first.'), list);
}

function historyLine(item: HistoryItem): HTMLElement {
  const li = el('li', 'review-history__item');
  li.dataset.action = item.action;
  const head = el('p', 'review-history__head');
  const who = item.auto
    ? "by members' reports"
    : item.action === 'withdraw'
      ? `by its author${item.actor ? `, @${item.actor.handle}` : ''}`
      : item.actor
        ? `by @${item.actor.handle}`
        : 'by an account since deleted';
  head.append(el('strong', 'review-history__what', DONE[item.action] ?? item.action), ` ${who} · ${momentOf(item.at)}`);
  const what = el('p', 'review-history__project');
  if (item.project) {
    const title = el('a', 'review-history__title', `“${item.project.title || 'Untitled'}”`);
    title.href = reviewViewerHref(item.project.id, 'history');
    what.append(title);
    if (item.project.author) what.append(` by @${item.project.author.handle}`);
    what.append(` · now ${STATE_LABEL[item.project.shared].toLowerCase()}`);
  } else {
    what.textContent = 'A project since deleted.';
  }
  li.append(head, what);
  if (item.reason) li.appendChild(el('p', 'review-history__reason', `Reason: ${item.reason}`));
  return li;
}

/** One project on the Queue or the Reports tab: drawn again after each action from what the server says. */
class Card {
  readonly root = el('div', 'card card--library review-card');
  private readonly body = el('div', 'card__body');
  private readonly say = el('p', 'account-say review-card__say');
  private busy = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly item: ReviewCard,
    private reports: OpenReport[] | null,
  ) {
    this.root.dataset.project = item.id;
    const thumb = el('a', 'card__thumb');
    thumb.href = reviewViewerHref(item.id, ctx.tab);
    thumb.setAttribute('aria-label', `Open “${item.title || 'Untitled'}” for review`);
    if (item.thumb) setPicture(thumb, item.thumb);
    this.say.setAttribute('role', 'status');
    this.root.append(thumb, this.body);
    this.draw();
  }

  /** A moderator's own work, which another reviewer decides on; never the owner's. */
  private get own(): boolean {
    return !mayReview(this.ctx.me, this.item.author?.handle ?? null);
  }

  private draw(): void {
    const p = this.item;
    this.root.dataset.shared = p.shared;
    const href = reviewViewerHref(p.id, this.ctx.tab);
    const title = el('a', 'card__title card__link', p.title || 'Untitled');
    title.href = href;
    const parts: HTMLElement[] = [title];
    if (p.author) {
      const by = el('a', 'card__author', `@${p.author.handle}`);
      by.href = authorHref(p.author.handle);
      parts.push(by);
    }
    const meta = el('span', 'card__meta');
    meta.append(el('span', 'badge card__mode', p.mode === 'timelapse' ? 'timelapse' : 'model'));
    if (p.shared_at) meta.append(el('span', 'card__date', `${p.shared === 'pending' ? 'Submitted' : 'Shared'} ${dayOf(p.shared_at)}`));
    parts.push(meta);
    const state = el('p', 'card__share-status review-card__state');
    state.textContent =
      (p.shared === 'rejected' || p.shared === 'hidden') && p.review_reason ? `${STATE_LABEL[p.shared]}: ${p.review_reason}` : STATE_LABEL[p.shared];
    parts.push(state);
    if (this.reports) {
      const open = this.reports.length;
      parts.push(el('p', 'review-card__reports', open === 0 ? 'No open reports now.' : `${open} open report${open === 1 ? '' : 's'}`));
      if (open) {
        const list = el('ul', 'review-reports');
        for (const r of this.reports) {
          const li = el('li', 'review-report');
          li.dataset.reason = r.reason;
          li.append(el('span', 'review-report__why', reportReasonText(r.reason)), ` · @${r.reporter.handle} · ${dayOf(r.created_at)}`);
          if (r.note) li.append(el('span', 'review-report__note', r.note));
          list.appendChild(li);
        }
        parts.push(list);
      }
    } else if (p.reports > 0) {
      parts.push(el('p', 'review-card__reports', `${p.reports} open report${p.reports === 1 ? '' : 's'}`));
    }
    const actions = el('div', 'card__actions review-card__actions');
    const open = el('a', 'card__action review-open', 'Open');
    open.href = href;
    actions.appendChild(open);
    if (this.own) {
      parts.push(el('p', 'muted review-card__own', 'Your own work: another reviewer decides.'));
    } else {
      // The Reports tab is about the reports: Hide…, Dismiss, Unhide, and
      // Reject… for pending work; Approve is the Queue's. The Gallery tab
      // hides and unhides.
      const offered = allowedActions(p.shared, this.openReports).filter((a) =>
        this.ctx.tab === 'gallery' ? a === 'hide' || a === 'unhide' : !(this.reports && a === 'approve'),
      );
      for (const action of offered) {
        const b = button(ACTION_LABEL[action], 'card__action review-action');
        b.dataset.action = action;
        b.disabled = this.busy;
        b.addEventListener('click', () => void this.act(action));
        actions.appendChild(b);
      }
    }
    parts.push(actions, this.say);
    this.body.replaceChildren(...parts);
  }

  private get openReports(): number {
    return this.reports ? this.reports.length : this.item.reports;
  }

  private clearReports(): void {
    this.item.reports = 0;
    if (this.reports) this.reports = [];
  }

  private async act(action: ReviewAction): Promise<void> {
    if (this.busy) return;
    const p = this.item;
    let reason: string | undefined;
    if (action === 'reject' || action === 'hide') {
      const given = await askReason(action, p.title, p.author?.handle ?? null);
      if (given === null) return;
      reason = given;
    }
    this.busy = true;
    this.draw();
    this.note('note', 'Working…');
    const outcome = await sendReview(p.id, action, reason);
    this.busy = false;
    if (outcome.ok) {
      const a = outcome.answer;
      p.shared = a.shared;
      p.shared_at = a.shared_at;
      p.review_reason = a.review_reason;
      // Every action but Approve closes the open reports.
      if (action !== 'approve') this.clearReports();
      this.draw();
      this.note('note', doneText(action, p.author?.handle ?? null));
      return;
    }
    if (outcome.shared) p.shared = outcome.shared;
    if (outcome.noReports || outcome.gone) this.clearReports();
    this.draw();
    this.note('error', outcome.text);
    if (outcome.signedOut) {
      this.say.append(' ', signInButton('account-linkbtn', (ok) => (ok ? void this.act(action) : undefined)));
    }
  }

  private note(tone: 'note' | 'error', text: string): void {
    this.say.dataset.tone = tone;
    this.say.textContent = text;
  }
}
