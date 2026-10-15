import { getMe, reviewReports, type ReviewAction, type SharedState } from '../../net/account';
import { authorHref } from '../../net/community';
import { statusToast } from '../../sculpt/ui/statusToast';
import { topChip, topbarLeft } from '../topbar';
import { signInButton } from '../signIn';
import {
  ACTION_LABEL,
  STATE_LABEL,
  allowedActions,
  askReason,
  doneText,
  reviewTabHref,
  reviewTabOf,
  sendReview,
} from './reviewActions';

/**
 * The viewer in review mode (`/?tl=<id>&review=1`, docs/accounts.md §13),
 * for the owner and moderators: a shared project in whatever state it is,
 * read through the reviewers' own route, with the reviewer's controls in
 * the top row - ← Review (to the tab it was opened from, `&from=`), the
 * author's credit, a Reviewing chip saying where the project stands, and
 * Approve, Reject…, Hide…, Unhide or Dismiss as that state allows. Each
 * action redraws the row from the server's answer. On one's own work the
 * row says another reviewer decides, and offers nothing.
 *
 * Hooks for tests: `.review-back`, `.viewer-author`, `.review-mode`
 * (`data-shared`), `.review-action[data-action]`.
 */
export async function mountReviewBar(id: string, project: { title: string; author: string | null; shared: SharedState }): Promise<void> {
  const from = reviewTabOf(new URLSearchParams(window.location.search).get('from'));
  const left = topbarLeft();
  left.querySelectorAll('.viewer-back, .review-back, .viewer-author, .review-mode, .review-action, .review-own').forEach((c) => c.remove());
  const back = topChip('← Review', reviewTabHref(from));
  back.classList.add('viewer-back', 'review-back');
  left.appendChild(back);
  const author = project.author;
  if (author) {
    const by = topChip(`by @${author}`, authorHref(author));
    by.classList.add('viewer-author');
    left.appendChild(by);
  }
  const chip = document.createElement('span');
  chip.className = 'topchip topchip--accent review-mode';
  chip.setAttribute('role', 'status');
  left.appendChild(chip);

  const [me, reports] = await Promise.all([getMe().catch(() => null), reviewReports().catch(() => null)]);
  const own = !!me && !!author && me.handle.toLowerCase() === author.toLowerCase();
  let shared = project.shared;
  let open = reports?.items.find((r) => r.project.id === id)?.reports.length ?? 0;
  let busy = false;

  const draw = (): void => {
    chip.dataset.shared = shared;
    chip.textContent = `Reviewing · ${STATE_LABEL[shared]}${open ? ` · ${open} report${open === 1 ? '' : 's'}` : ''}`;
    left.querySelectorAll('.review-action, .review-own').forEach((c) => c.remove());
    if (own) {
      const note = document.createElement('span');
      note.className = 'topchip review-own';
      note.textContent = 'Your own: another reviewer decides';
      left.appendChild(note);
      return;
    }
    for (const action of allowedActions(shared, open)) {
      const b = topChip(ACTION_LABEL[action]) as HTMLButtonElement;
      b.classList.add('review-action');
      b.dataset.action = action;
      b.disabled = busy;
      b.addEventListener('click', () => void act(action));
      left.appendChild(b);
    }
  };

  const act = async (action: ReviewAction): Promise<void> => {
    if (busy) return;
    let reason: string | undefined;
    if (action === 'reject' || action === 'hide') {
      const given = await askReason(action, project.title, author);
      if (given === null) return;
      reason = given;
    }
    busy = true;
    draw();
    const toast = statusToast('Working…');
    const outcome = await sendReview(id, action, reason);
    busy = false;
    if (outcome.ok) {
      shared = outcome.answer.shared;
      if (action !== 'approve') open = 0;
      draw();
      toast.done(doneText(action, author));
      return;
    }
    if (outcome.shared) shared = outcome.shared;
    if (outcome.noReports || outcome.gone) open = 0;
    draw();
    toast.fail(outcome.text, outcome.signedOut ? signInButton('', (ok) => (ok ? void act(action) : undefined)) : undefined);
  };

  draw();
}
