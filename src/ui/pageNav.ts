import { signOut, roleOf, type Role, type SignIn } from '../admin/api';
import { errorText, suspensionText } from '../net/account';
import { TopMenu, type MenuItem } from '../sculpt/ui/TopMenu';
import { TitleStrip, stripButton } from '../sculpt/ui/TitleStrip';
import { failNotice } from '../sculpt/ui/statusToast';
import { helpMenuItems } from '../help/menu';
import { installChip } from './InstallHint';
import { signInAgain, signOutChip } from './signIn';
import { accountMenuItems, reviewWaiting } from './account/menu';
import { chooseObj, startArmature, startSculpt } from './startWork';

/**
 * The one main menu of the pages (docs/ui-spec.md, section 5b): the title
 * strip the workspaces have, with the same height, look and behaviour.
 *
 * At the left File (New sculpt, New armature, Import OBJ…, what the gallery's
 * Create card offers), Go (Gallery, Community, My projects, Review with its
 * count, Owner tools: each only for whoever may see it, the page one is on
 * checked) and Help (the same three items as everywhere). In the middle the
 * page's name. At the right, for a guest, Install and Sign in as strip
 * buttons; signed in, the @handle menu (Account, Sign out). A suspended
 * account sees Suspended, which says why, and Sign out.
 *
 * `pageNav(current, name)` makes the strip at once, so the page does not
 * jump when the answer of who is signed in comes; `fill` draws what that
 * person sees. `again` hears a sign-in made from the strip, so the page can
 * draw itself again for whoever it is for now.
 *
 * Hooks for tests: `.bz-strip` (`body.bz-page`), `.bz-menuname` (File, Go,
 * Help), `.file-menu--go` with `.file-menu__item[data-page]`, `.bz-readout__name`,
 * `.bz-strip__btn` (Install, Sign in, Sign out, Suspended), `.account-menu__chip`.
 */
export type PageId = 'gallery' | 'community' | 'mine' | 'review' | 'owner' | 'account';

export interface PageNav {
  readonly root: HTMLElement;
  fill(signIn: SignIn | null, again: () => void): void;
  /** The page's name in the middle of the strip. */
  setName(name: string): void;
}

/** The strip last made, taken down before another is: a page draws itself again after a sign-in. */
let made: { strip: TitleStrip; menus: TopMenu[]; account: TopMenu | null } | null = null;

function takeDown(): void {
  if (!made) return;
  for (const m of made.menus) m.dispose();
  made.account?.dispose();
  made.strip.dispose();
  made = null;
}

/** The hotkey guide belongs to the viewer and the workspaces; on a page it is made when asked for. */
let guide: { toggle(): void } | null = null;
async function showGuide(): Promise<void> {
  if (!guide) {
    const { Help } = await import('./Help');
    guide = new Help({ button: false });
  }
  guide.toggle();
}

/** The same three Help items as everywhere; the guide opens as it can on a page. */
function helpItems(): MenuItem[] {
  const items = helpMenuItems();
  return items.map((item) => ('action' in item && item.label === 'Hotkeys' ? { ...item, action: () => showGuide() } : item));
}

