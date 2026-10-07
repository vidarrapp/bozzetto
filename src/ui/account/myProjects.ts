import { checkSignIn, roleOf, type SignIn } from '../../admin/api';
import { loadConfig, suspensionText } from '../../net/account';
import { topChip, topbarLeft, topbarRight } from '../topbar';
import { accountChips } from './menu';
import { el } from './parts';

/**
 * My projects (`/?me`, docs/accounts.md §7): a member's own work, with the
 * storage it takes. The page itself comes with the next update (Batch 8:
 * the storage meter, the cards, Open, Download and Delete, read-only
 * offline); until then the top row's chip leads here, and the page says
 * what is coming and what Save to library does meanwhile.
 */
export async function renderMyProjects(app: HTMLElement): Promise<void> {
  document.documentElement.classList.add('is-page');
  app.classList.add('app--page');
  document.title = 'My projects · Bozzetto';
  const page = el('div', 'landing account-page');
  const head = el('header', 'landing__head');
  const titles = el('div');
  titles.append(el('h1', 'landing__title', 'My projects'));
  head.appendChild(titles);
  page.appendChild(head);
  app.replaceChildren(page);
  const back = topChip('← Gallery', '/');
  back.classList.add('viewer-back');
  topbarLeft().appendChild(back);

  const config = await loadConfig();
  const signIn = await checkSignIn().catch((): SignIn => ({ email: null, expired: false }));
  if (config?.accounts) {
    const bar = topbarRight();
    for (const c of accountChips(signIn, roleOf(signIn), () => void renderMyProjects(app))) {
      c.classList.add('landing-chip');
      bar.appendChild(c);
    }
  }
  const panel = el('section', 'account-section my-projects');
  if (!config?.accounts) {
    panel.appendChild(el('p', 'muted', 'Accounts are not open on this site.'));
  } else if (signIn.suspended) {
    panel.appendChild(el('p', 'account-say', suspensionText(signIn.suspended.reason)));
  } else if (!signIn.me) {
    panel.appendChild(el('p', 'muted', 'Sign in to see your projects.'));
  } else {
    panel.append(
      el('h2', 'account-section__title', 'Coming with the next update'),
      el(
        'p',
        'account-small',
        'Your own projects will be listed here: the scenes you save to your library, with the storage they take, ' +
          'to open, download or delete. Until then, Save to library in Sculpt downloads a .bozz file to keep.',
      ),
    );
  }
  page.appendChild(panel);
}
