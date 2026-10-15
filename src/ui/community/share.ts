import { AuthExpiredError, type ProjectSummary } from '../../admin/api';
import { AccountError, inWait, shareProject, type SharedState, type ShareStatus } from '../../net/account';
import { LEGAL, button, el, legalLink } from '../account/parts';

/**
 * Share to Community on a My projects card (docs/accounts.md §13). A model
 * or a timelapse has the switch; a scene or an armature, which the viewer
 * does not play, says to publish a model of it instead.
 *
 * The switch is on while the project is shared in any way (pending,
 * public, hidden), and the line under it says where it stands:
 *
 * - Pending review: sent, waiting for a reviewer.
 * - Public · Community: approved, listed, with a link to it in the viewer.
 * - Rejected: <reason>, with Share again (the switch is off).
 * - Hidden, under review: a reviewer hid it, or two members reported it.
 *   It cannot be shared again until a reviewer has acted; it can be
 *   withdrawn.
 *
 * Withdraw takes it out at once from any of those. The first share on a
 * device (for an account) shows a note first: what is shown, that the
 * files stay the member's and nothing is downloadable, the content policy,
 * and that reviewers may reject or hide it.
 *
 * Hooks for tests: `.card__share[data-shared]`, `.card__share-switch
 * input`, `.card__share-status`, `.card__share-again`,
 * `.card__share-withdraw`, `.card__share-hint`, and the note's
 * `.share-note-overlay`, `.share-note-continue`, `.share-note-cancel`.
 */

export interface ShareContext {
  /** The account's id, to remember the first-share note by. */
  userId: string;
  /** The account's handle, as the note says it is shown. */
  handle: string;
  /** No connection: the controls show where it stands and change nothing. */
  offline: boolean;
  /** A refusal said on the page; a sign-in gone comes as one the page can mend. */
  failed: (what: string, err: unknown) => void;
}

/** Whether a project of this mode can be shared: what the viewer plays. */
export const shareable = (p: ProjectSummary): boolean => p.mode === 'model' || p.mode === 'timelapse';

/** The note's key, per account: shown once on this device for each. */
const noteKey = (userId: string): string => `bozzetto-share-note:${userId}`;

function noteSeen(userId: string): boolean {
  try {
    return localStorage.getItem(noteKey(userId)) === '1';
  } catch {
    return false;
  }
}

function markNoteSeen(userId: string): void {
  try {
    localStorage.setItem(noteKey(userId), '1');
  } catch {
    // Shown again next time, then: better than not at all.
  }
}

