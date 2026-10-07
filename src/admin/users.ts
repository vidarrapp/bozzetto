import { ApiError, ownerCall } from './api';
import { asOwner, failureSentence, ownerSignInPanel } from './ownerSession';
import { dayOf, momentOf, sizeOfText, sizeText } from '../net/account';
import { Say, button, el } from '../ui/account/parts';

/**
 * The Users tab (docs/accounts.md §8): the accounts, newest first, 50 a
 * page, each with its handle, address, role, status, dates, storage (what
 * it stores and what its uploads in progress hold, against its quota, as a
 * bar) and how many projects it has; deletions left waiting over a day
 * flagged at the top. Manage opens an account: its passkeys and good
 * sessions counted, and what can be done to it from where it stands -
 * suspend (a reason, mailed to its holder) or lift it, sign it out
 * everywhere, its quota in MiB, its storage counted again, and a deletion
 * it began carried to its end. The owner's own account is never suspended,
 * signed out or deleted from here (the server refuses: 409 owner); an
 * action its status has moved past is refused too (409 wrong_status), and
 * the account is drawn again as it now is.
 */

export type UserStatus = 'active' | 'suspended' | 'deleting';

/** An account as the owner's list shows it (functions/_shared/users.ts UserView). */
export interface UserView {
  id: string;
  handle: string;
  email: string;
  role: 'owner' | 'moderator' | 'member';
  status: UserStatus;
  createdAt: number;
  /** When any of its sessions was last seen; null if it never had one. */
  lastSeenAt: number | null;
  bytesUsed: number;
  /** What its uploads in progress hold. */
  reserved: number;
  quotaBytes: number;
  projects: number;
  /** When its deletion began, while it is being deleted. */
  deletingSince: number | null;
  suspendedReason: string | null;
}

/** One account (GET /admin/api/users/:id): the list's fields, its passkeys and its good sessions counted. */
export interface UserDetail extends UserView {
  passkeys: number;
  sessions: number;
}

/** A suspension's reason, in characters (functions/_shared/users.ts MAX_REASON). */
export const MAX_REASON = 500;
/** A quota, in MiB: up to 100 GiB (MAX_QUOTA_MIB). */
export const MAX_QUOTA_MIB = 102_400;

const MiB = 1024 * 1024;
const ROOT = '/admin/api/users';
const one = (id: string, action = ''): string => `${ROOT}/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

export const usersApi = {
  page: (cursor?: string | null) =>
    ownerCall<{ users: UserView[]; next: string | null; pendingDeletions: number }>(
      cursor ? `${ROOT}?cursor=${encodeURIComponent(cursor)}` : ROOT,
    ),
  get: (id: string) => ownerCall<UserDetail>(one(id)),
  suspend: (id: string, reason: string) => ownerCall<UserDetail>(one(id, 'suspend'), 'POST', { reason }),
  unsuspend: (id: string) => ownerCall<UserDetail>(one(id, 'unsuspend'), 'POST'),
  revokeSessions: (id: string) => ownerCall<{ revoked: number }>(one(id, 'revoke-sessions'), 'POST'),
  setQuota: (id: string, quotaMiB: number) => ownerCall<UserDetail>(one(id, 'quota'), 'PUT', { quotaMiB }),
  recount: (id: string) => ownerCall<{ bytesUsed: number; before: number }>(one(id, 'recount'), 'POST'),
  finishDeletion: (id: string) => ownerCall<{ done: boolean; remaining: number }>(one(id, 'finish-deletion'), 'POST'),
};

const STATUS_WORDS: Record<UserStatus, string> = { active: 'active', suspended: 'suspended', deleting: 'being deleted' };

const plural = (n: number, word: string): string => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`;

