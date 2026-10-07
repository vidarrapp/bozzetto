import { signOut, type Role, type SignIn } from '../../admin/api';
import { errorText, suspensionText } from '../../net/account';
import { isDesktop } from '../../net/origin';
import { TopMenu, type MenuItem } from '../../sculpt/ui/TopMenu';
import { failNotice } from '../../sculpt/ui/statusToast';
import { installChip } from '../InstallHint';
import { signInAgain } from '../signIn';
import { topChip, topbarRight } from '../topbar';

/**
 * The top row's account chips, with accounts on (docs/accounts.md §7). A
 * guest sees Sign in and Install; signed in, My projects and an @handle
 * menu (Account, Sign out); the owner also gets Owner tools. Someone whose
 * sign-in expired sees Sign in, as a guest does, and is told once why. A
 * suspended account sees Suspended, which says why, and Sign out, which
 * lets the device go back to being a guest's; no Sign in, which would not
 * lift it.
 *
 * `signedIn` hears a sign-in made from the chip, so the page can draw
 * itself again for whoever it is for now.
 *
 * In the desktop app, Sign in is its own sign-in window (ui/signIn
 * signInAgain), and signing out is Server settings' (where it signs in),
 * as with accounts off; and there is no Owner tools, since the desktop
 * build has no /admin/ (the owner's tools are the site's).
 */

/** The @handle menu last made, taken down before another is: the gallery draws itself again after a sign-in. */
let menu: TopMenu | null = null;

export function accountChips(signIn: SignIn, role: Role, signedIn: () => void): HTMLElement[] {
  menu?.dispose();
  menu = null;
  const me = signIn.me;
  if (signIn.suspended) {
    const said = suspensionText(signIn.suspended.reason);
    const chip = topChip('Suspended') as HTMLButtonElement;
    chip.title = said;
    chip.addEventListener('click', () => failNotice(said));
    if (isDesktop()) return [chip];
    const out = topChip('Sign out') as HTMLButtonElement;
    out.addEventListener('click', () => {
      out.disabled = true;
      void signOut().catch((err: unknown) => {
        out.disabled = false;
        failNotice(`Could not sign out: ${errorText(err)}`);
      });
    });
    return [chip, out];
  }
  if (!me) {
    const chips: HTMLElement[] = [];
    if (role !== 'expired') {
      const install = installChip();
      if (install) chips.push(install);
    }
    const chip = topChip('Sign in') as HTMLButtonElement;
    chip.addEventListener('click', () => {
      chip.disabled = true;
      void signInAgain()
        .then((ok) => {
          if (ok) signedIn();
        })
        .finally(() => {
          chip.disabled = false;
        });
    });
    chips.push(chip);
    return chips;
  }
  const chips: HTMLElement[] = [topChip('My projects', '/?me')];
  if (role === 'owner' && !isDesktop()) chips.push(topChip('Owner tools', '/admin/'));
  const items: MenuItem[] = [{ label: 'Account', action: () => window.location.assign('/?account') }];
  if (!isDesktop()) {
    items.push({
      label: 'Sign out',
      action: async () => {
        try {
          await signOut();
        } catch (err) {
          failNotice(`Could not sign out: ${errorText(err)}`);
        }
      },
    });
  }
  menu = new TopMenu(`@${me.handle}`, items, 'account-menu', topbarRight());
  chips.push(menu.chip);
  return chips;
}
