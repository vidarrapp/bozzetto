import {
  AccountError,
  REPORT_NOTE_MAX,
  accountsOn,
  errorText,
  getMe,
  inWait,
  reportProject,
  type ReportReason,
} from '../../net/account';
import { authorHref } from '../../net/community';
import { topChip, topbarLeft } from '../topbar';
import { signInButton } from '../signIn';
import { LEGAL, button, el, legalLink } from '../account/parts';
import { REPORT_REASON_LABELS } from './reviewActions';

/**
 * The viewer's word on a member's work from the Community
 * (docs/accounts.md §13): "by @handle" in the top row, beside ← Gallery,
 * which leads to the author's page (the Render panel says it under the
 * title too), and Report… for a member signed in who is not the author.
 * A guest gets nothing to click: the terms name the address to write to.
 * An active owner or moderator also gets a Review chip beside the credit,
 * which opens the same work in review mode (`&review=1&from=gallery`).
 * Nothing here copies or downloads anything; the viewer offers neither.
 *
 * Hooks for tests: `.viewer-author`, `.viewer-review`, `.viewer-report` (`data-reported`
 * once sent), and the dialog's `.report-overlay`, `select[name=reason]`,
 * `textarea[name=note]`, `.report-send`, `.report-say`.
 */
export async function mountCommunityCredit(id: string, author: string): Promise<void> {
  const left = topbarLeft();
  left.querySelectorAll('.viewer-author, .viewer-review, .viewer-report').forEach((c) => c.remove());
  const by = topChip(`by @${author}`, authorHref(author));
  by.classList.add('viewer-author');
  left.appendChild(by);

  if (!(await accountsOn().catch(() => false))) return;
  // Signed in, active, and not the author: anyone else has no Report.
  const me = await getMe().catch(() => null);
  if (!me || me.status !== 'active') return;
  if (me.role === 'owner' || me.role === 'moderator') {
    const review = topChip('Review', `/?tl=${encodeURIComponent(id)}&review=1&from=gallery`);
    review.classList.add('viewer-review');
    review.title = 'Open it in review mode';
    by.after(review);
  }
  if (me.handle.toLowerCase() === author.toLowerCase()) return;
  const report = topChip('Report…') as HTMLButtonElement;
  report.classList.add('viewer-report');
  report.addEventListener('click', () => openReport(id, author, report));
  left.appendChild(report);
}

/** Report…: the reason, an optional note, what happens next, and Send. */
function openReport(id: string, author: string, chip: HTMLButtonElement): void {
  const overlay = el('div', 'install-overlay report-overlay');
  const card = el('form', 'install-card report-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Report this work');
  card.noValidate = true;
  const close = button('×', 'install-close');
  close.setAttribute('aria-label', 'Close');

  const reason = el('select', 'account-input report-reason');
  reason.name = 'reason';
  for (const [value, label] of REPORT_REASON_LABELS) {
    const o = el('option', '', label);
    o.value = value;
    reason.appendChild(o);
  }
  // Nothing that accuses is picked beforehand.
  reason.value = 'other';
  const reasonField = el('label', 'account-field');
  reasonField.append(el('span', 'account-field__label', 'What is wrong with it'), reason);

  const note = el('textarea', 'account-input report-note');
  note.name = 'note';
  note.rows = 3;
  note.maxLength = REPORT_NOTE_MAX;
  note.placeholder = 'Anything a reviewer should know';
  const noteField = el('label', 'account-field');
  noteField.append(el('span', 'account-field__label', `A note, if you like (up to ${REPORT_NOTE_MAX} characters)`), note);

  const what = el('p', 'report-what');
  what.append(
    'A reviewer looks at every report; two reports hide the work until then. ',
    `@${author} is not told who reported it. See the `,
    legalLink('content policy', LEGAL.content),
    '.',
  );
  const say = el('p', 'account-say report-say');
  say.setAttribute('role', 'status');
  const send = button('Send', 'btn btn--primary report-send');
  send.type = 'submit';
  const cancel = button('Cancel', 'btn report-cancel');
  const actions = el('div', 'account-actions');
  actions.append(send, cancel);

  card.append(close, el('h2', '', 'Report this work'), reasonField, noteField, what, actions, say);
  overlay.appendChild(card);

  const done = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    chip.focus();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') done();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) done();
  });
  close.addEventListener('click', done);
  cancel.addEventListener('click', done);
  document.addEventListener('keydown', onKey);

  /** Sent, now or before: the dialog says so, and the chip stays down. */
  const finished = (text: string): void => {
    chip.textContent = 'Reported';
    chip.disabled = true;
    chip.dataset.reported = 'true';
    say.dataset.tone = 'note';
    say.textContent = text;
    reason.disabled = true;
    note.disabled = true;
    send.remove();
    cancel.textContent = 'Close';
  };

  card.addEventListener('submit', (e) => {
    e.preventDefault();
    if (send.disabled) return;
    send.disabled = true;
    say.dataset.tone = 'note';
    say.textContent = 'Sending…';
    void reportProject(id, reason.value as ReportReason, note.value)
      .then((made) => {
        finished(made === 'sent' ? 'Thank you. A reviewer will look at it.' : 'You already reported this.');
      })
      .catch((err: unknown) => {
        send.disabled = false;
        say.dataset.tone = 'error';
        say.replaceChildren(reportRefusal(err));
        if (err instanceof AccountError && err.status === 401) {
          say.append(' ', signInButton('account-linkbtn', (ok) => (ok ? send.click() : undefined), 'Sign in again', 'session'));
        }
      });
  });

  document.body.appendChild(overlay);
  reason.focus();
}

/** A report the server did not take, as a sentence. */
function reportRefusal(err: unknown): string {
  if (!(err instanceof AccountError)) return errorText(err);
  if (err.status === 429) return `You have sent as many reports as a day allows. Try again ${inWait(err.retryAfter)}.`;
  if (err.status === 404) return 'This work is no longer in the Community, so there is nothing to report.';
  if (err.status === 401) return 'Your sign-in has expired.';
  if (err.status === 400 && err.reason === 'own') return 'This is your own work.';
  if (err.status === 400 && err.reason === 'note') return `A note can be at most ${REPORT_NOTE_MAX} characters.`;
  if (err.status === 400) return 'Pick what is wrong with it.';
  return err.message;
}