/** A refusal from the account routes, about `who`, as a sentence. */
function refusalText(err: unknown, who: string): string {
  if (err instanceof ApiError) {
    const reason = typeof err.body.reason === 'string' ? err.body.reason : '';
    switch (err.code) {
      case 'owner':
        return 'That is your own account: the owner tools do not suspend it, sign it out everywhere or delete it.';
      case 'wrong_status': {
        const status = err.body.status as UserStatus | undefined;
        return `${who} is ${status && STATUS_WORDS[status] ? STATUS_WORDS[status] : 'not as it was'} now, so that cannot be done. It is shown as it is now.`;
      }
      case 'bad_request':
        if (reason === 'reason') return `Give a reason of up to ${MAX_REASON} characters: it is mailed to them.`;
        if (reason === 'quotaMiB') return `A quota is a whole number of MiB from 1 to ${MAX_QUOTA_MIB.toLocaleString('en-GB')}.`;
        break;
      case 'not_found':
        return `${who} is not there any more.`;
      case 'accounts_off':
        return 'Accounts are off on this site.';
      default:
        break;
    }
  }
  return failureSentence(err);
}

/** A deletion left waiting longer than this is flagged (functions/_shared/users.ts DELETION_OVERDUE). */
const OVERDUE_MS = 24 * 60 * 60 * 1000;

/** The tab's state: the list, where it goes on, and the deletions left waiting. */
interface Page {
  list: HTMLElement;
  more: HTMLButtonElement;
  notice: HTMLElement;
  next: string | null;
  pending: number;
}

/** The notice at the top: deletions begun over a day ago and not finished (pendingDeletions). */
function sayPending(page: Page): void {
  const n = page.pending;
  page.notice.hidden = n === 0;
  page.notice.textContent =
    n === 0
      ? ''
      : `${n === 1 ? 'One account has' : `${plural(n, 'account')} have`} been waiting over a day for ${n === 1 ? 'its deletion' : 'their deletions'} ` +
        `to finish. Finish deletion, under Manage, carries ${n === 1 ? 'it' : 'them'} on.`;
}

export async function renderUsers(host: HTMLElement): Promise<void> {
  const notice = el('p', 'admin__notice admin-users__pending');
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  const list = el('div', 'admin-list admin-users__list');
  const more = button('Load more', 'btn admin-users__more');
  more.hidden = true;
  host.replaceChildren(notice, list, more);
  const page: Page = { list, more, notice, next: null, pending: 0 };
  more.addEventListener('click', () => void load(page, true));
  await load(page, false);
}

/** The first page, or (`more`) the one after those drawn. */
async function load(page: Page, more: boolean): Promise<void> {
  if (!more) page.list.replaceChildren(el('p', 'muted', 'Loading…'));
  page.more.disabled = true;
  let got: Awaited<ReturnType<typeof usersApi.page>> | null;
  try {
    got = await asOwner(() => usersApi.page(more ? page.next : null), !more);
  } catch (err) {
    const line = el('p', 'muted', `The accounts could not be loaded. ${refusalText(err, 'That account')}`);
    if (more) page.list.appendChild(line);
    else page.list.replaceChildren(line);
    page.more.disabled = false;
    return;
  }
  page.more.disabled = false;
  if (!got) {
    // Not signed in: the first page waits behind the lock; a page more
    // leaves those drawn, and Load more asks again.
    if (more) page.list.appendChild(el('p', 'muted', 'No more were loaded: the owner tools need you signed in.'));
    else {
      page.list.replaceChildren(ownerSignInPanel(() => void load(page, false)));
      page.more.hidden = true;
    }
    return;
  }
  if (!more) page.list.replaceChildren();
  for (const u of got.users) page.list.appendChild(new Account(u, page).root);
  if (!more && !got.users.length) page.list.appendChild(el('p', 'admin__empty', 'No accounts yet.'));
  page.next = got.next;
  page.more.hidden = got.next === null;
  page.pending = got.pendingDeletions;
  sayPending(page);
}

/** One account: its row, and under it, once opened, what can be done to it. */
class Account {
  readonly root = el('div', 'admin-user');
  private readonly row = el('div', 'admin-row');
  private readonly title = el('span', 'admin-row__title');
  private readonly meta = el('span', 'admin-row__meta');
  private readonly bar = el('div', 'storage-meter admin-user__meter');
  private readonly used = el('span', 'storage-meter__used');
  private readonly reserved = el('span', 'storage-meter__reserved');
  private readonly usage = el('span', 'admin-row__meta admin-user__usage');
  private readonly manage = button('Manage', 'btn admin-user__manage');
  private readonly detail = el('div', 'admin-user__detail');
  private readonly say = new Say();
  private open = false;

