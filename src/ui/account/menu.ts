import { checkSignIn, signOut } from '../../admin/api';
import { errorText, reviewCounts } from '../../net/account';
import { TopMenu, type MenuItem } from '../../sculpt/ui/TopMenu';
import type { TitleStrip } from '../../sculpt/ui/TitleStrip';
import { failNotice } from '../../sculpt/ui/statusToast';

/**
 * The account's @handle menu (docs/accounts.md §7): Account and Sign out.
 * It stands at the right end of every title strip when someone is signed
 * in, on the pages (ui/pageNav) and in every workspace and the viewer
 * (`mountAccountHandle`), in the strip's own place for it, before the hide
 * button; Star, Publish, Save and Not saved stay to its left.
 */

/** What the @handle menu holds. */
export function accountMenuItems(): MenuItem[] {
  return [
    { label: 'Account', action: () => window.location.assign('/?account') },
    {
      label: 'Sign out',
      action: async () => {
        try {
          await signOut();
        } catch (err) {
          failNotice(`Could not sign out: ${errorText(err)}`);
        }
      },
    },
  ];
}

/**
 * Put the @handle menu at the right of a workspace's or the viewer's strip,
 * once it is known who is signed in. A guest, and a page where nothing
 * answers, get nothing: the strip is as it was.
 */
export function mountAccountHandle(strip: TitleStrip): void {
  void checkSignIn()
    .then((signIn) => {
      const me = signIn.me;
      if (!me || !strip.el.isConnected) return;
      strip.adopt(new TopMenu(`@${me.handle}`, accountMenuItems(), 'account-menu', strip.accountSlot, true));
    })
    .catch(() => {
      // No answer to be had: no handle.
    });
}

/**
 * How many projects wait for review (docs/accounts.md §13), for the owner
 * and moderators: pending review plus open reports (GET /api/mod/counts).
 * Asked once as a page draws, never polled; nothing waiting, or no answer,
 * is null.
 */
export async function reviewWaiting(): Promise<{ pending: number; reports: number; total: number } | null> {
  try {
    const { pending, reports } = await reviewCounts();
    const total = pending + reports;
    return total > 0 ? { pending, reports, total } : null;
  } catch {
    return null;
  }
}
