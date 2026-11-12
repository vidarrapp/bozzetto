import { LEGAL } from './account/parts';
import { APP_VERSION } from './version';

/**
 * The foot the gallery and every page share (Owner tools, My projects,
 * Community, Account, Review): the legal pages at the left (docs/accounts.md
 * §9), the build that is running at the right (owner call: to tell a deploy
 * has landed), above a line. The pages get it from ui/pageShell.
 */
export function legalFoot(): HTMLElement {
  const foot = document.createElement('footer');
  foot.className = 'landing__foot';
  const link = (text: string, href: string): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    return a;
  };
  foot.append(link('Privacy', LEGAL.privacy), link('Terms', LEGAL.terms), link('Report content', LEGAL.takedown));
  const version = document.createElement('span');
  version.className = 'landing__version';
  version.textContent = APP_VERSION;
  foot.append(version);
  return foot;
}
