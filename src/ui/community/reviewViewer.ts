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

/**
 * The viewer in review mode (`/?tl=<id>&review=1`, docs/accounts.md §13),
 * for the owner and moderators: a shared project in whatever state it is,
 * read through the reviewers' own route, with the reviewer's controls in
 * the viewer's title strip - Close goes back to the Review tab it was
 * opened from (`&from=`; File > Close, hint "Back to Review"), the readout
 * names the author and says where the project stands ("Reviewing Pending
 * review"), and Approve, Reject…, Hide…, Unhide or Dismiss, as that state
 * allows, are the items of the Moderation menu. Each action redraws them
 * from the server's answer. On a moderator's own work
 * the readout says another reviewer decides, and nothing is offered; the
 * owner reviews everything, their own work included.
 *
 * Hooks for tests: `.viewer-author`, `.review-mode` (`data-shared`), and
 * the Moderation menu's rows (`.file-menu--moderation`).
 */
export async function mountReviewBar(
  id: string,
  project: { title: string; author: string | null; shared: SharedState },
  frame: ViewerFrame,
): Promise<void> {
  const from = reviewTabOf(new URLSearchParams(window.location.search).get('from'));
  // File > Close, here, is the way back to the Review page.
  frame.setOrigin({ href: reviewTabHref(from), hint: 'Back to Review', from: '' });
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
    if (own) {
      note.item.hidden = false;
      note.val.textContent = 'Your own: another reviewer decides';
      frame.setModeration([]);
      return;
    }
    frame.setModeration(
      allowedActions(shared, open).map((action) => ({
        label: ACTION_LABEL[action],
        enabled: () => !busy,
        action: () => act(action),
      })),
    );
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
