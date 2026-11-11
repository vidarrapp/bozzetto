import { getMe, reviewReports, type ReviewAction, type SharedState } from '../../net/account';
import { statusToast } from '../../sculpt/ui/statusToast';
import type { ViewerFrame } from '../../viewer/viewerFrame';
import { signInButton } from '../signIn';
import {
  ACTION_LABEL,
  STATE_LABEL,
  allowedActions,
  askReason,
  doneText,
  mayReview,
  reviewTabHref,
  reviewTabOf,
  sendReview,
} from './reviewActions';

/** The decisive action of a state is filled: the main one orange, the one that takes the work down red. */
const FILL: Partial<Record<ReviewAction, 'primary' | 'danger'>> = { approve: 'primary', unhide: 'primary', hide: 'danger' };

/**
 * The viewer in review mode (`/?tl=<id>&review=1`, docs/accounts.md §13),
 * for the owner and moderators: a shared project in whatever state it is,
 * read through the reviewers' own route, with the reviewer's controls in
 * the viewer's title strip - Close goes back to the Review tab it was
 * opened from (`&from=`), the readout names the author and says where the
 * project stands ("Reviewing Pending review"), and Approve, Reject…, Hide…,
 * Unhide or Dismiss, as that state allows, stand at the right of the strip:
 * the decisive one filled (Approve and Unhide orange, Hide red). Each
 * action redraws them from the server's answer. On a moderator's own work
 * the readout says another reviewer decides, and nothing is offered; the
 * owner reviews everything, their own work included.
 *
 * Hooks for tests: `.review-back`, `.viewer-author`, `.review-mode`
 * (`data-shared`), `.review-action[data-action]`.
 */
export async function mountReviewBar(
  id: string,
  project: { title: string; author: string | null; shared: SharedState },
  frame: ViewerFrame,
): Promise<void> {
  // Approve (or Unhide) is the screen's main action here, so play steps back to grey.
  document.body.classList.add('bz-reviewing');
  const from = reviewTabOf(new URLSearchParams(window.location.search).get('from'));
  // Close, here, is the way back to the Review page.
  frame.close.href = reviewTabHref(from);
  frame.close.classList.add('review-back');
  frame.close.title = 'Back to the review page';
  const author = project.author;
  // The state and the reviewer's note, at the end of the readout.
  const readout = frame.strip.readoutEl;
  const pair = (cls: string, key: string): { item: HTMLElement; val: HTMLElement } => {
    const item = document.createElement('span');
    item.className = `bz-readout__item ${cls}`;
    const val = document.createElement('b');
    val.className = 'bz-readout__val';
    const k = document.createElement('span');
    k.className = 'bz-readout__key';
    k.textContent = key;
    item.append(k, val);
    readout.appendChild(item);
    return { item, val };
  };
  const chip = pair('review-mode', 'Reviewing');
  chip.item.setAttribute('role', 'status');
  const note = pair('review-own', '');
  note.item.hidden = true;

  const [me, reports] = await Promise.all([getMe().catch(() => null), reviewReports().catch(() => null)]);
  // A moderator's own work: another reviewer decides. The owner reviews everything.
  const own = !!me && !mayReview(me, author);
  let shared = project.shared;
  let open = reports?.items.find((r) => r.project.id === id)?.reports.length ?? 0;
  let busy = false;

  const draw = (): void => {
    chip.item.dataset.shared = shared;
    chip.val.textContent = `${STATE_LABEL[shared]}${open ? ` · ${open} report${open === 1 ? '' : 's'}` : ''}`;
    document.querySelectorAll('.bz-strip .review-action').forEach((c) => c.remove());
    if (own) {
      note.item.hidden = false;
      note.val.textContent = 'Your own: another reviewer decides';
      return;
    }
    for (const action of allowedActions(shared, open)) {
      const b = frame.control(ACTION_LABEL[action], undefined, FILL[action]) as HTMLButtonElement;
      b.classList.add('review-action');
      b.dataset.action = action;
      b.disabled = busy;
      b.addEventListener('click', () => void act(action));
      frame.addAction(b);
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