export function pageNav(current: PageId | null, name: string): PageNav {
  takeDown();
  const strip = new TitleStrip({ page: true });
  strip.setReadout({ name });
  const mine = { strip, menus: [] as TopMenu[], account: null as TopMenu | null };
  made = mine;

  const file = new TopMenu(
    'File',
    [
      { label: 'New sculpt', action: () => startSculpt() },
      { label: 'New armature', action: () => startArmature() },
      { label: 'Import OBJ…', action: () => chooseObj() },
    ],
    'file-menu--file',
    strip.menus,
    true,
  );
  const go = new TopMenu('Go', goItems(current, null, null), 'file-menu--go', strip.menus, true);
  const help = new TopMenu(
    'Help',
    helpItems(),
    'file-menu--help',
    strip.menus,
    true,
  );
  mine.menus.push(file, go, help);
  /** What sits at the right besides the account menu, taken down and made again by `fill`. */
  let right: HTMLElement[] = [];

  const fill = (signIn: SignIn | null, again: () => void): void => {
    if (made !== mine) return; // another page drew itself since
    mine.account?.dispose();
    mine.account = null;
    for (const el of right) el.remove();
    right = [];
    const role: Role = signIn ? roleOf(signIn) : 'guest';
    const me = signIn?.me ?? null;
    let waiting: number | null = null;
    const paintGo = (): void => go.setItems(goItems(current, signIn, () => waiting));
    paintGo();
    if (me && (role === 'owner' || role === 'moderator')) {
      void reviewWaiting().then((w) => {
        if (made !== mine || !w) return;
        waiting = w.total;
        paintGo();
      });
    }
    const add = (el: HTMLElement): void => {
      strip.addAction(el);
      right.push(el);
    };
    if (!signIn) return;
    if (signIn.suspended) {
      const said = suspensionText(signIn.suspended.reason);
      const note = stripButton('Suspended');
      note.title = said;
      note.addEventListener('click', () => failNotice(said));
      const out = stripButton('Sign out');
      out.addEventListener('click', () => {
        out.disabled = true;
        void signOut().catch((err: unknown) => {
          out.disabled = false;
          failNotice(`Could not sign out: ${errorText(err)}`);
        });
      });
      add(note);
      add(out);
      return;
    }
    if (!me) {
      // The owner has the app installed (owner call); an expired sign-in is a guest's, told once.
      if (role !== 'expired' && role !== 'owner') {
        const install = installChip();
        if (install) add(install);
      }
      if (signIn.accounts) {
        const button = stripButton('Sign in');
        button.addEventListener('click', () => {
          button.disabled = true;
          void signInAgain()
            .then((ok) => {
              if (ok) again();
            })
            .finally(() => {
              button.disabled = false;
            });
        });
        add(button);
      } else if (role !== 'owner' && current === 'gallery') {
        // Accounts off: the owner's way in is the editor's own sign-in.
        const login = document.createElement('a');
        login.className = 'bz-strip__btn';
        login.textContent = 'Log in';
        login.href = '/admin/';
        add(login);
      }
      // The owner tools are behind Access, whose session ends here too.
      if (role === 'owner' || current === 'owner') add(signOutChip());
      return;
    }
    mine.account = new TopMenu(`@${me.handle}`, accountMenuItems(), 'account-menu', strip.accountSlot, true);
  };
  fill(null, () => undefined);
  return {
    root: strip.el,
    fill,
    setName: (n) => strip.setReadout({ name: n }),
  };
}

/** Go: the places this person may go to, the one they are at checked. */
function goItems(current: PageId | null, signIn: SignIn | null, waiting: (() => number | null) | null): MenuItem[] {
  const role: Role = signIn ? roleOf(signIn) : 'guest';
  const me = signIn?.me ?? null;
  const place = (page: PageId, label: string | (() => string), href: string): MenuItem => ({
    label,
    current: () => page === current,
    action: () => {
      if (page !== current) window.location.assign(href);
    },
  });
  const items: MenuItem[] = [place('gallery', 'Gallery', '/')];
  if (signIn?.accounts) items.push(place('community', 'Community', '/?community'));
  if (me && !signIn?.suspended) items.push(place('mine', 'My projects', '/?me'));
  if (me && (role === 'owner' || role === 'moderator')) {
    items.push(place('review', () => (waiting?.() ? `Review (${waiting()})` : 'Review'), '/?review'));
  }
  // The owner's tools are the owner's; /admin/ itself is behind Access, so
  // it is always the owner who is on it.
  if (role === 'owner' || current === 'owner') items.push(place('owner', 'Owner tools', '/admin/'));
  return items;
}
