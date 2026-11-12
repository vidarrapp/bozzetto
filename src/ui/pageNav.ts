import { signOut, roleOf, type Role, type SignIn } from '../admin/api';
import { errorText, suspensionText } from '../net/account';
import { TopMenu, type MenuItem } from '../sculpt/ui/TopMenu';
import { failNotice } from '../sculpt/ui/statusToast';
import { installChip } from './InstallHint';
import { signInAgain, signOutChip } from './signIn';
import { topChip } from './topbar';
import { addReviewCount } from './account/menu';

/**
 * The one quiet navigation row at the top of the pages (docs/ui-foundations.md,
 * the pages' boards): the logotype at the left, then Gallery, Community,
 * My projects, Review and Owner tools, each only for the people who may see
 * it, and the account at the right. The page one is on is marked
 * (`aria-current="page"`, full text, weight 600). It replaces the corner
 * chips on these pages; the gallery, the viewer and the workspaces keep
 * theirs.
 *
 * `pageNav(current)` makes the row at once, so the page does not jump when
 * the answer of who is signed in comes; `fill` draws what that person sees.
 * `again` hears a sign-in made from the row, so the page can draw itself
 * again for whoever it is for now.
 *
 * Hooks for tests: `.pagenav`, `.pagenav__link[data-page]`,
 * `.pagenav__link[aria-current=page]`, `.review-chip` and
 * `.review-chip__count` on Review, `.pagenav__account` (the @handle menu's
 * chip is `.account-menu__chip`).
 */
export type PageId = 'gallery' | 'community' | 'mine' | 'review' | 'owner' | 'account';

export interface PageNav {
  readonly root: HTMLElement;
  fill(signIn: SignIn | null, again: () => void): void;
}

/** The @handle menu last made, taken down before another is: a page draws itself again after a sign-in. */
let menu: TopMenu | null = null;

function link(page: PageId, label: string, href: string, current: PageId | null): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'pagenav__link';
  a.dataset.page = page;
  a.href = href;
  a.textContent = label;
  if (page === current) a.setAttribute('aria-current', 'page');
  return a;
}

export function pageNav(current: PageId | null): PageNav {
  menu?.dispose();
  menu = null;
  const root = document.createElement('nav');
  root.className = 'pagenav';
  root.setAttribute('aria-label', 'Bozzetto');
  const logo = document.createElement('a');
  logo.className = 'pagenav__logo';
  logo.href = '/';
  logo.textContent = 'Bozzetto';
  const links = document.createElement('div');
  links.className = 'pagenav__links';
  links.appendChild(link('gallery', 'Gallery', '/', current));
  const account = document.createElement('div');
  account.className = 'pagenav__account';
  root.append(logo, links, account);

  const fill = (signIn: SignIn | null, again: () => void): void => {
    menu?.dispose();
    menu = null;
    const role: Role = signIn ? roleOf(signIn) : 'guest';
    const me = signIn?.me ?? null;
    const items: HTMLElement[] = [link('gallery', 'Gallery', '/', current)];
    if (signIn?.accounts) items.push(link('community', 'Community', '/?community', current));
    if (me && !signIn?.suspended) items.push(link('mine', 'My projects', '/?me', current));
    if (me && (role === 'owner' || role === 'moderator')) {
      const review = link('review', 'Review', '/?review', current);
      review.classList.add('review-chip');
      addReviewCount(review);
      items.push(review);
    }
    // The owner's tools are the owner's; /admin/ itself is behind Access, so
    // it is always the owner who is on it.
    if (role === 'owner' || current === 'owner') items.push(link('owner', 'Owner tools', '/admin/', current));
    links.replaceChildren(...items);
    account.replaceChildren();
    if (!signIn) return;
    if (signIn.suspended) {
      const said = suspensionText(signIn.suspended.reason);
      const chip = topChip('Suspended') as HTMLButtonElement;
      chip.title = said;
      chip.addEventListener('click', () => failNotice(said));
      const out = topChip('Sign out') as HTMLButtonElement;
      out.addEventListener('click', () => {
        out.disabled = true;
        void signOut().catch((err: unknown) => {
          out.disabled = false;
          failNotice(`Could not sign out: ${errorText(err)}`);
        });
      });
      account.append(chip, out);
      return;
    }
    if (!me) {
      if (role !== 'expired') {
        const install = installChip();
        if (install) account.appendChild(install);
      }
      if (signIn.accounts) {
        const chip = topChip('Sign in') as HTMLButtonElement;
        chip.addEventListener('click', () => {
          chip.disabled = true;
          void signInAgain()
            .then((ok) => {
              if (ok) again();
            })
            .finally(() => {
              chip.disabled = false;
            });
        });
        account.appendChild(chip);
      }
      // The owner tools are behind Access, whose session ends here too.
      if (current === 'owner') account.appendChild(signOutChip());
      return;
    }
    const menuItems: MenuItem[] = [
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
    menu = new TopMenu(`@${me.handle}`, menuItems, 'account-menu', account);
  };
  return { root, fill };
}