  constructor(
    private user: UserView | UserDetail,
    private readonly page: Page,
  ) {
    this.root.dataset.user = user.id;
    const main = el('div', 'admin-row__main admin-user__main');
    this.bar.setAttribute('role', 'meter');
    this.bar.setAttribute('aria-label', 'Storage used');
    this.bar.append(this.used, this.reserved);
    main.append(this.title, this.meta, this.bar, this.usage);
    const actions = el('div', 'admin-row__actions');
    actions.appendChild(this.manage);
    this.row.append(main, actions);
    this.detail.hidden = true;
    this.root.append(this.row, this.detail);
    this.manage.setAttribute('aria-expanded', 'false');
    this.manage.addEventListener('click', () => void this.toggle());
    this.draw();
  }

  private get who(): string {
    return `@${this.user.handle}`;
  }

  /** The row, from what is known of the account now. */
  private draw(): void {
    const u = this.user;
    this.root.dataset.status = u.status;
    this.title.replaceChildren(`@${u.handle}`);
    if (u.role !== 'member') this.title.append(' ', el('span', 'badge admin-user__role', u.role));
    if (u.status !== 'active') this.title.append(' ', el('span', 'badge admin-user__status', STATUS_WORDS[u.status]));
    const seen = u.lastSeenAt === null ? 'never signed in' : `last seen ${momentOf(u.lastSeenAt)}`;
    this.meta.textContent = `${u.email} · joined ${dayOf(u.createdAt)} · ${seen} · ${plural(u.projects, 'project')}`;
    const quota = Math.max(1, u.quotaBytes);
    const usedPct = Math.min(100, (u.bytesUsed / quota) * 100);
    this.used.style.width = `${usedPct}%`;
    this.reserved.style.width = `${Math.min(100 - usedPct, (u.reserved / quota) * 100)}%`;
    let text = `${sizeOfText(u.bytesUsed, u.quotaBytes)} used`;
    if (u.reserved > 0) text += ` · ${sizeText(u.reserved)} held by uploads in progress`;
    this.usage.textContent = text;
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', String(u.quotaBytes));
    this.bar.setAttribute('aria-valuenow', String(Math.min(u.bytesUsed + u.reserved, u.quotaBytes)));
    this.bar.setAttribute('aria-valuetext', text);
  }

  private async toggle(): Promise<void> {
    this.open = !this.open;
    this.manage.setAttribute('aria-expanded', String(this.open));
    this.manage.textContent = this.open ? 'Close' : 'Manage';
    this.detail.hidden = !this.open;
    if (!this.open) return;
    this.say.clear();
    this.detail.replaceChildren(el('p', 'muted', 'Loading…'));
    await this.reload();
  }