/** The card's share controls, or for a scene or an armature the hint where they would be. */
export function shareControls(p: ProjectSummary, ctx: ShareContext): HTMLElement {
  if (!shareable(p)) {
    const hint = el('p', 'muted card__share-hint', 'Publish a model of it to share it.');
    return hint;
  }
  const root = el('div', 'card__share');
  const label = el('label', 'card__vis card__share-switch');
  const box = el('input');
  box.type = 'checkbox';
  label.append(box, document.createTextNode('Share to Community'));
  const status = el('p', 'card__share-status');
  const again = button('Share again', 'card__action card__share-again');
  const withdraw = button('Withdraw', 'card__action card__share-withdraw');
  const row = el('div', 'card__share-actions');
  row.append(again, withdraw);
  root.append(label, status, row);

  const state = (): SharedState => p.shared ?? 'none';
  const empty = p.frameCount <= 0;
  let busy = false;

  const paint = (): void => {
    const s = state();
    root.dataset.shared = s;
    box.checked = s === 'pending' || s === 'public' || s === 'hidden';
    box.disabled = busy || ctx.offline || (empty && s === 'none');
    label.title = empty && s === 'none' ? 'It has no frames yet, so there is nothing to show.' : '';
    status.replaceChildren();
    status.hidden = s === 'none';
    if (s === 'pending') status.textContent = 'Pending review';
    else if (s === 'public') {
      const a = el('a', 'card__share-link', 'Public · Community');
      a.href = `/?tl=${encodeURIComponent(p.id)}`;
      status.append(a);
    } else if (s === 'rejected') {
      status.textContent = p.review_reason ? `Rejected: ${p.review_reason}` : 'Rejected';
    } else if (s === 'hidden') {
      status.textContent = 'Hidden, under review';
      if (p.review_reason) status.title = p.review_reason;
    }
    again.hidden = s !== 'rejected';
    withdraw.hidden = s === 'none';
    again.disabled = busy || ctx.offline;
    withdraw.disabled = busy || ctx.offline;
  };

  const take = (row: ShareStatus): void => {
    p.shared = row.shared;
    p.shared_at = row.shared_at;
    p.review_reason = row.review_reason;
  };

  const go = async (on: boolean): Promise<void> => {
    if (busy) return;
    if (on && !noteSeen(ctx.userId)) {
      if (!(await firstShareNote(ctx.handle))) {
        paint();
        return;
      }
      markNoteSeen(ctx.userId);
    }
    if (!on && state() === 'public' && !confirm(`Withdraw "${p.title}" from the Community? It leaves at once.`)) {
      paint();
      return;
    }
    busy = true;
    paint();
    try {
      take(await shareProject(p.id, on));
    } catch (err) {
      // A hidden one turned away says where it stands: take that.
      if (err instanceof AccountError && err.code === 'wrong_state' && typeof err.body.shared === 'string') {
        p.shared = err.body.shared as SharedState;
      }
      ctx.failed(on ? `Could not share "${p.title}"` : `Could not withdraw "${p.title}"`, shareRefusal(err));
    } finally {
      busy = false;
      paint();
    }
  };

  box.addEventListener('change', () => void go(box.checked));
  again.addEventListener('click', () => void go(true));
  withdraw.addEventListener('click', () => void go(false));
  paint();
  return root;
}

/**
 * A share or withdrawal the server did not take, as the error the page
 * says: the sign-in gone stays itself (the page offers Sign in again);
 * the rest become plain sentences.
 */
function shareRefusal(err: unknown): unknown {
  if (!(err instanceof AccountError)) return err;
  const said = (text: string): Error => new Error(text);
  if (err.status === 401) return new AuthExpiredError('session');
  if (err.status === 400 && err.reason === 'mode') return said('only a model or a timelapse can be shared. Publish a model of it to share it');
  if (err.status === 409) {
    return said('it is hidden while a reviewer looks at it, and cannot be shared again until they have. You can withdraw it meanwhile');
  }
  if (err.status === 429) return said(`you have shared as many projects as a day allows. Try again ${inWait(err.retryAfter)}`);
  if (err.status === 404) return said('it is not there any more');
  return err;
}

/**
 * The first share's note: what sharing shows and means. Resolves true for
 * Continue, false for Cancel (or Escape, or a click beside it).
 */
function firstShareNote(handle: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el('div', 'install-overlay share-note-overlay');
    const card = el('div', 'install-card share-note');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Share to the Community');
    const list = el('ul', 'share-note__list');
    const item = (...parts: (string | Node)[]): void => {
      const li = el('li');
      li.append(...parts);
      list.appendChild(li);
    };
    item(`What is shown: its title, your handle (@${handle}), its pictures and the model itself, for anyone to look at and turn around in the viewer.`);
    item('It stays yours. The files stay in My projects, on your storage, and nothing of it can be downloaded or copied from the Community.');
    item('It must keep to the ', legalLink('content policy', LEGAL.content), '. Artistic nudity in figure work is fine; pornographic content is not.');
    item('A reviewer looks at it before anyone else sees it, and may turn it down, or hide it later, saying why. Changing it sends it back for review.');
    item('Withdraw takes it out of the Community at once, whenever you like.');
    const go = button('Continue', 'btn btn--primary share-note-continue');
    const cancel = button('Cancel', 'btn share-note-cancel');
    const actions = el('div', 'account-actions');
    actions.append(go, cancel);
    card.append(el('h2', '', 'Share to the Community'), list, actions);
    overlay.appendChild(card);
    const finish = (yes: boolean): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(yes);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(false);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    go.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    go.focus();
  });
}
