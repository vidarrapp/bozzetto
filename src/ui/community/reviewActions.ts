import {
  AccountError,
  REVIEW_REASON_MAX,
  errorText,
  reviewProject,
  type ReviewAction,
  type ReviewAnswer,
  type SharedState,
} from '../../net/account';
import { button, el } from '../account/parts';

/**
 * What the Review page's cards and the viewer's review mode share
 * (docs/accounts.md §13): which actions a project's state allows, the
 * reason dialog for Reject… and Hide…, and a review sent with its refusal
 * said as a sentence.
 */

/** Each action's button. */
export const ACTION_LABEL: Record<ReviewAction, string> = {
  approve: 'Approve',
  reject: 'Reject…',
  hide: 'Hide…',
  unhide: 'Unhide',
  dismiss: 'Dismiss',
};

/** Where a shared project stands, in words. */
export const STATE_LABEL: Record<SharedState, string> = {
  none: 'Not shared',
  pending: 'Pending review',
  public: 'Public',
  rejected: 'Rejected',
  hidden: 'Hidden',
};

/**
 * The actions a project's state allows, as the server's transitions do:
 * a pending one is approved or rejected, a public one hidden, a hidden one
 * unhidden, and open reports of a pending or public one dismissed.
 */
export function allowedActions(state: SharedState, reports: number): ReviewAction[] {
  const out: ReviewAction[] = [];
  if (state === 'pending') out.push('approve', 'reject');
  if (state === 'public') out.push('hide');
  if (state === 'hidden') out.push('unhide');
  if ((state === 'pending' || state === 'public') && reports > 0) out.push('dismiss');
  return out;
}

/** What is said once an action is done. */
export function doneText(action: ReviewAction, author: string | null): string {
  const who = author ? `@${author}` : 'The author';
  switch (action) {
    case 'approve':
      return 'Approved: it is in the Community now.';
    case 'reject':
      return `Rejected. ${who} is shown the reason.`;
    case 'hide':
      return `Hidden. ${who} is shown the reason.`;
    case 'unhide':
      return 'Unhidden: it is back in the Community.';
    case 'dismiss':
      return 'The reports are dismissed.';
  }
}

/** The outcome of a review sent: the project's new standing, or why not and what the server says it is now. */
export type ReviewOutcome =
  | { ok: true; answer: ReviewAnswer }
  | { ok: false; text: string; shared?: SharedState; noReports?: boolean; signedOut?: boolean; gone?: boolean };

/** Send a review; never throws. */
export async function sendReview(id: string, action: ReviewAction, reason?: string): Promise<ReviewOutcome> {
  try {
    return { ok: true, answer: await reviewProject(id, action, reason) };
  } catch (err) {
    if (!(err instanceof AccountError)) return { ok: false, text: errorText(err) };
    if (err.status === 409 && err.code === 'wrong_state') {
      const shared = typeof err.body.shared === 'string' ? (err.body.shared as SharedState) : undefined;
      return { ok: false, text: 'Someone else changed this; refreshed.', shared, noReports: err.body.reports === 0 };
    }
    if (err.status === 400 && err.reason === 'own') return { ok: false, text: 'You cannot review your own work.' };
    if (err.status === 400 && err.reason === 'reason') return { ok: false, text: `A reason is 1 to ${REVIEW_REASON_MAX} characters.` };
    if (err.status === 404) return { ok: false, text: 'It is no longer shared: its author withdrew or deleted it.', shared: 'none', gone: true };
    if (err.status === 401) return { ok: false, text: 'Your sign-in has expired.', signedOut: true };
    if (err.status === 403 && err.code === 'forbidden') return { ok: false, text: 'Only reviewers can do this, and this account is not one now.' };
    return { ok: false, text: err.message };
  }
}

/**
 * Reject… and Hide…: the reason the author is shown, 1 to 500 characters.
 * Resolves the reason, or null for Cancel (or Escape, or a click beside it).
 *
 * Hooks for tests: `.review-reason-overlay`, `textarea[name=reason]`,
 * `.review-reason-send`, `.review-reason-cancel`, `.review-reason-say`.
 */
export function askReason(action: 'reject' | 'hide', title: string, author: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const verb = action === 'reject' ? 'Reject' : 'Hide';
    const overlay = el('div', 'install-overlay review-reason-overlay');
    const card = el('form', 'install-card report-card review-reason');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', `${verb} “${title || 'Untitled'}”`);
    card.noValidate = true;
    const reason = el('textarea', 'account-input report-note');
    reason.name = 'reason';
    reason.rows = 3;
    reason.maxLength = REVIEW_REASON_MAX;
    reason.placeholder = action === 'reject' ? 'What would have to change' : 'Why it is hidden';
    const field = el('label', 'account-field');
    field.append(el('span', 'account-field__label', `The reason (up to ${REVIEW_REASON_MAX} characters)`), reason);
    const who = author ? `@${author}` : 'The author';
    const what = el(
      'p',
      'report-what',
      action === 'reject'
        ? `${who} is shown this on My projects, and may change the work and share it again.`
        : `It leaves the Community at once. ${who} is shown this on My projects; Unhide brings it back.`,
    );
    const say = el('p', 'account-say review-reason-say');
    say.setAttribute('role', 'status');
    const send = button(verb, 'btn btn--primary review-reason-send');
    send.type = 'submit';
    const cancel = button('Cancel', 'btn review-reason-cancel');
    const actions = el('div', 'account-actions');
    actions.append(send, cancel);
    card.append(el('h2', '', `${verb} “${title || 'Untitled'}”`), field, what, actions, say);
    overlay.appendChild(card);

    const finish = (value: string | null): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(null);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    cancel.addEventListener('click', () => finish(null));
    card.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = reason.value.replace(/\s+/g, ' ').trim();
      if (!text) {
        say.dataset.tone = 'error';
        say.textContent = `Give a reason: ${author ? `@${author}` : 'the author'} is shown it.`;
        reason.focus();
        return;
      }
      finish(text.slice(0, REVIEW_REASON_MAX));
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    reason.focus();
  });
}

/** Where the viewer opens a project for review, and the tab it goes back to. */
export const reviewViewerHref = (id: string, from: ReviewTab): string =>
  `/?tl=${encodeURIComponent(id)}&review=1${from === 'queue' ? '' : `&from=${from}`}`;

/** The Review page's tabs. */
export type ReviewTab = 'queue' | 'reports' | 'history';

export const REVIEW_TABS: [ReviewTab, string][] = [
  ['queue', 'Queue'],
  ['reports', 'Reports'],
  ['history', 'History'],
];

/** Where a tab is. */
export const reviewTabHref = (tab: ReviewTab): string => `/?review&tab=${tab}`;

/** A tab named in an address, or the queue. */
export function reviewTabOf(raw: string | null): ReviewTab {
  return raw === 'reports' || raw === 'history' ? raw : 'queue';
}