  /** The account afresh from the server, and its panel drawn for where it now stands. */
  private async reload(said?: () => void): Promise<void> {
    let detail: UserDetail | null;
    try {
      detail = await asOwner(() => usersApi.get(this.user.id));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_found') {
        this.gone(`${this.who} is not there any more.`);
        return;
      }
      this.detail.replaceChildren(el('p', 'muted', `${this.who} could not be loaded. ${refusalText(err, this.who)}`));
      return;
    }
    if (!detail) {
      this.detail.replaceChildren(ownerSignInPanel(() => void this.reload()));
      return;
    }
    this.user = detail;
    this.draw();
    this.drawDetail(detail);
    said?.();
  }

  /** The account went (a deletion finished, or someone else's): its row says so and offers nothing. */
  private gone(text: string): void {
    this.root.dataset.status = 'gone';
    this.manage.hidden = true;
    this.detail.hidden = false;
    this.say.note(text);
    this.detail.replaceChildren(this.say.root);
  }

  private drawDetail(u: UserDetail): void {
    const facts = el(
      'p',
      'admin-row__meta admin-user__facts',
      `${plural(u.passkeys, 'passkey')} · ${u.sessions === 0 ? 'signed in nowhere' : `signed in on ${plural(u.sessions, 'session')}`} · ${u.id}`,
    );
    const parts: HTMLElement[] = [facts];
    if (u.status === 'suspended') {
      parts.push(el('p', 'admin-user__why', u.suspendedReason ? `Suspended: ${u.suspendedReason}` : 'Suspended.'));
    }
    if (u.status === 'deleting' && u.deletingSince !== null) {
      parts.push(el('p', 'admin-user__why', `Its deletion began ${momentOf(u.deletingSince)} and has not finished.`));
    }
    const own = u.role === 'owner';
    if (own) {
      parts.push(
        el('p', 'muted admin-user__own', 'Your own account: it is not suspended, signed out everywhere or deleted from here. Account signs it out everywhere.'),
      );
    }
    if (u.status === 'deleting') {
      if (!own) parts.push(this.finishDeletion());
    } else {
      if (u.status === 'active' && !own) parts.push(this.suspend());
      if (u.status === 'suspended') parts.push(this.unsuspend());
      const row = el('div', 'admin-user__actions');
      // A suspension signed it out everywhere already, and it signs in nowhere while it lasts.
      if (!own && u.status === 'active') row.appendChild(this.revokeSessions());
      row.append(...this.quota(u), this.recount());
      parts.push(row);
    }
    parts.push(this.say.root);
    this.detail.replaceChildren(...parts);
  }

  /**
   * One action, pressed: the buttons held while it runs, the second lock
   * mended in place, a refusal said - an account whose status moved on is
   * drawn again as it is now, with the sentence kept - and on success the
   * account drawn again with what `done` says.
   */
  private async act<T>(
    pressed: HTMLButtonElement,
    call: () => Promise<T>,
    done: (answer: T) => Promise<void> | void,
  ): Promise<void> {
    const buttons = [...this.detail.querySelectorAll('button')];
    buttons.forEach((b) => (b.disabled = true));
    this.say.note('Working…');
    try {
      const answer = await asOwner(call);
      if (answer === null) {
        this.say.error('Not done: the owner tools need you signed in.');
        return;
      }
      await done(answer);
    } catch (err) {
      const text = refusalText(err, this.who);
      if (err instanceof ApiError && err.code === 'wrong_status') {
        await this.reload(() => this.say.error(text));
        return;
      }
      if (err instanceof ApiError && err.code === 'not_found') {
        this.gone(text);
        return;
      }
      this.say.error(text);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
      pressed.blur();
    }
  }

  private suspend(): HTMLElement {
    const form = el('form', 'admin-user__suspend');
    form.noValidate = true;
    const reason = el('input', 'admin-user__reason');
    reason.name = 'reason';
    reason.maxLength = MAX_REASON;
    reason.placeholder = 'Why: mailed to them, and kept while it lasts';
    reason.autocomplete = 'off';
    reason.setAttribute('aria-label', 'Reason for suspending');
    const go = button('Suspend', 'btn btn--danger');
    go.type = 'submit';
    form.append(reason, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const why = reason.value.replace(/\s+/g, ' ').trim();
      if (!why) {
        this.say.error('Give a reason: it is mailed to them, and kept on the account while it is suspended.');
        reason.focus();
        return;
      }
      if (
        !confirm(
          `Suspend ${this.who}? They are signed out everywhere, their uploads in progress stop, and they are mailed the reason. ` +
            'Their work is kept, and nothing of theirs answers them until you lift it.',
        )
      ) {
        return;
      }
      void this.act(go, () => usersApi.suspend(this.user.id, why), async (u) => {
        this.user = u;
        this.draw();
        this.drawDetail(u);
        this.say.note(`${this.who} is suspended, and has been mailed the reason.`);
      });
    });
    return form;
  }

  private unsuspend(): HTMLElement {
    const go = button('Unsuspend', 'btn btn--primary admin-user__unsuspend');
    go.addEventListener('click', () => {
      void this.act(go, () => usersApi.unsuspend(this.user.id), (u) => {
        this.user = u;
        this.draw();
        this.drawDetail(u);
        this.say.note(`${this.who} is active again, and signs in afresh.`);
      });
    });
    const wrap = el('div', 'admin-user__actions');
    wrap.appendChild(go);
    return wrap;
  }

  private revokeSessions(): HTMLButtonElement {
    const go = button('Revoke sessions', 'btn admin-user__revoke');
    go.addEventListener('click', () => {
      if (!confirm(`Sign ${this.who} out everywhere? They can sign in again.`)) return;
      void this.act(go, () => usersApi.revokeSessions(this.user.id), async ({ revoked }) => {
        await this.reload(() =>
          this.say.note(revoked === 0 ? `${this.who} was signed in nowhere.` : `${this.who} is signed out of ${plural(revoked, 'session')}.`),
        );
      });
    });
    return go;
  }

  private quota(u: UserDetail): HTMLElement[] {
    const mib = el('input', 'admin-user__quota');
    mib.type = 'number';
    mib.name = 'quotaMiB';
    mib.min = '1';
    mib.max = String(MAX_QUOTA_MIB);
    mib.step = '1';
    mib.inputMode = 'numeric';
    mib.value = String(Math.max(1, Math.round(u.quotaBytes / MiB)));
    mib.setAttribute('aria-label', 'Quota in MiB');
    const label = el('label', 'admin-create__field admin-user__quotafield');
    label.append(el('span', 'muted', 'Quota (MiB)'), mib);
    const go = button('Set quota', 'btn admin-user__setquota');
    const send = (): void => {
      const n = /^\s*\d{1,6}\s*$/.test(mib.value) ? Number(mib.value) : NaN;
      if (!(n >= 1 && n <= MAX_QUOTA_MIB)) {
        this.say.error(`A quota is a whole number of MiB from 1 to ${MAX_QUOTA_MIB.toLocaleString('en-GB')}.`);
        mib.focus();
        return;
      }
      void this.act(go, () => usersApi.setQuota(this.user.id, n), (now) => {
        this.user = now;
        this.draw();
        this.drawDetail(now);
        const over = now.bytesUsed + now.reserved > now.quotaBytes;
        this.say.note(
          `${this.who}'s quota is ${sizeText(now.quotaBytes)}.${over ? ' That is less than they store: they keep it, and can add nothing until they are under it.' : ''}`,
        );
      });
    };
    go.addEventListener('click', send);
    mib.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
    return [label, go];
  }

  private recount(): HTMLButtonElement {
    const go = button('Recount', 'btn admin-user__recount');
    go.title = 'Count what the account stores again, from the files themselves';
    go.addEventListener('click', () => {
      void this.act(go, () => usersApi.recount(this.user.id), async ({ bytesUsed, before }) => {
        await this.reload(() =>
          this.say.note(
            bytesUsed === before
              ? `Counted again: ${sizeText(bytesUsed)}, as it said.`
              : `Counted again: ${sizeText(bytesUsed)}, where it said ${sizeText(before)}.`,
          ),
        );
      });
    });
    return go;
  }

  /**
   * Finish deletion: asked once, then carried on a request at a time - each
   * goes as far as one request may - until the server says done, saying
   * how far it is; then the account is gone.
   */
  private finishDeletion(): HTMLElement {
    const go = button('Finish deletion', 'btn btn--danger admin-user__finish');
    go.addEventListener('click', () => {
      if (!confirm(`Finish deleting ${this.who}? Everything of theirs still on the server goes, for good.`)) return;
      void this.act(go, async () => {
        for (let step = 0; step < 200; step++) {
          const progress = await usersApi.finishDeletion(this.user.id);
          if (progress.done) return progress;
          this.say.note(`Deleting… ${plural(progress.remaining, 'thing')} still to go.`);
        }
        throw new Error('It is taking longer than it should. Press Finish deletion again to carry on.');
      }, () => {
        this.gone(`${this.who} is deleted, with everything in it.`);
        // One the notice counted, as far as this clock can tell, is one fewer.
        const since = this.user.deletingSince;
        if (since !== null && Date.now() - since > OVERDUE_MS && this.page.pending > 0) {
          this.page.pending--;
          sayPending(this.page);
        }
      });
    });
    const wrap = el('div', 'admin-user__actions');
    wrap.appendChild(go);
    return wrap;
  }
}
